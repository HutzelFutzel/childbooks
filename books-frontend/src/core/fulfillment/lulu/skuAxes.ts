/**
 * The anatomy of a Lulu `pod_package_id`, so a SKU can be assembled from
 * choices instead of typed as 27 opaque characters — and so a customer's variant
 * choice can be turned into the code that prints it.
 *
 * This file is the ONLY place the provider's encoding is spelled out. Everything
 * upstream speaks the domain values in `config/variants.ts` (`premium-colour`,
 * `60-uncoated-cream`), which outlive any one provider; the tables here are the
 * translation, and a provider change replaces this file rather than the catalog.
 *
 * Lulu publishes no endpoint that enumerates valid packages, so THE OPTION LISTS
 * ARE NOT A GUARANTEE. Whether a particular combination exists is decided by
 * asking the provider to price it (`probeSku`, or `yarn probe:print` for a
 * sweep). What that sweep found, most recently across all 288 combinations of the
 * three children's-book trims: no saddle stitch at 11×8.5" at all, no colour ink
 * on cream paper anywhere, and no standard colour on saddle stitch — 212
 * sellable. Sandbox and live agreed exactly. Linen wrap was rejected in every
 * combination, so it isn't offered here.
 *
 * Sweep the CROSS PRODUCT, not one axis at a time. Holding the other fields at a
 * known-good colour hardcover is how cream paper was written off as nonexistent:
 * it is real, and only colour ink can't print on it.
 *
 *   [Trim 9][Ink 2][Quality 3][Binding 2][Paper 8][Finish 1][Linen 1][Foil 1]
 *   0850X0850 FC PRE CW 080CW444 G X X   → 27 characters, no separators
 */
import { optionMediaKey } from "../../config/catalogMedia";
import {
  COVER_FINISHES,
  PAPER_STOCKS,
  variantMediaKey,
  type VariantAxisId,
  type VariantOptionDef,
  type VariantSelection,
} from "../../config/variants";
import type { Binding } from "../types";

// ---- Domain value ⇄ provider code ------------------------------------------

/**
 * A print tier is one customer choice encoded as two SKU fields. Splitting it
 * here rather than in the catalog is the whole point: the pair `BW`+`STD` means
 * nothing to a buyer, and not every pair is sold.
 */
export const PRINT_TIER_CODES: Record<string, { ink: string; quality: string }> = {
  "premium-colour": { ink: "FC", quality: "PRE" },
  "standard-colour": { ink: "FC", quality: "STD" },
  "premium-bw": { ink: "BW", quality: "PRE" },
  "standard-bw": { ink: "BW", quality: "STD" },
};

/** The trailing `444` is the paper's PPI (pages per inch), fixed per stock. */
export const PAPER_CODES: Record<string, string> = {
  "80-coated-white": "080CW444",
  "60-uncoated-white": "060UW444",
  "60-uncoated-cream": "060UC444",
};

export const FINISH_CODES: Record<string, string> = { gloss: "G", matte: "M" };

export const BINDING_CODES: Record<Binding, string> = {
  "saddle-stitch": "SS",
  "perfect-bound": "PB",
  "coil-bound": "CO",
  casewrap: "CW",
  "linen-wrap": "LW",
};

function invert(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([value, code]) => [code, value]));
}

/**
 * The catalog binding a code maps to, for keeping `spec.binding` in step.
 * Includes linen wrap even though the builder no longer offers it, so a SKU
 * pasted in by hand still maps to the right spec.
 */
export const BINDING_BY_CODE: Record<string, string> = invert(BINDING_CODES);

const PAPER_BY_CODE = invert(PAPER_CODES);
const FINISH_BY_CODE = invert(FINISH_CODES);

/** Print tier for an ink+quality pair, or undefined for a pair we don't offer. */
function printTierFor(ink: string, quality: string): string | undefined {
  return Object.entries(PRINT_TIER_CODES).find(
    ([, code]) => code.ink === ink && code.quality === quality,
  )?.[0];
}

// ---- The encoding ----------------------------------------------------------

export type SkuAxisId = "trim" | "ink" | "quality" | "binding" | "paper" | "finish" | "linen" | "foil";

export interface SkuAxisOption {
  code: string;
  label: string;
  /** Longer explanation for the admin UI, where the code alone is cryptic. */
  hint?: string;
  /**
   * Where this option's pictures are filed (`option/feature/value`, see
   * `catalogMedia.ts`). Present on the fields that describe a FORMAT; the
   * customer-chosen axes carry their pictures on the variant option instead
   * (`variantMediaKey`), since ink and quality are one choice to a buyer.
   */
  mediaKey?: string;
}

export interface SkuAxis {
  id: SkuAxisId;
  label: string;
  /** Fixed field width in characters — the encoding has no separators. */
  width: number;
  options: SkuAxisOption[];
  /** Trim is computed from dimensions rather than picked from a list. */
  computed?: boolean;
}

/** Options for a variant axis, carrying the vocabulary's own labels and photos. */
function variantAxisOptions(
  axis: VariantAxisId,
  codes: Record<string, string>,
  options: VariantOptionDef[],
): SkuAxisOption[] {
  return options
    .filter((o) => codes[o.value])
    .map((o) => ({
      code: codes[o.value],
      label: o.label,
      hint: o.hint,
      mediaKey: variantMediaKey(axis, o.value),
    }));
}

export const SKU_AXES: SkuAxis[] = [
  {
    id: "trim",
    label: "Trim size",
    width: 9,
    computed: true,
    options: [
      { code: "0850X0850", label: 'Square 8.5 × 8.5"', mediaKey: optionMediaKey("trim", "8.5x8.5") },
      { code: "1100X0850", label: 'Landscape 11 × 8.5"', mediaKey: optionMediaKey("trim", "11x8.5") },
      { code: "0850X1100", label: 'Portrait 8.5 × 11"', mediaKey: optionMediaKey("trim", "8.5x11") },
      { code: "0600X0900", label: 'Digest 6 × 9"', mediaKey: optionMediaKey("trim", "6x9") },
      { code: "0750X0750", label: 'Square 7.5 × 7.5"', mediaKey: optionMediaKey("trim", "7.5x7.5") },
    ],
  },
  // Ink and quality are the two halves of one customer-facing print tier, so they
  // are listed only as the encoding needs them: no hints, no pictures. The admin
  // and the storefront both choose from PRINT_TIERS instead.
  {
    id: "ink",
    label: "Interior ink",
    width: 2,
    options: [
      { code: "FC", label: "Full colour" },
      { code: "BW", label: "Black & white" },
    ],
  },
  {
    id: "quality",
    label: "Print quality",
    width: 3,
    options: [
      { code: "PRE", label: "Premium" },
      { code: "STD", label: "Standard" },
    ],
  },
  {
    id: "binding",
    label: "Binding",
    width: 2,
    options: [
      {
        code: "SS",
        label: "Saddle stitch",
        hint: "Folded sheets stapled through the fold. No flat spine, so nothing prints on the edge. Thin books only, and the cheapest to make.",
        mediaKey: optionMediaKey("binding", "saddle-stitch"),
      },
      {
        code: "PB",
        label: "Perfect bound",
        hint: "Pages glued into a flat printed spine, like a normal paperback. Needs enough thickness to glue.",
        mediaKey: optionMediaKey("binding", "perfect-bound"),
      },
      {
        code: "CW",
        label: "Casewrap hardcover",
        hint: "Artwork printed straight onto the board and laminated. The standard picture-book hardcover.",
        mediaKey: optionMediaKey("binding", "casewrap"),
      },
      {
        code: "CO",
        label: "Coil bound",
        hint: "A spiral through punched holes, so the book lies completely flat. Suits workbooks; doesn't look like a trade book.",
        mediaKey: optionMediaKey("binding", "coil-bound"),
      },
    ],
  },
  { id: "paper", label: "Paper", width: 8, options: variantAxisOptions("paper", PAPER_CODES, PAPER_STOCKS) },
  {
    id: "finish",
    label: "Cover finish",
    width: 1,
    options: variantAxisOptions("finish", FINISH_CODES, COVER_FINISHES),
  },
  // Linen and foil describe how a CLOTH case is decorated, and the linen-wrap
  // binding isn't offered here — every combination of these two with LW was
  // rejected. They stay as fixed fields because the encoding reserves their two
  // positions; with a single option each, the builder doesn't render them.
  {
    id: "linen",
    label: "Linen",
    width: 1,
    options: [{ code: "X", label: "None" }],
  },
  {
    id: "foil",
    label: "Foil stamping",
    width: 1,
    options: [{ code: "X", label: "None" }],
  },
];

export type SkuParts = Record<SkuAxisId, string>;

export const SKU_LENGTH = SKU_AXES.reduce((sum, a) => sum + a.width, 0);

/** Trim code for a page size in inches: hundredths, width then height. */
export function trimCode(widthIn: number, heightIn: number): string {
  const enc = (n: number) => String(Math.round(n * 100)).padStart(4, "0");
  return `${enc(widthIn)}X${enc(heightIn)}`;
}

/** Inverse of {@link trimCode}; null when the field isn't a WWWWxHHHH code. */
export function parseTrimCode(code: string): { widthIn: number; heightIn: number } | null {
  const m = code.match(/^(\d{4})X(\d{4})$/i);
  if (!m) return null;
  return { widthIn: Number(m[1]) / 100, heightIn: Number(m[2]) / 100 };
}

/**
 * Axes worth showing: a field with one possible value is a constant, not a
 * choice, and rendering it only adds noise.
 */
export function isChoiceAxis(axis: SkuAxis): boolean {
  return axis.options.length > 1;
}

/** Join the fields into the contiguous form Lulu accepts. */
export function composeSku(parts: SkuParts): string {
  return SKU_AXES.map((a) => (parts[a.id] ?? "").toUpperCase()).join("");
}

/**
 * Split a SKU into its fields by position. Returns null unless the length is
 * exactly right — a partial parse would silently mislabel every field after the
 * first bad one.
 */
export function parseSku(sku: string): SkuParts | null {
  const s = (sku ?? "").trim().toUpperCase();
  if (s.length !== SKU_LENGTH) return null;
  const parts = {} as SkuParts;
  let at = 0;
  for (const axis of SKU_AXES) {
    parts[axis.id] = s.slice(at, at + axis.width);
    at += axis.width;
  }
  return parts;
}

/** Default fields: the combination Lulu recommends for children's books. */
export function defaultSkuParts(): SkuParts {
  return {
    trim: "0850X0850",
    ink: "FC",
    quality: "PRE",
    binding: "CW",
    paper: "080CW444",
    finish: "G",
    linen: "X",
    foil: "X",
  };
}

// ---- Variants ⇄ SKUs -------------------------------------------------------

/** The SKU fields a variant selection controls, encoded. */
export function skuPartsForVariant(selection: VariantSelection): Partial<SkuParts> | null {
  const print = PRINT_TIER_CODES[selection.print];
  const paper = PAPER_CODES[selection.paper];
  const finish = FINISH_CODES[selection.finish];
  if (!print || !paper || !finish) return null;
  return { ink: print.ink, quality: print.quality, paper, finish };
}

/**
 * The SKU that prints `selection` of the format `baseSku` describes — the code
 * an order is actually placed with. Null when either the base SKU or a selected
 * value is unknown, because a half-translated SKU would be a real package that
 * prints the wrong book.
 */
export function skuForVariant(baseSku: string, selection: VariantSelection): string | null {
  const parts = parseSku(baseSku);
  const overrides = skuPartsForVariant(selection);
  if (!parts || !overrides) return null;
  return composeSku({ ...parts, ...overrides });
}

/** The variant a SKU encodes, or null if any field isn't one we offer. */
export function variantFromSku(sku: string): VariantSelection | null {
  const parts = parseSku(sku);
  if (!parts) return null;
  const print = printTierFor(parts.ink, parts.quality);
  const paper = PAPER_BY_CODE[parts.paper];
  const finish = FINISH_BY_CODE[parts.finish];
  if (!print || !paper || !finish) return null;
  return { print, paper, finish };
}

/**
 * Whether two SKUs describe the same FORMAT — same trim and binding, whatever
 * the variant. How an order's concrete SKU is traced back to its product.
 */
export function sameFormat(a: string, b: string): boolean {
  const pa = parseSku(a);
  const pb = parseSku(b);
  return pa != null && pb != null && pa.trim === pb.trim && pa.binding === pb.binding;
}

/** Print tier for the ink+quality a SKU encodes (used to label a format). */
export function printTierOfSku(sku: string): string | undefined {
  const parts = parseSku(sku);
  return parts ? printTierFor(parts.ink, parts.quality) : undefined;
}
