"use client";

import { Check, Clock, Gauge, Lock, Sparkles, Zap } from "lucide-react";
import {
  DEFAULT_IMAGE_TIER_LABELS,
  IMAGE_TIERS,
  type ImageTier,
} from "../../core/config/modelConfig";
import {
  estimateTaskRange,
  formatDurationRange,
} from "../../core/config/latencyStats";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { formatSparkRange, useTierSparkEstimate } from "../hooks/useTierEstimate";

/** One-line pitch for each tier, shown under its name. */
const TIER_BLURB: Record<ImageTier, string> = {
  quick:
    "Draft quality in under a minute per image — perfect for laying out the book and trying ideas. Characters can drift a little from their references.",
  premium:
    "Slower per image (a few minutes), but subjects match their references much more closely and flaws get auto-repaired — best for the final book.",
};

function TierCard({
  tier,
  selected,
  locked,
  onSelect,
}: {
  tier: ImageTier;
  selected: boolean;
  /** Shown but not choosable (premium is an account feature). */
  locked?: boolean;
  onSelect: () => void;
}) {
  const labels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  const latencyStats = useAppConfigStore((s) => s.latencyStats);
  const estimate = useTierSparkEstimate("pageIllustration", tier);
  const priceText = formatSparkRange(estimate);
  const label = labels?.[tier]?.trim() || DEFAULT_IMAGE_TIER_LABELS[tier];
  // Live per-image time estimate from the rolling latency window (falls back
  // to a per-tier seed until enough real renders have been measured).
  const timeText = formatDurationRange(
    estimateTaskRange(latencyStats, "pageIllustration", tier),
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex w-full flex-col gap-1.5 rounded-xl p-3 text-left ring-1 ring-inset transition " +
        (selected
          ? "bg-brand-50 ring-2 ring-brand-400"
          : locked
            ? "bg-ink-50/60 ring-ink-100 hover:ring-ink-300"
            : "bg-white ring-ink-100 hover:ring-ink-300")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          {tier === "quick" ? (
            <Zap className="size-4 text-amber-500" />
          ) : (
            <Sparkles className="size-4 text-brand-500" />
          )}
          {label}
        </span>
        {selected ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-brand-600">
            <Check className="size-3.5" /> Selected
          </span>
        ) : locked ? (
          <span className="flex items-center gap-1 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
            <Lock className="size-3" /> Sign in
          </span>
        ) : priceText ? (
          <span className="rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
            {priceText}
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-ink-500">{TIER_BLURB[tier]}</p>
      <span className="inline-flex w-fit items-center gap-1 rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
        <Clock className="size-3" /> {timeText} per image
      </span>
      {selected && priceText && (
        <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
          <Gauge className="size-3" /> about {priceText} per page
        </span>
      )}
    </button>
  );
}

/**
 * The Fast / High-Quality chooser. Presents both tiers as cards with a plain-
 * language tradeoff and a live per-page Spark estimate. `value === null` means
 * the user hasn't chosen yet (nothing is highlighted).
 *
 * Guests see High-Quality locked rather than hidden: the backend renders every
 * anonymous request on the quick tier, so letting them "pick" premium would
 * charge for one thing and deliver another. Clicking it offers the sign-in that
 * unlocks it.
 */
export function ImageTierPicker({
  value,
  onChange,
}: {
  value: ImageTier | null;
  onChange: (tier: ImageTier) => void;
}) {
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const premiumLocked = accessLevel === "guest";

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {IMAGE_TIERS.map((tier) => {
          const locked = premiumLocked && tier === "premium";
          return (
            <TierCard
              key={tier}
              tier={tier}
              selected={value === tier}
              locked={locked}
              onSelect={() =>
                locked
                  ? openAuthDialog("Create a free account to generate on the High-Quality tier.")
                  : onChange(tier)
              }
            />
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">
        Spark amounts are estimates — you&apos;re charged the actual cost when each image finishes,
        which can vary a little.
      </p>
    </div>
  );
}
