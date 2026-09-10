/**
 * Age-band guidance for LLM calls and user-facing UI.
 *
 * A thin façade over {@link resolveAudienceOverlays}, kept so the many existing
 * call sites don't each have to know which channel they want. Anything that
 * needs more than the story overlay — the screenplay, the image models, the
 * reading-level check — should call the compiler directly.
 */
import { resolveAudienceProfile, type AudienceSource } from "../config/audience";
import type { ReadingModeId } from "../config/readingModes";
import { resolveAudienceOverlays } from "./audience";
import type { PromptContext } from "./context";

type Ctx = Pick<PromptContext, "audience" | "ageWriting"> | AudienceSource | null | undefined;

/** Everything the drafting, translation and revision prompts should be told. */
export function resolveAgeLlmGuidance(
  ageRangeId: string,
  readingModeId?: ReadingModeId | string | null,
  ctx?: Ctx,
): string {
  const overlays = resolveAudienceOverlays(ageRangeId, readingModeId, ctx);
  if (overlays.story.trim()) return overlays.story;
  return `Write for children aged ${overlays.profile.label}. Keep vocabulary, sentence length, and themes age-appropriate.`;
}

/** The one-line blurb the setup wizard shows under an age band. */
export function resolveAgeHumanGuidance(
  ageRangeId: string,
  readingModeId?: ReadingModeId | string | null,
  ctx?: Ctx,
): string {
  const overlays = resolveAudienceOverlays(ageRangeId, readingModeId, ctx);
  return overlays.human || overlays.profile.description;
}

/** The band's display name, honouring admin renames. */
export function resolveAgeLabel(ageRangeId: string, ctx?: Ctx): string {
  return resolveAudienceProfile(ageRangeId, ctx).label;
}

/** @deprecated Use resolveAgeLlmGuidance */
export function resolveAgeTextPrompt(
  ageRangeId: string,
  ctx?: Ctx,
  readingModeId?: ReadingModeId | string | null,
): string {
  return resolveAgeLlmGuidance(ageRangeId, readingModeId, ctx);
}
