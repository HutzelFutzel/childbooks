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
import type { AgentWell as ChatStudioAgentWell } from "../../state/guideAgent";
import { BusyLine, BusyPill } from "./book/BusyPill";
import { useBookBusy } from "../../state/useBookBusy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describePages, interiorUnitIds, pagesNamedIn } from "../../core/book/pageRefs";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2, MessageCircle, Sparkles, X } from "lucide-react";
import { cardPlaceholderKind, ENTER_NEVER_ACCEPTS, guideActivity, type GuideActivity } from "../../core/guide/activity";
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
import { useMilestoneReached, usePreviewReached } from "../studio/useMilestoneReached";
import { reportGuideEventRemote } from "../../platform/aiClient";
import { EbookCheckout } from "../checkout/EbookDialog";
import { useAuthStore } from "../../state/authStore";
import { Drawer } from "../components/Drawer";
import { cn } from "../lib/cn";
import { StudioProvider, useStudio } from "../studio/StudioContext";
import type { StudioDestination } from "../studio/studioRoutes";
import { CastView } from "./book/CastView";
import { PageFocus } from "./book/PageFocus";
import { PagesView } from "./book/PagesView";
import { StoryView } from "./book/StoryView";
import { StyleView } from "./book/StyleView";
import { dispIndexOf, dispUnitIds, unitTarget } from "./book/units";
import { usePrintCheck } from "./book/usePrintCheck";
import { ModeSwitch, type BookMode } from "./book/ModeSwitch";
import { ViewSwitch } from "./book/ViewSwitch";
import { ChatThread } from "./chat/ChatThread";
import { Composer } from "./chat/Composer";
import { ComposerWell } from "./chat/ComposerWell";
import { activeQuestion } from "../../core/guide/questions";
import { IdeaChips, useIdeaPlaceholder } from "./chat/IdeaChips";
import { IdeaMenu } from "./chat/IdeaMenu";
import { ConflictCard } from "./chat/ConflictCard";
import { GuideAvatar } from "./chat/GuideAvatar";
import { OpeningScene } from "./chat/OpeningScene";
import { GuideIntl, useGuideLabel, useGuideList, useGuideT } from "./intl";
import { useHandOverStory } from "./useHandOverStory";
import { layoutMove, paneIn } from "./motion";
import { useChatDrivers } from "./useChatDrivers";
import { useChatJourney, type ChatJourney, type ChatWell } from "./useChatJourney";
import { useGuideMemory } from "./useGuideMemory";
import { useCardHold, useWellConversation } from "./useWellConversation";
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

/** The step card's Enter default while a reply beside it takes Enter. */
function ignoreDefault(): void {}

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
  // What only the browser can see, for the flow comparison: the setup was locked,
  // the book became finished, and the reader opened the order panel. The last is
  // reported from `ordering` — what they opened — not from the journey, which only
  // says the book is ready for it.
  useMilestoneReached(project.id, journey.locked, "setupLocked");
  useMilestoneReached(project.id, journey.phase === "order", "finished");
  usePreviewReached(project.id, ordering);
  // Every opening, not just the first: coming back to the order panel after
  // thinking about it is itself something the funnel should see. (The milestone
  // above keeps only the first, which is what the arm comparison needs.)
  useEffect(() => {
    if (ordering) reportGuideEventRemote({ projectId: project.id, kind: "orderOpened" });
  }, [ordering, project.id]);
  usePrintCheck(project, journey.locked && journey.pages.total > 0 && journey.pages.done === journey.pages.total);
  const { holding, hold } = useCardHold();
  const talk = useWellConversation(project, journey, holding);
  // The latest card: a reply beside the step card, else the step card.
  const liveWell = talk.beside ?? talk.well;

  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const { displays, pages, design, editingDispId, setEditingDisp } = useStudio();
  // The digital edition is sold from the same overlay as the printed one: one
  // step sideways from the order screen, rather than a door only the legacy
  // studio had. Offered to full accounts only, as the purchase itself requires.
  const ebookEnabled = useAppConfigStore((s) => s.pricingSettings.ebook.enabled);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const [buyingEbook, setBuyingEbook] = useState(false);
  useEffect(() => {
    if (!ordering) setBuyingEbook(false);
  }, [ordering]);
  const session = useChatStudio((s) => s.session);
  const loaded = useChatStudio((s) => s.loaded);
  const sending = useChatStudio((s) => s.sending);
  const storyFocus = useChatStudio((s) => s.storyFocus);
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
  // Only when nothing of the pages is on screen: a reader looking at a page, in Preview or Edit, is never moved.
  useEffect(() => {
    if (finished && view !== "pages" && focusUnit === null) setSpread(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
  const selectionOnStage =
    layout === "mobile" &&
    (talk.well?.kind === "styleChoice" ||
      talk.well?.kind === "formatChoice" ||
      talk.well?.kind === "layoutChoice");

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
        // In Edit the page on the canvas is the page: take it there, or the button seems to do nothing.
        if (focusUnit) {
          setFocusUnit(unitId);
          if (index >= 0) setEditingDisp(displays[index]!.id);
        }
      } else if (focusUnit) {
        setFocusUnit(null);
        setOverlay(false);
        store().setFocus(false);
      }
    },
    [displays, store, focusUnit, setEditingDisp],
  );

  // What "@" names in the message field: the finished book's pages, in the words the chat reads back.
  const mentions = useMemo(
    () =>
      journey.locked
        ? [
            ...interiorUnitIds(project).map((id, index) => ({
              id,
              label: t("page", { n: index + 1 }),
              text: t("page", { n: index + 1 }).toLowerCase(),
            })),
            { id: COVER_FRONT_ID, label: t("mentionFrontCover"), text: t("mentionFrontCover") },
            { id: COVER_BACK_ID, label: t("mentionBackCover"), text: t("mentionBackCover") },
          ]
        : undefined,
    [journey.locked, project, t],
  );

  // "Order the book", typed: the order screen opens here. The price and the buy button are on it.
  const orderRequest = useChatStudio((s) => s.orderRequest);
  const lastOrder = useRef(orderRequest);
  useEffect(() => {
    if (orderRequest === lastOrder.current) return;
    lastOrder.current = orderRequest;
    onOrdering(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRequest]);

  // A reference in the chat ("show me page 12", a page the reader named) brings that page into view.
  const pageJump = useChatStudio((s) => s.pageJump);
  const lastJump = useRef(0);
  useEffect(() => {
    if (!pageJump || pageJump.nonce === lastJump.current) return;
    lastJump.current = pageJump.nonce;
    // A page that is already in front of the reader needs no move (and Edit stays Edit).
    if (store().looking.includes(pageJump.unitId)) return;
    openUnit(pageJump.unitId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageJump]);

  const send = (text: string) => {
    // A turn is still being answered: `send` would drop this message, so keep
    // it in the field (the composer holds its send button for the same reason).
    if (store().sending) return;
    memory.setDraft("");
    void store().send(text);
  };
  const edit = (message: GuideMessage) => {
    void store()
      .undo(message.id, { quiet: true })
      .then(() => memory.setDraft(message.text));
  };

  const opening = journey.phase === "opening";
  const cast = namedCast(briefOf(project.config));
  const activePortraitNames = cast
    .filter((member) => journey.activeUnitIds.has(member.id))
    .map((member) => member.name.trim())
    .filter(Boolean);
  const portraitActive = activePortraitNames.length > 0;
  // While the pictures draw the field stays open for questions, and says so.
  const drawingNow =
    authoringOf(project).drawBook?.phase === "cast" ||
    authoringOf(project).drawBook?.phase === "pages" ||
    portraitActive;
  // The pill follows the reader: what they selected; else the pages their sentence names, live as they type
  // (a typo like "page 18" with page 4 selected shows page 18, which is what will happen); else the pages in view.
  const looking = useChatStudio((s) => s.looking);
  const typedPages =
    journey.locked && view === "pages" && chip?.kind !== "person" && memory.draft.trim()
      ? pagesNamedIn(memory.draft, project).ids
      : [];
  const pagesLabel = (ids: readonly string[]) => {
    const text = describePages(project, ids);
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const followingPages = journey.locked && view === "pages" && !chip && looking.length > 0;
  const chipTone: "pinned" | "typed" | "following" =
    typedPages.length > 0 ? "typed" : chip ? "pinned" : "following";
  const chipLabel =
    typedPages.length > 0
      ? pagesLabel(typedPages)
      : chip
        ? targetLabel(chip, t)
        : followingPages
          ? pagesLabel(looking)
          : null;
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
  const bookDrawing =
    authoringOf(project).drawBook?.phase === "cast" || authoringOf(project).drawBook?.phase === "pages";
  // With a card open, the card asks; the field never repeats its question. It
  // says what a typed line would do beside this card instead.
  const cardOpen = !opening && liveWell !== null;
  // Nobody is in the book yet and the guide asked who: the field shows what an answer looks like.
  const question = useMemo(() => activeQuestion(journey, liveWell), [journey, liveWell]);
  const questionName =
    liveWell?.kind === "castLooks"
      ? chip?.kind === "person"
        ? chip.name
        : liveWell.name
      : cast[0]?.name.trim();
  const answeringWho =
    !opening && journey.entry === "guided" && !journey.hasBook && journey.missing[0] === "names";
  const placeholder = opening
    ? t("startAnywhere")
    : sending
      ? t("sendingPlaceholder")
      : (drawingNow ? t(bookDrawing ? "drawingBookPlaceholder" : "drawingPeoplePlaceholder") : null) ??
        (markedPassage ? t("markedPlaceholder") : null) ??
        // A face is selected: what is typed is about them, and the field says so.
        (chip?.kind === "person" ? t("personPlaceholder", { name: chip.name }) : null) ??
        (cardOpen
          ? liveWell.kind === "storyBrief"
            ? t("briefPlaceholder")
            : t(cardPlaceholderKind(liveWell.kind) === "type" ? "cardTypePlaceholder" : "cardPickPlaceholder")
          : null) ??
        (answeringWho ? t("namesPlaceholder") : null) ??
        livePlaceholder(session.messages, locale) ??
      (storyContext ? t("storyPlaceholder") : null) ??
      ideaPlaceholder ??
      t("askGuide");
  const revisionRunning = useRevisionActivity(project.id);
  const working = journey.working || sending || revisionRunning;
  const extractionRunning = useChatStudio((s) => s.extractionRunning);
  const analysisRunning = useChatStudio((s) => s.analysisRunning);
  const starting = useChatStudio((s) => s.starting);
  const quotes = useChatStudio((s) => s.quotes);
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
    waiting: journey.chatWell ? null : journey.waiting,
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
  const blockedWell = useChatStudio((s) => s.agentWell);
  const focusContext = contextualBookFocus(liveWell, activity, blockedWell);
  const lastMessageId = session.messages[session.messages.length - 1]?.id ?? "";
  const followedTurn = useRef<string | null>(null);
  useEffect(() => {
    const token = focusContext ? `${lastMessageId}:${focusContext.key}` : null;
    if (!focusContext || !token || followedTurn.current === token) return;
    followedTurn.current = token;
    // Never pull the book away from the story the reader is typing or reviewing.
    if (storyFocus) return;
    if (journey.views.includes(focusContext.view) && chosenView !== focusContext.view) {
      store().setView(focusContext.view);
    }
  }, [chosenView, focusContext, journey.views, lastMessageId, store, storyFocus]);

  // On a phone the conversation is a sheet. Selecting a face opens it, because
  // that is where their photo, drawing, and description choices are.
  useEffect(() => {
    if (layout === "mobile" && chip?.kind === "person") setSheet(true);
  }, [chip, layout]);

  const conflict = useProjectsStore((s) => s.bookConflict?.projectId === project.id);
  // A save conflict is asked above the card, never in its place: the card and
  // what was typed into it stay where they are.
  const well = opening ? (
    <EntryShortcuts
      guideLabel={label("guideMe")}
      ownLabel={label("ownWords")}
      onChoose={(entry) =>
        void store().tap(label(entry === "guided" ? "guideMe" : "ownWords"), () => store().chooseEntry(entry))
      }
    />
  ) : (
    <div className="flex flex-col gap-3">
      {conflict && <ConflictCard key="conflict" />}
      {/* A reply to the reader, or a failure, comes in above the step card; the
          step card stays where it is until it is answered. */}
      {talk.beside && (
        <ComposerWell
          key="beside"
          well={talk.beside}
          cardKey={talk.besideId}
          person={false}
          project={project}
          onView={(v) => store().setView(v)}
          onOpenUnit={(unitId) => openUnit(unitId)}
          onOrder={() => onOrdering(true)}
          onDefault={registerDefault}
        />
      )}
      <div key="well" {...hold}>
        <ComposerWell
          well={talk.well}
          cardKey={talk.wellId}
          project={project}
          onView={(v) => store().setView(v)}
          onOpenUnit={(unitId) => openUnit(unitId)}
          onOrder={() => onOrdering(true)}
          onDefault={talk.beside ? ignoreDefault : registerDefault}
        />
      </div>
      <BusyLine project={project} />
    </div>
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
      <ActivityStatus activity={activity} activePortraitNames={activePortraitNames} />
      {/* Once the pages exist, what can be typed stays in view whatever else is
          open: there is no next step to protect, and it is how a reader finds the
          chat can change the text, not only the picture. */}
      {talk.composer &&
        !opening &&
        !conflict &&
        !memory.draft.trim() &&
        (journey.locked ||
          (!working && !journey.chatWell) ||
          // Looking at drawn people: what the chat can change about them is
          // worth showing even while a card asks its own question.
          (!working && view === "cast" && portraitProgress.done > 0) ||
          // The guide is waiting on an answer, even with a card up: what one looks like helps.
          (!working && question !== null)) && (
          <IdeaChips
            project={project}
            view={view}
            question={question}
            questionName={questionName}
            messages={session.messages}
            marked={Boolean(markedPassage)}
            onPick={memory.setDraft}
            onRun={runIdea}
          />
        )}
      {!opening &&
        journey.entry === "own" &&
        !journey.handedOver &&
        project.config.storyText.trim() &&
        talk.well?.kind !== "storyDone" &&
        talk.beside?.kind !== "storyDone" && <StoryReadyBar waiting={sending || storyFocus === "reviewing"} />}
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
            chipTone={chipTone}
            onClearChip={() => store().setChip(null)}
            context={storyContext ? t("storyContext") : null}
            mentions={mentions}
            quote={markedPassage ? markExcerpt(markedPassage.text, 60) : null}
            onClearQuote={() => useStoryMark.getState().setMark(null)}
            tools={
              <IdeaMenu
                project={project}
                view={view}
                question={question}
                questionName={questionName}
                onPick={(text) => {
                  memory.setDraft(text);
                  useChatStudio.setState((state) => ({ composerFocus: state.composerFocus + 1 }));
                }}
                onRun={runIdea}
              />
            }
            focusSignal={composerFocus}
            working={working}
            sending={sending}
            quiet={cardOpen}
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
      taskKey={opening ? "entry" : `${talk.wellId ?? "none"}|${talk.besideId ?? ""}:${chip?.kind === "person" ? chip.castId : ""}`}
      className={opening ? "flex-none overflow-visible px-5 pt-2 pb-1" : undefined}
      wideTask={
        talk.well?.kind === "styleChoice" ||
        talk.well?.kind === "formatChoice" ||
        talk.well?.kind === "layoutChoice"
      }
    />
  );

  const center = composer;

  const enterFocus = (unitId: string) => {
    setFocusUnit(unitId);
    store().setFocus(true);
  };

  const leaveFocus = useCallback(() => {
    setFocusUnit(null);
    setOverlay(false);
    store().setFocus(false);
  }, [store]);

  // Preview | Edit. Edit is page focus on the spread that is open; the switch
  // is the way in and the way out. It exists once there is a page to work on.
  const canEdit = journey.locked && displays.length > 0;
  const changeMode = (next: BookMode) => {
    if (next === "preview") {
      leaveFocus();
      return;
    }
    const disp = displays[Math.min(Math.max(0, spread), displays.length - 1)];
    const unitId = disp ? dispUnitIds(disp)[0] : undefined;
    if (!unitId) return;
    store().setView("pages");
    enterFocus(unitId);
  };
  useEffect(() => {
    if (!canEdit && focusUnit) leaveFocus();
  }, [canEdit, focusUnit, leaveFocus]);

  // What "this page" means for a sentence about the finished pages: the page in
  // Edit, else the spread that is open.
  const openDisp = displays[Math.min(Math.max(0, spread), Math.max(0, displays.length - 1))];
  // In Edit, the spread open on the canvas: the reader pages through it there, not through `focusUnit`.
  const editingDisp = focusUnit
    ? displays.find((d) => d.id === editingDispId && dispUnitIds(d).length > 0) ??
      displays[Math.max(0, dispIndexOf(displays, focusUnit))]
    : undefined;
  const lookingAt = focusUnit
    ? editingDisp
      ? dispUnitIds(editingDisp)
      : [focusUnit]
    : openDisp && journey.locked
      ? dispUnitIds(openDisp)
      : [];
  const lookingKey = lookingAt.join("|");
  useEffect(() => {
    const now = lookingKey ? lookingKey.split("|") : [];
    store().setLooking(now);
    // A page the reader selected follows them when they turn to another: the reference in the field
    // is never about a page that is no longer in front of them.
    const pinned = store().chip;
    if (pinned && pinned.kind !== "person" && now.length > 0 && !now.includes(pinned.unitId)) {
      const next = now.length === 1 ? unitTarget(project, now[0]!) : null;
      store().setChip(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookingKey, store]);

  const bookPane = (
    <BookPane
      project={project}
      journey={journey}
      view={view}
      spread={spread}
      onSpread={setSpread}
      onFocus={enterFocus}
      onMode={canEdit ? changeMode : null}
    />
  );

  if (!loaded) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas text-ink-500"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-6 animate-spin text-brand-400" />
        <p className="text-sm font-medium">Opening your conversation…</p>
      </div>
    );
  }

  return (
    <LayoutGroup>
      <div className={cn("relative flex min-h-0 flex-1 overflow-hidden bg-canvas", opening && "bg-aurora")}>
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
            hasTask={Boolean(talk.well || talk.beside) || opening || conflict}
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
                "flex min-h-0 shrink-0 flex-col border-r border-ink-900/8",
                bookLeads ? "w-84 lg:w-96 xl:w-112" : "w-[min(38rem,50%)] min-w-80",
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
                  ? "bg-[radial-gradient(ellipse_at_top,rgba(20,22,58,0.03),rgba(20,22,58,0.065))]"
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
              {buyingEbook ? (
                <EbookCheckout
                  onBack={() => onOrdering(false)}
                  project={project}
                  design={design}
                  cover={pages.find((p) => p.id === COVER_FRONT_ID) ?? pages[0]}
                />
              ) : (
                <OrderCheckout
                  onBack={() => onOrdering(false)}
                  project={project}
                  pages={pages}
                  design={design}
                  onChooseEbook={
                    ebookEnabled && accessLevel === "full" ? () => setBuyingEbook(true) : undefined
                  }
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
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
      className="rounded-2xl bg-linear-to-b from-white to-ink-50/40 p-3.5 shadow-[0_12px_32px_-12px_rgba(20,22,58,0.12),0_1px_3px_rgba(20,22,58,0.06)] ring-1 ring-ink-900/10 sm:p-4"
      aria-label={t("chooseHowToStart")}
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChoose("guided")}
          className="group flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl bg-linear-to-b from-ink-800 to-ink-900 px-4 py-3.5 text-left text-white shadow-[0_2px_8px_-2px_rgba(20,22,58,0.28),inset_0_1px_0_rgba(255,255,255,0.16)] ring-1 ring-ink-900 transition hover:-translate-y-0.5 hover:from-ink-700 hover:to-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          <span className="font-display text-sm font-semibold tracking-tight">{guideLabel}</span>
          <span className="text-xs leading-snug text-white/75">{t("guideMeHint")}</span>
        </button>
        <button
          type="button"
          onClick={() => onChoose("own")}
          className="group flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl bg-white px-4 py-3.5 text-left text-ink-900 shadow-[0_1px_3px_rgba(20,22,58,0.06)] ring-1 ring-ink-200 transition hover:-translate-y-0.5 hover:ring-ink-400 hover:shadow-soft active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          <span className="font-display text-sm font-semibold tracking-tight">{ownLabel}</span>
          <span className="text-xs leading-snug text-ink-500">{t("ownWordsHintEntry")}</span>
        </button>
      </div>
    </section>
  );
}

function contextualBookFocus(
  chatWell: ChatWell | null,
  activity: GuideActivity | null,
  agentWell: ChatStudioAgentWell | null = null,
): { key: string; view: BookViewId } | null {
  const well = chatWell?.kind;
  // A blocked request turns the book to where its way forward is, even when it shows no card.
  if (agentWell?.kind === "agentBlocked" && agentWell.remedy.view) {
    return { key: `blocked-${agentWell.remedy.requirement}`, view: agentWell.remedy.view };
  }
  if (well === "styleChoice") return { key: "look-choice", view: "style" };
  if (well === "drawingAssign" || well === "castFix" || well === "portraits") {
    return { key: `people-${well}`, view: "cast" };
  }
  if (well === "pageFix" || well === "printFix" || well === "order") {
    return { key: `pages-${well}`, view: "pages" };
  }
  if (well === "storyRetry" || well === "manuscriptChoice") {
    return { key: `story-${well}`, view: "story" };
  }
  // The people are what just arrived, so the book opens on them.
  if (well === "drawBook") return { key: "draw-book", view: "cast" };
  if (activity?.id === "drawingPeople") {
    return { key: "drawing-people", view: "cast" };
  }
  if (activity?.id === "preparingBook") {
    return { key: "preparing-book", view: "cast" };
  }
  if (activity?.id === "drawingPages") {
    return { key: "drawing-pages", view: "pages" };
  }
  // Planning the pages is silent work with nothing to show on the story: it
  // must not take the book away from the people who were just drawn.
  if (
    activity?.id === "readingStory" ||
    activity?.id === "writingStory" ||
    activity?.id === "revisingStory"
  ) {
    return { key: activity.id, view: "story" };
  }
  return null;
}

/**
 * Own words: the way on, always beside the message field until the story is
 * handed over. Asking a question or a change in between never removes it.
 */
function StoryReadyBar({ waiting }: { waiting: boolean }) {
  const label = useGuideLabel();
  const handOver = useHandOverStory();
  return (
    <button
      type="button"
      onClick={handOver}
      disabled={waiting}
      className="inline-flex min-h-10 items-center gap-2 self-start rounded-full bg-ink-900 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500"
    >
      {label("storyIsReady")}
      <ArrowRight className="size-4" aria-hidden />
    </button>
  );
}

function BookPane({
  project,
  journey,
  view,
  spread,
  onSpread,
  onFocus,
  onMode,
}: {
  project: Project;
  journey: ChatJourney;
  view: BookViewId | null;
  spread: number;
  onSpread: (index: number) => void;
  onFocus: (unitId: string) => void;
  /** The Preview | Edit switch, once there is a page to edit. */
  onMode: ((mode: BookMode) => void) | null;
}) {
  const setView = useChatStudio((s) => s.setView);
  const orderLabel = useGuideLabel();
  const orderT = useGuideT("chrome");
  const busy = useBookBusy(project);
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
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-ink-900/10 bg-linear-to-b from-white to-ink-50/50 px-2.5 shadow-[0_1px_3px_rgba(20,22,58,0.04)] backdrop-blur-md sm:px-3.5">
        <ViewSwitch
          views={journey.views}
          active={view}
          onChange={setView}
          attention={attention}
          arrived={arrived}
        />
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!journey.locked && journey.storyStatus === "none" && journey.entry && (
            <StorySourceSwitch value={journey.entry} onChange={(entry) => void useChatStudio.getState().chooseEntry(entry)} />
          )}
          {journey.locked && journey.pages.total > 0 && journey.pages.done < journey.pages.total ? (
            <PagesProgress done={journey.pages.done} total={journey.pages.total} />
          ) : (
            journey.locked && <BusyPill project={project} />
          )}
          {onMode && <ModeSwitch mode="preview" onChange={onMode} />}
          {journey.locked && journey.pages.total > 0 && (
            <>
              <span aria-hidden className="hidden h-4 w-px bg-ink-900/12 sm:block" />
              <button
                type="button"
                disabled={busy.busy}
                title={busy.busy ? orderT("busyOrderWait") : undefined}
                onClick={() => useChatStudio.getState().requestOrder()}
                className="relative inline-flex h-8 items-center gap-1.5 rounded-lg bg-linear-to-b from-ink-800 to-ink-900 px-2.5 text-xs font-semibold tracking-[-0.01em] text-white shadow-[0_1px_2px_rgba(20,22,58,0.22),inset_0_1px_0_rgba(255,255,255,0.16)] ring-1 ring-ink-900 transition hover:from-ink-700 hover:to-ink-800 active:scale-[0.99] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-ink-100 disabled:from-ink-100 disabled:to-ink-100 disabled:text-ink-400 disabled:shadow-none disabled:ring-ink-200 sm:px-3"
              >
                {!busy.busy && journey.phase === "order" && (
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.95)]"
                    title={orderT("statusReady")}
                  />
                )}
                <span>{orderLabel("orderBook")}</span>
                <ArrowRight className="hidden size-3.5 opacity-80 xl:block" aria-hidden />
              </button>
            </>
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
    <div
      className="inline-flex h-8 items-center rounded-lg bg-ink-900/[0.05] p-0.5 ring-1 ring-inset ring-ink-900/[0.07]"
      aria-label={t("storySource")}
    >
      {(["guided", "own"] as const).map((entry) => (
        <button
          key={entry}
          type="button"
          aria-pressed={value === entry}
          onClick={() => onChange(entry)}
          className={cn(
            "inline-flex h-7 items-center rounded-[6px] px-2.5 text-xs font-semibold tracking-[-0.01em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
            value === entry
              ? "bg-white text-ink-900 shadow-[0_1px_2px_rgba(20,22,58,0.08),0_0_0_1px_rgba(20,22,58,0.06)]"
              : "text-ink-500 hover:text-ink-800",
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
    <div
      className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-magic-100/70 px-2.5 text-xs font-semibold text-magic-700 ring-1 ring-inset ring-magic-300/70"
      aria-live="polite"
    >
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-magic-500/70 motion-reduce:hidden" />
        <span className="relative size-1.5 rounded-full bg-magic-500" />
      </span>
      <span className="relative block h-1.5 w-14 overflow-hidden rounded-full bg-magic-300/50">
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-magic-500"
          initial={false}
          animate={{ width: `${Math.max(8, Math.round((done / Math.max(1, total)) * 100))}%` }}
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
            <div className="mb-3 flex items-start gap-2.5">
              <GuideAvatar size="sm" className="mt-0.5" />
              <p className="font-display text-[15.5px] leading-7 text-ink-900 [text-wrap:pretty]">
                {lastLine}
              </p>
            </div>
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
            <span className="flex items-start justify-between gap-2.5">
              <span className="flex min-w-0 items-start gap-2">
                <GuideAvatar size="xs" className="mt-0.5" />
                <span className="line-clamp-2 font-display text-[15px] leading-snug text-ink-900">
                  {lastLine ?? t("continueInConversation")}
                </span>
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
  activePortraitNames = [],
}: {
  activity: GuideActivity | null;
  activePortraitNames?: readonly string[];
}) {
  const t = useGuideT("chrome");
  const list = useGuideList();
  const reduce = useReducedMotion();
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
  // A message in flight shows as the guide's typing bubble in the thread + the
  // composer ring trace, unless it runs past the slow threshold.
  if (activity.id === "understanding" && !slow) return null;
  const text =
    activity.id === "drawingPages" && activity.total > 0
      ? t("drawingPages", { n: Math.min(activity.done + 1, activity.total), total: activity.total })
      : activity.id === "drawingPeople" && activePortraitNames.length > 0
        ? t("drawingPeopleNamed", { names: list(activePortraitNames) })
        : t(activity.id);
  const hint =
    activity.id === "drawingPeople"
      ? t("drawingPeopleHint")
      : activity.id === "preparingBook"
        ? t("preparingBookHint")
        : activity.id === "drawingPages"
          ? t("drawingPagesHint")
          : slow
            ? t("stillWorking")
            : null;
  const determinate =
    activity.id === "drawingPages" ||
    activity.id === "drawingPeople" ||
    activity.id === "preparingBook"
      ? activity
      : null;
  const progress =
    determinate && determinate.total > 0
      ? Math.max(6, Math.min(100, (determinate.done / determinate.total) * 100))
      : null;
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-2xl bg-white/95 px-3.5 py-2.5 shadow-soft ring-1 ring-magic-200/80"
    >
      <span
        className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-magic-50 ring-1 ring-magic-200/70"
        aria-hidden
      >
        {!reduce && (
          <span className="absolute -inset-0.5 animate-spin rounded-full border-2 border-magic-200 border-t-magic-500 [animation-duration:2.2s]" />
        )}
        <Sparkles className="size-3.5 text-magic-700" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate font-display text-[13.5px] font-medium tracking-tight text-ink-900">
            {text}
          </span>
          {progress !== null && (
            <span className="shrink-0 rounded-full bg-magic-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-magic-700">
              {determinate!.done}/{determinate!.total}
            </span>
          )}
        </span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-snug font-normal text-ink-500">{hint}</span>
        )}
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-magic-100">
          {progress === null ? (
            reduce ? (
              <span className="block h-full w-1/3 rounded-full bg-magic-400" />
            ) : (
              <motion.span
                className="block h-full w-1/3 rounded-full bg-magic-500"
                animate={{ x: ["-120%", "320%"] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
            )
          ) : (
            <motion.span
              className="block h-full rounded-full bg-magic-500"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          )}
        </span>
      </span>
    </motion.div>
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
