/**
 * Admin overlay for age-range writing guidance (`appConfig/ageWriting`).
 *
 * Structure and built-in defaults live in `ageWritingCatalog`; this document
 * stores admin overrides per age band (and per reading mode for 6–8 / 9–12).
 */
import { z } from "zod";
import { AGE_RANGES } from "./options";
import {
  DEFAULT_AGE_BAND_WRITING,
  READING_MODES,
  type AgeBandId,
  type AgeBandWriting,
  type GuidancePair,
  type ReadingModeId,
} from "./ageWritingCatalog";

const guidancePairSchema = z.object({
  humanGuidance: z.string().min(1).max(4000),
  llmGuidance: z.string().min(1).max(8000),
});

const ageBandWritingSchema = z.object({
  guidance: guidancePairSchema.optional(),
  readingModes: z
    .record(z.enum(["read-aloud", "with-help", "independent"]), guidancePairSchema)
    .optional(),
});

/** v1 shape (legacy). */
interface AgeWritingConfigV1 {
  version: 1;
  prompts: Record<string, { textPrompt: string; updatedAt?: number }>;
}

export interface AgeWritingConfig {
  version: 2;
  /** Partial overrides keyed by AGE_RANGES[].id. */
  bands: Partial<Record<AgeBandId, AgeBandWriting>>;
}

export function createDefaultAgeWritingConfig(): AgeWritingConfig {
  return { version: 2, bands: {} };
}

function migrateV1(input: AgeWritingConfigV1): AgeWritingConfig {
  const bands: AgeWritingConfig["bands"] = {};
  for (const [ageId, row] of Object.entries(input.prompts ?? {})) {
    if (!row.textPrompt?.trim()) continue;
    if (ageId === "6-8" || ageId === "9-12") {
      bands[ageId] = {
        readingModes: {
          "read-aloud": {
            humanGuidance: DEFAULT_AGE_BAND_WRITING[ageId].readingModes?.["read-aloud"]?.humanGuidance ?? "",
            llmGuidance: row.textPrompt.trim(),
          },
        },
      };
    } else {
      bands[ageId as AgeBandId] = {
        guidance: {
          humanGuidance:
            DEFAULT_AGE_BAND_WRITING[ageId as AgeBandId]?.guidance?.humanGuidance ?? "",
          llmGuidance: row.textPrompt.trim(),
        },
      };
    }
  }
  return { version: 2, bands };
}

export function normalizeAgeWritingConfig(input: unknown): AgeWritingConfig {
  const stored = (input ?? {}) as Record<string, unknown>;
  if (stored.version === 1) {
    return migrateV1(stored as unknown as AgeWritingConfigV1);
  }
  const bands = (stored.bands ?? {}) as AgeWritingConfig["bands"];
  return { version: 2, bands };
}

export const ageWritingConfigSchema = z.object({
  version: z.literal(2),
  bands: z.record(z.string(), ageBandWritingSchema),
});

/** Known age-range ids (for admin validation). */
export const AGE_RANGE_IDS = AGE_RANGES.map((a) => a.id);

function mergeGuidance(base?: GuidancePair, override?: GuidancePair): GuidancePair | undefined {
  if (!base && !override) return undefined;
  return {
    humanGuidance: override?.humanGuidance?.trim() || base?.humanGuidance || "",
    llmGuidance: override?.llmGuidance?.trim() || base?.llmGuidance || "",
  };
}

function mergeReadingModes(
  base: Partial<Record<ReadingModeId, GuidancePair>> | undefined,
  override: Partial<Record<ReadingModeId, GuidancePair>> | undefined,
): Partial<Record<ReadingModeId, GuidancePair>> | undefined {
  const out: Partial<Record<ReadingModeId, GuidancePair>> = {};
  for (const mode of READING_MODES) {
    const merged = mergeGuidance(base?.[mode.id], override?.[mode.id]);
    if (merged) out[mode.id] = merged;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Merge catalog defaults with optional Firebase overrides. */
export function resolveAgeBandWriting(
  ageRangeId: string,
  config?: AgeWritingConfig | null,
): AgeBandWriting {
  const defaults = DEFAULT_AGE_BAND_WRITING[ageRangeId as AgeBandId] ?? {};
  const override = config?.bands?.[ageRangeId as AgeBandId];
  if (!override) return defaults;
  return {
    guidance: mergeGuidance(defaults.guidance, override.guidance),
    readingModes: mergeReadingModes(defaults.readingModes, override.readingModes),
  };
}
