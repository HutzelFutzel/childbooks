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
import { briefOf, castPromptLines } from "../story/brief";
import { resolveAgeLlmGuidance } from "../prompts/age";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";

const anchorItemSchema = z.object({
  name: z.string(),
  type: z.enum(["character", "place", "object"]),
  description: z.string(),
  importance: z.enum(["high", "medium", "low"]),
  /** Characters only; ignored for places/objects. */
  bodyPlan: z.enum(["bipedal", "quadruped", "avian", "aquatic", "amorphous"]).nullish(),
  /**
   * Characters only. Nullable on purpose: a confidently wrong height is worse
   * than none, so the model is told to omit it rather than guess.
   */
  heightCm: z.number().nullish(),
});

const relationItemSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["contains", "relates"]),
  note: z.string().nullish(),
});

const analysisSchema = z.object({
  summary: z.string(),
  anchors: z.array(anchorItemSchema),
  relations: z.array(relationItemSchema).nullish(),
});

/** A proposed relation, still keyed by anchor NAME as the model reported it. */
export interface AnalyzedRelation {
  from: string;
  to: string;
  kind: "contains" | "relates";
  note?: string;
}

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

/**
 * Reject relations the model shouldn't have proposed, rather than trusting the
 * output. The rules mirror what the relations editor enforces by hand: a
 * character is never *contained* in anything, containment nests only one level
 * deep, and nothing links to itself or to a subject that doesn't exist.
 */
function validateRelations(
  raw: { from: string; to: string; kind: "contains" | "relates"; note?: string | null }[],
  anchors: Anchor[],
): AnalyzedRelation[] {
  const byName = new Map<string, Anchor>();
  for (const a of anchors) byName.set(a.name.trim().toLowerCase(), a);

  const out: AnalyzedRelation[] = [];
  const seen = new Set<string>();
  // Tracks accepted containment so a second edge can't create a second level.
  const isContained = new Set<string>();
  const isContainer = new Set<string>();

  for (const r of raw) {
    const from = byName.get(r.from?.trim().toLowerCase() ?? "");
    const to = byName.get(r.to?.trim().toLowerCase() ?? "");
    if (!from || !to || from.id === to.id) continue;

    // One edge per unordered pair, whichever direction arrives first.
    const key = [from.id, to.id].sort().join("|");
    if (seen.has(key)) continue;

    if (r.kind === "contains") {
      // A character can neither be drawn inside something nor act as a
      // container — its sheet is a turnaround, not a scene.
      if (from.type === "character" || to.type === "character") continue;
      // Depth 2 would mean matching a reference inside a reference.
      if (isContained.has(from.id) || isContainer.has(to.id)) continue;
      isContainer.add(from.id);
      isContained.add(to.id);
    }

    seen.add(key);
    out.push({
      from: from.name,
      to: to.name,
      kind: r.kind,
      ...(r.note?.trim() ? { note: r.note.trim() } : {}),
    });
  }
  return out;
}

/** Run the story analysis and return editable anchors + a short summary. */
export async function analyzeStory(
  input: AnalyzeStoryInput,
): Promise<{ summary: string; anchors: Anchor[]; relations: AnalyzedRelation[] }> {
  const { story, config, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const age = AGE_RANGES.find((a) => a.id === config.ageRangeId)?.label ?? config.ageRangeId;
  const ageTextPrompt = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);
  // A co-written story was built from real people the author already described.
  // Handing those facts back saves the model from re-inferring ages and family
  // links from prose — the two things it most often gets wrong here.
  const castHints = castPromptLines(briefOf(config));

  const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "storyAnalysis", {
    vars: { age, ageGuidance: ageTextPrompt, story: story.trim(), castHints },
    flags: { hasCastHints: config.storyBrief?.mode === "co-write" && castHints.length > 0 },
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

  const anchors: Anchor[] = result.anchors.map((a) => {
    const isCharacter = a.type === "character";
    // Body plan and height only mean anything for characters; a model that
    // fills them in for a place or object is answering a question we didn't
    // ask, so drop them rather than letting them reach the sheet prompt.
    const height = isCharacter && typeof a.heightCm === "number" ? a.heightCm : undefined;
    return {
      id: uid(),
      name: a.name,
      type: a.type as AnchorType,
      description: a.description,
      importance: a.importance as AnchorImportance,
      mode: "creative",
      include: true,
      ...(isCharacter && a.bodyPlan ? { bodyPlan: a.bodyPlan } : {}),
      ...(height && height > 0 ? { heightCm: Math.round(height) } : {}),
    } satisfies Anchor;
  });

  return {
    summary: result.summary,
    anchors,
    relations: validateRelations(result.relations ?? [], anchors),
  };
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
