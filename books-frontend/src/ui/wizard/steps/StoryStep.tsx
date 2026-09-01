"use client";

import { useMemo, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Languages,
  PenLine,
  Redo2,
  RefreshCw,
  Sparkles,
  Undo2,
  Users,
  Wand2,
} from "lucide-react";
import type { StoryBrief } from "../../../core/types";
import {
  ageBandLabel,
  storyModeInfo,
  type StoryMode,
} from "../../../core/config/storyCraftCatalog";
import {
  getBookLanguage,
  type BookLanguageId,
} from "../../../core/config/bookLanguages";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import {
  createDefaultStoryBrief,
  isDraftStale,
  namedHeroes,
  wordCount,
} from "../../../core/story/brief";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { GuidedComposer } from "../../studio/story/GuidedComposer";
import { CoWriteComposer } from "../../studio/story/CoWriteComposer";
import { AgeFitCheck } from "../../studio/story/AgeFitCheck";
import { StoryManuscript } from "../../studio/story/StoryManuscript";
import { StoryDiffActions, StoryDiffReview } from "../../studio/story/StoryDiffReview";
import { StoryRefinePanel } from "../../studio/story/StoryRefinePanel";
import { StoryAdaptCard } from "../../studio/story/StoryAdaptCard";
import { StoryModePicker } from "../../studio/story/StoryModePicker";
import { useStoryDraft } from "../../studio/story/useStoryDraft";
import { useStoryRevision } from "../../studio/story/useStoryRevision";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";
import { fadeRise, spring } from "../../lib/motion";
import type { StepProps } from "./types";

/**
 * The Story step:
 * 1. Desktop: State-of-the-art 2-column authoring workbench.
 *    - Left: Focused prompt & craft generator (Guided / Co-write) with micro-stepper.
 *    - Right: Full-height Manuscript desk with internal scrollable editor.
 * 2. Mobile/Tablet: Intuitive tabbed switcher between prompt generator & full manuscript view.
 * 3. Distraction-free mode for author's own story with real-time age & reading guidance.
 */
export function StoryStep({ config, update }: StepProps) {
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const craft = useMemo(
    () => resolveStoryCraft(config.ageRangeId, storyCraft),
    [config.ageRangeId, storyCraft],
  );

  const {
    translating,
    writing,
    undoable,
    redoable,
    translate,
    confirmWithoutRewrite,
    confirmLanguageWithoutTranslate,
    undo,
    redo,
  } = useStoryDraft();
  const revisionFlow = useStoryRevision();
  const reviewReady =
    revisionFlow.revision?.status === "ready" && Boolean(revisionFlow.revision.proposal);
  const [reviewOpen, setReviewOpen] = useState(true);
  const reviewing = reviewReady && reviewOpen;

  const hasStory = config.storyText.trim().length > 0;
  const words = wordCount(config.storyText.trim());
  const brief: StoryBrief =
    config.storyBrief ?? createDefaultStoryBrief(hasStory ? "own" : "guided");
  const chosen = Boolean(config.storyBrief) || hasStory;

  // On mobile (< lg), track active tab: "composer" or "manuscript"
  const [mobileTab, setMobileTab] = useState<"composer" | "manuscript">(
    hasStory || brief.mode === "own" ? "manuscript" : "composer"
  );

  // Auto-switch to manuscript on mobile when generation finishes
  useEffect(() => {
    if (hasStory && !writing) {
      setMobileTab("manuscript");
    }
  }, [hasStory, writing]);

  useEffect(() => {
    if (reviewing) setMobileTab("manuscript");
  }, [reviewing]);

  useEffect(() => {
    if (reviewReady) setReviewOpen(true);
  }, [reviewReady, revisionFlow.revision?.id]);

  const revisionHeaderAction = reviewReady ? (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={reviewing ? <PenLine className="size-3.5" /> : <Sparkles className="size-3.5" />}
      onClick={() => setReviewOpen((open) => !open)}
      className="h-8 text-xs"
    >
      {reviewing ? "Continue editing" : "Review changes"}
    </Button>
  ) : null;

  const patchBrief = (patch: Partial<StoryBrief>) =>
    update({ storyBrief: { ...brief, ...patch } });

  const setMode = (mode: StoryMode) => {
    if (mode === brief.mode && config.storyBrief) return;
    patchBrief({ mode });
    if (mode === "own") {
      setMobileTab("manuscript");
    } else if (!hasStory) {
      setMobileTab("composer");
    }
  };

  const stale = isDraftStale(
    brief,
    config.storyText,
    config.ageRangeId,
    config.readingModeId,
    config.contentLocale,
  );
  const originAge = brief.generatedForAge ?? (hasStory ? "0-2" : undefined);
  const ageChanged =
    hasStory && Boolean(originAge) && originAge !== config.ageRangeId;
  const originLocale: BookLanguageId = (brief.generatedForLocale as BookLanguageId) ?? "en-US";
  const currentLocale: BookLanguageId = (config.contentLocale as BookLanguageId) ?? "en-US";
  const languageChanged = hasStory && originLocale !== currentLocale;
  const needsAdaptation = languageChanged || ageChanged;

  const originLang = getBookLanguage(originLocale);
  const targetLang = getBookLanguage(currentLocale);

  const modeInfo = storyModeInfo(brief.mode);

  // Initial first-time view: 3 mode cards
  if (!chosen) {
    return (
      <motion.div variants={fadeRise} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
              How would you like to create your story?
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">
              Whichever path you choose, you&apos;ll be able to read and edit every word — perfectly pitched for {ageBandLabel(config.ageRangeId)}.
            </p>
          </div>
          <StoryModePicker value={brief.mode} onChange={setMode} />
        </div>
      </motion.div>
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Author's Own Words Mode (Distraction-Free Full-Screen Desk)
  // ---------------------------------------------------------------------------
  if (brief.mode === "own") {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col space-y-3">
        {/* Compact mode switcher — keep the manuscript's vertical space. */}
        <div className="flex shrink-0 items-center rounded-2xl bg-white/80 p-2 shadow-2xs ring-1 ring-ink-100 backdrop-blur sm:px-3.5">
          <div className="flex items-center gap-2">
            <StoryModePicker value={brief.mode} onChange={setMode} compact />
          </div>
        </div>

        {/* Full-Height Manuscript Desk */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          {hasStory && (
            <div className="space-y-3 shrink-0 lg:w-90">
              <StoryAdaptCard
                languageChanged={languageChanged}
                ageChanged={ageChanged}
                originLocale={originLocale}
                currentLocale={currentLocale}
                originAge={originAge}
                targetAge={config.ageRangeId}
                translating={translating}
                writing={writing}
                onConfirm={confirmWithoutRewrite}
                onAdapt={() => translate(originLocale, currentLocale)}
              />
              <StoryRefinePanel
                revision={revisionFlow.revision}
                starting={revisionFlow.starting}
                onStart={revisionFlow.start}
              />
              <AgeFitCheck
                storyText={config.storyText}
                ageRangeId={config.ageRangeId}
                craft={craft}
              />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            <StoryManuscript
              storyText={config.storyText}
              onChange={(storyText) => update({ storyText })}
              placeholder="Write or paste your story here… Tell an unforgettable tale for your little reader."
              headerAction={revisionHeaderAction}
              reviewing={reviewing}
              reviewContent={
                reviewing && revisionFlow.revision ? (
                  <StoryDiffReview
                    revision={revisionFlow.revision}
                    currentStory={config.storyText}
                    onDecide={revisionFlow.decide}
                  />
                ) : null
              }
              reviewFooter={
                reviewing && revisionFlow.revision ? (
                  <StoryDiffActions
                    revision={revisionFlow.revision}
                    currentStory={config.storyText}
                    saving={revisionFlow.saving}
                    onKeepAll={revisionFlow.keepAll}
                    onKeepSelected={revisionFlow.keepSelected}
                    onDiscardAll={revisionFlow.discardAll}
                  />
                ) : null
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Guided & Co-Write 2-Column Responsive Workspace
  // ---------------------------------------------------------------------------
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Mobile Tab Switcher (< lg screens) */}
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2 rounded-2xl bg-white/90 p-1.5 shadow-2xs ring-1 ring-ink-100 lg:hidden">
        <div className="flex flex-1 items-center gap-1">
          <button
            type="button"
            onClick={() => setMobileTab("composer")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition",
              mobileTab === "composer"
                ? "bg-brand-600 text-white shadow-soft"
                : "text-ink-600 hover:bg-ink-50"
            )}
          >
            <Wand2 className="size-3.5" />
            <span>Prompt & Idea</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("manuscript")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition",
              mobileTab === "manuscript"
                ? "bg-brand-600 text-white shadow-soft"
                : "text-ink-600 hover:bg-ink-50"
            )}
          >
            <BookOpen className="size-3.5" />
            <span>Manuscript {words > 0 ? `(${words}w)` : ""}</span>
          </button>
        </div>
      </div>

      {/* 2-Column Split Body on Desktop, Tabbed on Mobile */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-5">
        {/* Left Column: Generator Form & Mode Details */}
        <div
          className={cn(
            "flex min-h-0 flex-col space-y-3.5 lg:w-102.5 xl:w-115 lg:shrink-0",
            mobileTab === "manuscript" ? "hidden lg:flex" : "flex flex-1"
          )}
        >
          {/* Top Bar inside column */}
          <div className="flex shrink-0 items-center justify-between gap-2 rounded-2xl bg-white/80 p-2 shadow-2xs ring-1 ring-ink-100 backdrop-blur">
            <StoryModePicker value={brief.mode} onChange={setMode} compact />
          </div>

          {/* Scrollable inputs column */}
          <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-1 sm:pr-2">
            {hasStory && (
              <StoryRefinePanel
                revision={revisionFlow.revision}
                starting={revisionFlow.starting}
                onStart={revisionFlow.start}
              />
            )}

            {/* Interactive Adaptation / Translation Transfer Card */}
            <StoryAdaptCard
              languageChanged={languageChanged}
              ageChanged={ageChanged}
              originLocale={originLocale}
              currentLocale={currentLocale}
              originAge={originAge}
              targetAge={config.ageRangeId}
              translating={translating}
              writing={writing}
              onConfirm={confirmWithoutRewrite}
              onAdapt={() => translate(originLocale, currentLocale)}
            />

            {/* Undo / Redo Toast */}
            {(undoable || redoable) && (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-ink-200 bg-white px-3 py-2 text-xs text-ink-700 shadow-2xs">
                <span className="truncate">
                  {undoable ? "Story was rewritten." : "Change was undone."}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {undoable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Undo2 className="size-3" />}
                      onClick={undo}
                      className="h-7 px-2 text-xs"
                    >
                      Undo
                    </Button>
                  )}
                  {redoable && (
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<Redo2 className="size-3" />}
                      onClick={redo}
                      className="h-7 px-2 text-xs"
                    >
                      Redo
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Composer Details Changed Notice (when parameters changed but not age/language) */}
            {!needsAdaptation && stale && (
              <div className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-100 text-xs">
                <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                <p className="leading-relaxed">
                  Details changed since draft was written. Write again to update.
                </p>
              </div>
            )}

            {/* Main Form Composer */}
            {hasStory ? (
              <details className="group rounded-2xl bg-white ring-1 ring-ink-100">
                <summary className="cursor-pointer list-none px-4 py-3 text-xs font-bold text-ink-600">
                  Original story details
                  <span className="ml-1.5 text-ink-400 group-open:hidden">›</span>
                </summary>
                <div className="border-t border-ink-100 p-2">
                  {brief.mode === "guided" && (
                    <GuidedComposer
                      brief={brief}
                      craft={craft}
                      hasStory={hasStory}
                      onChange={patchBrief}
                    />
                  )}
                  {brief.mode === "co-write" && (
                    <CoWriteComposer
                      brief={brief}
                      craft={craft}
                      hasStory={hasStory}
                      onChange={patchBrief}
                    />
                  )}
                </div>
              </details>
            ) : (
              <>
                {brief.mode === "guided" && (
                  <GuidedComposer
                    brief={brief}
                    craft={craft}
                    hasStory={hasStory}
                    onChange={patchBrief}
                  />
                )}
                {brief.mode === "co-write" && (
                  <CoWriteComposer
                    brief={brief}
                    craft={craft}
                    hasStory={hasStory}
                    onChange={patchBrief}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Full-Height Story Manuscript Desk */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            mobileTab === "composer" ? "hidden lg:flex" : "flex flex-1"
          )}
        >
          <StoryManuscript
            storyText={config.storyText}
            onChange={(storyText) => update({ storyText })}
            placeholder="Your story will appear here as it's written — or start typing to shape it yourself."
            headerAction={revisionHeaderAction}
            reviewing={reviewing}
            reviewContent={
              reviewing && revisionFlow.revision ? (
                <StoryDiffReview
                  revision={revisionFlow.revision}
                  currentStory={config.storyText}
                  onDecide={revisionFlow.decide}
                />
              ) : null
            }
            reviewFooter={
              reviewing && revisionFlow.revision ? (
                <StoryDiffActions
                  revision={revisionFlow.revision}
                  currentStory={config.storyText}
                  saving={revisionFlow.saving}
                  onKeepAll={revisionFlow.keepAll}
                  onKeepSelected={revisionFlow.keepSelected}
                  onDiscardAll={revisionFlow.discardAll}
                />
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
