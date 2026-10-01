"use client";

/**
 * The Chat studio: one conversation and the book it is making.
 *
 * Where everything sits is a pure function of the book and the window
 * (`core/guide/layout.ts`): the chat alone in the middle until the book has
 * something to show, then the chat on the left — the wider side while a choice
 * is still open — and the book on the right. Once the pages are the work, the
 * book takes the room back. Page focus opens a page for direct edits. On a
 * phone the live choice fills the screen; otherwise the book does, with the
 * composer docked at the bottom.
 *
 * Nothing here decides what happens next. The journey is derived from the book
 * and its live jobs (`useChatJourney`), the background work follows the book
 * (`useChatDrivers`), and every edit on the book pane goes through the same
 * project store the rest of the studio uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Loader2, MessageCircle, X } from "lucide-react";
import { ENTER_NEVER_ACCEPTS, guideActivity, type GuideActivity } from "../../core/guide/activity";
import { currentPortrait } from "../../core/guide/portrait";
import { authoringOf } from "../../core/guide/projectState";
import type { BookViewId } from "../../core/guide/journey";
import type { GuideIdea } from "../../core/guide/agent/ideas";
import { guideLayout, type GuideLayout } from "../../core/guide/layout";
import type { GuideTarget } from "../../core/guide/target";
import type { GuideMessage } from "../../core/guide/session";
import type { Project } from "../../core/types";
import { briefOf, namedCast } from "../../core/story/brief";
import { anchorImageIsCurrent } from "../../core/book/anchorFreshness";
import { guideCopy } from "../../core/guide/copy";
import { useAppConfigStore } from "../../state/appConfigStore";
import { chatLocaleOf, messageText, useChatStudio } from "../../state/chatStudio";
import { markExcerpt } from "../../core/story/storyMark";
import { useRevisionActivity } from "./useRevisionActivity";
import { takeMark, useStoryMark } from "../../state/storyMark";
import { setProjectConflictResolver, useProjectsStore } from "../../state/projectsStore";
import { mergeBooks } from "../../core/guide/merge";
import { OrderCheckout } from "../checkout/OrderDialog";
import { Drawer } from "../components/Drawer";
import { cn } from "../lib/cn";
import { StudioProvider, useStudio } from "../studio/StudioContext";
import type { StudioDestination } from "../studio/studioRoutes";
import { CastView } from "./book/CastView";
import { PageFocus } from "./book/PageFocus";
import { PagesView } from "./book/PagesView";
import { StoryView } from "./book/StoryView";
import { StyleView } from "./book/StyleView";
import { dispIndexOf } from "./book/units";
import { usePrintCheck } from "./book/usePrintCheck";
import { ViewSwitch } from "./book/ViewSwitch";
import { ChatThread } from "./chat/ChatThread";
import { Composer } from "./chat/Composer";
import { ComposerWell } from "./chat/ComposerWell";
import { IdeaChips, useIdeaPlaceholder } from "./chat/IdeaChips";
import { IdeaMenu } from "./chat/IdeaMenu";
import { ConflictCard } from "./chat/ConflictCard";
import { OpeningScene } from "./chat/OpeningScene";
import { GuideIntl, useGuideLabel, useGuideT } from "./intl";
import { layoutMove, paneIn } from "./motion";
import { useChatDrivers } from "./useChatDrivers";
import { useChatJourney, type ChatJourney, type ChatWell } from "./useChatJourney";
import { useGuideMemory } from "./useGuideMemory";
import { useWellConversation } from "./useWellConversation";
import { isQuietMessage, latestTurn } from "../../core/guide/conversation";

export function GuideStudio({ onNavigate }: { onNavigate: (destination: StudioDestination) => void }) {
  const project = useProjectsStore((s) => s.current());
  const open = useChatStudio((s) => s.open);
  const close = useChatStudio((s) => s.close);
  const projectId = project?.id ?? null;

  useEffect(() => {
    if (!projectId) return;
    void open(projectId);
    return () => close();
  }, [projectId, open, close]);

  // Two devices on one book: independent changes merge, the same change asks once.
  useEffect(() => {
    setProjectConflictResolver(({ base, mine, theirs }) => {
      const { project: merged, conflicts } = mergeBooks(base, mine, theirs);
      return conflicts.length > 0 ? { kind: "choose", conflicts, merged } : { kind: "merged", project: merged };
    });
    return () => setProjectConflictResolver(null);
  }, []);

  if (!project) return null;
  return (
    <GuideIntl>
      <StudioShell project={project} onNavigate={onNavigate} />
    </GuideIntl>
  );
}

function StudioShell({ project, onNavigate }: { project: Project; onNavigate: (d: StudioDestination) => void }) {
  const journey = useChatJourney(project);
  const [ordering, setOrdering] = useState(false);
  const destination: StudioDestination = journey.locked ? "pages" : "story";
  // The Studio's own navigation (the editor's "order" button) opens checkout
  // here; everything else stays on the conversation.
  const navigate = useCallback(
    (next: StudioDestination) => {
      if (next === "order") setOrdering(true);
      else onNavigate(next);
    },
    [onNavigate],
  );
  return (
    <StudioProvider project={project} destination={destination} onNavigate={navigate}>
      <ChatShell project={project} journey={journey} ordering={ordering} onOrdering={setOrdering} />
    </StudioProvider>
  );
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function ChatShell({
  project,
  journey,
  ordering,
  onOrdering,
}: {
  project: Project;
  journey: ChatJourney;
  ordering: boolean;
  onOrdering: (open: boolean) => void;
}) {
  useChatDrivers(project, journey);
  usePrintCheck(project, journey.locked && journey.pages.total > 0 && journey.pages.done === journey.pages.total);
  const talk = useWellConversation(project, journey);
  const liveWell = talk.well;

  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const { displays, pages, design } = useStudio();
  const session = useChatStudio((s) => s.session);
  const loaded = useChatStudio((s) => s.loaded);
  const sending = useChatStudio((s) => s.sending);
  const chosenView = useChatStudio((s) => s.view);
  const chip = useChatStudio((s) => s.chip);
  const away = useChatStudio((s) => s.away);
  const wording = useAppConfigStore((s) => s.guide.wording);
  const store = useChatStudio.getState;

  const width = useWindowWidth();
  const [focusUnit, setFocusUnit] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [spread, setSpread] = useState(0);
  const layout: GuideLayout = guideLayout({ hasBook: journey.hasBook, width, focusRequested: focusUnit !== null });
  const locale = chatLocaleOf(project);
  const memory = useGuideMemory(project.id);

  const view: BookViewId | null =
    (chosenView && journey.views.includes(chosenView) ? chosenView : journey.suggestedView) ??
    journey.views[0] ??
    null;
  const bookLeads = journey.phase === "pages" || journey.phase === "order";
  // A finished book opens at its front cover.
  const finished = journey.phase === "order";
  useEffect(() => {
    if (finished) setSpread(0);
  }, [finished]);
  const selectionOnStage =
    layout === "mobile" &&
    (liveWell?.kind === "styleChoice" ||
      liveWell?.kind === "formatChoice" ||
      liveWell?.kind === "layoutChoice");

  const defaultRun = useRef<(() => void) | null>(null);
  const registerDefault = useCallback((run: (() => void) | null) => {
    defaultRun.current = run;
  }, []);

  const openUnit = useCallback(
    (unitId: string, target: BookViewId = "pages") => {
      store().setView(target);
      if (target === "pages") {
        const index = dispIndexOf(displays, unitId);
        if (index >= 0) setSpread(index);
      }
    },
    [displays, store],
  );

  const send = (text: string) => {
    memory.setDraft("");
    void store().send(text);
  };
  const edit = (message: GuideMessage) => {
    void store()
      .undo(message.id)
      .then(() => memory.setDraft(message.text));
  };

  const opening = journey.phase === "opening";
  // While the pictures draw the field stays open for questions, and says so.
  const drawingNow =
    authoringOf(project).drawBook?.phase === "cast" || authoringOf(project).drawBook?.phase === "pages";
  const chipLabel = chip ? targetLabel(chip, t) : null;
  const ideaPlaceholder = useIdeaPlaceholder(project, view);
  // On the Story tab the composer says where its words go: the story. The
  // manuscript is where it is read and typed; changes are asked for here.
  const storyContext =
    view === "story" && !journey.locked && !opening && project.config.storyText.trim().length > 0;
  const composerFocus = useChatStudio((s) => s.composerFocus);
  // A marked passage is what the next message is about; it shows in the composer
  // and on the chips, and goes away with the message.
  const storyMark = useStoryMark((s) => s.mark);
  const markedPassage = storyContext && !chip ? storyMark : null;
  const placeholder = opening
    ? t("startAnywhere")
    : livePlaceholder(session.messages, locale) ??
      (drawingNow ? t("drawingPlaceholder") : null) ??
      (markedPassage ? t("markedPlaceholder") : null) ??
      (storyContext ? t("storyPlaceholder") : null) ??
      ideaPlaceholder ??
      t("askGuide");
  const revisionRunning = useRevisionActivity(project.id);
  const working = journey.working || sending || revisionRunning;
  const extractionRunning = useChatStudio((s) => s.extractionRunning);
  const analysisRunning = useChatStudio((s) => s.analysisRunning);
  const starting = useChatStudio((s) => s.starting);
  const quotes = useChatStudio((s) => s.quotes);
  const cast = namedCast(briefOf(project.config));
  const portraitActive = cast.some((member) => journey.activeUnitIds.has(member.id));
  const portraitProgress = {
    done: cast.filter((member) => Boolean(currentPortrait(project, member.id))).length,
    total: cast.length,
  };
  const requiredAnchors = (project.anchors ?? []).filter((anchor) => anchor.include);
  const preparationProgress = {
    done: requiredAnchors.filter((anchor) =>
      anchorImageIsCurrent(project, anchor),
    ).length,
    total: requiredAnchors.length,
  };
  const drawPhase = authoringOf(project).drawBook?.phase ?? null;
  const activity = guideActivity({
    sending,
    extractionRunning,
    analysisRunning,
    planRunning: journey.planRunning,
    storyRunning: journey.storyStatus === "running",
    revisionRunning,
    estimating: Object.values(quotes).some((quote) => quote.status === "loading"),
    startingBook: Boolean(starting),
    drawPhase,
    preparingBook: drawPhase === "cast",
    preparation: preparationProgress,
    portraitsRunning: portraitActive,
    portraits: portraitProgress,
    pagesRunning: journey.phase === "pages" && journey.pages.done < journey.pages.total,
    pages: journey.pages,
  });

  // The book turns to what the conversation just discussed. An edit on the
  // book changes the card without a new line, and leaves the open tab alone.
  const focusContext = contextualBookFocus(liveWell, activity);
  const lastMessageId = session.messages[session.messages.length - 1]?.id ?? "";
  const followedTurn = useRef<string | null>(null);
  useEffect(() => {
    if (!focusContext || followedTurn.current === lastMessageId) return;
    followedTurn.current = lastMessageId;
    if (journey.views.includes(focusContext.view) && chosenView !== focusContext.view) {
      store().setView(focusContext.view);
    }
  }, [chosenView, focusContext, journey.views, lastMessageId, store]);

  // On a phone the conversation is a sheet. Selecting a face opens it, because
  // that is where their photo, drawing, and description choices are.
  useEffect(() => {
    if (layout === "mobile" && chip?.kind === "person") setSheet(true);
  }, [chip, layout]);

  const conflict = useProjectsStore((s) => s.bookConflict?.projectId === project.id);
  const well = conflict ? (
    <ConflictCard key="conflict" />
  ) : opening ? (
    <EntryShortcuts
      guideLabel={label("guideMe")}
      ownLabel={label("ownWords")}
      onChoose={(entry) =>
        void store().tap(label(entry === "guided" ? "guideMe" : "ownWords"), () => store().chooseEntry(entry))
      }
    />
  ) : (
    <ComposerWell
      key="well"
      well={liveWell}
      project={project}
      onView={(v) => store().setView(v)}
      onOpenUnit={(unitId) => openUnit(unitId)}
      onOrder={() => onOrdering(true)}
      onDefault={registerDefault}
    />
  );

  // A suggestion that runs is the reader's own line, like any tap: the thread
  // keeps the record, and the skill answers it the same way as a typed sentence.
  const runIdea = (idea: GuideIdea, text: string) => {
    const chat = store();
    // An idea about the marked passage never runs without it: a chip that was
    // showing when the mark went away would otherwise rework the whole story.
    const mark = idea.marked ? takeMark() : null;
    if (idea.marked && !mark) return;
    memory.setDraft("");
    if (idea.command === "reviseStory") {
      void chat.tap(text, () => chat.runSkill({ id: "reviseStory", args: { instruction: text } }, { mark }), { mark });
    } else if (idea.command === "checkStory") {
      void chat.tap(text, () => chat.runSkill({ id: "checkStory", args: {} }));
    } else {
      send(text);
    }
  };

  const composer = (
    <div className="flex flex-col gap-2">
      <ActivityStatus activity={activity} />
      {talk.held && !working && (
        <WaitingNotice label={t("waitingOne")} action={t("waitingShow")} onShow={talk.release} />
      )}
      {talk.composer &&
        !opening &&
        (!journey.chatWell || talk.held) &&
        !conflict &&
        !working &&
        !memory.draft.trim() && (
          <IdeaChips
            project={project}
            view={view}
            messages={session.messages}
            marked={Boolean(markedPassage)}
            onPick={memory.setDraft}
            onRun={runIdea}
          />
        )}
      {talk.composer ? (
        <Composer
            value={memory.draft}
            onChange={memory.setDraft}
            onSend={send}
            onAcceptDefault={() => {
              // Enter on an empty field takes a free recommended choice; a card that
              // spends Sparks or changes the book runs on a tap and nothing else.
              if (liveWell && ENTER_NEVER_ACCEPTS.has(liveWell.kind)) return;
              defaultRun.current?.();
            }}
            placeholder={placeholder}
            chip={chipLabel}
            onClearChip={() => store().setChip(null)}
            context={storyContext ? t("storyContext") : null}
            quote={markedPassage ? markExcerpt(markedPassage.text, 60) : null}
            onClearQuote={() => useStoryMark.getState().setMark(null)}
            tools={
              <IdeaMenu
                project={project}
                view={view}
                onPick={(text) => {
                  memory.setDraft(text);
                  useChatStudio.setState((state) => ({ composerFocus: state.composerFocus + 1 }));
                }}
                onRun={runIdea}
              />
            }
            focusSignal={composerFocus}
            locale={locale}
            onLocale={(next) => void store().setChatLocale(next)}
            working={working}
            autoFocus={layout !== "mobile"}
          />
      ) : journey.entry === "own" && !activity ? (
        <button
          type="button"
          onClick={() => void store().askGuide()}
          className="inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-white hover:text-ink-900 hover:shadow-soft"
        >
          <MessageCircle className="size-4" />
          {t("askGuide")}
        </button>
      ) : (
        null
      )}
    </div>
  );

  const failedCount = journey.pages.failed.length;
  const awayText = away
    ? [away, failedCount > 0 ? guideCopy(wording, "awayPages", { count: failedCount }) : null].filter(Boolean).join(" ")
    : null;
  const awayRow = awayText ? <AwayRow text={awayText} onDismiss={() => store().dismissAway()} /> : null;

  const thread = (
    <ChatThread
      messages={session.messages}
      project={project}
      locale={locale}
      sending={sending}
      onUndo={(id) => void store().undo(id)}
      onEdit={edit}
      onRetry={() => void store().retry()}
      onOpenCast={() => store().setView("cast")}
      onOpenUnit={(unitId, target) => openUnit(unitId, target)}
      away={awayRow}
      scrollKey={project.id}
      task={selectionOnStage ? null : well}
      taskKey={opening ? "entry" : `${chatTaskKey(liveWell)}:${chip?.kind === "person" ? chip.castId : ""}`}
      className={opening ? "flex-none overflow-visible px-5 pt-2 pb-1" : undefined}
      wideTask={
        liveWell?.kind === "styleChoice" ||
        liveWell?.kind === "formatChoice" ||
        liveWell?.kind === "layoutChoice"
      }
    />
  );

  const center = composer;

  const bookPane = (
    <BookPane
      project={project}
      journey={journey}
      activity={activity}
      view={view}
      spread={spread}
      onSpread={setSpread}
      onFocus={(unitId) => {
        setFocusUnit(unitId);
        store().setFocus(true);
      }}
    />
  );

  const leaveFocus = () => {
    setFocusUnit(null);
    setOverlay(false);
    store().setFocus(false);
  };

  if (!loaded) return <div className="flex-1" />;

  return (
    <LayoutGroup>
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-canvas">
        {layout === "centered" || (layout === "mobile" && !journey.hasBook) ? (
          <motion.section
            layout
            transition={layoutMove}
            className="mx-auto flex min-h-0 w-full max-w-[42rem] flex-1 flex-col px-2 sm:px-4"
          >
            <div className="flex min-h-0 flex-1 flex-col justify-end">
              {opening && <OpeningScene />}
              {thread}
            </div>
            <div className="shrink-0 px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-10">{center}</div>
          </motion.section>
        ) : layout === "mobile" ? (
          <MobileLayout
            journey={journey}
            view={view}
            stage={selectionOnStage ? well : null}
            book={focusUnit ? null : bookPane}
            focus={
              focusUnit ? (
                <PageFocus
                  project={project}
                  unitId={focusUnit}
                  onLeave={leaveFocus}
                  composer={composer}
                  conversation={thread}
                  overlayOpen={overlay}
                  onOverlay={setOverlay}
                  showConversationToggle
                />
              ) : null
            }
            composer={center}
            lastLine={lastGuideLine(session.messages, locale)}
            hasTask={Boolean(liveWell) || opening || conflict}
            onOpenSheet={() => setSheet(true)}
          />
        ) : layout === "focus" ? (
          <motion.div layout transition={layoutMove} className="flex min-h-0 flex-1 flex-col">
            <PageFocus
              project={project}
              unitId={focusUnit}
              onLeave={leaveFocus}
              composer={composer}
              conversation={thread}
              overlayOpen={overlay}
              onOverlay={setOverlay}
              showConversationToggle
            />
          </motion.div>
        ) : (
          <>
            <motion.aside
              layout
              transition={layoutMove}
              className={cn(
                "flex min-h-0 shrink-0 flex-col border-r border-ink-900/5",
                bookLeads ? "w-104 xl:w-120" : "w-[min(44rem,58%)] min-w-96",
              )}
            >
              {thread}
              <div className="shrink-0 px-4 pt-2 pb-5">{center}</div>
            </motion.aside>
            <motion.main
              variants={paneIn}
              initial="hidden"
              animate="show"
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                bookLeads
                  ? "bg-[linear-gradient(180deg,rgba(15,23,42,0.015),rgba(15,23,42,0.035))]"
                  : "bg-canvas",
              )}
            >
              {focusUnit ? (
                <PageFocus
                  project={project}
                  unitId={focusUnit}
                  onLeave={leaveFocus}
                  composer={null}
                  conversation={null}
                  overlayOpen={false}
                  onOverlay={() => {}}
                  showConversationToggle={false}
                />
              ) : (
                bookPane
              )}
            </motion.main>
          </>
        )}

        <Drawer open={sheet && layout === "mobile"} onClose={() => setSheet(false)} side="bottom" title={t("conversation")}>
          <div className="flex max-h-[70vh] min-h-[40vh] flex-col">{thread}</div>
        </Drawer>

        <AnimatePresence>
          {ordering && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-0 z-40 overflow-y-auto bg-canvas"
            >
              <OrderCheckout onBack={() => onOrdering(false)} project={project} pages={pages} design={design} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

/** A choice is waiting while the reader writes; it comes back when they are done, or when they ask. */
function WaitingNotice({ label, action, onShow }: { label: string; action: string; onShow: () => void }) {
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-ink-500" role="status">
      <span aria-hidden className="size-1.5 rounded-full bg-magic-400" />
      <span>{label}</span>
      <button
        type="button"
        onClick={onShow}
        className="rounded-full px-2 py-0.5 font-medium text-ink-700 underline-offset-2 transition hover:bg-white hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        {action}
      </button>
    </div>
  );
}

function EntryShortcuts({
  guideLabel,
  ownLabel,
  onChoose,
}: {
  guideLabel: string;
  ownLabel: string;
  onChoose: (entry: "guided" | "own") => void;
}) {
  const t = useGuideT("chrome");
  return (
    <section
      className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-900/8"
      aria-label={t("chooseHowToStart")}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-ink-100 pb-2.5">
        <span className="font-display text-sm font-semibold text-ink-900">
          {t("chooseHowToStart")}
        </span>
        <span className="rounded-full bg-magic-50 px-2 py-1 text-[10px] font-semibold text-magic-700">
          {t("statusChooseOne")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChoose("guided")}
          className="min-h-11 rounded-full bg-ink-900 px-5 text-sm font-medium text-white transition hover:bg-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          {guideLabel}
        </button>
        <button
          type="button"
          onClick={() => onChoose("own")}
          className="min-h-11 rounded-full bg-white px-5 text-sm font-medium text-ink-900 ring-1 ring-ink-200 transition hover:ring-ink-400 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          {ownLabel}
        </button>
      </div>
    </section>
  );
}

function contextualBookFocus(
  chatWell: ChatWell | null,
  activity: GuideActivity | null,
): { key: string; view: BookViewId } | null {
  const well = chatWell?.kind;
  if (chatWell?.kind === "agentBlocked" && chatWell.remedy.view) {
    return { key: `blocked-${chatWell.remedy.requirement}`, view: chatWell.remedy.view };
  }
  if (well === "styleChoice") return { key: "look-choice", view: "style" };
  if (well === "drawingAssign" || well === "castFix" || well === "portraits") {
    return { key: `people-${well}`, view: "cast" };
  }
  if (well === "pageFix" || well === "printFix" || well === "order") {
    return { key: `pages-${well}`, view: "pages" };
  }
  if (
    well === "storyRetry" ||
    well === "manuscriptChoice" ||
    well === "drawBook"
  ) {
    return { key: `story-${well}`, view: "story" };
  }
  if (activity?.id === "drawingPeople") {
    return { key: "drawing-people", view: "cast" };
  }
  if (activity?.id === "preparingBook") {
    return { key: "preparing-book", view: "cast" };
  }
  if (activity?.id === "drawingPages") {
    return { key: "drawing-pages", view: "pages" };
  }
  if (
    activity?.id === "readingStory" ||
    activity?.id === "writingStory" ||
    activity?.id === "revisingStory" ||
    activity?.id === "planningPages"
  ) {
    return { key: activity.id, view: "story" };
  }
  return null;
}

function chatTaskKey(well: ChatWell | null): string {
  if (!well) return "none";
  switch (well.kind) {
    case "portraits":
      return `${well.kind}:${well.castIds.join(",")}`;
    case "bookPrepFix":
      return `${well.kind}:${well.unitIds.join(",")}`;
    case "pageFix":
    case "printFix":
      return `${well.kind}:${well.unitId}`;
    case "agentConfirm":
      return `${well.kind}:${well.confirm.hash}`;
    case "castLooks":
      return `${well.kind}:${well.castId}`;
    default:
      return well.kind;
  }
}

function BookPane({
  project,
  journey,
  activity,
  view,
  spread,
  onSpread,
  onFocus,
}: {
  project: Project;
  journey: ChatJourney;
  activity: GuideActivity | null;
  view: BookViewId | null;
  spread: number;
  onSpread: (index: number) => void;
  onFocus: (unitId: string) => void;
}) {
  const setView = useChatStudio((s) => s.setView);
  const viewKey = journey.views.join("\0");
  const seenViews = useRef<string | null>(null);
  const [arrivedKey, setArrivedKey] = useState<string | null>(null);
  if (seenViews.current !== viewKey) {
    const previous = seenViews.current;
    seenViews.current = viewKey;
    if (previous !== null) {
      const before = new Set(previous ? previous.split("\0") : []);
      const fresh = viewKey.split("\0").filter((id) => id && !before.has(id));
      const key = fresh.join("\0");
      if (key && key !== arrivedKey) setArrivedKey(key);
    }
  }
  const arrived = useMemo(
    () => new Set((arrivedKey ? arrivedKey.split("\0") : []) as BookViewId[]),
    [arrivedKey],
  );
  useEffect(() => {
    if (!arrivedKey) return;
    const fresh = arrivedKey.split("\0");
    const newest = fresh[fresh.length - 1];
    if (newest) setView(newest as BookViewId);
    const timer = window.setTimeout(() => setArrivedKey(null), 1400);
    return () => window.clearTimeout(timer);
  }, [arrivedKey, setView]);
  const attention = useMemo(() => {
    const out = new Set<BookViewId>();
    if (journey.pages.failed.length > 0 || journey.stalePages.length > 0) out.add("pages");
    if (journey.chatWell?.kind === "castFix") out.add("cast");
    return out;
  }, [journey.pages.failed.length, journey.stalePages.length, journey.chatWell]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-900/5 px-4 sm:px-6">
        <ViewSwitch
          views={journey.views}
          active={view}
          onChange={setView}
          attention={attention}
          arrived={arrived}
        />
        <div className="flex shrink-0 items-center gap-3">
          {!journey.locked && !project.config.storyText.trim() && journey.entry && (
            <StorySourceSwitch value={journey.entry} onChange={(entry) => void useChatStudio.getState().chooseEntry(entry)} />
          )}
          {journey.locked && journey.pages.total > 0 && journey.pages.done < journey.pages.total && (
            <PagesProgress done={journey.pages.done} total={journey.pages.total} />
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view ?? "none"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0"
          >
            {view === "style" && <StyleView project={project} locked={journey.locked} />}
            {view === "cast" && <CastView project={project} locked={journey.locked} />}
            {view === "story" && <StoryView project={project} locked={journey.locked} />}
            {view === "pages" && (
              <PagesView
                project={project}
                index={spread}
                onIndex={onSpread}
                onFocus={onFocus}
                stalePages={journey.stalePages}
              />
            )}
          </motion.div>
        </AnimatePresence>
        {activity && activity.id !== "understanding" && activity.id !== "estimating" && (
          <div className="pointer-events-none absolute top-4 left-1/2 z-20 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2">
            <ActivityStatus activity={activity} compact />
          </div>
        )}
      </div>
    </div>
  );
}

function StorySourceSwitch({
  value,
  onChange,
}: {
  value: "guided" | "own";
  onChange: (value: "guided" | "own") => void;
}) {
  const t = useGuideT("chrome");
  return (
    <div className="flex items-center rounded-full bg-ink-100/80 p-0.5" aria-label={t("storySource")}>
      {(["guided", "own"] as const).map((entry) => (
        <button
          key={entry}
          type="button"
          aria-pressed={value === entry}
          onClick={() => onChange(entry)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
            value === entry ? "bg-white text-ink-900 shadow-2xs" : "text-ink-500 hover:text-ink-800",
          )}
        >
          {entry === "guided" ? t("guidedSource") : t("ownSource")}
        </button>
      ))}
    </div>
  );
}

function PagesProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-ink-500" aria-live="polite">
      <span className="relative block h-1 w-20 overflow-hidden rounded-full bg-ink-100">
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-magic-500"
          initial={false}
          animate={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </span>
      <span className="tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

function MobileLayout({
  journey,
  view,
  stage,
  book,
  focus,
  composer,
  lastLine,
  hasTask,
  onOpenSheet,
}: {
  journey: ChatJourney;
  view: BookViewId | null;
  /** A choice that fills the screen until it is made. The book waits. */
  stage: React.ReactNode;
  book: React.ReactNode;
  focus: React.ReactNode;
  composer: React.ReactNode;
  lastLine: string | null;
  hasTask: boolean;
  onOpenSheet: () => void;
}) {
  const t = useGuideT("chrome");
  if (focus) return <div className="flex min-h-0 flex-1 flex-col">{focus}</div>;
  if (stage) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-canvas" data-phase={journey.phase}>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
          {lastLine && (
            <p className="mb-3 border-l-2 border-magic-200/80 px-3 font-display text-[15.5px] leading-7 text-ink-900 [text-wrap:pretty]">
              {lastLine}
            </p>
          )}
          {stage}
        </div>
        <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{composer}</div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-view={view ?? undefined} data-phase={journey.phase}>
      <div className="min-h-0 flex-1">{book}</div>
      <div className="shrink-0 rounded-t-3xl bg-canvas px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-ink-900/5">
        {(lastLine || hasTask) && (
          <button
            type="button"
            onClick={onOpenSheet}
            aria-label={t("conversation")}
            className="mb-2 flex w-full flex-col items-stretch gap-2 rounded-xl px-1 pb-1 text-left transition active:bg-ink-50"
          >
            <span aria-hidden className="mx-auto block h-1 w-8 rounded-full bg-ink-200" />
            <span className="flex items-start justify-between gap-3">
              <span className="line-clamp-2 font-display text-[15px] leading-snug text-ink-900">
                {lastLine ?? t("continueInConversation")}
              </span>
              {hasTask && (
                <span className="shrink-0 rounded-full bg-magic-50 px-2 py-1 text-[10px] font-semibold text-magic-700">
                  {t("actionWaiting")}
                </span>
              )}
            </span>
          </button>
        )}
        {composer}
      </div>
    </div>
  );
}

const SLOW_ACTIVITY_MS = 15_000;

function ActivityStatus({
  activity,
  compact = false,
}: {
  activity: GuideActivity | null;
  compact?: boolean;
}) {
  const t = useGuideT("chrome");
  const id = activity?.id ?? null;
  // A wait that runs long says so, so a quiet minute doesn't read as a failure.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    // Counted work already shows its own progress.
    if (!id || id === "drawingPages" || id === "drawingPeople" || id === "preparingBook") return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_ACTIVITY_MS);
    return () => window.clearTimeout(timer);
  }, [id]);
  if (!activity) return null;
  const text =
    activity.id === "drawingPages" && activity.total > 0
      ? t("drawingPages", { n: Math.min(activity.done + 1, activity.total), total: activity.total })
      : t(activity.id);
  const determinate =
    activity.id === "drawingPages" ||
    activity.id === "drawingPeople" ||
    activity.id === "preparingBook"
      ? activity
      : null;
  const progress =
    determinate && determinate.total > 0
      ? Math.max(0, Math.min(100, (determinate.done / determinate.total) * 100))
      : null;
  return (
    <div
      role={compact ? undefined : "status"}
      aria-live={compact ? undefined : "polite"}
      aria-hidden={compact || undefined}
      className={cn(
        "overflow-hidden rounded-xl border border-magic-200/70 bg-white/95 shadow-soft backdrop-blur-sm",
        compact ? "px-3 py-2" : "px-3.5 py-3",
      )}
    >
      <div className="flex items-center gap-2.5 text-sm font-medium text-ink-800">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-magic-50 text-magic-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{text}</span>
          {slow && (
            <span className="block truncate text-xs font-normal text-ink-500">{t("stillWorking")}</span>
          )}
        </span>
        {progress !== null && (
          <span className="text-xs tabular-nums text-ink-400">
            {determinate!.done}/{determinate!.total}
          </span>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-magic-100">
        {progress === null ? (
          <motion.span
            className="block h-full w-1/3 rounded-full bg-magic-500"
            animate={{ x: ["-100%", "300%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <motion.span
            className="block h-full rounded-full bg-magic-500"
            initial={false}
            animate={{ width: `${progress}%` }}
          />
        )}
      </div>
    </div>
  );
}

function AwayRow({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-ink-700 shadow-soft ring-1 ring-ink-900/5"
    >
      <span className="flex-1">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 flex size-6 items-center justify-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-800"
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

function targetLabel(target: GuideTarget, t: ReturnType<typeof useGuideT>): string {
  if (target.kind === "person") return target.name;
  if (target.kind === "cover") return t("cover");
  return t("page", { n: target.page });
}

function lastGuideLine(messages: readonly GuideMessage[], locale: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.pending) continue;
    if (message.role === "guide" && !isQuietMessage(message)) return messageText(message, locale);
  }
  return null;
}

/** The live question as the placeholder, when the guide's last line asks one. */
function livePlaceholder(messages: readonly GuideMessage[], locale: string): string | null {
  const last = latestTurn(messages);
  if (!last || last.role !== "guide" || last.pending) return null;
  const text = messageText(last, locale).trim();
  if (!text.endsWith("?")) return null;
  const sentence = text.split(/(?<=[.!])\s+/).pop() ?? text;
  return sentence.length <= 80 ? sentence : null;
}
