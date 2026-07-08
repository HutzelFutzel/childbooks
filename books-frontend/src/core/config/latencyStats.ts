/**
 * A rolling window of recent per-task generation DURATIONS, kept in the
 * world-readable `appConfig/latencyStats` document so the studio can show a
 * live time estimate ("usually 20–45s") before and during a generation.
 *
 * Mirrors `imageCostStats`: the worker (and the sync `/ai/*` endpoints) append
 * a measured duration per finished render, bucketed by the parameters that
 * actually move the needle — action, tier, kind of render, and how many
 * reference images were involved. Each sample is ALSO appended to the coarse
 * `action:tier` bucket so sparse fine buckets can fall back gracefully.
 *
 * Only aggregate durations are stored (never per-user data).
 */
import type { ImageActionId } from "../ai/actions";
import type { ImageTier } from "./modelConfig";

/** How many recent durations to keep per bucket. */
export const LATENCY_WINDOW_SIZE = 20;

/** Minimum samples before a bucket is trusted for an estimate. */
export const LATENCY_MIN_SAMPLES = 4;

/** Queue-dispatch delay bucket (job created → worker picks it up). */
export const DISPATCH_KEY = "dispatch";

/** How a render came about — fresh, composition-preserving refresh, or edit. */
export type LatencyKind = "fresh" | "refresh" | "edit";

export interface LatencySamples {
  samples: number[];
}

export interface LatencyStats {
  version: 1;
  /** Keyed by `${action}:${tier}:${kind}:rN` (fine) or `${action}:${tier}` (coarse). */
  stats: Record<string, LatencySamples>;
  updatedAt: number;
}

/** Coarse reference-count bucket — the payload size driver. */
export function refBucket(refCount: number): string {
  if (refCount <= 0) return "0";
  if (refCount <= 2) return "1-2";
  if (refCount <= 4) return "3-4";
  return "5+";
}

export function latencyKey(
  action: ImageActionId,
  tier: ImageTier,
  kind: LatencyKind,
  refCount: number,
): string {
  return `${action}:${tier}:${kind}:r${refBucket(refCount)}`;
}

export function latencyCoarseKey(action: ImageActionId, tier: ImageTier): string {
  return `${action}:${tier}`;
}

export function createDefaultLatencyStats(): LatencyStats {
  return { version: 1, stats: {}, updatedAt: 0 };
}

/** Coerce an arbitrary Firestore payload into a valid stats doc. */
export function normalizeLatencyStats(input: unknown): LatencyStats {
  const raw = (input ?? {}) as Partial<LatencyStats>;
  const out: Record<string, LatencySamples> = {};
  const stats = (raw.stats ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(stats)) {
    const arr = (value as LatencySamples | undefined)?.samples;
    if (Array.isArray(arr)) {
      const nums = arr.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0,
      );
      if (nums.length) out[key] = { samples: nums.slice(-LATENCY_WINDOW_SIZE) };
    }
  }
  return {
    version: 1,
    stats: out,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** Append one measured duration to a bucket, capped to the window. Pure. */
export function appendLatencySample(
  stats: LatencyStats,
  key: string,
  ms: number,
): LatencyStats {
  const prev = stats.stats[key]?.samples ?? [];
  const next = [...prev, Math.round(ms)].slice(-LATENCY_WINDOW_SIZE);
  return {
    version: 1,
    stats: { ...stats.stats, [key]: { samples: next } },
    updatedAt: Date.now(),
  };
}

export interface DurationRange {
  minMs: number;
  maxMs: number;
}

/** Interpolated quantile of a sorted array (0..1). */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * p25–p90 range of a bucket's samples, or null when the bucket is too sparse
 * to be trusted. The p90 upper bound keeps a single outlier from inflating
 * every estimate while still being honest about typical worst cases.
 */
export function latencyRange(
  stats: LatencyStats,
  key: string,
): DurationRange | null {
  const samples = stats.stats[key]?.samples;
  if (!samples || samples.length < LATENCY_MIN_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return { minMs: quantile(sorted, 0.25), maxMs: quantile(sorted, 0.9) };
}

/** Hardcoded seed ranges per tier until real samples accumulate. */
const SEED_TASK_RANGE: Record<ImageTier, DurationRange> = {
  quick: { minMs: 10_000, maxMs: 40_000 },
  premium: { minMs: 60_000, maxMs: 180_000 },
};
const SEED_DISPATCH: DurationRange = { minMs: 2_000, maxMs: 15_000 };

/**
 * Estimate the duration of ONE render task: fine bucket → coarse bucket →
 * hardcoded per-tier seed.
 */
export function estimateTaskRange(
  stats: LatencyStats,
  action: ImageActionId,
  tier: ImageTier,
  kind?: LatencyKind,
  refCount?: number,
): DurationRange {
  const fine =
    kind !== undefined && refCount !== undefined
      ? latencyRange(stats, latencyKey(action, tier, kind, refCount))
      : null;
  return (
    fine ??
    latencyRange(stats, latencyCoarseKey(action, tier)) ??
    SEED_TASK_RANGE[tier]
  );
}

/**
 * Estimate a whole job: dispatch delay + tasks executed in waves of
 * `concurrency` (mirrors the worker's task pool).
 */
export function estimateJobRange(
  stats: LatencyStats,
  action: ImageActionId,
  tier: ImageTier,
  taskCount: number,
  concurrency: number,
  kind?: LatencyKind,
  refCount?: number,
): DurationRange {
  const task = estimateTaskRange(stats, action, tier, kind, refCount);
  const dispatch = latencyRange(stats, DISPATCH_KEY) ?? SEED_DISPATCH;
  const waves = Math.max(1, Math.ceil(taskCount / Math.max(1, concurrency)));
  return {
    minMs: dispatch.minMs + task.minMs * waves,
    maxMs: dispatch.maxMs + task.maxMs * waves,
  };
}

/** Format a range compactly: "~15–40s", "~1–3 min", "~45s–2 min". */
export function formatDurationRange(range: DurationRange): string {
  const fmt = (ms: number): string => {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 90) return `${s}s`;
    const m = Math.round(s / 60);
    return `${m} min`;
  };
  const lo = fmt(range.minMs);
  const hi = fmt(range.maxMs);
  return lo === hi ? `~${hi}` : `~${lo}–${hi}`;
}
