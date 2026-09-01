import { motion } from "framer-motion";
import {
  Baby,
  BookOpen,
  Check,
  Compass,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { AGE_RANGES } from "../../../core/config/options";
import {
  ageBandHasReadingModes,
  defaultAgeCardDescription,
  type ReadingModeId,
} from "../../../core/config/ageWritingCatalog";
import { ageBandLabel } from "../../../core/config/storyCraftCatalog";
import { resolveAgeHumanGuidance } from "../../../core/prompts/age";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";
import { fadeRise, spring } from "../../lib/motion";
import { ReadingModePicker } from "../ReadingModePicker";
import type { StepProps } from "./types";

type AgeVisual = {
  icon: LucideIcon;
  /** Soft wash behind the icon — keeps each band visually distinct. */
  wash: string;
  iconTone: string;
  /** Tiny mood line under the age label. */
  mood: string;
};

const AGE_VISUALS: Record<string, AgeVisual> = {
  "0-2": {
    icon: Baby,
    wash: "from-rose-100 via-amber-50 to-orange-50",
    iconTone: "bg-white/80 text-rose-500",
    mood: "Board-book cozy",
  },
  "3-5": {
    icon: Sparkles,
    wash: "from-sky-100 via-brand-50 to-amber-50",
    iconTone: "bg-white/80 text-sky-600",
    mood: "Playful & pictured",
  },
  "6-8": {
    icon: BookOpen,
    wash: "from-emerald-100 via-teal-50 to-sky-50",
    iconTone: "bg-white/80 text-emerald-600",
    mood: "Early reader",
  },
  "9-12": {
    icon: Compass,
    wash: "from-accent-100 via-brand-50 to-sky-50",
    iconTone: "bg-white/80 text-accent-700",
    mood: "Chapter adventures",
  },
};

/**
 * "Who is it for?" — age range plus the reading-mode sub-question that only
 * applies to the older bands. Physical size & format now live in the Design
 * step (they don't affect anchors, screenplay pacing, or this question), so
 * this step stays focused on reading level.
 */
export function AudienceStep({ config, update }: StepProps) {
  const ageWriting = useAppConfigStore((s) => s.ageWriting);

  const showReadingModes = ageBandHasReadingModes(config.ageRangeId);
  const readingMode = (config.readingModeId ?? "read-aloud") as ReadingModeId;

  const hasStory = config.storyText.trim().length > 0;
  const originAge = config.storyBrief?.generatedForAge ?? (hasStory ? "0-2" : undefined);
  const ageChanged = hasStory && Boolean(originAge) && originAge !== config.ageRangeId;

  const selectAge = (ageId: string) => {
    if (ageBandHasReadingModes(ageId)) {
      update({
        ageRangeId: ageId,
        readingModeId: config.readingModeId ?? "read-aloud",
      });
    } else {
      update({ ageRangeId: ageId, readingModeId: null });
    }
  };

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-6">
      {/* Informative notice when changing audience for an existing story */}
      {hasStory && ageChanged && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200/80 bg-linear-to-r from-amber-50/90 via-amber-50/50 to-white p-3 text-xs text-amber-900 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base select-none shrink-0">✨</span>
            <div className="min-w-0">
              <span className="font-semibold">
                Audience changed to {ageBandLabel(config.ageRangeId)}
              </span>
              <p className="text-[11px] text-amber-700/90 truncate">
                Originally written for {ageBandLabel(originAge!)}. You can adapt it in the Story step.
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-[10px] text-amber-800">
            Adapt next ➔
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {AGE_RANGES.map((age, i) => {
          const selected = config.ageRangeId === age.id;
          const visual = AGE_VISUALS[age.id] ?? AGE_VISUALS["3-5"]!;
          const Icon = visual.icon;
          const description =
            ageBandHasReadingModes(age.id) && selected
              ? resolveAgeHumanGuidance(age.id, readingMode, ageWriting)
              : resolveAgeHumanGuidance(age.id, null, ageWriting) ||
                defaultAgeCardDescription(age);

          return (
            <motion.button
              key={age.id}
              type="button"
              onClick={() => selectAge(age.id)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: i * 0.04 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.99 }}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-3xl text-left shadow-soft ring-1 transition",
                selected
                  ? "bg-white ring-2 ring-brand-400"
                  : "bg-white/80 ring-ink-100 hover:ring-brand-300 hover:shadow-lifted",
              )}
            >
              <div
                className={cn(
                  "relative flex h-24 items-center justify-center bg-linear-to-br",
                  visual.wash,
                )}
              >
                <span
                  className={cn(
                    "flex size-14 items-center justify-center rounded-2xl shadow-soft ring-1 ring-white/60 transition",
                    visual.iconTone,
                    selected && "scale-105",
                  )}
                >
                  <Icon className="size-7" strokeWidth={1.75} />
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
                  <h3 className="font-display text-lg font-bold tracking-tight text-ink-900">
                    {age.label}
                  </h3>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    {visual.mood}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-ink-500">{description}</p>
              </div>
            </motion.button>
          );
        })}
      </div>

      {showReadingModes && (
        <motion.section
          key={config.ageRangeId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="rounded-3xl bg-aurora p-5 shadow-soft ring-1 ring-ink-100/80 sm:p-6"
        >
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
              Reading style
            </p>
            <h3 className="mt-1 font-display text-xl font-bold tracking-tight text-ink-900">
              How will this book be read?
            </h3>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-500">
              We tune wording and pacing for who&apos;s holding the book — so it feels right for
              bedtime, learning to read, or solo adventures.
            </p>
          </div>
          <ReadingModePicker
            ageRangeId={config.ageRangeId}
            value={readingMode}
            onChange={(mode) => update({ readingModeId: mode })}
            ageWriting={ageWriting}
          />
        </motion.section>
      )}
    </motion.div>
  );
}
