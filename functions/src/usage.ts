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
import { getModelCostTable } from "./appConfig";
import { costForUsage, costKey, type UsageSample } from "../../books-frontend/src/core/config/modelCosts";
import type { ProviderId } from "../../books-frontend/src/core/config/options";

export interface UsageEvent {
  provider: ProviderId;
  model: string;
  modality: "text" | "image";
  usage: UsageSample;
}

interface Collector {
  events: UsageEvent[];
}

const storage = new AsyncLocalStorage<Collector>();

/** Run `fn` with a fresh usage collector; provider calls inside are recorded. */
export function withUsage<T>(fn: () => Promise<T>): Promise<{ value: T; events: UsageEvent[] }> {
  const collector: Collector = { events: [] };
  return storage.run(collector, async () => {
    const value = await fn();
    return { value, events: collector.events };
  });
}

function push(event: UsageEvent): void {
  const c = storage.getStore();
  if (c) c.events.push(event);
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
 * Upper bound on a single provider request. Kept below the worker's 540s
 * function timeout so a stalled upstream call (image generation can hang) fails
 * the task with an abort error — letting the job reach a terminal state — rather
 * than being killed by the platform mid-run and leaving the job stuck.
 */
const PROVIDER_TIMEOUT_MS = 240_000;

/**
 * Fetch wrapper that records token usage from provider responses. It clones the
 * response so the caller still consumes the body normally. Failures never break
 * the request — metering is best-effort.
 */
export async function meteredFetch(url: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const res = await fetch(url, { ...init, signal });
  try {
    const provider = providerForHost(url);
    if (provider && storage.getStore()) {
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const reqModel = modelFromRequestBody(init);
        const reqSize = sizeFromRequest(init);
        const json = await res.clone().json();
        const event = parseUsage(provider, url, reqModel, reqSize, json);
        if (event) push(event);
      }
    }
  } catch {
    // best-effort
  }
  return res;
}

/**
 * Price the collected usage events and persist them under the user's space.
 * Writes immutable line items and increments period aggregates. Best-effort:
 * never throws into the calling request.
 */
export async function recordUsage(
  uid: string,
  action: string,
  events: UsageEvent[],
): Promise<void> {
  if (!uid || events.length === 0) return;
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
    const batch = db.batch();
    for (const e of events) {
      const cost = costForUsage(costs.models[costKey(e.provider, e.model)], e.usage);
      if (cost == null) knownCost = false;
      else totalCost += cost;
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
        at,
      });
    }
    batch.set(
      aggRef,
      {
        period,
        tokens: FieldValue.increment(totalTokens),
        costUsd: FieldValue.increment(totalCost),
        // Flags any unpriced model so the admin knows the total is a lower bound.
        hasUnpricedModels: knownCost ? FieldValue.delete() : true,
        updatedAt: at,
      },
      { merge: true },
    );
    await batch.commit();
  } catch {
    // Metering must never break generation.
  }
}
