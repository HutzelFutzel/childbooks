/**
 * Geometry → natural language for image prompts.
 *
 * Layout geometry and the words that describe it to an image model MUST come
 * from the same place, or they drift: a layout whose text column is widened to
 * 40% while its prompt still says "the right third" makes the model reserve the
 * wrong band. Everything the prompt says about *where* something is on the page
 * is compiled here from the rectangle itself.
 *
 * Each description carries both a phrase and exact percentages. The phrase is
 * the idiom image models respond to; the percentages remove the ambiguity when
 * a rectangle doesn't land on a tidy fraction.
 */
import type { NormRect } from "../design";

/**
 * A rect covering at least this much of an axis is treated as spanning it.
 *
 * Calibrated against the printable area rather than the page: a text column
 * running the full height of the safe area covers only ~0.88 of an 8.5″ page
 * and less on anything shorter, and it should still read as "the right third",
 * not "a block on the right side".
 */
const SPAN = 0.8;

/**
 * Only a rect covering essentially everything is "the whole image".
 *
 * Deliberately much stricter than {@link SPAN}: a focal region that leaves a
 * text column clear covers ~80% of a double-page spread, and calling that "the
 * whole image" would contradict the calm-band instruction in the same prompt.
 */
const WHOLE = 0.95;

const FRACTIONS: [number, string][] = [
  [1 / 8, "eighth"],
  [1 / 6, "sixth"],
  [1 / 5, "fifth"],
  [1 / 4, "quarter"],
  [1 / 3, "third"],
  [2 / 5, "two fifths"],
  [1 / 2, "half"],
  [3 / 5, "three fifths"],
  [2 / 3, "two thirds"],
  [3 / 4, "three quarters"],
  [4 / 5, "four fifths"],
  [5 / 6, "five sixths"],
];

/** Nearest readable fraction word for a 0..1 extent ("third", "two fifths"). */
function extentWord(extent: number): string {
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) {
    if (Math.abs(f[0] - extent) < Math.abs(best[0] - extent)) best = f;
  }
  return best[1];
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** "66%–100% across, 10%–90% down" — the unambiguous part of a description. */
export function regionCoordinates(rect: NormRect): string {
  return `${pct(rect.x)}–${pct(rect.x + rect.w)} across, ${pct(rect.y)}–${pct(
    rect.y + rect.h,
  )} down`;
}

/** Where the rect sits on the horizontal axis. */
function horizontalWord(rect: NormRect): "left" | "right" | "central" {
  const center = rect.x + rect.w / 2;
  if (center < 0.42) return "left";
  if (center > 0.58) return "right";
  return "central";
}

/** Where the rect sits on the vertical axis. */
function verticalWord(rect: NormRect): "top" | "bottom" | "middle" {
  const center = rect.y + rect.h / 2;
  if (center < 0.42) return "top";
  if (center > 0.58) return "bottom";
  return "middle";
}

/**
 * Describe a page region in words an image model can act on, e.g.
 * `"the right third of the image (66%–100% across, 10%–90% down)"`.
 *
 * The rect is in page-surface space (0..1 of the whole generated image), so a
 * double-page spread describes positions across the full spread.
 */
export function describeRegion(rect: NormRect): string {
  const spansWidth = rect.w >= SPAN;
  const spansHeight = rect.h >= SPAN;
  const coords = ` (${regionCoordinates(rect)})`;

  if (rect.w >= WHOLE && rect.h >= WHOLE) return `the whole image${coords}`;

  // A full-height column: the classic "text down the outer edge" case.
  if (spansHeight) {
    const side = horizontalWord(rect);
    if (side === "central") {
      return `a full-height ${extentWord(rect.w)}-width column down the middle of the image${coords}`;
    }
    return `the ${side} ${extentWord(rect.w)} of the image${coords}`;
  }

  // A full-width band across the top / middle / bottom.
  if (spansWidth) {
    const edge = verticalWord(rect);
    return `a band across the ${edge} ${extentWord(rect.h)} of the image${coords}`;
  }

  // Anything else is a block; name it by the corner or edge it sits nearest.
  const h = horizontalWord(rect);
  const v = verticalWord(rect);
  if (h === "central" && v === "middle") return `a block in the centre of the image${coords}`;
  if (h === "central") return `a block across the ${v} of the image${coords}`;
  if (v === "middle") return `a block on the ${h} side of the image${coords}`;
  return `a block in the ${v}-${h} corner of the image${coords}`;
}

/** Join several region descriptions into one readable clause. */
export function describeRegions(rects: NormRect[]): string {
  const parts = rects.map(describeRegion);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Smallest rect containing all the inputs, or null when there are none. */
export function unionRect(rects: NormRect[]): NormRect | null {
  if (rects.length === 0) return null;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The largest page-anchored rectangle that avoids `occupied`, or the full page
 * when the occupied band doesn't hug an edge.
 *
 * This is the single piece of logic behind two things: which part of a
 * full-bleed image should hold the focal action, and where inset artwork can
 * physically go. A layout whose text floats in the middle of the page has no
 * such rectangle — which is exactly why it can't be rendered as inset art.
 */
export function complementRect(occupied: NormRect | null, edgeTolerance = 0.12): NormRect | null {
  if (!occupied) return { x: 0, y: 0, w: 1, h: 1 };
  const left = occupied.x;
  const right = 1 - (occupied.x + occupied.w);
  const top = occupied.y;
  const bottom = 1 - (occupied.y + occupied.h);

  // Which edges does the occupied band hug? Ties are broken by the largest
  // remaining area, so an L-shaped union still yields the roomiest rectangle.
  const options: NormRect[] = [];
  if (left <= edgeTolerance) options.push({ x: occupied.x + occupied.w, y: 0, w: right, h: 1 });
  if (right <= edgeTolerance) options.push({ x: 0, y: 0, w: left, h: 1 });
  if (top <= edgeTolerance) options.push({ x: 0, y: occupied.y + occupied.h, w: 1, h: bottom });
  if (bottom <= edgeTolerance) options.push({ x: 0, y: 0, w: 1, h: top });

  const usable = options.filter((r) => r.w > 0.05 && r.h > 0.05);
  if (usable.length === 0) return null;
  return usable.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best));
}
