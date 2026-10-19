/**
 * The one Spark price for one image unit, from the recent cost window.
 *
 * Shared by the server quote (`functions/src/sparks.ts`) and the studio preview
 * (`useTierEstimate`), so both show the same number, and that number is what the
 * wallet charges on success.
 *
 * A quote knows the model and render settings but not the whole outcome of the
 * render: the output size and how many image calls were billed are only known
 * afterwards. Those fields match anything when the quote leaves them "unknown",
 * so the window pools every render of the same setup and the statistic prices
 * the mix that actually happens. The number of reference images is planned
 * before the render (`core/billing/referencePlan`); a quote that names it
 * prices from renders that sent about as many.
 *
 * Under the `full` cost basis each sample is everything one delivered render
 * cost, retries and repairs included, so the statistic forwards that overhead
 * as an average: every reader pays the same quote, and the renders that needed
 * a retry are paid for by the window rather than by whoever hit them.
 *
 * When a group has too few samples the estimate borrows from a broader one:
 *   exact → the closest reference group → the setup with any reference count
 *   → same model+quality → another quality scaled by `qualityFactors`
 *   → the cost table's per-image rate → the action's configured fallback price.
 */
import type { ImageActionId } from "../ai/actions";
import type { GenerationEstimateProfile } from "../config/generationEstimateProfile";
import {
  parseCostStatsKey,
  profileKeyFields,
  sampleMatchesBasis,
  type CostKeyField,
  type CostSample,
  type ImageCostStats,
} from "../config/imageCostStats";
import type { ImageTier } from "../config/modelConfig";
import {
  estimationRuleFor,
  type CostBasis,
  type EstimateLevel,
  type EstimationConfig,
  type EstimationRule,
} from "../config/priceEstimation";
import type { SparksConfig } from "../config/sparks";

const DAY_MS = 86_400_000;

/** Fields a quote can't know before rendering; "unknown" in a query matches anything. */
export const OUTCOME_FIELDS: readonly CostKeyField[] = ["outputSize", "referenceCount", "billableImages"];

// ---- Statistics ----------------------------------------------------------------

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The configured statistic over values ordered oldest → newest. */
export function applyStatistic(values: number[], rule: EstimationRule): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  switch (rule.statistic) {
    case "median":
      return quantile(sorted, 0.5);
    case "percentile":
      return quantile(sorted, rule.percentile / 100);
    case "trimmedMean": {
      const cut = Math.floor(sorted.length * (rule.trimPercent / 100));
      const kept = sorted.length - 2 * cut > 0 ? sorted.slice(cut, sorted.length - cut) : sorted;
      return kept.reduce((s, v) => s + v, 0) / kept.length;
    }
    case "ema": {
      let acc = values[0];
      for (let i = 1; i < values.length; i++) acc = rule.emaAlpha * values[i] + (1 - rule.emaAlpha) * acc;
      return acc;
    }
    case "mean":
    default:
      return values.reduce((s, v) => s + v, 0) / values.length;
  }
}

// ---- Sample selection ----------------------------------------------------------

export interface WeightedSample extends CostSample {
  /** USD after rate and quality adjustment. */
  value: number;
}

/** Age limit, per-book cap and window, applied to samples ordered oldest → newest. */
export function selectSamples<S extends CostSample>(samples: S[], rule: EstimationRule, now: number): S[] {
  const fresh =
    rule.maxAgeDays > 0 ? samples.filter((s) => s.at === 0 || now - s.at <= rule.maxAgeDays * DAY_MS) : samples;
  let capped = fresh;
  if (rule.perProjectCap > 0) {
    const seen = new Map<string, number>();
    const keep: S[] = [];
    for (let i = fresh.length - 1; i >= 0; i--) {
      const s = fresh[i];
      const tag = s.project;
      if (tag) {
        const n = seen.get(tag) ?? 0;
        if (n >= rule.perProjectCap) continue;
        seen.set(tag, n + 1);
      }
      keep.push(s);
    }
    capped = keep.reverse();
  }
  return capped.slice(-rule.window);
}

function qualityFactor(config: EstimationConfig, quality: string): number {
  return config.qualityFactors[quality] ?? config.qualityFactors["provider-default"] ?? 1;
}

type Matcher = (fields: Record<CostKeyField, string>) => boolean;

function gather(
  stats: ImageCostStats,
  action: string,
  tier: string,
  basis: CostBasis,
  match: Matcher,
  scale: (fields: Record<CostKeyField, string>) => number,
  rateNow: number | null,
): WeightedSample[] {
  const out: WeightedSample[] = [];
  for (const [key, entry] of Object.entries(stats.stats)) {
    const parsed = parseCostStatsKey(key);
    if (!parsed || parsed.action !== action || parsed.tier !== tier || !match(parsed.fields)) continue;
    const factor = scale(parsed.fields);
    for (const s of entry.samples) {
      if (!sampleMatchesBasis(s, basis)) continue;
      const rateAdj = rateNow && s.rate ? rateNow / s.rate : 1;
      out.push({ ...s, value: s.usd * rateAdj * factor });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---- Estimate -------------------------------------------------------------------

export interface UnitEstimateInput {
  stats: ImageCostStats;
  sparks: SparksConfig;
  action: ImageActionId;
  tier: ImageTier;
  /** The render setup; outcome fields left "unknown" pool across all outcomes. */
  profile: GenerationEstimateProfile;
  /** The model's current per-image rate from the cost table (USD). */
  rateUsd: number | null;
  now?: number;
  /**
   * Cost on top of the render itself that this unit carries (the print-prep
   * surcharge), added before rounding so the price moves by its real size.
   */
  extraUsd?: number;
}

export interface UnitEstimate {
  /** Estimated provider cost of one unit, USD (before markup). */
  usd: number;
  level: EstimateLevel;
  /** Samples in the exact group after age/window/per-book filtering. */
  exactSamples: number;
  /** Samples behind the level that was used (0 for rate/fallback). */
  samples: number;
}

/**
 * Reference-count groups in order, as `countBucket` writes them. A quote that
 * knows its count prices from its own group, else from the closest one.
 */
export const REFERENCE_GROUPS = ["0", "1", "2", "3-4", "5+"] as const;

const MEASURED_LEVELS: readonly EstimateLevel[] = ["nearest", "pooled", "model", "scaled"];

/** Estimate one unit's provider cost from the window, with the fallback chain. */
export function estimateUnitCost(input: UnitEstimateInput): UnitEstimate {
  const { stats, sparks, action, tier, profile, rateUsd } = input;
  const now = input.now ?? Date.now();
  const config = sparks.estimation;
  const rule = estimationRuleFor(config, action);
  const q = profileKeyFields(profile);
  const same = (f: Record<CostKeyField, string>) => f.modelKey === q.modelKey && f.renderKind === q.renderKind;
  const rate = rateUsd && rateUsd > 0 ? rateUsd : null;
  /** This setup's samples, with the reference group replaced (or pooled when "unknown"). */
  const setup = (referenceCount: string) =>
    selectSamples(
      gather(
        stats,
        action,
        tier,
        config.costBasis,
        (f) =>
          same(f) &&
          (Object.keys(q) as CostKeyField[]).every((k) => {
            if (k === "billableImages") return true;
            const want = k === "referenceCount" ? referenceCount : q[k];
            return ((OUTCOME_FIELDS as readonly string[]).includes(k) && want === "unknown") || f[k] === want;
          }),
        () => 1,
        rate,
      ),
      rule,
      now,
    );

  const exact = setup(q.referenceCount);
  if (exact.length >= rule.minSamples) {
    return {
      usd: applyStatistic(exact.map((s) => s.value), rule),
      level: "exact",
      exactSamples: exact.length,
      samples: exact.length,
    };
  }

  const prior =
    (q.referenceCount !== "unknown" ? nearestGroup(q.referenceCount, setup, rule) : null) ??
    broaderEstimate(input, rule, q, same, rate, now, setup);
  if (exact.length > 0 && rule.blend) {
    const k = rule.minSamples;
    const n = exact.length;
    const own = applyStatistic(exact.map((s) => s.value), rule);
    return {
      usd: (n * own + k * prior.usd) / (n + k),
      level: "exact",
      exactSamples: n,
      samples: n,
    };
  }
  if (exact.length > 0 && !MEASURED_LEVELS.includes(prior.level)) {
    // No broader measured group: a few real samples beat a rate-table guess.
    return {
      usd: applyStatistic(exact.map((s) => s.value), rule),
      level: "exact",
      exactSamples: exact.length,
      samples: exact.length,
    };
  }
  return { ...prior, exactSamples: exact.length };
}

/**
 * The closest reference group with enough renders of this setup. Two groups
 * the same distance away are averaged: asked for 2 with only 1 and 3–4
 * measured, the price sits between them rather than on either side.
 */
function nearestGroup(
  group: string,
  setup: (referenceCount: string) => WeightedSample[],
  rule: EstimationRule,
): UnitEstimate | null {
  const at = (REFERENCE_GROUPS as readonly string[]).indexOf(group);
  if (at < 0) return null;
  for (let d = 1; d < REFERENCE_GROUPS.length; d++) {
    const found = [REFERENCE_GROUPS[at - d], REFERENCE_GROUPS[at + d]]
      .filter((g): g is (typeof REFERENCE_GROUPS)[number] => g !== undefined)
      .map((g) => setup(g))
      .filter((samples) => samples.length >= rule.minSamples);
    if (found.length === 0) continue;
    const values = found.map((samples) => applyStatistic(samples.map((s) => s.value), rule));
    return {
      usd: values.reduce((sum, v) => sum + v, 0) / values.length,
      level: "nearest",
      exactSamples: 0,
      samples: found.reduce((sum, samples) => sum + samples.length, 0),
    };
  }
  return null;
}

function broaderEstimate(
  input: UnitEstimateInput,
  rule: EstimationRule,
  q: Record<CostKeyField, string>,
  same: (f: Record<CostKeyField, string>) => boolean,
  rate: number | null,
  now: number,
  setup: (referenceCount: string) => WeightedSample[],
): UnitEstimate {
  const { stats, sparks, action, tier } = input;
  const config = sparks.estimation;

  if (q.referenceCount !== "unknown") {
    const pooled = setup("unknown");
    if (pooled.length >= rule.minSamples) {
      return { usd: applyStatistic(pooled.map((s) => s.value), rule), level: "pooled", exactSamples: 0, samples: pooled.length };
    }
  }

  const model = selectSamples(
    gather(stats, action, tier, config.costBasis, (f) => same(f) && f.quality === q.quality, () => 1, rate),
    rule,
    now,
  );
  if (model.length >= rule.minSamples) {
    return { usd: applyStatistic(model.map((s) => s.value), rule), level: "model", exactSamples: 0, samples: model.length };
  }

  const target = qualityFactor(config, q.quality);
  const scaled = selectSamples(
    gather(
      stats,
      action,
      tier,
      config.costBasis,
      (f) => same(f) && f.quality !== q.quality,
      (f) => target / qualityFactor(config, f.quality),
      rate,
    ),
    rule,
    now,
  );
  if (scaled.length >= rule.minSamples) {
    return {
      usd: applyStatistic(scaled.map((s) => s.value), rule),
      level: "scaled",
      exactSamples: 0,
      samples: scaled.length,
    };
  }

  if (rate) {
    const attempts = config.costBasis === "full" ? config.expectedAttempts : 1;
    return { usd: rate * attempts, level: "rate", exactSamples: 0, samples: 0 };
  }

  const fallbackSparks = sparks.actions[action]?.estimatedSparks ?? 0;
  const usd =
    sparks.markupMultiplier > 0 ? (fallbackSparks * sparks.sparkValueUsd) / sparks.markupMultiplier : 0;
  return { usd, level: "fallback", exactSamples: 0, samples: 0 };
}

/**
 * Turn an estimated USD cost into the whole-Spark price of one unit: peg and
 * markup, the action's floor and ceiling, then the plan/campaign multiplier.
 */
export function unitPriceSparks(
  sparks: SparksConfig,
  action: string,
  usd: number,
  multiplier = 1,
): number {
  if (!sparks.enabled || sparks.sparkValueUsd <= 0) return 0;
  const rule = estimationRuleFor(sparks.estimation, action);
  let base = usd > 0 ? Math.max(1, Math.round((usd * sparks.markupMultiplier) / sparks.sparkValueUsd)) : 0;
  if (rule.minSparks > 0) base = Math.max(base, rule.minSparks);
  if (rule.maxSparks > 0) base = Math.min(base, rule.maxSparks);
  const m = multiplier > 0 ? multiplier : 1;
  return Math.max(0, Math.round(base * m));
}

/**
 * The full price of one image unit for a derived-mode action. Fixed and free
 * actions are priced by the caller from their rule; this is only the measured path.
 */
export function derivedUnitPrice(input: UnitEstimateInput, multiplier = 1): { sparks: number; estimate: UnitEstimate } {
  const estimate = estimateUnitCost(input);
  const extra = input.extraUsd && input.extraUsd > 0 ? input.extraUsd : 0;
  return { sparks: unitPriceSparks(input.sparks, input.action, estimate.usd + extra, multiplier), estimate };
}
