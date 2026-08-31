/**
 * Story translation & cultural adaptation: translates an existing story and
 * optional title into the selected target language while preserving rhythm,
 * warmth, character names, and age-appropriateness.
 */
import { z } from "zod";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { BookConfig } from "../types";
import { withRetry } from "./retry";
import type { PromptContext } from "../prompts/context";
import { buildStoryTranslatePrompt } from "../prompts/story";

const storyTranslateSchema = z.object({
  title: z.string(),
  story: z.string(),
});

export type StoryTranslateResult = z.infer<typeof storyTranslateSchema>;

export interface TranslateStoryInput {
  config: BookConfig;
  story: string;
  title?: string;
  sourceLocale?: string | null;
  targetLocale?: string | null;
  creds: ProviderCredentials;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

export async function translateStory(input: TranslateStoryInput): Promise<StoryTranslateResult> {
  const { config, story, title, sourceLocale, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);

  const { system, user } = buildStoryTranslatePrompt(
    config,
    story,
    title,
    sourceLocale,
    prompts,
  );

  const result = await withRetry(
    () =>
      provider.generateStructured<StoryTranslateResult>(creds, {
        model,
        schema: storyTranslateSchema,
        schemaName: "story_translate",
        temperature: 0.7,
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
