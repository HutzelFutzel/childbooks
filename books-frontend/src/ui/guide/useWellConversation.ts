"use client";

/**
 * The well as part of the conversation: the guide asks, then the buttons show
 * under its line. The card on screen stays until it is answered
 * (`core/guide/cardDeck.ts`); what opens meanwhile comes next, and a reply to
 * the reader or a failure shows beside it, never in its place. When the book
 * moves to a new card, the guide says its line first
 * (`core/guide/conversation.ts`).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FocusEvent } from "react";
import { CARD_GRACE_MS, pickCards, placeCard } from "../../core/guide/cardDeck";
import { briefOf, namedCast } from "../../core/story/brief";
import { ATTENTION_WELLS, wellStage, type WellStage } from "../../core/guide/conversation";
import type { GuideLineCandidate } from "../../core/guide/speech";
import type { Project } from "../../core/types";
import { agentWellTopic } from "../../state/guideAgent";
import { chatLocaleOf, useChatStudio } from "../../state/chatStudio";
import { castAgesAskLine } from "../../core/guide/agent/requirements";
import { readingAgeAskLine } from "../../core/guide/readingAge";
import { IN_PLACE_EDIT_FAILED } from "../../core/pipeline/inPlaceMessage";
import type { ChatJourney, ChatWell } from "./useChatJourney";

/** What a well is about, so a line can say which one it introduced. */
export function wellTopic(well: ChatWell): string {
  switch (well.kind) {
    case "agentConfirm":
    case "agentAsk":
    case "agentBlocked":
    case "sparksOffer":
      return agentWellTopic(well);
    case "pageFix":
    case "printFix":
      return `${well.kind}:${well.unitId}`;
    default:
      return well.kind;
  }
}

/** The line that asks for a well's buttons. Null: the well needs no words. */
export function wellIntro(
  well: ChatWell,
  context: { said: (mark: string) => boolean; hardcover: ChatJourney["hardcover"] },
): GuideLineCandidate[] | null {
  switch (well.kind) {
    case "storyDone":
      return [{ key: "askStoryDone", priority: "question" }];
    case "pictureNotes":
      return [{ key: "askPictureNotes", priority: "question" }];
    case "styleChoice":
      return [{ key: "askLook", priority: "question" }];
    case "formatChoice":
      return [{ key: "askFormat", priority: "question" }];
    case "layoutChoice":
      return [{ key: "askLayout", priority: "question" }];
    case "coverWords":
      return [
        {
          key: well.fromStory ? "askCoverWordsFound" : well.own ? "askCoverWordsOwn" : "askCoverWords",
          priority: "question",
        },
      ];
    case "lookAlike":
      return [{ key: "askLookAlike", priority: "question", vars: { names: well.names } }];
    case "castLooks":
      // The card is the question. A line here would ask how they look twice.
      return null;
    case "castAges":
      return [castAgesAskLine(well.people.filter((person) => person.years === undefined))];
    case "portraits":
      return [
        {
          key: well.stale ? (well.canKeepLook ? "portraitsRestyle" : "portraitsStale") : "drawThem",
          priority: "question",
          vars: { names: well.names },
        },
      ];
    case "account":
      return [{ key: "accountFirst", priority: "question" }];
    case "castFix":
      return [{ key: "castFix", priority: "blocking" }];
    case "storyRetry":
      return [{ key: "storyFailed", priority: "blocking" }];
    case "audienceConfirm":
      return [readingAgeAskLine(well)];
    case "storyBrief":
      return [{ key: context.said("briefOffer") ? "briefMore" : "briefOffer", priority: "question" }];
    case "manuscriptChoice":
      return [{ key: "manuscriptAsk", priority: "question" }];
    case "whichName":
      return [{ key: "whichName", priority: "question" }];
    case "redraw":
      return [{ key: "redrawReady", priority: "question" }];
    case "hardcoverChoice":
      return [{ key: "hardcoverShort", priority: "question", vars: { min: well.min, count: well.pages } }];
    case "drawBook":
      return [{ key: "askDrawBook", priority: "question" }];
    case "drawingAssign":
      return [{ key: "askDrawingOwner", priority: "question" }];
    case "extractionRetry":
      return [{ key: "readFailed", priority: "blocking" }];
    case "bookUpdate":
      return [{ key: "askBookUpdate", priority: "question" }];
    case "bookFinish":
      return [{ key: well.settled ? "bookUnfinished" : "askBookFinish", priority: "blocking" }];
    case "bookPrepFix":
      return [{ key: "askBookPrepFix", priority: "blocking" }];
    case "pageFix":
      return [
        {
          key: well.error === IN_PLACE_EDIT_FAILED ? "pageKeepFailed" : "pageAttention",
          priority: "blocking",
          vars: { n: well.page },
        },
      ];
    case "printFix":
      return [{ key: "askPrintFix", priority: "question" }];
    case "order":
      return context.said("pagesDone")
        ? [{ key: "printReady", priority: "question" }]
        : [
            { key: "pagesDone", priority: "result" },
            { key: "printReady", priority: "question" },
          ];
    case "agentConfirm":
      return [{ key: "confirmAsk", priority: "question" }];
    case "agentAsk":
      return [{ key: "askWhich", priority: "question" }];
    case "agentBlocked":
      return [{ key: "blocked", priority: "question", vars: { what: well.remedy.what } }];
    case "sparksOffer":
      return [{ key: "sparksOffer", priority: "question" }];
    case "skipFact":
      return null;
  }
}

/** Whether the people a card is about are still in the book. */
function aboutPresent(well: ChatWell, project: Project): boolean {
  const ids =
    well.kind === "castLooks" ? [well.castId] : well.kind === "lookAlike" ? well.ids : null;
  if (!ids) return true;
  const cast = new Set(namedCast(briefOf(project.config)).map((member) => member.id));
  return ids.every((id) => cast.has(id));
}

/** Settle time before the guide speaks up, so a turn's own writes land first. */
const ANNOUNCE_DELAY_MS = 350;

export interface WellConversation {
  /** The step card on screen. */
  well: ChatWell | null;
  wellId: string | null;
  /** A reply to the reader, or a failure, shown beside the step card. */
  beside: ChatWell | null;
  besideId: string | null;
  composer: boolean;
}

/** Handlers for the step card's wrapper. */
export interface CardHold {
  onFocusCapture: () => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * Whether the reader is on the step card: focus or the pointer inside it. A
 * card whose question went stays while they are.
 */
export function useCardHold(): { holding: boolean; hold: CardHold } {
  const [focus, setFocus] = useState(false);
  const [pointer, setPointer] = useState(false);
  const onFocusCapture = useCallback(() => setFocus(true), []);
  const onBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocus(false);
  }, []);
  const onPointerEnter = useCallback(() => setPointer(true), []);
  const onPointerLeave = useCallback(() => setPointer(false), []);
  const hold = useMemo(
    () => ({ onFocusCapture, onBlurCapture, onPointerEnter, onPointerLeave }),
    [onFocusCapture, onBlurCapture, onPointerEnter, onPointerLeave],
  );
  return { holding: focus || pointer, hold };
}

export function useWellConversation(project: Project, journey: ChatJourney, holding: boolean): WellConversation {
  const messages = useChatStudio((s) => s.session.messages);
  const floor = useChatStudio((s) => s.floor);
  const sending = useChatStudio((s) => s.sending);
  const loaded = useChatStudio((s) => s.loaded);
  const said = useChatStudio((s) => s.said);
  const deck = useChatStudio((s) => s.cardDeck);
  const locale = chatLocaleOf(project);
  const opening = journey.phase === "opening";
  const pool = opening ? [] : journey.pool;
  const reply = opening ? null : journey.reply;
  const busy = floor > 0 || sending;
  const canAnswer = journey.composerFor(null);
  const [, recheck] = useReducer((n: number) => n + 1, 0);

  // How the card on screen last looked, so it can stay through a moment where
  // its question is gone.
  const lastLook = useRef<{ id: string; well: ChatWell } | null>(null);
  const acted =
    deck.shown !== null && messages.some((message) => message.role === "reader" && message.at > deck.since);
  const { step, main, mainId, live, beside, besideId } = pickCards({
    deck,
    pool,
    reply,
    now: Date.now(),
    acted,
    holding,
    lastLook: lastLook.current,
    present: (well) => aboutPresent(well, project),
    urgent: ATTENTION_WELLS,
  });

  const context = { said, hardcover: journey.hardcover };
  const stageOf = (well: ChatWell, onScreen: boolean): { stage: WellStage; topic: string; intro: GuideLineCandidate[] | null } => {
    const topic = wellTopic(well);
    const intro = wellIntro(well, context);
    const stage = wellStage({
      topic,
      kind: well.kind,
      messages,
      busy,
      hasIntro: Boolean(intro),
      canAnswer,
      locale,
      onScreen,
    });
    return { stage, topic, intro };
  };
  const besideTalk = beside ? stageOf(beside, deck.beside === besideId) : null;
  // A new step waits while a reply is open beside nothing: one new card at a time.
  const mainTalk = main
    ? beside && !step.onScreen
      ? { stage: "wait" as const, topic: wellTopic(main), intro: null }
      : stageOf(main, step.onScreen)
    : null;
  const shownMain = mainTalk?.stage === "show" ? main : null;
  const shownBeside = besideTalk?.stage === "show" ? beside : null;
  if (shownMain && live && mainId) lastLook.current = { id: mainId, well: shownMain };

  useEffect(() => {
    let next = step.deck;
    if (shownMain && mainId && !step.onScreen) next = placeCard(next, mainId, Date.now());
    const besideShown = shownBeside ? besideId : null;
    if (next.beside !== besideShown) next = { ...next, beside: besideShown };
    useChatStudio.getState().setCardDeck(next);
  });

  // A card whose question went stays through the grace; look again when it ends.
  const inGrace = step.recheckIn !== null;
  const missingSince = step.deck.missingSince;
  useEffect(() => {
    if (!inGrace || missingSince === null) return;
    const timer = setTimeout(recheck, Math.max(0, CARD_GRACE_MS - (Date.now() - missingSince)) + 20);
    return () => clearTimeout(timer);
  }, [inGrace, missingSince]);

  const announcing =
    besideTalk?.stage === "announce" ? besideTalk : mainTalk?.stage === "announce" ? mainTalk : null;
  const topic = announcing?.topic ?? null;
  const intro = announcing?.intro ?? null;
  const tried = useRef<string | null>(null);
  const lastId = messages[messages.length - 1]?.id ?? "";
  useEffect(() => {
    if (!loaded || !topic || !intro) return;
    const attempt = `${topic}@${lastId}`;
    if (tried.current === attempt) return;
    const timer = setTimeout(() => {
      const store = useChatStudio.getState();
      const latest = store.session.messages[store.session.messages.length - 1]?.id ?? "";
      if (store.floor > 0 || store.sending || latest !== lastId) return;
      tried.current = attempt;
      store.say(intro, { well: topic });
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
    // `intro` is rebuilt every render; the topic and the last message decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, topic, lastId]);

  return {
    well: shownMain,
    wellId: shownMain ? mainId : null,
    beside: shownBeside,
    besideId: shownBeside ? besideId : null,
    composer: journey.composerFor((shownBeside ?? shownMain)?.kind ?? null),
  };
}
