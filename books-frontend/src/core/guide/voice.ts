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
 * editing a fact in the artifact pane). After a typed turn they also own the next
 * question: the interpreter may confirm what it understood, but it must not decide
 * what to ask — that is how a model that "added three children" in prose asks for
 * a theme while the book still has no cast.
 *
 * The wording lives here rather than in the components because it is *narration*,
 * not a description of the work — a component's `purpose` explains a step to an
 * admin reading the playlist editor, which is a different audience and a different
 * register from a parent halfway through making a book.
 */
import type { GuideCursor } from "./engine";
import type { GuideComponent, GuideEffectId } from "./components";
import { guideEffectState } from "./effects";
import { captureGuideFacts, type GuidePatchRejection } from "./patch";
import { lastSpokenAbout, type GuideSession } from "./session";
import { GUIDE_SLOTS, type GuideSlotId } from "./slots";
import type { Project } from "../types";

/**
 * The question to put to the reader for the cursor's current position.
 *
 * Prefers the catalog's own blocker text, because that is the sentence the wizard
 * already shows for the same missing fact — a reader who switches flows mid-book
 * should not be told two different things about the same gap. The one exception
 * is an admin's opening question on a component nobody has answered yet.
 */
export function guideAsk(cursor: GuideCursor, project: Project): string {
  if (!cursor.component) return "Your book has everything it needs. Shall we look it over?";
  const component = cursor.component;

  /**
   * Generation outstanding: say what is about to happen, not how much is left.
   *
   * The count belongs to the reveal beside the composer, which re-reads it from the
   * book on every render. Putting it here instead would write a number into the
   * transcript — a permanent record that is wrong five minutes later and stays
   * wrong, sitting above a live counter that disagrees with it. So the durable line
   * explains the intent, and the live one carries the status.
   */
  if (component.effect && guideEffectState(component.effect, project).status !== "done") {
    return effectIntent(component.effect);
  }

  // Waiting on generation rather than on the reader, with no effect of its own to
  // explain it. Saying "we're working on it" is the honest line; asking a question
  // they can't answer is how a guide starts to feel like it isn't listening.
  if (cursor.status === "blocked") {
    return cursor.blockers[0] ?? `We're getting ${lower(component.title)} ready.`;
  }

  // The admin's wording opens the topic; the catalog chases what's left of it.
  //
  // An override can cover more ground than the component's own opening — "who is
  // in the book, how they know each other, and how old they are" asks for three
  // things in one breath, which is a better first question than asking for names
  // and then coming back for ages. But it is the wrong second question: once a
  // name has landed, "Add Neil's age to create the story" is the only line that
  // shows the guide read what was typed. So the override speaks first and the
  // blockers take over the moment the component has anything in it.
  if (component.ask && untouched(component, project)) return component.ask;

  return cursor.blockers[0] ?? openingFor(component);
}

/**
 * Whether the reader has put nothing into this component yet.
 *
 * Measured against the facts as the patch layer captures them, not against
 * `isSatisfied` — a component is unsatisfied both when it is empty and when it
 * is half-answered, and those two want different questions.
 */
function untouched(component: GuideComponent, project: Project): boolean {
  const facts = captureGuideFacts(project);
  return component.slots.every((slot) => !Object.hasOwn(facts, slot));
}

/**
 * What the guide says while a piece of generation runs.
 *
 * Each one answers "why is this happening" rather than "what is happening" — the
 * reader can see what is happening. The cast line earns its keep: readers who are not
 * told why the characters are drawn before the pages assume the wait is wasted.
 */
function effectIntent(effect: GuideEffectId): string {
  switch (effect) {
    case "storyDraft":
      return "I'll write the story now, from everything you've told me.";
    case "castArt":
      return "First I'll draw everyone and everywhere, so they look the same on every page.";
    case "screenplay":
      return "Now I'll turn the story into pages.";
    case "pageArt":
      return "Now the pictures — one for every page.";
  }
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
export function guideSkipAck(
  component: GuideComponent,
  next: GuideCursor,
  project: Project,
): string {
  return `No problem — I'll pick that. ${guideAsk(next, project)}`;
}

/**
 * Pick the conversation back up after the book changed on its own.
 *
 * Used when a render finishes or a job completes while the reader is sitting there:
 * the previous question is answered, but not by anything they said, so there is no
 * interpreter reply to carry the next one.
 */
export function guideAdvance(cursor: GuideCursor, project: Project): string {
  if (!cursor.component) return "That's everything — your book is ready to read through.";
  return guideAsk(cursor, project);
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
export function nextGuideSay(
  session: GuideSession,
  cursor: GuideCursor,
  project: Project,
): string | null {
  // A transcript that only has the reader's words still needs the opening
  // question — they typed before the guide spoke, which is exactly the empty
  // chat in the screenshot. Counting any message would skip the ask.
  if (!session.messages.some((message) => message.role === "guide")) {
    return guideAsk(cursor, project);
  }
  if (lastSpokenAbout(session) === (cursor.component?.id ?? null)) return null;
  return guideAdvance(cursor, project);
}

/**
 * One spoken line after a typed turn: confirm what actually landed, then ask
 * whatever the book still needs.
 *
 * The interpreter proposes facts and a confirmation. The engine, looking at the
 * patched book, decides the next question. Combining them here is what stops the
 * two from disagreeing — a model that confirms names it did not store, or that
 * asks for a theme while the cast is still empty, is a transcript that loops.
 *
 * `landed` is whether the turn did something to the book — a patch that applied,
 * or a skip — not whether the model *claimed* to understand. An answer that writes
 * nothing must not be confirmed; a greeting or a question that writes nothing still
 * deserves its reply, then the same ask.
 */
export function composeGuideReply(args: {
  acknowledgement: string;
  /** True when this turn was trying to state a fact (answer or revise). */
  statingFacts: boolean;
  /** Slots this turn changed. */
  applied: readonly GuideSlotId[];
  /** Slots the reader restated correctly — the book already said this. */
  unchanged: readonly GuideSlotId[];
  /** Proposals the validator refused. Only `speak` is ever said out loud. */
  rejected: readonly GuidePatchRejection[];
  /** True when the reader declined something this turn. */
  skipped: boolean;
  /**
   * A question to ask instead of moving on, when a change was held back.
   *
   * Takes precedence over the next question in the flow. Asking "shall I change
   * that?" and then immediately asking about something else would leave the
   * reader's yes ambiguous, which is the one thing a confirmation cannot be.
   */
  confirm?: string | null;
  /**
   * Slots to name explicitly because the model was only moderately sure.
   *
   * The cheapest correction in the product: a fact said out loud is one the
   * reader fixes in the next breath, whereas the same fact applied quietly is one
   * they find after the cast sheets are drawn.
   */
  readBack?: readonly GuideSlotId[];
  cursor: GuideCursor;
  project: Project;
}): string {
  const ask = guideAsk(args.cursor, args.project);
  const ack = stripQuestions(args.acknowledgement);
  const withAsk = (line: string) =>
    !line ? ask : includesIgnoreCase(line, ask) ? line : `${line} ${ask}`;

  if (args.confirm) {
    return ack && !includesIgnoreCase(ack, args.confirm)
      ? `${ack} ${args.confirm}`
      : args.confirm;
  }

  const landed = args.applied.length > 0 || args.skipped;

  if (args.statingFacts && !landed) {
    /**
     * Nothing changed, which is not the same as nothing understood. Three cases,
     * and only the last of them is a failure to comprehend:
     *
     *   1. They restated something the book already has. That is a confirmation.
     *      The model's own acknowledgement is accurate here — the facts really are
     *      in the book — so it is kept rather than replaced with a denial.
     *   2. A write was refused for a reason worth hearing ("I don't have a Sam in
     *      the story"). Saying that is the only way the reader can correct it.
     *   3. Genuinely nothing usable came back.
     */
    if (args.unchanged.length > 0) {
      return withAsk(ack || alreadyKnown(args.unchanged, args.project));
    }
    const spoken = args.rejected.find((rejection) => rejection.speak)?.speak;
    if (spoken) return withAsk(spoken);
    return `I didn't quite catch that. ${ask}`;
  }

  // A turn that landed can still have refused part of what it was given, and the
  // reader has to hear about the part that did not stick.
  const partial = args.rejected.find((rejection) => rejection.speak)?.speak;
  const spelledOut = readBackLine(args.readBack ?? [], args.applied, args.project, ack);
  return withAsk([ack, spelledOut, partial].filter(Boolean).join(" "));
}

/**
 * Say the value back, for facts we are only moderately sure we heard right.
 *
 * Skipped when the model's own acknowledgement already contains the value — it
 * usually does, and saying "Maya and Leo" twice in one breath reads like a
 * machine. Only the slots that actually changed are named: reading back a fact
 * that was refused would tell the reader something untrue about their book.
 */
function readBackLine(
  readBack: readonly GuideSlotId[],
  applied: readonly GuideSlotId[],
  project: Project,
  acknowledgement: string,
): string {
  const values = readBack
    .filter((id) => applied.includes(id))
    .map((id) => GUIDE_SLOTS[id].describe(project))
    .filter((value): value is string => !!value && !includesIgnoreCase(acknowledgement, value));
  if (values.length === 0) return "";
  return `I've put that down as ${values.join(", ")} — tell me if that's not right.`;
}

/**
 * Confirm a fact the book already held, naming it.
 *
 * Reads through the slot's own `describe`, so the wording cannot claim something
 * the facts strip beside it disagrees with. Falls back to the label alone when a
 * slot has no short description — better a vaguer sentence than a wrong one.
 */
function alreadyKnown(slots: readonly GuideSlotId[], project: Project): string {
  for (const id of slots) {
    const value = GUIDE_SLOTS[id].describe(project);
    if (value) return `That's what I have already — ${value}.`;
  }
  return "That's what I have already.";
}

/**
 * Keep the confirmation, drop any question the model asked next.
 *
 * The engine will ask the real next thing from the patched book. Leaving the
 * model's question in would put two questions in one bubble, and the wrong one
 * is almost always the model's — it was composed before the patch landed.
 */
export function stripQuestions(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!])\s+/u);
  const kept = parts.map((part) => part.trim()).filter((part) => part.length > 0 && !part.endsWith("?"));
  return kept.join(" ").trim();
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
