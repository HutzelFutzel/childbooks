/**
 * Compatibility layer over the audience catalog.
 *
 * Age guidance used to live here as a per-band blob. It now lives on the
 * {@link import("./audienceCatalog").AudienceProfile}, which is admin-editable,
 * sectioned, and channelled to the right prompts. This module keeps the small
 * surface the rest of the app already imports — the reading-mode list, the band
 * id alias, the wizard's fallback blurb — so callers migrate one at a time.
 *
 * New code should read `resolveAudienceProfile` / `resolveAudienceOverlays`.
 */
import { DEFAULT_AUDIENCE_PROFILES, defaultAudienceProfile } from "./audienceCatalog";
import { audienceHasReadingModes, type AudienceConfig } from "./audience";
import { activeAudienceSource } from "./activeAudience";
import type { AgeRange } from "./options";

export {
  READING_MODES,
  READING_MODE_IDS,
  isReadingModeId,
  readingModeLabel,
  type ReadingModeId,
} from "./readingModes";

/**
 * An age-band id. A plain string, deliberately: bands are configuration, so a
 * closed union would make "add an age band" a code change again.
 */
export type AgeBandId = string;

/**
 * Does this band ask the reading-mode question?
 *
 * Falls back to the live config snapshot rather than the shipped profiles, so a
 * band whose reading modes an admin changed doesn't leave the wizard demanding
 * an answer it no longer offers.
 */
export function ageBandHasReadingModes(
  ageRangeId: string,
  config?: AudienceConfig | null,
): boolean {
  return audienceHasReadingModes(ageRangeId, config ?? activeAudienceSource());
}

/** Short card blurb for the age picker, from the shipped profiles. */
export function defaultAgeCardDescription(age: AgeRange): string {
  const profile = defaultAudienceProfile(age.id);
  return profile?.modes.default?.humanGuidance || profile?.description || age.description;
}

/** Every shipped band id, in picker order. */
export const DEFAULT_AGE_BAND_IDS = DEFAULT_AUDIENCE_PROFILES.map((p) => p.id);
