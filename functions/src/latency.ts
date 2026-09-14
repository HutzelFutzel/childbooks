/**
 * Task-level latency telemetry helpers, shared by the job worker and the sync
 * `/ai/*` endpoints. Each finished render appends its measured duration to a
 * exact generation-profile bucket in `appConfig/latencyStats`, which powers
 * the client's "usually 20–45s" estimates without cross-quality mixing.
 */
import { recordLatencySamples } from "./appConfig";
import {
  latencyKey,
} from "../../books-frontend/src/core/config/latencyStats";
import {
  generationRenderKindOf,
  type GenerationEstimateProfile,
  type GenerationRenderKind,
} from "../../books-frontend/src/core/config/generationEstimateProfile";
import type { ImageActionId } from "../../books-frontend/src/core/ai/actions";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";

/** How a render came about, for latency bucketing. */
export function latencyKindOf(options?: {
  restyle?: boolean;
  useReference?: boolean;
  edit?: string;
  mask?: unknown;
}): GenerationRenderKind {
  return generationRenderKindOf(options);
}

/** Best-effort: append one task's duration to its exact profile bucket. */
export async function recordTaskLatency(
  action: ImageActionId,
  tier: ImageTier,
  profile: GenerationEstimateProfile,
  refCount: number,
  ms: number,
): Promise<void> {
  try {
    await recordLatencySamples([{ key: latencyKey(action, tier, profile, refCount), ms }]);
  } catch {
    // Telemetry never breaks generation.
  }
}
