/**
 * Story analysis: ask the selected text model to extract the subjects
 * (characters, places, objects) that must stay visually consistent across the
 * book. These become "anchors" the user can refine and generate images for.
 */
import { z } from "zod";
import { AGE_RANGES } from "../config/options";
import { getBookLanguage } from "../config/bookLanguages";
import { stripNumericAgeFromDescription } from "../book/anchorDescription";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { Anchor, AnchorImportance, AnchorType, BookConfig } from "../types";
import { withRetry } from "./retry";
import { briefOf, castPromptLines, namedCast } from "../story/brief";
import { resolveAgeLlmGuidance } from "../prompts/age";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";

const anchorItemSchema = z.object({
  name: z.string(),
  type: z.enum(["character", "place", "object"]),
  description: z
    .string()
    .describe(
      "Visible appearance only: face, hair, clothing, colors, and distinguishing features. Never include numeric age; age belongs only in ageYears.",
    ),
  importance: z.enum(["high", "medium", "low"]),
  /** Characters only; ignored for places/objects. */
  bodyPlan: z.enum(["bipedal", "quadruped", "avian", "aquatic", "amorphous"]).nullish(),
  /**
   * Characters only. Nullable on purpose: a confidently wrong height is worse
   * than none, so the model is told to omit it rather than guess.
   */
  heightCm: z.number().nullish(),
  /** Characters only; copied from the author's cast brief when available. */
  ageYears: z
    .number()
    .min(0)
    .max(120)
    .nullish()
    .describe("Character age in years. This is the only numeric age field."),
});

const embeddingItemSchema = z.object({
  container: z.string(),
  subject: z.string(),
});

const analysisSchema = z.object({
  summary: z.string(),
  anchors: z.array(anchorItemSchema),
  embeddings: z.array(embeddingItemSchema).nullish(),
});

/** A private render dependency, still keyed by name until ids are reconciled. */
export interface AnalyzedEmbedding {
  container: string;
  subject: string;
}

export type AnalysisResult = z.infer<typeof analysisSchema>;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function suggestedCharacterAge(
  character: { name: string; description: string; bodyPlan?: string | null },
  ageRangeId: string,
): number {
  const text = `${character.name} ${character.description}`.toLowerCase();
  if (/\b(newborn|infant|baby)\b/.test(text)) return 1;
  if (/\b(toddler|preschooler)\b/.test(text)) return 3;
  if (/\b(teen|teenager|adolescent)\b/.test(text)) return 15;
  if (/\b(grandma|grandmother|grandpa|grandfather|elderly|older adult)\b/.test(text)) return 65;
  if (/\b(mother|mom|mum|father|dad|parent|aunt|uncle|teacher|adult)\b/.test(text)) return 35;
  if (character.bodyPlan && character.bodyPlan !== "bipedal") return 4;
  const range = AGE_RANGES.find((item) => item.id === ageRangeId);
  return range ? Math.round((range.min + range.max) / 2) : 6;
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
 * Reject embedding dependencies the model should not have proposed. Characters
 * never contain another visual reference, nesting stays one level deep, and
 * every name must resolve to an extracted anchor.
 */
function validateEmbeddings(
  raw: { container: string; subject: string }[],
  anchors: Anchor[],
): AnalyzedEmbedding[] {
  const byName = new Map<string, Anchor>();
  for (const a of anchors) byName.set(a.name.trim().toLowerCase(), a);

  const out: AnalyzedEmbedding[] = [];
  const seen = new Set<string>();
  // Tracks accepted containment so a second edge can't create a second level.
  const isContained = new Set<string>();
  const isContainer = new Set<string>();

  for (const r of raw) {
    const from = byName.get(r.container?.trim().toLowerCase() ?? "");
    const to = byName.get(r.subject?.trim().toLowerCase() ?? "");
    if (!from || !to || from.id === to.id) continue;

    // One edge per unordered pair, whichever direction arrives first.
    const key = [from.id, to.id].sort().join("|");
    if (seen.has(key)) continue;

    // A character cannot be a container — its sheet is a turnaround, not a
    // scene. Characters may be embedded in a place/object when the story
    // genuinely calls for a fixed depiction (for example a portrait).
    if (from.type === "character") continue;
    // Depth 2 would mean matching a reference inside a reference.
    if (isContained.has(from.id) || isContainer.has(to.id)) continue;
    isContainer.add(from.id);
    isContained.add(to.id);

    seen.add(key);
    out.push({ container: from.name, subject: to.name });
  }
  return out;
}

/** Run the story analysis and return editable anchors + a short summary. */
export async function analyzeStory(
  input: AnalyzeStoryInput,
): Promise<{ summary: string; anchors: Anchor[]; embeddings: AnalyzedEmbedding[] }> {
  const { story, config, creds, model, signal, prompts } = input;
  const provider = getTextProvider(config.textModel!.provider);
  const age = AGE_RANGES.find((a) => a.id === config.ageRangeId)?.label ?? config.ageRangeId;
  const language = getBookLanguage(config.contentLocale);
  const ageTextPrompt = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);
  // A co-written story was built from real people the author already described.
  // Handing those facts back saves the model from re-inferring ages and family
  // links from prose — the two things it most often gets wrong here.
  const castHints = castPromptLines(briefOf(config));

  const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "storyAnalysis", {
    vars: {
      age,
      ageGuidance: ageTextPrompt,
      languageName: language.englishName,
      story: story.trim(),
      castHints,
    },
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

  const knownAges = new Map(
    namedCast(briefOf(config))
      .filter((member) => member.age !== undefined)
      .map((member) => [member.name.trim().toLowerCase(), member.age!]),
  );
  const anchors: Anchor[] = result.anchors.map((a) => {
    const isCharacter = a.type === "character";
    // Body plan and height only mean anything for characters; a model that
    // fills them in for a place or object is answering a question we didn't
    // ask, so drop them rather than letting them reach the sheet prompt.
    const height = isCharacter && typeof a.heightCm === "number" ? a.heightCm : undefined;
    const briefAge = knownAges.get(a.name.trim().toLowerCase());
    const reportedAge =
      isCharacter && typeof briefAge === "number"
        ? briefAge
        : isCharacter && typeof a.ageYears === "number"
          ? a.ageYears
          : undefined;
    const characterAge = isCharacter
      ? (reportedAge ?? suggestedCharacterAge(a, config.ageRangeId))
      : undefined;
    const ageSource =
      typeof briefAge === "number"
        ? "author"
        : typeof a.ageYears === "number"
          ? "story"
          : "suggested";
    return {
      id: uid(),
      name: a.name,
      source: "analysis",
      type: a.type as AnchorType,
      description: isCharacter
        ? stripNumericAgeFromDescription(a.description)
        : a.description,
      importance: a.importance as AnchorImportance,
      mode: "creative",
      include: true,
      ...(characterAge !== undefined ? { ageYears: characterAge, ageSource } : {}),
      ...(isCharacter && a.bodyPlan ? { bodyPlan: a.bodyPlan } : {}),
      ...(height && height > 0 ? { heightCm: Math.round(height) } : {}),
    } satisfies Anchor;
  });

  return {
    summary: result.summary,
    anchors,
    embeddings: validateEmbeddings(result.embeddings ?? [], anchors),
  };
}

export interface GenerateAnchorDescriptionInput {
  story: string;
  config: BookConfig;
  creds: ProviderCredentials;
  model: string;
  name: string;
  type: AnchorType;
  /** Other known subjects, so names and visual descriptions stay consistent. */
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
  const language = getBookLanguage(config.contentLocale);
  const ageTextPrompt = resolveAgeLlmGuidance(config.ageRangeId, config.readingModeId, prompts);

  const others =
    existingAnchors
      .filter((a) => a.name.trim())
      .map((a) => `- ${a.name} [${a.type}]: ${a.description}`)
      .join("\n") || "(none)";

  const { system, user } = renderTextPrompt(resolvePromptsConfig(prompts), "anchorDescription", {
    vars: {
      type,
      name,
      age,
      ageGuidance: ageTextPrompt,
      languageName: language.englishName,
      others,
      story: story.trim(),
    },
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
  const description = res.text.trim();
  return type === "character"
    ? stripNumericAgeFromDescription(description)
    : description;
}
