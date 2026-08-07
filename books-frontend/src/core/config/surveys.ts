/**
 * **Profiling surveys** — the few questions we're allowed to ask a customer, and
 * the shapes that turn their answers into something you can target on.
 *
 * The point isn't feedback. It's that the analytics dashboard can tell you what
 * people *did* and never who they *are*: a print order tells you nothing about
 * whether the book was for a grandchild, whether the occasion was a birthday, or
 * whether they found us through a friend. Two accounts with identical revenue can
 * need completely different marketing, and nothing in the payment record
 * distinguishes them. A handful of questions at the one moment a customer is both
 * present and well-disposed — just after paying — closes that gap.
 *
 * Design rules that the rest of this file exists to enforce:
 *
 *   - **One row per purchase, not per account.** Who a book is for changes between
 *     orders — the first is for their own child, the third is for a friend's — and
 *     that change is the most valuable thing here. A single answer per account
 *     would collapse the series into whichever order happened to be asked, and no
 *     amount of later analysis can recover the rest. Which questions repeat is a
 *     per-question decision ({@link SurveyQuestion.askOnce}): "who's this one for?"
 *     every time, "how did you find us?" once.
 *
 *   - **Repeating is capped hard, and the cap is about time as much as count.**
 *     Somebody ordering three books in one evening reaches three confirmation
 *     screens, and three cards in ten minutes is the moment a survey stops being
 *     an aside and becomes harassment. So {@link AskPolicy} caps asks per survey,
 *     puts a cooldown between any two asks across ALL surveys, and stops entirely
 *     after consecutive dismissals. The cost is sparser ordinals — you hold
 *     answers for orders 1, 4 and 7 rather than 1, 2 and 3 — which is a good
 *     trade for "first versus later" and a bad one for "exactly the second".
 *
 *   - **A dismissal is an answer, and an opt-out is a stated preference.** Closing
 *     the card is recorded: it makes the response rate real (a 12% rate means the
 *     answers describe a self-selected minority, and a report that hides that is
 *     worse than no report), and enough of them stops the asking. An explicit
 *     "don't ask again" is different in kind — it lives on the user's profile
 *     rather than being inferred from behaviour, it covers every survey present
 *     and future, and its rate is the health metric for whether this feature is
 *     costing you more goodwill than it's worth.
 *
 *   - **One validator.** {@link validateAnswers} decides what "complete" means for
 *     the submit button AND for the route that persists the answers. A survey the
 *     client thinks is finished and the server rejects is a customer who answered
 *     for nothing.
 *
 * The questions themselves live in a backend-only config document. Nothing here is
 * secret, but the client never needs the whole set — it asks the server "what
 * should I ask this person?" and the server answers with at most one survey,
 * having already applied targeting, sampling, and everything they've been asked
 * before.
 */
import { z } from "zod";
import { stableFraction } from "./campaigns";
import { BUYER_ROLES, BUYER_ROLE_LABELS, type BuyerRole } from "./buyerRoles";
import type { DiscountItemType } from "./discountImpact";

// ---- Questions -------------------------------------------------------------

export const QUESTION_KINDS = ["single", "multi", "scale", "text"] as const;
export type SurveyQuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<SurveyQuestionKind, string> = {
  single: "Pick one",
  multi: "Pick several",
  scale: "Rating",
  text: "Free text",
};

export const QUESTION_KIND_HINTS: Record<SurveyQuestionKind, string> = {
  single:
    "The workhorse. One answer per person means every response lands in exactly one bucket, which is what makes a cross-tab readable.",
  multi:
    "Use sparingly. Multi-select answers overlap, so shares add to more than 100% and 'which group is most valuable' stops having a single answer.",
  scale:
    "A number you can average over time — recommendation likelihood, satisfaction. Useless for targeting on its own; pair it with a 'pick one'.",
  text: "Rich and unaggregatable. Worth one question at most, read by a human, never charted.",
};

/**
 * Buyer roles are tagged per option in config rather than mapped in code, because
 * the option list grows ("a godchild", "a child I foster") and a switch statement
 * here would drop every new one into silence.
 */
export { BUYER_ROLES, BUYER_ROLE_LABELS };
export type { BuyerRole };

export interface SurveyOption {
  id: string;
  label: string;
  /**
   * The buyer this option identifies, or null when it genuinely doesn't identify
   * one.
   *
   * Null is the important case and it must stay available. "A friend's child" is
   * chosen both by parents buying a gift and by people with no children of their
   * own, and there is nothing in the answer to tell them apart — tagging it
   * `friend` would be inventing a fact. What DOES resolve it is the series: an
   * account that once said "my own child" is a parent, so their later "a friend's
   * child" reads as a parent buying a gift. See {@link deriveBuyerProfile}.
   */
  buyerRole: BuyerRole | null;
}

export interface SurveyQuestion {
  id: string;
  kind: SurveyQuestionKind;
  /** What the customer reads. */
  prompt: string;
  /** Smaller print under the prompt; empty to omit. */
  hint: string;
  /**
   * Required questions block submission. Keep almost none of them: a required
   * question on a card the customer can close converts a dismissal out of someone
   * who would have answered the other four.
   */
  required: boolean;
  /**
   * Ask this one on the first ask only, then never again.
   *
   * The dividing line is whether the answer describes the ACCOUNT or the ORDER.
   * "How did you find us?" is a fact about the account: asking twice is nagging,
   * and the second answer is worse than the first because the memory has faded.
   * "Who is this one for?" is a fact about the order, and asking it every time is
   * the entire point — that series is how you learn that first books are for
   * their own children and third books are gifts.
   */
  askOnce: boolean;
  /** `single` / `multi`. */
  options: SurveyOption[];
  /**
   * Offer a "something else" box alongside the options. The escape hatch that
   * stops people picking a wrong option to get past the question — and the free
   * text it collects is where next quarter's options come from.
   */
  allowOther: boolean;
  /** `multi`: cap the selections (0 = uncapped). */
  maxSelections: number;
  /** `scale`: answers run 1…scaleMax. */
  scaleMax: number;
  scaleLowLabel: string;
  scaleHighLabel: string;
  /** `text`. */
  placeholder: string;
  maxLength: number;
}

export const MAX_QUESTIONS_PER_SURVEY = 8;
/**
 * Ceiling on how often one account may see the same survey.
 *
 * Five is already generous. Past a handful you're not building a series, you're
 * following somebody around their own purchase history.
 */
export const MAX_ASKS_PER_SURVEY = 5;
export const MAX_OPTIONS_PER_QUESTION = 20;
export const MAX_TEXT_LENGTH = 600;
export const MAX_SCALE = 10;

/** A blank question of the given kind, for the admin's "add question" menu. */
export function createQuestion(
  kind: SurveyQuestionKind,
  id = newId("q"),
): SurveyQuestion {
  return {
    id,
    kind,
    prompt: "",
    hint: "",
    required: false,
    // New questions repeat by default: a question worth adding is usually about
    // the order in front of the customer, and the ones that aren't are the
    // exception worth ticking a box for.
    askOnce: false,
    options:
      kind === "single" || kind === "multi"
        ? [createOption(), createOption()]
        : [],
    allowOther: false,
    maxSelections: 0,
    scaleMax: kind === "scale" ? 10 : 5,
    scaleLowLabel: kind === "scale" ? "Not at all likely" : "",
    scaleHighLabel: kind === "scale" ? "Extremely likely" : "",
    placeholder: "",
    maxLength: 300,
  };
}

export function createOption(
  label = "",
  id = newId("o"),
  buyerRole: BuyerRole | null = null,
): SurveyOption {
  return { id, label, buyerRole };
}

/** True when the question type is one whose answers can be counted and charted. */
export function isChoiceQuestion(kind: SurveyQuestionKind): boolean {
  return kind === "single" || kind === "multi";
}

// ---- Surveys ---------------------------------------------------------------

/**
 * What kind of purchase brings the survey up. Deliberately the same vocabulary
 * the campaign engine targets on, so "who buys print?" means one thing across the
 * admin rather than two subtly different things.
 */
export type SurveyItemType = DiscountItemType;

export const SURVEY_ITEM_TYPES: SurveyItemType[] = [
  "print",
  "ebook",
  "pack",
  "plan",
];

export const SURVEY_ITEM_LABELS: Record<SurveyItemType, string> = {
  print: "Printed book",
  ebook: "Digital edition",
  pack: "Spark pack",
  plan: "Membership",
};

export interface Survey {
  id: string;
  /** Admin-facing name; never shown to the customer. */
  name: string;
  enabled: boolean;
  /** One line above the questions, explaining why we're asking. */
  intro: string;
  /**
   * The opening line from the second ask onwards; empty falls back to
   * {@link intro}.
   *
   * Worth having because the first-time line is usually wrong the second time: it
   * introduces something the customer has already seen, and it tends to promise a
   * question count that no longer holds once the ask-once questions have dropped
   * out. A card that says "three quick questions" above two questions has broken
   * something small but real.
   */
  introRepeat: string;
  /** Shown in place of the questions once they've answered. */
  thanks: string;
  /** Which purchases bring it up. Empty means every purchase. */
  appliesTo: SurveyItemType[];
  /**
   * Only ask accounts with at least this many completed purchases. `1` (the
   * default) asks first-time buyers, which is usually right — the answers are
   * about why they came, and that memory decays.
   */
  minPurchases: number;
  /**
   * Fraction of eligible accounts asked, 0…1. Sampling exists because asking is
   * not free: the card competes with the download button and the invite prompt on
   * the one screen where a customer is most likely to do something valuable.
   */
  sampleRate: number;
  /**
   * How many times one account may be shown THIS survey, ever.
   *
   * `1` is the old behaviour and the right setting for a survey made entirely of
   * account-level questions. Above that you're building a series, and the number
   * is a judgement about how much attention the answers are worth: three gives
   * you a first, a middle and a late order, which is enough to see a trend and
   * few enough that nobody feels followed around.
   */
  maxAsks: number;
  questions: SurveyQuestion[];
}

/**
 * The cross-survey guard rails. Config-level rather than per-survey because they
 * exist to protect the customer from the whole feature, and a per-survey cooldown
 * would let two surveys take turns nagging somebody.
 */
export interface AskPolicy {
  /**
   * Minimum gap between any two asks, across every survey. 24 hours means a
   * customer who orders three books in one evening is asked once, which is the
   * case this setting exists for.
   */
  cooldownHours: number;
  /**
   * Consecutive dismissals before this account is never asked anything again.
   * Two is a stated preference expressed twice; treating it as one would throw
   * away the people who close the card reflexively and answer the next one.
   */
  stopAfterDismissals: number;
}

export interface SurveysConfig {
  /** Master switch. Off means no customer is asked anything, whatever's enabled. */
  enabled: boolean;
  policy: AskPolicy;
  surveys: Survey[];
  updatedAt: number;
}

export function createAskPolicy(): AskPolicy {
  return { cooldownHours: 24, stopAfterDismissals: 2 };
}

export function createSurvey(id = newId("s")): Survey {
  return {
    id,
    name: "New survey",
    enabled: false,
    intro: "One quick thing — it helps us make better books.",
    introRepeat: "",
    thanks: "Thank you. That genuinely helps.",
    appliesTo: [],
    minPurchases: 1,
    sampleRate: 1,
    maxAsks: 1,
    questions: [],
  };
}

/**
 * The starter set, shipped with the master switch off.
 *
 * Two surveys rather than one, because they're aimed at different people and
 * asking everything at once is how you get answers to nothing.
 *
 * The first survey is built as a SERIES, which is the whole design in miniature.
 * "Who is this one for?" repeats on every ask and carries buyer-role tags, so
 * three orders produce three rows and the shape of a customer emerges from the
 * sequence: own child, then a friend's child, then a classroom. "What's the
 * occasion?" repeats too — it's a fact about the book, not the buyer, and it's
 * what puts a calendar behind the demand. "How did you find us?" is marked
 * ask-once: it describes the account, the answer is the only honest attribution
 * word of mouth will ever give us, and asking it twice gets a worse answer than
 * asking it once because the memory has already faded.
 *
 * The second survey is the repeat-buyer one, and it's a template rather than a
 * recommendation: someone on their second order can be asked what nearly stopped
 * them the first time and whether they'd recommend us, because they've been through
 * the whole thing and their answer means something. Asking a first-time buyer to
 * rate a book they haven't received yet measures the checkout, not the product.
 *
 * The option ids below are permanent. They are what every answer is stored
 * against, so renaming one splits a cohort in half across the rename; the labels
 * are free to change forever.
 */
export function createDefaultSurveysConfig(): SurveysConfig {
  return {
    enabled: false,
    policy: createAskPolicy(),
    updatedAt: 0,
    surveys: [
      {
        id: "profile",
        name: "Post-purchase profiling",
        enabled: true,
        intro:
          "A couple of quick questions? It helps us make better books — and better offers for you.",
        introRepeat: "One more time, now that there's another book on the way?",
        thanks: "Thank you — that genuinely helps us.",
        appliesTo: [],
        minPurchases: 1,
        sampleRate: 1,
        // Three asks: a first order, a middle one and a later one is enough to see
        // whether somebody's buying moved from their own children to gifts.
        maxAsks: 3,
        questions: [
          {
            ...createQuestion("single", "audience"),
            prompt: "Who is this book for?",
            required: false,
            allowOther: true,
            askOnce: false,
            options: [
              { id: "own_child", label: "My own child", buyerRole: "parent" },
              { id: "grandchild", label: "My grandchild", buyerRole: "grandparent" },
              // Deliberately untagged: an aunt buying for a niece may or may not
              // have children of her own, and the answer doesn't say which.
              { id: "relative", label: "A niece, nephew or cousin", buyerRole: null },
              // Also untagged, for the same reason — this is chosen by parents
              // buying a gift and by people with no children alike.
              { id: "friends_child", label: "A friend's child", buyerRole: null },
              { id: "classroom", label: "A class or group I teach", buyerRole: "educator" },
              { id: "myself", label: "Myself", buyerRole: "self" },
            ],
          },
          {
            ...createQuestion("single", "occasion"),
            prompt: "What's the occasion?",
            allowOther: true,
            askOnce: false,
            options: [
              { id: "birthday", label: "A birthday", buyerRole: null },
              { id: "holiday", label: "A holiday gift", buyerRole: null },
              { id: "new_baby", label: "A new baby", buyerRole: null },
              { id: "bedtime", label: "Just for bedtime reading", buyerRole: null },
              {
                id: "milestone",
                label: "A big change — a move, a new school, a new sibling",
                buyerRole: null,
              },
              { id: "no_occasion", label: "No special reason", buyerRole: null },
            ],
          },
          {
            ...createQuestion("single", "discovery"),
            prompt: "How did you first hear about us?",
            hint: "This one's genuinely useful — we can't see word of mouth any other way.",
            allowOther: true,
            // A fact about the account, so it's asked on the first ask and never
            // again. On later asks the card is two questions shorter.
            askOnce: true,
            options: [
              { id: "search", label: "A web search", buyerRole: null },
              { id: "social", label: "Social media", buyerRole: null },
              { id: "friend", label: "A friend or family member", buyerRole: null },
              { id: "ad", label: "An advert", buyerRole: null },
              { id: "gift", label: "I was given a gift code", buyerRole: null },
              { id: "press", label: "An article, blog or newsletter", buyerRole: null },
            ],
          },
        ],
      },
      {
        id: "repeat",
        name: "Repeat buyers",
        enabled: false,
        intro: "Two questions, now that you've been through this once?",
        introRepeat: "",
        thanks: "Thank you — this is the useful kind of feedback.",
        appliesTo: [],
        minPurchases: 2,
        sampleRate: 1,
        maxAsks: 1,
        questions: [
          {
            ...createQuestion("text", "hesitation"),
            prompt: "Was there anything that nearly stopped you the first time?",
            hint: "Optional, and read by a person.",
            placeholder: "Too expensive, unsure about the quality, took too long…",
            maxLength: 400,
          },
          {
            ...createQuestion("scale", "recommend"),
            prompt: "How likely are you to recommend us to a friend?",
            scaleMax: 10,
            scaleLowLabel: "Not at all likely",
            scaleHighLabel: "Extremely likely",
          },
        ],
      },
    ],
  };
}

// ---- Answers ---------------------------------------------------------------

/**
 * One answer, in a shape that's the same for every question kind.
 *
 * A discriminated union would model each kind more precisely and make every
 * consumer — the aggregator, the storage layer, the cross-tab — switch on kind
 * before it could count anything. Since `optionIds` is what all the counting
 * works on, one flat shape earns its slight looseness: the validator below is the
 * thing that guarantees the fields match the question.
 */
export interface SurveyAnswer {
  questionId: string;
  /** Chosen options. One entry for `single`, several for `multi`, none otherwise. */
  optionIds: string[];
  /** A `text` answer, or the "something else" box on a choice question. */
  text: string;
  /** A `scale` answer, 1…scaleMax. Zero when the question isn't a scale. */
  value: number;
}

export function emptyAnswer(questionId: string): SurveyAnswer {
  return { questionId, optionIds: [], text: "", value: 0 };
}

/** True when the customer has actually put something in this answer. */
export function answered(answer: SurveyAnswer | undefined): boolean {
  if (!answer) return false;
  return (
    answer.optionIds.length > 0 ||
    answer.text.trim().length > 0 ||
    answer.value > 0
  );
}

export interface AnswerValidation {
  /** Cleaned answers, safe to persist. Empty answers are dropped. */
  answers: SurveyAnswer[];
  /** Per-question complaint, keyed by question id. Empty means valid. */
  errors: Record<string, string>;
  ok: boolean;
}

/**
 * Clean and check a set of answers against the survey that produced them.
 *
 * Runs on the client to light up the submit button and on the server before
 * anything is written — the same function both times, because the alternative is
 * a customer who answered a survey the server then threw away.
 *
 * Unknown question ids and unknown option ids are dropped rather than rejected.
 * A survey edited between the ask and the submit is normal (an admin fixing a
 * typo shouldn't discard in-flight answers), and the honest response to "they
 * answered a question that no longer exists" is to keep the rest.
 */
export function validateAnswers(
  survey: Survey,
  input: SurveyAnswer[],
): AnswerValidation {
  const errors: Record<string, string> = {};
  const byId = new Map(input.map((a) => [a.questionId, a]));
  const answers: SurveyAnswer[] = [];

  for (const question of survey.questions) {
    const raw = byId.get(question.id);
    const clean = emptyAnswer(question.id);

    if (raw) {
      switch (question.kind) {
        case "single": {
          const valid = raw.optionIds.filter((id) =>
            question.options.some((o) => o.id === id),
          );
          clean.optionIds = valid.slice(0, 1);
          if (question.allowOther)
            clean.text = trimText(raw.text, MAX_TEXT_LENGTH);
          break;
        }
        case "multi": {
          const valid = raw.optionIds.filter((id) =>
            question.options.some((o) => o.id === id),
          );
          const cap =
            question.maxSelections > 0 ? question.maxSelections : valid.length;
          if (valid.length > cap) {
            errors[question.id] = `Pick up to ${cap}.`;
          }
          clean.optionIds = unique(valid).slice(0, cap);
          if (question.allowOther)
            clean.text = trimText(raw.text, MAX_TEXT_LENGTH);
          break;
        }
        case "scale": {
          const max = clampInt(question.scaleMax, 2, MAX_SCALE, 5);
          const value = Math.round(Number(raw.value) || 0);
          if (value < 0 || value > max) {
            errors[question.id] = `Pick a number from 1 to ${max}.`;
          }
          clean.value = value >= 1 && value <= max ? value : 0;
          break;
        }
        case "text": {
          clean.text = trimText(
            raw.text,
            clampInt(question.maxLength, 1, MAX_TEXT_LENGTH, 300),
          );
          break;
        }
      }
    }

    // "Something else" typed with no option chosen still counts as an answer on a
    // choice question — the person answered, just not in our words.
    if (question.required && !answered(clean)) {
      errors[question.id] = "This one's needed.";
    }
    if (answered(clean)) answers.push(clean);
  }

  return { answers, errors, ok: Object.keys(errors).length === 0 };
}

/** Whether there's enough here to submit: valid, and not completely blank. */
export function canSubmit(survey: Survey, input: SurveyAnswer[]): boolean {
  const result = validateAnswers(survey, input);
  return result.ok && result.answers.length > 0;
}

// ---- Targeting -------------------------------------------------------------

export type SurveyResponseStatus = "asked" | "answered" | "dismissed";

/**
 * What one account has done with one survey, aggregated over every ask.
 *
 * Counts rather than a single status, because a survey can now be asked more than
 * once and each ask has its own outcome. `answeredQuestionIds` is the part that
 * does real work: it's how an ask-once question knows it's already been answered,
 * and it accumulates across asks so it survives a customer who answered question
 * one on their first order and question two on their second.
 */
export interface SurveyHistoryEntry {
  surveyId: string;
  /** Times the card was shown, including asks they ignored. */
  asks: number;
  answers: number;
  dismissals: number;
  /** Most recent ask, ms epoch. */
  lastAskedAt: number;
  /** Every question this account has answered in this survey, ever. */
  answeredQuestionIds: string[];
}

export function emptyHistoryEntry(surveyId: string): SurveyHistoryEntry {
  return {
    surveyId,
    asks: 0,
    answers: 0,
    dismissals: 0,
    lastAskedAt: 0,
    answeredQuestionIds: [],
  };
}

export interface SurveyAudience {
  uid: string;
  /** What they just bought, when the ask is hung off a purchase. */
  itemType?: SurveyItemType;
  /** Completed purchases INCLUDING the one that triggered this. */
  purchaseCount: number;
  history: SurveyHistoryEntry[];
  /**
   * Most recent ask across ALL surveys, ms epoch. The cooldown's input, and the
   * reason it's global: two surveys taking turns would defeat a per-survey gap.
   */
  lastAskedAt: number;
  /**
   * Dismissals since the last time they answered anything, across all surveys.
   * Reset by an answer, because someone who closes one card and fills in the next
   * hasn't told us to stop.
   */
  consecutiveDismissals: number;
  /** They pressed "don't ask again". Nothing below matters if this is true. */
  optedOut: boolean;
  /** Evaluated at this instant. Injected so targeting is deterministic in tests. */
  now: number;
}

/** A survey, prepared for one particular ask. */
export interface SurveyPrompt {
  /**
   * The survey as this customer should see it: `questions` filtered to the ones
   * still worth asking, `intro` resolved for a first or a later ask.
   *
   * Filtered here rather than in the UI so that one function decides what was
   * asked — the record of the ask stores exactly these question ids, and the
   * submit route validates against exactly them.
   */
  survey: Survey;
  /** 1 for the first time this account has seen this survey. */
  askNumber: number;
}

/**
 * Why nobody was asked — never shown to a customer.
 *
 * Separate from `pickSurvey`'s null so the ORDER of the gates is a checkable fact
 * rather than an implementation detail: "they opted out" and "they've dismissed
 * two in a row" both stop the card, and which one gets reported is the difference
 * between an admin fixing the survey and an admin overriding a stated preference.
 */
export type SurveySkipReason =
  | "off"
  | "optedOut"
  | "dismissedTooOften"
  | "cooldown"
  | "noEligibleSurvey";

/**
 * Cut a survey down to the questions this ask should carry, and pick its opening
 * line.
 *
 * Ask-once questions drop out once answered — not once ASKED. Someone who skipped
 * a question the first time may well answer it the second, and dropping it after
 * an unanswered ask would lose that for good.
 */
export function prepareSurvey(
  survey: Survey,
  askNumber: number,
  answeredQuestionIds: string[] = [],
): Survey {
  const answered = new Set(answeredQuestionIds);
  const questions = survey.questions.filter(
    (q) => !(q.askOnce && answered.has(q.id)),
  );
  const intro =
    askNumber > 1 && survey.introRepeat.trim()
      ? survey.introRepeat
      : survey.intro;
  return { ...survey, intro, questions };
}

/**
 * The one survey to show this person, or a reason nobody is being asked.
 *
 * At most one, always. Two surveys on a confirmation screen is a form, and a form
 * after checkout gets closed.
 *
 * The order of the gates matters: the customer's own stated preference comes
 * first, then the behavioural stop, then the cooldown, then per-survey targeting.
 * That way the admin's explanation of "why wasn't I asked?" names the strongest
 * reason rather than the first one that happened to match.
 *
 * Sampling is deterministic on uid+surveyId rather than random, so a customer who
 * reloads sees the same thing, a sampled-in account stays in for every later ask,
 * and an admin debugging gets a stable answer.
 */
export function pickSurvey(
  config: SurveysConfig,
  audience: SurveyAudience,
): SurveyPrompt | null {
  return pickSurveyVerbose(config, audience).prompt;
}

export function pickSurveyVerbose(
  config: SurveysConfig,
  audience: SurveyAudience,
): { prompt: SurveyPrompt | null; reason: SurveySkipReason | null } {
  const no = (reason: SurveySkipReason) => ({ prompt: null, reason });
  if (!config.enabled) return no("off");
  if (audience.optedOut) return no("optedOut");

  const policy = config.policy;
  if (
    policy.stopAfterDismissals > 0 &&
    audience.consecutiveDismissals >= policy.stopAfterDismissals
  ) {
    return no("dismissedTooOften");
  }
  // The burst guard. Three books bought in one evening reach three confirmation
  // screens; without this they'd produce three cards in ten minutes, which is
  // where an aside turns into harassment.
  if (
    policy.cooldownHours > 0 &&
    audience.lastAskedAt > 0 &&
    audience.now - audience.lastAskedAt < policy.cooldownHours * HOUR_MS
  ) {
    return no("cooldown");
  }

  const byId = new Map(audience.history.map((h) => [h.surveyId, h]));

  for (const survey of config.surveys) {
    if (!survey.enabled) continue;
    if (survey.questions.length === 0) continue;
    if (survey.appliesTo.length > 0) {
      if (!audience.itemType || !survey.appliesTo.includes(audience.itemType))
        continue;
    }
    if (audience.purchaseCount < survey.minPurchases) continue;
    if (
      survey.sampleRate < 1 &&
      stableFraction(audience.uid, survey.id) >= survey.sampleRate
    ) {
      continue;
    }

    const entry = byId.get(survey.id) ?? emptyHistoryEntry(survey.id);
    if (entry.asks >= Math.max(1, survey.maxAsks)) continue;

    const askNumber = entry.asks + 1;
    const prepared = prepareSurvey(survey, askNumber, entry.answeredQuestionIds);
    // Everything left is a question they've already answered once and that only
    // wanted asking once. There's nothing to put on the card.
    if (prepared.questions.length === 0) continue;

    return { prompt: { survey: prepared, askNumber }, reason: null };
  }
  return no("noEligibleSurvey");
}

const HOUR_MS = 3_600_000;

/**
 * Map a confirmation screen's purchase kind onto the targeting vocabulary.
 *
 * A gift purchase is a `pack` because that's what was paid for; the recipient
 * hasn't bought anything and isn't the one being asked.
 */
export function itemTypeForPurchaseKind(
  kind: string,
): SurveyItemType | undefined {
  switch (kind) {
    case "order":
      return "print";
    case "ebook":
      return "ebook";
    case "sparks":
    case "gift":
      return "pack";
    case "subscription":
      return "plan";
    default:
      return undefined;
  }
}

// ---- Buyer profile ---------------------------------------------------------

/**
 * What we've worked out about the person paying, accumulated across their answers.
 *
 * Two kinds of field, and the difference is the whole point:
 *
 *   - **Sticky facts** (`hasOwnChildren`, `isGrandparent`, `isEducator`) only ever
 *     turn on. Somebody who once bought for their own child still has a child
 *     three orders later, when they're buying for a friend — un-learning that on
 *     the strength of a newer answer would throw away the most durable thing this
 *     survey knows.
 *   - **`latestRole`** is the newest identifiable recipient relationship, which is
 *     what a campaign targeting "grandparents buying right now" needs.
 *
 * Together they express the sentence the whole feature was built for: *a parent,
 * on their second order, buying for a friend's child.* Neither field says that
 * alone.
 */
export interface BuyerFacts {
  /** Newest identifiable role, or null if they've never picked a tagged option. */
  latestRole: BuyerRole | null;
  /** Every role they've ever identified as, in the order first seen. */
  roles: BuyerRole[];
  /** They have said a book was for their own child. Never un-learned. */
  hasOwnChildren: boolean;
  isGrandparent: boolean;
  isEducator: boolean;
  /** How many answered rows fed this. Small numbers deserve small conclusions. */
  answers: number;
}

/**
 * The facts plus the raw answer keys.
 *
 * Split from {@link BuyerFacts} because the keys are the heavy half and almost
 * nothing needs them: the admin's user table carries a summary for every account
 * on screen, and shipping eighty answer keys per row to render one word would be a
 * hundred times the payload for none of the meaning.
 */
export interface BuyerProfile extends BuyerFacts {
  /**
   * Every answer they've ever given, as `surveyId:questionId:optionId` keys.
   *
   * Here rather than queried from the response rows because campaign conditions
   * read it on the pricing path, where a per-quote collection scan would be
   * unaffordable. It rides along on the user document the evaluator already reads,
   * so targeting "people who said the occasion was a birthday" costs nothing.
   *
   * Capped, oldest dropped first. A profile is a summary, not a second copy of the
   * answers — the rows are the record.
   */
  answered: string[];
  updatedAt: number;
}

/** Drop the answer keys, for the admin views that only describe the person. */
export function buyerFacts(profile: BuyerProfile): BuyerFacts {
  return {
    latestRole: profile.latestRole,
    roles: profile.roles,
    hasOwnChildren: profile.hasOwnChildren,
    isGrandparent: profile.isGrandparent,
    isEducator: profile.isEducator,
    answers: profile.answers,
  };
}

/** Cap on {@link BuyerProfile.answered}, so a profile doc can't grow unbounded. */
export const MAX_PROFILE_ANSWER_KEYS = 80;

export function emptyBuyerProfile(): BuyerProfile {
  return {
    latestRole: null,
    roles: [],
    hasOwnChildren: false,
    isGrandparent: false,
    isEducator: false,
    answered: [],
    answers: 0,
    updatedAt: 0,
  };
}

/** The stable key one chosen option is remembered by. */
export function answerKey(
  surveyId: string,
  questionId: string,
  optionId: string,
): string {
  return `${surveyId}:${questionId}:${optionId}`;
}

/**
 * The buyer roles one set of answers identifies.
 *
 * Usually one, occasionally none (every option they chose was untagged, which is
 * the honest outcome for "a friend's child"), and more than one only from a
 * multi-select — a teacher who is also a parent is genuinely both.
 */
export function rolesFromAnswers(
  survey: Survey,
  answers: SurveyAnswer[],
): BuyerRole[] {
  const roles: BuyerRole[] = [];
  for (const answer of answers) {
    const question = survey.questions.find((q) => q.id === answer.questionId);
    if (!question) continue;
    for (const optionId of answer.optionIds) {
      const role = question.options.find((o) => o.id === optionId)?.buyerRole;
      if (role && !roles.includes(role)) roles.push(role);
    }
  }
  return roles;
}

/**
 * Fold one set of answers into a profile.
 *
 * The single entry point, so the server updating a profile on submit and the report
 * rebuilding one from rows can't drift apart. Sticky facts accumulate, the latest
 * role is replaced only when this answer identified one, and the answer keys grow
 * as a bounded set.
 */
export function foldAnswers(
  prev: BuyerProfile,
  survey: Survey,
  answers: SurveyAnswer[],
  at: number,
): BuyerProfile {
  const roles = rolesFromAnswers(survey, answers);
  const next: BuyerProfile = {
    ...prev,
    roles: [...prev.roles],
    answered: [...prev.answered],
    answers: prev.answers + 1,
    updatedAt: Math.max(prev.updatedAt, at),
  };

  for (const role of roles) {
    if (!next.roles.includes(role)) next.roles.push(role);
    if (role === "parent") next.hasOwnChildren = true;
    if (role === "grandparent") next.isGrandparent = true;
    if (role === "educator") next.isEducator = true;
  }
  // A row of entirely untagged answers leaves the previous role standing rather
  // than blanking it: "we couldn't tell this time" isn't "they stopped being a
  // grandparent".
  if (roles.length > 0) next.latestRole = roles[0];

  for (const answer of answers) {
    for (const optionId of answer.optionIds) {
      const key = answerKey(survey.id, answer.questionId, optionId);
      if (!next.answered.includes(key)) next.answered.push(key);
    }
  }
  // Oldest first out. The newest answers are the ones a live campaign is most
  // likely to be targeting.
  if (next.answered.length > MAX_PROFILE_ANSWER_KEYS) {
    next.answered = next.answered.slice(-MAX_PROFILE_ANSWER_KEYS);
  }

  return next;
}

/** Rebuild a profile from rows, oldest first. Used by the report and backfills. */
export function deriveBuyerProfile(
  survey: Survey,
  rows: { answers: SurveyAnswer[]; answeredAt: number }[],
): BuyerProfile {
  return [...rows]
    .filter((r) => r.answeredAt > 0)
    .sort((a, b) => a.answeredAt - b.answeredAt)
    .reduce(
      (profile, row) => foldAnswers(profile, survey, row.answers, row.answeredAt),
      emptyBuyerProfile(),
    );
}

export function normalizeBuyerProfile(input: unknown): BuyerProfile {
  const raw = (input ?? {}) as Record<string, unknown>;
  const roles = (Array.isArray(raw.roles) ? raw.roles : []).filter(
    (r): r is BuyerRole => BUYER_ROLES.includes(r as BuyerRole),
  );
  const latest = BUYER_ROLES.includes(raw.latestRole as BuyerRole)
    ? (raw.latestRole as BuyerRole)
    : null;
  return {
    latestRole: latest,
    roles: unique(roles),
    hasOwnChildren: raw.hasOwnChildren === true,
    isGrandparent: raw.isGrandparent === true,
    isEducator: raw.isEducator === true,
    answered: unique(
      (Array.isArray(raw.answered) ? raw.answered : []).filter(
        (k): k is string => typeof k === "string" && k.length <= 200,
      ),
    ).slice(-MAX_PROFILE_ANSWER_KEYS),
    answers: nonNegative(raw.answers, 0),
    updatedAt: nonNegative(raw.updatedAt, 0),
  };
}

/** One line describing an account, for the admin's user table. */
export function describeBuyerProfile(profile: BuyerFacts): string {
  if (profile.answers === 0) return "Hasn't answered anything.";
  const parts: string[] = [];
  if (profile.latestRole) parts.push(BUYER_ROLE_LABELS[profile.latestRole].toLowerCase());
  // Only worth saying when it isn't already implied by the newest answer.
  if (profile.hasOwnChildren && profile.latestRole !== "parent") {
    parts.push("has children of their own");
  }
  if (profile.isGrandparent && profile.latestRole !== "grandparent") {
    parts.push("also a grandparent");
  }
  if (profile.isEducator && profile.latestRole !== "educator") {
    parts.push("also buys for a class");
  }
  if (parts.length === 0) {
    return `${profile.answers} answer${profile.answers === 1 ? "" : "s"}, none of which identify who they are.`;
  }
  const sentence = joinList(parts);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

// ---- Reporting -------------------------------------------------------------

/**
 * One answer option, with the money attached.
 *
 * The revenue columns are the reason this feature exists. "38% of buyers are
 * grandparents" is trivia; "grandparents are 38% of buyers and 51% of revenue"
 * is a decision about who the homepage talks to. Revenue is lifetime and in USD,
 * joined from the payment records at report time rather than snapshotted at
 * answer time — a customer's value keeps moving after they answer, and the
 * snapshot would freeze every cohort at its first order.
 *
 * TWO denominators, deliberately both present. Now that a customer can answer
 * after several orders, `responses` counts ANSWERS (how often this option gets
 * picked, which is a fact about orders) and `accounts` counts PEOPLE. Revenue is
 * lifetime per account, so it must only ever be divided by accounts: summing one
 * customer's lifetime value once per answer would report a grandparent who
 * ordered three times as three times as valuable as they are.
 */
export interface SurveyOptionStat {
  optionId: string;
  label: string;
  /** Answers that chose this — counted per answer, not per person. */
  responses: number;
  /** Share of the answers to THIS question (not of all responses). */
  share: number;
  /** Distinct accounts that chose it at least once. */
  accounts: number;
  /** Accounts with at least one paid order. */
  buyers: number;
  /** Lifetime revenue across the distinct accounts, counted once each. */
  revenueUsd: number;
  /** Lifetime revenue ÷ accounts — the number to compare options on. */
  revenuePerAccount: number;
}

/**
 * A count, a share, and the money — the three numbers that have to travel
 * together. A share on its own invites a decision on four people, so nothing in
 * this report emits one without the count beside it.
 */
export interface SurveyTally {
  id: string;
  label: string;
  responses: number;
  share: number;
  accounts: number;
  revenueUsd: number;
  revenuePerAccount: number;
}

/**
 * Where a purchase sits in the customer's history.
 *
 * Buckets rather than raw numbers because the cap and the cooldown make ordinals
 * sparse — you hold answers for orders 1, 4 and 7 — so "exactly the third" is a
 * cell with nobody in it while "later than their second" is a population.
 */
export type OrdinalBucket = "first" | "second" | "later" | "unknown";

export const ORDINAL_BUCKETS: OrdinalBucket[] = [
  "first",
  "second",
  "later",
  "unknown",
];

export const ORDINAL_BUCKET_LABELS: Record<OrdinalBucket, string> = {
  first: "First purchase",
  second: "Second purchase",
  later: "Third or later",
  unknown: "Unknown",
};

export function ordinalBucket(ordinal: number): OrdinalBucket {
  if (ordinal <= 0) return "unknown";
  if (ordinal === 1) return "first";
  if (ordinal === 2) return "second";
  return "later";
}

/**
 * One purchase-position slice: who was buying, and what the book was about.
 *
 * This is the shape that answers the question the whole per-order design was
 * built for — "are first books mostly for the buyer's own children, and do later
 * ones become gifts?" — and it answers it in one screen instead of a hunch.
 */
export interface SurveyOrdinalReport {
  bucket: OrdinalBucket;
  label: string;
  responses: number;
  accounts: number;
  /** Who these buyers were, biggest first. */
  roles: SurveyTally[];
  /** What the books were about, biggest first. */
  subjects: SurveyTally[];
}

/** One buyer-role slice, and how that group's orders differ from everyone's. */
export interface SurveySegmentReport {
  role: BuyerRole | "unknown";
  label: string;
  responses: number;
  accounts: number;
  /** Share of all answers that identified a role (or failed to). */
  share: number;
  revenueUsd: number;
  revenuePerAccount: number;
  subjects: SurveyTally[];
  /** Where this group's answers sat in their purchase history. */
  ordinals: SurveyTally[];
}

/**
 * How the identified buyer moved from one of their orders to the next.
 *
 * Counted over consecutive answered pairs, so an account with three answers
 * contributes two moves. `from === to` rows are kept: "parents who buy for their
 * own children again" is as much a finding as anyone changing, and hiding it
 * would make every visible move look more common than it is.
 */
export interface SurveyTransition {
  from: BuyerRole | "unknown";
  to: BuyerRole | "unknown";
  fromLabel: string;
  toLabel: string;
  /** Consecutive answered pairs that made this move. */
  moves: number;
  /** Distinct accounts contributing at least one such move. */
  accounts: number;
  share: number;
}

export interface SurveyQuestionReport {
  questionId: string;
  prompt: string;
  kind: SurveyQuestionKind;
  /** People who answered this question. */
  responses: number;
  options: SurveyOptionStat[];
  /** `scale` questions: the mean, to one decimal. Zero when not applicable. */
  average: number;
  /**
   * Free text, most recent first and capped. Includes "something else" answers
   * from choice questions, because that's where the missing option hides.
   */
  samples: string[];
}

export interface SurveyReport {
  surveyId: string;
  name: string;
  /** Times the card was shown. Rows, not people. */
  asked: number;
  /** Times it was answered. */
  responses: number;
  /** Distinct accounts that answered at least once. */
  respondents: number;
  /** Times it was closed without an answer. */
  dismissed: number;
  /**
   * Times somebody used the card's "don't ask again".
   *
   * The health metric for the whole feature, and the reason it's up here beside
   * the response rate: a response rate can look respectable while the people who
   * hated being asked quietly remove themselves, and only this number shows that
   * happening. If it climbs, the surveys are costing more goodwill than the
   * answers are worth.
   */
  optedOut: number;
  /** responses ÷ asked — how much to trust everything below. */
  responseRate: number;
  /** optedOut ÷ asked. */
  optOutRate: number;
  /** Answers per responding account — how much of a series this has become. */
  answersPerRespondent: number;
  /** Lifetime revenue across responding accounts, counted once each, USD. */
  revenueUsd: number;
  questions: SurveyQuestionReport[];
  /** Who the buyers were, and how their orders differ from each other. */
  segments: SurveySegmentReport[];
  /** First orders versus later ones. */
  ordinals: SurveyOrdinalReport[];
  /** How buyers moved between one of their orders and the next. */
  transitions: SurveyTransition[];
  /** True when the response scan hit its cap and the report is a sample. */
  truncated: boolean;
}

/**
 * What was bought, in the shape the report groups by.
 *
 * Snapshotted onto the response rather than joined from the project, because a
 * book's theme can be edited after it ships and the project can be deleted
 * outright — and what you want on the row is what they bought, not what the
 * project says today. `projectId` is kept anyway, for the dimensions nobody
 * thought to snapshot.
 */
export interface PurchaseFacets {
  itemType: SurveyItemType | null;
  /** Catalog product: the print SKU, plan or pack. */
  productId: string | null;
  projectId: string | null;
  paymentId: string | null;
  /** Copies on the order. More than one is itself evidence of gifting. */
  copies: number;
  /** The book's subject — catalog ids from the story brief, so they aggregate. */
  themeId: string | null;
  settingId: string | null;
  ageRangeId: string | null;
  artStyleKey: string | null;
  /** The customer's Nth BOOK (distinct from their Nth purchase). */
  projectSeq: number;
}

export function emptyPurchaseFacets(): PurchaseFacets {
  return {
    itemType: null,
    productId: null,
    projectId: null,
    paymentId: null,
    copies: 0,
    themeId: null,
    settingId: null,
    ageRangeId: null,
    artStyleKey: null,
    projectSeq: 0,
  };
}

/** A single stored response, as the report reads them. */
export interface SurveyResponseRow {
  uid: string;
  surveyId: string;
  status: SurveyResponseStatus;
  askedAt: number;
  answeredAt: number;
  answers: SurveyAnswer[];
  /** Which ask this was for the account, 1-based. */
  askNumber: number;
  /** They pressed "don't ask again" from this card. */
  optedOut: boolean;
  /**
   * Which purchase this row hangs off, 1-based; 0 when it couldn't be placed.
   *
   * Computed at report time from the payment history rather than stored, because
   * the count at answer time is a race: the confirmation screen can render before
   * the webhook that increments the lifetime counter has landed, which would shift
   * an ordinal by one and never correct itself.
   */
  ordinal: number;
  context: PurchaseFacets;
  /** Lifetime paid revenue for this account in USD, joined at report time. */
  revenueUsd: number;
}

export const MAX_TEXT_SAMPLES = 40;

/**
 * Cross-tabulate answers against lifetime revenue.
 *
 * Pure, so the admin dashboard and any future export share one definition of
 * "share" and "revenue per respondent" — two plausible denominators (people who
 * answered this question vs. everyone who answered anything) give materially
 * different percentages, and picking one in two places is how a dashboard starts
 * contradicting itself.
 */
export function buildSurveyReport(
  survey: Survey,
  rows: SurveyResponseRow[],
  opts: { truncated?: boolean; labels?: Record<string, string> } = {},
): SurveyReport {
  const answeredRows = rows.filter((r) => r.status === "answered");
  const dismissed = rows.filter((r) => r.status === "dismissed").length;
  const optedOut = rows.filter((r) => r.optedOut).length;
  const respondentUids = new Set(answeredRows.map((r) => r.uid));

  const questions: SurveyQuestionReport[] = survey.questions.map((question) => {
    const relevant = answeredRows.filter((r) =>
      r.answers.some((a) => a.questionId === question.id && answered(a)),
    );

    const byOption = new Map<string, Bucket>();
    const bump = (optionId: string, row: SurveyResponseRow) =>
      addToBucket(byOption, optionId, row);

    let scaleTotal = 0;
    let scaleCount = 0;
    const samples: { at: number; text: string }[] = [];

    for (const row of relevant) {
      const answer = row.answers.find((a) => a.questionId === question.id);
      if (!answer) continue;
      for (const optionId of answer.optionIds) bump(optionId, row);
      // A scale answer is bucketed by its value so it cross-tabs like any other
      // choice — "what are 9s and 10s worth compared to 6s" is the useful question.
      if (question.kind === "scale" && answer.value > 0) {
        bump(String(answer.value), row);
        scaleTotal += answer.value;
        scaleCount += 1;
      }
      const text = answer.text.trim();
      if (text) samples.push({ at: row.answeredAt, text });
      // Someone who typed into "something else" and picked nothing is still an
      // answer, and it belongs in a bucket rather than vanishing from the chart.
      if (
        text &&
        answer.optionIds.length === 0 &&
        isChoiceQuestion(question.kind)
      ) {
        bump(OTHER_OPTION_ID, row);
      }
    }

    const labels = new Map(question.options.map((o) => [o.id, o.label]));
    const options: SurveyOptionStat[] = [...byOption.entries()]
      .map(([optionId, cell]) => {
        const stat = finishBucket(cell, relevant.length);
        return {
          optionId,
          // Scale buckets are their own label ("7"); an option deleted since it was
          // answered falls back to its id rather than disappearing from the totals.
          label:
            labels.get(optionId) ??
            (optionId === OTHER_OPTION_ID ? "Something else" : optionId),
          responses: stat.responses,
          share: stat.share,
          accounts: stat.accounts,
          buyers: cell.buyers.size,
          revenueUsd: stat.revenueUsd,
          revenuePerAccount: stat.revenuePerAccount,
        };
      })
      .sort((a, b) =>
        question.kind === "scale"
          ? Number(a.optionId) - Number(b.optionId)
          : b.responses - a.responses,
      );

    return {
      questionId: question.id,
      prompt: question.prompt,
      kind: question.kind,
      responses: relevant.length,
      options,
      average:
        scaleCount > 0 ? Math.round((scaleTotal / scaleCount) * 10) / 10 : 0,
      samples: samples
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_TEXT_SAMPLES)
        .map((s) => s.text),
    };
  });

  // Every answered row, tagged with the role it identified. Computed once: the
  // segments, the ordinal slices and the transitions all need it, and deriving it
  // three times would be three chances for them to disagree.
  const tagged = answeredRows.map((row) => ({
    row,
    role: (rolesFromAnswers(survey, row.answers)[0] ?? "unknown") as
      | BuyerRole
      | "unknown",
    bucket: ordinalBucket(row.ordinal),
  }));

  const label = (id: string) => opts.labels?.[id] ?? id;

  const segments: SurveySegmentReport[] = groupBy(tagged, (t) => t.role).map(
    ([role, group]) => {
      const stat = finishBucket(bucketOf(group.map((g) => g.row)), tagged.length);
      return {
        role,
        label: role === "unknown" ? "Couldn't tell" : BUYER_ROLE_LABELS[role],
        responses: stat.responses,
        accounts: stat.accounts,
        share: stat.share,
        revenueUsd: stat.revenueUsd,
        revenuePerAccount: stat.revenuePerAccount,
        subjects: subjectTallies(group.map((g) => g.row), label),
        ordinals: tallies(
          group.map((g) => ({ id: g.bucket, row: g.row })),
          (id) => ORDINAL_BUCKET_LABELS[id as OrdinalBucket],
        ),
      };
    },
  );
  segments.sort((a, b) => b.responses - a.responses);

  const ordinals: SurveyOrdinalReport[] = ORDINAL_BUCKETS.map((bucket) => {
    const group = tagged.filter((t) => t.bucket === bucket);
    const stat = finishBucket(bucketOf(group.map((g) => g.row)), group.length);
    return {
      bucket,
      label: ORDINAL_BUCKET_LABELS[bucket],
      responses: stat.responses,
      accounts: stat.accounts,
      roles: tallies(
        group.map((g) => ({ id: g.role, row: g.row })),
        (id) => (id === "unknown" ? "Couldn't tell" : BUYER_ROLE_LABELS[id as BuyerRole]),
      ),
      subjects: subjectTallies(group.map((g) => g.row), label),
    };
  }).filter((slice) => slice.responses > 0);

  return {
    surveyId: survey.id,
    name: survey.name,
    asked: rows.length,
    responses: answeredRows.length,
    respondents: respondentUids.size,
    dismissed,
    optedOut,
    responseRate: rows.length > 0 ? answeredRows.length / rows.length : 0,
    optOutRate: rows.length > 0 ? optedOut / rows.length : 0,
    answersPerRespondent:
      respondentUids.size > 0
        ? Math.round((answeredRows.length / respondentUids.size) * 100) / 100
        : 0,
    // Once per account. A customer who answered after three orders has one
    // lifetime value, not three.
    revenueUsd: round2(sumByAccount(answeredRows)),
    questions,
    segments,
    ordinals,
    transitions: buildTransitions(tagged),
    truncated: opts.truncated ?? false,
  };
}

/**
 * How buyers moved between consecutive answers.
 *
 * Per account, answers in date order, then every adjacent pair. Ordering is by
 * `answeredAt` rather than by ordinal because the ordinal can be unknown for a row
 * whose payment fell outside the scan, and a missing ordinal shouldn't drop a real
 * move out of the picture.
 */
function buildTransitions(
  tagged: { row: SurveyResponseRow; role: BuyerRole | "unknown" }[],
): SurveyTransition[] {
  const byUid = new Map<string, typeof tagged>();
  for (const item of tagged) {
    const list = byUid.get(item.row.uid) ?? [];
    list.push(item);
    byUid.set(item.row.uid, list);
  }

  const cells = new Map<string, { moves: number; accounts: Set<string> }>();
  let total = 0;
  for (const [uid, list] of byUid) {
    if (list.length < 2) continue;
    const ordered = [...list].sort((a, b) => a.row.answeredAt - b.row.answeredAt);
    for (let i = 1; i < ordered.length; i++) {
      const key = `${ordered[i - 1].role}>${ordered[i].role}`;
      const cell = cells.get(key) ?? { moves: 0, accounts: new Set<string>() };
      cell.moves += 1;
      cell.accounts.add(uid);
      cells.set(key, cell);
      total += 1;
    }
  }

  const roleLabel = (role: string) =>
    role === "unknown" ? "Couldn't tell" : BUYER_ROLE_LABELS[role as BuyerRole];

  return [...cells.entries()]
    .map(([key, cell]) => {
      const [from, to] = key.split(">") as [
        BuyerRole | "unknown",
        BuyerRole | "unknown",
      ];
      return {
        from,
        to,
        fromLabel: roleLabel(from),
        toLabel: roleLabel(to),
        moves: cell.moves,
        accounts: cell.accounts.size,
        share: total > 0 ? cell.moves / total : 0,
      };
    })
    .sort((a, b) => b.moves - a.moves);
}

/**
 * What the books in these rows were about.
 *
 * Theme and setting share one list because they're both "the subject", they come
 * from the same catalog shape, and an admin looking at "what do grandparents buy"
 * wants one ranked list rather than two half-empty ones. Rows with neither are
 * left out entirely rather than bucketed as "unknown" — a Spark top-up has no
 * subject, and padding the list with it would bury the real answers.
 */
function subjectTallies(
  rows: SurveyResponseRow[],
  label: (id: string) => string,
): SurveyTally[] {
  const items: { id: string; row: SurveyResponseRow }[] = [];
  for (const row of rows) {
    for (const id of [row.context.themeId, row.context.settingId]) {
      if (id) items.push({ id, row });
    }
  }
  return tallies(items, label).slice(0, MAX_SUBJECTS);
}

export const MAX_SUBJECTS = 8;

interface Bucket {
  responses: number;
  accounts: Set<string>;
  buyers: Set<string>;
  revenueByUid: Map<string, number>;
}

function emptyBucket(): Bucket {
  return {
    responses: 0,
    accounts: new Set(),
    buyers: new Set(),
    revenueByUid: new Map(),
  };
}

/**
 * Add one answered row to a bucket.
 *
 * Revenue goes into a per-uid map rather than a running total, which is the whole
 * trick: the same account can land in the same bucket several times (three orders,
 * three answers of "my own child") and its lifetime value must be counted once.
 */
function addToBucket(
  buckets: Map<string, Bucket>,
  key: string,
  row: SurveyResponseRow,
): void {
  const bucket = buckets.get(key) ?? emptyBucket();
  bucket.responses += 1;
  bucket.accounts.add(row.uid);
  if (row.revenueUsd > 0) bucket.buyers.add(row.uid);
  bucket.revenueByUid.set(row.uid, row.revenueUsd);
  buckets.set(key, bucket);
}

function bucketOf(rows: SurveyResponseRow[]): Bucket {
  const map = new Map<string, Bucket>();
  for (const row of rows) addToBucket(map, "all", row);
  return map.get("all") ?? emptyBucket();
}

function finishBucket(
  bucket: Bucket,
  denominator: number,
): {
  responses: number;
  share: number;
  accounts: number;
  revenueUsd: number;
  revenuePerAccount: number;
} {
  const revenue = [...bucket.revenueByUid.values()].reduce((a, b) => a + b, 0);
  const accounts = bucket.accounts.size;
  return {
    responses: bucket.responses,
    share: denominator > 0 ? bucket.responses / denominator : 0,
    accounts,
    revenueUsd: round2(revenue),
    revenuePerAccount: accounts > 0 ? round2(revenue / accounts) : 0,
  };
}

function tallies(
  items: { id: string; row: SurveyResponseRow }[],
  label: (id: string) => string,
): SurveyTally[] {
  const buckets = new Map<string, Bucket>();
  for (const item of items) addToBucket(buckets, item.id, item.row);
  return [...buckets.entries()]
    .map(([id, bucket]) => {
      const stat = finishBucket(bucket, items.length);
      return { id, label: label(id), ...stat };
    })
    .sort((a, b) => b.responses - a.responses);
}

function sumByAccount(rows: SurveyResponseRow[]): number {
  const byUid = new Map<string, number>();
  for (const row of rows) byUid.set(row.uid, row.revenueUsd);
  return [...byUid.values()].reduce((a, b) => a + b, 0);
}

function groupBy<T, K>(items: T[], key: (item: T) => K): [K, T[]][] {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.entries()];
}

export const OTHER_OPTION_ID = "__other";

// ---- Normalization ---------------------------------------------------------

/**
 * Coerce anything into a coherent config.
 *
 * Runs on read as well as on write, so a hand-edited document, a config written
 * by an older build, or a half-finished admin draft all resolve to something the
 * capture UI can render without special cases.
 */
export function normalizeSurveysConfig(input: unknown): SurveysConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  const surveys = Array.isArray(raw.surveys) ? raw.surveys : [];
  const seen = new Set<string>();
  const policy = (raw.policy ?? {}) as Record<string, unknown>;
  const defaults = createAskPolicy();
  return {
    enabled: raw.enabled === true,
    policy: {
      cooldownHours: clampInt(policy.cooldownHours, 0, 720, defaults.cooldownHours),
      stopAfterDismissals: clampInt(
        policy.stopAfterDismissals,
        0,
        10,
        defaults.stopAfterDismissals,
      ),
    },
    updatedAt: nonNegative(raw.updatedAt, 0),
    surveys: surveys
      .map((s) => normalizeSurvey(s))
      .filter((s): s is Survey => {
        if (!s || !s.id || seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      }),
  };
}

function normalizeSurvey(input: unknown): Survey | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const id = slug(raw.id, "");
  if (!id) return null;
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  const seen = new Set<string>();
  return {
    id,
    name: str(raw.name, id, 80),
    enabled: raw.enabled === true,
    intro: str(raw.intro, "", 240),
    introRepeat: str(raw.introRepeat, "", 240),
    thanks: str(raw.thanks, "Thank you.", 240),
    appliesTo: unique(
      (Array.isArray(raw.appliesTo) ? raw.appliesTo : []).filter(
        (x): x is SurveyItemType =>
          SURVEY_ITEM_TYPES.includes(x as SurveyItemType),
      ),
    ),
    minPurchases: clampInt(raw.minPurchases, 0, 50, 1),
    sampleRate: clamp01(raw.sampleRate, 1),
    // At least one: a survey that can never be asked is a survey that looks
    // configured and does nothing. Switch it off to stop it instead.
    maxAsks: clampInt(raw.maxAsks, 1, MAX_ASKS_PER_SURVEY, 1),
    questions: questions
      .map((q) => normalizeQuestion(q))
      .filter((q): q is SurveyQuestion => {
        if (!q || seen.has(q.id)) return false;
        seen.add(q.id);
        return true;
      })
      .slice(0, MAX_QUESTIONS_PER_SURVEY),
  };
}

function normalizeQuestion(input: unknown): SurveyQuestion | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const id = slug(raw.id, "");
  if (!id) return null;
  const kind = QUESTION_KINDS.includes(raw.kind as SurveyQuestionKind)
    ? (raw.kind as SurveyQuestionKind)
    : "single";
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => normalizeOption(o))
    .filter((o): o is SurveyOption => o !== null)
    .slice(0, MAX_OPTIONS_PER_QUESTION);
  return {
    id,
    kind,
    prompt: str(raw.prompt, "", 200),
    hint: str(raw.hint, "", 200),
    required: raw.required === true,
    askOnce: raw.askOnce === true,
    // Only choice questions keep options; a leftover set on a rating question
    // would otherwise reappear the moment someone switched the kind back.
    options: isChoiceQuestion(kind) ? options : [],
    allowOther: isChoiceQuestion(kind) && raw.allowOther === true,
    maxSelections:
      kind === "multi"
        ? clampInt(raw.maxSelections, 0, MAX_OPTIONS_PER_QUESTION, 0)
        : 0,
    scaleMax: kind === "scale" ? clampInt(raw.scaleMax, 2, MAX_SCALE, 5) : 5,
    scaleLowLabel: kind === "scale" ? str(raw.scaleLowLabel, "", 40) : "",
    scaleHighLabel: kind === "scale" ? str(raw.scaleHighLabel, "", 40) : "",
    placeholder: kind === "text" ? str(raw.placeholder, "", 120) : "",
    maxLength: clampInt(raw.maxLength, 1, MAX_TEXT_LENGTH, 300),
  };
}

function normalizeOption(input: unknown): SurveyOption | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const id = slug(raw.id, "");
  if (!id) return null;
  return {
    id,
    label: str(raw.label, id, 120),
    // An unrecognized role becomes null rather than a guess: a wrong buyer role
    // is worse than a missing one, because it's indistinguishable from a real
    // answer in every report downstream.
    buyerRole: BUYER_ROLES.includes(raw.buyerRole as BuyerRole)
      ? (raw.buyerRole as BuyerRole)
      : null,
  };
}

// ---- Validation (save time) ------------------------------------------------

const optionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  buyerRole: z.enum(BUYER_ROLES).nullable(),
});

const questionSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(QUESTION_KINDS),
  prompt: z.string().max(200),
  hint: z.string().max(200),
  required: z.boolean(),
  askOnce: z.boolean(),
  options: z.array(optionSchema).max(MAX_OPTIONS_PER_QUESTION),
  allowOther: z.boolean(),
  maxSelections: z.number().min(0).max(MAX_OPTIONS_PER_QUESTION),
  scaleMax: z.number().min(2).max(MAX_SCALE),
  scaleLowLabel: z.string().max(40),
  scaleHighLabel: z.string().max(40),
  placeholder: z.string().max(120),
  maxLength: z.number().min(1).max(MAX_TEXT_LENGTH),
});

const surveySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  enabled: z.boolean(),
  intro: z.string().max(240),
  introRepeat: z.string().max(240),
  thanks: z.string().max(240),
  appliesTo: z.array(z.enum(["print", "ebook", "pack", "plan"])),
  minPurchases: z.number().min(0).max(50),
  sampleRate: z.number().min(0).max(1),
  maxAsks: z.number().min(1).max(MAX_ASKS_PER_SURVEY),
  questions: z.array(questionSchema).max(MAX_QUESTIONS_PER_SURVEY),
});

const policySchema = z.object({
  cooldownHours: z.number().min(0).max(720),
  stopAfterDismissals: z.number().min(0).max(10),
});

/**
 * The save-time gate, and the only place a survey is refused.
 *
 * Every refusal below is a mistake that would otherwise reach a paying customer's
 * screen and can't be undone from there — an unlabelled option, a question with
 * no prompt, a live survey with nothing in it. Copy that reads badly is an
 * admin's problem; a survey that renders as three blank radio buttons is ours.
 */
export const surveysConfigSchema = z
  .object({
    enabled: z.boolean(),
    policy: policySchema,
    surveys: z.array(surveySchema).max(20),
    updatedAt: z.number().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.enabled && config.policy.cooldownHours === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policy", "cooldownHours"],
        message:
          "With no cooldown, somebody who orders three books in one session gets three cards in a row. Give it at least a few hours.",
      });
    }
    const ids = new Set<string>();
    config.surveys.forEach((survey, i) => {
      if (ids.has(survey.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["surveys", i, "id"],
          message: `Two surveys share the id "${survey.id}". Ids are how answers are matched to questions, so they have to be unique.`,
        });
      }
      ids.add(survey.id);

      if (survey.enabled && survey.questions.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["surveys", i, "questions"],
          message: `"${survey.name}" is switched on with no questions. Add one, or switch it off.`,
        });
      }

      const questionIds = new Set<string>();
      survey.questions.forEach((question, qi) => {
        const at = (field: string, message: string) =>
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["surveys", i, "questions", qi, field],
            message,
          });

        if (questionIds.has(question.id)) {
          at(
            "id",
            `Two questions share the id "${question.id}" — answers would collide.`,
          );
        }
        questionIds.add(question.id);

        if (!question.prompt.trim()) {
          at("prompt", "Every question needs something to ask.");
        }

        if (isChoiceQuestion(question.kind)) {
          if (question.options.length < 2 && !question.allowOther) {
            at(
              "options",
              "A choice question needs at least two options — or one option and a 'something else' box.",
            );
          }
          const optionIds = new Set<string>();
          question.options.forEach((option) => {
            if (optionIds.has(option.id)) {
              at(
                "options",
                `Two options share the id "${option.id}", so their answers would merge.`,
              );
            }
            optionIds.add(option.id);
            if (!option.label.trim()) {
              at(
                "options",
                "An option with no label renders as an empty button.",
              );
            }
          });
        }

        if (question.kind === "multi" && question.maxSelections === 1) {
          at(
            "maxSelections",
            "A 'pick several' question capped at one is a 'pick one' question — switch the kind instead, so the answers aggregate properly.",
          );
        }

        if (
          question.kind === "scale" &&
          !question.scaleLowLabel.trim() &&
          !question.scaleHighLabel.trim()
        ) {
          at(
            "scaleLowLabel",
            "Label at least one end of the scale. Bare numbers mean different things to different people, which makes the average meaningless.",
          );
        }
      });

      const required = survey.questions.filter((q) => q.required).length;
      if (required > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["surveys", i, "questions"],
          message: `"${survey.name}" has ${required} required questions. On a card the customer can close, each one costs you answers to the others — keep at most one.`,
        });
      }

      // A survey set to repeat whose every question is ask-once has nothing left to
      // put on the card from the second ask onwards. It would look configured to
      // build a series and quietly behave like a one-off.
      if (
        survey.maxAsks > 1 &&
        survey.questions.length > 0 &&
        survey.questions.every((q) => q.askOnce)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["surveys", i, "maxAsks"],
          message: `"${survey.name}" is set to be asked ${survey.maxAsks} times, but every question is ask-once — there'd be nothing to show after the first. Let a question repeat, or set the limit to 1.`,
        });
      }
    });
  });

// ---- Prose -----------------------------------------------------------------

/** One line describing when a survey comes up, for the admin's list. */
export function describeSurveyAudience(survey: Survey): string {
  const what =
    survey.appliesTo.length === 0
      ? "any purchase"
      : joinList(
          survey.appliesTo.map((t) => SURVEY_ITEM_LABELS[t].toLowerCase()),
        );
  const who =
    survey.minPurchases <= 1
      ? ""
      : ` once they've bought ${survey.minPurchases} times`;
  const sample =
    survey.sampleRate >= 1
      ? ""
      : `, shown to ${Math.round(survey.sampleRate * 100)}% of them`;
  const times =
    survey.maxAsks <= 1 ? ", once ever" : `, up to ${survey.maxAsks} times`;
  return `After ${what}${who}${sample}${times}.`;
}

/**
 * How the ask policy reads in a sentence, for the admin.
 *
 * Generated rather than written into the copy because these two numbers together
 * decide something counter-intuitive — how sparse the purchase ordinals will be —
 * and an admin who raises the cooldown should see that consequence restated.
 */
export function describeAskPolicy(policy: AskPolicy): string {
  const gap =
    policy.cooldownHours <= 0
      ? "No gap between asks"
      : policy.cooldownHours === 24
        ? "At most one question card a day"
        : policy.cooldownHours < 24
          ? `At most one question card every ${policy.cooldownHours} hours`
          : `At most one question card every ${Math.round(policy.cooldownHours / 24)} days`;
  const stop =
    policy.stopAfterDismissals <= 0
      ? "never stopping on its own"
      : `stopping for good after ${policy.stopAfterDismissals} in a row are closed`;
  return `${gap}, ${stop}.`;
}

/**
 * What the buyer-role tags on a survey do and don't cover.
 *
 * Written for the admin editor, where the temptation is to tag every option so the
 * chart has no "couldn't tell" column. That column is the honest one, and this
 * sentence exists to make leaving it alone feel deliberate.
 */
export function describeBuyerRoleCoverage(survey: Survey): string {
  const choices = survey.questions.filter((q) => isChoiceQuestion(q.kind));
  const options = choices.flatMap((q) => q.options);
  if (options.length === 0) return "No options to identify a buyer from.";
  const tagged = options.filter((o) => o.buyerRole !== null);
  if (tagged.length === 0) {
    return "No option identifies who's buying, so every answer lands in “couldn't tell”.";
  }
  const roles = unique(tagged.map((o) => o.buyerRole as BuyerRole));
  return `${tagged.length} of ${options.length} options identify a buyer: ${joinList(
    roles.map((r) => BUYER_ROLE_LABELS[r].toLowerCase()),
  )}.`;
}

/** How long the card will feel, which is what governs whether it's answered. */
export function estimateSeconds(survey: Survey): number {
  return survey.questions.reduce((sum, q) => {
    if (q.kind === "text") return sum + 25;
    if (q.kind === "scale") return sum + 6;
    return sum + 5 + q.options.length;
  }, 3);
}

// ---- Helpers ---------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function str(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function slug(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  return cleaned || fallback;
}

function trimText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function joinList(items: string[], conjunction = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}
