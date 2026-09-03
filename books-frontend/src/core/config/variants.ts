/**
 * **Print variants** — the choices a customer makes about the same physical book.
 *
 * A product is one *format*: a trim size bound to a binding. Those two decide
 * how the book is built, so they change the print files, the page limits and the
 * cover geometry, and each combination is its own {@link ProductDefinition}.
 * Everything else a print provider offers — how the interior is printed, which
 * paper it lands on, how the cover is laminated — changes only what the book
 * costs and what it feels like in the hand. Those are the axes here, and they are
 * chosen at checkout on top of a format rather than multiplied into the catalog:
 * three formats × four bindings × four print tiers × three papers × two finishes
 * is 212 sellable combinations, and 212 product records would each want their own
 * prices, cost calibration and verification for no gain.
 *
 * Values are DOMAIN values, never a provider's SKU encoding (`premium-colour`,
 * not `FCPRE`). They key the pictures in `catalogMedia.ts`, they are what a
 * customer's order records, and they must survive changing print providers. The
 * mapping to a `pod_package_id` lives in `fulfillment/lulu/skuAxes.ts`.
 *
 * The option lists below are what the provider was MEASURED to sell (see
 * `scripts/probe-print-matrix.mjs`); which of them a given format offers is per
 * product, in its {@link ProductVariantPolicy}.
 */
import { optionMediaKey, type PrintOptionFeature } from "./catalogMedia";

/**
 * The axes a customer picks. Also the media-key features and the segments of a
 * variant key, in this order — adding an axis means adding it here, to
 * {@link VARIANT_AXIS_DEFS} and to `PRINT_OPTION_FEATURES`, and nothing else
 * iterates them by hand.
 */
export const VARIANT_AXES = ["print", "paper", "finish"] as const;

export type VariantAxisId = (typeof VARIANT_AXES)[number];

/** One option on an axis, described for the people choosing it. */
export interface VariantOptionDef {
  /** Durable domain id; a segment of the media key and of the variant key. */
  value: string;
  label: string;
  /** Why a customer would pick this one. Shown in the storefront and the admin. */
  hint: string;
  /**
   * Relative wholesale cost, 0 = cheapest, measured against Lulu at a fixed
   * format. Not money: only the ORDER is meaningful, and only for keeping the
   * cost-table fallback conservative (see `productValidation.ts`). What we
   * actually pay comes from a live quote for the composed SKU.
   */
  costRank: number;
}

/**
 * Interior ink and print quality as the single choice they are to a customer.
 * Providers encode them separately; nobody shopping for a picture book wants to
 * pick "ink" and then "quality" and discover the pair isn't sold.
 */
export const PRINT_TIERS: VariantOptionDef[] = [
  {
    value: "premium-colour",
    label: "Premium colour",
    hint: "Richest colour and the sharpest registration. What illustrated pages are worth, and the provider's own pick for children's books.",
    costRank: 3,
  },
  {
    value: "standard-colour",
    label: "Standard colour",
    hint: "Colour on every page at about a third of the premium price per page. Colours read a little flatter.",
    costRank: 2,
  },
  {
    value: "premium-bw",
    label: "Premium black & white",
    hint: "Deep blacks and fine greys for pencil and ink work. Illustrations print as monochrome.",
    costRank: 1,
  },
  {
    value: "standard-bw",
    label: "Standard black & white",
    hint: "The cheapest way to print a long book. Right for text-led chapter books, wrong for colour art.",
    costRank: 0,
  },
];

export const PAPER_STOCKS: VariantOptionDef[] = [
  {
    value: "80-coated-white",
    label: "80# coated white",
    hint: "Heavy and smooth with a slight sheen, so colours pop. The provider's recommendation for picture books.",
    costRank: 2,
  },
  {
    value: "60-uncoated-white",
    label: "60# uncoated white",
    hint: "Lighter and matte, more like a novel. Softer colour, thinner and cheaper book.",
    costRank: 1,
  },
  {
    value: "60-uncoated-cream",
    label: "60# uncoated cream",
    hint: "Warm off-white that is gentler to read against. Black & white interiors only — the provider prints no colour on cream.",
    costRank: 0,
  },
];

/**
 * Cover lamination. The values match the catalog's `Finish` enum so a product's
 * `spec.finish` and its variant selection speak the same language.
 */
export const COVER_FINISHES: VariantOptionDef[] = [
  {
    value: "gloss",
    label: "Gloss",
    hint: "Shiny and saturated, and wipes clean — which matters for a book toddlers hold. Shows fingerprints.",
    costRank: 0,
  },
  {
    value: "matte",
    label: "Matte",
    hint: "Soft, low-glare and reads as more premium. Marks show more easily than gloss.",
    costRank: 0,
  },
];

export interface VariantAxisDef {
  id: VariantAxisId;
  label: string;
  /** One line explaining the axis itself, above the options. */
  hint: string;
  options: VariantOptionDef[];
}

export const VARIANT_AXIS_DEFS: Record<VariantAxisId, VariantAxisDef> = {
  print: {
    id: "print",
    label: "Interior printing",
    hint: "How the pages are printed. The biggest lever on price for a long book.",
    options: PRINT_TIERS,
  },
  paper: {
    id: "paper",
    label: "Paper",
    hint: "What the pages are printed on.",
    options: PAPER_STOCKS,
  },
  finish: {
    id: "finish",
    label: "Cover finish",
    hint: "How the cover is laminated.",
    options: COVER_FINISHES,
  },
};

/** One concrete variant: a value on every axis. */
export type VariantSelection = Record<VariantAxisId, string>;

/** A partial selection — a rule that matches every variant sharing these values. */
export type VariantMatch = Partial<VariantSelection>;

export function variantOptionsFor(axis: VariantAxisId): VariantOptionDef[] {
  return VARIANT_AXIS_DEFS[axis].options;
}

export function variantOptionDef(axis: VariantAxisId, value: string): VariantOptionDef | undefined {
  return variantOptionsFor(axis).find((o) => o.value === value);
}

export function variantOptionLabel(axis: VariantAxisId, value: string): string {
  return variantOptionDef(axis, value)?.label ?? value;
}

/** Where this option's photographs live. Axis ids are media features by design. */
export function variantMediaKey(axis: VariantAxisId, value: string): string {
  return optionMediaKey(axis as PrintOptionFeature, value);
}

/** Whether every axis carries a value the provider is known to offer. */
export function isVariantSelection(value: unknown): value is VariantSelection {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return VARIANT_AXES.every((axis) => typeof v[axis] === "string" && variantOptionDef(axis, v[axis] as string) != null);
}

/**
 * Stable identity for a variant: `print/paper/finish`. Used to key cost samples
 * and to name a variant in logs and order records.
 */
export function variantKey(selection: VariantSelection): string {
  return VARIANT_AXES.map((axis) => selection[axis]).join("/");
}

/**
 * The axes that change what a book costs to print.
 *
 * Ink, quality and paper decide the per-page rate; cover lamination does not
 * change the price at all (both finishes carry `costRank` 0, measured). Keying
 * measured costs by these two alone halves the probes a calibration needs and
 * stops the same number being measured twice under different names.
 */
export const VARIANT_COST_AXES = ["print", "paper"] as const satisfies readonly VariantAxisId[];

/**
 * Identity of a variant for COSTING purposes: `print/paper`. Two variants that
 * share this key are printed on the same stock with the same ink, so they cost
 * the same to make however their covers are finished.
 */
export function costVariantKey(selection: VariantSelection): string {
  return VARIANT_COST_AXES.map((axis) => selection[axis]).join("/");
}

export function parseVariantKey(key: string): VariantSelection | null {
  const parts = (key ?? "").split("/");
  if (parts.length !== VARIANT_AXES.length) return null;
  const out = {} as VariantSelection;
  for (const [i, axis] of VARIANT_AXES.entries()) {
    if (!variantOptionDef(axis, parts[i])) return null;
    out[axis] = parts[i];
  }
  return out;
}

/** `Premium colour · 80# coated white · Gloss cover` — a variant in one line. */
export function variantSummary(selection: VariantSelection): string {
  return [
    variantOptionLabel("print", selection.print),
    variantOptionLabel("paper", selection.paper),
    `${variantOptionLabel("finish", selection.finish)} cover`,
  ].join(" · ");
}

export function sameVariant(a: VariantSelection, b: VariantSelection): boolean {
  return VARIANT_AXES.every((axis) => a[axis] === b[axis]);
}

// ---- Per-product policy ----------------------------------------------------

/**
 * What choosing an option adds to the price of one copy.
 *
 * Two components, because the COST it covers has two components. Paper and
 * print tier change what a page costs to make, so their price difference has
 * to scale with the page count: premium colour over standard black & white is
 * a few dollars on a 24-page board book and the better part of a hundred on a
 * 400-page one. A single flat number priced one of those two correctly and the
 * other one at a loss. Cover finish, which costs the same at any length, uses
 * `perCopy` alone.
 */
export interface VariantDelta {
  /** Flat amount added per copy, whatever the length. */
  perCopy: number;
  /** Amount added per interior page. */
  perPage: number;
}

/** An option a product offers, and what choosing it adds to the price. */
export interface VariantChoice {
  value: string;
  /**
   * Added to the page-tier price, per copy, keyed by currency code. The tier
   * price IS the price of the base variant, so the options the base SKU already
   * encodes carry no delta (validation enforces it) and every other option is
   * priced as the upgrade it is.
   *
   * A bare number is the legacy flat-per-copy form and still loads; see
   * {@link normalizeVariantDelta}.
   */
  priceDelta?: Record<string, VariantDelta>;
}

/** Zero delta — the value every unpriced option resolves to. */
export function emptyVariantDelta(): VariantDelta {
  return { perCopy: 0, perPage: 0 };
}

/**
 * Coerce a stored delta into shape. Accepts the legacy bare number so a catalog
 * priced before per-page deltas existed keeps charging exactly what it did.
 */
export function normalizeVariantDelta(input: unknown): VariantDelta | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? { perCopy: input, perPage: 0 } : null;
  }
  if (!input || typeof input !== "object") return null;
  const d = input as Partial<VariantDelta>;
  const perCopy = typeof d.perCopy === "number" && Number.isFinite(d.perCopy) ? d.perCopy : 0;
  const perPage = typeof d.perPage === "number" && Number.isFinite(d.perPage) ? d.perPage : 0;
  if (perCopy === 0 && perPage === 0) return null;
  return { perCopy, perPage };
}

/** Whether a delta is worth storing (a zero delta is the absence of one). */
export function variantDeltaIsZero(delta: VariantDelta | undefined): boolean {
  return !delta || (delta.perCopy === 0 && delta.perPage === 0);
}

/**
 * What a format offers. Deliberately data rather than rules: the provider's
 * catalog has holes (no colour ink on cream paper anywhere; no standard colour
 * on saddle stitch) and the next provider will have different ones, so they're
 * recorded as measured instead of encoded as logic.
 */
export interface ProductVariantPolicy {
  /** Offered options per axis. The base SKU's own value is always included. */
  options: Record<VariantAxisId, VariantChoice[]>;
  /**
   * Combinations not sold. An entry excludes every selection matching ALL the
   * axes it names, so `{ print: "premium-colour", paper: "60-uncoated-cream" }`
   * rules out that pair whatever the finish.
   */
  exclusions: VariantMatch[];
}

export function createDefaultVariantPolicy(): ProductVariantPolicy {
  return { options: { print: [], paper: [], finish: [] }, exclusions: [] };
}

/** Whether a partial rule matches a variant (an empty rule matches nothing). */
export function variantMatches(match: VariantMatch, selection: VariantSelection): boolean {
  const axes = VARIANT_AXES.filter((axis) => match[axis] != null);
  return axes.length > 0 && axes.every((axis) => match[axis] === selection[axis]);
}

export function offeredValues(policy: ProductVariantPolicy, axis: VariantAxisId): string[] {
  return policy.options[axis].map((o) => o.value);
}

/** Whether a customer may order this exact variant of this product. */
export function variantAllowed(policy: ProductVariantPolicy, selection: VariantSelection): boolean {
  if (!VARIANT_AXES.every((axis) => offeredValues(policy, axis).includes(selection[axis]))) return false;
  return !policy.exclusions.some((rule) => variantMatches(rule, selection));
}

/**
 * Whether an option can be part of any orderable variant, given what's chosen on
 * the other axes. Drives the storefront's disabled states: cream paper is real,
 * but not while premium colour is selected.
 */
export function optionSelectable(
  policy: ProductVariantPolicy,
  axis: VariantAxisId,
  value: string,
  selection: VariantSelection,
): boolean {
  return variantAllowed(policy, { ...selection, [axis]: value });
}

/** Every orderable variant, in option order. */
export function enumerateVariants(policy: ProductVariantPolicy): VariantSelection[] {
  let combos: VariantSelection[] = [{} as VariantSelection];
  for (const axis of VARIANT_AXES) {
    const values = offeredValues(policy, axis);
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [axis]: value })));
  }
  return combos.filter((combo) => !policy.exclusions.some((rule) => variantMatches(rule, combo)));
}

/**
 * Per-copy surcharge for a variant in one currency (0 when nothing is set).
 *
 * `pages` scales the per-page component. Callers that genuinely have no page
 * count (a storefront "from" badge, say) may omit it and get the flat part
 * alone — which understates an upgrade on a long book, so anything pricing a
 * real order must pass the real length.
 */
export function variantPriceDelta(
  policy: ProductVariantPolicy,
  selection: VariantSelection | undefined,
  currency: string,
  pages = 0,
): number {
  if (!selection) return 0;
  let total = 0;
  for (const axis of VARIANT_AXES) {
    const choice = policy.options[axis].find((o) => o.value === selection[axis]);
    const delta = choice?.priceDelta?.[currency];
    if (!delta) continue;
    total += delta.perCopy + delta.perPage * Math.max(0, pages);
  }
  return total;
}

/**
 * The orderable variant a customer can buy for the LEAST money in `currency` —
 * the margin floor of the whole family.
 *
 * The page-tier price buys the base variant, and every other option shifts it by
 * its delta. Deltas are normally upgrades, in which case this is the base and
 * nothing changes; but the moment an admin prices an option DOWN (standard black
 * & white on 60# uncoated, say) the cheapest combination is a real price a real
 * customer can pay, and it — not the sticker — is what margin, break-even and
 * discount headroom have to survive. Every worst-case calculation therefore
 * prices this variant.
 */
export function cheapestVariant(
  policy: ProductVariantPolicy,
  currency: string,
  pages = 0,
): VariantSelection | undefined {
  let cheapest: VariantSelection | undefined;
  let lowest = Number.POSITIVE_INFINITY;
  for (const variant of enumerateVariants(policy)) {
    const delta = variantPriceDelta(policy, variant, currency, pages);
    if (delta < lowest) {
      lowest = delta;
      cheapest = variant;
    }
  }
  return cheapest;
}

/**
 * The first orderable variant, preferring `base` and falling back option by
 * option. A product whose base variant was excluded still needs something to
 * quote, and silently offering nothing would read as "out of stock".
 */
export function firstAllowedVariant(
  policy: ProductVariantPolicy,
  base: VariantSelection | undefined,
): VariantSelection | undefined {
  if (base && variantAllowed(policy, base)) return base;
  const all = enumerateVariants(policy);
  if (!base) return all[0];
  // The nearest orderable variant wins, and axes declared earlier weigh more, so
  // a customer who asked for premium colour keeps it and gives up the finish
  // rather than the other way round.
  return [...all].sort((a, b) => distanceFrom(a, base) - distanceFrom(b, base))[0];
}

/**
 * Customer-facing print specification for illustrated books.
 *
 * Paper and interior print quality are intentionally not choices in the
 * storefront. Every quote and order uses the provider-recommended picture-book
 * specification, while cover finish remains a visible choice.
 */
export function simplifiedPrintVariant(
  policy: ProductVariantPolicy,
  preferredFinish = "gloss",
): VariantSelection | undefined {
  return firstAllowedVariant(policy, {
    print: "premium-colour",
    paper: "80-coated-white",
    finish: preferredFinish,
  });
}

function distanceFrom(selection: VariantSelection, base: VariantSelection): number {
  return VARIANT_AXES.reduce(
    (total, axis, i) => total + (selection[axis] === base[axis] ? 0 : 2 ** (VARIANT_AXES.length - i)),
    0,
  );
}

// ---- Normalization ---------------------------------------------------------

function normalizeChoice(input: unknown): VariantChoice | null {
  const c = (input ?? {}) as Partial<VariantChoice> & { value?: unknown };
  if (typeof c.value !== "string" || !c.value) return null;
  const choice: VariantChoice = { value: c.value };
  if (c.priceDelta && typeof c.priceDelta === "object") {
    const deltas: Record<string, VariantDelta> = {};
    for (const [currency, amount] of Object.entries(c.priceDelta as Record<string, unknown>)) {
      const delta = normalizeVariantDelta(amount);
      if (delta) deltas[currency.toUpperCase()] = delta;
    }
    if (Object.keys(deltas).length > 0) choice.priceDelta = deltas;
  }
  return choice;
}

/**
 * Coerce a stored policy into shape, dropping options this build doesn't know.
 * `base` (the variant the product's own SKU encodes) is always offered: it's the
 * one combination the product is known to be able to print, and a policy that
 * excluded it would make the product unorderable.
 */
export function normalizeVariantPolicy(
  input: unknown,
  base?: VariantSelection,
): ProductVariantPolicy {
  const stored = (input ?? {}) as Partial<ProductVariantPolicy>;
  const out = createDefaultVariantPolicy();

  for (const axis of VARIANT_AXES) {
    const seen = new Set<string>();
    const list = Array.isArray(stored.options?.[axis]) ? stored.options[axis] : [];
    for (const raw of list) {
      const choice = normalizeChoice(raw);
      if (!choice || seen.has(choice.value) || !variantOptionDef(axis, choice.value)) continue;
      seen.add(choice.value);
      out.options[axis].push(choice);
    }
    const baseValue = base?.[axis];
    if (baseValue && !seen.has(baseValue)) out.options[axis].unshift({ value: baseValue });
    // Keep options in the order the vocabulary declares them, so every surface
    // lists them the same way regardless of when each was switched on.
    out.options[axis].sort(
      (a, b) =>
        variantOptionsFor(axis).findIndex((o) => o.value === a.value) -
        variantOptionsFor(axis).findIndex((o) => o.value === b.value),
    );
  }

  for (const raw of Array.isArray(stored.exclusions) ? stored.exclusions : []) {
    const rule = (raw ?? {}) as Record<string, unknown>;
    const cleaned: VariantMatch = {};
    for (const axis of VARIANT_AXES) {
      const value = rule[axis];
      if (typeof value === "string" && variantOptionDef(axis, value)) cleaned[axis] = value;
    }
    // An empty rule matches nothing; a rule that would exclude the base variant
    // is dropped rather than allowed to make the product unsellable.
    if (Object.keys(cleaned).length === 0) continue;
    if (base && variantMatches(cleaned, base)) continue;
    out.exclusions.push(cleaned);
  }

  return out;
}
