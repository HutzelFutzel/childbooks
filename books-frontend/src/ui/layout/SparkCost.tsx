"use client";

import { Sparkles } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import {
  campaignMultiplierFor,
  usePriceOverridesStore,
} from "../../state/priceOverridesStore";
import type { SparkEstimateRange } from "../../core/config/sparks";
import type { CostSampleKind } from "../../core/config/imageCostStats";
import type { ImageActionId } from "../../core/ai/actions";
import { IMAGE_TIERS, type ImageTier } from "../../core/config/modelConfig";
import { usePreferredImageTier } from "../../state/imageTier";
import { usePlanActionMultiplier, useSubscriptionStore } from "../../state/subscriptionStore";
import { activeSubscription } from "../../platform/subscriptions";
import { findPublicPlanByPriceId, planActionMultiplier } from "../../core/config/plans";
import { spanTierRanges, tierSparkRange, sumTierRanges } from "../hooks/useTierEstimate";

/**
 * The tiers a preview should price. Once the user has chosen, that's the one
 * they'll be charged for; before then we span both rather than quote the cheap
 * one as if it were decided.
 */
function usePreviewTiers(): ImageTier[] {
  const tier = usePreferredImageTier();
  return tier ? [tier] : IMAGE_TIERS;
}

/**
 * Tier-aware Spark estimate RANGE for a single image action, tracking the user's
 * quality choice + the live cost window. Null when the economy is off.
 */
export function useImageActionRange(
  action: ImageActionId,
  kind: CostSampleKind = "fresh",
): SparkEstimateRange | null {
  const tiers = usePreviewTiers();
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  // modelConfig read inside tierSparkRange via resolveImageModelClient.
  useAppConfigStore((s) => s.modelConfig);
  const multiplier = usePlanActionMultiplier(action);
  // Campaign overrides multiply the plan's, mirroring the server's quote.
  const overrides = usePriceOverridesStore((s) => s.actions);
  return spanTierRanges(
    tiers.map((t) =>
      tierSparkRange(
        sparks,
        modelCosts,
        stats,
        action,
        t,
        multiplier * campaignMultiplierFor(overrides, action, t),
        kind,
      ),
    ),
  );
}

/** Tier-aware Spark estimate RANGE for a batch of image actions (summed). */
export function useImageBatchRange(
  items: { action: ImageActionId; count: number }[],
): SparkEstimateRange | null {
  const tiers = usePreviewTiers();
  const sparks = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.modelCosts);
  const stats = useAppConfigStore((s) => s.imageCostStats);
  useAppConfigStore((s) => s.modelConfig);
  // Subscribe to the plan/subscription slices so per-action multipliers stay
  // reactive without calling a hook per item.
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const overrides = usePriceOverridesStore((s) => s.actions);
  const sub = activeSubscription(subscriptions);
  const plan = sub ? findPublicPlanByPriceId(plans, sub.priceId) : null;
  const ranges = items
    .filter((it) => it.count > 0)
    .map((it) => {
      const m = planActionMultiplier(plan, it.action);
      const r = spanTierRanges(
        tiers.map((t) =>
          tierSparkRange(
            sparks,
            modelCosts,
            stats,
            it.action,
            t,
            m * campaignMultiplierFor(overrides, it.action, t),
          ),
        ),
      );
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
 *
 * When a campaign is discounting the action, the chip names it: a price that
 * dropped for no visible reason reads as a bug rather than as a gift.
 */
export function SparkEstimateCost({
  range,
  action,
  className = "",
}: {
  range: SparkEstimateRange | null;
  /** Names the campaign behind a discounted price, when one applies. */
  action?: ImageActionId;
  className?: string;
}) {
  const note = usePriceOverridesStore((s) => (action ? s.actions[action]?.note ?? null : null));
  if (!range || range.maxSparks <= 0) return null;
  const text =
    range.minSparks === range.maxSparks
      ? `${range.maxSparks.toLocaleString()}`
      : `${range.minSparks.toLocaleString()}–${range.maxSparks.toLocaleString()}`;
  const title = note
    ? `${note.label} — estimated cost with your discount applied. You're charged the actual amount when it finishes.`
    : "Estimated cost — you're charged the actual amount when it finishes, which can vary a little.";
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-magic-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-magic-700 ring-1 ring-inset ring-magic-300/50 ${className}`}
      title={title}
    >
      <Sparkles className="size-3" />~{text}
    </span>
  );
}
