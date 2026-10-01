/**
 * The one thing the reader should see while the studio is working.
 *
 * Known long operations are named immediately. A decorative trace is not a
 * status. Priority follows what the reader is waiting on, not what started first.
 */

export type GuideActivity =
  | { id: "understanding" }
  | { id: "readingStory" }
  | { id: "writingStory" }
  | { id: "revisingStory" }
  | { id: "planningPages" }
  | { id: "estimating" }
  | { id: "startingBook" }
  | { id: "preparingBook"; done: number; total: number }
  | { id: "drawingPeople"; done: number; total: number }
  | { id: "drawingPages"; done: number; total: number };

export interface ActivityInput {
  sending?: boolean;
  extractionRunning?: boolean;
  analysisRunning?: boolean;
  planRunning?: boolean;
  storyRunning?: boolean;
  /** A change to the story is being prepared on the server. */
  revisionRunning?: boolean;
  estimating?: boolean;
  startingBook?: boolean;
  drawPhase?: "cast" | "pages" | "done" | null;
  preparingBook?: boolean;
  preparation?: { done: number; total: number };
  portraitsRunning?: boolean;
  pagesRunning?: boolean;
  portraits?: { done: number; total: number };
  pages?: { done: number; total: number };
}

export function guideActivity(input: ActivityInput): GuideActivity | null {
  if (input.startingBook) return { id: "startingBook" };
  if (input.preparingBook || input.drawPhase === "cast") {
    const preparation = input.preparation ?? { done: 0, total: 0 };
    return { id: "preparingBook", ...preparation };
  }
  if (input.drawPhase === "pages" || input.pagesRunning) {
    const pages = input.pages ?? { done: 0, total: 0 };
    return { id: "drawingPages", done: pages.done, total: pages.total };
  }
  if (input.portraitsRunning) {
    const portraits = input.portraits ?? { done: 0, total: 0 };
    return { id: "drawingPeople", done: portraits.done, total: portraits.total };
  }
  if (input.storyRunning) return { id: "writingStory" };
  if (input.sending) return { id: "understanding" };
  if (input.revisionRunning) return { id: "revisingStory" };
  if (input.extractionRunning || input.analysisRunning) return { id: "readingStory" };
  if (input.planRunning) return { id: "planningPages" };
  if (input.estimating) return { id: "estimating" };
  return null;
}

/**
 * Cards that hold the reader's next words themselves: a field of their own, or
 * an answer the next message would otherwise overwrite. The message field waits
 * while one is open. Every other card, including the ones that spend Sparks,
 * sits above the field, because the reader can always have a question.
 */
const OWN_FIELD_WELLS = new Set(["whichName", "manuscriptChoice", "pictureNotes"]);

/**
 * Cards a stray Enter must never accept. They spend Sparks, change the book or
 * start a job, so they run on a tap and nothing else. (Before the message field
 * stayed beside them, it was hidden, and Enter on it was never possible.)
 */
export const ENTER_NEVER_ACCEPTS: ReadonlySet<string> = new Set([
  "castFix",
  "storyRetry",
  "account",
  "portraits",
  "formatChoice",
  "layoutChoice",
  "hardcoverChoice",
  "drawBook",
  "bookUpdate",
  "bookPrepFix",
  "pageFix",
  "printFix",
  "order",
  "whichName",
  "redraw",
  "manuscriptChoice",
  "pictureNotes",
]);

export function composerForChoice(input: {
  entry: "guided" | "own" | null;
  ownComposer?: boolean;
  /** The story is handed over (always, for a story the guide wrote). */
  handedOver?: boolean;
  wellKind?: string | null;
}): boolean {
  if (input.wellKind && OWN_FIELD_WELLS.has(input.wellKind)) return false;
  // Own words: the page is where they write, so the field waits until the
  // story is handed over, unless they asked the guide something first.
  return input.entry === null || input.entry === "guided" || input.ownComposer === true || input.handedOver === true;
}
