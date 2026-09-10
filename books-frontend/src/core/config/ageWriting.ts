/**
 * LEGACY: the old per-band writing-guidance document (`appConfig/ageWriting`).
 *
 * Superseded by `appConfig/audience`, which holds the same guidance split into
 * channelled sections plus the rules that used to be scattered across three
 * other documents. This module survives for one reason: a deployment that
 * customised its age guidance must not silently lose it on deploy.
 *
 * {@link ageWritingAsAudienceOverrides} folds any stored text into the audience
 * profiles as free-form mode guidance, underneath anything set in the new
 * document. Nothing is dropped, nothing needs a manual migration step, and an
 * admin who edits the band in the new tab quietly takes ownership of it.
 */
import { z } from "zod";
import { READING_MODES, type ReadingModeId } from "./readingModes";

export interface GuidancePair {
  humanGuidance: string;
  llmGuidance: string;
}

export interface AgeBandWriting {
  guidance?: GuidancePair;
  readingModes?: Partial<Record<ReadingModeId, GuidancePair>>;
}

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

/** v1 shape (pre-reading-modes). */
interface AgeWritingConfigV1 {
  version: 1;
  prompts: Record<string, { textPrompt: string; updatedAt?: number }>;
}

export interface AgeWritingConfig {
  version: 2;
  bands: Record<string, AgeBandWriting>;
}

export function createDefaultAgeWritingConfig(): AgeWritingConfig {
  return { version: 2, bands: {} };
}

function migrateV1(input: AgeWritingConfigV1): AgeWritingConfig {
  const bands: AgeWritingConfig["bands"] = {};
  for (const [ageId, row] of Object.entries(input.prompts ?? {})) {
    if (!row.textPrompt?.trim()) continue;
    bands[ageId] = { guidance: { humanGuidance: "", llmGuidance: row.textPrompt.trim() } };
  }
  return { version: 2, bands };
}

export function normalizeAgeWritingConfig(input: unknown): AgeWritingConfig {
  const stored = (input ?? {}) as Record<string, unknown>;
  if (stored.version === 1) return migrateV1(stored as unknown as AgeWritingConfigV1);
  const bands: AgeWritingConfig["bands"] = {};
  for (const [id, value] of Object.entries((stored.bands ?? {}) as Record<string, unknown>)) {
    const parsed = ageBandWritingSchema.safeParse(value);
    if (parsed.success) bands[id] = parsed.data;
  }
  return { version: 2, bands };
}

export const ageWritingConfigSchema = z.object({
  version: z.literal(2),
  bands: z.record(z.string(), ageBandWritingSchema),
});

/** True when a deployment has customised anything here worth carrying over. */
export function hasLegacyAgeWriting(config?: AgeWritingConfig | null): boolean {
  return Object.values(config?.bands ?? {}).some(
    (band) =>
      Boolean(band.guidance?.llmGuidance?.trim() || band.guidance?.humanGuidance?.trim()) ||
      Object.values(band.readingModes ?? {}).some(
        (pair) => Boolean(pair?.llmGuidance?.trim() || pair?.humanGuidance?.trim()),
      ),
  );
}

/**
 * Project the legacy document into the audience document's shape, so it can be
 * merged in as a base layer. `llmGuidance` becomes the band's free-form story
 * guidance; `humanGuidance` becomes what the wizard shows.
 */
export function ageWritingAsAudienceOverrides(config?: AgeWritingConfig | null): {
  id: string;
  modes: Record<string, { humanGuidance: string; storyGuidance: string }>;
}[] {
  const out: {
    id: string;
    modes: Record<string, { humanGuidance: string; storyGuidance: string }>;
  }[] = [];

  for (const [id, band] of Object.entries(config?.bands ?? {})) {
    const modes: Record<string, { humanGuidance: string; storyGuidance: string }> = {};
    if (band.guidance?.llmGuidance?.trim() || band.guidance?.humanGuidance?.trim()) {
      modes.default = {
        humanGuidance: band.guidance.humanGuidance?.trim() ?? "",
        storyGuidance: band.guidance.llmGuidance?.trim() ?? "",
      };
    }
    for (const mode of READING_MODES) {
      const pair = band.readingModes?.[mode.id];
      if (!pair?.llmGuidance?.trim() && !pair?.humanGuidance?.trim()) continue;
      modes[mode.id] = {
        humanGuidance: pair.humanGuidance?.trim() ?? "",
        storyGuidance: pair.llmGuidance?.trim() ?? "",
      };
    }
    if (Object.keys(modes).length > 0) out.push({ id, modes });
  }
  return out;
}
