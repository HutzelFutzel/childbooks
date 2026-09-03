"use client";

import { motion } from "framer-motion";
import { PenLine, Users, Wand2, type LucideIcon } from "lucide-react";
import { STORY_MODES, type StoryMode } from "../../../core/config/storyCraftCatalog";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/motion";

const MODE_VISUALS: Record<
  StoryMode,
  {
    icon: LucideIcon;
    tone: string;
  }
> = {
  guided: {
    icon: Wand2,
    tone: "bg-ink-50 text-ink-700 ring-ink-200",
  },
  "co-write": {
    icon: Users,
    tone: "bg-ink-50 text-ink-700 ring-ink-200",
  },
  own: {
    icon: PenLine,
    tone: "bg-ink-100 text-ink-700 ring-ink-200",
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
  allowedModes,
}: {
  value?: StoryMode | null;
  onChange: (mode: StoryMode) => void;
  compact?: boolean;
  allowedModes?: StoryMode[];
}) {
  const modes = allowedModes
    ? STORY_MODES.filter((mode) => allowedModes.includes(mode.id))
    : STORY_MODES;

  if (compact) {
    return (
      <div
        className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-ink-100/70 p-1"
        role="radiogroup"
        aria-label="Story creation method"
      >
        {modes.map((mode) => {
          const Icon = MODE_VISUALS[mode.id].icon;
          const active = mode.id === value;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(mode.id)}
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                active
                  ? "bg-white text-ink-900 shadow-2xs"
                  : "text-ink-600 hover:bg-white/60 hover:text-ink-900",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {mode.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="radiogroup"
      aria-label="Story creation method"
    >
      {modes.map((mode, i) => {
        const visual = MODE_VISUALS[mode.id];
        const Icon = visual.icon;
        const selected = mode.id === value;
        return (
          <motion.button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(mode.id)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.04 }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            className={cn(
              "flex min-h-40 flex-col rounded-xl border bg-white p-5 text-left transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
              selected
                ? "border-brand-500 shadow-soft"
                : "border-ink-200 hover:border-ink-300 hover:shadow-2xs",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-xl ring-1",
                visual.tone,
              )}
            >
              <Icon aria-hidden className="size-5" />
            </span>
            <h3 className="mt-4 font-display text-base font-bold text-ink-900">
              {mode.label}
            </h3>
            <p className="mt-1 text-xs font-semibold text-ink-500">{mode.tagline}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              {mode.description}
            </p>
          </motion.button>
        );
      })}
    </div>
  );
}
