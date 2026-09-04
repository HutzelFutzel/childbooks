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
import type { CostSampleKind } from "../../books-frontend/src/core/config/imageCostStats";
import { recordFinanceEvent } from "./finance";
import {
  costForUsage,
  costKey,
  PUBLIC_IMAGE_ESTIMATE_USAGE,
  type UsageSample,
} from "../../books-frontend/src/core/config/modelCosts";
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
  /**
   * Identifies the individual {@link withStep} INVOCATION this call was made
   * inside, as opposed to the step's label. A step that legitimately fans out
   * (one `subjectEdit` per subject) enters the scope once per unit of work and
   * so gets one id each, while a call retried inside a single scope reuses its
   * id — which is what lets {@link splitBillable} bill the work and absorb the
   * retry without having to guess which is which from the label alone.
   */
  stepId?: number;
  /** Wall-clock duration of the provider HTTP call, for latency telemetry. */
  durationMs?: number;
}

/**
 * Steps that exist to fix the model's OWN output rather than to produce what
 * the user asked for: the anchor grid-count re-render, the duplicate-subject
 * erase, the embedded-anchor cleanup, and the panel-count vision check that
 * triggers them. They are metered, attributed and reported like every other
 * call — they just never reach the user's wallet. A reader shouldn't pay for
 * the model drawing a character twice.
 */
export const NON_BILLABLE_STEPS = new Set(["gridCheck", "imageRepair", "dedupe", "embedded"]);

/**
 * Chargeable image calls per pipeline step INVOCATION. Every image call site is
 * wrapped in `withRetry`, so one unit of work can emit a second priced event
 * when the first attempt returns unusable output; capping per invocation means
 * that retry lands on us rather than on the user, while a step that genuinely
 * renders N images (one `subjectEdit` per subject) still bills all N.
 */
const MAX_BILLABLE_IMAGE_CALLS = 1;

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

/** One entry of the step scope: the label plus the invocation it belongs to. */
interface StepScope {
  step: string;
  id: number;
}

/**
 * Tracks the current semantic step. Separate from the usage collector so nested,
 * concurrent steps (e.g. parallel per-subject edits) each carry their own label
 * — AsyncLocalStorage propagates it through the awaited provider call that
 * `meteredFetch` records.
 */
const stepStorage = new AsyncLocalStorage<StepScope>();

/** Monotonic source of {@link StepScope} ids; only ever compared for equality. */
let nextStepId = 0;

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
  nextStepId += 1;
  return stepStorage.run({ step, id: nextStepId }, fn);
}

export interface BillableSplit {
  /** Events the user pays for — the work they actually requested. */
  billable: UsageEvent[];
  /** Internal quality-control work, absorbed by us (see {@link NON_BILLABLE_STEPS}). */
  unbilled: UsageEvent[];
}

/**
 * Split one action's provider calls into what the user asked for and what the
 * pipeline did to repair its own output. Pure, so both the settle path and the
 * estimate window can apply the exact same rule and never disagree about what
 * a render "costs".
 */
export function splitBillable(events: UsageEvent[]): BillableSplit {
  const billable: UsageEvent[] = [];
  const unbilled: UsageEvent[] = [];
  // Calls made outside any `withStep` scope share a bucket: an unlabelled path
  // is a single logical render (the direct-render worker), so its retries must
  // be absorbed too rather than falling through the cap uncounted.
  const imageCallsByScope = new Map<number | string, number>();
  for (const e of events) {
    const step = e.step ?? "";
    if (NON_BILLABLE_STEPS.has(step)) {
      unbilled.push(e);
      continue;
    }
    if (e.modality === "image") {
      const scope = e.stepId ?? `${step}:unscoped`;
      const seen = (imageCallsByScope.get(scope) ?? 0) + 1;
      imageCallsByScope.set(scope, seen);
      if (seen > MAX_BILLABLE_IMAGE_CALLS) {
        unbilled.push(e);
        continue;
      }
    }
    billable.push(e);
  }
  return { billable, unbilled };
}

function push(event: UsageEvent): void {
  const c = storage.getStore();
  if (!c) return;
  const scope = stepStorage.getStore();
  c.events.push(scope ? { ...event, step: scope.step, stepId: scope.id } : event);
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
      // Count the images the response actually carries rather than assuming one:
      // a body with no `data` produced nothing to bill for, and per-image pricing
      // has to scale with `n` when a call ever asks for more than one.
      const images = Array.isArray(b.data) ? b.data.length : 0;
      if (images === 0) return null;
      const sample: UsageSample = {
        inputTokens: num(usageRaw?.input_tokens),
        imageOutputTokens: num(usageRaw?.output_tokens),
        images,
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
  if (modality === "image") {
    // A safety-blocked prompt comes back 200 with a finishReason and no inline
    // data, so count the images the response really carries.
    const images = countGeminiImageParts(b);
    if (images === 0) return null;
    return {
      provider,
      model,
      modality,
      usage: {
        inputTokens: promptTokens,
        // Only the image tokens belong at the image-output rate. Thinking tokens
        // are billed as ordinary text output by the provider, so folding them in
        // here priced them at (typically) an order of magnitude too much.
        imageOutputTokens: num(meta.candidatesTokenCount),
        outputTokens: num(meta.thoughtsTokenCount),
        images,
      },
    };
  }
  const sample: UsageSample = {
    inputTokens: promptTokens,
    outputTokens: num(meta.candidatesTokenCount) + num(meta.thoughtsTokenCount),
  };
  return { provider, model, modality, usage: sample };
}

/** How many inline images a Gemini generation response actually returned. */
function countGeminiImageParts(body: Record<string, unknown>): number {
  const candidates = body.candidates;
  if (!Array.isArray(candidates)) return 0;
  let images = 0;
  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: unknown } })?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if ((part as { inlineData?: unknown })?.inlineData) images += 1;
    }
  }
  return images;
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

/** Image calls should fail fast; healthy Gemini image renders take seconds. */
const IMAGE_PROVIDER_TIMEOUT_MS: Record<ProviderId, number> = {
  google: 90_000,
  openai: 240_000,
};
/**
 * Structured text can legitimately take longer than image generation,
 * especially a full screenplay from a reasoning model. Keep it below the
 * worker's four-minute task lease while no longer applying the image-only 90s
 * cutoff that caused production screenplay jobs to die.
 */
const TEXT_PROVIDER_TIMEOUT_MS: Record<ProviderId, number> = {
  google: 210_000,
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
  const imageGeneration = Boolean(provider && isImageGenerationCall(provider, url, init));
  const release =
    provider && imageGeneration ? await acquireImageSlot() : null;
  // Start the timeout clock only once the request actually goes out (time
  // spent queued in the semaphore must not eat into the request budget).
  const timeoutMs = provider
    ? imageGeneration
      ? IMAGE_PROVIDER_TIMEOUT_MS[provider]
      : TEXT_PROVIDER_TIMEOUT_MS[provider]
    : DEFAULT_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(
    timeoutMs,
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
      // Only a SUCCESSFUL response describes work the provider will invoice us
      // for. An error body still parses as JSON, and the OpenAI image branch
      // below infers `images: 1` from the endpoint rather than from a usage
      // block — so metering a 429 would bill the user a full image for a render
      // that never happened. Failures are counted in `stats`, never priced.
      if (res.ok && contentType.includes("application/json")) {
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
  /** The action run these calls belong to (see `actionRun.ts`). */
  runId?: string;
  /** This project's 1-based sequence number for the user, when known. */
  projectSeq?: number;
}

/** Priced totals for one action's calls — the input to the run record + settle. */
export interface UsageTotals {
  /** Every priced call, charged or not. */
  totalUsd: number;
  /** The portion the user pays for. */
  billableUsd: number;
  /** Internal quality-control cost we absorb. */
  unbilledUsd: number;
  /** False when any model had no configured rate (totals are a lower bound). */
  knownCost: boolean;
  costByStep: Record<string, number>;
  callsByStep: Record<string, number>;
  /** `${provider}:${model}` of the first image call, for the estimate window. */
  imageModelKey: string | null;
  /** Total tokens across every call. */
  tokens: number;
}

function emptyTotals(): UsageTotals {
  return {
    totalUsd: 0,
    billableUsd: 0,
    unbilledUsd: 0,
    knownCost: true,
    costByStep: {},
    callsByStep: {},
    imageModelKey: null,
    tokens: 0,
  };
}

/** How long raw per-call line items are kept (a TTL policy reads `expiresAt`). */
const USAGE_TTL_MS = 180 * 86_400_000;

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
): Promise<UsageTotals> {
  if (!uid) return emptyTotals();
  try {
    ensureAdmin();
    const costs = await getModelCostTable();
    const db = getFirestore();
    const at = Date.now();
    const period = new Date(at).toISOString().slice(0, 7); // YYYY-MM
    const usageCol = db.collection(`users/${uid}/usage`);
    const aggRef = db.doc(`users/${uid}/usageAggregates/${period}`);

    // The user pays for what they asked for; repair passes are on us. Both are
    // written as line items — only the billable half reaches the wallet.
    const { billable, unbilled } = splitBillable(events);
    const unbilledSet = new Set(unbilled);

    const totals = emptyTotals();
    let totalCost = 0;
    let knownCost = true;
    let totalTokens = 0;
    let imageModelKey: string | null = null;
    const batch = db.batch();
    for (const e of events) {
      const cost = costForUsage(costs.models[costKey(e.provider, e.model)], e.usage);
      const billable = !unbilledSet.has(e);
      if (cost == null) knownCost = false;
      else {
        totalCost += cost;
        if (billable) totals.billableUsd += cost;
        else totals.unbilledUsd += cost;
        const step = e.step ?? "unlabeled";
        totals.costByStep[step] = round6((totals.costByStep[step] ?? 0) + cost);
      }
      const stepKey = e.step ?? "unlabeled";
      totals.callsByStep[stepKey] = (totals.callsByStep[stepKey] ?? 0) + 1;
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
        // Whether this call reached the user's wallet — the QC tax is the sum
        // of everything marked false.
        billable,
        // Per-step attribution so an admin can break one action's combined cost
        // into its steps (e.g. image vs binding vs localize).
        ...(e.step ? { step: e.step } : {}),
        // Call latency, so slow steps/models are visible in cost intelligence.
        ...(typeof e.durationMs === "number" ? { durationMs: e.durationMs } : {}),
        // Stamp the tier on image line items so cost intelligence can facet by it.
        ...(tier && e.modality === "image" ? { tier } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        // Line items roll up into `actionRuns`, which are kept indefinitely;
        // the raw calls age out under a TTL policy on this field.
        ...(opts.runId ? { runId: opts.runId } : {}),
        ...(typeof opts.projectSeq === "number" ? { projectSeq: opts.projectSeq } : {}),
        at,
        expiresAt: at + USAGE_TTL_MS,
      });
    }
    totals.totalUsd = round6(totalCost);
    totals.billableUsd = round6(totals.billableUsd);
    totals.unbilledUsd = round6(totals.unbilledUsd);
    totals.knownCost = knownCost;
    totals.imageModelKey = imageModelKey;
    totals.tokens = totalTokens;
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
        ...(opts.runId ? { ref: `providerCost_${opts.runId}` } : {}),
        meta: {
          action,
          ...(tier ? { tier } : {}),
          ...(knownCost ? {} : { partial: true }),
          ...(opts.runId ? { runId: opts.runId } : {}),
          ...(typeof opts.projectSeq === "number" ? { projectSeq: opts.projectSeq } : {}),
        },
      });
    }
    // The repair passes we chose to absorb. Booked as waste (not as a Spark
    // discount) so "what our quality control costs us" is one query away
    // instead of buried in the difference between two other numbers.
    if (totals.unbilledUsd > 0) {
      await recordFinanceEvent({
        category: "waste",
        kind: "qcCost",
        amountUsd: 0, // the dollars are already booked by `providerCost` above
        uid,
        projectId: opts.projectId,
        meta: {
          action,
          ...(tier ? { tier } : {}),
          unbilledUsd: totals.unbilledUsd,
          steps: unbilled.map((e) => e.step ?? "unlabeled"),
          ...(opts.runId ? { runId: opts.runId } : {}),
        },
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
    // priced render qualifies — a partial cost would skew the range.
    //
    // Edits keep their OWN window rather than being dropped: they fan out into a
    // localization call plus one image call per subject, so pooling them with
    // fresh renders skewed the fresh range upward, and dropping them left every
    // edit quoted at a fresh render's price and charged several times that.
    //
    // The sample is the BILLABLE total, not the full one: this window drives
    // both the quoted price and the pre-flight reserve, so feeding it repair
    // costs we never charge would quote users a price they'll never pay — and
    // `ensureAfford` would block them at it.
    if (tier && knownCost && totals.billableUsd > 0 && isImageAction(action)) {
      const kind: CostSampleKind = opts.isEdit ? "edit" : "fresh";
      // Sanity clamp: a sample wildly above the model's nominal per-image rate
      // is a misconfigured cost entry or an outlier batch — don't poison the
      // window (and with it the pre-flight reserve) for the next 10 calls. An
      // edit legitimately spends several images, so its ceiling scales with the
      // number of image calls it actually made.
      const nominal = imageModelKey
        ? costForUsage(costs.models[imageModelKey], PUBLIC_IMAGE_ESTIMATE_USAGE)
        : null;
      const imageCalls = Math.max(1, billable.filter((e) => e.modality === "image").length);
      const ceiling = nominal != null && nominal > 0 ? nominal * 10 * imageCalls : null;
      const outlier = ceiling != null && totals.billableUsd > ceiling;
      if (!outlier) {
        await recordImageCostSample(
          action,
          tier,
          totals.billableUsd,
          imageModelKey ?? undefined,
          kind,
        );
      }
    }
    return totals;
  } catch {
    // Metering must never break generation.
    return emptyTotals();
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
