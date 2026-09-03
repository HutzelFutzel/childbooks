"use client";

import { useMemo, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PenLine,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { StoryBrief } from "../../../core/types";
import { type StoryMode } from "../../../core/config/storyCraftCatalog";
import { type BookLanguageId } from "../../../core/config/bookLanguages";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import {
  createDefaultStoryBrief,
  isDraftStale,
} from "../../../core/story/brief";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { GuidedComposer } from "../../studio/story/GuidedComposer";
import { CoWriteComposer } from "../../studio/story/CoWriteComposer";
import { StoryManuscript } from "../../studio/story/StoryManuscript";
import { StoryDiffActions, StoryDiffReview } from "../../studio/story/StoryDiffReview";
import { StoryRefinePanel } from "../../studio/story/StoryRefinePanel";
import { StoryAdaptCard } from "../../studio/story/StoryAdaptCard";
import { StoryModePicker } from "../../studio/story/StoryModePicker";
import { useStoryDraft } from "../../studio/story/useStoryDraft";
import { useStoryRevision } from "../../studio/story/useStoryRevision";
import { Button } from "../../components/Button";
import { fadeRise } from "../../lib/motion";
import type { StepProps } from "./types";

/**
 * The Story step:
 * 1. Before a draft: one focused creation task, without a competing blank editor.
 * 2. After a draft: the manuscript is primary and AI changes stay attached to it.
 * 3. Regeneration and optional checks remain available through progressive disclosure.
 */
export function StoryStep({
  config,
  update,
  storyToolsOpen = false,
  onStoryToolsOpenChange,
}: StepProps) {
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const craft = useMemo(
    () => resolveStoryCraft(config.ageRangeId, storyCraft),
    [config.ageRangeId, storyCraft],
  );

  const storyDraft = useStoryDraft();
  const {
    translating,
    writing,
    translate,
    confirmWithoutRewrite,
  } = storyDraft;
  const revisionFlow = useStoryRevision();
  const reviewReady =
    revisionFlow.revision?.status === "ready" && Boolean(revisionFlow.revision.proposal);
  const [reviewOpen, setReviewOpen] = useState(true);
  const reviewing = reviewReady && reviewOpen;

  const hasStory = config.storyText.trim().length > 0;
  const canRefine = config.storyText.trim().length >= 20;
  const brief: StoryBrief =
    config.storyBrief ?? createDefaultStoryBrief(hasStory ? "own" : "guided");
  const chosen = Boolean(config.storyBrief) || hasStory;

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

  const patchBrief = (
    patch: Partial<StoryBrief>,
    options?: Parameters<StepProps["update"]>[1],
  ) => update({ storyBrief: { ...brief, ...patch } }, options);

  const setMode = (mode: StoryMode) => {
    if (mode === brief.mode && config.storyBrief) return;
    patchBrief({
      mode,
      ...(mode === "own"
        ? {
            generatedForAge: config.ageRangeId,
            generatedForLocale: (config.contentLocale ?? "en-US") as BookLanguageId,
          }
        : {}),
    });
  };

  const stale = isDraftStale(
    brief,
    config.storyText,
    config.ageRangeId,
    config.readingModeId,
    config.contentLocale,
  );
  const originAge = brief.generatedForAge;
  const ageChanged =
    hasStory && Boolean(originAge) && originAge !== config.ageRangeId;
  const currentLocale: BookLanguageId = (config.contentLocale as BookLanguageId) ?? "en-US";
  const knownOriginLocale = brief.generatedForLocale as BookLanguageId | undefined;
  const originLocale = knownOriginLocale ?? currentLocale;
  const languageChanged =
    hasStory && Boolean(knownOriginLocale) && originLocale !== currentLocale;
  const needsAdaptation = languageChanged || ageChanged;

  // Initial first-time view: 3 mode cards
  if (!chosen) {
    return (
      <motion.div
        variants={fadeRise}
        initial="hidden"
        animate="show"
        className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto p-4"
      >
        <div className="my-auto w-full max-w-4xl space-y-5 py-4">
          <div className="text-center">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">
              Choose how to begin
            </h2>
            <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-ink-500">
              You’ll be able to edit every word before continuing.
            </p>
          </div>
          <StoryModePicker value={null} onChange={setMode} />
        </div>
      </motion.div>
    );
  }

  const manuscript = (
    <StoryManuscript
      key="story-manuscript"
      storyText={config.storyText}
      onChange={(storyText, options) => update({ storyText }, options)}
      placeholder={
        brief.mode === "own"
          ? "Write or paste your story here…"
          : "Your story will appear here when it’s ready."
      }
      headerAction={revisionHeaderAction}
      reviewing={reviewing}
      writing={writing}
      translating={translating}
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
      className={canRefine && !needsAdaptation ? "rounded-t-none" : undefined}
    />
  );

  // Once a draft exists, the story is the workspace. AI changes stay attached
  // to it; creating another version opens from the workspace toolbar.
  // The same tree also hosts an empty manual manuscript so the first keystroke
  // cannot remount the textarea and steal focus.
  if (hasStory || brief.mode === "own") {
    return (
      <div className="relative flex h-full min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {hasStory && needsAdaptation && (
            <StoryAdaptCard
              key="story-adaptation"
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
          )}

          <div key="manuscript-workspace" className="flex min-h-0 flex-1 flex-col">
            {!hasStory && (
              <div
                key="empty-story-method"
                className="mb-3 shrink-0 rounded-xl bg-white p-2 ring-1 ring-ink-200"
              >
                <StoryModePicker value={brief.mode} onChange={setMode} compact />
              </div>
            )}
            {canRefine && !needsAdaptation && (
              <StoryRefinePanel
                key="story-refine"
                revision={revisionFlow.revision}
                starting={revisionFlow.starting}
                onStart={revisionFlow.start}
                attached
              />
            )}
            {manuscript}
          </div>
        </div>

        <AnimatePresence>
          {hasStory && storyToolsOpen && (
            <>
              <motion.button
                type="button"
                aria-label="Close new version panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => onStoryToolsOpenChange?.(false)}
                className="absolute inset-0 z-20 bg-ink-900/15"
              />
              <motion.aside
                aria-label="Create another story version"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-ink-200 bg-white shadow-lifted"
              >
                <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-ink-200 px-5">
                  <div>
                    <h3 className="text-base font-semibold text-ink-900">Create a new version</h3>
                    <p className="mt-0.5 text-sm text-ink-500">Your current story remains available with Undo.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close new version panel"
                    onClick={() => onStoryToolsOpenChange?.(false)}
                    className="inline-flex size-9 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                  <div>
                    <p className="mb-2 text-sm font-medium text-ink-700">Choose a method</p>
                    <StoryModePicker
                      value={brief.mode === "own" ? null : brief.mode}
                      onChange={setMode}
                      allowedModes={["guided", "co-write"]}
                      compact
                    />
                  </div>

                  {!needsAdaptation && stale && (
                    <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-100">
                      <RefreshCw aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                      <p>These details changed after this version was created.</p>
                    </div>
                  )}

                  {brief.mode === "guided" && (
                    <GuidedComposer
                      brief={brief}
                      craft={craft}
                      hasStory
                      onChange={patchBrief}
                      draft={storyDraft}
                    />
                  )}
                  {brief.mode === "co-write" && (
                    <CoWriteComposer
                      brief={brief}
                      craft={craft}
                      hasStory
                      onChange={patchBrief}
                      draft={storyDraft}
                    />
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Before the first draft, show only the chosen task. A blank manuscript next
  // to a generator creates a second, competing starting point.
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-3 pb-4">
        <div className="rounded-xl bg-white p-2 ring-1 ring-ink-200">
          <StoryModePicker value={brief.mode} onChange={setMode} compact />
        </div>
        {brief.mode === "guided" ? (
          <GuidedComposer
            brief={brief}
            craft={craft}
            hasStory={false}
            onChange={patchBrief}
            draft={storyDraft}
          />
        ) : (
          <CoWriteComposer
            brief={brief}
            craft={craft}
            hasStory={false}
            onChange={patchBrief}
            draft={storyDraft}
          />
        )}
      </div>
    </div>
  );
}
