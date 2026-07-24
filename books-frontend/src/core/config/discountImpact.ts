/**
 * Unified **discount-impact engine** — the single source of truth for "what
 * does a discount do to my business?" across everything that's sold:
 *
 *   - print books   (production + shipping cost, live or table-estimated)
 *   - digital edition (near-zero marginal cost — but the FIXED Stripe fee
 *     doesn't shrink with the price, so deep discounts can still lose money)
 *   - Spark packs   (provider backing of the Sparks sold, at the configured
 *     assumed spend rate)
 *   - subscription plans (provider backing of the Spark grant per invoice)
 *
 * **Buyer contexts.** An item doesn't have ONE margin — it has one margin per
 * buyer, because plan perks change either the revenue or the cost side:
 *   - a plan's `printDiscountPct` lowers what its members pay for print,
 *   - a member ebook price (and the print-bundle discount stacked on top of
 *     it) lowers ebook revenue,
 *   - a plan's Spark `actionMultipliers` make each Spark buy MORE provider
 *     work (a 0.5× render discount doubles what a spent Spark costs you) —
 *     and since Sparks are fungible, that also inflates the backing cost of
 *     purchased packs for that buyer.
 * Every builder therefore takes a {@link BuyerContext}; "worst case" helpers
 * pick the most expensive eligible buyer so headline numbers are always safe.
 *
 * Every item is reduced to the same fee/tax-aware waterfall, so the admin sees
 * one consistent set of numbers everywhere:
 *
 *   netRevenue(d)   = ex-tax revenue from the discounted price
 *   gross(d)        = (netRevenue + shipping charged) + tax          (Stripe processes this)
 *   paymentFee(d)   = gross × fee% + fixed fee
 *   netProfit(d)    = netRevenue + shipping charged − direct cost − shipping cost − paymentFee
 *
 * From that, two headline numbers per item per currency:
 *   - breakEvenDiscountPct: the discount where netProfit hits exactly 0
 *   - safeMaxDiscountPct:   the deepest discount that keeps the margin at or
 *     above the configured floor (`PricingSettings.minMarginPct`)
 *
 * Pure functions, no I/O. Advisory: enforcement (the break-even clamp on plan
 * print discounts, the viability floor on the ebook bundle stack) stays at
 * checkout.
 */
import type { PublicPlan } from "./plans";
import {
  planMeetsAccess,
  type CurrencyCode,
  type PricingSettings,
  type ProductAccess,
  type ProductDefinition,
  type TaxBehavior,
} from "./products";
import type { SparkPack, SparksConfig } from "./sparks";
import { packTotalSparks } from "./sparks";
import { sparkUnitEconomics, worstActionMultiplier } from "./economics";
import {
  computeMargin,
  convertCostAmount,
  feeFor,
  feePercent,
  type MarginBreakdown,
  type PriceScenario,
} from "./productMath";

export type DiscountItemType = "print" | "ebook" | "pack" | "plan";

export const DISCOUNT_ITEM_LABELS: Record<DiscountItemType, string> = {
  print: "Print book",
  ebook: "Digital edition",
  pack: "Spark pack",
  plan: "Membership",
};

// ---- Buyer contexts -----------------------------------------------------------

/** Everything about a buyer's plan that changes an item's economics. */
export interface BuyerContext {
  /** null ⇒ a generic buyer with no plan perks. */
  planId: string | null;
  planName: string;
  isFree: boolean;
  /** Lowest Spark action multiplier the buyer enjoys (1 = no discount). */
  worstActionMultiplier: number;
  /** Print discount % the buyer's plan grants (clamped at break-even at checkout). */
  printDiscountPct: number;
  /** Member ebook price per currency (absent ⇒ the sticker price applies). */
  ebookPlanPrices: Record<string, number>;
}

/** A buyer with no plan perks — the baseline every builder defaults to. */
export const NEUTRAL_BUYER: BuyerContext = {
  planId: null,
  planName: "Any buyer",
  isFree: true,
  worstActionMultiplier: 1,
  printDiscountPct: 0,
  ebookPlanPrices: {},
};

/** Plan fields the engine needs (satisfied by mapping either plan shape). */
export interface BuyerPlanInput {
  id: string;
  name: string;
  isFree: boolean;
  actionMultipliers: Record<string, number> | undefined;
  printDiscountPct: number;
}

export function buyerContextFromPlan(
  plan: BuyerPlanInput,
  settings: PricingSettings,
): BuyerContext {
  return {
    planId: plan.id,
    planName: plan.name,
    isFree: plan.isFree,
    worstActionMultiplier: worstActionMultiplier(plan.actionMultipliers),
    printDiscountPct: Math.max(0, Math.min(100, plan.printDiscountPct)),
    // Member ebook prices only ever apply to PAID plans (checkout ignores
    // overrides for the free plan), so mirror that here.
    ebookPlanPrices: plan.isFree ? {} : (settings.ebook.planPrices[plan.id] ?? {}),
  };
}

/**
 * The buyer contexts of all ACTIVE public plans. Anonymous / signed-out users
 * fall back to the free plan (including its action multipliers), so the free
 * plan covers them; a neutral context is added only if no free plan exists.
 */
export function buyerContextsFromPublicPlans(
  plans: PublicPlan[],
  settings: PricingSettings,
): BuyerContext[] {
  const contexts = plans
    .filter((p) => p.status === "active")
    .map((p) =>
      buyerContextFromPlan(
        {
          id: p.id,
          name: p.name,
          isFree: p.isFree,
          actionMultipliers: p.actionMultipliers,
          printDiscountPct: p.entitlements?.printDiscountPct ?? 0,
        },
        settings,
      ),
    );
  if (!contexts.some((c) => c.isFree)) contexts.unshift(NEUTRAL_BUYER);
  return contexts;
}

/** Buyers allowed to purchase a product with this access policy. */
export function eligibleBuyers(
  access: ProductAccess | undefined,
  buyers: BuyerContext[],
): BuyerContext[] {
  return buyers.filter((b) =>
    planMeetsAccess(access, { planId: b.planId, isSubscribed: !b.isFree }),
  );
}

// ---- Waterfall types ------------------------------------------------------------

/** The full money waterfall for one item at one discount level. */
export interface DiscountWaterfall {
  discountPct: number;
  /** Sticker after the discount (same tax semantics as the list price). */
  discountedPrice: number;
  /** Ex-tax revenue from the item price (excludes shipping). */
  netRevenue: number;
  /** Shipping the customer pays (ex tax; print only — not discounted). */
  shippingCharged: number;
  taxAmount: number;
  /** The amount the processor handles: goods + shipping + tax. */
  grossCustomerPays: number;
  paymentFee: number;
  /** What the sale costs you (production + shipping / Spark backing / ~0). */
  directCost: number;
  netProfit: number;
  /** netProfit as a % of the revenue you keep (goods + shipping charged). */
  marginPct: number;
}

/** One buyer's outcome, for the per-plan breakdown tables. */
export interface BuyerOutcome {
  planId: string | null;
  label: string;
  /** What this buyer actually pays at list (after their plan perks). */
  effectivePrice: number;
  netProfit: number;
  marginPct: number;
  safeMaxDiscountPct: number;
  breakEvenDiscountPct: number;
}

/** One sellable item's discount economics in one currency, for one buyer. */
export interface DiscountImpact {
  itemType: DiscountItemType;
  itemId: string;
  itemLabel: string;
  currency: CurrencyCode;
  /** The buyer these numbers assume (null planId = no plan perks). */
  buyerPlanId: string | null;
  /** e.g. "Any buyer" or "Dream Weaver member + print owner". */
  buyerLabel: string;
  /** What this buyer pays at 0% promo (sticker minus their plan perks). */
  listPrice: number;
  /** What selling one unit costs you, discount-independent (in `currency`). */
  directCost: number;
  /** Plain-language description of what `directCost` covers. */
  costLabel: string;
  /** Discount on the price that drives net profit to exactly 0. */
  breakEvenDiscountPct: number;
  /** Deepest discount that keeps margin ≥ the configured floor. */
  safeMaxDiscountPct: number;
  /** The floor used for `safeMaxDiscountPct` (from settings). */
  minMarginPct: number;
  /** True when the item already loses money at full price for this buyer. */
  underwaterAtList: boolean;
  /** True when the cost is a static estimate (no live provider quote). */
  costIsEstimate: boolean;
  /** Assumptions/caveats the admin should know when reading the numbers. */
  notes: string[];
  /** Outcome per buyer context (filled by the worst-case helpers). */
  perBuyer?: BuyerOutcome[];
  /** The waterfall at an arbitrary discount (pure; call freely from sliders). */
  atDiscount: (discountPct: number) => DiscountWaterfall;
}

// ---- Shared solver -----------------------------------------------------------

interface ImpactInputs {
  itemType: DiscountItemType;
  itemId: string;
  itemLabel: string;
  currency: CurrencyCode;
  buyer: BuyerContext;
  buyerLabel?: string;
  listPrice: number;
  taxBehavior: TaxBehavior;
  taxRatePct: number;
  /** Effective processor fee fraction (percent + extra, as 0–1). */
  feeFraction: number;
  feeFixed: number;
  /** Cost that doesn't scale with the price, excluding shipping (in `currency`). */
  directCost: number;
  shippingCharged?: number;
  shippingCost?: number;
  minMarginPct: number;
  costLabel: string;
  costIsEstimate: boolean;
  notes: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build a {@link DiscountImpact} from normalized inputs. All the math mirrors
 * `computeMargin` exactly (same fee-on-gross and tax handling), so the print
 * numbers here agree with the product editor's margin read-out.
 */
function buildImpact(i: ImpactInputs): DiscountImpact {
  const rate = Math.max(0, i.taxRatePct) / 100;
  const shippingCharged = i.shippingCharged ?? 0;
  const shippingCost = i.shippingCost ?? 0;
  const totalCost = i.directCost + shippingCost;
  // Ex-tax revenue at list price (inclusive stickers contain the tax).
  const netList = i.taxBehavior === "inclusive" ? i.listPrice / (1 + rate) : i.listPrice;
  // The processor fee applies to the gross = (net + shipping)·(1 + rate).
  const effFp = (1 + rate) * i.feeFraction;

  const atDiscount = (discountPct: number): DiscountWaterfall => {
    const d = clamp(discountPct, 0, 100) / 100;
    const net = netList * (1 - d);
    const base = net + shippingCharged; // the revenue you keep
    const taxAmount = base * rate;
    const gross = base + taxAmount;
    const paymentFee = gross * i.feeFraction + i.feeFixed;
    const netProfit = base - totalCost - paymentFee;
    return {
      discountPct: clamp(discountPct, 0, 100),
      discountedPrice: round2(i.listPrice * (1 - d)),
      netRevenue: round2(net),
      shippingCharged: round2(shippingCharged),
      taxAmount: round2(taxAmount),
      grossCustomerPays: round2(gross),
      paymentFee: round2(paymentFee),
      directCost: round2(totalCost),
      netProfit: round2(netProfit),
      marginPct: base > 0 ? round1((netProfit / base) * 100) : 0,
    };
  };

  // Largest discount d with netProfit(d) ≥ floor · base(d):
  //   base(d) · (1 − effFp − floor) ≥ directCost + shippingCost + fixedFee
  const maxDiscountKeeping = (floorFraction: number): number => {
    if (netList <= 0) return 0;
    const denom = 1 - effFp - floorFraction;
    if (denom <= 0) return 0; // fees + floor eat all revenue — nothing is safe
    const requiredBase = (totalCost + i.feeFixed) / denom;
    const d = (1 - (requiredBase - shippingCharged) / netList) * 100;
    return round1(clamp(d, 0, 100));
  };

  const breakEvenDiscountPct = maxDiscountKeeping(0);
  const safeMaxDiscountPct = Math.min(
    maxDiscountKeeping(Math.max(0, i.minMarginPct) / 100),
    breakEvenDiscountPct,
  );

  return {
    itemType: i.itemType,
    itemId: i.itemId,
    itemLabel: i.itemLabel,
    currency: i.currency,
    buyerPlanId: i.buyer.planId,
    buyerLabel: i.buyerLabel ?? i.buyer.planName,
    listPrice: round2(i.listPrice),
    directCost: round2(totalCost),
    costLabel: i.costLabel,
    breakEvenDiscountPct,
    safeMaxDiscountPct,
    minMarginPct: i.minMarginPct,
    underwaterAtList: atDiscount(0).netProfit < 0,
    costIsEstimate: i.costIsEstimate,
    notes: i.notes,
    atDiscount,
  };
}

/** Reduce a built impact to a {@link BuyerOutcome} row. */
function toOutcome(impact: DiscountImpact): BuyerOutcome {
  const wf = impact.atDiscount(0);
  return {
    planId: impact.buyerPlanId,
    label: impact.buyerLabel,
    effectivePrice: impact.listPrice,
    netProfit: wf.netProfit,
    marginPct: wf.marginPct,
    safeMaxDiscountPct: impact.safeMaxDiscountPct,
    breakEvenDiscountPct: impact.breakEvenDiscountPct,
  };
}

/** The most protective impact: lowest safe max, ties broken by lowest profit. */
function pickWorst(impacts: DiscountImpact[]): DiscountImpact | null {
  let worst: DiscountImpact | null = null;
  for (const impact of impacts) {
    if (
      !worst ||
      impact.safeMaxDiscountPct < worst.safeMaxDiscountPct ||
      (impact.safeMaxDiscountPct === worst.safeMaxDiscountPct &&
        impact.atDiscount(0).netProfit < worst.atDiscount(0).netProfit)
    ) {
      worst = impact;
    }
  }
  if (worst && impacts.length > 1) {
    worst = { ...worst, perBuyer: impacts.map(toOutcome) };
  }
  return worst;
}

// ---- Spark cost helper ---------------------------------------------------------

/**
 * What `sparks` Sparks cost you in provider fees if spent on derived actions,
 * at the configured assumed spend rate, converted into `currency` (the peg is
 * denominated in the base currency). `actionMultiplier` < 1 means the buyer's
 * plan discounts action prices — each Spark then buys 1/multiplier as much
 * provider work, so the backing cost rises accordingly.
 */
function sparkBackingCost(
  sparksConfig: SparksConfig,
  settings: PricingSettings,
  currency: CurrencyCode,
  sparks: number,
  actionMultiplier = 1,
): number {
  const unit = sparkUnitEconomics(sparksConfig);
  const utilization = clamp(settings.sparkUtilizationPct, 1, 100) / 100;
  const m = actionMultiplier > 0 ? Math.min(actionMultiplier, 1) : 1;
  const inBase = (sparks * utilization * unit.providerUsdPerSpark) / m;
  return convertCostAmount(settings, inBase, settings.baseCurrency, currency);
}

function sparkCostLabel(
  settings: PricingSettings,
  sparks: number,
  actionMultiplier = 1,
): string {
  const pct = clamp(settings.sparkUtilizationPct, 1, 100);
  const spend =
    pct >= 100
      ? `all ${sparks.toLocaleString()} ✦ are spent (worst case)`
      : `${pct}% of ${sparks.toLocaleString()} ✦ are spent`;
  const mult = actionMultiplier < 1 ? `, at a ${actionMultiplier}× Spark discount` : "";
  return `Provider cost if ${spend}${mult}`;
}

function sparkNotes(settings: PricingSettings, buyer: BuyerContext): string[] {
  const pct = clamp(settings.sparkUtilizationPct, 1, 100);
  const notes: string[] = [];
  if (pct >= 100) {
    notes.push(
      "Assumes every Spark is spent on cost-derived actions — the worst case; real usage is lower.",
    );
  } else {
    notes.push(
      `Assumes ${pct}% of Sparks are spent (Financial settings → assumed Spark spend rate). At 100% spend the cost is ${Math.round(10000 / pct) / 100}× higher.`,
    );
  }
  if (buyer.worstActionMultiplier < 1) {
    notes.push(
      `${buyer.planName}'s ${buyer.worstActionMultiplier}× Spark discount means each Spark buys ${round2(1 / buyer.worstActionMultiplier)}× the provider work — Sparks are fungible, so this applies to purchased Sparks too.`,
    );
  }
  return notes;
}

// ---- Per-item builders --------------------------------------------------------

function taxPolicyFor(settings: PricingSettings, currency: CurrencyCode) {
  return settings.tax.perCurrency[currency] ?? { behavior: "exclusive" as const, assumedRatePct: 0 };
}

/** A plan print discount already applied to the buyer's price. */
export interface AppliedPlanDiscount {
  /** The discount actually applied (advertised %, clamped to break-even). */
  appliedPct: number;
  advertisedPct: number;
  planName: string;
}

/**
 * Print-book impact from an already computed {@link MarginBreakdown} (so the
 * product editor can reuse its live-quote breakdown). Totals cover the whole
 * scenario (all copies). When `planDiscount` is set, the buyer's plan print
 * discount (clamped to break-even, exactly like checkout) is baked into the
 * list price — the promo slider then stacks on top of it, again like checkout.
 */
export function printImpactFromBreakdown(
  item: { id: string; label: string },
  m: MarginBreakdown,
  settings: PricingSettings,
  costIsEstimate: boolean,
  buyer: BuyerContext = NEUTRAL_BUYER,
): DiscountImpact {
  const fee = feeFor(settings, m.currency);
  const advertised = buyer.printDiscountPct;
  const applied = Math.min(advertised, m.breakEvenDiscountPct);
  const sticker = m.pricePerUnit * m.copies;
  const listPrice = sticker * (1 - Math.max(0, applied) / 100);

  const notes = [
    "Shipping is charged as configured and is not discounted — only the book price is.",
  ];
  if (applied > 0) {
    notes.push(
      applied < advertised
        ? `Includes ${buyer.planName}'s print discount, clamped from ${advertised}% to the ${round1(applied)}% break-even (checkout does the same) — members see less than advertised.`
        : `Includes ${buyer.planName}'s ${advertised}% print discount; a promo would stack on top of it.`,
    );
  }
  if (costIsEstimate) {
    notes.push("Production cost is the static estimate — fetch a live provider quote for exact numbers.");
  }
  return buildImpact({
    itemType: "print",
    itemId: item.id,
    itemLabel: item.label,
    currency: m.currency,
    buyer,
    buyerLabel: applied > 0 ? `${buyer.planName} member` : buyer.planName,
    listPrice,
    taxBehavior: m.taxBehavior,
    taxRatePct: m.taxRatePct,
    feeFraction: feePercent(fee),
    feeFixed: fee.fixed,
    directCost: m.productionCost,
    shippingCharged: m.shippingCharged,
    shippingCost: m.shippingCost,
    minMarginPct: settings.minMarginPct,
    costLabel: "Production + shipping you pay",
    costIsEstimate,
    notes,
  });
}

/** Print-book impact for a scenario (computes the margin breakdown itself). */
export function printDiscountImpact(
  product: ProductDefinition,
  scenario: PriceScenario,
  settings: PricingSettings,
  buyer: BuyerContext = NEUTRAL_BUYER,
): DiscountImpact {
  const m = computeMargin(product, scenario, settings);
  const costIsEstimate =
    product.cost.source === "providerLive" && typeof scenario.liveUnitCost !== "number";
  return printImpactFromBreakdown(
    { id: product.id, label: product.presentation.name },
    m,
    settings,
    costIsEstimate,
    buyer,
  );
}

/** Worst-case print impact across the buyers allowed to purchase the product. */
export function printWorstCaseImpact(
  product: ProductDefinition,
  scenario: PriceScenario,
  settings: PricingSettings,
  buyers: BuyerContext[],
): DiscountImpact | null {
  const eligible = eligibleBuyers(product.conditions.access, buyers);
  if (eligible.length === 0) return null; // nobody can buy it (flagged by config health)
  return pickWorst(eligible.map((b) => printDiscountImpact(product, scenario, settings, b)));
}

/**
 * Digital-edition impact in a currency for one buyer, or null when there's no
 * PAID sale for them (no sticker price, or the plan includes the ebook free —
 * an included ebook is a plan perk, not a sale). Member prices below the
 * sticker replace it; when `printOwner` is true the automatic print-bundle
 * discount is stacked on top, exactly like checkout does.
 */
export function ebookDiscountImpact(
  settings: PricingSettings,
  currency: CurrencyCode,
  buyer: BuyerContext = NEUTRAL_BUYER,
  opts: { printOwner?: boolean } = {},
): DiscountImpact | null {
  const sticker = settings.ebook.prices[currency];
  if (typeof sticker !== "number" || sticker <= 0) return null;

  const memberPrice = buyer.ebookPlanPrices[currency];
  const planApplied = typeof memberPrice === "number" && memberPrice >= 0 && memberPrice < sticker;
  if (planApplied && memberPrice <= 0) return null; // included free with the plan
  let effective = planApplied ? memberPrice : sticker;

  const notes: string[] = [
    "The fixed processor fee doesn't shrink with the price — it dominates at deep discounts.",
  ];
  const labelParts: string[] = [];
  if (planApplied) {
    labelParts.push(`${buyer.planName} member`);
    notes.push(`Member price for ${buyer.planName} (sticker ${sticker.toFixed(2)} ${currency}).`);
  }
  const bundle = clamp(settings.ebook.printBundleDiscountPct, 0, 100);
  if (opts.printOwner && bundle > 0) {
    effective = effective * (1 - bundle / 100);
    labelParts.push("print owner");
    notes.push(
      `Includes the automatic ${bundle}% print-bundle discount, which stacks on the ${planApplied ? "member" : "sticker"} price at checkout.`,
    );
  }
  if (effective <= 0) return null;

  const taxPol = taxPolicyFor(settings, currency);
  const fee = feeFor(settings, currency);
  return buildImpact({
    itemType: "ebook",
    itemId: "ebook",
    itemLabel: "Digital edition",
    currency,
    buyer,
    buyerLabel: labelParts.length > 0 ? labelParts.join(" + ") : buyer.planName,
    listPrice: effective,
    taxBehavior: taxPol.behavior,
    taxRatePct: taxPol.assumedRatePct,
    feeFraction: feePercent(fee),
    feeFixed: fee.fixed,
    directCost: 0,
    minMarginPct: settings.minMarginPct,
    costLabel: "No marginal cost (download)",
    costIsEstimate: false,
    notes,
  });
}

/**
 * Worst-case ebook impact: the cheapest PAID price any buyer can reach —
 * lowest member price (or sticker), with the print-bundle discount stacked on
 * top when one is configured.
 */
export function ebookWorstCaseImpact(
  settings: PricingSettings,
  currency: CurrencyCode,
  buyers: BuyerContext[],
): DiscountImpact | null {
  const withBundle = settings.ebook.printBundleDiscountPct > 0;
  const contexts = buyers.length > 0 ? buyers : [NEUTRAL_BUYER];
  const impacts: DiscountImpact[] = [];
  for (const buyer of contexts) {
    const plain = ebookDiscountImpact(settings, currency, buyer);
    if (plain) impacts.push(plain);
    if (withBundle) {
      const stacked = ebookDiscountImpact(settings, currency, buyer, { printOwner: true });
      if (stacked) impacts.push(stacked);
    }
  }
  return pickWorst(impacts);
}

/** Spark-pack impact in a currency for one buyer, or null when unpriced there. */
export function packDiscountImpact(
  sparksConfig: SparksConfig,
  pack: SparkPack,
  settings: PricingSettings,
  currency: CurrencyCode,
  buyer: BuyerContext = NEUTRAL_BUYER,
): DiscountImpact | null {
  const price = pack.prices[currency];
  const totalSparks = packTotalSparks(pack);
  if (typeof price !== "number" || price <= 0 || totalSparks <= 0) return null;
  const taxPol = taxPolicyFor(settings, currency);
  const fee = feeFor(settings, currency);
  const m = buyer.worstActionMultiplier;
  return buildImpact({
    itemType: "pack",
    itemId: pack.id,
    itemLabel: `${pack.label} (${totalSparks.toLocaleString()} ✦)`,
    currency,
    buyer,
    buyerLabel: m < 1 ? `${buyer.planName} member` : buyer.planName,
    listPrice: price,
    taxBehavior: taxPol.behavior,
    taxRatePct: taxPol.assumedRatePct,
    feeFraction: feePercent(fee),
    feeFixed: fee.fixed,
    directCost: sparkBackingCost(sparksConfig, settings, currency, totalSparks, m),
    minMarginPct: settings.minMarginPct,
    costLabel: sparkCostLabel(settings, totalSparks, m),
    costIsEstimate: false,
    notes: sparkNotes(settings, buyer),
  });
}

/**
 * Worst-case pack impact: anyone can buy a pack, and its Sparks are spent at
 * the buyer's own action multipliers — so the worst buyer is whichever active
 * plan has the deepest Spark discount.
 */
export function packWorstCaseImpact(
  sparksConfig: SparksConfig,
  pack: SparkPack,
  settings: PricingSettings,
  currency: CurrencyCode,
  buyers: BuyerContext[],
): DiscountImpact | null {
  const contexts = buyers.length > 0 ? buyers : [NEUTRAL_BUYER];
  const impacts = contexts
    .map((b) => packDiscountImpact(sparksConfig, pack, settings, currency, b))
    .filter((x): x is DiscountImpact => x != null);
  return pickWorst(impacts);
}

/** Everything needed to cost one plan price point (works for admin + public plans). */
export interface PlanImpactInput {
  id: string;
  name: string;
  interval: "month" | "year";
  /** Invoice amount in `currency` for this interval. */
  price: number;
  /** Sparks granted per such invoice (annual: 12 × monthly + the bonus). */
  sparksGranted: number;
  /** The plan's own lowest action multiplier (its Spark discounts inflate the grant's cost). */
  worstActionMultiplier?: number;
  /** Billing tax behavior; defaults to the currency's catalog policy. */
  taxBehavior?: TaxBehavior;
}

/**
 * Membership impact for one (interval, currency) price point, or null when the
 * price is unset. The direct cost is the Spark grant's provider backing at the
 * plan's OWN action multipliers; the print-discount subsidy and any included
 * ebook are NOT included (see notes).
 */
export function planDiscountImpact(
  input: PlanImpactInput,
  sparksConfig: SparksConfig,
  settings: PricingSettings,
  currency: CurrencyCode,
): DiscountImpact | null {
  if (input.price <= 0) return null;
  const taxPol = taxPolicyFor(settings, currency);
  const fee = feeFor(settings, currency);
  const intervalLabel = input.interval === "month" ? "monthly" : "annual";
  const m = input.worstActionMultiplier ?? 1;
  const selfBuyer: BuyerContext = {
    ...NEUTRAL_BUYER,
    planId: input.id,
    planName: input.name,
    isFree: false,
    worstActionMultiplier: m,
  };
  return buildImpact({
    itemType: "plan",
    itemId: `${input.id}:${input.interval}`,
    itemLabel: `${input.name} (${intervalLabel})`,
    currency,
    buyer: selfBuyer,
    buyerLabel: `${input.name} subscriber`,
    listPrice: input.price,
    taxBehavior: input.taxBehavior ?? taxPol.behavior,
    taxRatePct: taxPol.assumedRatePct,
    feeFraction: feePercent(fee),
    feeFixed: fee.fixed,
    directCost: sparkBackingCost(sparksConfig, settings, currency, input.sparksGranted, m),
    minMarginPct: settings.minMarginPct,
    costLabel: sparkCostLabel(settings, input.sparksGranted, m),
    costIsEstimate: false,
    notes: [
      ...sparkNotes(settings, selfBuyer),
      "Excludes the plan's print-discount subsidy and any included ebook — real headroom is lower.",
      "A promo discounts the invoice; the Spark grant (and its cost) stays the same.",
    ],
  });
}

// ---- Ebook viability floor -------------------------------------------------------

/**
 * The smallest sticker price at which one ebook sale doesn't lose money (the
 * fixed processor fee is covered) in a currency. Checkout uses this to clamp
 * the AUTOMATIC print-bundle discount so stacking can never create an
 * out-of-pocket loss (explicitly configured member prices are still honored —
 * they're admin intent, and config health flags them instead).
 */
export function minViableEbookPrice(
  settings: PricingSettings,
  currency: CurrencyCode,
): number {
  const taxPol = taxPolicyFor(settings, currency);
  const rate = Math.max(0, taxPol.assumedRatePct) / 100;
  const fee = feeFor(settings, currency);
  const denom = 1 - (1 + rate) * feePercent(fee);
  if (denom <= 0) return Number.POSITIVE_INFINITY;
  const baseMin = fee.fixed / denom; // ex-tax revenue that exactly covers the fee
  const price = taxPol.behavior === "inclusive" ? baseMin * (1 + rate) : baseMin;
  return Math.ceil(price * 100) / 100; // round UP so the floor never loses a cent
}

// ---- Whole-catalog enumeration --------------------------------------------------

export interface CatalogDiscountArgs {
  settings: PricingSettings;
  sparks: SparksConfig;
  /** Full admin product definitions (incl. cost models). Empty ⇒ no print rows. */
  products: ProductDefinition[];
  /** Public plans are enough — they carry prices, grants and multipliers. */
  plans: PublicPlan[];
  currency: CurrencyCode;
  /**
   * Whose perspective to price print/ebook/pack rows from:
   *   - "worst" (default): each item's most expensive eligible buyer, with a
   *     per-buyer breakdown attached.
   *   - a specific {@link BuyerContext}: that buyer only (items they can't
   *     buy are skipped).
   * Plan rows always use the plan's own context.
   */
  buyer?: "worst" | BuyerContext;
}

/**
 * One {@link DiscountImpact} per active sellable item in a currency — the
 * input for the discount planner and the business-overview sale-headroom card.
 * Print books are evaluated at their display page count, 1 copy, using the
 * static cost table (fetch live quotes in the product editor for exact costs).
 */
export function catalogDiscountImpacts(args: CatalogDiscountArgs): DiscountImpact[] {
  const { settings, sparks, products, plans, currency } = args;
  const mode = args.buyer ?? "worst";
  const allBuyers = buyerContextsFromPublicPlans(plans, settings);
  const out: DiscountImpact[] = [];

  for (const product of products) {
    if (product.status !== "active") continue;
    const pages = product.pricing.displayPages ?? product.conditions.pages.min;
    const scenario = { currency, pages, copies: 1 };
    try {
      if (mode === "worst") {
        const impact = printWorstCaseImpact(product, scenario, settings, allBuyers);
        if (impact) out.push(impact);
      } else if (eligibleBuyers(product.conditions.access, [mode]).length > 0) {
        out.push(printDiscountImpact(product, scenario, settings, mode));
      }
    } catch {
      // A malformed product must not break the whole planner.
    }
  }

  if (settings.ebook.enabled) {
    const impact =
      mode === "worst"
        ? ebookWorstCaseImpact(settings, currency, allBuyers)
        : ebookDiscountImpact(settings, currency, mode);
    if (impact) out.push(impact);
  }

  if (sparks.enabled) {
    for (const pack of sparks.packs) {
      if (!pack.active) continue;
      const impact =
        mode === "worst"
          ? packWorstCaseImpact(sparks, pack, settings, currency, allBuyers)
          : packDiscountImpact(sparks, pack, settings, currency, mode);
      if (impact) out.push(impact);
    }
  }

  for (const plan of plans) {
    if (plan.status !== "active" || plan.isFree) continue;
    const byInterval = plan.prices[currency];
    const monthly = byInterval?.month?.amount ?? 0;
    const yearly = byInterval?.year?.amount ?? 0;
    const monthlySparks = plan.grant?.monthlySparks ?? 0;
    const annualBonus = plan.grant?.annualBonusSparks ?? 0;
    const worstM = worstActionMultiplier(plan.actionMultipliers);
    if (monthly > 0) {
      const impact = planDiscountImpact(
        {
          id: plan.id,
          name: plan.name,
          interval: "month",
          price: monthly,
          sparksGranted: monthlySparks,
          worstActionMultiplier: worstM,
        },
        sparks,
        settings,
        currency,
      );
      if (impact) out.push(impact);
    }
    if (yearly > 0) {
      const impact = planDiscountImpact(
        {
          id: plan.id,
          name: plan.name,
          interval: "year",
          price: yearly,
          sparksGranted: monthlySparks * 12 + annualBonus,
          worstActionMultiplier: worstM,
        },
        sparks,
        settings,
        currency,
      );
      if (impact) out.push(impact);
    }
  }

  return out;
}

/**
 * The storewide safe ceiling: the largest discount every item can absorb while
 * holding the margin floor — plus the item that limits it. Null when empty.
 */
export function storewideSafeDiscount(
  impacts: DiscountImpact[],
): { pct: number; limitedBy: DiscountImpact } | null {
  if (impacts.length === 0) return null;
  let limiting = impacts[0];
  for (const impact of impacts) {
    if (impact.safeMaxDiscountPct < limiting.safeMaxDiscountPct) limiting = impact;
  }
  return { pct: limiting.safeMaxDiscountPct, limitedBy: limiting };
}
