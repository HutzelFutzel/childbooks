/**
 * Admin overlay for story-craft settings (`appConfig/storyCraft`).
 *
 * Structure and built-in defaults live in `storyCraftCatalog`; this document
 * stores admin overrides per age band. Curated LISTS (themes, devices,
 * settings) are replaced wholesale when overridden — an admin curating "what
 * themes exist for 3–5" wants exactly the list they typed, not a merge with a
 * shipped list they can't see. Rule OBJECTS (structure, protagonist, safety)
 * merge field by field so a single tweak doesn't require restating the rest.
 */
import { z } from "zod";
import type { AgeBandId } from "./ageWritingCatalog";
import {
  DEFAULT_STORY_CRAFT,
  defaultStoryCraft,
  type AgeBandStoryCraft,
  type ProtagonistRules,
  type StoryOption,
  type StorySafetyRules,
  type StoryStructureRules,
} from "./storyCraftCatalog";

const storyOptionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  description: z.string().max(400),
  llmGuidance: z.string().max(2000),
});

const structureSchema = z.object({
  minWords: z.number().int().min(10).max(20000),
  maxWords: z.number().int().min(10).max(20000),
  beats: z.number().int().min(1).max(40),
  maxSentenceWords: z.number().int().min(0).max(200),
});

const protagonistSchema = z.object({
  minAge: z.number().int().min(0).max(30),
  maxAge: z.number().int().min(0).max(30),
  guidance: z.string().max(1000),
});

const safetySchema = z.object({
  avoid: z.array(z.string().min(1).max(300)).max(60),
  note: z.string().max(1000),
});

const bandSchema = z.object({
  themes: z.array(storyOptionSchema).max(40).optional(),
  devices: z.array(storyOptionSchema).max(40).optional(),
  settings: z.array(storyOptionSchema).max(40).optional(),
  structure: structureSchema.optional(),
  protagonist: protagonistSchema.optional(),
  safety: safetySchema.optional(),
});

export type AgeBandStoryCraftOverride = z.infer<typeof bandSchema>;

export interface StoryCraftConfig {
  version: 1;
  /** Partial overrides keyed by AGE_RANGES[].id. */
  bands: Partial<Record<AgeBandId, AgeBandStoryCraftOverride>>;
  updatedAt?: number;
}

export const storyCraftConfigSchema = z.object({
  version: z.literal(1),
  bands: z.record(z.string(), bandSchema),
  updatedAt: z.number().optional(),
});

export function createDefaultStoryCraftConfig(): StoryCraftConfig {
  return { version: 1, bands: {} };
}

export function normalizeStoryCraftConfig(input: unknown): StoryCraftConfig {
  const stored = (input ?? {}) as Record<string, unknown>;
  const rawBands = (stored.bands ?? {}) as Record<string, unknown>;
  const bands: StoryCraftConfig["bands"] = {};
  for (const id of Object.keys(DEFAULT_STORY_CRAFT) as AgeBandId[]) {
    const parsed = bandSchema.safeParse(rawBands[id]);
    // Drop unparseable/unknown bands rather than letting a bad doc break the
    // studio — the shipped catalog is always a working fallback.
    if (parsed.success) bands[id] = parsed.data;
  }
  return {
    version: 1,
    bands,
    ...(typeof stored.updatedAt === "number" ? { updatedAt: stored.updatedAt } : {}),
  };
}

function mergeStructure(
  base: StoryStructureRules,
  over?: StoryStructureRules,
): StoryStructureRules {
  if (!over) return base;
  // A max below the min would make every draft fail validation, so keep them ordered.
  const minWords = Math.min(over.minWords, over.maxWords);
  const maxWords = Math.max(over.minWords, over.maxWords);
  return { ...base, ...over, minWords, maxWords };
}

function mergeProtagonist(base: ProtagonistRules, over?: ProtagonistRules): ProtagonistRules {
  if (!over) return base;
  return {
    ...base,
    ...over,
    minAge: Math.min(over.minAge, over.maxAge),
    maxAge: Math.max(over.minAge, over.maxAge),
    guidance: over.guidance.trim() || base.guidance,
  };
}

function mergeSafety(base: StorySafetyRules, over?: StorySafetyRules): StorySafetyRules {
  if (!over) return base;
  return {
    avoid: over.avoid.length > 0 ? over.avoid : base.avoid,
    note: over.note.trim() || base.note,
  };
}

function mergeList(base: StoryOption[], over?: StoryOption[]): StoryOption[] {
  return over && over.length > 0 ? over : base;
}

/** Merge catalog defaults with optional Firestore overrides. */
export function resolveStoryCraft(
  ageRangeId: string,
  config?: StoryCraftConfig | null,
): AgeBandStoryCraft {
  const base = defaultStoryCraft(ageRangeId);
  const over = config?.bands?.[ageRangeId as AgeBandId];
  if (!over) return base;
  return {
    themes: mergeList(base.themes, over.themes),
    devices: mergeList(base.devices, over.devices),
    settings: mergeList(base.settings, over.settings),
    structure: mergeStructure(base.structure, over.structure),
    protagonist: mergeProtagonist(base.protagonist, over.protagonist),
    safety: mergeSafety(base.safety, over.safety),
  };
}

/**
 * The guidance for chosen option(s): catalog entries' `llmGuidance` joined together,
 * plus the user's custom free text if provided. Returns "" when neither is set.
 */
export function optionsGuidance(
  options: StoryOption[],
  ids: string[] | string | undefined | null,
  custom: string | undefined,
): string {
  const idList = Array.isArray(ids) ? ids : ids ? [ids] : [];
  const parts: string[] = [];
  for (const id of idList) {
    const found = options.find((o) => o.id === id);
    if (found?.llmGuidance.trim()) {
      parts.push(found.llmGuidance.trim());
    }
  }
  const custom_ = custom?.trim();
  if (custom_) {
    parts.push(custom_);
  }
  return parts.join("; ");
}

/**
 * The guidance for a chosen option: the catalog entry's `llmGuidance` when the
 * id is known, otherwise the user's own free text. Returns "" when neither is
 * set, so the prompt block simply doesn't render.
 */
export function optionGuidance(
  options: StoryOption[],
  id: string | undefined,
  custom: string | undefined,
): string {
  return optionsGuidance(options, id, custom);
}

/** The human labels for chosen option(s) (for summaries and chips). */
export function optionsLabels(
  options: StoryOption[],
  ids: string[] | string | undefined | null,
  custom: string | undefined,
): string[] {
  const idList = Array.isArray(ids) ? ids : ids ? [ids] : [];
  const labels: string[] = [];
  for (const id of idList) {
    const found = options.find((o) => o.id === id);
    if (found?.label) labels.push(found.label);
  }
  if (custom?.trim()) labels.push(custom.trim());
  return labels;
}

/** The human label for a chosen option (for summaries and chips). */
export function optionLabel(
  options: StoryOption[],
  id: string | undefined,
  custom: string | undefined,
): string {
  if (id) {
    const found = options.find((o) => o.id === id);
    if (found) return found.label;
  }
  return custom?.trim() ?? "";
}
