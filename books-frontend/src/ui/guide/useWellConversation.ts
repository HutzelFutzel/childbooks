"use client";

/**
 * The well as part of the conversation: the guide asks, then the buttons show
 * under its line. When the book moves to a new well, or the conversation moved
 * on from the one on screen, the guide says the well's line first. The rules
 * are in `core/guide/conversation.ts`; this carries them out.
 */
import { useEffect, useRef, useState } from "react";
import { holdsWell } from "../../core/guide/attention";
import { wellStage, type WellStage } from "../../core/guide/conversation";
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
      return [castAgesAskLine(well.people)];
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
      return [{ key: "askBookFinish", priority: "blocking" }];
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

/** Settle time before the guide speaks up, so a turn's own writes land first. */
const ANNOUNCE_DELAY_MS = 350;

export function useWellConversation(
  project: Project,
  journey: ChatJourney,
): {
  well: ChatWell | null;
  stage: WellStage | null;
  composer: boolean;
  /** A choice that is waiting while the reader writes or reviews in the story. */
  held: ChatWell | null;
  /** The reader asked for the held choice now. */
  release: () => void;
} {
  const messages = useChatStudio((s) => s.session.messages);
  const floor = useChatStudio((s) => s.floor);
  const sending = useChatStudio((s) => s.sending);
  const loaded = useChatStudio((s) => s.loaded);
  const said = useChatStudio((s) => s.said);
  const storyFocus = useChatStudio((s) => s.storyFocus);
  const asked = useChatStudio((s) => s.agentWell !== null);
  const locale = chatLocaleOf(project);
  const open = journey.phase === "opening" ? null : journey.chatWell;
  // One place for attention: while the reader writes or reviews in the story,
  // a choice that can wait does (`core/guide/attention.ts`).
  const [released, setReleased] = useState<string | null>(null);
  const openTopic = open ? wellTopic(open) : null;
  const held =
    open !== null &&
    released !== openTopic &&
    holdsWell({ storyFocus, wellKind: open.kind, asked });
  const well = held ? null : open;
  const topic = well ? wellTopic(well) : null;
  const intro = well ? wellIntro(well, { said, hardcover: journey.hardcover }) : null;
  const busy = floor > 0 || sending;
  const stage: WellStage | null =
    well && topic
      ? wellStage({
          topic,
          kind: well.kind,
          messages,
          busy,
          hasIntro: Boolean(intro),
          canAnswer: journey.composerFor(null),
          locale,
        })
      : null;

  const tried = useRef<string | null>(null);
  const lastId = messages[messages.length - 1]?.id ?? "";
  useEffect(() => {
    if (!loaded || stage !== "announce" || !topic || !intro) return;
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
  }, [loaded, stage, topic, lastId]);

  const shown = stage === "show" ? well : null;
  return {
    well: shown,
    stage,
    composer: journey.composerFor(shown?.kind ?? null),
    held: held ? open : null,
    release: () => setReleased(openTopic),
  };
}
