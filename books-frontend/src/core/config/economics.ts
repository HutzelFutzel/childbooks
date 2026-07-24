/**
 * Business-economics helpers for the admin configuration screens.
 *
 * Pure functions that translate raw config knobs (peg, markup, grants, plan
 * multipliers) into the numbers an operator actually cares about: what a Spark
 * costs ME, what it earns, and how big the liability of a grant is.
 *
 * Fee/tax-aware sale planning (per-item break-even and safe max discounts for
 * print, ebook, packs and plans) lives in `discountImpact.ts` — that engine is
 * the single source of truth for "can I run this discount?".
 *
 * Everything here is advisory (rendered as helper tables/warnings next to the
 * config editors) — enforcement stays where it already lives (e.g. print
 * discounts are clamped to break-even at checkout).
 */
import type { SparksConfig } from "./sparks";

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
 *
 * `actionMultiplier` is the buyer's per-action Spark discount (e.g. 0.5 =
 * half-price renders). A discounted Spark buys MORE provider work — each Spark
 * covers `providerUsdPerSpark ÷ multiplier` of cost — so generous multipliers
 * INCREASE the liability. Multipliers above 1 are not credited (conservative).
 */
export function grantLiabilityUsd(
  config: SparksConfig,
  sparks: number,
  actionMultiplier = 1,
): number {
  const m = actionMultiplier > 0 ? Math.min(actionMultiplier, 1) : 1;
  return round2((sparks * sparkUnitEconomics(config).providerUsdPerSpark) / m);
}

/**
 * The most generous (lowest) Spark action multiplier in a plan's map — the one
 * that determines the worst-case value of a Spark in that buyer's hands.
 * 1 when the plan has no discounts; multipliers above 1 are ignored.
 */
export function worstActionMultiplier(
  multipliers: Record<string, number> | undefined,
): number {
  const values = Object.values(multipliers ?? {}).filter(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
  return Math.min(1, ...values);
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
 * subscriber spends every Spark. Pass the plan's worst (lowest) action
 * multiplier so its own Spark discounts inflate the liability correctly.
 */
export function planSparkEconomics(
  config: SparksConfig,
  monthlyPrice: number,
  monthlySparks: number,
  actionMultiplier = 1,
): PlanSparkEconomics {
  const liability = grantLiabilityUsd(config, monthlySparks, actionMultiplier);
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
