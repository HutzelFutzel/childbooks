/**
 * Admin-editable **model costs** (the `appConfig/modelCosts` document) and the
 * cost calculator.
 *
 * Providers report usage in TOKENS / image counts, never dollars, so cost is
 * computed locally as usage × the configured rate. The shapes here mirror the
 * provider pricing tables 1:1 so they're easy to fill in from the docs:
 *
 *   TEXT models (OpenAI & Gemini text tables):
 *     - input / output / cached-input, each "per 1M tokens".
 *     - an OPTIONAL `largePrompt` override for the "prompts > N tokens" tier
 *       some Gemini models have (e.g. 2.5 Pro: $1.25 ≤200k, $2.50 >200k).
 *
 *   IMAGE models (image tables):
 *     - input "per 1M tokens" (text/image input tokens), and
 *     - output billed one of three ways: per 1M image tokens (Gemini, e.g.
 *       $30/1M), a flat per-image price, or a per-image price that varies by
 *       output size (OpenAI by size/quality).
 *
 * The calculator is two small, explicit functions — no generic tier engine.
 *
 * @see https://ai.google.dev/gemini-api/docs/pricing
 * @see https://developers.openai.com/api/docs/pricing
 */
import { z } from "zod";

/** Token/usage sample captured from a provider response. */
export interface UsageSample {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  imageInputTokens?: number;
  imageOutputTokens?: number;
  /** Number of images produced (for per-image pricing). */
  images?: number;
  /** Output size (e.g. "1024x1024") for size-specific image pricing. */
  size?: string;
}

/** A row of "per 1M tokens" text rates (mirrors a provider text table column). */
export interface TextRates {
  /** $ per 1M input tokens. */
  input: number;
  /** $ per 1M output tokens (Gemini includes thinking tokens here). */
  output: number;
  /** $ per 1M cached input tokens (optional; omit if the model has no cache rate). */
  cachedInput?: number;
}

/** Higher rates that apply once a prompt exceeds `overTokens` input tokens. */
export interface LargePromptRates extends TextRates {
  overTokens: number;
}

export type ImageOutputCost =
  | { mode: "perMillionTokens"; rate: number } // e.g. Gemini image output $30/1M tokens
  | { mode: "perImage"; rate: number } // flat $ per image (e.g. $0.039)
  | { mode: "perImageBySize"; bySize: Record<string, number>; fallback: number };

export type ModelCost =
  | ({ kind: "text"; largePrompt?: LargePromptRates } & TextRates)
  | { kind: "image"; input: number; output: ImageOutputCost };

export interface ModelCostTable {
  version: 1;
  currency: "usd";
  /** Keyed by `${provider}:${modelId}`. */
  models: Record<string, ModelCost>;
}

export function costKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

export function createTextCost(): Extract<ModelCost, { kind: "text" }> {
  return { kind: "text", input: 0, output: 0 };
}
export function createImageCost(): Extract<ModelCost, { kind: "image" }> {
  return { kind: "image", input: 0, output: { mode: "perImage", rate: 0 } };
}

export function createDefaultModelCostTable(): ModelCostTable {
  // Empty by default — an admin fills in real rates. Until a model has a cost,
  // `costForUsage` returns null (usage is still recorded, cost is "unknown").
  return { version: 1, currency: "usd", models: {} };
}

export function normalizeModelCostTable(input: unknown): ModelCostTable {
  const stored = (input ?? {}) as Partial<ModelCostTable>;
  return { version: 1, currency: "usd", models: stored.models ?? {} };
}

// ---- Calculator ------------------------------------------------------------

function perMillion(tokens: number | undefined, rate: number): number {
  return ((tokens ?? 0) / 1_000_000) * rate;
}

function costForText(c: Extract<ModelCost, { kind: "text" }>, u: UsageSample): number {
  const big = c.largePrompt && (u.inputTokens ?? 0) > c.largePrompt.overTokens;
  const r: TextRates = big ? c.largePrompt! : c;
  return (
    perMillion(u.inputTokens, r.input) +
    perMillion(u.outputTokens, r.output) +
    perMillion(u.cachedInputTokens, r.cachedInput ?? 0)
  );
}

function costForImage(c: Extract<ModelCost, { kind: "image" }>, u: UsageSample): number {
  let total = perMillion(u.inputTokens, c.input) + perMillion(u.imageInputTokens, c.input);
  const images = u.images ?? 0;
  switch (c.output.mode) {
    case "perMillionTokens":
      total += perMillion(u.imageOutputTokens, c.output.rate);
      break;
    case "perImage":
      total += images * c.output.rate;
      break;
    case "perImageBySize": {
      const sized = u.size != null ? c.output.bySize[u.size] : undefined;
      total += images * (sized ?? c.output.fallback);
      break;
    }
  }
  return total;
}

/**
 * Total dollar cost for one call, or null when the model has no configured cost
 * (so the usage event is still recorded with an unknown cost).
 */
export function costForUsage(cost: ModelCost | undefined, usage: UsageSample): number | null {
  if (!cost) return null;
  const value = cost.kind === "text" ? costForText(cost, usage) : costForImage(cost, usage);
  return Math.round(value * 1e6) / 1e6;
}

// ---- Validation ------------------------------------------------------------

const textRatesShape = {
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cachedInput: z.number().nonnegative().optional(),
};

const imageOutputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("perMillionTokens"), rate: z.number().nonnegative() }),
  z.object({ mode: z.literal("perImage"), rate: z.number().nonnegative() }),
  z.object({
    mode: z.literal("perImageBySize"),
    bySize: z.record(z.string(), z.number().nonnegative()),
    fallback: z.number().nonnegative(),
  }),
]);

const modelCostSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    ...textRatesShape,
    largePrompt: z.object({ overTokens: z.number().nonnegative(), ...textRatesShape }).optional(),
  }),
  z.object({
    kind: z.literal("image"),
    input: z.number().nonnegative(),
    output: imageOutputSchema,
  }),
]);

export const modelCostTableSchema = z.object({
  version: z.literal(1),
  currency: z.literal("usd"),
  models: z.record(z.string(), modelCostSchema),
});
