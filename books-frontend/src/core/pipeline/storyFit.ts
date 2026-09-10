/**
 * Age-fit check for a story the author wrote or pasted themselves.
 *
 * Strictly advisory: it never rewrites a word and never blocks the flow. The
 * verdict drives a chip in the Story step so someone who pastes a chapter of
 * their own novel into a 3–5 book finds out now rather than after the art is
 * generated.
 */
import { z } from "zod";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { BookConfig } from "../types";
import { withRetry } from "./retry";
import type { PromptContext } from "../prompts/context";
import { buildStoryFitPrompt } from "../prompts/story";
import { wordCount } from "../story/brief";

const storyFitSchema = z.object({
  verdict: z.enum(["good", "minor", "mismatch"]),
  headline: z.string(),
  notes: z.array(z.string()).max(3),
  /**
   * Per-dimension calibration against the band's rubric. Optional because a
   * band whose rubric an admin has cleared asks for none, and because a model
   * that returns a malformed row should cost us the row, not the whole read.
   */
  dimensions: z
    .array(z.object({ id: z.string(), fit: z.enum(["typical", "lighter", "heavier"]) }))
    .max(20)
    .optional(),
});

export type DimensionFit = "typical" | "lighter" | "heavier";

export interface StoryFit {
  verdict: "good" | "minor" | "mismatch";
  headline: string;
  notes: string[];
  /** Only rows the band actually asked about, in rubric order. */
  dimensions: { id: string; fit: DimensionFit }[];
  /**
   * Which age band, and which revision of it, produced this read. Stamped so a
   * result can be recognised as stale after an admin edits the band — the text
   * didn't change, but what "right for this age" means did.
   */
  profileId: string;
  profileRevision: number;
}

export interface CheckStoryFitInput {
  story: string;
  config: BookConfig;
  creds: ProviderCredentials;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

export async function checkStoryFit(input: CheckStoryFitInput): Promise<StoryFit> {
  const { story, config, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const { system, user, profile, dimensionIds } = buildStoryFitPrompt(
    config,
    story,
    wordCount(story),
    prompts,
  );

  const result = await withRetry(
    () =>
      provider.generateStructured<z.infer<typeof storyFitSchema>>(creds, {
        model,
        schema: storyFitSchema,
        schemaName: "story_fit",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal,
      }),
    { signal },
  );

  // Keep only rows the band asked about, in rubric order: a model that invents
  // a dimension id would otherwise put an unlabelled row in front of the author.
  const returned = new Map((result.dimensions ?? []).map((d) => [d.id, d.fit]));
  const dimensions = dimensionIds
    .filter((id) => returned.has(id))
    .map((id) => ({ id, fit: returned.get(id)! }));

  return {
    verdict: result.verdict,
    headline: result.headline.trim(),
    notes: result.notes.map((n) => n.trim()).filter(Boolean).slice(0, 3),
    dimensions,
    profileId: profile.id,
    profileRevision: prompts?.audience?.revision ?? 0,
  };
}
