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
  if (input.extractionRunning || input.analysisRunning) return { id: "readingStory" };
  if (input.planRunning) return { id: "planningPages" };
  if (input.estimating) return { id: "estimating" };
  return null;
}

/** Choices and generation replace the composer. A question does not. */
const CHOICE_WELLS = new Set([
  "castFix",
  "storyRetry",
  "account",
  "portraits",
  "formatChoice",
  "layoutChoice",
  "drawBook",
  "bookUpdate",
  "bookPrepFix",
  "pageFix",
  "printFix",
  "order",
  "whichName",
  "redraw",
  "manuscriptChoice",
]);

export function composerForChoice(input: {
  entry: "guided" | "own" | null;
  ownComposer?: boolean;
  wellKind?: string | null;
  storyRunning?: boolean;
  drawing?: boolean;
}): boolean {
  if (input.wellKind && CHOICE_WELLS.has(input.wellKind)) return false;
  if (input.storyRunning || input.drawing) return false;
  return input.entry === null || input.entry === "guided" || input.ownComposer === true;
}
