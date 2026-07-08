/**
 * Business-economics helpers for the admin configuration screens.
 *
 * Pure functions that translate raw config knobs (peg, markup, grants, pack
 * prices, plan multipliers, print discounts) into the numbers an operator
 * actually cares about: what a Spark costs ME, what it earns, whether a pack
 * or plan sells below cost, and how big the liability of a grant is.
 *
 * Everything here is advisory (rendered as helper tables/warnings next to the
 * config editors) — enforcement stays where it already lives (e.g. print
 * discounts are clamped to break-even at checkout).
 */
import type { SparkPack, SparksConfig } from "./sparks";
import { packTotalSparks } from "./sparks";

// ---- Spark unit economics ----------------------------------------------------

export interface SparkUnitEconomics {
  /** What the USER pays for one Spark at the peg (USD). */
  sparkValueUsd: number;
  /** Provider cost one Spark covers: peg ÷ markup (USD). */
  providerUsdPerSpark: number;
  /** Gross margin on derived pricing: 1 − 1/markup (as a %). */
  grossMarginPct: number;
}

export function sparkUnitEconomics(config: SparksConfig): SparkUnitEconomics {
  const markup = config.markupMultiplier > 0 ? config.markupMultiplier : 1;
  return {
    sparkValueUsd: config.sparkValueUsd,
    providerUsdPerSpark: config.sparkValueUsd / markup,
    grossMarginPct: Math.round((1 - 1 / markup) * 1000) / 10,
  };
}

/**
 * The worst-case provider cost of a Spark grant (USD): if every granted Spark
 * is spent on derived-priced actions, this is what the AI providers charge you.
 * Real cost is usually lower (breakage: not everyone spends everything).
 */
export function grantLiabilityUsd(config: SparksConfig, sparks: number): number {
  return round2(sparks * sparkUnitEconomics(config).providerUsdPerSpark);
}

// ---- Pack economics ----------------------------------------------------------

export interface PackEconomics {
  totalSparks: number;
  price: number;
  /** What the buyer pays per Spark. */
  pricePerSpark: number;
  /** Buyer's price per Spark relative to the peg (1 = exactly peg). */
  pegRatio: number;
  /** Worst-case provider cost if the whole pack is spent (USD). */
  worstCaseCostUsd: number;
  /** Margin after worst-case spend, as a % of the pack price. */
  worstCaseMarginPct: number;
  /** True when the pack sells Sparks below their provider backing — a loss. */
  belowCost: boolean;
}

/**
 * Economics of one top-up pack in a currency. `price` is treated as USD-like
 * for the margin math (packs are usually priced near-parity across currencies;
 * this is an advisory helper, not accounting).
 */
export function packEconomics(
  config: SparksConfig,
  pack: SparkPack,
  currency: string,
): PackEconomics | null {
  const price = pack.prices[currency];
  const total = packTotalSparks(pack);
  if (typeof price !== "number" || price <= 0 || total <= 0) return null;
  const unit = sparkUnitEconomics(config);
  const pricePerSpark = price / total;
  const worstCaseCostUsd = round2(total * unit.providerUsdPerSpark);
  return {
    totalSparks: total,
    price,
    pricePerSpark: Math.round(pricePerSpark * 10000) / 10000,
    pegRatio: unit.sparkValueUsd > 0 ? Math.round((pricePerSpark / unit.sparkValueUsd) * 100) / 100 : 0,
    worstCaseCostUsd,
    worstCaseMarginPct: price > 0 ? Math.round(((price - worstCaseCostUsd) / price) * 1000) / 10 : 0,
    belowCost: pricePerSpark < unit.providerUsdPerSpark,
  };
}

// ---- Plan economics ----------------------------------------------------------

export interface PlanSparkEconomics {
  monthlyPrice: number;
  monthlySparks: number;
  /** Worst-case provider cost of the monthly grant (USD). */
  monthlyLiabilityUsd: number;
  /** Liability as a % of the monthly price — the key sustainability number. */
  liabilityPctOfPrice: number;
  /** What's left of the monthly price after worst-case Spark spend. */
  monthlyHeadroomUsd: number;
  /** Effective price per granted Spark vs buying the same via packs at peg. */
  effectivePricePerSpark: number;
}

/**
 * What a plan's monthly Spark grant means for the business, at a given monthly
 * price. Rule of thumb: keep `liabilityPctOfPrice` under ~50% so the plan
 * still funds Stripe fees, print-discount subsidies and profit even if the
 * subscriber spends every Spark.
 */
export function planSparkEconomics(
  config: SparksConfig,
  monthlyPrice: number,
  monthlySparks: number,
): PlanSparkEconomics {
  const liability = grantLiabilityUsd(config, monthlySparks);
  return {
    monthlyPrice,
    monthlySparks,
    monthlyLiabilityUsd: liability,
    liabilityPctOfPrice: monthlyPrice > 0 ? Math.round((liability / monthlyPrice) * 1000) / 10 : 0,
    monthlyHeadroomUsd: round2(monthlyPrice - liability),
    effectivePricePerSpark:
      monthlySparks > 0 ? Math.round((monthlyPrice / monthlySparks) * 10000) / 10000 : 0,
  };
}

/**
 * The effective markup an action carries for a subscriber with a per-action
 * multiplier: base markup × multiplier. Below 1 the action is sold under
 * provider cost (every render loses money); between 1 and ~1.3 it barely
 * covers payment/infra overhead.
 */
export function effectiveMarkup(config: SparksConfig, multiplier: number): number {
  const m = multiplier > 0 ? multiplier : 1;
  return Math.round(config.markupMultiplier * m * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
