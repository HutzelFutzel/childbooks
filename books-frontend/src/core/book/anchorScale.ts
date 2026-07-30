/**
 * Relative character sizing.
 *
 * Every anchor sheet is generated on its own canvas and fills it, so a father
 * and his five-year-old son both arrive drawn at roughly the same pixel height.
 * When both sheets are handed to a page illustration as reference images, the
 * model gets no size signal at all and falls back on its own priors — which is
 * why the same pair can come out correctly proportioned on one page and like
 * twins on the next.
 *
 * These helpers turn the stored `heightCm` values into something a model
 * actually follows. Bare centimetre numbers are weak instructions; concrete
 * body landmarks ("her head reaches his chest") are much stronger, so we emit
 * landmarks and keep the numbers only as a secondary cue.
 */
import type { Anchor } from "../types";
import { standsOnGround } from "../types";

/** Characters that can take part in a size comparison. */
export function scalableCharacters(anchors: Anchor[]): Anchor[] {
  return anchors.filter(
    (a) => a.type === "character" && typeof a.heightCm === "number" && a.heightCm > 0,
  );
}

/**
 * Where the shorter subject's head reaches on the taller one. Thresholds follow
 * ordinary human proportions rather than being evenly spaced — the interesting
 * distinctions are clustered in the middle of the range, which is exactly where
 * adult/child pairs land.
 */
function landmarkFor(ratio: number): string {
  if (ratio >= 0.97) return "is the same height as";
  if (ratio >= 0.92) return "comes up to the eyes of";
  if (ratio >= 0.86) return "comes up to the chin of";
  if (ratio >= 0.78) return "comes up to the shoulder of";
  if (ratio >= 0.66) return "comes up to the chest of";
  if (ratio >= 0.56) return "comes up to the waist of";
  if (ratio >= 0.46) return "comes up to the hip of";
  if (ratio >= 0.34) return "comes up to the thigh of";
  if (ratio >= 0.22) return "comes up to the knee of";
  return "is no taller than the shin of";
}

/** Coarse fraction wording for subjects that don't stand upright. */
function fractionFor(ratio: number): string {
  if (ratio >= 0.97) return "as tall as";
  if (ratio >= 0.72) return "about three quarters as tall as";
  if (ratio >= 0.58) return "about two thirds as tall as";
  if (ratio >= 0.42) return "about half as tall as";
  if (ratio >= 0.28) return "about a third as tall as";
  if (ratio >= 0.18) return "about a quarter as tall as";
  return "a small fraction of the height of";
}

/**
 * A sentence describing how big each character is relative to the tallest one
 * in the scene, or "" when fewer than two have a known height (nothing useful
 * can be said about a single subject, and a wrong guess is worse than silence).
 */
export function relativeHeightsText(anchors: Anchor[]): string {
  const scalable = scalableCharacters(anchors);
  if (scalable.length < 2) return "";

  const sorted = [...scalable].sort((a, b) => (b.heightCm ?? 0) - (a.heightCm ?? 0));
  const tallest = sorted[0];
  const tallestCm = tallest.heightCm!;

  const clauses = sorted.slice(1).map((a) => {
    const ratio = Math.max(0, Math.min(1, (a.heightCm ?? 0) / tallestCm));
    const upright = standsOnGround(a.bodyPlan) && standsOnGround(tallest.bodyPlan);
    return upright
      ? `${a.name} ${landmarkFor(ratio)} ${tallest.name}`
      : `${a.name} is ${fractionFor(ratio)} ${tallest.name}`;
  });

  const approx = sorted.map((a) => `${a.name} ${Math.round(a.heightCm!)}cm`).join(", ");
  return `${tallest.name} is the tallest; ${clauses.join("; ")} (approximate real heights: ${approx}).`;
}

/**
 * Height of each character as a fraction of the tallest, for scaling the
 * reference sheets themselves. Only returned when at least two characters have
 * a height AND they actually differ meaningfully — re-rendering every sheet at
 * the same fraction would cost work and change nothing.
 */
export function heightFractions(anchors: Anchor[]): Map<string, number> {
  const out = new Map<string, number>();
  const scalable = scalableCharacters(anchors);
  if (scalable.length < 2) return out;
  const tallestCm = Math.max(...scalable.map((a) => a.heightCm!));
  if (tallestCm <= 0) return out;
  let varied = false;
  for (const a of scalable) {
    const fraction = a.heightCm! / tallestCm;
    if (fraction < 0.92) varied = true;
    out.set(a.id, fraction);
  }
  return varied ? out : new Map();
}
