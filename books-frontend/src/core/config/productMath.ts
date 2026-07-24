/**
 * Pure calculators for the product configurator — shared by the admin margin
 * preview, the public price projection, and (later) checkout. No I/O.
 *
 * Per-product input is just the page-tier price table. All shared economics
 * (currencies, FX, payment fees, rounding, tax) come from {@link PricingSettings},
 * so these functions take both the product and the global settings.
 */
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
  const whole = Math.ceil(value - to);
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
  const price = tier?.prices[currency] ?? 0;
  return Math.max(applyRounding(price, rounding), floor);
}

// ---- Margin breakdown (the configurator's read-only "additional info") -----

export interface MarginBreakdown {
  currency: CurrencyCode;
  copies: number;
  pages: number;
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

// ---- Shipping ---------------------------------------------------------------

/** Rough shipping cost estimate used when no live quote is available. */
function estimateShippingCost(shipping: ProductShippingPolicy): number {
  if (shipping.pricing.mode === "flat") return shipping.pricing.default;
  return 0; // passthrough/free have no offline estimate; admin uses the live quote
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
  return {
    id: product.id,
    status: product.status,
    sortOrder: product.sortOrder,
    name: product.presentation.name,
    tagline: product.presentation.tagline,
    description: product.presentation.description,
    images: product.presentation.images,
    badges: product.presentation.badges,
    sku: product.provider.sku,
    printAreas: product.provider.printAreas,
    spec: product.spec,
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
