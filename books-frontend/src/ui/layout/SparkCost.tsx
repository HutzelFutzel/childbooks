"use client";

import { Sparkles } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { estimateForAction } from "../../core/config/sparks";
import type { SparkActionId } from "../../core/config/sparks";

/**
 * The Spark cost a generate/re-roll action will reserve, read live from the
 * economy config. Returns 0 when Sparks are disabled or the action is free —
 * callers render nothing in that case. Uses the base estimate (no per-plan
 * discount), so a subscriber may be pleasantly charged less than shown.
 */
export function useActionEstimate(action: SparkActionId): number {
  return useAppConfigStore((s) => estimateForAction(s.sparks, action));
}

/** Sum of base estimates for a batch (e.g. "Generate everything"). */
export function useBatchEstimate(items: { action: SparkActionId; count: number }[]): number {
  return useAppConfigStore((s) =>
    items.reduce((sum, it) => sum + estimateForAction(s.sparks, it.action) * Math.max(0, it.count), 0),
  );
}

/** A tiny inline "✦N" cost chip. Renders nothing when the cost is 0. */
export function SparkCost({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-0.5 rounded bg-black/10 px-1 py-0.5 text-[10px] font-semibold leading-none ${className}`}
      title={`Costs about ${n} Sparks`}
    >
      <Sparkles className="size-3" />
      {n.toLocaleString()}
    </span>
  );
}
