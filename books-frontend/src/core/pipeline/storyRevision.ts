import { z } from "zod";
import { getTextProvider } from "../providers";
import type { ProviderCredentials, TextMessage } from "../providers/types";
import type { BookConfig } from "../types";
import type { ProviderId } from "../config/options";
import { ProviderError } from "../errors";
import type { PromptContext } from "../prompts/context";
import { buildStoryRevisionPrompt, buildStoryRewritePrompt } from "../prompts/story";
import {
  assessStoryRevision,
  isOutsideSelectionFailure,
  proposalFromRewrite,
  storyRevisionModelSchema,
  StoryRevisionScopeError,
  type StoryRevisionChange,
  type StoryRevisionProposal,
  type StoryRevisionSelection,
} from "../story/revision";
import { withRetry } from "./retry";

export interface ReviseStoryInput {
  config: BookConfig;
  story: string;
  instruction: string;
  selection?: StoryRevisionSelection;
  creds: ProviderCredentials;
  provider: ProviderId;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

export class StoryRevisionFormatError extends Error {
  constructor(public readonly details?: string) {
    super(
      "We couldn’t prepare a clean set of changes. Try a more specific request, such as what to add and where.",
    );
    this.name = "StoryRevisionFormatError";
  }
}

const rewriteSchema = z.object({
  summary: z.string().optional().default("Reworked the story."),
  story: z.string(),
});

export async function reviseStory(input: ReviseStoryInput): Promise<StoryRevisionProposal> {
  const { config, story, instruction, selection, creds, provider, model, signal, prompts } = input;
  const textProvider = getTextProvider(provider);
  const { system, user } = buildStoryRevisionPrompt(
    config,
    story,
    instruction,
    selection,
    prompts,
  );

  let repair = "";
  let kept: StoryRevisionChange[] = [];
  let summary = "Prepared the requested story changes.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages: TextMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    if (repair) {
      messages.push({
        role: "user",
        content: [
          "Your previous patch could not be applied.",
          `Reason: ${repair.slice(0, 800)}`,
          "Return a corrected patch now. Copy every `before` value exactly from the manuscript (from inside the selected passage, when one was given), include a non-empty unique anchor for insertions, keep replacements independent and non-overlapping, and include `summary`, `before`, `after`, and `reason` using exactly those field names.",
          kept.length > 0
            ? "Return replacements only for what failed. Do not repeat a before that already matched."
            : "For new or substantially expanded prose, use short semantic paragraphs separated by blank lines. Do not hard-wrap lines.",
        ].join("\n"),
      });
    }

    let result;
    try {
      result = await withRetry(
        () =>
          textProvider.generateStructured(creds, {
            model,
            schema: storyRevisionModelSchema,
            schemaName: "story_revision",
            temperature: attempt === 0 ? 0.35 : 0.2,
            messages,
            signal,
          }),
        { retries: 1, signal },
      );
    } catch (err) {
      if (!(err instanceof ProviderError) || err.kind !== "parse") throw err;
      const details = err.details ?? err.message;
      if (attempt === 0) {
        repair = details;
        continue;
      }
      if (kept.length > 0) return { summary, changes: renumber(kept) };
      throw new StoryRevisionFormatError(details);
    }

    const assessed = assessStoryRevision(story, result, selection, kept);
    if (assessed.summary) summary = assessed.summary;
    kept = renumber([...kept, ...assessed.changes]);
    if (assessed.scopeError && kept.length === 0) throw new StoryRevisionScopeError();
    if (assessed.problems.length === 0 && kept.length > 0) return { summary, changes: kept };
    if (attempt === 0) {
      repair = repairFor(assessed.problems, kept);
      continue;
    }
    if (selection && assessed.problems.some(isOutsideSelectionFailure) && kept.length === 0) {
      throw new StoryRevisionScopeError();
    }
    if (kept.length > 0) return { summary, changes: kept };
    throw new StoryRevisionFormatError(assessed.problems[0] ?? "The patch was not applicable.");
  }

  if (kept.length > 0) return { summary, changes: renumber(kept) };
  throw new StoryRevisionFormatError();
}

/**
 * A whole-manuscript change (rhyme, simpler, shorter) written as one story,
 * then split into review hunks here. The model does not have to copy the
 * manuscript back exactly, which is what made those requests run twice.
 */
export async function rewriteStory(input: ReviseStoryInput): Promise<StoryRevisionProposal> {
  const { config, story, instruction, creds, provider, model, signal, prompts } = input;
  const textProvider = getTextProvider(provider);
  const { system, user } = buildStoryRewritePrompt(config, story, instruction, prompts);
  const result = await withRetry(
    () =>
      textProvider.generateStructured(creds, {
        model,
        schema: rewriteSchema,
        schemaName: "story_rewrite",
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal,
      }),
    { retries: 1, signal },
  );
  try {
    return proposalFromRewrite(story, result.story, result.summary);
  } catch (err) {
    throw new StoryRevisionFormatError((err as Error)?.message);
  }
}

function renumber(changes: StoryRevisionChange[]): StoryRevisionChange[] {
  return [...changes]
    .sort((a, b) => (a.baseStart ?? 0) - (b.baseStart ?? 0))
    .map((change, index) => ({ ...change, id: `change-${index + 1}` }));
}

function repairFor(problems: string[], kept: StoryRevisionChange[]): string {
  const lines = [...problems];
  if (kept.length > 0) {
    lines.push("These replacements already match. Do not repeat them:");
    for (const change of kept.slice(0, 8)) lines.push(`- ${JSON.stringify(change.before.slice(0, 140))}`);
  }
  return lines.join("\n");
}
