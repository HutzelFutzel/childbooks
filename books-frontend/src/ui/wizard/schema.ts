import { z } from "zod";
import type { BookConfig } from "../../core/types";

const modelSelection = z.object({
  provider: z.enum(["openai", "google"]),
  id: z.string().min(1),
});

export const bookConfigSchema = z.object({
  storyText: z.string().trim().min(20, "Please enter at least a sentence or two of story."),
  // Models are chosen automatically by the system (no user selection).
  textModel: modelSelection.nullable(),
  imageModel: modelSelection.nullable(),
  artStyle: z
    .object({
      presetId: z.string().nullable(),
      customDescription: z.string().optional(),
    })
    .refine(
      (v) => v.presetId !== null || Boolean(v.customDescription?.trim()),
      "Pick a style or describe your own.",
    ),
  ageRangeId: z.string().min(1),
  productSku: z.string().min(1),
  bookSize: z.enum(["square", "landscape", "portrait"]),
  graphicsDensity: z.enum(["one-per-page", "multiple-per-page", "combination"]),
  spreadUsage: z.enum(["single", "double", "mixed"]),
  textHandling: z.enum(["exact", "creative"]),
  textPlacement: z.enum(["separate", "embedded"]),
  layoutId: z.string().min(1),
});

export type WizardStepId =
  | "story"
  | "style"
  | "audience"
  | "graphics"
  | "text"
  | "review";

/** Validate just the fields relevant to a given step. Returns an error string or null. */
export function validateStep(step: WizardStepId, config: BookConfig): string | null {
  switch (step) {
    case "story": {
      const r = bookConfigSchema.shape.storyText.safeParse(config.storyText);
      return r.success ? null : r.error.issues[0]?.message ?? "Invalid";
    }
    case "style": {
      const r = bookConfigSchema.shape.artStyle.safeParse(config.artStyle);
      return r.success ? null : r.error.issues[0]?.message ?? "Invalid";
    }
    case "audience":
      return config.ageRangeId && config.productSku ? null : "Pick an age range and size.";
    case "graphics":
      return config.graphicsDensity && config.spreadUsage ? null : "Choose graphics options.";
    case "text":
      return config.textHandling && config.textPlacement && config.layoutId
        ? null
        : "Choose text options.";
    case "review":
      return bookConfigSchema.safeParse(config).success ? null : "Some steps are incomplete.";
  }
}
