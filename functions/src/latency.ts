/**
 * Task-level latency telemetry helpers, shared by the job worker and the sync
 * `/ai/*` endpoints. Each finished render appends its measured duration to a
 * fine bucket (`action:tier:kind:refBucket`) and the coarse `action:tier`
 * fallback bucket in `appConfig/latencyStats`, which powers the client's
 * "usually 20–45s" estimates.
 */
import { recordLatencySamples } from "./appConfig";
import {
  latencyCoarseKey,
  latencyKey,
  type LatencyKind,
} from "../../books-frontend/src/core/config/latencyStats";
import type { ImageActionId } from "../../books-frontend/src/core/ai/actions";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";

/** How a render came about, for latency bucketing. */
export function latencyKindOf(options?: { useReference?: boolean; edit?: string }): LatencyKind {
  if (options?.edit?.trim()) return "edit";
  return options?.useReference ? "refresh" : "fresh";
}

/** Best-effort: append one task's duration to its fine + coarse buckets. */
export async function recordTaskLatency(
  action: ImageActionId,
  tier: ImageTier,
  kind: LatencyKind,
  refCount: number,
  ms: number,
): Promise<void> {
  try {
    await recordLatencySamples([
      { key: latencyKey(action, tier, kind, refCount), ms },
      { key: latencyCoarseKey(action, tier), ms },
    ]);
  } catch {
    // Telemetry never breaks generation.
  }
}
