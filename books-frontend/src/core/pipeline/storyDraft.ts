/**
 * Story draft: the quick-start path. Given a hero name (from the landing
 * on-ramp) and an optional theme, write a complete first story the author can
 * edit — so the Story stage is never a blank page.
 */
import { z } from "zod";
import { AGE_RANGES } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { BookConfig } from "../types";
import { withRetry } from "./retry";
import { resolveAgeLlmGuidance } from "../prompts/age";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";

const storyDraftSchema = z.object({
  title: z.string(),
  story: z.string(),
});

export type StoryDraft = z.infer<typeof storyDraftSchema>;

/** Age-appropriate story length bounds (whole-book word counts). */
function wordBounds(ageRangeId: string): { min: number; max: number } {
  switch (ageRangeId) {
    case "0-2":
      return { min: 60, max: 140 };
    case "3-5":
      return { min: 150, max: 320 };
    case "6-8":
      return { min: 300, max: 600 };
    default:
      return { min: 450, max: 900 };
  }
}

export interface GenerateStoryDraftInput {
  heroName: string;
  theme?: string;
  config: BookConfig;
  creds: ProviderCredentials;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/** Write a complete first story (+ title) starring the hero. */
export async function generateStoryDraft(input: GenerateStoryDraftInput): Promise<StoryDraft> {
  const { heroName, theme, config, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const age = AGE_RANGES.find((a) => a.id === config.ageRangeId)?.label ?? config.ageRangeId;
  const ageGuidance = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);
  const bounds = wordBounds(config.ageRangeId);

  const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "storyDraft", {
    vars: {
      age,
      ageGuidance,
      heroName: heroName.trim(),
      theme: theme?.trim() ?? "",
      minWords: String(bounds.min),
      maxWords: String(bounds.max),
    },
    flags: { hasTheme: Boolean(theme?.trim()) },
  });

  const result = await withRetry(
    () =>
      provider.generateStructured<StoryDraft>(creds, {
        model,
        schema: storyDraftSchema,
        schemaName: "story_draft",
        temperature: 0.8,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal,
      }),
    { signal },
  );

  return { title: result.title.trim(), story: result.story.trim() };
}
