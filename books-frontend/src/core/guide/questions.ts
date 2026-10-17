/**
 * The question the guide has open right now, and the example answers for it.
 *
 * Nothing here is a second list of what the guide asks. `activeQuestion` reads
 * the journey, which already knows (the first required fact still missing, or
 * the card that is up), and `QUESTION_EXAMPLES` has one entry per question the
 * guide can ask. It is a `Record` over the question ids, so a new fact or card
 * question does not compile until it says what an answer looks like, or says on
 * purpose that none is needed (`examples: 0`, for a question a tap answers).
 *
 * The text is localized: `guide.examples.<question>.<n>` for `n` in
 * `1..examples`, and `guide.examples.<question>.tip` when `tip` is set. The
 * invariants fail when any of it is missing in English or German.
 */
import type { GuideFactId } from "./factPolicy";
import type { Journey } from "./journey";

/** A question the guide asks: one of the facts it collects, or a card that takes words. */
export type GuideQuestionId = GuideFactId | "storyBrief" | "coverWords" | "castLooks";

export interface QuestionExamples {
  /** How many example answers have text. 0: a tap answers this question, nothing to type. */
  examples: number;
  /** One line that says what can be answered, for what an example can't show. */
  tip: boolean;
}

export const QUESTION_EXAMPLES: Record<GuideQuestionId, QuestionExamples> = {
  // Who is in the book: the one place people learn pets, toys and made-up creatures count.
  names: { examples: 5, tip: true },
  ages: { examples: 3, tip: true },
  idea: { examples: 4, tip: false },
  // A card with the suggested group on it; a tap answers.
  readingAge: { examples: 0, tip: false },
  language: { examples: 2, tip: false },
  // The optional details; what is typed in the chat is read into them.
  storyBrief: { examples: 5, tip: true },
  // The cover's words: title, subtitle or author in the reader's own words.
  coverWords: { examples: 3, tip: true },
  // How one character looks, when described in words instead of a photo or drawing.
  castLooks: { examples: 3, tip: true },
};

export const GUIDE_QUESTION_IDS = Object.keys(QUESTION_EXAMPLES) as GuideQuestionId[];

/**
 * What the guide is asking, or null when nothing is waiting on a typed answer.
 * A card that is up decides; with none, it is the first fact the guide still
 * needs from a reader who chose to be guided.
 */
export function activeQuestion(
  journey: Pick<Journey, "phase" | "entry" | "missing">,
  well: { kind: string } | null,
): GuideQuestionId | null {
  if (journey.phase === "opening") return null;
  if (well) {
    if (well.kind === "storyBrief") return "storyBrief";
    if (well.kind === "coverWords") return "coverWords";
    if (well.kind === "castLooks") return "castLooks";
    if (well.kind === "castAges") return "ages";
    if (well.kind === "audienceConfirm") return "readingAge";
    return null;
  }
  return journey.entry === "guided" ? (journey.missing[0] ?? null) : null;
}

/** The id of one example, which is also what the reader's taps are counted under. */
export function questionExampleId(question: GuideQuestionId, n: number): string {
  return `q:${question}.${n}`;
}
