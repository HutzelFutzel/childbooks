"use client";

import { motion } from "framer-motion";
import { Check, PenLine, Users, Wand2, type LucideIcon } from "lucide-react";
import { STORY_MODES, type StoryMode } from "../../../core/config/storyCraftCatalog";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/motion";

const MODE_VISUALS: Record<StoryMode, { icon: LucideIcon; wash: string; tone: string }> = {
  guided: {
    icon: Wand2,
    wash: "from-magic-100 via-brand-50 to-amber-50",
    tone: "bg-white/80 text-magic-600",
  },
  "co-write": {
    icon: Users,
    wash: "from-sky-100 via-brand-50 to-emerald-50",
    tone: "bg-white/80 text-sky-600",
  },
  own: {
    icon: PenLine,
    wash: "from-ink-100 via-ink-50 to-white",
    tone: "bg-white/80 text-ink-600",
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {STORY_MODES.map((mode, i) => {
        const visual = MODE_VISUALS[mode.id];
        const Icon = visual.icon;
        const selected = mode.id === value;
        return (
          <motion.button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.99 }}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-3xl text-left shadow-soft ring-1 transition",
              selected
                ? "bg-white ring-2 ring-brand-400"
                : "bg-white/80 ring-ink-100 hover:shadow-lifted hover:ring-brand-300",
            )}
          >
            <div
              className={cn(
                "relative flex h-20 items-center justify-center bg-linear-to-br",
                visual.wash,
              )}
            >
              <span
                className={cn(
                  "flex size-12 items-center justify-center rounded-2xl shadow-soft ring-1 ring-white/60 transition",
                  visual.tone,
                  selected && "scale-105",
                )}
              >
                <Icon className="size-6" strokeWidth={1.75} />
              </span>
              <span
                className={cn(
                  "absolute right-3 top-3 flex size-6 items-center justify-center rounded-full border transition",
                  selected
                    ? "border-brand-500 bg-brand-500 text-(--color-brand-foreground)"
                    : "border-ink-200/80 bg-white/70 text-transparent",
                )}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4 pt-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-base font-bold tracking-tight text-ink-900">
                  {mode.label}
                </h3>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                  {mode.tagline}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-ink-500">{mode.description}</p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
