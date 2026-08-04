/**
 * Shared live estimate + phase progress for in-flight image generation.
 * Used by GenerationOverlay (HTML) and KonvaArtBusyVeil (in-canvas).
 */
import { useEffect, useMemo, useState } from "react";
import type { ImageActionId } from "../../core/ai/actions";
import { IMAGE_TIERS, type ImageTier } from "../../core/config/modelConfig";
import {
  estimateTaskRange,
  formatDurationRange,
  type DurationRange,
} from "../../core/config/latencyStats";
import { useAppConfigStore } from "../../state/appConfigStore";
import { usePreferredImageTier } from "../../state/imageTier";

const PHASES: Partial<Record<ImageActionId, string[]>> = {
  pageIllustration: [
    "Composing the scene…",
    "Matching your characters…",
    "Painting in your style…",
    "Adding final touches…",
  ],
  coverIllustration: [
    "Composing the cover…",
    "Matching your characters…",
    "Painting in your style…",
    "Final touches…",
  ],
  anchorImage: ["Designing the reference…", "Locking in the look…", "Polishing details…"],
};

const DEFAULT_PHASES = ["Warming up…", "Generating…", "Almost there…"];

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function useGenerationProgress(
  action: ImageActionId,
  refCount = 0,
  tier?: ImageTier,
) {
  const latencyStats = useAppConfigStore((s) => s.latencyStats);
  const preferred = usePreferredImageTier();
  const effectiveTier = tier ?? preferred;

  const estimate: DurationRange = useMemo(() => {
    const tiers = effectiveTier ? [effectiveTier] : IMAGE_TIERS;
    const ranges = tiers.map((t) => estimateTaskRange(latencyStats, action, t, "fresh", refCount));
    return {
      minMs: Math.min(...ranges.map((r) => r.minMs)),
      maxMs: Math.max(...ranges.map((r) => r.maxMs)),
    };
  }, [latencyStats, action, effectiveTier, refCount]);

  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // HTML overlay only — keep this modest so we don't thrash React.
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - start;
  const frac = estimate.maxMs > 0 ? elapsed / estimate.maxMs : 0;
  const overdue = frac >= 1;
  const progress = Math.min(0.92, frac * 0.92);

  const phases = PHASES[action] ?? DEFAULT_PHASES;
  const phaseIdx = overdue
    ? phases.length - 1
    : Math.min(phases.length - 1, Math.floor(frac * phases.length));

  return {
    estimate,
    estimateLabel: formatDurationRange(estimate),
    elapsed,
    elapsedLabel: formatElapsed(elapsed),
    overdue,
    progress,
    phase: phases[phaseIdx] ?? "Generating…",
    phaseIdx,
    /** Wall clock used for animation sync (updates ~5×/s). */
    now,
  };
}
