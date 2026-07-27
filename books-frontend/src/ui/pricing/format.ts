/**
 * Presentation helpers shared by the print-pricing pages.
 *
 * Kept together (and out of the components) because the same numbers are
 * rendered twice — once in the server HTML that search engines and no-JavaScript
 * visitors read, once in the interactive simulator — and the two must agree
 * character for character or the page contradicts itself.
 */
import type { PublicPlan } from "../../core/config/plans";
import type { Dimensions, PricingSettings } from "../../core/config/products";

/**
 * The currency a request asks to be priced in, or the catalog's own.
 *
 * Validated against the supported list rather than trusted: the value reaches the
 * server from a query string, and an unrecognised code would render every price
 * as a zero (there is no tier price under a currency we don't sell in) — a
 * defaced pricing page that anybody could link someone to.
 */
export function requestedCurrency(
  settings: PricingSettings,
  raw: string | string[] | undefined,
): string {
  const asked = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return asked && settings.currencies.includes(asked) ? asked : settings.baseCurrency;
}

/**
 * The plan a request asks to be priced as, or none.
 *
 * Lets a link from inside the Studio preselect the visitor's own plan (`?plan=`)
 * so the receipt matches what they'd actually pay, without a session on this
 * page — plan ids are already public in the `appConfig/plans` projection this
 * calculator reads, so nothing is disclosed by accepting one from a URL.
 *
 * Validated against the active plan list rather than trusted, same reasoning as
 * {@link requestedCurrency}: this arrives as a query string, and an unknown id
 * would otherwise sail through to `simulatePublicOrder`, which reads a missing
 * discount as zero — quiet rather than defaced, but still worth rejecting so a
 * stale or mistyped id doesn't look like "no subscription" when it was meant to
 * pick one.
 */
export function requestedPlanId(
  plans: readonly PublicPlan[],
  raw: string | string[] | undefined,
): string | null {
  const asked = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!asked) return null;
  return plans.some((p) => p.id === asked && p.status === "active") ? asked : null;
}

/**
 * A price, in the reader's locale but the seller's currency.
 *
 * Whole amounts keep their `.00`: a column of prices where one row reads "$35"
 * and the next "$34.99" is harder to compare than it needs to be, and the
 * trailing zeros are what make a printed price look like a price.
 */
export function formatMoney(amount: number | undefined | null, currency: string): string {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    // An unknown currency code is a config problem, not a reason to render NaN.
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * A link between pricing pages that carries the reader's currency with it.
 *
 * Omitted when it's the catalog's own, so the ordinary case links to the clean
 * canonical URL and only a deliberate switch adds the parameter.
 */
export function pricingHref(path: string, currency: string, baseCurrency: string): string {
  return currency === baseCurrency ? path : `${path}?currency=${encodeURIComponent(currency)}`;
}

/** `8.5 × 8.5″` — a trim as a person would say it. */
export function trimLabel(trim: Dimensions): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  const unit = trim.unit === "in" ? "″" : " mm";
  return `${r(trim.width)} × ${r(trim.height)}${unit}`;
}

/**
 * Representative lengths to price a format at, for the static table.
 *
 * Anchored to the format's own limits and stepped onto its binding increment,
 * so every row is a book that can actually be made. The shortest and longest
 * are always included — they bound what the format can do — with the middle
 * samples spread between them to show how price tracks length.
 */
export function samplePageCounts(
  conditions: { min: number; max: number; step: number },
  samples = 4,
): number[] {
  const { min, max, step } = conditions;
  if (max <= min) return [min];
  const snap = (value: number) => {
    const stepped = min + Math.round((value - min) / Math.max(1, step)) * Math.max(1, step);
    return Math.min(max, Math.max(min, stepped));
  };
  const count = Math.max(2, samples);
  const points = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    points.add(snap(min + ((max - min) * i) / (count - 1)));
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * Shared column lengths for a table comparing several formats.
 *
 * Not an even spread across the widest range any format accepts, which is the
 * obvious approach and a bad one: a catalog holding a 4–48 page stapled booklet
 * beside an 800-page paperback would get a column at 2 pages that nothing can
 * print and three columns above 250 that only one format reaches — mostly dashes,
 * and mostly repeating one bracket's price.
 *
 * Instead the candidates are the price-bracket edges themselves, scored by how
 * many formats can actually print them. Bracket edges are where the price
 * changes, which is the one thing a reader is trying to see, and scoring by
 * coverage keeps the columns populated.
 */
export function sharedPageColumns(
  products: readonly {
    conditions: { pages: { min: number; max: number; step: number } };
    priceTiers?: readonly { minPages: number; maxPages: number }[];
  }[],
  columns = 4,
): number[] {
  const fits = (n: number, p: (typeof products)[number]) =>
    n >= p.conditions.pages.min && n <= p.conditions.pages.max;

  // Every bracket edge, plus each format's own shortest and longest book: the
  // extremes matter even where they're unique to one format, since they're what
  // the format is FOR.
  const candidates = new Set<number>();
  for (const p of products) {
    candidates.add(p.conditions.pages.min);
    candidates.add(p.conditions.pages.max);
    for (const tier of p.priceTiers ?? []) {
      if (fits(tier.minPages, p)) candidates.add(tier.minPages);
    }
  }

  const scored = [...candidates]
    .map((n) => ({ n, coverage: products.filter((p) => fits(n, p)).length }))
    .filter((c) => c.coverage > 0)
    .sort((a, b) => b.coverage - a.coverage || a.n - b.n);
  if (scored.length <= columns) return scored.map((c) => c.n).sort((a, b) => a - b);

  // Take the best-covered candidates, then spread the chosen ones over the range
  // rather than letting them cluster at the short end, where bracket edges are
  // usually densest.
  const pool = scored.slice(0, Math.max(columns, Math.ceil(scored.length / 2)));
  const sorted = pool.map((c) => c.n).sort((a, b) => a - b);
  const picked = new Set<number>();
  for (let i = 0; i < columns; i += 1) {
    picked.add(sorted[Math.round((i * (sorted.length - 1)) / (columns - 1))]);
  }
  return [...picked].sort((a, b) => a - b);
}
