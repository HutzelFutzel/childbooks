import { z } from "zod";
import type { BookConfig } from "../../core/types";
import { ageBandHasReadingModes } from "../../core/config/ageWritingCatalog";
import { BOOK_LANGUAGES } from "../../core/config/bookLanguages";
import { storyBriefSchema } from "../../core/story/brief";

const modelSelection = z.object({
  provider: z.enum(["openai", "google"]),
  id: z.string().min(1),
});

const contentLocaleSchema = z.enum(
  BOOK_LANGUAGES.map((language) => language.id) as [
    (typeof BOOK_LANGUAGES)[number]["id"],
    ...(typeof BOOK_LANGUAGES)[number]["id"][],
  ],
);

const artStyleSchema = z
  .object({
    presetId: z.string().nullable(),
    customDescription: z.string().optional(),
  })
  .refine(
    (v) => v.presetId !== null || Boolean(v.customDescription?.trim()),
    "Pick a style or describe your own.",
  );

/** Story step only — audience + text. Art style is confirmed in Design · Cast. */
export const storyConfigSchema = z
  .object({
    storyText: z.string().trim().min(20, "Please enter at least a sentence or two of story."),
    storyBrief: storyBriefSchema.optional(),
    contentLocale: contentLocaleSchema.optional(),
    ageRangeId: z.string().min(1),
    readingModeId: z.enum(["read-aloud", "with-help", "independent"]).nullable().optional(),
  })
  .superRefine((config, ctx) => {
    if (ageBandHasReadingModes(config.ageRangeId) && !config.readingModeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick how the book will be read.",
        path: ["readingModeId"],
      });
    }
  });

export const bookConfigSchema = z.object({
  storyText: z.string().trim().min(20, "Please enter at least a sentence or two of story."),
  storyBrief: storyBriefSchema.optional(),
  contentLocale: contentLocaleSchema.optional(),
  // Models are chosen automatically by the system (no user selection).
  textModel: modelSelection.nullable(),
  imageModel: modelSelection.nullable(),
  artStyle: artStyleSchema,
  ageRangeId: z.string().min(1),
  readingModeId: z.enum(["read-aloud", "with-help", "independent"]).nullable().optional(),
  productSku: z.string().min(1),
  bookSize: z.enum(["square", "landscape", "portrait"]),
  graphicsDensity: z.enum(["one-per-page", "multiple-per-page", "combination"]),
  spreadUsage: z.enum(["single", "double", "mixed"]),
  textHandling: z.enum(["exact", "creative"]),
  textPlacement: z.enum(["separate", "embedded"]),
  layoutId: z.string().min(1),
}).superRefine((config, ctx) => {
  if (ageBandHasReadingModes(config.ageRangeId) && !config.readingModeId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pick how the book will be read.",
      path: ["readingModeId"],
    });
  }
});

/** Whether a look has been chosen (preset and/or custom direction). */
export function isArtStyleChosen(config: BookConfig): boolean {
  return artStyleSchema.safeParse(config.artStyle).success;
}

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
    case "style":
      return isArtStyleChosen(config) ? null : "Pick a style or describe your own.";
    case "audience":
      if (!config.ageRangeId || !config.productSku) return "Pick an age range and size.";
      if (ageBandHasReadingModes(config.ageRangeId) && !config.readingModeId) {
        return "Pick how the book will be read.";
      }
      return null;
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
