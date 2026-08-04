"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clock, Sparkles } from "lucide-react";
import type { ImageActionId } from "../../core/ai/actions";
import type { ImageTier } from "../../core/config/modelConfig";
import { Progress } from "../components/Progress";
import { cn } from "../lib/cn";
import { useGenerationProgress } from "./useGenerationProgress";

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
  const { estimateLabel, elapsedLabel, overdue, progress, phase, phaseIdx } =
    useGenerationProgress(action, refCount, tier);

  return (
    <div
      className={cn(
        // Never steal clicks — generation must not block editing the rest of the page.
        "pointer-events-none shimmer absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center",
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
                {phase}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="w-full max-w-44">
            <Progress value={progress} indeterminate={overdue} size="sm" />
          </div>

          <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
            <Clock className="size-3" />
            {elapsedLabel}
            {!overdue ? (
              <span className="text-ink-300">· usually {estimateLabel}</span>
            ) : (
              <span className="text-ink-300">· almost done</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
