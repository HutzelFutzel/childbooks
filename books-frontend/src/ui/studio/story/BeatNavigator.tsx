"use client";

import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import type { StoryBeatItem } from "../../../core/story/beats";
import { beatWordCount, defaultBeatLabel } from "../../../core/story/beats";
import { cn } from "../../lib/cn";

export interface BeatNavigatorProps {
  beats: StoryBeatItem[];
  activeIndex: number;
  onSelectBeat: (index: number) => void;
  onAddBeat: () => void;
  className?: string;
}

/**
 * Low-profile horizontal navigator for navigating through story beats.
 * Automatically hidden when there is 0 or 1 beat to conserve screen space.
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

  // Auto-scroll the active pill into view within the navigator bar
  useEffect(() => {
    if (activePillRef.current && containerRef.current) {
      const container = containerRef.current;
      const pill = activePillRef.current;
      const pillLeft = pill.offsetLeft;
      const pillRight = pillLeft + pill.offsetWidth;
      const containerLeft = container.scrollLeft;
      const containerRight = containerLeft + container.clientWidth;

      if (pillLeft < containerLeft) {
        container.scrollTo({ left: pillLeft - 16, behavior: "smooth" });
      } else if (pillRight > containerRight) {
        container.scrollTo({
          left: pillRight - container.clientWidth + 16,
          behavior: "smooth",
        });
      }
    }
  }, [activeIndex]);

  if (beats.length < 2) {
    return null;
  }

  return (
    <div
      className={cn(
        "shrink-0 border-b border-ink-100/70 bg-ink-50/40 px-3 py-1.5 backdrop-blur-xs sm:px-6",
        className,
      )}
    >
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Story beats navigator"
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth"
      >
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-ink-400 pl-1 pr-1 select-none">
          Beats
        </span>

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
                "group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-all duration-150 select-none",
                isActive
                  ? "bg-brand-600 text-white font-semibold shadow-2xs ring-1 ring-brand-700/50"
                  : "bg-white/80 text-ink-600 ring-1 ring-ink-200/70 hover:bg-white hover:text-ink-900 hover:ring-ink-300",
              )}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
                  isActive
                    ? "bg-brand-500 text-white"
                    : "bg-ink-100 text-ink-500 group-hover:bg-brand-100 group-hover:text-brand-700",
                )}
              >
                {index + 1}
              </span>

              <span className="max-w-32 truncate sm:max-w-44 text-left font-medium">
                {label}
              </span>

              {words > 0 && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
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
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-ink-200 bg-white/60 px-2.5 py-1 text-xs font-medium text-ink-500 transition hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700"
        >
          <Plus className="size-3 text-ink-400 group-hover:text-brand-600" />
          <span className="hidden xs:inline text-[11px]">Add beat</span>
        </button>
      </div>
    </div>
  );
}
