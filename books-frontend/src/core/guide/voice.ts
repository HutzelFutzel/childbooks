/**
 * What the guide says when it isn't the model talking.
 *
 * Two kinds of line come out of a conversational flow, and only one of them needs
 * an LLM. *Responding* to a sentence a person wrote is genuinely hard, and that is
 * the interpreter's job. *Asking the next question* is not: the engine already
 * knows which component is active and the catalog already phrases what's missing in
 * the reader's words. Sending that through a model would buy nothing and cost three
 * things — a wait before the first word appears, a bill for every book opened, and
 * a question that is worded differently each time it is asked.
 *
 * So these are pure functions over the cursor. They cover every moment the guide
 * speaks without having been spoken to: opening a book, and picking back up after
 * something finished on its own (a render landing, a job completing, the reader
 * editing a fact in the artifact pane). Between those, the interpreter's `reply`
 * carries the conversation.
 *
 * The wording lives here rather than in the components because it is *narration*,
 * not a description of the work — a component's `purpose` explains a step to an
 * admin reading the playlist editor, which is a different audience and a different
 * register from a parent halfway through making a book.
 */
import type { GuideCursor } from "./engine";
import type { GuideComponent } from "./components";
import { lastSpokenAbout, type GuideSession } from "./session";

/**
 * The question to put to the reader for the cursor's current position.
 *
 * Prefers the catalog's own blocker text, because that is the sentence the wizard
 * already shows for the same missing fact — a reader who switches flows mid-book
 * should not be told two different things about the same gap.
 */
export function guideAsk(cursor: GuideCursor): string {
  if (!cursor.component) return "Your book has everything it needs. Shall we look it over?";

  // A component that is waiting on generation rather than on the reader. Saying
  // "we're working on it" is the honest line; asking a question they can't answer
  // is how a guide starts to feel like it isn't listening.
  if (cursor.status === "blocked") {
    return cursor.blockers[0] ?? `We're getting ${lower(cursor.component.title)} ready.`;
  }

  return cursor.blockers[0] ?? openingFor(cursor.component);
}

/**
 * The opening line for a component with nothing specific missing.
 *
 * Only reached by the optional components — the required ones all report a blocker
 * when unsatisfied. Those are exactly the questions where the reader needs to know
 * they may decline, so the invitation is part of the sentence rather than left to a
 * button they might not notice.
 */
function openingFor(component: GuideComponent): string {
  const purpose = component.purpose.replace(/\.$/, "");
  return component.skippable
    ? `${sentence(purpose)} — tell me, or say skip and I'll choose.`
    : `${sentence(purpose)}.`;
}

/** Acknowledge a declined component without making a thing of it. */
export function guideSkipAck(component: GuideComponent, next: GuideCursor): string {
  return `No problem — I'll pick that. ${guideAsk(next)}`;
}

/**
 * Pick the conversation back up after the book changed on its own.
 *
 * Used when a render finishes or a job completes while the reader is sitting there:
 * the previous question is answered, but not by anything they said, so there is no
 * interpreter reply to carry the next one.
 */
export function guideAdvance(cursor: GuideCursor): string {
  if (!cursor.component) return "That's everything — your book is ready to read through.";
  return guideAsk(cursor);
}

/**
 * Whether the guide has anything new to say, and what.
 *
 * The whole decision, as one pure function, because the alternative is an effect in
 * a component that fires on renders instead of on changes. The guide speaks whenever
 * the book moves without the reader having said anything — a page render lands, the
 * page plan arrives, a fact is edited in the pane beside the chat — so the surface
 * calls this on every change and relies on `null` to keep it quiet. Getting that
 * wrong doesn't crash anything; it just asks the same question over and over, which
 * is why it is checked exhaustively in `scripts/guide-session-invariants.ts` rather
 * than left to a component to get right.
 *
 * Returns null when the last thing the guide said was already about this question.
 */
export function nextGuideSay(session: GuideSession, cursor: GuideCursor): string | null {
  if (session.messages.length === 0) return guideAsk(cursor);
  if (lastSpokenAbout(session) === (cursor.component?.id ?? null)) return null;
  return guideAdvance(cursor);
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
