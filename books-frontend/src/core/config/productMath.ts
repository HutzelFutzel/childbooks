/**
 * Pure calculators for the product configurator — shared by the admin margin
 * preview, the public price projection, and (later) checkout. No I/O.
 *
 * Per-product input is just the page-tier price table. All shared economics
 * (currencies, FX, payment fees, rounding, tax) come from {@link PricingSettings},
 * so these functions take both the product and the global settings.
 */
import { variantFromSku } from "../fulfillment/lulu/skuAxes";
import type {
  CurrencyCode,
  GeoMatch,
  GeoPolicy,
  PageTier,
  PaymentFeeModel,
  PricingSettings,
  ProductCostModel,
  ProductDefinition,
  ProductShippingPolicy,
  PublicProduct,
  TaxBehavior,
} from "./products";
import { cheapestVariant, variantPriceDelta, type VariantSelection } from "./variants";

// ---- Currency helpers ------------------------------------------------------

/** Multiplier to convert an amount from the base currency into `currency`. */
export function fxRate(settings: PricingSettings, currency: CurrencyCode): number {
  if (currency === settings.baseCurrency) return 1;
  const rate = settings.fx.rates[currency];
  return rate && rate > 0 ? rate : 1;
}

/**
 * Convert a COST amount between currencies, padding any cross-currency
 * conversion with the configured FX buffer so rate drift can't quietly erode
 * the computed margin (costs are deliberately over- rather than under-stated).
 */
export function convertCostAmount(
  settings: PricingSettings,
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
): number {
  if (from === to) return amount;
  const buffer = 1 + Math.max(0, settings.fx.bufferPct) / 100;
  return amount * (fxRate(settings, to) / fxRate(settings, from)) * buffer;
}

/**
 * Whether the catalog's FX table can convert this currency at all.
 *
 * {@link fxRate} deliberately falls back to 1 for an unknown currency, which is
 * fine for display but dangerous for costs — a provider quoting in a currency we
 * can't convert would be read as if it were the base currency and understate
 * what we pay. Callers converting a COST from an external source must check this
 * first and refuse rather than convert at a silent 1:1.
 */
export function canConvertCurrency(settings: PricingSettings, currency: string): boolean {
  const c = (currency ?? "").trim().toUpperCase();
  if (!c) return false;
  if (c === settings.baseCurrency.trim().toUpperCase()) return true;
  const rate = settings.fx.rates[c];
  return typeof rate === "number" && rate > 0;
}

export function feeFor(settings: PricingSettings, currency: CurrencyCode): PaymentFeeModel {
  return settings.fees[currency] ?? settings.fees[settings.baseCurrency] ?? { percentPct: 0, fixed: 0 };
}

/** Total effective payment-fee percentage (processor % + optional extra %). */
export function feePercent(fee: PaymentFeeModel): number {
  return (fee.percentPct + (fee.extraPct ?? 0)) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Apply "charm" rounding to a price. `to` is the fractional ending (e.g. 0.99):
 * round up to the next whole unit then subtract (1 − to). A `to` of 0 rounds to
 * the whole unit. "none" just rounds to 2 decimals.
 */
export function applyRounding(value: number, rule: { mode: "charm" | "none"; to?: number } | undefined): number {
  if (!rule || rule.mode === "none" || value <= 0) return round2(value);
  const to = rule.to ?? 0.99;
  // The epsilon is load-bearing: 17.99 − 0.99 lands a hair ABOVE 17 in binary
  // floating point, and a bare ceil would answer 18.99 — a price already ending
  // in the charm value must round to itself, not jump a whole unit.
  const whole = Math.ceil(value - to - 1e-9);
  return round2(Math.max(0, whole) + to);
}

// ---- Cost resolution -------------------------------------------------------

export interface CostScenario {
  pages: number;
  copies: number;
  /** Per-unit production cost from a live provider quote (cost currency). */
  liveUnitCost?: number;
  /** Total shipping cost from a live provider quote (cost currency). */
  liveShippingCost?: number;
}

/**
 * Per-unit production cost in the product's cost currency, before surcharges.
 * Uses the live quote when present (and the model opts into it); otherwise the
 * static table (base + per-page, minus the best applicable quantity break).
 */
export function resolveUnitCost(cost: ProductCostModel, scenario: CostScenario): number {
  if (cost.source === "providerLive" && typeof scenario.liveUnitCost === "number") {
    return scenario.liveUnitCost;
  }
  const base = cost.table.basePerUnit + cost.table.perPage * scenario.pages;
  const breaks = [...cost.table.quantityBreaks].sort((a, b) => b.minQty - a.minQty);
  const applicable = breaks.find((b) => scenario.copies >= b.minQty);
  const discount = applicable ? applicable.unitDiscountPct / 100 : 0;
  return base * (1 - discount);
}

/**
 * Whether the static cost table carries any production-cost baseline at all.
 *
 * An empty table makes every margin, break-even and discount-limit number
 * vacuously perfect, so configuration validation treats it as blocking. It
 * matters even for `providerLive` products: the table is the fallback when a
 * live quote fails, and it backs every offline projection.
 */
export function costTableIsEmpty(cost: ProductCostModel): boolean {
  return cost.table.basePerUnit === 0 && cost.table.perPage === 0;
}

/**
 * Whether a scenario resolves to a real (> 0) production cost, by exactly the
 * rule {@link resolveUnitCost} applies. Guards the checkout pricing path: with a
 * zero cost, {@link computeMargin} reports the entire price as profit and
 * `breakEvenDiscountPct` would permit discounting an order to nearly free.
 */
export function hasUsableUnitCost(cost: ProductCostModel, scenario: CostScenario): boolean {
  return resolveUnitCost(cost, scenario) > 0;
}

/** Per-order + per-unit surcharges resolved to a single per-unit amount. */
export function surchargePerUnit(cost: ProductCostModel, copies: number): number {
  let perUnit = 0;
  for (const s of cost.surcharges) {
    if (s.kind === "perUnit") perUnit += s.amount;
    else perUnit += copies > 0 ? s.amount / copies : s.amount;
  }
  return perUnit;
}

/** Full per-unit cost (production + surcharges) in the cost currency. */
export function totalUnitCost(cost: ProductCostModel, scenario: CostScenario): number {
  return resolveUnitCost(cost, scenario) + surchargePerUnit(cost, scenario.copies);
}

// ---- Retail price ----------------------------------------------------------

export interface PriceScenario extends CostScenario {
  currency: CurrencyCode;
  /**
   * Variant being priced. The page-tier price is the BASE variant; other
   * options add {@link variantPriceDelta}. Omitted ⇒ base (the product's own SKU).
   */
  variant?: VariantSelection;
}

/** The tier whose page range contains `pages` (first match; falls back to the last tier). */
export function pickTier(tiers: PageTier[], pages: number): PageTier | undefined {
  return tiers.find((t) => pages >= t.minPages && pages <= t.maxPages) ?? tiers[tiers.length - 1];
}

/**
 * Per-unit price the admin set for this page bracket + currency, after the
 * (cosmetic) rounding rule and the price floor. This is the "sticker" — whether
 * it's tax-inclusive depends on the currency's tax behavior.
 */
export function computeRetailPrice(
  product: ProductDefinition,
  scenario: PriceScenario,
  settings: PricingSettings,
): number {
  const currency = scenario.currency;
  const rounding = settings.rounding[currency];
  const floor = settings.floorPrice[currency] ?? 0;
  const tier = pickTier(product.pricing.tiers, scenario.pages);
  const base = tier?.prices[currency] ?? 0;
  const delta = variantPriceDelta(product.variants, scenario.variant, currency);
  return Math.max(applyRounding(base + delta, rounding), floor);
}

// ---- Margin breakdown (the configurator's read-only "additional info") -----

export interface MarginBreakdown {
  currency: CurrencyCode;
  copies: number;
  pages: number;
  /** The variant priced, when the scenario named one (absent ⇒ the base SKU's). */
  variant?: VariantSelection;
  /** Sticker price per unit (what the admin entered, after rounding/floor). */
  pricePerUnit: number;
  taxBehavior: TaxBehavior;
  taxRatePct: number;
  /** Ex-tax revenue you keep from the price, per unit / total. */
  netRevenuePerUnit: number;
  netRevenue: number;
  shippingCharged: number; // what the CUSTOMER pays for shipping (ex tax)
  taxAmount: number; // tax collected & remitted (not yours)
  grossCustomerPays: number; // price + shipping + tax — the amount Stripe processes
  productionCost: number; // total, all copies, in `currency` (what WE pay to print)
  shippingCost: number; // what WE pay to ship
  paymentFee: number; // processor fee on the gross
  netProfit: number;
  marginPct: number; // netProfit / revenueYouKeep
  markupPct: number; // netProfit / totalCost
  breakEvenDiscountPct: number; // discount on price that drives netProfit to 0
  maxDiscountPct: number;
  underwaterAtMaxDiscount: boolean;
}

/**
 * Full economics for a scenario, in the requested currency. `liveUnitCost` /
 * `liveShippingCost` (from a provider quote) make the numbers real; without them
 * the static cost table is used. Tax is handled per the currency's behavior:
 * inclusive prices have tax backed out of revenue; exclusive add it on top. The
 * assumed rate is display-only — Stripe Tax collects the real amount.
 */
export function computeMargin(
  product: ProductDefinition,
  scenario: PriceScenario,
  settings: PricingSettings,
): MarginBreakdown {
  const { cost, shipping } = product;
  const currency = scenario.currency;
  const copies = Math.max(1, scenario.copies);

  const taxPol = settings.tax.perCurrency[currency] ?? { behavior: "exclusive" as const, assumedRatePct: 0 };
  const rate = Math.max(0, taxPol.assumedRatePct) / 100;

  const pricePerUnit = computeRetailPrice(product, scenario, settings);
  // For inclusive markets the sticker contains tax; you keep the ex-tax part.
  const netRevenuePerUnit = taxPol.behavior === "inclusive" ? round2(pricePerUnit / (1 + rate)) : pricePerUnit;
  const netRevenue = round2(netRevenuePerUnit * copies);

  // Costs converted into the presentment currency (incl. the FX drift buffer).
  const costToCurrency = convertCostAmount(settings, 1, cost.currency, currency);
  const productionCost = round2(totalUnitCost(cost, scenario) * copies * costToCurrency);

  const shippingCostCostCcy =
    typeof scenario.liveShippingCost === "number" ? scenario.liveShippingCost : estimateShippingCost(shipping);
  const shippingCost = round2(shippingCostCostCcy * costToCurrency);
  const shippingCharged = round2(resolveShippingCharged(shipping, shippingCost));

  // Tax applies to the goods + shipping; Stripe processes the gross.
  const taxableBase = netRevenue + shippingCharged;
  const taxAmount = round2(taxableBase * rate);
  const grossCustomerPays = round2(taxableBase + taxAmount);

  const fee = feeFor(settings, currency);
  const fp = feePercent(fee);
  const paymentFee = round2(grossCustomerPays * fp + fee.fixed);

  // Revenue you actually keep excludes the tax you remit.
  const revenueYouKeep = taxableBase;
  const totalCost = productionCost + shippingCost + paymentFee;
  const netProfit = round2(revenueYouKeep - totalCost);
  const marginPct = revenueYouKeep > 0 ? round2((netProfit / revenueYouKeep) * 100) : 0;
  const markupPct = totalCost > 0 ? round2((netProfit / totalCost) * 100) : 0;

  // Break-even discount d on the price. The processor fee scales with the gross,
  // which is (netRevenue(d) + shipping)·(1 + rate). Solve netProfit(d) = 0:
  //   (netRevenue(d) + shipping)·(1 − (1+rate)·fp) = fixedCosts
  const fixedCosts = productionCost + shippingCost + fee.fixed;
  const effFp = (1 + rate) * fp;
  const denom = 1 - effFp;
  const breakEvenRevenue = denom > 0 ? fixedCosts / denom : Infinity;
  const breakEvenDiscountPct =
    netRevenue > 0 && Number.isFinite(breakEvenRevenue)
      ? round2(Math.max(0, Math.min(100, (1 - (breakEvenRevenue - shippingCharged) / netRevenue) * 100)))
      : 0;

  return {
    currency,
    copies,
    pages: scenario.pages,
    variant: scenario.variant,
    pricePerUnit,
    taxBehavior: taxPol.behavior,
    taxRatePct: taxPol.assumedRatePct,
    netRevenuePerUnit,
    netRevenue,
    shippingCharged,
    taxAmount,
    grossCustomerPays,
    productionCost,
    shippingCost,
    paymentFee,
    netProfit,
    marginPct,
    markupPct,
    breakEvenDiscountPct,
    maxDiscountPct: settings.maxDiscountPct,
    underwaterAtMaxDiscount: settings.maxDiscountPct > breakEvenDiscountPct,
  };
}

// ---- Price suggestion ------------------------------------------------------

/**
 * The sticker price that hits a target margin — {@link computeMargin} run
 * backwards.
 *
 * Margin is measured against the revenue we keep (goods + shipping, ex tax), so
 * for a target m we need `netProfit = m · revenueYouKeep`, where
 *
 *   revenueYouKeep = netRevenue + shippingCharged
 *   netProfit      = revenueYouKeep − production − shippingCost − paymentFee
 *   paymentFee     = grossCustomerPays · fp + fixed
 *                  = revenueYouKeep · (1 + taxRate) · fp + fixed
 *
 * Substituting and solving for revenueYouKeep:
 *
 *   revenueYouKeep · (1 − m − (1 + rate)·fp) = production + shippingCost + fixed
 *
 * The sticker is then the per-unit share of that, grossed back up for tax in
 * inclusive markets and rounded by the currency's rule. Rounding nudges the
 * realised margin slightly above target (charm rounding only ever rounds up to
 * the ending), which is the safe direction.
 */
export function suggestPrice(
  product: ProductDefinition,
  scenario: PriceScenario,
  settings: PricingSettings,
  targetMarginPct: number,
): number | null {
  const currency = scenario.currency;
  const copies = Math.max(1, scenario.copies);
  const m = targetMarginPct / 100;

  const taxPol = settings.tax.perCurrency[currency] ?? { behavior: "exclusive" as const, assumedRatePct: 0 };
  const rate = Math.max(0, taxPol.assumedRatePct) / 100;
  const fee = feeFor(settings, currency);
  const fp = feePercent(fee);

  const denominator = 1 - m - (1 + rate) * fp;
  // A target at or above what fees and tax leave behind has no finite answer.
  if (denominator <= 0) return null;

  const costToCurrency = convertCostAmount(settings, 1, product.cost.currency, currency);
  const production = totalUnitCost(product.cost, scenario) * copies * costToCurrency;
  const shippingCostCcy =
    typeof scenario.liveShippingCost === "number"
      ? scenario.liveShippingCost
      : estimateShippingCost(product.shipping);
  const shippingCost = shippingCostCcy * costToCurrency;
  const shippingCharged = resolveShippingCharged(product.shipping, shippingCost);

  const revenueYouKeep = (production + shippingCost + fee.fixed) / denominator;
  // Shipping revenue is fixed by policy, so only the goods portion is ours to set.
  const netRevenue = revenueYouKeep - shippingCharged;
  if (netRevenue <= 0) return null;

  const netPerUnit = netRevenue / copies;
  // Inclusive markets quote tax-in, so gross the ex-tax figure back up.
  const sticker = taxPol.behavior === "inclusive" ? netPerUnit * (1 + rate) : netPerUnit;

  const rounded = applyRounding(sticker, settings.rounding[currency]);
  return Math.max(rounded, settings.floorPrice[currency] ?? 0);
}

/**
 * The page-tier price to STORE so that every variant on offer clears the target
 * margin — {@link suggestPrice} for the cheapest variant, with that variant's
 * delta backed out.
 *
 * A tier price buys the base variant; a customer picking an option priced below
 * it pays less for the same production cost. Targeting the base would leave that
 * customer under the target (and, with a deep enough delta, under water), so the
 * target is applied to the cheapest orderable combination and everything pricier
 * lands above it. With no negative deltas — the usual case — the cheapest variant
 * IS the base and this returns exactly what {@link suggestPrice} does.
 */
export function suggestTierPrice(
  product: ProductDefinition,
  scenario: PriceScenario,
  settings: PricingSettings,
  targetMarginPct: number,
): number | null {
  const variant = scenario.variant ?? cheapestVariant(product.variants, scenario.currency);
  const sticker = suggestPrice(product, { ...scenario, variant }, settings, targetMarginPct);
  if (sticker == null) return null;
  const delta = variantPriceDelta(product.variants, variant, scenario.currency);
  return round2(Math.max(0, sticker - delta));
}

// ---- Shipping ---------------------------------------------------------------

/** Shipping cost estimate used when no live quote is available. */
function estimateShippingCost(shipping: ProductShippingPolicy): number {
  if (shipping.pricing.mode === "flat") return shipping.pricing.default;
  // Passthrough charges what shipping costs us, so with no quote it needs a
  // configured stand-in; free shipping has nothing to estimate.
  if (shipping.pricing.mode === "passthrough") return shipping.pricing.fallbackCost ?? 0;
  return 0;
}

/**
 * Whether shipping can be priced without a live quote. `free` and `flat` are
 * self-sufficient (both charge a configured amount), but `passthrough` charges
 * the provider's cost — with no quote and no `fallbackCost` it would charge zero
 * while we still pay to ship, so an order in that state must not be priced.
 */
export function hasUsableShippingCost(
  shipping: ProductShippingPolicy,
  liveShippingCost: number | undefined,
): boolean {
  if (typeof liveShippingCost === "number") return true;
  if (shipping.pricing.mode !== "passthrough") return true;
  return (shipping.pricing.fallbackCost ?? 0) > 0;
}

/** What the customer is charged for shipping, given the cost we pay. */
export function resolveShippingCharged(shipping: ProductShippingPolicy, shippingCost: number): number {
  switch (shipping.pricing.mode) {
    case "passthrough":
      return shippingCost * (1 + (shipping.pricing.markupPct ?? 0) / 100);
    case "free":
      return 0;
    case "flat":
      return shipping.pricing.default;
  }
}

// ---- Geo eligibility -------------------------------------------------------

function regionListed(codes: string[], region?: string): boolean {
  if (!region) return false;
  const r = region.trim().toUpperCase();
  return codes.some((c) => c.trim().toUpperCase() === r);
}

/** Whether a destination is allowed by the product's geo policy. */
export function isDestinationAllowed(policy: GeoPolicy, dest: GeoMatch): boolean {
  const country = dest.country?.trim().toUpperCase();
  if (!country) return false;
  const inCountries = policy.countries.some((c) => c.trim().toUpperCase() === country);

  let countryOk: boolean;
  if (policy.mode === "all") countryOk = true;
  else if (policy.mode === "allowlist") countryOk = inCountries;
  else countryOk = !inCountries; // blocklist

  if (!countryOk) return false;

  const regionRule = policy.regions[country] ?? policy.regions[country?.toLowerCase() ?? ""];
  if (!regionRule || !dest.region) return true;
  const listed = regionListed(regionRule.codes, dest.region);
  return regionRule.mode === "allowlist" ? listed : !listed;
}

/** Reachable iff at least one country is allowed (sanity for validation). */
export function hasReachableDestination(policy: GeoPolicy): boolean {
  if (policy.mode === "all") return true;
  if (policy.mode === "allowlist") return policy.countries.length > 0;
  // blocklist: reachable unless it somehow blocks the entire world (can't enumerate) → assume yes
  return true;
}

// ---- Public projection -----------------------------------------------------

/**
 * Strip cost / fee / margin internals and bake resolved per-currency display
 * prices (at the configured display page count) for the storefront.
 */
export function toPublicProduct(product: ProductDefinition, settings: PricingSettings): PublicProduct {
  const displayPages = product.pricing.displayPages ?? product.conditions.pages.min;
  const prices: Record<CurrencyCode, number> = {};
  const taxBehavior: Record<CurrencyCode, TaxBehavior> = {};
  for (const currency of settings.currencies) {
    prices[currency] = computeRetailPrice(product, { currency, pages: displayPages, copies: 1 }, settings);
    taxBehavior[currency] = settings.tax.perCurrency[currency]?.behavior ?? "exclusive";
  }
  const defaultVariant = variantFromSku(product.provider.sku) ?? undefined;
  return {
    id: product.id,
    status: product.status,
    sortOrder: product.sortOrder,
    name: product.presentation.name,
    tagline: product.presentation.tagline,
    description: product.presentation.description,
    badges: product.presentation.badges,
    sku: product.provider.sku,
    printAreas: product.provider.printAreas,
    spec: product.spec,
    variants: product.variants,
    defaultVariant,
    conditions: product.conditions,
    prices,
    priceTiers: product.pricing.tiers,
    supportedCurrencies: settings.currencies,
    taxBehavior,
    shipping: {
      methods: product.shipping.methods,
      destinations: product.shipping.destinations,
      pricing: product.shipping.pricing,
    },
  };
}
