/**
 * Server-side AI usage + cost metering.
 *
 * Provider responses report TOKENS, never dollars, so we capture token usage
 * here and price it locally against the admin `appConfig/modelCosts` table. All
 * capture happens in ONE place: `meteredFetch` (wired into the backend provider
 * HTTP binding) clones each provider response, extracts the usage, and appends a
 * sample to the active `AsyncLocalStorage` collector. AI endpoints / the worker
 * run their work inside `withUsage(...)` and then `recordUsage(...)` prices and
 * persists the collected samples to `users/{uid}/usage` (+ aggregates).
 *
 * Because execution is server-side, the action label is assigned by us (never
 * the client), so attribution is authoritative.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getModelCostTable, recordImageCostSample } from "./appConfig";
import { recordFinanceEvent } from "./finance";
import { costForUsage, costKey, type UsageSample } from "../../books-frontend/src/core/config/modelCosts";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../../books-frontend/src/core/ai/actions";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";

function isImageAction(action: string): action is ImageActionId {
  return (ALL_IMAGE_ACTION_IDS as string[]).includes(action);
}

export interface UsageEvent {
  provider: ProviderId;
  model: string;
  modality: "text" | "image";
  usage: UsageSample;
  /**
   * The semantic pipeline step this call belongs to (e.g. "image", "binding",
   * "localize"), when the call site wrapped itself in {@link withStep}. Multiple
   * steps roll up into ONE action's cost; the step just lets an admin see the
   * per-step breakdown of that combined total.
   */
  step?: string;
  /** Wall-clock duration of the provider HTTP call, for latency telemetry. */
  durationMs?: number;
}

/** Provider-call counters collected alongside usage events (incl. failures). */
export interface CallStats {
  /** Every provider HTTP attempt made inside the scope (incl. retries). */
  calls: number;
  /** Attempts that failed: non-2xx, network error, or timeout. */
  failures: number;
}

interface Collector {
  events: UsageEvent[];
  stats: CallStats;
}

const storage = new AsyncLocalStorage<Collector>();
/**
 * Tracks the current semantic step. Separate from the usage collector so nested,
 * concurrent steps (e.g. parallel per-subject edits) each carry their own label
 * — AsyncLocalStorage propagates it through the awaited provider call that
 * `meteredFetch` records.
 */
const stepStorage = new AsyncLocalStorage<string>();

/** Run `fn` with a fresh usage collector; provider calls inside are recorded. */
export function withUsage<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; events: UsageEvent[]; stats: CallStats }> {
  const collector: Collector = { events: [], stats: { calls: 0, failures: 0 } };
  return storage.run(collector, async () => {
    const value = await fn();
    return { value, events: collector.events, stats: collector.stats };
  });
}

/**
 * Tag every provider call made inside `fn` with a step label, so the collected
 * usage events (and their persisted line items) carry per-step attribution.
 * Combines with `withUsage`: the events still roll up into one action total.
 */
export function withStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  return stepStorage.run(step, fn);
}

function push(event: UsageEvent): void {
  const c = storage.getStore();
  if (!c) return;
  const step = stepStorage.getStore();
  c.events.push(step ? { ...event, step } : event);
}

function providerForHost(url: string): ProviderId | null {
  if (url.includes("api.openai.com")) return "openai";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  return null;
}

/** Parse OpenAI/Gemini usage out of a parsed JSON body. */
function parseUsage(
  provider: ProviderId,
  url: string,
  reqModel: string | undefined,
  reqSize: string | undefined,
  body: unknown,
): UsageEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  if (provider === "openai") {
    const isImage = url.includes("/images/");
    const usageRaw = b.usage as Record<string, unknown> | undefined;
    const model = (b.model as string | undefined) ?? reqModel ?? "unknown";
    if (isImage) {
      const sample: UsageSample = {
        inputTokens: num(usageRaw?.input_tokens),
        imageOutputTokens: num(usageRaw?.output_tokens),
        images: 1,
        size: reqSize,
      };
      return { provider, model, modality: "image", usage: sample };
    }
    if (!usageRaw) return null;
    const details = usageRaw.prompt_tokens_details as Record<string, unknown> | undefined;
    const sample: UsageSample = {
      inputTokens: num(usageRaw.prompt_tokens),
      outputTokens: num(usageRaw.completion_tokens),
      cachedInputTokens: num(details?.cached_tokens),
    };
    return { provider, model, modality: "text", usage: sample };
  }

  // google
  const meta = b.usageMetadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  const model =
    (b.modelVersion as string | undefined) ?? modelFromGeminiUrl(url) ?? reqModel ?? "unknown";
  const modality = model.includes("image") ? "image" : "text";
  const promptTokens = num(meta.promptTokenCount);
  const candidateTokens = num(meta.candidatesTokenCount) + num(meta.thoughtsTokenCount);
  const sample: UsageSample =
    modality === "image"
      ? { inputTokens: promptTokens, imageOutputTokens: candidateTokens, images: 1 }
      : { inputTokens: promptTokens, outputTokens: candidateTokens };
  return { provider, model, modality, usage: sample };
}

function modelFromGeminiUrl(url: string): string | undefined {
  const m = url.match(/\/models\/([^:/?]+)/);
  return m?.[1];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function modelFromRequestBody(init?: RequestInit): string | undefined {
  const body = init?.body;
  if (typeof body !== "string") return undefined;
  try {
    const parsed = JSON.parse(body) as { model?: string };
    return parsed.model;
  } catch {
    return undefined;
  }
}

/** The requested output size (e.g. "1024x1024"), used for size-based image pricing. */
function sizeFromRequest(init?: RequestInit): string | undefined {
  const body = init?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { size?: string };
      return parsed.size;
    } catch {
      return undefined;
    }
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const s = body.get("size");
    return typeof s === "string" ? s : undefined;
  }
  return undefined;
}

/**
 * Per-provider upper bound on a single request, kept well below the worker's
 * 540s function timeout. A healthy Gemini image call completes in 8-30s, so
 * anything past 90s is a stalled request that should fail fast (and retry)
 * instead of eating the whole job window — two silent 240s stalls used to turn
 * a "fast tier" render into 8+ minutes. OpenAI's gpt-image at high quality can
 * legitimately run for minutes, so it keeps a higher ceiling.
 */
const PROVIDER_TIMEOUT_MS: Record<ProviderId, number> = {
  google: 90_000,
  openai: 240_000,
};
const DEFAULT_TIMEOUT_MS = 240_000;

/**
 * Instance-wide cap on concurrent IMAGE generation calls. Each job caps its own
 * task pool, but parallel jobs multiply: 4 jobs x 3 tasks = 12 simultaneous
 * image calls on one API key, which trips provider rate limiting and produces
 * exactly the stalled-request pattern above. Queued FIFO, never rejects.
 */
const IMAGE_CALL_CONCURRENCY = 4;
let imageCallsInFlight = 0;
const imageCallWaiters: (() => void)[] = [];

async function acquireImageSlot(): Promise<() => void> {
  if (imageCallsInFlight >= IMAGE_CALL_CONCURRENCY) {
    await new Promise<void>((resolve) => imageCallWaiters.push(resolve));
  }
  imageCallsInFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    imageCallsInFlight -= 1;
    imageCallWaiters.shift()?.();
  };
}

/** Is this an image GENERATION request (the expensive, rate-limited kind)? */
function isImageGenerationCall(provider: ProviderId, url: string, init?: RequestInit): boolean {
  if (provider === "openai") return url.includes("/images/");
  const model = modelFromGeminiUrl(url) ?? modelFromRequestBody(init) ?? "";
  return model.includes("image");
}

/**
 * Fetch wrapper that records token usage + call latency from provider
 * responses. It clones the response so the caller still consumes the body
 * normally. Failures never break the request — metering is best-effort.
 */
export async function meteredFetch(url: string, init?: RequestInit): Promise<Response> {
  const provider = providerForHost(url);
  const collector = storage.getStore();
  const release =
    provider && isImageGenerationCall(provider, url, init) ? await acquireImageSlot() : null;
  // Start the timeout clock only once the request actually goes out (time
  // spent queued in the semaphore must not eat into the request budget).
  const timeout = AbortSignal.timeout(
    provider ? PROVIDER_TIMEOUT_MS[provider] : DEFAULT_TIMEOUT_MS,
  );
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  if (provider && collector) collector.stats.calls += 1;
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (provider && collector) collector.stats.failures += 1;
    throw err;
  } finally {
    release?.();
  }
  const durationMs = Date.now() - startedAt;
  try {
    if (provider && collector) {
      if (!res.ok) collector.stats.failures += 1;
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const reqModel = modelFromRequestBody(init);
        const reqSize = sizeFromRequest(init);
        const json = await res.clone().json();
        const event = parseUsage(provider, url, reqModel, reqSize, json);
        if (event) push({ ...event, durationMs });
      }
    }
  } catch {
    // best-effort
  }
  return res;
}

export interface RecordUsageOptions {
  /** The project the action ran for (per-project cost attribution). */
  projectId?: string;
  /**
   * True for edit re-rolls. Edits bundle extra sub-calls (intent, localize,
   * inpainting, dupe repairs), so their totals are excluded from the estimate
   * window — the window should reflect what a FRESH render of this action costs.
   */
  isEdit?: boolean;
  /** Provider call/failure counters from the same `withUsage` scope. */
  stats?: CallStats;
}

/**
 * Price the collected usage events and persist them under the user's space.
 * Writes immutable line items and increments period aggregates, and appends a
 * `providerCost` finance event so the admin dashboard sees every dollar of AI
 * spend (charged or free). Best-effort: never throws into the calling request.
 */
export async function recordUsage(
  uid: string,
  action: string,
  events: UsageEvent[],
  tier?: ImageTier,
  opts: RecordUsageOptions = {},
): Promise<void> {
  if (!uid) return;
  try {
    ensureAdmin();
    const costs = await getModelCostTable();
    const db = getFirestore();
    const at = Date.now();
    const period = new Date(at).toISOString().slice(0, 7); // YYYY-MM
    const usageCol = db.collection(`users/${uid}/usage`);
    const aggRef = db.doc(`users/${uid}/usageAggregates/${period}`);

    let totalCost = 0;
    let knownCost = true;
    let totalTokens = 0;
    let imageModelKey: string | null = null;
    const batch = db.batch();
    for (const e of events) {
      const cost = costForUsage(costs.models[costKey(e.provider, e.model)], e.usage);
      if (cost == null) knownCost = false;
      else totalCost += cost;
      if (e.modality === "image" && !imageModelKey) imageModelKey = costKey(e.provider, e.model);
      const tokens =
        (e.usage.inputTokens ?? 0) +
        (e.usage.outputTokens ?? 0) +
        (e.usage.imageInputTokens ?? 0) +
        (e.usage.imageOutputTokens ?? 0);
      totalTokens += tokens;
      batch.set(usageCol.doc(), {
        action,
        provider: e.provider,
        model: e.model,
        modality: e.modality,
        usage: e.usage,
        costUsd: cost,
        // Per-step attribution so an admin can break one action's combined cost
        // into its steps (e.g. image vs binding vs localize).
        ...(e.step ? { step: e.step } : {}),
        // Call latency, so slow steps/models are visible in cost intelligence.
        ...(typeof e.durationMs === "number" ? { durationMs: e.durationMs } : {}),
        // Stamp the tier on image line items so cost intelligence can facet by it.
        ...(tier && e.modality === "image" ? { tier } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        at,
      });
    }
    const failures = opts.stats?.failures ?? 0;
    if (events.length > 0 || failures > 0) {
      batch.set(
        aggRef,
        {
          period,
          tokens: FieldValue.increment(totalTokens),
          costUsd: FieldValue.increment(totalCost),
          ...(failures > 0 ? { failedCalls: FieldValue.increment(failures) } : {}),
          // Flags any unpriced model so the admin knows the total is a lower bound.
          hasUnpricedModels: knownCost ? FieldValue.delete() : true,
          updatedAt: at,
        },
        { merge: true },
      );
      await batch.commit();
    }

    // Every dollar of provider spend lands in the finance stream — including
    // spend behind actions that are FREE in Sparks (that subsidy is a real cost).
    if (totalCost > 0) {
      await recordFinanceEvent({
        category: "sparks",
        kind: "providerCost",
        amountUsd: -totalCost,
        uid,
        projectId: opts.projectId,
        meta: { action, ...(tier ? { tier } : {}), ...(knownCost ? {} : { partial: true }) },
      });
    }
    // Failed/timed-out provider attempts: persisted as waste markers so the
    // failure rate (and any silently-billed timeouts) are visible in admin.
    if (failures > 0) {
      await recordFinanceEvent({
        category: "waste",
        kind: "failedCalls",
        amountUsd: 0,
        uid,
        projectId: opts.projectId,
        meta: { action, failures, calls: opts.stats?.calls ?? failures, ...(tier ? { tier } : {}) },
      });
    }

    // Feed the rolling window that powers Spark estimate ranges. Only a fully
    // priced, FRESH render qualifies: partial costs would skew the range, and
    // edit re-rolls carry extra sub-calls that don't represent a fresh render.
    if (tier && knownCost && totalCost > 0 && isImageAction(action) && !opts.isEdit) {
      // Sanity clamp: a sample wildly above the model's nominal per-image rate
      // is a misconfigured cost entry or an outlier batch — don't poison the
      // window (and with it the pre-flight reserve) for the next 10 calls.
      const nominal = imageModelKey
        ? costForUsage(costs.models[imageModelKey], { images: 1, size: "1024x1024" })
        : null;
      const outlier = nominal != null && nominal > 0 && totalCost > nominal * 10;
      if (!outlier) {
        await recordImageCostSample(action, tier, totalCost, imageModelKey ?? undefined);
      }
    }
  } catch {
    // Metering must never break generation.
  }
}
