/**
 * How the Chat's buttons take part in the conversation.
 *
 * A well (the card of buttons above the message field) is never shown on its
 * own. The guide first says the line that asks for it, and the well stays
 * under that line only while it is still the guide's latest word:
 *
 *   - **show**: the latest line introduced this well.
 *   - **announce**: the reader just spoke or tapped, or a card that needs
 *     attention arrived, so the guide says that card's line before showing it.
 *     An edit made on the book only swaps the card.
 *   - **wait**: a turn is still running, a line is still being phrased, or the
 *     guide asked a question in words that the reader has not answered yet.
 *     One open question at a time; a choice that needs attention may interrupt.
 *
 * Pure, so the rules can be walked offline.
 */
import type { GuideLineKey } from "./copy";
import type { GuideMessage } from "./session";

/** Lines that introduce a well wherever they are said, by the well kind they introduce. */
export const WELL_INTRO_LINES: Partial<Record<GuideLineKey, string>> = {
  ownWordsOpen: "storyDone",
  askStoryDone: "storyDone",
  briefOffer: "storyBrief",
  briefAsk: "storyBrief",
  briefMore: "storyBrief",
  askLook: "styleChoice",
  askLookAlike: "lookAlike",
  askPersonLook: "castLooks",
  castAgesAsk: "castAges",
  castAgesAskMany: "castAges",
  lookChoose: "castLooks",
  askFormat: "formatChoice",
  askLayout: "layoutChoice",
  askCoverWords: "coverWords",
  askPictureNotes: "pictureNotes",
  askCoverWordsOwn: "coverWords",
  askCoverWordsFound: "coverWords",
  drawThem: "portraits",
  portraitsNeedSparks: "portraits",
  portraitsPriceChanged: "portraits",
  portraitsNotStarted: "portraits",
  portraitsRestyle: "portraits",
  portraitsStale: "portraits",
  readingAgeAsk: "audienceConfirm",
  readingAgeAskMonths: "audienceConfirm",
  readingAgeAskOwn: "audienceConfirm",
  readingAgeAskOwnEarly: "audienceConfirm",
  readingAgeAskOwnFromAge: "audienceConfirm",
  readingAgeAskOwnDiffer: "audienceConfirm",
  accountFirst: "account",
  castFix: "castFix",
  storyFailed: "storyRetry",
  manuscriptAsk: "manuscriptChoice",
  whichName: "whichName",
  redrawReady: "redraw",
  redrawNeedSparks: "redraw",
  askDrawBook: "drawBook",
  hardcoverShort: "hardcoverChoice",
  askDrawingOwner: "drawingAssign",
  readFailed: "extractionRetry",
  askBookUpdate: "bookUpdate",
  askBookFinish: "bookFinish",
  askBookPrepFix: "bookPrepFix",
  askPrintFix: "printFix",
  printReady: "order",
  sparksOffer: "sparksOffer",
};

/**
 * Wells the guide says even when the reader didn't just speak: something
 * failed, or an edit after the pages started means pictures no longer match.
 * Any other card just updates.
 */
export const ATTENTION_WELLS: ReadonlySet<string> = new Set([
  "castFix",
  "storyRetry",
  "extractionRetry",
  "pageFix",
  "bookPrepFix",
  "bookFinish",
  "bookUpdate",
]);

/** The well a line's keys introduce, if any. */
export function wellForKeys(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const well = WELL_INTRO_LINES[key as GuideLineKey];
    if (well) return well;
  }
  return undefined;
}

/** A guide row that reports rather than speaks: a notice, a receipt, the Sparks note. */
export function isQuietMessage(message: GuideMessage): boolean {
  if (message.role !== "guide") return false;
  const keys = message.keys ?? [];
  return keys.includes("notice") || keys.includes("receipt") || keys.includes("sparksNotice");
}

function textOf(message: GuideMessage, locale: string): string {
  return message.localized?.locale === locale ? message.localized.text : message.text;
}

export function asksQuestion(message: GuideMessage, locale: string): boolean {
  return textOf(message, locale).trim().endsWith("?");
}

/** The guide's latest spoken line, or the reader's latest message if that came after it. */
export function latestTurn(messages: readonly GuideMessage[]): GuideMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.pending) return message;
    if (isQuietMessage(message)) continue;
    return message;
  }
  return null;
}

export type WellStage = "show" | "announce" | "wait";

export function wellStage(input: {
  topic: string;
  kind: string;
  messages: readonly GuideMessage[];
  /** A turn is running: the reader's message or tap is still being answered. */
  busy: boolean;
  /** The well has a line to introduce it. Without one it shows as it is. */
  hasIntro: boolean;
  /** The message field is available, so a question in words can be answered. */
  canAnswer: boolean;
  locale: string;
}): WellStage {
  if (!input.hasIntro) return "show";
  const last = latestTurn(input.messages);
  if (!last) return input.busy ? "wait" : "announce";
  if (last.pending) return "wait";
  if (last.role === "reader") return input.busy ? "wait" : "announce";
  if (last.well === input.topic) return "show";
  if (input.busy) return "wait";
  // A line that introduced another well is stale; one that asks in words is open.
  if (!last.well && input.canAnswer && !ATTENTION_WELLS.has(input.kind) && asksQuestion(last, input.locale)) {
    return "wait";
  }
  // The reader edited the book. The card follows; the guide speaks only when
  // the new card needs attention. A tap still announces, because the latest
  // turn is then the reader's.
  if (last.role === "guide" && last.well && !ATTENTION_WELLS.has(input.kind)) return "show";
  return "announce";
}

/**
 * Whether the guide is waiting on the reader: its latest line asked something
 * or introduced a choice, and the reader has not replied. News that arrives
 * meanwhile is reported quietly instead of taking the floor.
 */
export function floorIsOpen(messages: readonly GuideMessage[], locale: string): boolean {
  const last = latestTurn(messages);
  if (!last || last.role !== "guide") return false;
  return Boolean(last.well) || asksQuestion(last, locale);
}
