/**
 * How a Spark price is estimated from recent measured costs — the admin-editable
 * `estimation` block of `appConfig/sparks`.
 *
 * The estimate IS the price: whatever this produces is what the button shows
 * and exactly what the wallet charges when the work succeeds. So the statistic
 * chosen here is a pricing decision, not just a display one, and the admin sees
 * its bias against real costs before saving (see `core/billing/priceBacktest`).
 *
 * One rule applies to every image action by default; each action (page, cover,
 * reference sheet, portrait) may override any field.
 */
import { z } from "zod";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../ai/actions";

export const ESTIMATION_STATISTICS = ["mean", "median", "trimmedMean", "percentile", "ema"] as const;
export type EstimationStatistic = (typeof ESTIMATION_STATISTICS)[number];

/** The most samples a cost window keeps per group (the upper bound for `window`). */
export const COST_SAMPLE_CAPACITY = 100;

export interface EstimationRule {
  statistic: EstimationStatistic;
  /** 1–99, used when `statistic === "percentile"`. */
  percentile: number;
  /** Share cut from EACH end, 0–40, used when `statistic === "trimmedMean"`. */
  trimPercent: number;
  /** Weight of the newest sample, 0.05–0.9, used when `statistic === "ema"`. */
  emaAlpha: number;
  /** How many of the newest samples to use (1–{@link COST_SAMPLE_CAPACITY}). */
  window: number;
  /** Below this many samples the group borrows from a broader one. */
  minSamples: number;
  /** Samples older than this are ignored. 0 = no age limit. */
  maxAgeDays: number;
  /** At most this many samples from one book. 0 = no limit. */
  perProjectCap: number;
  /** Blend a sparse group with its broader estimate instead of switching abruptly. */
  blend: boolean;
  /** Price floor per unit in Sparks. 0 = no floor. */
  minSparks: number;
  /** Price ceiling per unit in Sparks. 0 = no ceiling. */
  maxSparks: number;
}

/**
 * What one sample in the cost window measures:
 *   - `full`      — everything the render cost us: the requested image plus
 *                   every retry and repair pass the pipeline made to deliver it.
 *                   The quote then forwards that overhead as an average, so
 *                   no reader pays for their own retry and none is lost.
 *   - `requested` — only the requested calls; retries and repairs are absorbed.
 */
export const COST_BASES = ["full", "requested"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export interface EstimationConfig {
  defaults: EstimationRule;
  /** Per-action overrides; a missing field inherits from `defaults`. */
  byAction: Partial<Record<ImageActionId, Partial<EstimationRule>>>;
  costBasis: CostBasis;
  /**
   * Average provider calls per delivered render, applied to the cost-table rate
   * when a group has no measured renders yet. The rate is one image; a `full`
   * window also carries retries and repairs, so a bare rate would underprice
   * until enough renders are measured. Ignored for the `requested` basis.
   */
  expectedAttempts: number;
  /**
   * Relative cost of each image quality setting, used only to scale a measured
   * group into a quality that has no samples yet (low → high after a settings
   * change). Replaced by real samples as soon as they exist.
   */
  qualityFactors: Record<string, number>;
}

export const DEFAULT_ESTIMATION_RULE: EstimationRule = {
  statistic: "mean",
  percentile: 50,
  trimPercent: 10,
  emaAlpha: 0.2,
  window: 50,
  minSamples: 5,
  maxAgeDays: 30,
  perProjectCap: 3,
  blend: true,
  minSparks: 1,
  maxSparks: 0,
};

/**
 * Relative per-image cost by quality. Seeded from OpenAI's published
 * gpt-image price ladder (low ≈ $0.011, medium ≈ $0.042, high ≈ $0.167 at
 * 1024²); only used until the target quality has its own samples.
 */
export const DEFAULT_QUALITY_FACTORS: Record<string, number> = {
  low: 1,
  medium: 4,
  high: 15,
  xhigh: 20,
  max: 25,
  auto: 4,
  "provider-default": 4,
};

export const DEFAULT_EXPECTED_ATTEMPTS = 1.1;

export function createDefaultEstimationConfig(): EstimationConfig {
  return {
    defaults: { ...DEFAULT_ESTIMATION_RULE },
    byAction: {},
    costBasis: "full",
    expectedAttempts: DEFAULT_EXPECTED_ATTEMPTS,
    qualityFactors: { ...DEFAULT_QUALITY_FACTORS },
  };
}

/**
 * Statistics that drop the expensive tail. Under the `full` basis that tail is
 * exactly the renders that needed a retry, so these leave retry cost unpriced.
 */
export function statisticDropsRetries(rule: Pick<EstimationRule, "statistic" | "percentile">): boolean {
  if (rule.statistic === "median" || rule.statistic === "trimmedMean") return true;
  return rule.statistic === "percentile" && rule.percentile <= 50;
}

/** Short pros and cons shown next to each statistic in the admin. */
export const STATISTIC_INFO: Record<EstimationStatistic, { label: string; pro: string; con: string }> = {
  mean: {
    label: "Mean",
    pro: "Matches your real cost across many renders.",
    con: "One unusual render moves it a little.",
  },
  median: {
    label: "Median",
    pro: "Unaffected by single outliers.",
    con: "Costs skew upward, so it tends to charge slightly below cost.",
  },
  trimmedMean: {
    label: "Trimmed mean",
    pro: "Robust like the median, but close to the mean.",
    con: "Cutting the top slightly underestimates if expensive renders are normal.",
  },
  percentile: {
    label: "Percentile",
    pro: "High percentiles rarely charge below cost; low ones are cheapest for users.",
    con: "Above 50 overprices most books; below 50 loses money.",
  },
  ema: {
    label: "Moving average",
    pro: "Reacts quickly to real price changes.",
    con: "A single book can swing it.",
  },
};

/** Where an estimate came from, broadest last. */
export const ESTIMATE_LEVELS = ["exact", "nearest", "pooled", "model", "scaled", "rate", "fallback"] as const;
export type EstimateLevel = (typeof ESTIMATE_LEVELS)[number];

export const ESTIMATE_LEVEL_INFO: Record<EstimateLevel, string> = {
  exact: "Measured renders with these exact settings.",
  nearest: "Measured renders with these settings and the closest number of reference images (the two closest averaged on a tie).",
  pooled: "Measured renders with these settings, any number of reference images.",
  model: "Measured renders of this model and quality, any size or reference count.",
  scaled: "Measured renders at another quality, scaled by the quality factor.",
  rate: "The model's price in the cost table (no measured renders yet).",
  fallback: "The action's configured fallback price.",
};

/** The effective rule for one action: its overrides on top of the defaults. */
export function estimationRuleFor(config: EstimationConfig, action: string): EstimationRule {
  const override = config.byAction[action as ImageActionId] ?? {};
  return { ...config.defaults, ...override };
}

// ---- Normalization -----------------------------------------------------------

function clampNumber(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function normalizeRule(raw: unknown, fallback: EstimationRule): EstimationRule {
  const r = (raw ?? {}) as Partial<EstimationRule>;
  return {
    statistic: (ESTIMATION_STATISTICS as readonly string[]).includes(r.statistic as string)
      ? (r.statistic as EstimationStatistic)
      : fallback.statistic,
    percentile: clampNumber(r.percentile, 1, 99, fallback.percentile),
    trimPercent: clampNumber(r.trimPercent, 0, 40, fallback.trimPercent),
    emaAlpha: clampNumber(r.emaAlpha, 0.05, 0.9, fallback.emaAlpha),
    window: Math.round(clampNumber(r.window, 1, COST_SAMPLE_CAPACITY, fallback.window)),
    minSamples: Math.round(clampNumber(r.minSamples, 1, COST_SAMPLE_CAPACITY, fallback.minSamples)),
    maxAgeDays: Math.round(clampNumber(r.maxAgeDays, 0, 3650, fallback.maxAgeDays)),
    perProjectCap: Math.round(clampNumber(r.perProjectCap, 0, COST_SAMPLE_CAPACITY, fallback.perProjectCap)),
    blend: typeof r.blend === "boolean" ? r.blend : fallback.blend,
    minSparks: Math.round(clampNumber(r.minSparks, 0, 100_000, fallback.minSparks)),
    maxSparks: Math.round(clampNumber(r.maxSparks, 0, 100_000, fallback.maxSparks)),
  };
}

/** Keep only the fields an override actually sets (so defaults keep flowing through). */
function normalizeOverride(raw: unknown, base: EstimationRule): Partial<EstimationRule> {
  if (!raw || typeof raw !== "object") return {};
  const full = normalizeRule(raw, base);
  const out: Partial<EstimationRule> = {};
  for (const key of Object.keys(full) as (keyof EstimationRule)[]) {
    if ((raw as Record<string, unknown>)[key] !== undefined) {
      (out as Record<string, unknown>)[key] = full[key];
    }
  }
  return out;
}

export function normalizeEstimationConfig(input: unknown): EstimationConfig {
  const def = createDefaultEstimationConfig();
  const raw = (input ?? {}) as Partial<EstimationConfig>;
  const defaults = normalizeRule(raw.defaults, def.defaults);
  const byAction: EstimationConfig["byAction"] = {};
  for (const id of ALL_IMAGE_ACTION_IDS) {
    const o = normalizeOverride(raw.byAction?.[id], defaults);
    if (Object.keys(o).length > 0) byAction[id] = o;
  }
  const qualityFactors: Record<string, number> = { ...def.qualityFactors };
  for (const [k, v] of Object.entries(raw.qualityFactors ?? {})) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) qualityFactors[k] = v;
  }
  const costBasis: CostBasis = (COST_BASES as readonly string[]).includes(raw.costBasis as string)
    ? (raw.costBasis as CostBasis)
    : def.costBasis;
  const expectedAttempts = clampNumber(raw.expectedAttempts, 1, 5, def.expectedAttempts);
  return { defaults, byAction, costBasis, expectedAttempts, qualityFactors };
}

const ruleShape = {
  statistic: z.enum(ESTIMATION_STATISTICS),
  percentile: z.number().min(1).max(99),
  trimPercent: z.number().min(0).max(40),
  emaAlpha: z.number().min(0.05).max(0.9),
  window: z.number().int().min(1).max(COST_SAMPLE_CAPACITY),
  minSamples: z.number().int().min(1).max(COST_SAMPLE_CAPACITY),
  maxAgeDays: z.number().int().min(0),
  perProjectCap: z.number().int().min(0),
  blend: z.boolean(),
  minSparks: z.number().int().min(0),
  maxSparks: z.number().int().min(0),
};

export const estimationConfigSchema = z.object({
  defaults: z.object(ruleShape),
  byAction: z.record(z.string(), z.object(ruleShape).partial()),
  costBasis: z.enum(COST_BASES).optional(),
  expectedAttempts: z.number().min(1).max(5).optional(),
  qualityFactors: z.record(z.string(), z.number().positive()),
});
