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
import { recentCostSamples, type ImageCostStats } from "../../core/config/imageCostStats";
import {
  estimateSparkRange,
  type SparkEstimateRange,
  type SparksConfig,
} from "../../core/config/sparks";
import { resolveImageModelClient } from "../../platform/aiResolve";
import { useAppConfigStore } from "../../state/appConfigStore";
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
      samples: recentCostSamples(stats, action, tier),
      rateCostUsd,
      fallbackSparks: rule?.estimatedSparks ?? 0,
    }),
  );
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
): SparkEstimateRange | null {
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const multiplier = usePlanActionMultiplier(action);

  return useMemo(
    () => tierSparkRange(sparks, modelCosts, stats, action, tier, multiplier),
    // modelConfig participates via resolveImageModelClient (reads live config).
    [sparks, modelCosts, stats, modelConfig, action, tier, multiplier],
  );
}

/** Format a range compactly: "3–5 ✦", "4 ✦", or "Free". */
export function formatSparkRange(range: SparkEstimateRange | null): string | null {
  if (!range) return null;
  if (range.maxSparks <= 0) return "Free";
  if (range.minSparks === range.maxSparks) return `${range.maxSparks} ✦`;
  return `${range.minSparks}–${range.maxSparks} ✦`;
}
