/**
 * One place for the reader's attention.
 *
 * While the reader types in the manuscript, or weighs a change the guide
 * proposed, the chat does not put a question or a button in front of them:
 * two things asking at once is the confusion. A choice that can wait waits,
 * and the chat says so quietly ("one more step is waiting") until the reader
 * is done or asks for it. Anything the reader asked for, and anything that is
 * broken or blocks the book, is never held.
 *
 * Pure, so the rules can be walked offline.
 */
import { ATTENTION_WELLS } from "./conversation";

/** What the reader is doing on the Story tab. */
export type StoryFocus = "editing" | "reviewing";

/**
 * Wells that are never held: failures and blockers (`ATTENTION_WELLS`), the
 * open ends of something the reader just typed, and a choice the book cannot
 * go on without being answered in words.
 */
const NEVER_HELD: ReadonlySet<string> = new Set([
  ...ATTENTION_WELLS,
  "extractionRetry",
  "whichName",
  "redraw",
  "manuscriptChoice",
  "agentConfirm",
  "agentAsk",
  "agentBlocked",
  "sparksOffer",
]);

export function holdsWell(input: {
  storyFocus: StoryFocus | null;
  wellKind: string | null;
  /** The reader asked for this well by typing or tapping a skill. */
  asked: boolean;
}): boolean {
  if (!input.storyFocus || !input.wellKind || input.asked) return false;
  return !NEVER_HELD.has(input.wellKind);
}
