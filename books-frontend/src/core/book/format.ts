/**
 * Book **print-format** rules and pure resolvers.
 *
 * This is the offline source of truth for the geometry a book's binding + trim
 * imply — spine width, gutter (inside-margin) growth, safe margins, and which
 * physical elements exist (spine vs. no spine, etc.). Every rule here is
 * transcribed from Lulu's Book Creation Guide so the editor, the prompts and the
 * PDF export can all reason about a page the same way, without a network call.
 *
 * Authority note: for the *final* wraparound cover size, Lulu's cover-dimensions
 * API is authoritative (see `FulfillmentProvider.getCoverDimensionsMm`). The
 * numbers here are a faithful offline approximation used to preview and guide the
 * design before that round-trip — never the print truth on their own.
 *
 * Kept pure (no I/O, no React) so it can be unit-tested and reused everywhere.
 */
import type { NormRect } from "../design";
import type { Binding, BookProduct } from "../fulfillment/types";

// ---- Universal Lulu constants ---------------------------------------------

/** Safety margin inside the trim edge — keep text / important art within it. */
export const SAFETY_MARGIN_IN = 0.5;
/** Spine text is not allowed at or below this page count (too thin to place). */
export const SPINE_TEXT_MIN_PAGES = 80;
/** Minimum clearance to leave between spine text and each spine edge. */
export const SPINE_TEXT_CLEARANCE_IN = 0.125;

/**
 * Space reserved for the retail barcode on the back cover, inches. Lulu places
 * it bottom-right, kept inside the safety margin. This is a *placeholder* today
 * — we only reserve the area so cover art stays clear of it; the barcode itself
 * is a future feature.
 */
export const BARCODE_ZONE_IN = { widthIn: 2, heightIn: 1.2 };

/** Paperback spine width formula: `(pages / 444) + 0.06 in`. */
const PAPERBACK_SPINE_PER_PAGE_IN = 1 / 444;
const PAPERBACK_SPINE_BASE_IN = 0.06;

/**
 * Hardcover (casewrap / linen-wrap) spine width by page count, inches.
 * Transcribed from the Lulu guide table; the first matching row (pages ≤
 * `maxPages`) wins. Below the 24-page hardcover minimum there is no spine.
 */
const HARDCOVER_SPINE_TABLE: { maxPages: number; widthIn: number }[] = [
  { maxPages: 23, widthIn: 0 },
  { maxPages: 84, widthIn: 0.25 },
  { maxPages: 140, widthIn: 0.5 },
  { maxPages: 168, widthIn: 0.625 },
  { maxPages: 194, widthIn: 0.688 },
  { maxPages: 222, widthIn: 0.75 },
  { maxPages: 250, widthIn: 0.813 },
  { maxPages: 278, widthIn: 0.875 },
  { maxPages: 306, widthIn: 0.938 },
  { maxPages: 334, widthIn: 1 },
  { maxPages: 360, widthIn: 1.063 },
  { maxPages: 388, widthIn: 1.125 },
  { maxPages: 416, widthIn: 1.188 },
  { maxPages: 444, widthIn: 1.25 },
  { maxPages: 472, widthIn: 1.313 },
  { maxPages: 500, widthIn: 1.375 },
  { maxPages: 528, widthIn: 1.438 },
  { maxPages: 556, widthIn: 1.5 },
  { maxPages: 582, widthIn: 1.563 },
  { maxPages: 610, widthIn: 1.625 },
  { maxPages: 638, widthIn: 1.688 },
  { maxPages: 666, widthIn: 1.75 },
  { maxPages: 694, widthIn: 1.813 },
  { maxPages: 722, widthIn: 1.875 },
  { maxPages: 750, widthIn: 1.938 },
  { maxPages: 778, widthIn: 2 },
  { maxPages: 799, widthIn: 2.063 },
  { maxPages: Infinity, widthIn: 2.125 },
];

/**
 * Extra inside (gutter) margin to add on the binding side by page count, inches.
 * Lulu recommends a gutter for books over 60 pages; coil & saddle-stitch never
 * need one (handled by {@link bindingHasGutter}).
 */
const GUTTER_TABLE: { maxPages: number; addIn: number }[] = [
  { maxPages: 60, addIn: 0 },
  { maxPages: 150, addIn: 0.125 },
  { maxPages: 400, addIn: 0.5 },
  { maxPages: 600, addIn: 0.625 },
  { maxPages: Infinity, addIn: 0.75 },
];

// ---- Binding capabilities --------------------------------------------------

/** Whether a binding produces a real, printable spine (grows with page count). */
export function bindingHasSpine(binding: Binding): boolean {
  return binding === "perfect-bound" || binding === "casewrap" || binding === "linen-wrap";
}

/** Whether a binding needs an added gutter margin (same set as spine bindings). */
export function bindingHasGutter(binding: Binding): boolean {
  return bindingHasSpine(binding);
}

/** Human label for a binding, for editor hints. */
export function bindingLabel(binding: Binding): string {
  switch (binding) {
    case "saddle-stitch":
      return "saddle-stitch (stapled)";
    case "perfect-bound":
      return "perfect-bound paperback";
    case "coil-bound":
      return "coil / spiral bound";
    case "casewrap":
      return "casewrap hardcover";
    case "linen-wrap":
      return "linen-wrap hardcover";
  }
}

// ---- Spine + gutter resolvers ----------------------------------------------

function fromTable(table: { maxPages: number }[], pages: number): number {
  return Math.max(0, table.findIndex((r) => pages <= r.maxPages));
}

/** Spine width (inches) for a binding at a given interior page count. */
export function spineWidthIn(binding: Binding, pages: number): number {
  if (binding === "perfect-bound") {
    return pages * PAPERBACK_SPINE_PER_PAGE_IN + PAPERBACK_SPINE_BASE_IN;
  }
  if (binding === "casewrap" || binding === "linen-wrap") {
    const i = fromTable(HARDCOVER_SPINE_TABLE, pages);
    return HARDCOVER_SPINE_TABLE[i]?.widthIn ?? 0;
  }
  return 0; // saddle-stitch, coil — no spine
}

/** Extra inside (gutter) margin (inches) on the binding side for the page count. */
export function gutterInsetIn(binding: Binding, pages: number): number {
  if (!bindingHasGutter(binding)) return 0;
  const i = fromTable(GUTTER_TABLE, pages);
  return GUTTER_TABLE[i]?.addIn ?? 0;
}

// ---- Capabilities ----------------------------------------------------------

/**
 * Everything the editor needs to decide which controls / guides to show for a
 * given product at a given page count. Purely derived — recompute freely.
 */
export interface FormatCapabilities {
  binding: Binding;
  bindingLabel: string;
  trimWidthIn: number;
  trimHeightIn: number;
  aspect: number;
  bleedIn: number;
  safetyMarginIn: number;
  /** Interior page count this was resolved for. */
  pageCount: number;
  minPages: number;
  pageStep: number;
  /** Whether the cover has a printed spine (drives the spine band / spine text). */
  hasSpine: boolean;
  /** Spine width (inches) at this page count (0 when `!hasSpine`). */
  spineWidthIn: number;
  /** Whether spine text may be placed (needs a spine AND enough pages). */
  spineTextAllowed: boolean;
  /** Whether an added inside (gutter) margin applies. */
  hasGutter: boolean;
  /** Gutter margin (inches) on the binding side (0 when `!hasGutter`). */
  gutterInsetIn: number;
  /**
   * Whether interior art should bleed to the page edge. Children's picture books
   * are full-bleed by convention, so this is always true today; kept as a field
   * so a future "white-margin" format can opt out.
   */
  fullBleed: boolean;
}

/** Resolve the print capabilities for a product at a given interior page count. */
export function resolveFormatCapabilities(
  product: BookProduct,
  pageCount: number,
): FormatCapabilities {
  const pages = Math.max(product.minPages, Math.round(pageCount) || product.minPages);
  const hasSpine = bindingHasSpine(product.binding);
  const spine = spineWidthIn(product.binding, pages);
  const hasGutter = bindingHasGutter(product.binding);
  return {
    binding: product.binding,
    bindingLabel: bindingLabel(product.binding),
    trimWidthIn: product.trim.widthIn,
    trimHeightIn: product.trim.heightIn,
    aspect: product.aspect,
    bleedIn: product.bleedIn,
    safetyMarginIn: SAFETY_MARGIN_IN,
    pageCount: pages,
    minPages: product.minPages,
    pageStep: product.pageStep,
    hasSpine,
    spineWidthIn: spine,
    spineTextAllowed: hasSpine && pages > SPINE_TEXT_MIN_PAGES,
    hasGutter,
    gutterInsetIn: gutterInsetIn(product.binding, pages),
    fullBleed: true,
  };
}

// ---- Page geometry (normalized guides for the editor) ----------------------

/** Which edge of a single page binds into the spine (drives gutter placement). */
export type BindingSide = "left" | "right" | "center";

export interface PageGuides {
  /**
   * Safe-area rectangle (normalized 0..1 of the rendered surface): keep text and
   * important content inside it. Already includes the gutter inset on the
   * binding side.
   */
  safe: NormRect;
  /** Gutter band (normalized x + width of the surface), when a gutter applies. */
  gutter: { x: number; w: number } | null;
}

/**
 * Compute normalized guide rectangles for a page surface. `spread` widens the
 * surface to two trim pages and places the gutter down the center; single pages
 * put the gutter on `bindingSide`.
 *
 * The surface represents the TRIM area (what the editor renders). Bleed lives
 * outside the trim and is not drawn here.
 */
export function computePageGuides(input: {
  caps: FormatCapabilities;
  spread: boolean;
  bindingSide?: BindingSide;
}): PageGuides {
  const { caps, spread } = input;
  const trimW = caps.trimWidthIn;
  const trimH = caps.trimHeightIn;
  if (trimW <= 0 || trimH <= 0) {
    return { safe: { x: 0, y: 0, w: 1, h: 1 }, gutter: null };
  }

  // A spread surface is two trim pages wide, so horizontal fractions of a single
  // page's inches are halved when expressed against the whole surface.
  const surfaceWidthIn = spread ? trimW * 2 : trimW;
  const mx = caps.safetyMarginIn / surfaceWidthIn;
  const my = caps.safetyMarginIn / trimH;
  const gutterFrac = caps.gutterInsetIn / surfaceWidthIn;

  let left = mx;
  let right = mx;
  let gutter: PageGuides["gutter"] = null;

  if (caps.hasGutter && caps.gutterInsetIn > 0) {
    if (spread) {
      // Gutter straddles the center fold; the outer edges keep the plain margin
      // and the band itself flags the binding zone at the center.
      gutter = { x: 0.5 - gutterFrac, w: gutterFrac * 2 };
    } else {
      const side = input.bindingSide ?? "left";
      if (side === "left") {
        left += gutterFrac;
        gutter = { x: 0, w: mx + gutterFrac };
      } else if (side === "right") {
        right += gutterFrac;
        gutter = { x: 1 - (mx + gutterFrac), w: mx + gutterFrac };
      }
    }
  }

  const safe: NormRect = {
    x: left,
    y: my,
    w: Math.max(0, 1 - left - right),
    h: Math.max(0, 1 - my * 2),
  };
  return { safe, gutter };
}

/**
 * Reserved barcode rectangle for a single back-cover trim page (normalized 0..1).
 * Bottom-right corner, inset from the trim by the safety margin. Returns null for
 * a degenerate trim. See {@link BARCODE_ZONE_IN}.
 */
export function computeBarcodeZone(caps: FormatCapabilities): NormRect | null {
  const trimW = caps.trimWidthIn;
  const trimH = caps.trimHeightIn;
  if (trimW <= 0 || trimH <= 0) return null;

  const w = Math.min(0.6, BARCODE_ZONE_IN.widthIn / trimW);
  const h = Math.min(0.4, BARCODE_ZONE_IN.heightIn / trimH);
  const mx = caps.safetyMarginIn / trimW;
  const my = caps.safetyMarginIn / trimH;
  return {
    x: Math.max(0, 1 - mx - w),
    y: Math.max(0, 1 - my - h),
    w,
    h,
  };
}
