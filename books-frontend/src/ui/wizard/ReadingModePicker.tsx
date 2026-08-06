import { motion } from "framer-motion";
import { BookOpenCheck, Ear, HandHelping, type LucideIcon } from "lucide-react";
import {
  READING_MODES,
  readingModeLabel,
  type ReadingModeId,
} from "../../core/config/ageWritingCatalog";
import type { AgeWritingConfig } from "../../core/config/ageWriting";
import { resolveAgeHumanGuidance } from "../../core/prompts/age";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

const MODE_ICONS: Record<ReadingModeId, LucideIcon> = {
  "read-aloud": Ear,
  "with-help": HandHelping,
  independent: BookOpenCheck,
};

const MODE_HINTS: Record<ReadingModeId, string> = {
  "read-aloud": "You read · they listen",
  "with-help": "Side by side",
  independent: "They read alone",
};

/** Segmented control + preview for 6–8 / 9–12 reading modes. */
export function ReadingModePicker({
  ageRangeId,
  value,
  onChange,
  ageWriting,
}: {
  ageRangeId: string;
  value: ReadingModeId;
  onChange: (mode: ReadingModeId) => void;
  ageWriting: AgeWritingConfig;
}) {
  const human = resolveAgeHumanGuidance(ageRangeId, value, ageWriting);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {READING_MODES.map((mode) => {
          const selected = value === mode.id;
          const Icon = MODE_ICONS[mode.id];
          return (
            <motion.button
              key={mode.id}
              type="button"
              onClick={() => onChange(mode.id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              transition={spring}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left ring-1 transition sm:flex-col sm:items-start sm:gap-2.5 sm:px-4 sm:py-4",
                selected
                  ? "bg-white shadow-soft ring-2 ring-brand-400"
                  : "bg-white/60 ring-ink-100/80 hover:bg-white hover:ring-brand-300",
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl transition",
                  selected
                    ? "bg-brand-500 text-(--color-brand-foreground) shadow-soft"
                    : "bg-ink-50 text-ink-500",
                )}
              >
                <Icon className="size-5" strokeWidth={1.85} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-900">{mode.shortLabel}</span>
                <span className="mt-0.5 block text-[11px] text-ink-400">
                  {MODE_HINTS[mode.id]}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <motion.div
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl bg-white/80 px-4 py-4 shadow-soft ring-1 ring-ink-100/70"
      >
        <p className="text-sm font-semibold text-ink-800">{readingModeLabel(value)}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{human}</p>
      </motion.div>
    </div>
  );
}
