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
 * Fresh renders and edits are windowed separately: an edit re-renders one region
 * per subject, so a single window would both inflate the fresh estimate and
 * under-quote the edit.
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
  /** Keyed by {@link costStatsKey}. */
  stats: Record<string, CostSamples>;
  updatedAt: number;
}

/**
 * Which shape of render a window describes. An edit fans out into a localization
 * call plus one image call PER subject, so it routinely costs several times what
 * a fresh render of the same page does. Pooling the two made every edit quote
 * undershoot its charge; keeping them apart lets each quote from its own history.
 */
export type CostSampleKind = "fresh" | "edit";

export function costStatsKey(
  action: ImageActionId,
  tier: ImageTier,
  kind: CostSampleKind = "fresh",
): string {
  // "fresh" keeps its original unsuffixed key so the windows already collected
  // in production keep feeding the estimates they were collected for.
  return kind === "edit" ? `${action}:${tier}:edit` : `${action}:${tier}`;
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

/**
 * The recent cost samples for one action+tier+kind (empty when none recorded).
 *
 * An edit window that hasn't filled yet falls back to the fresh window rather
 * than to the flat configured estimate: a fresh render's measured cost is a
 * closer floor for an edit than a hand-typed number, and it stops a newly-added
 * tier from quoting the fallback for its first ten edits.
 */
export function recentCostSamples(
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
  kind: CostSampleKind = "fresh",
): number[] {
  const own = stats.stats[costStatsKey(action, tier, kind)]?.samples ?? [];
  if (own.length > 0 || kind === "fresh") return own;
  return stats.stats[costStatsKey(action, tier, "fresh")]?.samples ?? [];
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
  kind: CostSampleKind = "fresh",
): ImageCostStats {
  const key = costStatsKey(action, tier, kind);
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
