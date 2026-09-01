"use client";

import { motion } from "framer-motion";
import { Check, PenLine, Users, Wand2, type LucideIcon } from "lucide-react";
import { STORY_MODES, type StoryMode } from "../../../core/config/storyCraftCatalog";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/motion";

const MODE_VISUALS: Record<
  StoryMode,
  {
    icon: LucideIcon;
    wash: string;
    tone: string;
    badge: string;
  }
> = {
  guided: {
    icon: Wand2,
    wash: "from-magic-100/70 via-brand-50/60 to-amber-50/50",
    tone: "bg-white text-magic-600 shadow-soft ring-1 ring-magic-200/60",
    badge: "bg-magic-50 text-magic-700 ring-magic-200/80",
  },
  "co-write": {
    icon: Users,
    wash: "from-sky-100/70 via-brand-50/60 to-emerald-50/50",
    tone: "bg-white text-sky-600 shadow-soft ring-1 ring-sky-200/60",
    badge: "bg-sky-50 text-sky-700 ring-sky-200/80",
  },
  own: {
    icon: PenLine,
    wash: "from-ink-100/60 via-ink-50/50 to-white",
    tone: "bg-white text-ink-700 shadow-soft ring-1 ring-ink-200/60",
    badge: "bg-ink-100/80 text-ink-700 ring-ink-200/80",
  },
};

/**
 * How the story gets written. Shown as full cards while the choice is still
 * open, and as a compact pill row once there's a story to protect — switching
 * mode mid-flight shouldn't dominate the screen.
 */
export function StoryModePicker({
  value,
  onChange,
  compact,
}: {
  value: StoryMode;
  onChange: (mode: StoryMode) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="How to write the story">
        {STORY_MODES.map((mode) => {
          const Icon = MODE_VISUALS[mode.id].icon;
          const active = mode.id === value;
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(mode.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                active
                  ? "bg-brand-600 text-(--color-brand-foreground) shadow-soft"
                  : "bg-white/80 text-ink-600 ring-1 ring-ink-200 hover:ring-brand-300",
              )}
            >
              <Icon className="size-3.5" />
              {mode.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {STORY_MODES.map((mode, i) => {
        const visual = MODE_VISUALS[mode.id];
        const Icon = visual.icon;
        const selected = mode.id === value;
        return (
          <motion.button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.06 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.99 }}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-3xl text-left shadow-soft ring-1 transition-all duration-200",
              selected
                ? "bg-white ring-2 ring-brand-500 shadow-lifted"
                : "bg-white/90 ring-ink-100 hover:bg-white hover:shadow-lifted hover:ring-brand-300",
            )}
          >
            {/* Header banner with icon and checkmark */}
            <div
              className={cn(
                "relative flex h-20 items-center justify-between px-4 sm:px-5 bg-linear-to-br border-b border-ink-100/40",
                visual.wash,
              )}
            >
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-2xl transition duration-200",
                  visual.tone,
                  selected && "scale-105 ring-2 ring-brand-400",
                )}
              >
                <Icon className="size-5.5" strokeWidth={1.85} />
              </span>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border transition-all duration-200",
                  selected
                    ? "border-brand-500 bg-brand-500 text-white shadow-2xs"
                    : "border-ink-200/90 bg-white/80 text-transparent group-hover:border-ink-300",
                )}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </div>

            {/* Card Content */}
            <div className="flex flex-1 flex-col p-4 sm:p-5">
              <div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
                    visual.badge,
                  )}
                >
                  {mode.tagline}
                </span>
              </div>
              <h3 className="mt-2.5 font-display text-base sm:text-lg font-bold tracking-tight text-ink-900 leading-snug">
                {mode.label}
              </h3>
              <p className="mt-1.5 text-xs sm:text-[13px] leading-relaxed text-ink-500">
                {mode.description}
              </p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
