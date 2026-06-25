/**
 * Curated Lulu book-product catalog.
 *
 * Each entry maps a user-facing size/format to a Lulu `pod_package_id` (SKU) and
 * its physical trim. Lulu encodes every product as a modular, dotted code:
 *
 *   [Trim].[Ink].[Quality].[Binding].[Paper].[Finish]
 *   e.g. 0850X0850.FC.STD.SS.080CW444.GXX
 *        └ 8.5×8.5" │ full color │ standard │ saddle-stitch │ 80# coated white │ gloss, no linen, no foil
 *
 * These are a best-effort starting set chosen for young children (small, thin,
 * full-color, low page minimums). SKUs, exact trims, paper codes and minimum
 * page counts MUST be confirmed against Lulu's Pricing Calculator / Product
 * Sheet before going live — hence `verified: false`. Once confirmed, flip the
 * flag and adjust the numbers.
 *
 * Page minimums by binding (Lulu): saddle-stitch 4–48, perfect-bound 32–800,
 * coil 2–470, casewrap (hardcover) 24–800.
 */
import type { BookProduct } from "../types";

/** Bleed Lulu expects on every edge (page size = trim + 0.25" total). */
const BOOK_BLEED_IN = 0.125;

/**
 * Lulu normalizes a print job into exactly two printables: the interior PDF and
 * a single wraparound cover PDF (front + spine + back). These names are the keys
 * under `printable_normalization` in the print-job request.
 */
const BOOK_PRINT_AREAS = { interior: "interior", cover: "cover" } as const;

export const LULU_BOOK_PRODUCTS: BookProduct[] = [
  {
    sku: "0850X0850.FC.STD.SS.080CW444.GXX",
    label: 'Square softcover · 8.5" (saddle-stitch)',
    description:
      "Square stapled softcover, full color, gloss. Thin and lightweight — supports as few as 4 pages, ideal for the youngest readers.",
    binding: "saddle-stitch",
    finish: "gloss",
    trim: { widthIn: 8.5, heightIn: 8.5 },
    aspect: 1,
    bleedIn: BOOK_BLEED_IN,
    minPages: 4,
    pageStep: 4, // saddle-stitch is folded sheets → multiples of 4
    printAreas: { ...BOOK_PRINT_AREAS },
    verified: false,
  },
  {
    sku: "0750X0750.FC.STD.SS.080CW444.MXX",
    label: 'Small square softcover · 7.5" (saddle-stitch)',
    description:
      "Smaller square stapled softcover, full color, matte. Easy for little hands; supports very low page counts.",
    binding: "saddle-stitch",
    finish: "matte",
    trim: { widthIn: 7.5, heightIn: 7.5 },
    aspect: 1,
    bleedIn: BOOK_BLEED_IN,
    minPages: 4,
    pageStep: 4,
    printAreas: { ...BOOK_PRINT_AREAS },
    verified: false,
  },
  {
    sku: "0850X0850.FC.STD.CW.080CW444.GXX",
    label: 'Square hardcover · 8.5" (casewrap)',
    description:
      "Square hardcover with the image printed on the case, full color, gloss. Durable keepsake format (minimum 24 pages).",
    binding: "casewrap",
    finish: "gloss",
    trim: { widthIn: 8.5, heightIn: 8.5 },
    aspect: 1,
    bleedIn: BOOK_BLEED_IN,
    minPages: 24,
    pageStep: 2,
    printAreas: { ...BOOK_PRINT_AREAS },
    verified: false,
  },
  {
    sku: "1100X0850.FC.STD.CW.080CW444.GXX",
    label: 'Landscape hardcover · 11×8.5" (casewrap)',
    description:
      "Wide landscape hardcover, full color, gloss. Great for panoramic spreads (minimum 24 pages).",
    binding: "casewrap",
    finish: "gloss",
    trim: { widthIn: 11, heightIn: 8.5 },
    aspect: 11 / 8.5,
    bleedIn: BOOK_BLEED_IN,
    minPages: 24,
    pageStep: 2,
    printAreas: { ...BOOK_PRINT_AREAS },
    verified: false,
  },
];

export function findBookProduct(sku: string): BookProduct | undefined {
  return LULU_BOOK_PRODUCTS.find((p) => p.sku === sku);
}

/** Round a desired interior page count up to a valid count for the product. */
export function normalizePageCount(product: BookProduct, pages: number): number {
  const min = Math.max(product.minPages, pages);
  const step = product.pageStep || 1;
  return Math.ceil(min / step) * step;
}
