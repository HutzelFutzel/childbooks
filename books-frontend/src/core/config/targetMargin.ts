/**
 * Prices from a target margin.
 *
 * The admin chooses the margin — one for the whole catalog, optionally a
 * different one per binding — and every product's price table is computed from
 * it and the product's measured print cost. The result is still STORED on the
 * product as ordinary page-tier prices and variant deltas, so every surface that
 * shows or charges a price (storefront, price simulator, order dialog,
 * checkout, reorders) keeps reading one number and can never disagree with the
 * others. Pricing live from each order's quote would make the price on the page
 * and the price on the card two different things.
 *
 * When an input moves (the margin, a cost measurement, an exchange rate, a fee)
 * the stored prices go stale; {@link repricePlan} reports exactly what would
 * change, and the admin applies it.
 */
import type { Binding } from "../fulfillment/types";
import { bindingOfSku } from "../fulfillment/lulu/skuAxes";
import type { CurrencyCode, PageTier, PricingSettings, ProductDefinition } from "./products";
import {
  costTableIsEmpty,
  feeFor,
  feePercent,
  generateSteppedTiers,
  suggestTierPrice,
  suggestVariantDeltas,
} from "./productMath";
import type { ShippingSettings } from "./shipping";
import type { ProductVariantPolicy } from "./variants";

export {
  DEFAULT_TARGET_MARGIN_PCT,
  createDefaultTargetMargins,
  normalizeTargetMargins,
  type TargetMargins,
} from "./targetMarginSettings";

/** The binding a product is priced as: its SKU's, which is what actually prints. */
export function productBinding(product: ProductDefinition): Binding {
  return bindingOfSku(product.provider.sku) ?? product.spec.binding;
}

/** The margin this product is priced to, and where that number comes from. */
export function targetMarginFor(
  settings: PricingSettings,
  product: ProductDefinition,
): { pct: number; source: "binding" | "default"; binding: Binding } {
  const binding = productBinding(product);
  const override = settings.targetMargins.byBinding[binding];
  return override != null
    ? { pct: override, source: "binding", binding }
    : { pct: settings.targetMargins.defaultPct, source: "default", binding };
}

/**
 * The highest margin this fee and tax structure can ever produce, whatever the
 * price. Margin tops out at `1 − (1 + taxRate)·feePercent` as the price grows,
 * so a target above that has no answer in at least one currency.
 */
export function maxTargetMargin(settings: PricingSettings): number {
  let cap = 90;
  for (const currency of settings.currencies) {
    const rate = Math.max(0, settings.tax.perCurrency[currency]?.assumedRatePct ?? 0) / 100;
    const ceiling = (1 - (1 + rate) * feePercent(feeFor(settings, currency))) * 100;
    cap = Math.min(cap, Math.floor(ceiling) - 1);
  }
  return Math.max(1, cap);
}

/**
 * Every tier repriced for a target margin.
 *
 * Each tier is priced at the MIDPOINT of its page range: a tier charges one
 * price across the whole range, so pricing at the cheap end would underprice
 * every thicker book in it. Narrow tiers keep every length close to target.
 */
export function tiersForMargin(
  product: ProductDefinition,
  settings: PricingSettings,
  shippingSettings: ShippingSettings,
  tiers: PageTier[],
  target: number,
): { tiers: PageTier[]; unreachable: string[] } {
  const unreachable = new Set<string>();
  const next = tiers.map((t) => {
    const lo = Math.max(t.minPages, product.conditions.pages.min);
    const hi = Math.min(t.maxPages, product.conditions.pages.max);
    const pages = Math.max(1, Math.round((lo + Math.max(lo, hi)) / 2));
    const prices = { ...t.prices };
    for (const currency of settings.currencies) {
      const price = suggestTierPrice(product, { currency, pages, copies: 1 }, settings, target, shippingSettings);
      if (price == null) unreachable.add(currency);
      else prices[currency] = price;
    }
    return { ...t, prices };
  });
  return { tiers: next, unreachable: [...unreachable] };
}

/**
 * The page ranges a product is priced over. Its own, when it has a real table;
 * a generated ladder (every 10 pages to 100, then every 100) when it still has
 * the single catch-all row a new product starts with — one price for 24 and
 * 800 pages would sell the long book at a loss or the short one at a joke.
 */
export function pricingLadderFor(product: ProductDefinition, currencies: CurrencyCode[]): PageTier[] {
  const { min, max } = product.conditions.pages;
  const tiers = product.pricing.tiers;
  const inRange = tiers.filter((t) => t.maxPages >= min && t.minPages <= max);
  if (inRange.length >= 2) return tiers;
  const bands = max > 100 ? [{ upTo: 100, step: 10 }, { upTo: max, step: 100 }] : [{ upTo: max, step: 10 }];
  return generateSteppedTiers(min, bands, currencies);
}

export interface PriceChange {
  minPages: number;
  maxPages: number;
  currency: CurrencyCode;
  from: number | null;
  to: number;
}

export interface RepricePlan {
  productId: string;
  productName: string;
  target: ReturnType<typeof targetMarginFor>;
  /** `ready` can be applied; the others say why this product can't be priced yet. */
  status: "ready" | "needs-cost" | "unreachable";
  tiers: PageTier[];
  variants: ProductVariantPolicy;
  /** Currencies the target can't be reached in (fees and tax leave too little). */
  unreachable: string[];
  /** Every stored price that would move, tier by tier. Empty ⇒ already on target. */
  changes: PriceChange[];
  /** Whether the variant surcharges would move too. */
  variantsChange: boolean;
}

const CENT = 0.005;

/**
 * What pricing this product to its target margin would store, and how that
 * differs from what it stores now. Pure: nothing is written.
 */
export function repricePlan(
  product: ProductDefinition,
  settings: PricingSettings,
  shippingSettings: ShippingSettings,
): RepricePlan {
  const target = targetMarginFor(settings, product);
  const base = {
    productId: product.id,
    productName: product.presentation.name,
    target,
    tiers: product.pricing.tiers,
    variants: product.variants,
    unreachable: [] as string[],
    changes: [] as PriceChange[],
    variantsChange: false,
  };
  if (costTableIsEmpty(product.cost)) return { ...base, status: "needs-cost" };

  // Variant surcharges first: the tier price is backed out of the cheapest
  // variant's surcharge, so it has to be computed against the new ones.
  const variants = suggestVariantDeltas(product, settings, target.pct) ?? product.variants;
  const withVariants = { ...product, variants };
  const ladder = pricingLadderFor(product, settings.currencies);
  const { tiers, unreachable } = tiersForMargin(withVariants, settings, shippingSettings, ladder, target.pct);

  const changes: PriceChange[] = [];
  const sameShape =
    ladder.length === product.pricing.tiers.length &&
    ladder.every((t, i) => t.minPages === product.pricing.tiers[i].minPages && t.maxPages === product.pricing.tiers[i].maxPages);
  for (const [i, t] of tiers.entries()) {
    const before = sameShape ? product.pricing.tiers[i] : undefined;
    for (const currency of settings.currencies) {
      const to = t.prices[currency];
      if (typeof to !== "number") continue;
      const from = before?.prices[currency] ?? null;
      if (from == null || Math.abs(from - to) > CENT) {
        changes.push({ minPages: t.minPages, maxPages: t.maxPages, currency, from, to });
      }
    }
  }
  const variantsChange = JSON.stringify(variants.options) !== JSON.stringify(product.variants.options);

  return {
    ...base,
    status: unreachable.length > 0 ? "unreachable" : "ready",
    tiers,
    variants,
    unreachable,
    changes,
    variantsChange,
  };
}

/** Whether applying the plan would change anything the customer pays. */
export function planChangesPrices(plan: RepricePlan): boolean {
  return plan.status === "ready" && (plan.changes.length > 0 || plan.variantsChange);
}

/** The product with the plan's prices stored on it. */
export function applyRepricePlan(product: ProductDefinition, plan: RepricePlan): ProductDefinition {
  if (plan.status !== "ready") return product;
  return {
    ...product,
    variants: plan.variants,
    pricing: { ...product.pricing, tiers: plan.tiers },
  };
}
