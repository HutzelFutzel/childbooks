/** Resolves age-band writing guidance for LLM calls and user-facing UI. */
import { AGE_RANGES } from "../config/options";
import {
  isReadingModeId,
  type ReadingModeId,
} from "../config/ageWritingCatalog";
import type { AgeWritingConfig } from "../config/ageWriting";
import { resolveAgeBandWriting } from "../config/ageWriting";
import type { PromptContext } from "./context";

function ageWritingFromCtx(
  ctx?: Pick<PromptContext, "ageWriting"> | AgeWritingConfig | null,
): AgeWritingConfig | null | undefined {
  return ctx && "ageWriting" in ctx ? ctx.ageWriting : (ctx as AgeWritingConfig | null | undefined);
}

function pickGuidance(
  band: ReturnType<typeof resolveAgeBandWriting>,
  readingModeId?: ReadingModeId | string | null,
): { humanGuidance: string; llmGuidance: string } | undefined {
  if (band.readingModes) {
    const mode =
      readingModeId && isReadingModeId(readingModeId) ? readingModeId : ("read-aloud" as ReadingModeId);
    const pair = band.readingModes[mode] ?? band.readingModes["read-aloud"];
    if (pair) return pair;
  }
  return band.guidance;
}

export function resolveAgeLlmGuidance(
  ageRangeId: string,
  readingModeId?: ReadingModeId | string | null,
  ctx?: Pick<PromptContext, "ageWriting"> | AgeWritingConfig | null,
): string {
  const band = resolveAgeBandWriting(ageRangeId, ageWritingFromCtx(ctx));
  const pair = pickGuidance(band, readingModeId);
  if (pair?.llmGuidance?.trim()) return pair.llmGuidance.trim();
  const preset = AGE_RANGES.find((a) => a.id === ageRangeId);
  return `Write for children aged ${preset?.label ?? ageRangeId}. Keep vocabulary, sentence length, and themes age-appropriate.`;
}

export function resolveAgeHumanGuidance(
  ageRangeId: string,
  readingModeId?: ReadingModeId | string | null,
  ctx?: Pick<PromptContext, "ageWriting"> | AgeWritingConfig | null,
): string {
  const band = resolveAgeBandWriting(ageRangeId, ageWritingFromCtx(ctx));
  const pair = pickGuidance(band, readingModeId);
  if (pair?.humanGuidance?.trim()) return pair.humanGuidance.trim();
  const preset = AGE_RANGES.find((a) => a.id === ageRangeId);
  return preset?.description ?? "";
}

/** @deprecated Use resolveAgeLlmGuidance */
export function resolveAgeTextPrompt(
  ageRangeId: string,
  ctx?: Pick<PromptContext, "ageWriting"> | AgeWritingConfig | null,
  readingModeId?: ReadingModeId | string | null,
): string {
  return resolveAgeLlmGuidance(ageRangeId, readingModeId, ctx);
}
