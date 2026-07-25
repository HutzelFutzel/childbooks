/**
 * Curated Lulu book-format catalog.
 *
 * A FORMAT is a trim size bound to a binding — the two decisions that change how
 * the book is physically built, and therefore the print files, the page limits
 * and the cover geometry. Everything else the provider offers (print tier, paper,
 * cover finish) is a VARIANT chosen at checkout; see `config/variants.ts` for why
 * those don't multiply into this list.
 *
 * A `pod_package_id` is a 27-character string with NO separators, built from
 * eight fixed-width fields (`skuAxes.ts` owns the encoding):
 *
 *   [Trim][Ink][Quality][Binding][Paper][Finish][Linen][Foil]
 *   0850X0850  FC  PRE  CW  080CW444  G  X  X
 *   └ 8.5×8.5" │ full color │ premium │ casewrap │ 80# coated white, 444 PPI
 *                                                │ gloss │ no linen │ no foil
 *
 * (Docs and admin UIs often show the code dotted for legibility — never send it
 * that way; Lulu validates the contiguous 27-character form.)
 *
 * Each format's SKU is composed from its trim and binding plus the BASE VARIANT:
 * premium colour on 80# coated white with a gloss cover. That variant is both the
 * provider's own recommendation for children's books and the most expensive one
 * we sell, which is what keeps the cost table a safe fallback — see
 * `costRank` in `config/variants.ts`.
 *
 * PAGE RANGES ARE MEASURED, NOT ASSUMED. They vary by binding AND trim, so no
 * range can be borrowed from a sibling that shares a binding: perfect-bound
 * allows 32–800 pages at 8.5×8.5" but only 32–250 at 11×8.5", and saddle stitch
 * doesn't exist at 11×8.5" at all. Every number below comes from
 * `/print-job-cost-calculations/`, which validates the package and the page count
 * together (`yarn probe:print` sweeps, `yarn check:print` regression-checks).
 * `/cover-dimensions/` is NOT a substitute: it computes geometry from the fields
 * in the code and returns 200 for packages that do not exist.
 *
 * This list only seeds the admin catalog. Whether a SKU is sellable is decided
 * per environment by the verification recorded on the product itself
 * (`provider.verifiedIn`) — sandbox and live are separate catalogs, so nothing
 * static here can speak for both.
 */
import {
  createDefaultVariantPolicy,
  variantKey,
  type ProductVariantPolicy,
  type VariantMatch,
  type VariantSelection,
} from "../../config/variants";
import type { Binding, BookProduct } from "../types";
import { BINDING_CODES, composeSku, defaultSkuParts, skuPartsForVariant, trimCode } from "./skuAxes";

/** Bleed Lulu expects on every edge (page size = trim + 0.25" total). */
const BOOK_BLEED_IN = 0.125;

/**
 * Lulu normalizes a print job into exactly two printables: the interior PDF and
 * a single wraparound cover PDF (front + spine + back). These names are the keys
 * under `printable_normalization` in the print-job request.
 */
const BOOK_PRINT_AREAS = { interior: "interior", cover: "cover" } as const;

/**
 * What every format is priced and verified as by default: the provider's
 * recommended children's-book stock, and the priciest variant we offer.
 */
export const BASE_VARIANT: VariantSelection = {
  print: "premium-colour",
  paper: "80-coated-white",
  finish: "gloss",
};

interface TrimDef {
  /** Also the `option/trim/{id}` media key and the trim's storefront identity. */
  id: string;
  widthIn: number;
  heightIn: number;
  /** Shape word that leads the format's name. */
  shape: string;
  blurb: string;
}

const TRIMS: TrimDef[] = [
  {
    id: "8.5x8.5",
    widthIn: 8.5,
    heightIn: 8.5,
    shape: "Square",
    blurb: 'Square 8.5" pages — the classic picture-book shape, equally happy with a full-page illustration or a spread.',
  },
  {
    id: "11x8.5",
    widthIn: 11,
    heightIn: 8.5,
    shape: "Landscape",
    blurb: 'Wide 11 × 8.5" pages that give a panoramic spread almost two feet of artwork.',
  },
  {
    id: "8.5x11",
    widthIn: 8.5,
    heightIn: 11,
    shape: "Portrait",
    blurb: 'Tall 8.5 × 11" US Letter pages — the storybook shape, and roomy for text.',
  },
];

interface BindingDef {
  id: Binding;
  /** Noun the format is named with, e.g. "hardcover". */
  noun: string;
  blurb: string;
  /** The multiple a page count must align to (a leaf is two pages). */
  pageStep: number;
}

const BINDINGS_BY_ID: Record<string, BindingDef> = {
  "saddle-stitch": {
    id: "saddle-stitch",
    noun: "stapled paperback",
    blurb: "Folded sheets stapled through the fold, so it opens flat and weighs almost nothing. No spine to print on, and thin books only.",
    // Folded sheets come in fours; the cost endpoint is laxer than the bindery.
    pageStep: 4,
  },
  "perfect-bound": {
    id: "perfect-bound",
    noun: "paperback",
    blurb: "Pages glued into a flat printed spine, like any trade paperback. Needs enough thickness to glue.",
    pageStep: 2,
  },
  "coil-bound": {
    id: "coil-bound",
    noun: "coil-bound paperback",
    blurb: "A spiral through punched holes, so the book lies perfectly flat on a table. Made for reading along and colouring in; it won't look like a trade book.",
    pageStep: 2,
  },
  casewrap: {
    id: "casewrap",
    noun: "hardcover",
    blurb: "Artwork printed straight onto the board and laminated. The keepsake format, and what a gift copy should be.",
    pageStep: 2,
  },
};

/**
 * The formats, with the page range each was measured to accept. A trim × binding
 * pair the provider doesn't sell is simply absent — 11×8.5" saddle stitch does
 * not exist, which is why the landscape paperback is perfect-bound.
 */
const FORMAT_ROWS: { trim: string; binding: Binding; pages: { min: number; max: number } }[] = [
  { trim: "8.5x8.5", binding: "saddle-stitch", pages: { min: 4, max: 48 } },
  { trim: "8.5x8.5", binding: "perfect-bound", pages: { min: 32, max: 800 } },
  { trim: "8.5x8.5", binding: "coil-bound", pages: { min: 2, max: 470 } },
  { trim: "8.5x8.5", binding: "casewrap", pages: { min: 24, max: 800 } },
  { trim: "11x8.5", binding: "perfect-bound", pages: { min: 32, max: 250 } },
  { trim: "11x8.5", binding: "coil-bound", pages: { min: 2, max: 470 } },
  { trim: "11x8.5", binding: "casewrap", pages: { min: 24, max: 800 } },
  { trim: "8.5x11", binding: "saddle-stitch", pages: { min: 4, max: 48 } },
  { trim: "8.5x11", binding: "perfect-bound", pages: { min: 32, max: 800 } },
  { trim: "8.5x11", binding: "coil-bound", pages: { min: 2, max: 470 } },
  { trim: "8.5x11", binding: "casewrap", pages: { min: 24, max: 800 } },
];

/**
 * Print tiers each binding offers. Measured: saddle stitch has no standard-colour
 * package at any trim, while every other binding has all four tiers.
 */
const PRINT_TIERS_BY_BINDING: Record<string, string[]> = {
  "saddle-stitch": ["premium-colour", "premium-bw", "standard-bw"],
};

const ALL_PRINT_TIERS = ["premium-colour", "standard-colour", "premium-bw", "standard-bw"];
const ALL_PAPERS = ["80-coated-white", "60-uncoated-white", "60-uncoated-cream"];
const ALL_FINISHES = ["gloss", "matte"];

/**
 * Measured, and true at every trim and binding: cream is a black & white stock.
 * Listed for both colour tiers rather than derived from "is this ink colour",
 * because it's an observation about the provider's catalog, not a law of printing.
 */
const NO_COLOUR_ON_CREAM: VariantMatch[] = [
  { print: "premium-colour", paper: "60-uncoated-cream" },
  { print: "standard-colour", paper: "60-uncoated-cream" },
];

/** `Square hardcover · 8.5 × 8.5"` — generated, so no two formats drift apart. */
function formatLabel(trim: TrimDef, binding: BindingDef): string {
  const size = `${trim.widthIn} × ${trim.heightIn}″`;
  return `${trim.shape} ${binding.noun} · ${size}`;
}

function formatDescription(
  trim: TrimDef,
  binding: BindingDef,
  pages: { min: number; max: number },
): string {
  return `${binding.blurb} ${trim.blurb} Takes ${pages.min}–${pages.max} pages.`;
}

/** What this format is measured to offer, as a policy the seed can adopt. */
function variantPolicyFor(binding: Binding): ProductVariantPolicy {
  const policy = createDefaultVariantPolicy();
  const prints = PRINT_TIERS_BY_BINDING[binding] ?? ALL_PRINT_TIERS;
  policy.options.print = prints.map((value) => ({ value }));
  policy.options.paper = ALL_PAPERS.map((value) => ({ value }));
  policy.options.finish = ALL_FINISHES.map((value) => ({ value }));
  policy.exclusions = NO_COLOUR_ON_CREAM.map((rule) => ({ ...rule }));
  return policy;
}

/** One sellable format: the book, plus the variants of it the provider offers. */
export interface LuluBookFormat {
  product: BookProduct;
  variants: ProductVariantPolicy;
}

/**
 * The format's own SKU, composed rather than written out: a hand-typed
 * 27-character code that's subtly wrong is a package that doesn't exist, and the
 * mistake only surfaces when a customer's order is rejected.
 */
function baseSkuFor(trim: TrimDef, binding: BindingDef): string {
  const variant = skuPartsForVariant(BASE_VARIANT);
  if (!variant) throw new Error(`Base variant ${variantKey(BASE_VARIANT)} has no provider encoding.`);
  return composeSku({
    ...defaultSkuParts(),
    trim: trimCode(trim.widthIn, trim.heightIn),
    binding: BINDING_CODES[binding.id],
    ...variant,
  });
}

function buildFormat(row: (typeof FORMAT_ROWS)[number]): LuluBookFormat {
  const trim = TRIMS.find((t) => t.id === row.trim);
  const binding = BINDINGS_BY_ID[row.binding];
  if (!trim || !binding) throw new Error(`Unknown format ${row.trim} / ${row.binding}.`);
  const sku = baseSkuFor(trim, binding);
  return {
    product: {
      sku,
      label: formatLabel(trim, binding),
      description: formatDescription(trim, binding, row.pages),
      binding: binding.id,
      finish: BASE_VARIANT.finish as BookProduct["finish"],
      trim: { widthIn: trim.widthIn, heightIn: trim.heightIn },
      aspect: trim.widthIn / trim.heightIn,
      bleedIn: BOOK_BLEED_IN,
      minPages: row.pages.min,
      pageStep: binding.pageStep,
      maxPages: row.pages.max,
      printAreas: { ...BOOK_PRINT_AREAS },
    },
    variants: variantPolicyFor(binding.id),
  };
}

export const LULU_BOOK_FORMATS: LuluBookFormat[] = FORMAT_ROWS.map(buildFormat);

export const LULU_BOOK_PRODUCTS: BookProduct[] = LULU_BOOK_FORMATS.map((f) => f.product);

export function findBookProduct(sku: string): BookProduct | undefined {
  return LULU_BOOK_PRODUCTS.find((p) => p.sku === sku);
}

/** The format catalog entry for a base SKU, with its variant policy. */
export function findBookFormat(sku: string): LuluBookFormat | undefined {
  return LULU_BOOK_FORMATS.find((f) => f.product.sku === sku);
}

/**
 * Round a desired interior page count up to a valid count for the product.
 *
 * Clamped to the product maximum: rounding past it would produce a count the
 * provider rejects, so callers must gate on `maxPages` themselves (see the
 * order flow's requirement check) rather than trust the returned number to be
 * printable for an over-long book.
 */
export function normalizePageCount(product: BookProduct, pages: number): number {
  const min = Math.max(product.minPages, pages);
  const step = product.pageStep || 1;
  return Math.min(Math.ceil(min / step) * step, product.maxPages);
}
