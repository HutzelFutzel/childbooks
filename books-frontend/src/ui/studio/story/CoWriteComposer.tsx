"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  RotateCcw,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import type { AgeBandStoryCraft } from "../../../core/config/storyCraftCatalog";
import type { StoryBrief } from "../../../core/types";
import { briefBlockers, isBriefReady } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input, Textarea } from "../../components/Input";
import { useResolvedModels } from "../../hooks/useResolvedModels";
import { cn } from "../../lib/cn";
import { fadeRise } from "../../lib/motion";
import { CastEditor } from "./CastEditor";
import { OptionChips } from "./OptionChips";
import type { UseStoryDraft } from "./useStoryDraft";
import type { StoryHistoryOptions } from "./storyUndo";

const CO_WRITE_STEPS = [
  { id: "cast", label: "The Cast", subtitle: "Heroes & family", icon: Users },
  { id: "plot", label: "The Moment", subtitle: "What happens", icon: BookOpen },
  { id: "style", label: "Story Style", subtitle: "Tone & rhythm", icon: Sparkles },
] as const;

/**
 * "Write it together": the reader supplies the facts — who, what, when, where —
 * and the model supplies the storytelling.
 * Optimized with space-awareness for sidebars and responsive viewports.
 */
export function CoWriteComposer({
  brief,
  craft,
  hasStory,
  onChange,
  draft,
}: {
  brief: StoryBrief;
  craft: AgeBandStoryCraft;
  hasStory: boolean;
  onChange: (patch: Partial<StoryBrief>, options?: StoryHistoryOptions) => void;
  draft: Pick<UseStoryDraft, "writing" | "write">;
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const models = useResolvedModels();
  const { writing, write } = draft;

  const ready = isBriefReady(brief);
  const blockers = briefBlockers(brief);
  const canWrite = Boolean(ready && models && !writing);

  const castMembers = brief.cast ?? [];
  const hasCast = castMembers.some((m) => m.name.trim().length > 0);
  const hasOccasion = Boolean(brief.occasion?.trim());

  const isStepDone = (index: number) => {
    if (index === 0) return hasCast;
    if (index === 1) return hasOccasion;
    return Boolean(brief.themeId || brief.deviceId || brief.customTheme || brief.customDevice);
  };

  const activeStep = CO_WRITE_STEPS[currentStepIndex] ?? CO_WRITE_STEPS[0];

  return (
    <section className="space-y-3">
      {/* Header & Sub-step Stepper Card */}
      <div className="overflow-hidden rounded-2xl bg-aurora p-3 shadow-2xs ring-1 ring-sky-200/50">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-soft">
            <Users className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
                Write it together
              </span>
              <span className="rounded-full bg-sky-100/80 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                Step {currentStepIndex + 1} of {CO_WRITE_STEPS.length}
              </span>
            </div>
            <h2 className="truncate font-display text-sm font-bold tracking-tight text-ink-900">
              {activeStep.label} — {activeStep.subtitle}
            </h2>
          </div>
        </div>

        {/* 3-Step Pill Bar */}
        <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl bg-white/70 p-1 shadow-2xs ring-1 ring-ink-100">
          {CO_WRITE_STEPS.map((step, i) => {
            const selected = i === currentStepIndex;
            const done = isStepDone(i);

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setCurrentStepIndex(i)}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-lg py-1 text-xs font-semibold transition",
                  selected
                    ? "bg-white text-sky-800 shadow-2xs ring-1 ring-sky-200"
                    : "text-ink-500 hover:bg-white/50 hover:text-ink-800"
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                    done && !selected
                      ? "bg-emerald-500 text-white"
                      : selected
                      ? "bg-sky-500 text-white"
                      : "bg-ink-200/80 text-ink-600"
                  )}
                >
                  {done && !selected ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="truncate text-[11px]">{step.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step Body Card */}
      <div className="rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-ink-100 sm:p-4">
        <AnimatePresence mode="wait">
          {currentStepIndex === 0 && (
            <motion.div
              key="step-cast"
              variants={fadeRise}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -4 }}
              className="space-y-3"
            >
              <div className="space-y-0.5">
                <h3 className="font-display text-sm font-bold text-ink-900">
                  Who are the heroes?
                </h3>
                <p className="text-[11px] leading-relaxed text-ink-500">
                  Add their names and relationships. The first person is the hero.
                </p>
              </div>
              <CastEditor
                cast={brief.cast ?? []}
                onChange={(cast, options) => onChange({ cast }, options)}
              />
            </motion.div>
          )}

          {currentStepIndex === 1 && (
            <motion.div
              key="step-plot"
              variants={fadeRise}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -4 }}
              className="space-y-3"
            >
              <div className="space-y-0.5">
                <h3 className="font-display text-sm font-bold text-ink-900">
                  What happens in the story?
                </h3>
                <p className="text-[11px] leading-relaxed text-ink-500">
                  Tell us the occasion, trip, or moment to weave into your tale.
                </p>
              </div>

              <div className="space-y-2.5 pt-0.5">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    The occasion or moment <span className="text-rose-500">*</span>
                  </span>
                  <Textarea
                    rows={2}
                    value={brief.occasion ?? ""}
                    onChange={(e) =>
                      onChange(
                        { occasion: e.target.value },
                        { coalesce: "story-brief:occasion" },
                      )
                    }
                    placeholder="Amanda and Arthur's first sleepover in the treehouse…"
                    maxLength={1000}
                    aria-label="What happens"
                    className="text-xs"
                  />
                </label>

                <div className="space-y-2.5">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      When <span className="font-normal text-ink-400">(optional)</span>
                    </span>
                    <Input
                      value={brief.when ?? ""}
                      onChange={(e) =>
                        onChange(
                          { when: e.target.value },
                          { coalesce: "story-brief:when" },
                        )
                      }
                      placeholder="The last warm evening of the summer"
                      maxLength={200}
                      aria-label="When it happens"
                      className="text-xs h-8.5"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      Where <span className="font-normal text-ink-400">(optional)</span>
                    </span>
                    <Input
                      value={brief.where ?? ""}
                      onChange={(e) =>
                        onChange(
                          { where: e.target.value },
                          { coalesce: "story-brief:where" },
                        )
                      }
                      placeholder="Grandad's garden, at the bottom of the hill"
                      maxLength={200}
                      aria-label="Where it happens"
                      className="text-xs h-8.5"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Must include <span className="font-normal text-ink-400">(optional)</span>
                  </span>
                  <Input
                    value={brief.mustInclude ?? ""}
                    onChange={(e) =>
                      onChange(
                        { mustInclude: e.target.value },
                        { coalesce: "story-brief:must-include" },
                      )
                    }
                    placeholder="Her yellow torch, and the dog that snores"
                    maxLength={300}
                    aria-label="Anything that must be included"
                    className="text-xs h-8.5"
                  />
                </label>
              </div>
            </motion.div>
          )}

          {currentStepIndex === 2 && (
            <motion.div
              key="step-style"
              variants={fadeRise}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -4 }}
              className="space-y-3.5"
            >
              <div className="space-y-0.5">
                <h3 className="font-display text-sm font-bold text-ink-900">
                  How should it be told?
                </h3>
                <p className="text-[11px] leading-relaxed text-ink-500">
                  Pick a storytelling rhythm or theme (optional).
                </p>
              </div>

              <OptionChips
                label="Storytelling style"
                optional
                options={craft.devices}
                selectedId={brief.deviceId}
                custom={brief.customDevice}
                onChange={({ id, custom }, options) =>
                  onChange(
                    { deviceId: id, ...(custom !== undefined ? { customDevice: custom } : {}) },
                    options,
                  )
                }
                customPlaceholder="e.g. told as a series of letters"
              />

              <OptionChips
                label="A theme to lean into"
                optional
                options={craft.themes}
                selectedId={brief.themeId}
                custom={brief.customTheme}
                onChange={({ id, custom }, options) =>
                  onChange(
                    { themeId: id, ...(custom !== undefined ? { customTheme: custom } : {}) },
                    options,
                  )
                }
                customPlaceholder="e.g. being brave when others sleep"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wizard Navigation / Action Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
          <div>
            {currentStepIndex > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ArrowLeft className="size-3" />}
                onClick={() => setCurrentStepIndex((i) => i - 1)}
                className="h-8 text-xs px-2"
              >
                Back
              </Button>
            ) : <span />}
          </div>

          <div className="flex items-center gap-2">
            {currentStepIndex < CO_WRITE_STEPS.length - 1 ? (
              <Button
                size="sm"
                variant="secondary"
                rightIcon={<ArrowRight className="size-3.5" />}
                onClick={() => setCurrentStepIndex((i) => i + 1)}
                className="h-8 text-xs"
              >
                Next: {CO_WRITE_STEPS[currentStepIndex + 1]?.label}
              </Button>
            ) : (
              <Button
                disabled={!canWrite && !writing}
                loading={writing}
                variant="magic"
                size="sm"
                leftIcon={!writing ? (hasStory ? <RotateCcw className="size-3.5" /> : <Wand2 className="size-3.5" />) : undefined}
                onClick={() => void write(brief)}
                className="h-8 text-xs shadow-soft"
              >
                {writing ? "Writing…" : hasStory ? "Write again" : "Write story"}
              </Button>
            )}

          </div>
        </div>

        {currentStepIndex === CO_WRITE_STEPS.length - 1 && blockers.length > 0 && !writing && (
          <p className="mt-1.5 text-right text-[11px] text-amber-700">
            {blockers[0]}
          </p>
        )}
      </div>
    </section>
  );
}
