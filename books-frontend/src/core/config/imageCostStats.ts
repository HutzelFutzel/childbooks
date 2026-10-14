/**
 * A rolling window of recent per-call image costs, kept in the world-readable
 * `appConfig/imageCostStats` document. It is the input to every Spark price:
 * the studio and the server run the same estimator over it
 * (`core/billing/priceEstimation`), so a quote shown in the studio is the
 * number the wallet charges.
 *
 * Each group keeps the last {@link COST_SAMPLE_CAPACITY} measured USD costs.
 * A sample carries when it was measured, an opaque tag of the book it came
 * from (so one book can't fill a window) and the model's per-image rate at the
 * time (so a rate-table change reprices old samples instead of waiting for them
 * to age out). No per-user data is stored.
 *
 * Windows are keyed by the exact model, quality, fidelity, format, render kind,
 * output size, reference bucket, and billable image-call bucket.
 */
import type { ImageActionId } from "../ai/actions";
import {
  costProfileKey,
  type GenerationEstimateProfile,
  type GenerationRenderKind,
} from "./generationEstimateProfile";
import type { ImageTier } from "./modelConfig";
import { COST_BASES, COST_SAMPLE_CAPACITY, type CostBasis } from "./priceEstimation";

export { COST_SAMPLE_CAPACITY };

/** Most groups the document keeps; the ones idle longest are dropped first. */
const MAX_GROUPS = 300;

export interface CostSample {
  /** Billable provider cost of one render, USD. */
  usd: number;
  /** When it was measured (ms). 0 for samples migrated from the old format. */
  at: number;
  /** Opaque tag of the book it came from. */
  project?: string;
  /** The model's nominal per-image rate (USD) when it was measured. */
  rate?: number;
  /**
   * What `usd` covers (see `CostBasis`). Absent on samples recorded before the
   * basis existed; those count under either basis until they age out.
   */
  basis?: CostBasis;
}

/** One group's recent measured call costs, oldest first. */
export interface CostSamples {
  samples: CostSample[];
  /** Denormalized for diagnostics; the profile key already includes it. */
  modelKey?: string;
}

export interface ImageCostStats {
  version: 3;
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

/** The profile fields a cost key is made of, in key order. */
export const COST_KEY_FIELDS = [
  "modelKey",
  "renderKind",
  "quality",
  "inputFidelity",
  "outputFormat",
  "outputCompression",
  "outputSize",
  "referenceCount",
  "billableImages",
  "referenceEncoding",
] as const;
export type CostKeyField = (typeof COST_KEY_FIELDS)[number];

export interface ParsedCostKey {
  action: string;
  tier: string;
  fields: Record<CostKeyField, string>;
}

/** Split a {@link costStatsKey} back into its parts (null for foreign keys). */
export function parseCostStatsKey(key: string): ParsedCostKey | null {
  const m = /^v2:([^:]+):([^:]+):p1-(.*)$/.exec(key);
  if (!m) return null;
  const parts = m[3].split("~").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts.length !== COST_KEY_FIELDS.length) return null;
  const fields = {} as Record<CostKeyField, string>;
  COST_KEY_FIELDS.forEach((f, i) => {
    fields[f] = parts[i];
  });
  return { action: m[1], tier: m[2], fields };
}

/** The same parts, read off a profile (for matching a quote against the window). */
export function profileKeyFields(profile: GenerationEstimateProfile): Record<CostKeyField, string> {
  return {
    modelKey: profile.modelKey,
    renderKind: profile.renderKind,
    quality: String(profile.quality),
    inputFidelity: String(profile.inputFidelity),
    outputFormat: String(profile.outputFormat),
    outputCompression: String(profile.outputCompression ?? "default"),
    outputSize: profile.outputSize,
    referenceCount: profile.referenceCount,
    billableImages: profile.billableImages,
    referenceEncoding: profile.referenceEncoding,
  };
}

export function createDefaultImageCostStats(): ImageCostStats {
  return { version: 3, stats: {}, updatedAt: 0 };
}

function normalizeSample(raw: unknown, legacyAt: number): CostSample | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? { usd: raw, at: legacyAt } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<CostSample>;
  if (typeof s.usd !== "number" || !Number.isFinite(s.usd) || s.usd < 0) return null;
  return {
    usd: s.usd,
    at: typeof s.at === "number" && Number.isFinite(s.at) ? s.at : legacyAt,
    ...(typeof s.project === "string" && s.project ? { project: s.project } : {}),
    ...(typeof s.rate === "number" && s.rate > 0 ? { rate: s.rate } : {}),
    ...((COST_BASES as readonly string[]).includes(s.basis as string) ? { basis: s.basis } : {}),
  };
}

/** Whether a sample measures what a quote under `basis` prices. */
export function sampleMatchesBasis(sample: CostSample, basis: CostBasis): boolean {
  return !sample.basis || sample.basis === basis;
}

/**
 * Coerce an arbitrary Firestore payload into a valid stats doc. Version 2 docs
 * (bare USD numbers) are carried over with the document's timestamp.
 */
export function normalizeImageCostStats(input: unknown): ImageCostStats {
  const raw = (input ?? {}) as { version?: number; stats?: unknown; updatedAt?: unknown };
  if (raw.version !== 2 && raw.version !== 3) return createDefaultImageCostStats();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : 0;
  const out: Record<string, CostSamples> = {};
  const stats = (raw.stats ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(stats)) {
    const entry = value as { samples?: unknown; modelKey?: unknown } | undefined;
    if (!Array.isArray(entry?.samples)) continue;
    const samples = entry.samples
      .map((s) => normalizeSample(s, updatedAt))
      .filter((s): s is CostSample => s !== null)
      .slice(-COST_SAMPLE_CAPACITY);
    if (samples.length === 0) continue;
    out[key] = {
      samples,
      ...(typeof entry.modelKey === "string" && entry.modelKey ? { modelKey: entry.modelKey } : {}),
    };
  }
  return { version: 3, stats: out, updatedAt };
}

/** The recent cost samples for one exact action+tier+profile (oldest first). */
export function recentCostSamples(
  stats: ImageCostStats,
  action: ImageActionId,
  tier: ImageTier,
  profile: GenerationEstimateProfile,
): CostSample[] {
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
  meta: { at?: number; project?: string; rate?: number | null; basis?: CostBasis } = {},
): ImageCostStats {
  const key = costStatsKey(action, tier, profile);
  const at = meta.at ?? Date.now();
  const sample: CostSample = {
    usd: costUsd,
    at,
    ...(meta.project ? { project: meta.project } : {}),
    ...(typeof meta.rate === "number" && meta.rate > 0 ? { rate: meta.rate } : {}),
    ...(meta.basis ? { basis: meta.basis } : {}),
  };
  const prev = stats.stats[key]?.samples ?? [];
  const next: Record<string, CostSamples> = {
    ...stats.stats,
    [key]: { samples: [...prev, sample].slice(-COST_SAMPLE_CAPACITY), modelKey: profile.modelKey },
  };
  const keys = Object.keys(next);
  if (keys.length > MAX_GROUPS) {
    const newest = (k: string) => next[k].samples[next[k].samples.length - 1]?.at ?? 0;
    keys
      .sort((a, b) => newest(a) - newest(b))
      .slice(0, keys.length - MAX_GROUPS)
      .forEach((k) => {
        if (k !== key) delete next[k];
      });
  }
  return { version: 3, stats: next, updatedAt: at };
}
