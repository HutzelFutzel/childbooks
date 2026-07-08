/**
 * A tiny rolling window of recent per-call image costs, kept in the world-
 * readable `appConfig/imageCostStats` document so the studio can show a live
 * Spark estimate RANGE (e.g. "3–5 ✦") before a generation runs.
 *
 * Only the last {@link COST_WINDOW_SIZE} measured USD costs are retained per
 * `${action}:${tier}` — enough to derive a stable min/max without exposing any
 * per-user data (these are aggregate call costs, and the peg/markup that turn
 * them into Sparks are already public in `appConfig/sparks`).
 *
 * Settlement still charges the EXACT measured cost of each call; this window
 * only feeds the pre-flight reserve and the displayed estimate.
 */
import type { ImageActionId } from "../ai/actions";
import type { ImageTier } from "./modelConfig";

/** How many recent call costs to keep per action+tier. */
export const COST_WINDOW_SIZE = 10;

/** One action+tier's recent measured call costs (USD), newest last. */
export interface CostSamples {
  samples: number[];
  /**
   * The `${provider}:${modelId}` the samples were measured against. When the
   * admin rebinds a tier to a different model, stale samples from the old model
   * must not shape the new model's estimates — the window resets.
   */
  modelKey?: string;
}

export interface ImageCostStats {
  version: 1;
  /** Keyed by `${action}:${tier}`. */
  stats: Record<string, CostSamples>;
  updatedAt: number;
}

export function costStatsKey(action: ImageActionId, tier: ImageTier): string {
  return `${action}:${tier}`;
}

export function createDefaultImageCostStats(): ImageCostStats {
  return { version: 1, stats: {}, updatedAt: 0 };
}

/** Coerce an arbitrary Firestore payload into a valid stats doc. */
export function normalizeImageCostStats(input: unknown): ImageCostStats {
  const raw = (input ?? {}) as Partial<ImageCostStats>;
  const out: Record<string, CostSamples> = {};
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
  return { version: 1, stats: out, updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0 };
}

/** The recent cost samples for one action+tier (empty when none recorded). */
export function recentCostSamples(
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
): number[] {
  return stats.stats[costStatsKey(action, tier)]?.samples ?? [];
}

/**
 * Append one measured call cost, capped to the window (newest last). When the
 * sample was measured against a DIFFERENT model than the window's (the admin
 * rebound the tier), the window resets so stale costs can't shape estimates.
 * Pure.
 */
export function appendCostSample(
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
  costUsd: number,
  modelKey?: string,
): ImageCostStats {
  const key = costStatsKey(action, tier);
  const entry = stats.stats[key];
  const sameModel = !modelKey || !entry?.modelKey || entry.modelKey === modelKey;
  const prev = sameModel ? (entry?.samples ?? []) : [];
  const next = [...prev, costUsd].slice(-COST_WINDOW_SIZE);
  return {
    version: 1,
    stats: {
      ...stats.stats,
      [key]: { samples: next, ...(modelKey ? { modelKey } : entry?.modelKey ? { modelKey: entry.modelKey } : {}) },
    },
    updatedAt: Date.now(),
  };
}
