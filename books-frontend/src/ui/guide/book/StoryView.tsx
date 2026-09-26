"use client";

/**
 * The manuscript is a writing surface, not a print preview. It stays stable
 * while the reader writes; physical format is chosen beside the Draw action,
 * where changing it has a visible relationship to the book being produced.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, PenLine, Sparkles, TriangleAlert } from "lucide-react";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { AgeFitCheck } from "../../studio/story/AgeFitCheck";
import { StoryDiffActions, StoryDiffReview } from "../../studio/story/StoryDiffReview";
import { StoryManuscript } from "../../studio/story/StoryManuscript";
import { useStoryRevision } from "../../studio/story/useStoryRevision";
import { useStudio } from "../../studio/StudioContext";
import { useChatStudio } from "../../../state/chatStudio";
import { useGuideT } from "../intl";

export function StoryView({ project, locked }: { project: Project; locked: boolean }) {
  const { updateStory } = useStudio();
  const t = useGuideT("chrome");
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const craft = useMemo(
    () => resolveStoryCraft(project.config.ageRangeId, storyCraft),
    [project.config.ageRangeId, storyCraft],
  );
  const revisionFlow = useStoryRevision();
  const discardRevision = revisionFlow.discardAll;
  const askGuide = useChatStudio((s) => s.askGuide);
  const reviewReady =
    revisionFlow.revision?.status === "ready" && Boolean(revisionFlow.revision.proposal);
  const [reviewOpen, setReviewOpen] = useState(true);
  const run = project.authoringState?.storyRun;
  const writing = run?.status === "running";
  const canImprove = project.config.storyText.trim().length >= 20;
  const revisionActive = Boolean(
    revisionFlow.revision &&
      ["pending", "running", "ready", "error"].includes(revisionFlow.revision.status),
  );
  const reviewing = reviewReady && reviewOpen;

  useEffect(() => {
    if (reviewReady) setReviewOpen(true);
  }, [reviewReady, revisionFlow.revision?.id]);
  useEffect(() => {
    if (locked && reviewReady) discardRevision();
  }, [locked, reviewReady, discardRevision]);

  const revisionHeaderAction = reviewReady ? (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={reviewing ? <PenLine className="size-3.5" /> : <Sparkles className="size-3.5" />}
      onClick={() => setReviewOpen((open) => !open)}
      className="h-8 text-xs"
    >
      {reviewing ? t("continueEditing") : t("reviewChanges")}
    </Button>
  ) : revisionFlow.revision?.status === "pending" ||
    revisionFlow.revision?.status === "running" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500">
      <Loader2 className="size-3.5 animate-spin" />
      {t("preparingRevision")}
    </span>
  ) : revisionFlow.revision?.status === "error" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <TriangleAlert className="size-3.5" />
      {t("revisionFailed")}
    </span>
  ) : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden px-4 py-5 sm:px-6">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-lifted ring-1 ring-ink-900/5">
        {locked ? (
          <ReadOnlyStory text={project.config.storyText} />
        ) : (
          <>
            {canImprove && (
              <StoryGuideTools
                project={project}
                craft={craft}
                disabled={revisionFlow.starting || (revisionActive && revisionFlow.revision?.status !== "error")}
                onCustomOpen={() => void askGuide()}
                onStart={revisionFlow.start}
              />
            )}
            <StoryManuscript
              storyText={project.config.storyText}
              onChange={(storyText, options) => {
                if (!locked) void updateStory({ storyText }, options);
              }}
              writing={writing}
              headerAction={revisionHeaderAction}
              reviewing={reviewing}
              reviewContent={
                reviewing && revisionFlow.revision ? (
                  <StoryDiffReview
                    revision={revisionFlow.revision}
                    currentStory={project.config.storyText}
                    onDecide={revisionFlow.decide}
                  />
                ) : null
              }
              reviewFooter={
                reviewing && revisionFlow.revision ? (
                  <StoryDiffActions
                    revision={revisionFlow.revision}
                    currentStory={project.config.storyText}
                    saving={revisionFlow.saving}
                    onKeepAll={revisionFlow.keepAll}
                    onKeepSelected={revisionFlow.keepSelected}
                    onDiscardAll={revisionFlow.discardAll}
                  />
                ) : null
              }
              className="h-full min-h-0 flex-1 rounded-none shadow-none ring-0"
            />
          </>
        )}
      </div>
    </div>
  );
}

function StoryGuideTools({
  project,
  craft,
  disabled,
  onCustomOpen,
  onStart,
}: {
  project: Project;
  craft: ReturnType<typeof resolveStoryCraft>;
  disabled: boolean;
  onCustomOpen: () => void;
  onStart: (instruction: string) => Promise<void>;
}) {
  const t = useGuideT("chrome");
  const prompts = [
    t("makeShorter"),
    t("simplifyLanguage"),
    t("improveRhythm"),
    t("warmerEnding"),
  ];

  return (
    <section className="shrink-0 space-y-3 border-b border-ink-100 bg-ink-50/50 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <Sparkles className="size-4 text-magic-600" />
          {t("improveWithGuide")}
        </span>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => void onStart(prompt).catch(() => {})}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink-700 shadow-2xs ring-1 ring-ink-200 transition hover:ring-ink-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {prompt}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={onCustomOpen}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-white hover:text-ink-900 disabled:opacity-45"
        >
          {t("describeChange")}
        </button>
      </div>
      <AgeFitCheck
        storyText={project.config.storyText}
        ageRangeId={project.config.ageRangeId}
        craft={craft}
      />
    </section>
  );
}

function ReadOnlyStory({ text }: { text: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 font-serif text-[17px] leading-relaxed text-ink-800 sm:px-10">
      <div className="flex flex-col gap-4">
        {text
          .split(/\n\s*\n/)
          .filter((paragraph) => paragraph.trim())
          .map((paragraph, index) => (
            <p key={index} className="whitespace-pre-wrap">
              {paragraph.trim()}
            </p>
          ))}
      </div>
    </div>
  );
}
