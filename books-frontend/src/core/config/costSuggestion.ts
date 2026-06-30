/**
 * LLM-assisted cost suggestion: an admin can ask a (configured, cheap) text
 * model to read a provider's official pricing page and propose a `ModelCost`
 * for a given model id. The model never auto-saves — the suggestion pre-fills
 * the admin form for review.
 *
 * The extraction shape below is intentionally FLAT (no discriminated unions /
 * deep nesting) so it round-trips cleanly through both providers' structured
 * output (Gemini `responseSchema` is a restricted OpenAPI subset). `suggestion
 * ToModelCost` converts it into the real `ModelCost` shape used everywhere else.
 */
import { z } from "zod";
import type { ProviderId } from "./options";
import type { ImageOutputCost, ModelCost } from "./modelCosts";

export const costSuggestionSchema = z.object({
  /** False when the model id can't be found in the excerpt. */
  found: z.boolean(),
  /** The exact id as shown in the docs (may differ from the requested id). */
  canonicalModelId: z.string(),
  kind: z.enum(["text", "image"]),
  text: z.object({
    inputPer1M: z.number(),
    outputPer1M: z.number(),
    cachedInputPer1M: z.number(),
    largePrompt: z.object({
      enabled: z.boolean(),
      overTokens: z.number(),
      inputPer1M: z.number(),
      outputPer1M: z.number(),
      cachedInputPer1M: z.number(),
    }),
  }),
  image: z.object({
    inputPer1M: z.number(),
    outputMode: z.enum(["perMillionTokens", "perImage", "perImageBySize"]),
    perMillionTokens: z.number(),
    perImage: z.number(),
    bySize: z.array(z.object({ size: z.string(), rate: z.number() })),
    fallbackPerImage: z.number(),
  }),
  /** The verbatim line(s) from the page the rates were taken from. */
  sourceQuote: z.string(),
  /** Any caveats (tier assumptions, ambiguity, etc.). */
  notes: z.string(),
});

export type RawCostSuggestion = z.infer<typeof costSuggestionSchema>;

/**
 * Batch extraction: one LLM call per provider returns every requested model at
 * once. Each item echoes `requestedModelId` so results map back deterministically
 * even when the docs use a slightly different display id.
 */
export const batchCostItemSchema = costSuggestionSchema.extend({
  /** Echo of the exact id we asked for, so callers can match results. */
  requestedModelId: z.string(),
});

export const batchCostSuggestionSchema = z.object({
  models: z.array(batchCostItemSchema),
});

export type RawBatchCostItem = z.infer<typeof batchCostItemSchema>;

/** What the backend returns to the admin UI (per requested model). */
export interface CostSuggestionResult {
  provider: ProviderId;
  requestedModelId: string;
  found: boolean;
  modelCost: ModelCost | null;
  canonicalModelId: string;
  sourceQuote: string;
  notes: string;
}

/** Convert the flat extraction into the canonical `ModelCost`. */
export function suggestionToModelCost(s: RawCostSuggestion): ModelCost {
  if (s.kind === "image") {
    const o = s.image;
    let output: ImageOutputCost;
    if (o.outputMode === "perMillionTokens") {
      output = { mode: "perMillionTokens", rate: o.perMillionTokens };
    } else if (o.outputMode === "perImageBySize") {
      output = {
        mode: "perImageBySize",
        bySize: Object.fromEntries(o.bySize.filter((e) => e.size.trim()).map((e) => [e.size.trim(), e.rate])),
        fallback: o.fallbackPerImage,
      };
    } else {
      output = { mode: "perImage", rate: o.perImage };
    }
    return { kind: "image", input: o.inputPer1M, output };
  }

  const t = s.text;
  const cost: Extract<ModelCost, { kind: "text" }> = { kind: "text", input: t.inputPer1M, output: t.outputPer1M };
  if (t.cachedInputPer1M > 0) cost.cachedInput = t.cachedInputPer1M;
  if (t.largePrompt.enabled) {
    cost.largePrompt = {
      overTokens: t.largePrompt.overTokens,
      input: t.largePrompt.inputPer1M,
      output: t.largePrompt.outputPer1M,
      ...(t.largePrompt.cachedInputPer1M > 0 ? { cachedInput: t.largePrompt.cachedInputPer1M } : {}),
    };
  }
  return cost;
}
