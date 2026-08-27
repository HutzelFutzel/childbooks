/**
 * What saving a shipping policy would actually do.
 *
 * The settings are three screens of checkboxes and numbers whose consequences
 * are two joins away: ticking off one speed can remove it from ninety countries,
 * and moving the markup a point changes every published rate in the catalog.
 * Neither is visible from the form, so the only honest way to review a change
 * was to save it and read the storefront.
 *
 * The diff is computed by running the REAL projection twice — once with the
 * stored policy, once with the candidate — and comparing the rows. Nothing here
 * re-derives what a rate should be. A preview that models the outcome instead
 * of producing it is a second implementation of the pricing rules, and the two
 * would disagree exactly when it mattered.
 */
import { projectShippingRates } from "./productMath";
import type { MarketCapability } from "./marketCapability";
import type { MarketRegistry } from "./markets";
import type { CurrencyCode, PricingSettings, ProductDefinition, PublicShippingRate } from "./products";
import type { ShippingSettings } from "./shipping";
import type { ShippingMethod } from "../fulfillment/types";

/** One route whose availability flips. */
export interface AvailabilityChange {
  productSku: string;
  country: string;
  method: ShippingMethod;
  /** `"gained"`: offered after the change and not before. `"lost"`: the reverse. */
  kind: "gained" | "lost";
}

/** One route whose price moves, in the currency it moves most in. */
export interface PriceChange {
  productSku: string;
  country: string;
  method: ShippingMethod;
  currency: CurrencyCode;
  /** Single-copy charge before and after — the figure a customer compares. */
  before: number;
  after: number;
}

export interface ShippingPreview {
  availability: AvailabilityChange[];
  prices: PriceChange[];
  /**
   * Totals over the FULL diff, not over the truncated lists.
   *
   * A preview that showed "3 changes" because it had trimmed to three would be
   * worse than no preview: it invites approving a catalog-wide change on the
   * strength of a sample.
   */
  totals: { gained: number; lost: number; repriced: number; unpriceable: number };
  /** True when either list was trimmed, so the UI can say so. */
  truncated: boolean;
}

export interface ShippingPreviewArgs {
  products: readonly ProductDefinition[];
  settings: PricingSettings;
  registry: MarketRegistry;
  current: ShippingSettings;
  candidate: ShippingSettings;
  capability?: ReadonlyMap<string, MarketCapability>;
  /** Rows per list before trimming. */
  limit?: number;
}

const DEFAULT_LIMIT = 200;

export function previewShippingChange(args: ShippingPreviewArgs): ShippingPreview {
  const { products, settings, registry, current, candidate, capability } = args;
  const limit = args.limit ?? DEFAULT_LIMIT;

  const availability: AvailabilityChange[] = [];
  const prices: PriceChange[] = [];
  const totals = { gained: 0, lost: 0, repriced: 0, unpriceable: 0 };

  for (const product of products) {
    if (product.status === "retired") continue;
    const before = index(projectShippingRates(product, settings, registry, current, capability));
    const after = index(projectShippingRates(product, settings, registry, candidate, capability));

    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const [country, method] = key.split("|") as [string, ShippingMethod];
      const b = before.get(key);
      const a = after.get(key);
      // A row that vanishes entirely is a loss, not an absence: a speed with no
      // row is one we've stopped selling there, which is precisely the change
      // an admin needs to see before it reaches the storefront.
      const wasOffered = b?.available === true;
      const isOffered = a?.available === true;
      if (wasOffered !== isOffered) {
        totals[isOffered ? "gained" : "lost"] += 1;
        if (availability.length < limit) {
          availability.push({
            productSku: product.provider.sku,
            country,
            method,
            kind: isOffered ? "gained" : "lost",
          });
        }
        continue;
      }
      if (!isOffered) continue;

      // Still offered but no longer quotable — flat mode with no rate entered
      // for this speed, most often. The storefront falls back to a live quote,
      // so it isn't broken, but it stops advertising a price and that is worth
      // knowing before the save rather than after.
      const priceable = Object.keys(a?.charged ?? {}).length > 0;
      if (!priceable) {
        if (Object.keys(b?.charged ?? {}).length > 0) totals.unpriceable += 1;
        continue;
      }

      const change = worstDelta(b, a);
      if (!change) continue;
      totals.repriced += 1;
      if (prices.length < limit) {
        prices.push({ productSku: product.provider.sku, country, method, ...change });
      }
    }
  }

  return {
    availability,
    prices,
    totals,
    truncated: totals.gained + totals.lost > availability.length || totals.repriced > prices.length,
  };
}

function index(rates: readonly PublicShippingRate[]): Map<string, PublicShippingRate> {
  return new Map(rates.map((r) => [`${r.country}|${r.method}`, r]));
}

/**
 * The currency whose single-copy charge moves furthest, or null if none move.
 *
 * One currency rather than all of them because the FX rates are shared: a
 * markup change moves every currency by the same proportion, so listing all of
 * them multiplies the rows without adding a fact. The largest is the one worth
 * reading, since it's the one a customer would notice.
 */
function worstDelta(
  before: PublicShippingRate | undefined,
  after: PublicShippingRate | undefined,
): { currency: CurrencyCode; before: number; after: number } | null {
  let worst: { currency: CurrencyCode; before: number; after: number } | null = null;
  for (const [currency, terms] of Object.entries(after?.charged ?? {})) {
    const previous = before?.charged?.[currency];
    const b = previous ? previous.base + previous.perCopy : 0;
    const a = terms.base + terms.perCopy;
    if (Math.abs(a - b) < 0.005) continue;
    if (!worst || Math.abs(a - b) > Math.abs(worst.after - worst.before)) {
      worst = { currency, before: round2(b), after: round2(a) };
    }
  }
  return worst;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
