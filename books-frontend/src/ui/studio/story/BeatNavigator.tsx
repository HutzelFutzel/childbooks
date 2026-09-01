"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import type { StoryBeatItem } from "../../../core/story/beats";
import { beatWordCount, defaultBeatLabel } from "../../../core/story/beats";
import { spring } from "../../lib/motion";
import { cn } from "../../lib/cn";

export interface BeatNavigatorProps {
  beats: StoryBeatItem[];
  activeIndex: number;
  onSelectBeat: (index: number) => void;
  onAddBeat: () => void;
  className?: string;
}

/**
 * High-precision horizontal tab bar for navigating through story beats.
 * Features:
 * - Fluid sliding active indicator via Framer Motion layoutId.
 * - Smooth auto-centering on active tab changes.
 * - Perfect vertical & horizontal alignment with edge breathing room.
 */
export function BeatNavigator({
  beats,
  activeIndex,
  onSelectBeat,
  onAddBeat,
  className,
}: BeatNavigatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activePillRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active pill into view, centered within the bar
  useEffect(() => {
    const container = containerRef.current;
    const pill = activePillRef.current;
    if (container && pill) {
      const pillCenter = pill.offsetLeft + pill.offsetWidth / 2;
      const containerCenter = container.clientWidth / 2;
      const targetLeft = Math.max(0, pillCenter - containerCenter);

      container.scrollTo({
        left: targetLeft,
        behavior: "smooth",
      });
    }
  }, [activeIndex]);

  if (beats.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Story beats navigation"
      className={cn(
        "shrink-0 border-b border-ink-100/80 bg-linear-to-b from-white/95 to-ink-50/50 px-3 py-2 backdrop-blur-xs sm:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {/* Left fixed indicator badge */}
        <div className="flex shrink-0 items-center gap-1.5 pr-2 mr-0.5 border-r border-ink-200/70 select-none">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
            Beats
          </span>
          <span className="flex size-4 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-600 tabular-nums">
            {beats.length}
          </span>
        </div>

        {/* Scrollable tabs track */}
        <div
          ref={containerRef}
          role="tablist"
          aria-label="Story beats tabs"
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5 px-0.5"
        >
          {beats.map((beat, index) => {
            const isActive = index === activeIndex;
            const label = beat.title.trim() || defaultBeatLabel(index);
            const words = beatWordCount(beat);

            return (
              <button
                key={beat.id}
                ref={isActive ? activePillRef : null}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Jump to ${label} (${words} words)`}
                onClick={() => onSelectBeat(index)}
                className={cn(
                  "group relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors duration-150 select-none",
                  isActive
                    ? "text-white font-semibold shadow-2xs"
                    : "bg-white/80 text-ink-600 ring-1 ring-ink-200/70 hover:bg-white hover:text-ink-900 hover:ring-ink-300",
                )}
              >
                {/* Active fluid pill background */}
                {isActive && (
                  <motion.div
                    layoutId="activeBeatTab"
                    transition={spring}
                    className="absolute inset-0 rounded-full bg-brand-600 shadow-2xs ring-1 ring-brand-700/50"
                  />
                )}

                <span
                  className={cn(
                    "relative z-10 flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums transition-colors",
                    isActive
                      ? "bg-brand-500 text-white"
                      : "bg-ink-100 text-ink-500 group-hover:bg-brand-100 group-hover:text-brand-700",
                  )}
                >
                  {index + 1}
                </span>

                <span className="relative z-10 max-w-28 truncate sm:max-w-44 text-left font-medium">
                  {label}
                </span>

                {words > 0 && (
                  <span
                    className={cn(
                      "relative z-10 text-[10px] tabular-nums transition-colors",
                      isActive ? "text-brand-100" : "text-ink-400 font-mono",
                    )}
                  >
                    {words}w
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={onAddBeat}
            title="Add a new beat"
            aria-label="Add a new beat"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-ink-200 bg-white/70 px-2.5 py-1 text-xs font-medium text-ink-500 transition hover:border-brand-400 hover:bg-brand-50/60 hover:text-brand-700 active:scale-95"
          >
            <Plus className="size-3 text-ink-400 group-hover:text-brand-600" />
            <span className="hidden xs:inline text-[11px]">Add beat</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
