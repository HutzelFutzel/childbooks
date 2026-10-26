/**
 * Physical geometry for print-ready pages.
 *
 * Every number a renderer or an assembler needs about a page — how big the
 * rendered surface is, where the trim box sits inside it, which slice of a
 * double-page spread belongs to which leaf, how wide a cover panel is — is
 * derived here from the product's trim and bleed. Nothing else is allowed to
 * do this arithmetic: the export used to lay a page out at trim size and then
 * declare it bleed-sized in the PDF, which silently scaled every printed page
 * up by ~3% and shaved the outer edge off after trimming.
 *
 * Pure and DOM-free, so the browser renderer and the backend assembler agree
 * by construction.
 */
import type { BookProduct } from "../fulfillment/types";

/** PDF user-space units per inch. */
export const PT_PER_IN = 72;

/** Which physical leaf a rendered surface represents. */
export type LeafSide = "left" | "right";

export interface PageGeometry {
  dpi: number;
  bleedIn: number;
  bleedPx: number;
  /** The trim box — the finished page after cutting. */
  trimWidthIn: number;
  trimHeightIn: number;
  trimWidthPx: number;
  trimHeightPx: number;
  /** The full rendered surface: trim plus bleed on all four edges. */
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
}

/** A horizontal slice of a rendered surface, in device pixels. */
export interface CaptureWindow {
  xPx: number;
  widthPx: number;
  /** Physical width the slice represents, in inches. */
  widthIn: number;
}

function px(inches: number, dpi: number): number {
  return Math.round(inches * dpi);
}

/**
 * Split total bleed pixels around a trim axis. Fractional physical bleed (for
 * example 0.125″ × 300dpi = 37.5px) is assigned deterministically so the two
 * sides plus trim always equal the actual raster dimension.
 */
export function splitBleedPixels(
  surfacePx: number,
  trimPx: number,
  nominalBleedPx: number,
): { start: number; end: number } {
  const total = Math.max(0, surfacePx - trimPx);
  const start = Math.min(total, Math.max(0, Math.round(nominalBleedPx)));
  return { start, end: total - start };
}

/**
 * Geometry for one rendered surface.
 *
 * `spread` doubles the trim width: a double-page spread is drawn as a single
 * continuous surface and only split into leaves at capture time, so the
 * artwork stays continuous across the gutter.
 *
 * `bleed: false` produces a trim-sized surface — what the digital edition
 * wants, since nothing is cut off a screen.
 */
export function pageGeometry(
  product: Pick<BookProduct, "trim" | "bleedIn">,
  opts: { dpi: number; bleed: boolean; spread?: boolean },
): PageGeometry {
  const bleedIn = opts.bleed ? product.bleedIn : 0;
  const trimWidthIn = product.trim.widthIn * (opts.spread ? 2 : 1);
  const trimHeightIn = product.trim.heightIn;
  const widthIn = trimWidthIn + bleedIn * 2;
  const heightIn = trimHeightIn + bleedIn * 2;
  return {
    dpi: opts.dpi,
    bleedIn,
    // Deliberately NOT rounded. At 300dpi an eighth-inch bleed is 37.5px, and
    // rounding it makes the trim box inside the surface disagree with the trim
    // box computed from inches by a pixel. CSS is happy with a fractional
    // offset; only the capture elements themselves need integer sizes.
    bleedPx: bleedIn * opts.dpi,
    trimWidthIn,
    trimHeightIn,
    trimWidthPx: px(trimWidthIn, opts.dpi),
    trimHeightPx: px(trimHeightIn, opts.dpi),
    widthIn,
    heightIn,
    widthPx: px(widthIn, opts.dpi),
    heightPx: px(heightIn, opts.dpi),
  };
}

/**
 * Split a spread surface into the two leaves it prints as.
 *
 * Each leaf is a full bleed-sized page, so the two windows OVERLAP by twice
 * the bleed across the centre line: the left leaf needs artwork continuing
 * past the gutter to bleed off its inner edge, and so does the right one. That
 * duplicated strip is what gets trimmed and glued, and is exactly how a
 * facing-page illustration is meant to be supplied.
 */
export function spreadLeaves(spread: PageGeometry): Record<LeafSide, CaptureWindow> {
  // Derived from inches, not from the surface's pixel width, so a leaf comes
  // out byte-identical in size to a single page rendered on its own.
  const widthIn = spread.trimWidthIn / 2 + spread.bleedIn * 2;
  const widthPx = px(widthIn, spread.dpi);
  return {
    left: { xPx: 0, widthPx, widthIn },
    right: { xPx: spread.widthPx - widthPx, widthPx, widthIn },
  };
}

/**
 * The slice of a rendered cover surface that becomes a wraparound panel.
 *
 * A panel spans the trim plus the OUTER bleed only — its inner edge butts
 * against the spine and is never cut, so including the inner bleed there would
 * squeeze the artwork inward by an eighth of an inch.
 */
export function coverPanelWindow(cover: PageGeometry, side: LeafSide): CaptureWindow {
  const widthIn = cover.trimWidthIn + cover.bleedIn;
  const widthPx = px(widthIn, cover.dpi);
  // "left" is the back panel: its outer edge is on the left, so the slice
  // starts at 0 and drops the inner bleed. The front panel mirrors it.
  return side === "left"
    ? { xPx: 0, widthPx, widthIn }
    : { xPx: cover.widthPx - widthPx, widthPx, widthIn };
}

/**
 * How far a cover's artwork extends past the trim on its outer edges, read off
 * the provider's own cover height.
 *
 * Height is the one dimension with no spine or hinge in it, so
 * `(coverHeight − trimHeight) / 2` is exactly the extension on the top and
 * bottom — and the wrap/bleed is the same all the way round the outside, so it
 * is also the extension on the outer side edges. That makes it right for a
 * paperback (the 0.125" bleed) and a hardcover (the wrap, which is several
 * times larger) alike, without a per-binding constant that could be wrong for a
 * trim or paper we haven't seen. Whatever width is left between the two panels
 * is the spine plus its hinges, which `buildCoverPdf` centres the spine in.
 *
 * Rounded to a thousandth of an inch: the provider reports points, and the
 * conversion to inches leaves float dust that would otherwise make two renders
 * of the same cover disagree by a pixel.
 */
export function coverExtensionFromHeight(coverHeightIn: number, trimHeightIn: number): number {
  const ext = (coverHeightIn - trimHeightIn) / 2;
  if (!Number.isFinite(ext) || ext < 0) {
    throw new Error(
      `The printer's cover is ${coverHeightIn.toFixed(3)}″ tall for a ${trimHeightIn.toFixed(3)}″ book, which can't wrap it.`,
    );
  }
  return Math.round(ext * 1000) / 1000;
}

/**
 * The spine band's width for a cover of these dimensions, in inches: whatever
 * the two panels (and a dust jacket's two flaps) leave of the provider's width.
 */
export function coverSpineWidthIn(cover: {
  widthIn: number;
  panelWidthIn: number;
  flapWidthIn?: number;
}): number {
  return Math.max(0, cover.widthIn - cover.panelWidthIn * 2 - Math.max(0, cover.flapWidthIn ?? 0) * 2);
}

/** A rectangle normalized to the TRIM box (0..1), for placement checks. */
export interface SafeArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * True when `rect` (normalized to the trim box) fits inside `area`. The area
 * itself comes from `computePageGuides` (core/book/format), the one margin
 * rule both the layouts and the print check use.
 */
export function withinSafeArea(
  rect: { x: number; y: number; w: number; h: number },
  area: SafeArea,
  tolerance = 0.005,
): boolean {
  return (
    rect.x >= area.x - tolerance &&
    rect.y >= area.y - tolerance &&
    rect.x + rect.w <= area.x + area.w + tolerance &&
    rect.y + rect.h <= area.y + area.h + tolerance
  );
}
