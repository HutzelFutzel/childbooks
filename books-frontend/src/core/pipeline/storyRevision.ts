import { getTextProvider } from "../providers";
import type { ProviderCredentials, TextMessage } from "../providers/types";
import type { BookConfig } from "../types";
import type { ProviderId } from "../config/options";
import { ProviderError } from "../errors";
import type { PromptContext } from "../prompts/context";
import { buildStoryRevisionPrompt } from "../prompts/story";
import {
  storyRevisionModelSchema,
  validateStoryRevision,
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
          `Reason: ${repair.slice(0, 500)}`,
          "Return a corrected patch now. Copy every `before` value exactly from the manuscript, include a non-empty unique anchor for insertions, keep replacements independent and non-overlapping, and include `summary`, `before`, `after`, and `reason` using exactly those field names.",
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
      throw new StoryRevisionFormatError(details);
    }

    try {
      return validateStoryRevision(story, result, selection);
    } catch (err) {
      const details = (err as Error)?.message ?? "The patch was not applicable.";
      if (attempt === 0) {
        repair = details;
        continue;
      }
      throw new StoryRevisionFormatError(details);
    }
  }

  throw new StoryRevisionFormatError();
}
