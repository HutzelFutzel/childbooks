/**
 * Story analysis: ask the selected text model to extract the subjects
 * (characters, places, objects) that must stay visually consistent across the
 * book. These become "anchors" the user can refine and generate images for.
 */
import { z } from "zod";
import { AGE_RANGES } from "../config/options";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Anchor, AnchorImportance, AnchorType, BookConfig } from "../types";
import { withRetry } from "./retry";
import { resolveAgeLlmGuidance } from "../prompts/age";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";

const anchorItemSchema = z.object({
  name: z.string(),
  type: z.enum(["character", "place", "object"]),
  description: z.string(),
  importance: z.enum(["high", "medium", "low"]),
});

const analysisSchema = z.object({
  summary: z.string(),
  anchors: z.array(anchorItemSchema),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface AnalyzeStoryInput {
  story: string;
  config: BookConfig;
  creds: ProviderCredentials;
  model: string;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/** Run the story analysis and return editable anchors + a short summary. */
export async function analyzeStory(
  input: AnalyzeStoryInput,
): Promise<{ summary: string; anchors: Anchor[] }> {
  const { story, config, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const age = AGE_RANGES.find((a) => a.id === config.ageRangeId)?.label ?? config.ageRangeId;
  const ageTextPrompt = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);

  const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "storyAnalysis", {
    vars: { age, ageGuidance: ageTextPrompt, story: story.trim() },
  });

  const result = await withRetry(
    () =>
      provider.generateStructured<AnalysisResult>(creds, {
        model,
        schema: analysisSchema,
        schemaName: "story_analysis",
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal,
      }),
    { signal },
  );

  const anchors: Anchor[] = result.anchors.map((a) => ({
    id: uid(),
    name: a.name,
    type: a.type as AnchorType,
    description: a.description,
    importance: a.importance as AnchorImportance,
    mode: "creative",
    include: true,
  }));

  return { summary: result.summary, anchors };
}

export interface GenerateAnchorDescriptionInput {
  story: string;
  config: BookConfig;
  creds: ProviderCredentials;
  model: string;
  name: string;
  type: AnchorType;
  /** Other known subjects, so the description can reference relationships. */
  existingAnchors: { name: string; type: AnchorType; description: string }[];
  signal?: AbortSignal;
  prompts?: PromptContext;
}

/**
 * Suggest a single anchor's visual description from the story (used by the
 * "Suggest from story" button when a user adds a new character/place/object).
 */
export async function generateAnchorDescription(
  input: GenerateAnchorDescriptionInput,
): Promise<string> {
  const { story, config, creds, model, name, type, existingAnchors, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const age = AGE_RANGES.find((a) => a.id === config.ageRangeId)?.label ?? config.ageRangeId;
  const ageTextPrompt = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);

  const others =
    existingAnchors
      .filter((a) => a.name.trim())
      .map((a) => `- ${a.name} [${a.type}]: ${a.description}`)
      .join("\n") || "(none)";

  const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "anchorDescription", {
    vars: { type, name, age, ageGuidance: ageTextPrompt, others, story: story.trim() },
  });

  const res = await withRetry(
    () =>
      provider.generateText(creds, {
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal,
      }),
    { signal },
  );
  return res.text.trim();
}
