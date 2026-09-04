/**
 * Live Spark estimate RANGE for an image action at a given quality tier, derived
 * the same way the server reserve is: recent measured call costs → the model's
 * rate-table cost → the flat configured estimate. Reactive to the public config
 * (Sparks peg/markup, cost table, recent-cost window). Returns null when the
 * economy is disabled (nothing to charge).
 */
import { useMemo } from "react";
import type { ImageActionId } from "../../core/ai/actions";
import type { ImageTier } from "../../core/config/modelConfig";
import {
  costForUsage,
  costKey,
  PUBLIC_IMAGE_ESTIMATE_USAGE,
  type ModelCostTable,
} from "../../core/config/modelCosts";
import {
  recentCostSamples,
  type CostSampleKind,
  type ImageCostStats,
} from "../../core/config/imageCostStats";
import {
  estimateSparkRange,
  type SparkEstimateRange,
  type SparksConfig,
} from "../../core/config/sparks";
import { resolveImageModelClient } from "../../platform/aiResolve";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useCampaignMultiplier } from "../../state/priceOverridesStore";
import { usePlanActionMultiplier } from "../../state/subscriptionStore";

/**
 * Pure Spark estimate RANGE for one image action+tier from the given config
 * slices. Kept hook-free so batch estimates can sum several actions without
 * calling hooks in a loop. Mirrors the server reserve: recent measured costs →
 * the model's rate-table cost → the flat configured estimate.
 */
export function tierSparkRange(
  sparks: SparksConfig,
  modelCosts: ModelCostTable,
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
  planMultiplier = 1,
  kind: CostSampleKind = "fresh",
): SparkEstimateRange | null {
  if (!sparks.enabled) return null;
  const m = planMultiplier > 0 ? planMultiplier : 1;
  const applyM = (r: SparkEstimateRange): SparkEstimateRange => ({
    minSparks: Math.max(0, Math.round(r.minSparks * m)),
    maxSparks: Math.max(0, Math.round(r.maxSparks * m)),
  });
  const rule = sparks.actions[action];
  if (rule?.mode === "free") return { minSparks: 0, maxSparks: 0 };
  if (rule?.mode === "fixed") {
    return applyM({ minSparks: rule.fixedSparks, maxSparks: rule.fixedSparks });
  }
  const sel = resolveImageModelClient(action, tier);
  const rateCostUsd = sel
    ? costForUsage(modelCosts.models[costKey(sel.provider, sel.id)], PUBLIC_IMAGE_ESTIMATE_USAGE)
    : null;
  return applyM(
    estimateSparkRange(sparks, {
      samples: recentCostSamples(stats, action, tier, kind),
      rateCostUsd,
      fallbackSparks: rule?.estimatedSparks ?? 0,
    }),
  );
}

/**
 * Widest range covering every candidate (min of mins, max of maxes). Used for
 * previews shown BEFORE the user has picked a quality tier: spanning both tiers
 * is honest about the spread, where quoting one tier's price would not be.
 */
export function spanTierRanges(ranges: (SparkEstimateRange | null)[]): SparkEstimateRange | null {
  const valid = ranges.filter((r): r is SparkEstimateRange => r != null);
  if (valid.length === 0) return null;
  return {
    minSparks: Math.min(...valid.map((r) => r.minSparks)),
    maxSparks: Math.max(...valid.map((r) => r.maxSparks)),
  };
}

/** Sum a batch of image action+tier ranges into one range (min sum, max sum). */
export function sumTierRanges(ranges: (SparkEstimateRange | null)[]): SparkEstimateRange | null {
  const valid = ranges.filter((r): r is SparkEstimateRange => r != null);
  if (valid.length === 0) return null;
  return valid.reduce(
    (acc, r) => ({ minSparks: acc.minSparks + r.minSparks, maxSparks: acc.maxSparks + r.maxSparks }),
    { minSparks: 0, maxSparks: 0 },
  );
}

export function useTierSparkEstimate(
  action: ImageActionId,
  tier: ImageTier,
  kind: CostSampleKind = "fresh",
): SparkEstimateRange | null {
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const planMultiplier = usePlanActionMultiplier(action);
  // The campaign override multiplies the plan's, exactly as `estimateForUser`
  // does server-side. Quoting without it promised full price through a
  // "renders are free" week and then charged nothing.
  const campaignMultiplier = useCampaignMultiplier(action, tier);
  const multiplier = planMultiplier * campaignMultiplier;

  return useMemo(
    () => tierSparkRange(sparks, modelCosts, stats, action, tier, multiplier, kind),
    // modelConfig participates via resolveImageModelClient (reads live config).
    [sparks, modelCosts, stats, modelConfig, action, tier, multiplier, kind],
  );
}

/** Format a range compactly: "3–5 ✦", "4 ✦", or "Free". */
export function formatSparkRange(range: SparkEstimateRange | null): string | null {
  if (!range) return null;
  if (range.maxSparks <= 0) return "Free";
  if (range.minSparks === range.maxSparks) return `${range.maxSparks} ✦`;
  return `${range.minSparks}–${range.maxSparks} ✦`;
}
