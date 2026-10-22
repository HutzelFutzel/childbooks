/**
 * Story translation & cultural adaptation: translates an existing story and
 * optional title and subtitle into the selected target language while
 * preserving rhythm, warmth, character names, and age-appropriateness.
 */
import { z } from "zod";
import { getBookLanguage } from "../config/bookLanguages";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Anchor, BookConfig } from "../types";
import { castOf, knownNameKeys, knownNameLines, validNamePairs, type NamePair } from "../book/anchorIdentity";
import { withRetry } from "./retry";
import type { PromptContext } from "../prompts/context";
import { buildStoryTranslatePrompt } from "../prompts/story";
import { restoreModelLineBreaks } from "../story/lineBreaks";
import { inspectTranslation, translationIssueScore } from "./storyValidate";

const storyTranslateSchema = z.object({
  title: z.string(),
  /** Empty when the book had no subtitle. */
  subtitle: z.string(),
  story: z.string(),
  /**
   * Everything from the book's list of names that the story now says differently,
   * so the same person, place or thing is found again under its new words.
   */
  names: z.array(z.object({ from: z.string(), to: z.string() })).nullish(),
});

export interface StoryTranslateResult {
  title: string;
  subtitle: string;
  story: string;
  /** The renames the translation reports, each from a name the book has. */
  names: NamePair[];
}

export interface TranslateStoryInput {
  config: BookConfig;
  story: string;
  title?: string;
  subtitle?: string;
  /** The book's people, places and things, so the translation can say how it renamed them. */
  anchors?: Anchor[];
  sourceLocale?: string | null;
  targetLocale?: string | null;
  creds: ProviderCredentials;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

export async function translateStory(input: TranslateStoryInput): Promise<StoryTranslateResult> {
  const { config, story, title, subtitle, sourceLocale, targetLocale, creds, model, signal, prompts, anchors } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const cast = castOf(config);
  const known = knownNameLines(anchors, cast);
  const knownKeys = known ? knownNameKeys(anchors, cast) : null;
  const targetLang = getBookLanguage(targetLocale ?? config.contentLocale);
  const sourceLang = getBookLanguage(sourceLocale);
  const effectiveConfig = targetLocale ? { ...config, contentLocale: targetLang.id } : config;

  const write = async (repairInstruction?: string): Promise<StoryTranslateResult> => {
    const { system, user } = buildStoryTranslatePrompt(
      effectiveConfig,
      story,
      title,
      sourceLocale,
      prompts,
      subtitle,
      known,
      repairInstruction,
    );

    const result = await withRetry(
      () =>
        provider.generateStructured<z.infer<typeof storyTranslateSchema>>(creds, {
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

    return {
      title: result.title.trim(),
      // A model that ignores the subtitle (an older prompt override) returns none, never the old words.
      subtitle: (result.subtitle ?? "").trim(),
      story: restoreModelLineBreaks(result.story).trim(),
      names: knownKeys ? validNamePairs(result.names, knownKeys) : [],
    };
  };

  const { craft } = buildStoryTranslatePrompt(effectiveConfig, story, title, sourceLocale, prompts, subtitle, known);
  const checkLength = Boolean(config.storyBrief) && config.storyBrief?.mode !== "own";
  const sameLanguage = Boolean(sourceLocale) && sourceLang.id.slice(0, 2) === targetLang.id.slice(0, 2);
  const first = await write();
  const firstIssues = inspectTranslation({
    sourceStory: story,
    translatedStory: first.story,
    structure: craft.structure,
    checkLength,
    wordCountFactor: targetLang.wordCountFactor,
    sameLanguage,
  });
  if (!firstIssues.repairInstruction) return first;

  // One repair pass when the translation broke verse stanzas, drifted far past the age band's length
  // or sentence ceiling, or came back untranslated; then keep whichever attempt is closer to the rules.
  const second = await write(firstIssues.repairInstruction);
  const secondIssues = inspectTranslation({
    sourceStory: story,
    translatedStory: second.story,
    structure: craft.structure,
    checkLength,
    wordCountFactor: targetLang.wordCountFactor,
    sameLanguage,
  });
  return translationIssueScore(secondIssues) <= translationIssueScore(firstIssues) ? second : first;
}
