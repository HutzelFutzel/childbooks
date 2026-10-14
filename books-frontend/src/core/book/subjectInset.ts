/**
 * The margin around a generated picture that must stay free of faces and
 * important subjects.
 *
 * Two things eat into the outer edge of the art: print trimming, and the
 * decorative frame (image mask) a book can lay over every picture. The admin
 * sets a floor; a frame that cuts deeper widens it. Both are expressed as a
 * share of the picture's width and height, because a square frame SVG is
 * stretched over whatever rectangle the picture fills.
 */
import type { LayoutCompositionConfig } from "../config/layouts";
import type { ImageMasksConfig } from "../config/imageMasks";
import { activeImageMasks, imageMaskById } from "../config/imageMasks";

/** A pixel this transparent or more counts as covered by the frame. */
export const FRAME_COVER_ALPHA = 0.9;

/**
 * How far in from the nearest edge a frame reaches, 0..0.5: the deepest point
 * at which it hides (or visibly fades) the picture, measured as the distance
 * from the closest edge in normalized units.
 *
 * A plain rounded rectangle measures only its corner cut; an oval measures to
 * its diagonal, because a subject drawn in a corner of an oval frame is lost.
 * Sampled on a coarse grid — a few tenths of a percent is far below what an
 * image model can honour anyway.
 */
export function measureFrameSafeInset(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number,
  alphaChannel = channels - 1,
  samples = 256,
): number {
  const threshold = FRAME_COVER_ALPHA * 255;
  const stepX = Math.max(1, Math.floor(width / samples));
  const stepY = Math.max(1, Math.floor(height / samples));
  let deepest = 0;
  for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
    const ny = (y + 0.5) / height;
    const dy = Math.min(ny, 1 - ny);
    for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
      const alpha = data[(y * width + x) * channels + alphaChannel];
      if (alpha >= threshold) continue;
      const nx = (x + 0.5) / width;
      const depth = Math.min(dy, Math.min(nx, 1 - nx));
      if (depth > deepest) deepest = depth;
    }
  }
  return Math.round(deepest * 1000) / 1000;
}

/** Measured insets keyed by frame id; frames not yet measured are absent. */
export type FrameInsets = Record<string, number>;

/**
 * The frame a render should clear: the book's own frame when it has one,
 * otherwise the widest frame a new book can be assigned (a book generated
 * before its frame is rolled must survive any of them).
 */
export function frameInsetFor(
  masks: ImageMasksConfig | null | undefined,
  insets: FrameInsets,
  maskId: string | undefined,
): number {
  if (!masks) return 0;
  const own = imageMaskById(masks, maskId);
  if (own) return insets[own.id] ?? own.safeInset ?? 0;
  const pool = activeImageMasks(masks).filter((asset) => asset.starter !== false);
  return pool.reduce((widest, asset) => Math.max(widest, insets[asset.id] ?? asset.safeInset ?? 0), 0);
}

/** The admin floor, widened for the frame and capped so one ornate frame can't shrink every picture. */
export function effectiveSubjectInset(
  composition: Required<LayoutCompositionConfig>,
  frameInset: number,
): number {
  const fromFrame = composition.frameAware ? Math.min(frameInset, composition.maxSafeInset) : 0;
  return Math.max(composition.subjectSafeInset, fromFrame);
}

const INSET_WORDS: [number, string][] = [
  [1 / 25, "twenty-fifth"],
  [1 / 20, "twentieth"],
  [1 / 16, "sixteenth"],
  [1 / 12, "twelfth"],
  [1 / 10, "tenth"],
  [1 / 8, "eighth"],
  [1 / 6, "sixth"],
  [1 / 5, "fifth"],
  [1 / 4, "quarter"],
];

/** Prompt wording for a margin: `{ percent: "8%", fraction: "twelfth" }`. */
export function describeSubjectInset(inset: number): { percent: string; fraction: string } {
  let best = INSET_WORDS[0];
  for (const word of INSET_WORDS) {
    if (Math.abs(word[0] - inset) < Math.abs(best[0] - inset)) best = word;
  }
  return { percent: `${Math.round(inset * 100)}%`, fraction: best[1] };
}
