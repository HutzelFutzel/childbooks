/**
 * Pure calculators for the product configurator — shared by the admin margin
 * preview, the public price projection, and (later) checkout. No I/O.
 *
 * Per-product input is just the page-tier price table. All shared economics
 * (currencies, FX, payment fees, rounding, tax) come from {@link PricingSettings},
 * so these functions take both the product and the global settings.
 */
import type { ShippingMethod } from "../fulfillment/types";
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
  PublicShippingRate,
  ShippingFallbackRow,
  TaxBehavior,
} from "./products";
import { enabledMarkets, type MarketRegistry } from "./markets";
import { availableMethodsFor, type MarketCapability } from "./marketCapability";
import {
  methodLabel,
  methodOfferedIn,
  SHIPPING_METHODS,
  type ShippingSettings,
} from "./shipping";
import {
  VARIANT_COST_AXES,
  costVariantKey,
  cheapestVariant,
  variantPriceDelta,
  type ProductVariantPolicy,
  type VariantDelta,
  type VariantSelection,
} from "./variants";

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
 * Convert a PRICE between currencies, at the plain rate.
 *
 * The counterpart of {@link convertCostAmount}, and the buffer is the whole
 * difference. That padding exists to overstate what we PAY; applied to an
 * amount we CHARGE it just quietly overcharges the customer by the buffer
 * percentage in every non-base currency.
 */
export function convertPriceAmount(
  settings: PricingSettings,
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
): number {
  if (from === to) return amount;
  return amount * (fxRate(settings, to) / fxRate(settings, from));
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
  /**
   * The variant being made. Print tier and paper set the per-page rate, so
   * without this the base variant's rate is used — which is the costliest one
   * we sell, and so overstates rather than understates.
   */
  variant?: VariantSelection;
  /** Per-unit production cost from a live provider quote (cost currency). */
  liveUnitCost?: number;
  /** Total shipping cost from a live provider quote (cost currency). */
  liveShippingCost?: number;
  /** Where the order ships, for picking a measured shipping row. */
  destinationCountry?: string;
  /** Shipping tier the order uses, for picking a measured shipping row. */
  shippingMethod?: ShippingMethod;
}

/**
 * The per-page rate for a variant: its own measured rate when we have one, the
 * base variant's otherwise.
 */
export function perPageCostFor(cost: ProductCostModel, variant: VariantSelection | undefined): number {
  if (!variant) return cost.table.perPage;
  const measured = cost.variantPerPage?.[costVariantKey(variant)];
  return typeof measured === "number" && Number.isFinite(measured) ? measured : cost.table.perPage;
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
  const base = cost.table.basePerUnit + perPageCostFor(cost, scenario.variant) * scenario.pages;
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

/**
 * A scenario to price. `variant` (inherited from {@link CostScenario}) is both
 * what gets made and what gets charged: it selects the measured per-page cost
 * AND the price delta over the page tier. Omitted ⇒ the base variant, which is
 * the one the product's own SKU encodes and the tier price is quoted for.
 */
export interface PriceScenario extends CostScenario {
  currency: CurrencyCode;
}

/** The tier whose page range contains `pages` (first match; falls back to the last tier). */
export function pickTier(tiers: PageTier[], pages: number): PageTier | undefined {
  return tiers.find((t) => pages >= t.minPages && pages <= t.maxPages) ?? tiers[tiers.length - 1];
}

/**
 * One rung of a page-range ladder: "generate rows of `step` pages each, up to
 * and including `upTo`". A ladder is a list of these, so a table can start
 * fine-grained (e.g. every 10 pages to 100) and get coarser further out (every
 * 100 pages to 1000) without the admin drawing each row by hand.
 */
export interface RangeBand {
  upTo: number;
  step: number;
}

/**
 * Contiguous, gap-free {@link PageTier} rows from `startPage` through the last
 * band's `upTo`, stepping by each band's `step` in turn.
 *
 * Gap-free matters beyond tidiness: {@link pickTier} does a first-match lookup
 * and falls back to the LAST tier when nothing matches, so a hole between rows
 * (e.g. from a bad step) would silently price whatever page count lands in it
 * off the wrong tier instead of failing loudly. Bands are read in order and any
 * band that doesn't advance past the current cursor (a non-positive step, or an
 * `upTo` at or before where the previous band left off) is skipped rather than
 * emitting a zero-width or backwards row.
 */
export function generateSteppedTiers(
  startPage: number,
  bands: RangeBand[],
  currencies: CurrencyCode[],
  seedPrices: Record<CurrencyCode, number> = {},
): PageTier[] {
  const tiers: PageTier[] = [];
  let cursor = Math.max(1, Math.round(startPage));
  for (const { upTo, step } of bands) {
    const ceiling = Math.round(upTo);
    const width = Math.round(step);
    if (width < 1 || ceiling < cursor) continue;
    while (cursor <= ceiling) {
      const maxPages = Math.min(cursor + width - 1, ceiling);
      const prices: Record<string, number> = {};
      for (const c of currencies) prices[c] = seedPrices[c] ?? 0;
      tiers.push({ minPages: cursor, maxPages, prices });
      cursor = maxPages + 1;
    }
  }
  return tiers;
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
  const delta = variantPriceDelta(product.variants, scenario.variant, currency, scenario.pages);
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
  shippingSettings: ShippingSettings,
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
    typeof scenario.liveShippingCost === "number"
      ? scenario.liveShippingCost
      : estimateShippingCost(shipping, scenario);
  const shippingCost = round2(shippingCostCostCcy * costToCurrency);
  const shippingCharged = round2(
    resolveShippingCharged(shippingSettings, settings, shippingCost, {
      currency,
      copies,
      method: scenario.shippingMethod,
    }),
  );

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
  shippingSettings: ShippingSettings,
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
      : estimateShippingCost(product.shipping, scenario);
  const shippingCost = shippingCostCcy * costToCurrency;
  const shippingCharged = resolveShippingCharged(shippingSettings, settings, shippingCost, {
    currency,
    copies,
    method: scenario.shippingMethod,
  });

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
  shippingSettings: ShippingSettings,
): number | null {
  const variant =
    scenario.variant ?? cheapestVariant(product.variants, scenario.currency, scenario.pages);
  const sticker = suggestPrice(
    product,
    { ...scenario, variant },
    settings,
    targetMarginPct,
    shippingSettings,
  );
  if (sticker == null) return null;
  const delta = variantPriceDelta(product.variants, variant, scenario.currency, scenario.pages);
  return round2(Math.max(0, sticker - delta));
}

/**
 * Price deltas for every offered option, derived from what the options
 * actually cost rather than typed in by hand.
 *
 * Print tier and paper change only the PER-PAGE cost, so their price delta is
 * purely per-page too — which is the whole point: one number then prices the
 * upgrade correctly on a 24-page board book and a 400-page chapter book alike.
 * Cover finish costs the same either way and is left alone, since any charge
 * there is a positioning decision rather than a cost to recover.
 *
 * The gross-up matches {@link suggestPrice} exactly, so an option priced from
 * here lands on the same target margin as the tier price it sits on top of.
 * Returns null when the product has no per-variant measurement to derive from —
 * guessing here would quietly overwrite deltas someone reasoned about.
 */
export function suggestVariantDeltas(
  product: ProductDefinition,
  settings: PricingSettings,
  targetMarginPct: number,
): ProductVariantPolicy | null {
  const measured = product.cost.variantPerPage;
  if (!measured || Object.keys(measured).length === 0) return null;
  const base = variantFromSku(product.provider.sku);
  if (!base) return null;

  const m = targetMarginPct / 100;
  const basePerPage = perPageCostFor(product.cost, base);
  const options = { ...product.variants.options };

  for (const axis of VARIANT_COST_AXES) {
    options[axis] = product.variants.options[axis].map((choice) => {
      if (choice.value === base[axis]) return { value: choice.value };
      const costPerPage = perPageCostFor(product.cost, { ...base, [axis]: choice.value });
      const deltaCostPerPage = costPerPage - basePerPage;

      const priceDelta: Record<CurrencyCode, VariantDelta> = {};
      for (const currency of settings.currencies) {
        const taxPol = settings.tax.perCurrency[currency] ?? { behavior: "exclusive" as const, assumedRatePct: 0 };
        const rate = Math.max(0, taxPol.assumedRatePct) / 100;
        const fp = feePercent(feeFor(settings, currency));
        const denominator = 1 - m - (1 + rate) * fp;
        if (denominator <= 0) continue;

        const costCcy = deltaCostPerPage * convertCostAmount(settings, 1, product.cost.currency, currency);
        const net = costCcy / denominator;
        // Inclusive markets quote tax-in, so gross the ex-tax figure back up.
        const perPage = taxPol.behavior === "inclusive" ? net * (1 + rate) : net;
        if (Math.abs(perPage) >= 1e-4) priceDelta[currency] = { perCopy: 0, perPage: round(perPage, 4) };
      }
      return Object.keys(priceDelta).length > 0 ? { value: choice.value, priceDelta } : { value: choice.value };
    });
  }

  return { ...product.variants, options };
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// ---- Shipping ---------------------------------------------------------------

/** Shipping tiers cheapest → fastest, the order a customer is offered them in. */
const METHODS_BY_SPEED: ShippingMethod[] = ["Budget", "StandardPlus", "Standard", "Express", "Overnight"];

/**
 * Which destination policy governs a product: its own override, or the
 * catalog's.
 *
 * The single place the two are reconciled. Both are only ever a NARROWING —
 * {@link isDestinationAllowed} intersects with the market registry before
 * either is consulted — so this choosing one over the other can't widen
 * anything, whichever it picks.
 */
export function destinationPolicyFor(
  settings: ShippingSettings,
  shipping: ProductShippingPolicy,
): GeoPolicy {
  return shipping.destinationsOverride ?? settings.destinations;
}

/**
 * A tier to quote when the caller has to pick one on the customer's behalf (a
 * price preview, say). The cheapest offered tier, since that's the one a "from"
 * price should quote.
 */
export function defaultShippingMethod(settings: ShippingSettings): ShippingMethod {
  return METHODS_BY_SPEED.find((m) => settings.methods[m]?.offered) ?? "StandardPlus";
}

/**
 * The measured row for a destination + tier.
 *
 * An exact country match or nothing. There is deliberately no "nearest
 * measured country" fallback: shipping to Australia costs nothing like shipping
 * to Canada, and a passthrough product BILLS this number, so substituting one
 * for the other would overcharge or undercharge a real customer. A destination
 * we never measured falls through to the scalar `shipping.fallbackCost`, which
 * is only ever set from a sweep that reached every zone.
 */
export function shippingRowFor(
  shipping: ProductShippingPolicy,
  country: string | undefined,
  method: ShippingMethod | undefined,
): ShippingFallbackRow | undefined {
  const rows = shipping.fallback;
  if (!rows || rows.length === 0 || !country || !method) return undefined;
  const c = country.trim().toUpperCase();
  return rows.find((r) => r.method === method && r.country.toUpperCase() === c);
}

/**
 * Whether the provider was measured to refuse this tier to this destination.
 *
 * Deliberately false for anything unmeasured: "never probed" is not evidence of
 * unavailability, and treating it as such would disable working tiers the
 * moment a new country was allowed.
 */
export function shippingTierRefused(
  shipping: ProductShippingPolicy,
  country: string | undefined,
  method: ShippingMethod,
): boolean {
  const row = shippingRowFor(shipping, country, method);
  return row != null && !row.available;
}

/**
 * The speeds a customer in one country may actually choose — the ONE answer
 * every surface asks for.
 *
 * Four filters, in order of how firmly they're known:
 *   1. we sell the speed at all (global veto),
 *   2. we sell it to this country (per-country veto),
 *   3. the provider was DISCOVERED to run it there (coverage sweep),
 *   4. it wasn't MEASURED to be refused for this specific book.
 *
 * Note what isn't a filter: "we have no measurement". Unknown is not
 * unavailable. The sweep's `status` already collapses to no methods when a
 * probe failed, and treating a missing per-product row as a refusal would hide
 * every speed in a market the moment it was opened, before anything had been
 * measured for it.
 *
 * The inversion this encodes is the point of the whole design. Availability
 * used to be declared per product and coverage was advisory, so a speed the
 * provider didn't run to a country was still offered there — and the order
 * failed after the customer had typed their address.
 */
export function offeredMethodsFor(
  settings: ShippingSettings,
  capability: MarketCapability | undefined,
  shipping: ProductShippingPolicy,
  country: string | null | undefined,
): ShippingMethod[] {
  const code = (country ?? "").trim().toUpperCase();
  const reachable = new Set(availableMethodsFor(capability));
  return METHODS_BY_SPEED.filter((method) => {
    if (!methodOfferedIn(settings, code, method)) return false;
    if (code && reachable.size > 0 && !reachable.has(method)) return false;
    return !shippingTierRefused(shipping, code, method);
  });
}

/**
 * What shipping COSTS US for a route, when no live quote is available.
 *
 * Deliberately independent of how we charge for it. What we pay the provider
 * doesn't change because we decided to advertise free shipping — the previous
 * version returned 0 under `free` and the flat rate under `flat`, so margin was
 * computed against a cost we don't pay and a number denominated in the wrong
 * currency. Both showed profit that wasn't there.
 *
 * Only ever the measured row for the ACTUAL destination and tier. The scalar
 * `shipping.fallbackCost` is deliberately not a catch-all for unmeasured
 * countries: it was fitted to the handful of routes a sweep visited, and
 * billing it to a destination nobody measured is a number invented about a
 * country we know nothing about. With markets openable by an admin, the
 * unmeasured case is the common one rather than the exception, so those orders
 * are refused instead — see {@link hasUsableShippingCost}.
 *
 * The scalar still serves a measured country whose specific tier has no row.
 */
export function estimateShippingCost(
  shipping: ProductShippingPolicy,
  scenario?: { destinationCountry?: string; shippingMethod?: ShippingMethod; copies?: number },
): number {
  const row = shippingRowFor(shipping, scenario?.destinationCountry, scenario?.shippingMethod);
  if (row?.available) {
    return row.base + row.perCopy * Math.max(1, scenario?.copies ?? 1);
  }
  // The destination has SOME measurement, just not for this tier — the scalar is
  // at least fitted to routes this product really ships.
  if (hasMeasurementFor(shipping, scenario?.destinationCountry)) {
    return shipping.fallbackCost ?? 0;
  }
  return 0;
}

/** Whether the sweep ever reached this destination, for any tier. */
function hasMeasurementFor(
  shipping: ProductShippingPolicy,
  country: string | undefined,
): boolean {
  const rows = shipping.fallback;
  if (!rows || rows.length === 0 || !country) return false;
  const c = country.trim().toUpperCase();
  return rows.some((r) => r.country.toUpperCase() === c);
}

/**
 * Whether shipping can be CHARGED for this route.
 *
 * `free` always can (there's nothing to work out). `flat` needs a rate for the
 * chosen speed — and a live provider quote does not rescue it, because a flat
 * rate is what the customer pays regardless of what we're quoted. `passthrough`
 * needs either a live quote or a measured rate for THIS destination; with
 * neither it would charge zero while we still pay to ship, or bill a figure
 * fitted to a different continent.
 *
 * The customer sees "we can't price shipping right now, try again", which is
 * recoverable. A silently wrong shipping charge is not.
 */
export function hasUsableShippingCost(
  settings: ShippingSettings,
  shipping: ProductShippingPolicy,
  liveShippingCost: number | undefined,
  scenario?: { destinationCountry?: string; shippingMethod?: ShippingMethod; copies?: number },
): boolean {
  const { pricing } = settings;
  if (pricing.mode === "free") return true;
  if (pricing.mode === "flat") {
    const method = scenario?.shippingMethod;
    return method ? (pricing.flatPerMethod[method] ?? 0) > 0 : false;
  }
  if (typeof liveShippingCost === "number") return true;
  return estimateShippingCost(shipping, scenario) > 0;
}

/**
 * What the customer is charged for shipping.
 *
 * `shippingCost` is what we PAY, already converted into `ctx.currency`. Only
 * passthrough derives the charge from it; the other two modes name their own
 * amount and ignore it entirely.
 *
 * The handling fee and the flat rate are converted here rather than by the
 * caller because both are PRICES entered in their own currency, so both convert
 * at the plain rate. Running them through the cost conversion would apply the
 * FX buffer — which exists to overstate what we pay — and quietly overcharge by
 * that percentage in every non-base currency.
 */
export function resolveShippingCharged(
  shippingSettings: ShippingSettings,
  pricingSettings: PricingSettings,
  shippingCost: number,
  ctx: { currency: CurrencyCode; copies?: number; method?: ShippingMethod },
): number {
  const { pricing } = shippingSettings;
  switch (pricing.mode) {
    case "passthrough": {
      const units = pricing.fixedAddKind === "perCopy" ? Math.max(1, ctx.copies ?? 1) : 1;
      const add = convertPriceAmount(
        pricingSettings,
        pricing.fixedAdd * units,
        pricing.fixedAddCurrency,
        ctx.currency,
      );
      return shippingCost * (1 + pricing.markupPct / 100) + add;
    }
    case "free":
      return 0;
    case "flat": {
      // Per speed, not one amount for all of them. A single flat rate next to
      // derived availability sells Overnight at the Budget price and the
      // difference comes straight out of margin.
      const rate = ctx.method ? (pricing.flatPerMethod[ctx.method] ?? 0) : 0;
      return convertPriceAmount(pricingSettings, rate, pricing.flatCurrency, ctx.currency);
    }
  }
}

// ---- Geo eligibility -------------------------------------------------------

function regionListed(codes: string[], region?: string): boolean {
  if (!region) return false;
  const r = region.trim().toUpperCase();
  return codes.some((c) => c.trim().toUpperCase() === r);
}

/**
 * Whether a destination is allowed — by the market registry first, and by the
 * product's own geo policy second.
 *
 * The ceiling lives HERE, in the one function every caller already goes through,
 * rather than as a second check alongside it. A separate rule is a rule someone
 * adding a checkout path can forget; this one they'd have to actively remove.
 * The product policy can only narrow the set, never widen it, so a product
 * misconfigured to ship worldwide still ships only where we sell.
 *
 * `registry` is a required parameter rather than a cached module global for the
 * same reason: with an argument, forgetting the ceiling is a compile error. An
 * unloaded registry is empty and therefore refuses everything, which is the
 * direction a failure should fall.
 */
export function isDestinationAllowed(
  registry: MarketRegistry,
  policy: GeoPolicy,
  dest: GeoMatch,
): boolean {
  const country = dest.country?.trim().toUpperCase();
  if (!country) return false;
  if (!registry.enabled.has(country)) return false;
  const inCountries = policy.countries.some((c) => c.trim().toUpperCase() === country);

  let countryOk: boolean;
  // `all` means "everywhere we sell", which the ceiling above has already
  // decided. A stored blocklist still subtracts from that set — it can carve
  // markets out, which is a narrowing, and never adds one back.
  if (policy.mode === "all") countryOk = true;
  else if (policy.mode === "allowlist") countryOk = inCountries;
  else countryOk = !inCountries; // blocklist

  if (!countryOk) return false;

  const regionRule = policy.regions[country] ?? policy.regions[country?.toLowerCase() ?? ""];
  if (!regionRule || !dest.region) return true;
  const listed = regionListed(regionRule.codes, dest.region);
  return regionRule.mode === "allowlist" ? listed : !listed;
}

/**
 * The countries this product can actually be ordered to: the enabled markets
 * the policy doesn't exclude. Drives the checkout country picker, so what a
 * customer can choose and what the server will accept come from one place.
 */
export function allowedMarketsFor(registry: MarketRegistry, policy: GeoPolicy): string[] {
  return enabledMarkets(registry).filter((c) => isDestinationAllowed(registry, policy, { country: c }));
}

/** Reachable iff at least one enabled market is allowed (sanity for validation). */
export function hasReachableDestination(registry: MarketRegistry, policy: GeoPolicy): boolean {
  return allowedMarketsFor(registry, policy).length > 0;
}

// ---- Public projection -----------------------------------------------------

/**
 * Strip cost / fee / margin internals and bake resolved per-currency display
 * prices (at the configured display page count) for the storefront.
 *
 * `offerable` is passed in rather than computed here: it comes from
 * `isOfferable`, which lives in `productValidation` and already depends on this
 * module. Deciding it at the call site also keeps it honest about the provider
 * environment being served, which only the server knows.
 */
export function toPublicProduct(
  product: ProductDefinition,
  settings: PricingSettings,
  opts: {
    offerable: boolean;
    registry: MarketRegistry;
    shipping: ShippingSettings;
    /**
     * Discovered provider coverage, so the projection only publishes speeds the
     * provider was seen to run. Optional: with no sweep on record every offered
     * speed is published, which is the same "unknown is not unavailable" rule
     * {@link offeredMethodsFor} applies.
     */
    capability?: ReadonlyMap<string, MarketCapability>;
    plans?: readonly PrintDiscountPlan[];
  },
): PublicProduct {
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
    offerable: opts.offerable,
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
    planPrintDiscountPct: projectPlanPrintDiscounts(
      product,
      settings,
      opts.shipping,
      opts.plans ?? [],
    ),
    shipping: {
      // Resolved from the catalog-wide policy, not stored on the product. The
      // storefront still needs to NAME the speeds it was given rates for, so
      // the shape survives even though the source moved.
      methods: SHIPPING_METHODS.map((method) => ({
        method,
        enabled: opts.shipping.methods[method]?.offered ?? false,
        label: methodLabel(opts.shipping, method),
      })),
      destinations: destinationPolicyFor(opts.shipping, product.shipping),
      // Mode only — markup, handling fee and the measured wholesale rate are
      // ours, and the last is denominated in the cost currency besides.
      pricing: { mode: opts.shipping.pricing.mode },
      rates: projectShippingRates(product, settings, opts.registry, opts.shipping, opts.capability),
    },
  };
}

/** The plan fields the print-discount clamp needs (satisfied by either plan shape). */
export interface PrintDiscountPlan {
  id: string;
  printDiscountPct: number;
}

/**
 * The print discount each plan's members really get, clamped to break-even.
 *
 * Checkout applies `min(plan%, breakEven%)` per order (see
 * `effectivePrintDiscountPct`), and break-even needs the cost table. Rather than
 * publish cost — or let the storefront advertise a discount checkout would
 * shave — the clamp is resolved here across the scenario space the product
 * sells and the WORST (most-clamped) result is published.
 *
 * Worst-case is the safe direction: the published number can only be lower than
 * what a given order qualifies for, so the storefront under-promises and
 * checkout comes in at or below it. In the normal case — a product priced to a
 * healthy margin — nothing clamps and this is just the plan's own percentage.
 */
function projectPlanPrintDiscounts(
  product: ProductDefinition,
  settings: PricingSettings,
  shippingSettings: ShippingSettings,
  plans: readonly PrintDiscountPlan[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const wanted = plans.filter((p) => p.printDiscountPct > 0);
  if (wanted.length === 0) return out;

  // One copy is the worst case: the processor's FIXED fee is amortized over the
  // order, so a single-copy order has the least room and the tightest break-even.
  const copies = Math.max(1, product.conditions.copies.min);
  const headroom = worstBreakEvenDiscountPct(product, settings, shippingSettings, copies);
  for (const plan of wanted) {
    out[plan.id] = Math.round(Math.min(plan.printDiscountPct, headroom) * 10) / 10;
  }
  return out;
}

/**
 * The lowest break-even discount across every currency, page tier and variant
 * the product offers — the deepest discount that is safe EVERYWHERE it sells.
 *
 * Evaluated at each tier's shortest book (its thinnest margin) and at the
 * cheapest orderable variant, which is where a price first stops covering
 * itself. Mirrors the sweep `validateProduct` already runs, for the same reason:
 * a number that holds at the display page count can collapse at 400 pages.
 */
export function worstBreakEvenDiscountPct(
  product: ProductDefinition,
  settings: PricingSettings,
  shippingSettings: ShippingSettings,
  copies = 1,
): number {
  const { pages } = product.conditions;
  const tiers = product.pricing.tiers;
  const checkPoints =
    tiers.length > 0 ? tiers.map((t) => Math.max(pages.min, t.minPages)) : [pages.min];
  let worst = 100;
  for (const currency of settings.currencies) {
    for (const pg of checkPoints) {
      const variant = cheapestVariant(product.variants, currency, pg);
      try {
        const m = computeMargin(
          product,
          { currency, pages: pg, copies, variant },
          settings,
          shippingSettings,
        );
        worst = Math.min(worst, m.breakEvenDiscountPct);
      } catch {
        // An unpriceable scenario tells us nothing about safe headroom; the
        // other check points still bound it, and validation reports the cause.
        continue;
      }
    }
  }
  return Math.max(0, worst);
}

/**
 * Charged shipping for every destination × speed this product offers, per
 * currency — the customer-facing projection of the measured rate matrix.
 *
 * This is where the catalog-wide policy meets one product's measurements, and
 * the result is the ONLY thing the storefront reads. That's deliberate: there
 * is no public copy of the shipping settings, so the picker, the price table
 * and the simulator can't disagree with each other about what's on sale.
 *
 * Only offered speeds, only markets the geo policy allows, and only speeds the
 * provider was discovered to run there — so the storefront can't quote a
 * combination checkout would refuse.
 */
export function projectShippingRates(
  product: ProductDefinition,
  settings: PricingSettings,
  registry: MarketRegistry,
  shippingSettings: ShippingSettings,
  capability?: ReadonlyMap<string, MarketCapability>,
): PublicShippingRate[] {
  const { shipping } = product;
  const countries = allowedMarketsFor(registry, destinationPolicyFor(shippingSettings, shipping));
  const rates: PublicShippingRate[] = [];

  for (const country of countries) {
    // Publishes a row per speed we'd offer here, including the refusals — a
    // greyed-out option with a reason beats one that works until the order is
    // placed. Speeds vetoed globally or for this country produce no row at all,
    // because they aren't on sale and there is nothing to explain.
    const methods = SHIPPING_METHODS.filter((method) =>
      methodOfferedIn(shippingSettings, country, method),
    );
    const reachable = new Set(availableMethodsFor(capability?.get(country)));
    for (const method of methods) {
      const row = shippingRowFor(shipping, country, method);
      // Two different refusals, published the same way: the provider told us it
      // doesn't run this speed here (a measured row) or the sweep never saw it
      // among the services it offers here.
      const refused = (row && !row.available) || (reachable.size > 0 && !reachable.has(method));
      if (refused) {
        rates.push({ country, method, available: false, charged: {}, measured: row != null });
        continue;
      }
      const days = {
        ...(row?.transitDaysMin != null ? { transitDaysMin: row.transitDaysMin } : {}),
        ...(row?.transitDaysMax != null ? { transitDaysMax: row.transitDaysMax } : {}),
      };
      // An unmeasured route in a passthrough product has no honest published
      // price: the scalar fallback was fitted to countries the sweep visited,
      // and this isn't one. Checkout will live-quote it and succeed; the
      // storefront simply declines to promise a number in advance rather than
      // advertising one it would then contradict.
      if (
        !row &&
        shippingSettings.pricing.mode === "passthrough" &&
        !hasMeasurementFor(shipping, country)
      ) {
        rates.push({ country, method, available: true, charged: {}, measured: false, ...days });
        continue;
      }
      const charged: PublicShippingRate["charged"] = {};
      for (const currency of settings.currencies) {
        const terms = chargedShippingTerms(product, settings, shippingSettings, row, {
          currency,
          method,
        });
        if (terms) charged[currency] = terms;
      }
      rates.push({
        country,
        method,
        available: true,
        charged,
        measured: row?.available === true,
        ...days,
      });
    }
  }
  return rates;
}

/**
 * What one route costs the customer, as the two terms the projection publishes,
 * or null when this product can't price shipping at all.
 *
 * Both terms are derived together because the policy that sets them is per-mode:
 * passthrough scales with copies (so both terms are real), while flat charges one
 * amount per order however many copies it holds (so the whole rate is the base).
 * Passthrough is linear in cost, which is what makes distributing markup and FX
 * across the terms exact rather than an approximation of a rounded total.
 */
export function chargedShippingTerms(
  product: ProductDefinition,
  settings: PricingSettings,
  shippingSettings: ShippingSettings,
  row: ShippingFallbackRow | undefined,
  ctx: { currency: CurrencyCode; method: ShippingMethod },
): { base: number; perCopy: number } | null {
  const { pricing } = shippingSettings;
  const { currency } = ctx;
  switch (pricing.mode) {
    case "free":
      return { base: 0, perCopy: 0 };
    case "flat": {
      // Per speed. A single amount for every tier sells Overnight at the Budget
      // price, which is the reason flat mode doesn't get automatic availability.
      const rate = pricing.flatPerMethod[ctx.method];
      if (rate == null) return null;
      return {
        base: round4(convertPriceAmount(settings, rate, pricing.flatCurrency, currency)),
        perCopy: 0,
      };
    }
    case "passthrough": {
      const fx = convertCostAmount(settings, 1, product.cost.currency, currency);
      const markup = 1 + pricing.markupPct / 100;
      const base = row?.available ? row.base : (product.shipping.fallbackCost ?? 0);
      const perCopy = row?.available ? row.perCopy : 0;
      // Nothing measured and no fallback configured. Publishing zero here would
      // read as free shipping on a product that in fact can't be shipped at any
      // price; publishing nothing makes the storefront say so instead. Validation
      // blocks offering a product in this state, so only drafts reach it.
      if (base === 0 && perCopy === 0) return null;
      // The handling fee rides on whichever term matches how it's charged, so
      // the published two-term shape stays exact rather than approximating a
      // per-order fee as a per-copy one. It is a PRICE, so it converts at the
      // plain rate while the provider's cost converts with the FX buffer.
      const add = convertPriceAmount(
        settings,
        pricing.fixedAdd,
        pricing.fixedAddCurrency,
        currency,
      );
      const perOrderAdd = pricing.fixedAddKind === "perOrder" ? add : 0;
      const perCopyAdd = pricing.fixedAddKind === "perCopy" ? add : 0;
      return {
        base: round4(base * fx * markup + perOrderAdd),
        perCopy: round4(perCopy * fx * markup + perCopyAdd),
      };
    }
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---- Public (storefront-side) pricing --------------------------------------

/**
 * Everything the storefront needs to price a hypothetical order. Deliberately
 * the same shape as {@link PriceScenario} minus the cost-only fields, so a
 * caller can move between the two without rethinking the inputs.
 */
export interface PublicPriceScenario {
  currency: CurrencyCode;
  pages: number;
  copies: number;
  variant?: VariantSelection;
  destinationCountry?: string;
  shippingMethod?: ShippingMethod;
  /** Plan whose print discount to apply; omitted/unknown ⇒ list price. */
  planId?: string | null;
}

/**
 * The per-copy price a customer is charged, computed from the PUBLIC projection.
 *
 * Deliberately a re-expression of {@link computeRetailPrice} against
 * {@link PublicProduct} rather than an approximation of it: retail price depends
 * only on the page-tier table, the variant deltas, and the currency's rounding
 * and floor — all of which the projection publishes. So this returns the exact
 * figure checkout charges for the goods, which is the whole reason a public
 * price simulator can be trusted.
 */
export function publicUnitPrice(
  product: PublicProduct,
  settings: PricingSettings,
  scenario: Pick<PublicPriceScenario, "currency" | "pages" | "variant">,
): number {
  const { currency } = scenario;
  const tiers = product.priceTiers ?? [];
  const tier = pickTier(tiers, scenario.pages);
  const base = tier?.prices[currency] ?? product.prices[currency] ?? 0;
  const delta = variantPriceDelta(product.variants, scenario.variant, currency, scenario.pages);
  const rounded = applyRounding(base + delta, settings.rounding[currency]);
  return Math.max(rounded, settings.floorPrice[currency] ?? 0);
}

/** The published rate for a destination + speed, or undefined when none exists. */
export function publicShippingRateFor(
  product: PublicProduct,
  country: string | undefined,
  method: ShippingMethod | undefined,
): PublicShippingRate | undefined {
  if (!country || !method) return undefined;
  const c = country.trim().toUpperCase();
  return product.shipping.rates.find((r) => r.method === method && r.country.toUpperCase() === c);
}

/**
 * The countries this product is PUBLISHED as shipping to.
 *
 * Read off the projected rates rather than recomputed from the geo policy: the
 * server already intersected that policy with the open markets when it built
 * the projection, so this is what the storefront was actually told. Deriving it
 * again on the client would need the registry AND could disagree with the
 * prices sitting right next to it.
 */
export function publicMarketsFor(product: PublicProduct): string[] {
  return [...new Set(product.shipping.rates.map((r) => r.country.toUpperCase()))].sort();
}

/** The speeds this product is published as actually reaching a destination. */
export function publicShippingMethodsFor(
  product: PublicProduct,
  country: string | undefined,
): ShippingMethod[] {
  const enabled = product.shipping.methods.filter((m) => m.enabled).map((m) => m.method);
  if (!country) return enabled;
  return enabled.filter((m) => publicShippingRateFor(product, country, m)?.available !== false);
}

/** One fully priced hypothetical order, in the customer's own terms. */
export interface PublicQuote {
  currency: CurrencyCode;
  copies: number;
  pages: number;
  /** Per-copy list price, before any plan discount. */
  listUnitPrice: number;
  /** Per-copy price after the plan discount. */
  unitPrice: number;
  /** Plan discount actually applied (already clamped when projected). */
  discountPct: number;
  /** All copies at `unitPrice`. */
  items: number;
  /** Charged shipping, or null when this route has no published rate. */
  shipping: number | null;
  /** `items + shipping`, or null when shipping can't be priced. */
  total: number | null;
  taxBehavior: TaxBehavior;
  /** Why shipping is null / soft, for the caller to say out loud. */
  shippingNote: "measured" | "estimated" | "unavailable" | "unpriced";
}

/**
 * Price a hypothetical order entirely from public data — the engine behind the
 * price simulator, and the one place the storefront's arithmetic lives.
 *
 * The book price is exact (see {@link publicUnitPrice}). Shipping is the
 * measured estimate, because the binding number comes from a live provider quote
 * at checkout; `shippingNote` says which of the two the caller is looking at so
 * the UI can label it honestly instead of implying a precision it doesn't have.
 */
export function simulatePublicOrder(
  product: PublicProduct,
  settings: PricingSettings,
  scenario: PublicPriceScenario,
): PublicQuote {
  const copies = Math.max(1, Math.floor(scenario.copies));
  const currency = scenario.currency;
  const listUnitPrice = publicUnitPrice(product, settings, scenario);

  const discountPct = Math.max(
    0,
    Math.min(100, scenario.planId ? (product.planPrintDiscountPct[scenario.planId] ?? 0) : 0),
  );
  const unitPrice =
    discountPct > 0 ? round2(listUnitPrice * (1 - discountPct / 100)) : listUnitPrice;
  const items = round2(unitPrice * copies);

  const rate = publicShippingRateFor(product, scenario.destinationCountry, scenario.shippingMethod);
  let shipping: number | null = null;
  let shippingNote: PublicQuote["shippingNote"];
  if (product.shipping.pricing.mode === "free") {
    shipping = 0;
    shippingNote = "measured";
  } else if (!rate) {
    shippingNote = "unpriced";
  } else if (!rate.available) {
    shippingNote = "unavailable";
  } else {
    const terms = rate.charged[currency];
    if (!terms) {
      shippingNote = "unpriced";
    } else {
      shipping = round2(terms.base + terms.perCopy * copies);
      shippingNote = rate.measured ? "measured" : "estimated";
    }
  }

  return {
    currency,
    copies,
    pages: scenario.pages,
    listUnitPrice,
    unitPrice,
    discountPct,
    items,
    shipping,
    total: shipping == null ? null : round2(items + shipping),
    taxBehavior: product.taxBehavior[currency] ?? "exclusive",
    shippingNote,
  };
}
