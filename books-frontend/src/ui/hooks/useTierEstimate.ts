/**
 * Live Spark PRICE for an image action at a given quality tier, computed by the
 * same estimator the server charges with (`core/billing/priceEstimation`).
 * Reactive to the public config (Sparks peg/markup and estimation rules, cost
 * table, recent-cost window). Returns null when the economy is disabled.
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
import type { CostSampleKind, ImageCostStats } from "../../core/config/imageCostStats";
import { estimateProfileForAction } from "../../core/config/generationEstimateProfile";
import {
  generationTuningFor,
  type GenerationTuningConfig,
} from "../../core/config/generationTuning";
import {
  printPrepFixedSparks,
  printPrepSurchargeUsd,
  type SparkEstimateRange,
  type SparksConfig,
} from "../../core/config/sparks";
import { derivedUnitPrice } from "../../core/billing/priceEstimation";
import { isPrintPrepAction } from "../../core/billing/printPrepCharge";
import { resolveImageModelClient } from "../../platform/aiResolve";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useCampaignMultiplier } from "../../state/priceOverridesStore";
import { usePlanActionMultiplier } from "../../state/subscriptionStore";

/**
 * Pure Spark estimate RANGE for one image action+tier from the given config
 * slices. Kept hook-free so batch estimates can sum several actions without
 * calling hooks in a loop. Mirrors the server quote exactly.
 */
export function tierSparkRange(
  sparks: SparksConfig,
  modelCosts: ModelCostTable,
  stats: ImageCostStats,
  generationTuning: GenerationTuningConfig,
  action: ImageActionId,
  tier: ImageTier,
  planMultiplier = 1,
  kind: CostSampleKind = "fresh",
  /** Reference images the render plans to send (`referencePlan`); absent prices from every count. */
  referenceCount?: number,
  /** This render is its slot's first and carries the print-prep surcharge (`printPrepCharge`). */
  printPrep = false,
): SparkEstimateRange | null {
  if (!sparks.enabled) return null;
  const m = planMultiplier > 0 ? planMultiplier : 1;
  const prepUsd = printPrep && isPrintPrepAction(action) ? printPrepSurchargeUsd(sparks) : 0;
  const prepFlat = prepUsd > 0 ? printPrepFixedSparks(sparks, planMultiplier) : 0;
  const applyM = (r: SparkEstimateRange): SparkEstimateRange => ({
    minSparks: Math.max(0, Math.round(r.minSparks * m)),
    maxSparks: Math.max(0, Math.round(r.maxSparks * m)),
  });
  const withPrep = (r: SparkEstimateRange): SparkEstimateRange =>
    r.maxSparks > 0 && prepFlat > 0
      ? { minSparks: r.minSparks + prepFlat, maxSparks: r.maxSparks + prepFlat }
      : r;
  const rule = sparks.actions[action];
  if (rule?.mode === "free") return { minSparks: 0, maxSparks: 0 };
  if (rule?.mode === "fixed") {
    return withPrep(applyM({ minSparks: rule.fixedSparks, maxSparks: rule.fixedSparks }));
  }
  const sel = resolveImageModelClient(action, tier);
  if (!sel) {
    const flat = rule?.estimatedSparks ?? 0;
    return withPrep(applyM({ minSparks: flat, maxSparks: flat }));
  }
  const rateUsd = costForUsage(modelCosts.models[costKey(sel.provider, sel.id)], PUBLIC_IMAGE_ESTIMATE_USAGE);
  const profile = estimateProfileForAction({
    action,
    tier,
    model: sel,
    tuning: generationTuningFor(generationTuning, action),
    kind,
    referenceCount,
  });
  const { sparks: price } = derivedUnitPrice(
    { stats, sparks, action, tier, profile, rateUsd, extraUsd: prepUsd },
    planMultiplier,
  );
  return { minSparks: price, maxSparks: price };
}

/**
 * Widest range covering every candidate (min of mins, max of maxes). Used when
 * combining model-backed estimates that share one customer-facing action.
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
  referenceCount?: number,
): SparkEstimateRange | null {
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  const generationTuning = useAppConfigStore((s) => s.generationTuning);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const planMultiplier = usePlanActionMultiplier(action);
  // The campaign override multiplies the plan's, exactly as `estimateForUser`
  // does server-side. Quoting without it promised full price through a
  // "renders are free" week and then charged nothing.
  const campaignMultiplier = useCampaignMultiplier(action, tier);
  const multiplier = planMultiplier * campaignMultiplier;

  return useMemo(
    () =>
      tierSparkRange(
        sparks,
        modelCosts,
        stats,
        generationTuning,
        action,
        tier,
        multiplier,
        kind,
        referenceCount,
      ),
    // modelConfig participates via resolveImageModelClient (reads live config).
    [
      sparks,
      modelCosts,
      stats,
      generationTuning,
      modelConfig,
      action,
      tier,
      multiplier,
      kind,
      referenceCount,
    ],
  );
}

/** Format a range compactly: "3–5 ✦", "4 ✦", or "Free". */
export function formatSparkRange(range: SparkEstimateRange | null): string | null {
  if (!range) return null;
  if (range.maxSparks <= 0) return "Free";
  if (range.minSparks === range.maxSparks) return `${range.maxSparks} ✦`;
  return `${range.minSparks}–${range.maxSparks} ✦`;
}
