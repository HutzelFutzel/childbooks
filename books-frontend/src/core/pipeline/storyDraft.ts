/**
 * Story draft: turns a {@link StoryBrief} into a complete first story the
 * author can edit. Two shapes of input share this one pipeline —
 *   - `guided`   — one name plus a theme, the fastest path to a real book;
 *   - `co-write` — the real cast, occasion, when and where.
 * The `own` mode never comes here; it goes to `storyFit` for an advisory read.
 *
 * Age-appropriateness is enforced from two sides: the age band's Story-craft
 * rules go into the prompt, and the returned draft is checked against them,
 * with one repair retry when it misses.
 */
import { z } from "zod";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { BookConfig, StoryBrief } from "../types";
import { withRetry } from "./retry";
import type { PromptContext } from "../prompts/context";
import { buildStoryDraftPrompt } from "../prompts/story";
import { inspectDraft, issueScore } from "./storyValidate";
import { restoreModelLineBreaks } from "../story/lineBreaks";

const storyDraftSchema = z.object({
  title: z.string(),
  story: z.string(),
  subtitles: z.array(z.string()).optional(),
});

export type StoryDraft = z.infer<typeof storyDraftSchema>;

/** At most three distinct, short subtitle ideas, none repeating the title. */
export function cleanSubtitleIdeas(ideas: readonly string[] | undefined, title: string): string[] {
  const key = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const seen = new Set([key(title)]);
  const out: string[] = [];
  for (const raw of ideas ?? []) {
    const idea = raw.trim().replace(/^["'“”„«»]+|["'“”„«»]+$/g, "").trim();
    if (!idea || idea.length > 80 || seen.has(key(idea))) continue;
    seen.add(key(idea));
    out.push(idea);
    if (out.length === 3) break;
  }
  return out;
}

export interface GenerateStoryDraftInput {
  brief: StoryBrief;
  config: BookConfig;
  creds: ProviderCredentials;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/** Write a complete story (+ title) from the brief. */
export async function generateStoryDraft(input: GenerateStoryDraftInput): Promise<StoryDraft> {
  const { brief, config, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);

  const write = async (repairInstruction?: string): Promise<StoryDraft> => {
    const { system, user } = buildStoryDraftPrompt(config, brief, prompts, repairInstruction);
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
    const title = result.title.trim();
    return {
      title,
      story: restoreModelLineBreaks(result.story).trim(),
      subtitles: cleanSubtitleIdeas(result.subtitles, title),
    };
  };

  const { craft } = buildStoryDraftPrompt(config, brief, prompts);
  const first = await write();
  const firstIssues = inspectDraft(first.story, brief, craft.structure, config.contentLocale);
  if (!firstIssues.repairInstruction) return first;

  // One repair pass, then keep whichever attempt is closer to the rules — a
  // second miss is still a perfectly readable story, and a third call would
  // cost more than the difference is worth.
  const second = await write(firstIssues.repairInstruction);
  const secondIssues = inspectDraft(second.story, brief, craft.structure, config.contentLocale);
  return issueScore(secondIssues) <= issueScore(firstIssues) ? second : first;
}
