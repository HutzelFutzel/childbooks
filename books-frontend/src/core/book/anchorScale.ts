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
 * These helpers turn character heights into something a model actually
 * follows. Bare centimetre numbers are weak instructions; concrete body
 * landmarks ("her head reaches his chest") are much stronger, so we emit
 * landmarks and keep the numbers only as a secondary cue.
 *
 * Where a height comes from matters as much as how it is worded:
 *  - A CHILD who is a person is as tall as their age says. Age is the one fact
 *    the author controls and sees, and two two-year-olds must never be told to
 *    be different sizes because a model guessed 92cm for one and 84cm for the
 *    other.
 *  - An ADULT, or anything that is not on the human growth curve (a toy, a
 *    creature, a giant), uses the analysis model's `heightCm` estimate, because
 *    there age says little about size.
 *  - Characters within a few percent of each other are TIED. A tie is stated
 *    as a tie, never as a ranking ("X is the tallest; Y is the same height").
 */
import type { Anchor } from "../types";
import { standsOnGround } from "../types";

/** Within this fraction of one another, two heights count as the same height. */
const SAME_HEIGHT_RATIO = 0.95;

/** Below this age a person's height follows their age rather than a guess. */
const GROWING_UNTIL_AGE = 16;

/** How far a stored estimate may sit from the age curve before it is taken to
    describe something other than an ordinary person (a toy, a creature). */
const OFF_CURVE_RATIO = 0.25;

/** Height of an ordinary person of this age. Deliberately coarse: it exists to
    keep a five-year-old and an adult apart, and two same-age children equal,
    not to claim medical precision. */
export function humanHeightCm(ageYears: number): number {
  const age = Math.max(0, Math.min(20, ageYears));
  if (age < 1) return 50 + age * 25;
  if (age < 3) return 75 + (age - 1) * 11;
  if (age < 12) return 97 + (age - 3) * 5.8;
  if (age < 18) return 149 + (age - 12) * 3.8;
  return 172;
}

/** Age-derived height for upright human-like characters. */
function ageHeightCm(anchor: Anchor): number | undefined {
  if (
    (anchor.bodyPlan !== undefined && anchor.bodyPlan !== "bipedal") ||
    anchor.ageYears === undefined
  ) {
    return undefined;
  }
  return humanHeightCm(anchor.ageYears);
}

function storedHeight(anchor: Anchor): number | undefined {
  return typeof anchor.heightCm === "number" && anchor.heightCm > 0 ? anchor.heightCm : undefined;
}

/** True when a stored estimate is too far from the human curve to be about a person. */
function isOffCurve(hintCm: number, curveCm: number): boolean {
  return Math.abs(hintCm - curveCm) / curveCm > OFF_CURVE_RATIO;
}

function scaleHeight(anchor: Anchor): number | undefined {
  const hint = storedHeight(anchor);
  const byAge = ageHeightCm(anchor);
  if (byAge === undefined) return hint;
  if (hint === undefined) return byAge;
  // An adult's height varies too much for age to say anything: trust the estimate.
  if ((anchor.ageYears ?? 0) >= GROWING_UNTIL_AGE) return hint;
  // A child is as tall as their age, unless the estimate says they are not a
  // person on the human curve at all (a toy bear, a tiny creature).
  return isOffCurve(hint, byAge) ? hint : byAge;
}

/**
 * The `heightCm` to keep when a character's age is edited, or undefined to drop
 * it. An estimate that merely restated the old age would otherwise outlive the
 * edit and contradict the new one; one that was clearly off the human curve
 * (a toy, a creature) is still true, and stays.
 */
export function heightAfterAgeChange(anchor: Anchor, nextAgeYears: number): number | undefined {
  const hint = storedHeight(anchor);
  if (hint === undefined) return undefined;
  const byOldAge = ageHeightCm(anchor);
  if (byOldAge === undefined) return hint;
  if (isOffCurve(hint, byOldAge)) return hint;
  // Still the same grown-up either side of the edit: the estimate is about them.
  const wasGrown = (anchor.ageYears ?? 0) >= GROWING_UNTIL_AGE;
  const isGrown = nextAgeYears >= GROWING_UNTIL_AGE;
  return wasGrown && isGrown ? hint : undefined;
}

/** Characters that can take part in a size comparison. */
export function scalableCharacters(anchors: Anchor[]): Anchor[] {
  return anchors.filter(
    (a) => a.type === "character" && scaleHeight(a) !== undefined,
  );
}

interface SizeGroup {
  members: Anchor[];
  /** The tallest member's height, which the whole group is measured at. */
  cm: number;
}

/** Tallest first; everyone within a few percent of a group's tallest joins it. */
function sizeGroups(scalable: Anchor[]): SizeGroup[] {
  const sorted = [...scalable].sort((a, b) => scaleHeight(b)! - scaleHeight(a)!);
  const groups: SizeGroup[] = [];
  for (const a of sorted) {
    const cm = scaleHeight(a)!;
    const last = groups[groups.length - 1];
    if (last && cm >= last.cm * SAME_HEIGHT_RATIO) last.members.push(a);
    else groups.push({ members: [a], cm });
  }
  return groups;
}

function joinNames(anchors: Anchor[]): string {
  const names = anchors.map((a) => a.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Where the shorter subject's head reaches on the taller one. Thresholds follow
 * ordinary human proportions rather than being evenly spaced — the interesting
 * distinctions are clustered in the middle of the range, which is exactly where
 * adult/child pairs land. `many` picks the plural verb for a group.
 */
const LANDMARKS: readonly { min: number; one: string; many: string }[] = [
  { min: SAME_HEIGHT_RATIO, one: "is the same height as", many: "are the same height as" },
  { min: 0.92, one: "comes up to the eyes of", many: "each come up to the eyes of" },
  { min: 0.86, one: "comes up to the chin of", many: "each come up to the chin of" },
  { min: 0.78, one: "comes up to the shoulder of", many: "each come up to the shoulder of" },
  { min: 0.66, one: "comes up to the chest of", many: "each come up to the chest of" },
  { min: 0.56, one: "comes up to the waist of", many: "each come up to the waist of" },
  { min: 0.46, one: "comes up to the hip of", many: "each come up to the hip of" },
  { min: 0.34, one: "comes up to the thigh of", many: "each come up to the thigh of" },
  { min: 0.22, one: "comes up to the knee of", many: "each come up to the knee of" },
];

function landmarkFor(ratio: number, many: boolean): string {
  const hit = LANDMARKS.find((l) => ratio >= l.min);
  if (hit) return many ? hit.many : hit.one;
  return many ? "are each no taller than the shin of" : "is no taller than the shin of";
}

/** Coarse fraction wording for subjects that don't stand upright. */
const FRACTIONS: readonly { min: number; text: string }[] = [
  { min: SAME_HEIGHT_RATIO, text: "as tall as" },
  { min: 0.72, text: "about three quarters as tall as" },
  { min: 0.58, text: "about two thirds as tall as" },
  { min: 0.42, text: "about half as tall as" },
  { min: 0.28, text: "about a third as tall as" },
  { min: 0.18, text: "about a quarter as tall as" },
];

function fractionFor(ratio: number, many: boolean): string {
  const text = FRACTIONS.find((f) => ratio >= f.min)?.text ?? "a small fraction of the height of";
  return many ? `are each ${text}` : `is ${text}`;
}

/**
 * A sentence describing how big each character is relative to the tallest one
 * in the scene, or "" when fewer than two have a known height (nothing useful
 * can be said about a single subject, and a wrong guess is worse than silence).
 *
 * Characters of the same height are said to be the same height — together, as
 * one group — so a tie is never worded as a ranking the model could act on.
 */
export function relativeHeightsText(anchors: Anchor[]): string {
  const scalable = scalableCharacters(anchors);
  if (scalable.length < 2) return "";

  const groups = sizeGroups(scalable);
  const top = groups[0]!;
  const topNames = joinNames(top.members);
  const approx = groups
    .flatMap((g) => g.members)
    .map((a) => `${a.name} ${Math.round(scaleHeight(a)!)}cm`)
    .join(", ");

  if (groups.length === 1) {
    const lead =
      top.members.length === 2
        ? `${topNames} are exactly the same height`
        : `${topNames} are all exactly the same height`;
    return `${lead} (approximate real heights: ${approx}): standing at the same distance from the viewer, their heads are level and their bodies are the same size — none looks bigger or older than another.`;
  }

  const intro =
    top.members.length === 1
      ? `${topNames} is the tallest`
      : `${topNames} are the same height, and the tallest`;
  const clauses = groups.slice(1).map((g) => {
    const ratio = Math.max(0, Math.min(1, g.cm / top.cm));
    const many = g.members.length > 1;
    const upright = [...g.members, ...top.members].every((a) => standsOnGround(a.bodyPlan));
    const phrase = upright ? landmarkFor(ratio, many) : fractionFor(ratio, many);
    return `${joinNames(g.members)} ${phrase} ${topNames}`;
  });
  return `${intro}; ${clauses.join("; ")} (approximate real heights: ${approx}).`;
}

/**
 * Height of each character as a fraction of the tallest, for the size chart
 * handed to a page illustration. Returned whenever at least two characters
 * have a height: a pair that is meant to be the SAME size needs the chart as
 * much as one that differs, because sheets drawn on their own canvases say
 * nothing about relative size either way. Characters of the same height share
 * exactly one fraction, so the chart draws them level.
 */
export function heightFractions(anchors: Anchor[]): Map<string, number> {
  const out = new Map<string, number>();
  const scalable = scalableCharacters(anchors);
  if (scalable.length < 2) return out;
  const groups = sizeGroups(scalable);
  const tallestCm = groups[0]!.cm;
  if (tallestCm <= 0) return out;
  for (const g of groups) {
    for (const a of g.members) out.set(a.id, g.cm / tallestCm);
  }
  return out;
}
