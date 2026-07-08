"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Sparkles } from "lucide-react";
import type { ImageActionId } from "../../core/ai/actions";
import type { ImageTier } from "../../core/config/modelConfig";
import { DEFAULT_IMAGE_TIER } from "../../core/config/modelConfig";
import {
  estimateTaskRange,
  formatDurationRange,
  type DurationRange,
} from "../../core/config/latencyStats";
import { useAppConfigStore } from "../../state/appConfigStore";
import { usePreferredImageTier } from "../../state/imageTier";
import { Progress } from "../components/Progress";
import { cn } from "../lib/cn";

/** Honest, cosmetic phase captions per action (timed against the estimate). */
const PHASES: Partial<Record<ImageActionId, string[]>> = {
  pageIllustration: [
    "Composing the scene…",
    "Matching your characters to their references…",
    "Painting in your chosen style…",
    "Adding the final touches…",
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

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface GenerationOverlayProps {
  action: ImageActionId;
  /** Number of reference images involved — sharpens the time estimate. */
  refCount?: number;
  tier?: ImageTier;
  /** Compact mode for small thumbnails (hides captions/progress text). */
  compact?: boolean;
  className?: string;
}

/**
 * The unified, beautiful "this image is being made" surface. Fills its
 * container with a brand shimmer, a live elapsed / estimate readout (from the
 * rolling latency window), a progress bar that tracks the estimate then eases
 * into an indeterminate "polishing" tail, and rotating phase captions.
 */
export function GenerationOverlay({
  action,
  refCount = 0,
  tier,
  compact = false,
  className,
}: GenerationOverlayProps) {
  const latencyStats = useAppConfigStore((s) => s.latencyStats);
  const preferred = usePreferredImageTier();
  const effectiveTier = tier ?? preferred ?? DEFAULT_IMAGE_TIER;

  const estimate: DurationRange = useMemo(
    () => estimateTaskRange(latencyStats, action, effectiveTier, "fresh", refCount),
    [latencyStats, action, effectiveTier, refCount],
  );

  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - start;
  // Ease toward ~92% by the p90 estimate; hold indeterminate past it so we
  // never sit at a fake 100%.
  const frac = estimate.maxMs > 0 ? elapsed / estimate.maxMs : 0;
  const overdue = frac >= 1;
  const value = Math.min(0.92, frac * 0.92);

  const phases = PHASES[action] ?? DEFAULT_PHASES;
  const phaseIdx = overdue
    ? phases.length - 1
    : Math.min(phases.length - 1, Math.floor(frac * phases.length));

  return (
    <div
      className={cn(
        "shimmer absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center",
        className,
      )}
    >
      <motion.span
        className="flex size-11 items-center justify-center rounded-2xl bg-white/70 text-brand-500 shadow-soft backdrop-blur"
        animate={{ scale: [1, 1.08, 1], rotate: [0, 6, -6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Sparkles className="size-5" />
      </motion.span>

      {!compact && (
        <>
          <div className="h-4 overflow-hidden">
            <AnimatePresence mode="popLayout">
              <motion.p
                key={phaseIdx}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="text-xs font-medium text-ink-600"
              >
                {phases[phaseIdx]}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="w-full max-w-44">
            <Progress value={value} indeterminate={overdue} size="sm" />
          </div>

          <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
            <Clock className="size-3" />
            {formatElapsed(elapsed)}
            {!overdue ? (
              <span className="text-ink-300">· usually {formatDurationRange(estimate)}</span>
            ) : (
              <span className="text-ink-300">· almost done</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
