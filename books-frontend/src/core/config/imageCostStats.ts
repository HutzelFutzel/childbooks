/**
 * A tiny rolling window of recent per-call image costs, kept in the world-
 * readable `appConfig/imageCostStats` document so the studio can show a live
 * Spark estimate RANGE (e.g. "3–5 ✦") before a generation runs.
 *
 * Only the last {@link COST_WINDOW_SIZE} measured USD costs are retained per
 * {@link costStatsKey} — enough to derive a stable min/max without exposing any
 * per-user data (these are aggregate call costs, and the peg/markup that turn
 * them into Sparks are already public in `appConfig/sparks`).
 *
 * Windows are keyed by the exact model, quality, fidelity, format, render kind,
 * output size, reference bucket, and billable image-call bucket.
 *
 * Settlement still charges the EXACT measured cost of each call; this window
 * only feeds the pre-flight reserve and the displayed estimate.
 */
import type { ImageActionId } from "../ai/actions";
import {
  costProfileKey,
  type GenerationEstimateProfile,
  type GenerationRenderKind,
} from "./generationEstimateProfile";
import type { ImageTier } from "./modelConfig";

/** How many recent call costs to keep per action+tier. */
export const COST_WINDOW_SIZE = 10;

/** One action+tier's recent measured call costs (USD), newest last. */
export interface CostSamples {
  samples: number[];
  /** Denormalized for diagnostics; the profile key already includes it. */
  modelKey?: string;
}

export interface ImageCostStats {
  version: 2;
  /** Keyed by {@link costStatsKey}. */
  stats: Record<string, CostSamples>;
  updatedAt: number;
}

/**
 * Kept as a compatibility alias for callers that select a render shape.
 */
export type CostSampleKind = GenerationRenderKind;

export function costStatsKey(
  action: ImageActionId,
  tier: ImageTier,
  profile: GenerationEstimateProfile,
): string {
  return `v2:${action}:${tier}:${costProfileKey(profile)}`;
}

export function createDefaultImageCostStats(): ImageCostStats {
  return { version: 2, stats: {}, updatedAt: 0 };
}

/** Coerce an arbitrary Firestore payload into a valid stats doc. */
export function normalizeImageCostStats(input: unknown): ImageCostStats {
  const raw = (input ?? {}) as Partial<ImageCostStats>;
  const out: Record<string, CostSamples> = {};
  if (raw.version !== 2) return createDefaultImageCostStats();
  const stats = (raw.stats ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(stats)) {
    const entry = value as CostSamples | undefined;
    const arr = entry?.samples;
    if (Array.isArray(arr)) {
      const nums = arr.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
      if (nums.length) {
        out[key] = {
          samples: nums.slice(-COST_WINDOW_SIZE),
          ...(typeof entry?.modelKey === "string" && entry.modelKey ? { modelKey: entry.modelKey } : {}),
        };
      }
    }
  }
  return { version: 2, stats: out, updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0 };
}

/**
 * The recent cost samples for one action+tier+kind (empty when none recorded).
 *
 * There is deliberately no cross-profile fallback: sparse profiles fall back
 * to rate/config estimates at the caller.
 */
export function recentCostSamples(
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
  profile: GenerationEstimateProfile,
): number[] {
  return stats.stats[costStatsKey(action, tier, profile)]?.samples ?? [];
}

/**
 * Append one measured call cost to its exact-profile window, newest last.
 */
export function appendCostSample(
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
  costUsd: number,
  profile: GenerationEstimateProfile,
): ImageCostStats {
  const key = costStatsKey(action, tier, profile);
  const entry = stats.stats[key];
  const prev = entry?.samples ?? [];
  const next = [...prev, costUsd].slice(-COST_WINDOW_SIZE);
  return {
    version: 2,
    stats: {
      ...stats.stats,
      [key]: { samples: next, modelKey: profile.modelKey },
    },
    updatedAt: Date.now(),
  };
}
