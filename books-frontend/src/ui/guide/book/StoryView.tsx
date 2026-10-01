"use client";

/**
 * The manuscript is a writing surface, not a print preview. It stays stable
 * while the reader writes; physical format is chosen beside the Draw action,
 * where changing it has a visible relationship to the book being produced.
 *
 * The story is changed in the conversation, not here. This surface is where it
 * is read, typed and reviewed; a quiet line above it says where to ask for a
 * change, and the composer's own "Story" chip says that is where the words go.
 * Reviewing a proposed change stays on the text it is about, and the guide
 * narrates each step in the thread. While the reader types or reviews, the
 * chat holds back choices that can wait (`core/guide/attention.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, PenLine, Sparkles, TriangleAlert, X } from "lucide-react";
import { resolveAudienceProfile } from "../../../core/config/audience";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import type { Project } from "../../../core/types";
import { wordCount } from "../../../core/story/brief";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { StoryDiffActions, StoryDiffReview } from "../../studio/story/StoryDiffReview";
import { StoryManuscript } from "../../studio/story/StoryManuscript";
import { useStoryRevision } from "../../studio/story/useStoryRevision";
import { useStudio } from "../../studio/StudioContext";
import { useChatStudio } from "../../../state/chatStudio";
import { useGuideT } from "../intl";
import { restoreModelLineBreaks } from "../../../core/story/lineBreaks";
import { StoryFacts } from "./StoryFacts";
import { TitleFields } from "./TitleFields";
import { STORY_EDIT_SCOPE_ERROR, storyTextHash } from "../../../core/story/revision";
import { markExcerpt, type StoryMark } from "../../../core/story/storyMark";
import { useStoryMark } from "../../../state/storyMark";
import { cn } from "../../lib/cn";

/** Revisions the guide already announced as ready, so a tab switch does not say it twice. */
const announced = new Set<string>();

const BUSY_REVISION = new Set(["pending", "running", "ready"]);

export function StoryView({ project, locked }: { project: Project; locked: boolean }) {
  const { updateStory } = useStudio();
  const t = useGuideT("chrome");
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const craft = useMemo(
    () => resolveStoryCraft(project.config.ageRangeId, storyCraft),
    [project.config.ageRangeId, storyCraft],
  );
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // The guide says how each review ended, so the thread is the whole record.
  const onOutcome = useCallback((outcome: "kept" | "discarded") => {
    if (lockedRef.current) return;
    useChatStudio
      .getState()
      .say([{ key: outcome === "kept" ? "revisionKept" : "revisionDiscarded", priority: "result" }], { unprompted: true });
  }, []);
  const revisionFlow = useStoryRevision({ onOutcome });
  const discardRevision = revisionFlow.discardAll;
  const reviewReady =
    revisionFlow.revision?.status === "ready" && Boolean(revisionFlow.revision.proposal);
  const [reviewOpen, setReviewOpen] = useState(true);
  const run = project.authoringState?.storyRun;
  const writing = run?.status === "running";
  const canImprove = project.config.storyText.trim().length >= 20;
  const reviewing = reviewReady && reviewOpen;
  const revisionBusy = !locked && BUSY_REVISION.has(revisionFlow.revision?.status ?? "");

  useEffect(() => {
    if (reviewReady) setReviewOpen(true);
  }, [reviewReady, revisionFlow.revision?.id]);
  useEffect(() => {
    if (locked && reviewReady) discardRevision();
  }, [locked, reviewReady, discardRevision]);

  // The changes are marked: say so in the conversation, once per proposal.
  const readyId = reviewReady && !locked ? revisionFlow.revision?.id : undefined;
  useEffect(() => {
    if (!readyId || announced.has(readyId)) return;
    announced.add(readyId);
    useChatStudio.getState().say([{ key: "revisionReady", priority: "result" }], { unprompted: true });
  }, [readyId]);

  // The passage the reader marked is what the next message is about. It only
  // holds while the story is the one it was taken from and can still be edited.
  const mark = useStoryMark((s) => s.mark);
  const setMark = useStoryMark((s) => s.setMark);
  const storyText = project.config.storyText;
  const markable = !locked && !writing && !reviewing;
  useEffect(() => {
    const held = useStoryMark.getState().mark;
    if (held && (!markable || held.baseHash !== storyTextHash(storyText))) setMark(null);
  }, [markable, storyText, setMark]);
  useEffect(() => () => useStoryMark.getState().setMark(null), []);

  // What the reader is doing here decides what the chat may put in front of them.
  const setStoryFocus = useChatStudio((s) => s.setStoryFocus);
  const [typing, setTyping] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setStoryFocus(locked ? null : revisionBusy ? "reviewing" : typing ? "editing" : null);
  }, [locked, revisionBusy, typing, setStoryFocus]);
  useEffect(
    () => () => {
      window.clearTimeout(leaveTimer.current);
      useChatStudio.getState().setStoryFocus(null);
    },
    [],
  );

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
  ) : revisionFlow.revision?.status === "error" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <TriangleAlert className="size-3.5" />
      {revisionFlow.revision.error === STORY_EDIT_SCOPE_ERROR ? t("revisionOutsideMark") : t("revisionFailed")}
    </span>
  ) : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden px-4 py-5 sm:px-6">
      <div
        onFocus={() => {
          window.clearTimeout(leaveTimer.current);
          setTyping(true);
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          leaveTimer.current = window.setTimeout(() => setTyping(false), 350);
        }}
        className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-lifted ring-1 ring-ink-900/5"
      >
        <TitleFields
          project={project}
          locked={locked}
          busy={writing}
          trailing={
            <>
              {!locked && revisionHeaderAction}
              {!locked && reviewing && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">
                  <Sparkles className="size-3" aria-hidden />
                  {t("reviewMode")}
                </span>
              )}
            </>
          }
        />
        {locked ? (
          <ReadOnlyStory text={project.config.storyText} />
        ) : (
          <>
            {canImprove && !reviewing && !writing && (
              <StoryHint project={project} craft={craft} mark={mark} onClearMark={() => setMark(null)} />
            )}
            {canImprove && !reviewing && !writing && !revisionBusy && <StoryFacts project={project} mark={mark} />}
            <StoryManuscript
              storyText={project.config.storyText}
              onChange={(storyText, options) => {
                if (!locked) void updateStory({ storyText }, options);
              }}
              writing={writing}
              hideHeader
              onMark={setMark}
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

/**
 * The one pointer from the page to the conversation: changes are asked for
 * there. It wears the guide's own accent, so the two read as one thing, and a
 * tap puts the cursor in the message field. The story's length against its
 * age group stays here as plain information; a read of how it suits the age is
 * a question for the guide.
 */
function StoryHint({
  project,
  craft,
  mark,
  onClearMark,
}: {
  project: Project;
  craft: ReturnType<typeof resolveStoryCraft>;
  mark: StoryMark | null;
  onClearMark: () => void;
}) {
  const t = useGuideT("chrome");
  const tTools = useGuideT("storyTools");
  const audience = useAppConfigStore((s) => s.audience);
  const ageWriting = useAppConfigStore((s) => s.ageWriting);
  const storyCraftConfig = useAppConfigStore((s) => s.storyCraft);
  const band = resolveAudienceProfile(project.config.ageRangeId, {
    audience,
    ageWriting,
    storyCraft: storyCraftConfig,
  }).label;
  const words = wordCount(project.config.storyText);
  const { minWords, maxWords } = craft.structure;
  const lengthHint =
    words === 0
      ? null
      : words < minWords
        ? tTools("shortLengthHint", { band, min: minWords, max: maxWords })
        : words > maxWords
          ? tTools("longLengthHint", { band, min: minWords, max: maxWords })
          : null;
  return (
    <section className="shrink-0 space-y-1.5 border-b border-ink-100 bg-ink-50/50 px-4 py-2.5 sm:px-5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          // Keep the marked text selected: the button must not take focus from the field.
          onMouseDown={(event) => {
            if (mark) event.preventDefault();
          }}
          onClick={() => void useChatStudio.getState().focusComposer()}
          className={cn(
            "group flex min-w-0 flex-1 items-center gap-2.5 border-l-2 py-0.5 pl-3 text-left text-[13px] leading-snug text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
            mark ? "border-magic-500" : "border-magic-200/80",
          )}
        >
          <Sparkles className="size-3.5 shrink-0 text-magic-600" aria-hidden />
          {mark ? (
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-ink-900">{t("markedLabel")}</span>
              <span className="ml-1.5 font-serif text-ink-700">“{markExcerpt(mark.text, 90)}”</span>
              <span className="ml-1.5 text-ink-500">{t("markedHint")}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1">{t("storyHint")}</span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-ink-800 ring-1 ring-ink-200 transition group-hover:bg-white group-hover:ring-ink-400">
            <MessageCircle className="size-3.5" aria-hidden />
            {t("askGuide")}
          </span>
        </button>
        {mark && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClearMark}
            aria-label={t("clearMark")}
            title={t("clearMark")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-white hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {lengthHint && <p className="px-1 text-xs leading-relaxed text-ink-400">{lengthHint}</p>}
    </section>
  );
}

function ReadOnlyStory({ text }: { text: string }) {
  const restored = restoreModelLineBreaks(text);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 font-serif text-[17px] leading-relaxed text-ink-800 sm:px-10">
      <div className="flex flex-col gap-4">
        {restored
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
