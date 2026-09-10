/**
 * Admin overlay for audience profiles (`appConfig/audience`).
 *
 * Unlike the other creative configs, this document may contain profiles the
 * code has never heard of: adding an age band is a dashboard action. So the
 * merge runs in three passes —
 *
 *   1. shipped defaults keyed by id,
 *   2. a stored profile of the same id merged FIELD BY FIELD over its default,
 *   3. wholly new profiles taken as-is.
 *
 * …then `extendsId` inheritance is applied over the result, so a band can be
 * defined as "the one above, but with a different calibration" instead of a
 * second copy of the same brief.
 *
 * Resolution is deliberately total: {@link resolveAudienceProfile} always
 * returns a usable profile. An unknown id resolves through aliases, then
 * month-range containment, then the fallback band — a book made before a band
 * was renamed must never fail to generate.
 */
import { z } from "zod";
import {
  DEFAULT_AUDIENCE_PROFILES,
  DIMENSION_IDS,
  EDITORIAL_DIMENSIONS,
  FALLBACK_PROFILE_ID,
  GUARDRAIL_SECTIONS,
  MANDATORY_AVOID,
  SECTION_IDS,
  type AudienceDensity,
  type AudienceDimension,
  type AudienceProfile,
  type AudienceProtagonist,
  type AudienceSafety,
  type AudienceStructure,
  type ModeGuidance,
  type ModeKey,
} from "./audienceCatalog";
import { READING_MODE_IDS, type ReadingModeId } from "./readingModes";
import { ageWritingAsAudienceOverrides, type AgeWritingConfig } from "./ageWriting";
import { storyCraftRuleOverrides, type StoryCraftConfig } from "./storyCraft";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const modeGuidanceSchema = z.object({
  humanGuidance: z.string().max(4000),
  storyGuidance: z.string().max(8000),
});

const dimensionSchema = z.object({
  level: z.number().int().min(0).max(20),
  guidance: z.string().max(2000),
});

const structureSchema = z.object({
  minWords: z.number().int().min(1).max(20000),
  maxWords: z.number().int().min(1).max(20000),
  beats: z.number().int().min(1).max(40),
  maxSentenceWords: z.number().int().min(0).max(200),
  plotRequired: z.boolean(),
});

const densitySchema = z.object({
  targetWordsPerPage: z.number().int().min(0).max(2000),
  maxWordsPerPage: z.number().int().min(0).max(4000),
  targetSentencesPerPage: z.number().int().min(0).max(50),
  maxFocalCharactersPerScene: z.number().int().min(1).max(20),
  minPages: z.number().int().min(1).max(400),
  maxPages: z.number().int().min(1).max(400),
});

const protagonistSchema = z.object({
  minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120),
  guidance: z.string().max(1000),
});

const safetySchema = z.object({
  avoid: z.array(z.string().min(1).max(300)).max(60),
  note: z.string().max(1000),
});

/**
 * Every field is optional so a stored profile can carry a single overridden
 * value; `id` is the only thing that must be there, because it's the join key.
 */
const profileSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens."),
  label: z.string().max(80).optional(),
  caption: z.string().max(60).optional(),
  description: z.string().max(400).optional(),
  minMonths: z.number().int().min(0).max(1200).optional(),
  maxMonths: z.number().int().min(0).max(1200).optional(),
  order: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
  aliases: z.array(z.string().min(1).max(40)).max(20).optional(),
  extendsId: z.string().max(40).optional(),
  readingModes: z.array(z.enum(["read-aloud", "with-help", "independent"])).max(3).optional(),
  modes: z.record(z.string(), modeGuidanceSchema).optional(),
  sections: z.record(z.string(), z.string().max(20000)).optional(),
  dimensions: z.record(z.string(), dimensionSchema).optional(),
  structure: structureSchema.optional(),
  density: densitySchema.optional(),
  protagonist: protagonistSchema.optional(),
  defaultCharacterAgeYears: z.number().int().min(0).max(120).optional(),
  safety: safetySchema.optional(),
  evaluatedDimensionIds: z.array(z.string().min(1).max(60)).max(30).optional(),
});

export type AudienceProfileOverride = z.infer<typeof profileSchema>;

export const audienceConfigSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema).max(40),
  updatedAt: z.number().optional(),
  /** Bumped on every save, so generated content can record what it was made under. */
  revision: z.number().int().min(0).optional(),
});

export interface AudienceConfig {
  version: 1;
  profiles: AudienceProfileOverride[];
  updatedAt?: number;
  revision?: number;
}

export function createDefaultAudienceConfig(): AudienceConfig {
  return { version: 1, profiles: [], revision: 0 };
}

export function normalizeAudienceConfig(input: unknown): AudienceConfig {
  const stored = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(stored.profiles) ? stored.profiles : [];
  const profiles: AudienceProfileOverride[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = profileSchema.safeParse(entry);
    // Drop an unparseable profile rather than letting one bad row take the
    // studio down — the shipped catalog is always a working fallback.
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    profiles.push(parsed.data);
  }
  return {
    version: 1,
    profiles,
    ...(typeof stored.updatedAt === "number" ? { updatedAt: stored.updatedAt } : {}),
    revision: typeof stored.revision === "number" ? stored.revision : 0,
  };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeModes(
  base: Partial<Record<ModeKey, ModeGuidance>>,
  over?: Record<string, ModeGuidance>,
): Partial<Record<ModeKey, ModeGuidance>> {
  if (!over) return base;
  const out: Partial<Record<ModeKey, ModeGuidance>> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (key !== "default" && !READING_MODE_IDS.includes(key as ReadingModeId)) continue;
    const prev = out[key as ModeKey];
    out[key as ModeKey] = {
      humanGuidance: value.humanGuidance.trim() || prev?.humanGuidance || "",
      storyGuidance: value.storyGuidance.trim() || prev?.storyGuidance || "",
    };
  }
  return out;
}

/**
 * Sections and dimensions merge per KEY rather than wholesale: an admin editing
 * the calibration of one band expects the other twelve sections to stay put.
 * A key explicitly set to an empty string is an intentional deletion and is
 * kept as empty (the compiler then omits it), which is how a band opts out of
 * an inherited section.
 */
function mergeSections(base: Record<string, string>, over?: Record<string, string>) {
  if (!over) return base;
  const out = { ...base };
  for (const [id, text] of Object.entries(over)) {
    if (!SECTION_IDS.includes(id)) continue;
    out[id] = text;
  }
  return out;
}

function mergeDimensions(
  base: Record<string, AudienceDimension>,
  over?: Record<string, AudienceDimension>,
) {
  if (!over) return base;
  const out = { ...base };
  for (const [id, value] of Object.entries(over)) {
    if (!DIMENSION_IDS.includes(id)) continue;
    out[id] = value;
  }
  return out;
}

function orderedPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function mergeStructure(base: AudienceStructure, over?: AudienceStructure): AudienceStructure {
  if (!over) return base;
  const [minWords, maxWords] = orderedPair(over.minWords, over.maxWords);
  return { ...base, ...over, minWords, maxWords };
}

function mergeDensity(base: AudienceDensity, over?: AudienceDensity): AudienceDensity {
  if (!over) return base;
  const [minPages, maxPages] = orderedPair(over.minPages, over.maxPages);
  return { ...base, ...over, minPages, maxPages };
}

function mergeProtagonist(base: AudienceProtagonist, over?: AudienceProtagonist) {
  if (!over) return base;
  const [minAge, maxAge] = orderedPair(over.minAge, over.maxAge);
  return { ...base, ...over, minAge, maxAge, guidance: over.guidance.trim() || base.guidance };
}

function mergeSafety(base: AudienceSafety, over?: AudienceSafety): AudienceSafety {
  if (!over) return base;
  return {
    avoid: over.avoid.length > 0 ? over.avoid : base.avoid,
    note: over.note.trim() || base.note,
  };
}

/** A blank profile, used as the base for a band the code has never seen. */
function blankProfile(id: string): AudienceProfile {
  const fallback =
    DEFAULT_AUDIENCE_PROFILES.find((p) => p.id === FALLBACK_PROFILE_ID) ??
    DEFAULT_AUDIENCE_PROFILES[0];
  return {
    ...fallback,
    id,
    label: id,
    caption: "",
    description: "",
    aliases: [],
    extendsId: undefined,
    sections: {},
    dimensions: {},
    order: 1000,
    enabled: true,
  };
}

function mergeProfile(base: AudienceProfile, over?: AudienceProfileOverride): AudienceProfile {
  if (!over) return base;
  const [minMonths, maxMonths] = orderedPair(
    over.minMonths ?? base.minMonths,
    over.maxMonths ?? base.maxMonths,
  );
  return {
    id: base.id,
    label: over.label?.trim() || base.label,
    caption: over.caption ?? base.caption,
    description: over.description ?? base.description,
    minMonths,
    maxMonths,
    order: over.order ?? base.order,
    enabled: over.enabled ?? base.enabled,
    aliases: over.aliases ?? base.aliases,
    extendsId: over.extendsId === undefined ? base.extendsId : over.extendsId || undefined,
    readingModes: over.readingModes ?? base.readingModes,
    modes: mergeModes(base.modes, over.modes),
    sections: mergeSections(base.sections, over.sections),
    dimensions: mergeDimensions(base.dimensions, over.dimensions),
    structure: mergeStructure(base.structure, over.structure),
    density: mergeDensity(base.density, over.density),
    protagonist: mergeProtagonist(base.protagonist, over.protagonist),
    defaultCharacterAgeYears: over.defaultCharacterAgeYears ?? base.defaultCharacterAgeYears,
    safety: mergeSafety(base.safety, over.safety),
    evaluatedDimensionIds: over.evaluatedDimensionIds ?? base.evaluatedDimensionIds,
  };
}

/**
 * Apply `extendsId`, filling only the sections and dimensions the child leaves
 * unset. Depth is capped because a cycle here would hang generation, and a
 * two-level hierarchy is all the editorial model needs.
 */
function applyInheritance(
  profile: AudienceProfile,
  byId: Map<string, AudienceProfile>,
  depth = 0,
): AudienceProfile {
  const parentId = profile.extendsId;
  if (!parentId || parentId === profile.id || depth >= 4) return profile;
  const rawParent = byId.get(parentId);
  if (!rawParent) return profile;
  const parent = applyInheritance(rawParent, byId, depth + 1);

  const sections: Record<string, string> = { ...parent.sections };
  for (const [id, text] of Object.entries(profile.sections)) {
    if (text.trim()) sections[id] = text;
  }
  const dimensions: Record<string, AudienceDimension> = { ...parent.dimensions };
  for (const [id, value] of Object.entries(profile.dimensions)) dimensions[id] = value;

  return { ...profile, sections, dimensions };
}

/**
 * Every profile the app knows about: shipped defaults, then anything carried
 * over from the legacy `ageWriting` document, then the admin's own overrides on
 * top. Layering legacy underneath means a deployment that customised its age
 * guidance keeps it, and the first edit in the new tab quietly supersedes it.
 */
export function resolveAudienceProfiles(
  config?: AudienceConfig | null,
  legacyWriting?: AgeWritingConfig | null,
  legacyCraft?: StoryCraftConfig | null,
): AudienceProfile[] {
  const legacyById = new Map<string, AudienceProfileOverride>();
  for (const entry of ageWritingAsAudienceOverrides(legacyWriting)) {
    legacyById.set(entry.id, entry as AudienceProfileOverride);
  }
  for (const entry of storyCraftRuleOverrides(legacyCraft)) {
    const prev = legacyById.get(entry.id);
    legacyById.set(entry.id, {
      ...(prev ?? { id: entry.id }),
      // The old structure had no `plotRequired`; keep whatever the band's
      // default says rather than inventing an answer for it.
      ...(entry.structure
        ? {
            structure: {
              ...entry.structure,
              plotRequired:
                DEFAULT_AUDIENCE_PROFILES.find((p) => p.id === entry.id)?.structure.plotRequired ??
                true,
            },
          }
        : {}),
      ...(entry.protagonist ? { protagonist: entry.protagonist } : {}),
      ...(entry.safety ? { safety: entry.safety } : {}),
    });
  }

  const overridesById = new Map((config?.profiles ?? []).map((p) => [p.id, p]));
  const allIds = new Set<string>([
    ...DEFAULT_AUDIENCE_PROFILES.map((p) => p.id),
    ...legacyById.keys(),
    ...overridesById.keys(),
  ]);

  const merged: AudienceProfile[] = [];
  for (const id of allIds) {
    const base = DEFAULT_AUDIENCE_PROFILES.find((p) => p.id === id) ?? blankProfile(id);
    const withLegacy = mergeProfile(base, legacyById.get(id));
    merged.push(mergeProfile(withLegacy, overridesById.get(id)));
  }

  const byId = new Map(merged.map((p) => [p.id, p]));
  return merged
    .map((p) => applyInheritance(p, byId))
    .sort((a, b) => a.order - b.order || a.minMonths - b.minMonths);
}

/**
 * Anything that can supply audience configuration: the document itself, or a
 * bag that carries it alongside the legacy one (the prompt context, the app
 * config store). Accepting both keeps call sites free of plumbing.
 */
export interface AudienceSource {
  audience?: AudienceConfig | null;
  ageWriting?: AgeWritingConfig | null;
  storyCraft?: StoryCraftConfig | null;
}

function unpack(src?: AudienceSource | AudienceConfig | null): AudienceSource {
  if (!src) return {};
  if ("profiles" in src && Array.isArray((src as AudienceConfig).profiles)) {
    return { audience: src as AudienceConfig };
  }
  return src as AudienceSource;
}

/** Every profile, resolved from any source shape. */
export function audienceProfiles(src?: AudienceSource | AudienceConfig | null): AudienceProfile[] {
  const bag = unpack(src);
  return resolveAudienceProfiles(bag.audience, bag.ageWriting, bag.storyCraft);
}

/** Only the bands a customer may choose, in picker order. */
export function enabledAudienceProfiles(
  src?: AudienceSource | AudienceConfig | null,
): AudienceProfile[] {
  const all = audienceProfiles(src);
  const enabled = all.filter((p) => p.enabled);
  // Never hand back an empty picker: a config that disabled everything is a
  // misconfiguration, not an instruction to block book creation.
  return enabled.length > 0 ? enabled : all.slice(0, 1);
}

/**
 * The profile for an id, always. Tries the id, then any profile claiming it as
 * an alias, then the fallback band. Books created before a band was renamed or
 * retired keep generating.
 */
export function resolveAudienceProfile(
  ageRangeId: string | null | undefined,
  src?: AudienceSource | AudienceConfig | null,
): AudienceProfile {
  const all = audienceProfiles(src);
  const id = (ageRangeId ?? "").trim();
  return (
    all.find((p) => p.id === id) ??
    all.find((p) => p.aliases.includes(id)) ??
    all.find((p) => p.id === FALLBACK_PROFILE_ID) ??
    all[0] ??
    blankProfile(FALLBACK_PROFILE_ID)
  );
}

/** The enabled band whose month range contains `months`, for the age shortcut. */
export function audienceProfileForMonths(
  months: number,
  src?: AudienceSource | AudienceConfig | null,
): AudienceProfile | undefined {
  const enabled = enabledAudienceProfiles(src);
  return (
    enabled.find((p) => months >= p.minMonths && months <= p.maxMonths) ??
    // Past the top of the oldest band, the oldest band is still the best answer.
    [...enabled].reverse().find((p) => months > p.maxMonths)
  );
}

// ---------------------------------------------------------------------------
// Derived reads
// ---------------------------------------------------------------------------

export function audienceLabel(
  ageRangeId: string,
  src?: AudienceSource | AudienceConfig | null,
): string {
  return resolveAudienceProfile(ageRangeId, src).label;
}

export function audienceHasReadingModes(
  ageRangeId: string,
  src?: AudienceSource | AudienceConfig | null,
): boolean {
  return resolveAudienceProfile(ageRangeId, src).readingModes.length > 0;
}

/** The mode to preselect when a band asks the reading-mode question. */
export function defaultReadingMode(profile: AudienceProfile): ReadingModeId | null {
  return profile.readingModes[0] ?? null;
}

/** The guidance pair in force for a band + mode, falling back to `default`. */
export function resolveModeGuidance(
  profile: AudienceProfile,
  readingModeId?: ReadingModeId | string | null,
): ModeGuidance {
  const key =
    readingModeId && profile.readingModes.includes(readingModeId as ReadingModeId)
      ? (readingModeId as ReadingModeId)
      : null;
  return (
    (key ? profile.modes[key] : undefined) ??
    profile.modes.default ??
    profile.modes[profile.readingModes[0] as ModeKey] ?? { humanGuidance: "", storyGuidance: "" }
  );
}

/** The full never-include list: the code floor plus the band's additions. */
export function resolveAvoidList(profile: AudienceProfile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...MANDATORY_AVOID, ...profile.safety.avoid]) {
    const key = entry.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry.trim());
  }
  return out;
}

/** Human month range, e.g. "0–12 months" or "3–5 years". */
export function monthRangeLabel(profile: AudienceProfile): string {
  const { minMonths, maxMonths } = profile;
  if (maxMonths < 36) return `${minMonths}–${maxMonths} months`;
  const toYears = (m: number) => Math.round(m / 12);
  return `${toYears(minMonths)}–${toYears(maxMonths + 1)} years`;
}

/**
 * Configuration problems worth surfacing in the dashboard. Nothing here blocks
 * generation — every one of these has a working fallback — but each one means a
 * band is quietly not doing what its author intended.
 */
export interface AudienceIssue {
  profileId: string;
  severity: "warn" | "info";
  message: string;
}

export function inspectAudienceConfig(
  src?: AudienceSource | AudienceConfig | null,
): AudienceIssue[] {
  const profiles = audienceProfiles(src);
  const issues: AudienceIssue[] = [];
  const enabled = profiles.filter((p) => p.enabled);

  for (const profile of profiles) {
    if (!profile.enabled) continue;

    const emptySections = GUARDRAIL_SECTIONS.filter(
      (s) => !(profile.sections[s.id] ?? "").trim(),
    );
    if (emptySections.length > 0) {
      issues.push({
        profileId: profile.id,
        severity: "info",
        message: `${emptySections.length} guidance section${
          emptySections.length === 1 ? "" : "s"
        } left blank: ${emptySections.map((s) => s.label).join(", ")}.`,
      });
    }

    const missingDimensions = EDITORIAL_DIMENSIONS.filter((d) => !profile.dimensions[d.id]);
    if (missingDimensions.length > 0) {
      issues.push({
        profileId: profile.id,
        severity: "info",
        message: `${missingDimensions.length} rubric row${
          missingDimensions.length === 1 ? "" : "s"
        } not set, so the reading-level check can't score them.`,
      });
    }

    // A page budget the manuscript can't fill (or blows past) produces books
    // that are correct per page and wrong as a whole.
    const impliedMin = profile.density.targetWordsPerPage * profile.density.minPages;
    if (profile.density.targetWordsPerPage > 0 && profile.structure.maxWords < impliedMin * 0.5) {
      issues.push({
        profileId: profile.id,
        severity: "warn",
        message: `Story length (${profile.structure.minWords}–${profile.structure.maxWords} words) is far below the page plan (${profile.density.minPages} pages × ~${profile.density.targetWordsPerPage} words). Pages will come out nearly empty.`,
      });
    }
    if (
      profile.density.maxWordsPerPage > 0 &&
      profile.density.targetWordsPerPage > profile.density.maxWordsPerPage
    ) {
      issues.push({
        profileId: profile.id,
        severity: "warn",
        message: "Target words per page is above the maximum, so every page fails the check.",
      });
    }
    if (
      profile.structure.maxSentenceWords > 0 &&
      profile.density.maxWordsPerPage > 0 &&
      profile.structure.maxSentenceWords > profile.density.maxWordsPerPage
    ) {
      issues.push({
        profileId: profile.id,
        severity: "warn",
        message: "One sentence is allowed to be longer than a whole page is allowed to be.",
      });
    }
    if (profile.extendsId && !profiles.some((p) => p.id === profile.extendsId)) {
      issues.push({
        profileId: profile.id,
        severity: "warn",
        message: `Inherits from "${profile.extendsId}", which no longer exists.`,
      });
    }
  }

  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i];
      const b = enabled[j];
      if (a.minMonths <= b.maxMonths && b.minMonths <= a.maxMonths) {
        issues.push({
          profileId: b.id,
          severity: "info",
          message: `Age range overlaps ${a.label}. The age shortcut will pick whichever sorts first.`,
        });
      }
    }
  }

  return issues;
}
