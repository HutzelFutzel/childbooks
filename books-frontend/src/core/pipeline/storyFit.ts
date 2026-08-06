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
});

export type StoryFit = z.infer<typeof storyFitSchema>;

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
  const { system, user } = buildStoryFitPrompt(config, story, wordCount(story), prompts);

  const result = await withRetry(
    () =>
      provider.generateStructured<StoryFit>(creds, {
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

  return {
    verdict: result.verdict,
    headline: result.headline.trim(),
    notes: result.notes.map((n) => n.trim()).filter(Boolean).slice(0, 3),
  };
}
