"use client";

import { Sparkles } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import type { SparkEstimateRange } from "../../core/config/sparks";
import type { ImageActionId } from "../../core/ai/actions";
import { DEFAULT_IMAGE_TIER } from "../../core/config/modelConfig";
import { usePreferredImageTier } from "../../state/imageTier";
import { usePlanActionMultiplier, useSubscriptionStore } from "../../state/subscriptionStore";
import { activeSubscription } from "../../platform/subscriptions";
import { findPublicPlanByPriceId, planActionMultiplier } from "../../core/config/plans";
import { tierSparkRange, sumTierRanges } from "../hooks/useTierEstimate";

/** The effective image tier for previews (user's choice, else the default). */
function useEffectiveTier() {
  return usePreferredImageTier() ?? DEFAULT_IMAGE_TIER;
}

/**
 * Tier-aware Spark estimate RANGE for a single image action, tracking the user's
 * quality choice + the live cost window. Null when the economy is off.
 */
export function useImageActionRange(action: ImageActionId): SparkEstimateRange | null {
  const tier = useEffectiveTier();
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  // modelConfig read inside tierSparkRange via resolveImageModelClient.
  useAppConfigStore((s) => s.modelConfig);
  const multiplier = usePlanActionMultiplier(action);
  return tierSparkRange(sparks, modelCosts, stats, action, tier, multiplier);
}

/** Tier-aware Spark estimate RANGE for a batch of image actions (summed). */
export function useImageBatchRange(
  items: { action: ImageActionId; count: number }[],
): SparkEstimateRange | null {
  const tier = useEffectiveTier();
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  useAppConfigStore((s) => s.modelConfig);
  // Subscribe to the plan/subscription slices so per-action multipliers stay
  // reactive without calling a hook per item.
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const sub = activeSubscription(subscriptions);
  const plan = sub ? findPublicPlanByPriceId(plans, sub.priceId) : null;
  const ranges = items
    .filter((it) => it.count > 0)
    .map((it) => {
      const m = planActionMultiplier(plan, it.action);
      const r = tierSparkRange(sparks, modelCosts, stats, it.action, tier, m);
      if (!r) return null;
      return { minSparks: r.minSparks * it.count, maxSparks: r.maxSparks * it.count };
    });
  return sumTierRanges(ranges);
}

/**
 * An estimated-cost chip for image generation. Shows "~N ✦" (or "~N–M ✦" when
 * the recent costs vary), with a leading "~" and a tooltip to make clear this is
 * an ESTIMATE — the actual charge is the measured cost and can differ a little.
 * Renders nothing when Sparks are off or the estimate is free/zero.
 */
export function SparkEstimateCost({
  range,
  className = "",
}: {
  range: SparkEstimateRange | null;
  className?: string;
}) {
  if (!range || range.maxSparks <= 0) return null;
  const text =
    range.minSparks === range.maxSparks
      ? `${range.maxSparks.toLocaleString()}`
      : `${range.minSparks.toLocaleString()}–${range.maxSparks.toLocaleString()}`;
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-magic-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-magic-700 ring-1 ring-inset ring-magic-300/50 ${className}`}
      title="Estimated cost — you're charged the actual amount when it finishes, which can vary a little."
    >
      <Sparkles className="size-3" />~{text}
    </span>
  );
}
