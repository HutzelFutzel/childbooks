/**
 * Profiling survey invariants — checked against the real config engine rather
 * than a restatement of it.
 *
 * The failures here are quiet ones. A survey doesn't crash: it asks the wrong
 * person, or asks one person too often, or accepts an answer to a question that
 * no longer exists, or produces a report whose percentages don't describe
 * anybody. Every one of those passes a typecheck and looks fine on screen, and
 * every one of them ends with somebody making a decision on a number that isn't
 * true.
 *
 * The properties worth the most, now that a survey is a SERIES rather than a
 * one-off:
 *
 *   - **The ask policy is a ceiling, not a suggestion.** Opting out, dismissing
 *     repeatedly, the cooldown and the per-survey cap each stop the card on their
 *     own, and each of them is checked in the direction that protects the
 *     customer. A survey that asks a fifth time because a counter was read from
 *     the wrong field is not a bug anyone reports; they just leave.
 *   - **Sticky facts only ever turn on.** "Has children of their own" is the most
 *     durable thing this feature learns, and the fold that maintains it must not
 *     un-learn it when a later order is a gift. That single property is what makes
 *     "a parent buying for a friend's child" addressable.
 *   - **Revenue is counted once per account.** Three answers from one customer is
 *     three rows and one lifetime value. Dividing by rows instead of accounts
 *     would report the most loyal cohort as the most valuable one, which is
 *     circular and would send the marketing budget the wrong way.
 *   - **One definition of "complete".** The submit button and the route that
 *     persists answers call the same validator, so a survey the client thinks is
 *     finished can't be one the server throws away.
 *
 * Run by `yarn check:surveys`, which bundles this with esbuild first: the config
 * engine lives in the Next workspace as TypeScript, and re-implementing its rules
 * in a plain .mjs check would let the check pass while the shipped code was wrong.
 */
import {
  BUYER_ROLES,
  MAX_ASKS_PER_SURVEY,
  MAX_PROFILE_ANSWER_KEYS,
  MAX_TEXT_SAMPLES,
  OTHER_OPTION_ID,
  QUESTION_KINDS,
  buildSurveyReport,
  buyerFacts,
  canSubmit,
  createAskPolicy,
  createDefaultSurveysConfig,
  createOption,
  createQuestion,
  createSurvey,
  deriveBuyerProfile,
  describeAskPolicy,
  describeBuyerProfile,
  describeBuyerRoleCoverage,
  describeSurveyAudience,
  emptyAnswer,
  emptyBuyerProfile,
  emptyHistoryEntry,
  emptyPurchaseFacets,
  estimateSeconds,
  foldAnswers,
  isChoiceQuestion,
  itemTypeForPurchaseKind,
  normalizeBuyerProfile,
  normalizeSurveysConfig,
  ordinalBucket,
  pickSurvey,
  pickSurveyVerbose,
  prepareSurvey,
  rolesFromAnswers,
  surveysConfigSchema,
  validateAnswers,
  type AskPolicy,
  type PurchaseFacets,
  type Survey,
  type SurveyAnswer,
  type SurveyAudience,
  type SurveyHistoryEntry,
  type SurveyQuestion,
  type SurveyResponseRow,
  type SurveysConfig,
} from "../books-frontend/src/core/config/surveys";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

// ---- Fixtures ---------------------------------------------------------------

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function choice(over: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return {
    ...createQuestion("single", "q_choice"),
    prompt: "Who is this for?",
    options: [
      { id: "a", label: "A child", buyerRole: "parent" },
      { id: "b", label: "A grandchild", buyerRole: "grandparent" },
      { id: "c", label: "Someone else", buyerRole: null },
    ],
    ...over,
  };
}

function survey(over: Partial<Survey> = {}): Survey {
  return {
    ...createSurvey("s1"),
    name: "Test",
    enabled: true,
    questions: [choice()],
    ...over,
  };
}

function config(
  surveys: Survey[],
  enabled = true,
  policy: Partial<AskPolicy> = {},
): SurveysConfig {
  return {
    enabled,
    policy: { ...createAskPolicy(), ...policy },
    surveys,
    updatedAt: 0,
  };
}

/** An audience with nothing behind it: never asked, never dismissed, opted in. */
function audience(over: Partial<SurveyAudience> = {}): SurveyAudience {
  return {
    uid: "u1",
    purchaseCount: 1,
    history: [],
    lastAskedAt: 0,
    consecutiveDismissals: 0,
    optedOut: false,
    now: NOW,
    ...over,
  };
}

function entry(over: Partial<SurveyHistoryEntry> = {}): SurveyHistoryEntry {
  return { ...emptyHistoryEntry("s1"), ...over };
}

function answer(over: Partial<SurveyAnswer> & { questionId: string }): SurveyAnswer {
  return { ...emptyAnswer(over.questionId), ...over };
}

function facets(over: Partial<PurchaseFacets> = {}): PurchaseFacets {
  return { ...emptyPurchaseFacets(), ...over };
}

function row(over: Partial<SurveyResponseRow> = {}): SurveyResponseRow {
  return {
    uid: "u1",
    surveyId: "s1",
    status: "answered",
    askedAt: 1000,
    answeredAt: 2000,
    answers: [],
    askNumber: 1,
    optedOut: false,
    ordinal: 1,
    context: facets(),
    revenueUsd: 0,
    ...over,
  };
}

// ---- The shipped defaults ---------------------------------------------------

{
  const defaults = createDefaultSurveysConfig();

  check(
    "the default config is off",
    defaults.enabled === false,
    "shipping a config that starts asking customers questions the moment it deploys",
  );

  const parsed = surveysConfigSchema.safeParse(defaults);
  check(
    "the default config passes its own save-time validation",
    parsed.success,
    parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)),
  );

  const normalized = normalizeSurveysConfig(defaults);
  check(
    "normalizing the defaults changes nothing",
    JSON.stringify(normalized.surveys) === JSON.stringify(defaults.surveys),
  );

  check(
    "normalization is idempotent",
    JSON.stringify(normalizeSurveysConfig(normalized)) === JSON.stringify(normalized),
  );

  check(
    "the shipped policy has a real gap between asks",
    defaults.policy.cooldownHours >= 12,
    `${defaults.policy.cooldownHours}h — anything shorter puts two cards in front of somebody who bought two books in one sitting`,
  );
  check(
    "the shipped policy stops on repeated dismissals",
    defaults.policy.stopAfterDismissals > 0,
  );

  for (const starter of defaults.surveys) {
    const label = `the "${starter.name}" starter survey`;
    check(`${label} has questions`, starter.questions.length > 0);
    check(
      `${label} is answerable in well under a minute`,
      estimateSeconds(starter) <= 45,
      `${estimateSeconds(starter)}s — past about half a minute this reads as a form, and the people who still finish it aren't a representative sample`,
    );
    check(
      `${label} requires nothing`,
      starter.questions.every((q) => !q.required),
      "a required question on a card the customer can close converts a dismissal out of someone who would have answered",
    );
    check(
      `${label} labels every option`,
      starter.questions.every((q) => q.options.every((o) => o.label.trim().length > 0)),
    );
    check(
      `${label} gives every question a prompt`,
      starter.questions.every((q) => q.prompt.trim().length > 0),
    );
    check(
      `${label} stays inside the ask ceiling`,
      starter.maxAsks >= 1 && starter.maxAsks <= MAX_ASKS_PER_SURVEY,
    );
    // A repeating survey whose every question is ask-once looks like a series and
    // behaves like a one-off, and the second ask is an empty card.
    check(
      `${label} has something to ask on every ask it's configured for`,
      starter.maxAsks === 1 || starter.questions.some((q) => !q.askOnce),
    );
  }

  const profile = defaults.surveys.find((s) => s.id === "profile");
  check("the profiling survey exists", profile !== undefined);
  if (profile) {
    check(
      "the profiling survey is a series, not a one-off",
      profile.maxAsks > 1,
      "one ask per account can never show that a customer's second book is a gift, which is the finding the whole design exists for",
    );
    check(
      "the profiling survey has an opening line for later asks",
      profile.introRepeat.trim().length > 0,
      "the first-time line promises a question count that no longer holds once the ask-once questions have dropped out",
    );
    check(
      "the recipient question repeats",
      profile.questions.find((q) => q.id === "audience")?.askOnce === false,
    );
    check(
      "the attribution question is asked once",
      profile.questions.find((q) => q.id === "discovery")?.askOnce === true,
      "asking how somebody found us on their third order gets a worse answer than not asking",
    );
    check(
      "some options identify who's buying",
      profile.questions.some((q) => q.options.some((o) => o.buyerRole !== null)),
    );
    // The untagged options are load-bearing: tagging "a friend's child" as `friend`
    // would invent a fact about whether the buyer has children.
    check(
      "the ambiguous recipients are left untagged",
      ["relative", "friends_child"].every(
        (id) =>
          profile.questions
            .find((q) => q.id === "audience")
            ?.options.find((o) => o.id === id)?.buyerRole === null,
      ),
    );
  }

  check(
    "only one starter survey is switched on",
    // Two live surveys would both be eligible for the same purchase, and only the
    // first would ever be asked — so the second would look broken rather than
    // unreached.
    defaults.surveys.filter((s) => s.enabled).length === 1,
  );
}

// ---- The ask policy ---------------------------------------------------------
//
// Everything in this block is a way of not asking. Each gate is checked on its
// own, because they're evaluated in an order chosen so the admin's "why wasn't I
// asked?" answer names the strongest reason rather than the first match.

{
  const s = survey();

  check("a live survey is picked", pickSurvey(config([s]), audience())?.survey.id === "s1");
  check("a first ask is numbered 1", pickSurvey(config([s]), audience())?.askNumber === 1);

  check(
    "the master switch stops everything",
    pickSurveyVerbose(config([s], false), audience()).reason === "off",
  );
  check(
    "'don't ask again' outranks everything else",
    pickSurveyVerbose(config([s]), audience({ optedOut: true })).reason === "optedOut",
    "a stated preference must not be reachable by any amount of eligibility",
  );
  check(
    "an opted-out account is never asked, however clean its history",
    pickSurvey(config([s]), audience({ optedOut: true })) === null,
  );
  check(
    "repeated dismissals stop the feature for that account",
    pickSurveyVerbose(config([s]), audience({ consecutiveDismissals: 2 })).reason ===
      "dismissedTooOften",
  );
  check(
    "one dismissal is not a preference",
    pickSurvey(config([s]), audience({ consecutiveDismissals: 1 })) !== null,
    "somebody who closes a card reflexively and answers the next one is the normal case",
  );
  check(
    "the dismissal stop is off when configured to zero",
    pickSurvey(config([s], true, { stopAfterDismissals: 0 }), audience({ consecutiveDismissals: 9 })) !==
      null,
  );

  check(
    "an ask inside the cooldown is refused",
    pickSurveyVerbose(config([s]), audience({ lastAskedAt: NOW - 3 * HOUR })).reason === "cooldown",
    "three books bought in one evening reach three confirmation screens",
  );
  check(
    "an ask past the cooldown is allowed",
    pickSurvey(config([s]), audience({ lastAskedAt: NOW - 25 * HOUR })) !== null,
  );
  check(
    "the cooldown is measured against the injected clock, not the wall clock",
    pickSurvey(config([s]), audience({ lastAskedAt: NOW - 3 * HOUR, now: NOW + 48 * HOUR })) !== null,
  );
  check(
    "the cooldown spans surveys rather than each survey separately",
    // The audience's lastAskedAt is global on purpose: a per-survey gap would let
    // two surveys take turns nagging the same person.
    pickSurvey(
      config([survey({ id: "sa" }), survey({ id: "sb" })]),
      audience({ lastAskedAt: NOW - HOUR, history: [entry({ surveyId: "sa", asks: 1 })] }),
    ) === null,
  );

  check(
    "a switched-off survey is never picked",
    pickSurvey(config([{ ...s, enabled: false }]), audience()) === null,
  );
  check(
    "a survey with no questions is never picked",
    pickSurvey(config([{ ...s, questions: [] }]), audience()) === null,
  );
  check(
    "nothing eligible reports itself as such",
    pickSurveyVerbose(config([{ ...s, enabled: false }]), audience()).reason === "noEligibleSurvey",
  );

  check(
    "a one-ask survey is never asked twice",
    pickSurvey(config([s]), audience({ history: [entry({ asks: 1 })] })) === null,
  );
  check(
    "an ignored ask still counts as an ask",
    // Someone who let the card sit there has told us something, and re-asking is
    // how a dismissal stops meaning anything.
    pickSurvey(config([s]), audience({ history: [entry({ asks: 1, answers: 0, dismissals: 0 })] })) ===
      null,
  );

  const series = survey({ maxAsks: 3 });
  check(
    "a series survey is asked again",
    pickSurvey(config([series]), audience({ history: [entry({ asks: 1, answers: 1 })] }))?.askNumber === 2,
  );
  check(
    "the ask number counts asks, not answers",
    pickSurvey(config([series]), audience({ history: [entry({ asks: 2, answers: 0 })] }))?.askNumber === 3,
  );
  check(
    "the per-survey cap binds",
    pickSurvey(config([series]), audience({ history: [entry({ asks: 3, answers: 3 })] })) === null,
  );
  check(
    "a nonsense cap still permits one ask",
    pickSurvey(config([survey({ maxAsks: 0 })]), audience()) !== null,
    "a zero cap read literally would switch off a survey that looks live in the editor",
  );

  check(
    "history for a different survey doesn't block this one",
    pickSurvey(config([s]), audience({ history: [entry({ surveyId: "other", asks: 3 })] }))?.survey.id ===
      "s1",
  );

  check(
    "at most one survey is ever returned",
    // Two eligible surveys, and the answer is a single object rather than a list:
    // two question sets on a confirmation screen is a form, and a form gets closed.
    pickSurvey(config([s, { ...s, id: "s2" }]), audience())?.survey.id === "s1",
  );
  check(
    "the first eligible survey wins, in configured order",
    pickSurvey(config([{ ...s, enabled: false }, { ...s, id: "s2" }]), audience())?.survey.id === "s2",
  );
  check(
    "a capped-out survey doesn't block the next one",
    pickSurvey(
      config([survey({ id: "sa" }), survey({ id: "sb" })]),
      audience({ history: [entry({ surveyId: "sa", asks: 1 })] }),
    )?.survey.id === "sb",
  );
}

// ---- Preparing one ask ------------------------------------------------------

{
  const mixed = survey({
    maxAsks: 3,
    intro: "First time",
    introRepeat: "Again",
    questions: [choice(), choice({ id: "q_once", askOnce: true })],
  });

  check(
    "the first ask carries every question",
    prepareSurvey(mixed, 1, []).questions.length === 2,
  );
  check(
    "an answered ask-once question drops out of later asks",
    prepareSurvey(mixed, 2, ["q_once"]).questions.map((q) => q.id).join(",") === "q_choice",
  );
  check(
    "an ask-once question that was shown but not answered comes back",
    // Dropping it after an unanswered ask would lose the answer for good, and
    // skipping a question is not refusing it.
    prepareSurvey(mixed, 2, []).questions.length === 2,
  );
  check(
    "a repeating question is never dropped",
    prepareSurvey(mixed, 3, ["q_choice", "q_once"]).questions.map((q) => q.id).join(",") === "q_choice",
  );
  check("the first ask uses the first-time intro", prepareSurvey(mixed, 1, []).intro === "First time");
  check("a later ask uses the repeat intro", prepareSurvey(mixed, 2, []).intro === "Again");
  check(
    "a missing repeat intro falls back rather than showing an empty line",
    prepareSurvey(survey({ introRepeat: "" }), 2, []).intro === survey().intro,
  );
  check(
    "preparing never mutates the configured survey",
    (() => {
      const before = JSON.stringify(mixed);
      prepareSurvey(mixed, 2, ["q_once"]);
      return JSON.stringify(mixed) === before;
    })(),
  );

  check(
    "a survey whose remaining questions are all answered ask-once questions isn't asked",
    // The alternative is a card with a heading and no questions on it.
    pickSurvey(
      config([survey({ maxAsks: 3, questions: [choice({ askOnce: true })] })]),
      audience({ history: [entry({ asks: 1, answers: 1, answeredQuestionIds: ["q_choice"] })] }),
    ) === null,
  );
  check(
    "the picked survey carries only the questions it will ask",
    pickSurvey(
      config([mixed]),
      audience({ history: [entry({ asks: 1, answers: 1, answeredQuestionIds: ["q_once"] })] }),
    )?.survey.questions.length === 1,
    "the record of the ask stores exactly these ids, and the submit route validates against exactly them",
  );
}

// ---- Targeting: audience ---------------------------------------------------

{
  const printOnly = survey({ appliesTo: ["print"] });

  check(
    "an item-type filter matches its item",
    pickSurvey(config([printOnly]), audience({ itemType: "print" }))?.survey.id === "s1",
  );
  check(
    "an item-type filter excludes other items",
    pickSurvey(config([printOnly]), audience({ itemType: "ebook" })) === null,
  );
  check(
    "an item-type filter excludes an unknown item",
    pickSurvey(config([printOnly]), audience()) === null,
    "an unknown purchase is treated as not matching, which is the safe direction",
  );
  check(
    "no filter means any purchase",
    pickSurvey(config([survey()]), audience({ itemType: "pack" }))?.survey.id === "s1",
  );

  const repeat = survey({ minPurchases: 3 });
  check(
    "a purchase-count floor excludes people under it",
    pickSurvey(config([repeat]), audience({ purchaseCount: 2 })) === null,
  );
  check(
    "a purchase-count floor includes people at it",
    pickSurvey(config([repeat]), audience({ purchaseCount: 3 }))?.survey.id === "s1",
  );
}

// ---- Targeting: sampling ---------------------------------------------------

{
  const sampled = survey({ sampleRate: 0.5 });
  const asked = (uid: string) => pickSurvey(config([sampled]), audience({ uid })) !== null;

  check(
    "sampling is stable for the same account",
    // A customer who reloads the confirmation page has to see the same thing, and
    // an admin asking "why wasn't I asked?" needs a stable answer.
    [...Array(20)].every(() => asked("u1") === asked("u1")),
  );
  check(
    "a sampled-in account stays in for its later asks",
    // Sampling on uid+surveyId rather than per ask: half a series is worse than
    // none, because the transitions it produces are between non-adjacent orders.
    [...Array(200)]
      .map((_, i) => `u_${i}`)
      .filter((uid) => pickSurvey(config([survey({ sampleRate: 0.5, maxAsks: 3 })]), audience({ uid })) !== null)
      .every(
        (uid) =>
          pickSurvey(
            config([survey({ sampleRate: 0.5, maxAsks: 3 })]),
            audience({ uid, history: [entry({ asks: 1, answers: 1 })] }),
          ) !== null,
      ),
  );

  const population = [...Array(2000)].map((_, i) => asked(`uid_${i}`));
  const share = population.filter(Boolean).length / population.length;
  check(
    "a 50% sample asks roughly half",
    share > 0.42 && share < 0.58,
    `${Math.round(share * 100)}%`,
  );

  check(
    "a full sample asks everyone",
    [...Array(200)].every(
      (_, i) => pickSurvey(config([survey()]), audience({ uid: `u_${i}` })) !== null,
    ),
  );

  check(
    "different surveys sample independently",
    // Same salt for two surveys would mean one cohort answers everything and the
    // rest are never asked anything.
    (() => {
      const a = [...Array(400)].map(
        (_, i) => pickSurvey(config([survey({ id: "sa", sampleRate: 0.5 })]), audience({ uid: `u_${i}` })) !== null,
      );
      const b = [...Array(400)].map(
        (_, i) => pickSurvey(config([survey({ id: "sb", sampleRate: 0.5 })]), audience({ uid: `u_${i}` })) !== null,
      );
      const agree = a.filter((x, i) => x === b[i]).length / a.length;
      return agree > 0.4 && agree < 0.6;
    })(),
  );
}

// ---- Answer validation -----------------------------------------------------

{
  const single = choice();
  const s = survey({ questions: [single] });

  check(
    "a valid single answer survives",
    validateAnswers(s, [answer({ questionId: "q_choice", optionIds: ["a"] })]).answers[0]?.optionIds[0] ===
      "a",
  );

  check(
    "an unknown option id is dropped",
    validateAnswers(s, [answer({ questionId: "q_choice", optionIds: ["nope"] })]).answers.length === 0,
  );

  check(
    "an unknown question id is dropped, not rejected",
    // A survey edited between the ask and the submit is normal; discarding the
    // whole submission over one stale id would throw away real answers.
    (() => {
      const result = validateAnswers(s, [
        answer({ questionId: "gone", optionIds: ["x"] }),
        answer({ questionId: "q_choice", optionIds: ["b"] }),
      ]);
      return result.ok && result.answers.length === 1 && result.answers[0].questionId === "q_choice";
    })(),
  );

  check(
    "an answer to a question this ask didn't carry is dropped",
    // The submit route validates against the prepared survey, so an ask-once
    // question that dropped out can't be answered a second time by a stale client.
    validateAnswers(prepareSurvey(survey({ questions: [choice({ askOnce: true })] }), 2, ["q_choice"]), [
      answer({ questionId: "q_choice", optionIds: ["a"] }),
    ]).answers.length === 0,
  );

  check(
    "a 'pick one' question keeps only one answer",
    validateAnswers(s, [answer({ questionId: "q_choice", optionIds: ["a", "b"] })]).answers[0]
      ?.optionIds.length === 1,
  );

  check(
    "free text is ignored unless the question offers it",
    validateAnswers(s, [answer({ questionId: "q_choice", text: "smuggled" })]).answers.length === 0,
  );

  check(
    "free text counts as an answer when the question offers it",
    validateAnswers(survey({ questions: [choice({ allowOther: true })] }), [
      answer({ questionId: "q_choice", text: "A neighbour" }),
    ]).answers.length === 1,
    "someone who answered in their own words has still answered",
  );

  const multi = choice({ id: "q_multi", kind: "multi", maxSelections: 2 });
  const multiSurvey = survey({ questions: [multi] });
  check(
    "a multi-select cap is enforced",
    !validateAnswers(multiSurvey, [answer({ questionId: "q_multi", optionIds: ["a", "b", "c"] })]).ok,
  );
  check(
    "a multi-select under its cap is fine",
    validateAnswers(multiSurvey, [answer({ questionId: "q_multi", optionIds: ["a", "b"] })]).ok,
  );
  check(
    "duplicate selections collapse",
    validateAnswers(multiSurvey, [answer({ questionId: "q_multi", optionIds: ["a", "a"] })]).answers[0]
      ?.optionIds.length === 1,
  );

  const scaleSurvey = survey({
    questions: [{ ...createQuestion("scale", "q_scale"), prompt: "How likely?", scaleMax: 10 }],
  });
  check(
    "an in-range rating survives",
    validateAnswers(scaleSurvey, [answer({ questionId: "q_scale", value: 7 })]).answers[0]?.value === 7,
  );
  check(
    "an out-of-range rating is refused",
    !validateAnswers(scaleSurvey, [answer({ questionId: "q_scale", value: 11 })]).ok,
  );
  check(
    "a rating of zero is 'not answered', not a zero score",
    validateAnswers(scaleSurvey, [answer({ questionId: "q_scale", value: 0 })]).answers.length === 0,
  );

  const textSurvey = survey({
    questions: [{ ...createQuestion("text", "q_text"), prompt: "Anything else?", maxLength: 10 }],
  });
  check(
    "text is truncated to the configured limit",
    validateAnswers(textSurvey, [answer({ questionId: "q_text", text: "x".repeat(50) })]).answers[0]
      ?.text.length === 10,
  );
  check(
    "whitespace-only text isn't an answer",
    validateAnswers(textSurvey, [answer({ questionId: "q_text", text: "   " })]).answers.length === 0,
  );

  const required = survey({ questions: [choice({ required: true })] });
  check("a required question blocks an empty submission", !validateAnswers(required, []).ok);
  check(
    "a required question is satisfied by an answer",
    validateAnswers(required, [answer({ questionId: "q_choice", optionIds: ["a"] })]).ok,
  );

  check("nothing at all can't be submitted", !canSubmit(s, []));
  check(
    "one answer is enough to submit",
    canSubmit(s, [answer({ questionId: "q_choice", optionIds: ["a"] })]),
  );
  check(
    "an invalid answer can't be submitted",
    !canSubmit(multiSurvey, [answer({ questionId: "q_multi", optionIds: ["a", "b", "c"] })]),
  );

  check(
    "validation never invents answers",
    // Everything the validator returns has to have come from the customer, or the
    // report is describing opinions nobody expressed.
    validateAnswers(
      survey({ questions: [choice(), { ...createQuestion("text", "q_text"), prompt: "Why?" }] }),
      [answer({ questionId: "q_choice", optionIds: ["a"] })],
    ).answers.length === 1,
  );
}

// ---- Normalization ---------------------------------------------------------

{
  check(
    "a survey with no id is dropped",
    normalizeSurveysConfig({ enabled: true, surveys: [{ name: "nameless" }] }).surveys.length === 0,
  );

  check(
    "duplicate survey ids are dropped",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ id: "dup" }), survey({ id: "dup", name: "second" })],
    }).surveys.length === 1,
    "two surveys sharing an id would share an 'already asked' record",
  );

  check(
    "duplicate question ids are dropped",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ questions: [choice(), choice()] })],
    }).surveys[0].questions.length === 1,
    "two questions sharing an id would collide in every answer",
  );

  check(
    "options are stripped from a question that can't use them",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ questions: [choice({ kind: "scale" })] })],
    }).surveys[0].questions[0].options.length === 0,
    "a leftover option set would reappear the moment the kind was switched back",
  );

  check(
    "'something else' is stripped from a non-choice question",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ questions: [choice({ kind: "scale", allowOther: true })] })],
    }).surveys[0].questions[0].allowOther === false,
  );

  check(
    "a sample rate is clamped into 0…1",
    normalizeSurveysConfig({ enabled: true, surveys: [survey({ sampleRate: 4 })] }).surveys[0]
      .sampleRate === 1,
  );

  check(
    "a nonsense sample rate falls back to everyone",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [{ ...survey(), sampleRate: "half" as unknown as number }],
    }).surveys[0].sampleRate === 1,
  );

  check(
    "an ask cap over the ceiling is clamped",
    normalizeSurveysConfig({ enabled: true, surveys: [survey({ maxAsks: 99 })] }).surveys[0].maxAsks ===
      MAX_ASKS_PER_SURVEY,
    "an uncapped series follows somebody around their own purchase history",
  );
  check(
    "a missing ask cap means once",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [{ ...survey(), maxAsks: undefined as unknown as number }],
    }).surveys[0].maxAsks === 1,
    "the safe default when a field is absent is the least intrusive one",
  );
  check(
    "an unknown buyer role on an option is dropped rather than kept",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ questions: [choice({ options: [{ id: "a", label: "A", buyerRole: "wizard" as never }] })] })],
    }).surveys[0].questions[0].options[0].buyerRole === null,
    "an unrecognised role would fail a lookup in every chart that renders it",
  );

  check(
    "a missing policy falls back to the shipped defaults",
    (() => {
      const p = normalizeSurveysConfig({ enabled: true, surveys: [] }).policy;
      return p.cooldownHours === createAskPolicy().cooldownHours;
    })(),
    "an absent policy read as zeroes would remove every guard rail at once",
  );
  check(
    "a nonsense cooldown falls back rather than becoming zero",
    normalizeSurveysConfig({
      enabled: true,
      policy: { cooldownHours: "soon", stopAfterDismissals: 2 },
      surveys: [],
    }).policy.cooldownHours > 0,
  );

  check(
    "an unknown question kind falls back to a choice question",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ questions: [{ ...choice(), kind: "telepathy" as never }] })],
    }).surveys[0].questions[0].kind === "single",
  );

  check(
    "an unknown item-type filter is dropped",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [survey({ appliesTo: ["print", "hovercraft" as never] })],
    }).surveys[0].appliesTo.length === 1,
  );

  check(
    "garbage normalizes to an empty, off config",
    (() => {
      const empty = normalizeSurveysConfig("nonsense");
      return empty.enabled === false && empty.surveys.length === 0;
    })(),
  );

  check(
    "a question count over the cap is truncated",
    normalizeSurveysConfig({
      enabled: true,
      surveys: [
        survey({
          questions: [...Array(20)].map((_, i) => ({ ...choice(), id: `q${i}` })),
        }),
      ],
    }).surveys[0].questions.length === 8,
  );
}

// ---- Save-time refusals ----------------------------------------------------

{
  const refuses = (
    name: string,
    surveys: Survey[],
    expect: string,
    policy: Partial<AskPolicy> = {},
  ) => {
    const result = surveysConfigSchema.safeParse({
      enabled: true,
      policy: { ...createAskPolicy(), ...policy },
      surveys,
    });
    const messages = result.success ? "" : result.error.issues.map((i) => i.message).join(" | ");
    check(`saving is refused: ${name}`, !result.success && messages.includes(expect), messages || "accepted");
  };

  refuses("a live survey with no questions", [survey({ questions: [] })], "no questions");
  refuses(
    "two surveys sharing an id",
    [survey({ id: "dup" }), survey({ id: "dup" })],
    "share the id",
  );
  refuses(
    "two questions sharing an id",
    [survey({ questions: [choice(), { ...choice(), prompt: "Other" }] })],
    "share the id",
  );
  refuses("a question with no prompt", [survey({ questions: [choice({ prompt: "" })] })], "needs something to ask");
  refuses(
    "an unlabelled option",
    [survey({ questions: [choice({ options: [createOption("Yes", "y"), createOption("", "n")] })] })],
    "empty button",
  );
  refuses(
    "a choice question with one option and no escape hatch",
    [survey({ questions: [choice({ options: [createOption("Only", "o")] })] })],
    "at least two options",
  );
  refuses(
    "a 'pick several' capped at one",
    [survey({ questions: [choice({ kind: "multi", maxSelections: 1 })] })],
    "switch the kind",
  );
  refuses(
    "an unlabelled scale",
    [
      survey({
        questions: [
          { ...createQuestion("scale", "q_s"), prompt: "How much?", scaleLowLabel: "", scaleHighLabel: "" },
        ],
      }),
    ],
    "Label at least one end",
  );
  refuses(
    "more than one required question",
    [survey({ questions: [choice({ required: true }), choice({ id: "q2", required: true })] })],
    "required questions",
  );
  // The two failures the series design introduced, and both of them look correct
  // in the editor: a repeat survey with nothing left to ask, and a live feature
  // with no gap between asks.
  refuses(
    "a repeating survey whose every question is ask-once",
    [survey({ maxAsks: 3, questions: [choice({ askOnce: true })] })],
    "nothing to show after the first",
  );
  refuses("a live config with no cooldown", [survey()], "at least a few hours", { cooldownHours: 0 });

  check(
    "a valid survey saves",
    surveysConfigSchema.safeParse({
      enabled: true,
      policy: createAskPolicy(),
      surveys: [survey({ questions: [choice({ allowOther: true })] })],
    }).success,
  );

  check(
    "a series with one repeating question saves",
    surveysConfigSchema.safeParse({
      enabled: true,
      policy: createAskPolicy(),
      surveys: [survey({ maxAsks: 3, questions: [choice(), choice({ id: "q2", askOnce: true })] })],
    }).success,
  );

  check(
    "an ask cap over the ceiling is refused",
    !surveysConfigSchema.safeParse({
      enabled: true,
      policy: createAskPolicy(),
      surveys: [survey({ maxAsks: MAX_ASKS_PER_SURVEY + 1 })],
    }).success,
  );

  check(
    "a switched-off survey with no questions is allowed",
    // Half-built drafts have to be savable, or the editor can't be used.
    surveysConfigSchema.safeParse({
      enabled: true,
      policy: createAskPolicy(),
      surveys: [survey({ enabled: false, questions: [] })],
    }).success,
  );
}

// ---- The derived buyer profile ---------------------------------------------
//
// This is the reciprocal half of the design: the customer says who the book is
// for, and we learn who they are. It has to be monotonic in the sticky facts,
// because those facts are what make "a parent buying a gift" a targetable
// audience three orders after the parent said anything about their own child.

{
  const s = survey({ questions: [choice()] });
  const ownChild = [answer({ questionId: "q_choice", optionIds: ["a"] })];
  const grandchild = [answer({ questionId: "q_choice", optionIds: ["b"] })];
  const untagged = [answer({ questionId: "q_choice", optionIds: ["c"] })];

  check(
    "an option's role is read off the option, not guessed from the label",
    rolesFromAnswers(s, ownChild).join(",") === "parent",
  );
  check(
    "an untagged option identifies nobody",
    rolesFromAnswers(s, untagged).length === 0,
    "tagging \"a friend's child\" would invent a fact about whether the buyer has children",
  );
  check(
    "an answer to a deleted question identifies nobody rather than throwing",
    rolesFromAnswers(s, [answer({ questionId: "gone", optionIds: ["a"] })]).length === 0,
  );
  check(
    "a multi-select can identify two roles at once",
    rolesFromAnswers(survey({ questions: [choice({ kind: "multi" })] }), [
      answer({ questionId: "q_choice", optionIds: ["a", "b"] }),
    ]).join(",") === "parent,grandparent",
    "a teacher who is also a parent is genuinely both",
  );

  const first = foldAnswers(emptyBuyerProfile(), s, ownChild, 1000);
  check("a parent answer sets the sticky fact", first.hasOwnChildren === true);
  check("a parent answer sets the latest role", first.latestRole === "parent");
  check("the fold counts answers", first.answers === 1);
  check("the fold remembers the answer key", first.answered.join(",") === "s1:q_choice:a");

  const later = foldAnswers(first, s, grandchild, 2000);
  check(
    "a sticky fact is never un-learned",
    later.hasOwnChildren === true,
    "somebody who once bought for their own child still has a child three orders later",
  );
  check("a newer answer moves the latest role", later.latestRole === "grandparent");
  check("both roles are remembered, first seen first", later.roles.join(",") === "parent,grandparent");

  const ambiguous = foldAnswers(later, s, untagged, 3000);
  check(
    "an unidentifiable answer leaves the latest role standing",
    ambiguous.latestRole === "grandparent",
    "\"we couldn't tell this time\" is not \"they stopped being a grandparent\"",
  );
  check("an unidentifiable answer still counts as an answer", ambiguous.answers === 3);
  check(
    "an unidentifiable answer still records what was chosen",
    ambiguous.answered.includes("s1:q_choice:c"),
    "targeting on the occasion needs the key even when the option says nothing about the buyer",
  );

  check(
    "answer keys are namespaced by survey and question",
    // Two surveys with an "audience" question and an "a" option must not merge, or
    // a campaign targeting one would silently include the other.
    foldAnswers(emptyBuyerProfile(), survey({ id: "other" }), ownChild, 1).answered[0] ===
      "other:q_choice:a",
  );
  check(
    "the same answer twice doesn't duplicate its key",
    foldAnswers(first, s, ownChild, 2000).answered.length === 1,
  );
  check(
    "the answer-key list is bounded",
    (() => {
      const many = survey({
        questions: [
          choice({
            kind: "multi",
            options: [...Array(20)].map((_, i) => ({ id: `o${i}`, label: `O${i}`, buyerRole: null })),
          }),
        ],
      });
      let profile = emptyBuyerProfile();
      for (let round = 0; round < 20; round++) {
        profile = foldAnswers(
          profile,
          { ...many, id: `s${round}` },
          [answer({ questionId: "q_choice", optionIds: many.questions[0].options.map((o) => o.id) })],
          round,
        );
      }
      return profile.answered.length === MAX_PROFILE_ANSWER_KEYS;
    })(),
    "a profile is a summary, not a second copy of the answers",
  );
  check(
    "the newest keys are the ones kept",
    (() => {
      const wide = survey({
        questions: [
          choice({
            kind: "multi",
            options: [...Array(20)].map((_, i) => ({ id: `o${i}`, label: `O${i}`, buyerRole: null })),
          }),
        ],
      });
      let profile = emptyBuyerProfile();
      for (let round = 0; round < 10; round++) {
        profile = foldAnswers(
          profile,
          { ...wide, id: `s${round}` },
          [answer({ questionId: "q_choice", optionIds: wide.questions[0].options.map((o) => o.id) })],
          round,
        );
      }
      return profile.answered.some((k) => k.startsWith("s9:")) && !profile.answered.some((k) => k.startsWith("s0:"));
    })(),
    "a live campaign is most likely to be targeting the newest answers",
  );

  check(
    "the fold never mutates the profile it was given",
    (() => {
      const before = JSON.stringify(first);
      foldAnswers(first, s, grandchild, 9000);
      return JSON.stringify(first) === before;
    })(),
  );

  check(
    "rebuilding from rows reads them oldest first",
    // The report rebuilds profiles from rows in whatever order Firestore returned
    // them; the latest role has to come from the newest answer regardless.
    deriveBuyerProfile(s, [
      { answers: grandchild, answeredAt: 2000 },
      { answers: ownChild, answeredAt: 1000 },
    ]).latestRole === "grandparent",
  );
  check(
    "rebuilding from rows accumulates sticky facts",
    deriveBuyerProfile(s, [
      { answers: grandchild, answeredAt: 2000 },
      { answers: ownChild, answeredAt: 1000 },
    ]).hasOwnChildren === true,
  );
  check(
    "an unanswered row contributes nothing",
    deriveBuyerProfile(s, [{ answers: ownChild, answeredAt: 0 }]).answers === 0,
  );
  check(
    "rebuilding and folding agree",
    // One definition of accumulation, or the report and the live profile drift and
    // the admin sees different roles in two places.
    JSON.stringify(
      deriveBuyerProfile(s, [
        { answers: ownChild, answeredAt: 1000 },
        { answers: grandchild, answeredAt: 2000 },
      ]),
    ) === JSON.stringify(later),
  );

  check(
    "the admin summary carries the facts without the answer keys",
    // The users table ships one of these per row. Letting the keys ride along would
    // multiply that payload by eighty to render a single word.
    (() => {
      const summary = buyerFacts(later) as Record<string, unknown>;
      return !("answered" in summary) && summary.latestRole === "grandparent";
    })(),
  );
  check(
    "the summary is enough to describe somebody",
    describeBuyerProfile(buyerFacts(later)) === describeBuyerProfile(later),
  );

  check(
    "an unknown stored role is dropped on read",
    normalizeBuyerProfile({ latestRole: "wizard", roles: ["parent", "wizard"] }).roles.join(",") === "parent",
  );
  check(
    "an unknown latest role reads as unidentified",
    normalizeBuyerProfile({ latestRole: "wizard" }).latestRole === null,
  );
  check(
    "a garbage profile reads as an empty one",
    JSON.stringify(normalizeBuyerProfile("nonsense")) === JSON.stringify(emptyBuyerProfile()),
  );
  check(
    "reading a stored profile is idempotent",
    JSON.stringify(normalizeBuyerProfile(normalizeBuyerProfile(later))) === JSON.stringify(normalizeBuyerProfile(later)),
  );
  check(
    "a stored profile can't smuggle in an unbounded key list",
    normalizeBuyerProfile({ answered: [...Array(500)].map((_, i) => `s:q:o${i}`) }).answered.length ===
      MAX_PROFILE_ANSWER_KEYS,
  );
  check(
    "every buyer role survives a round trip through storage",
    BUYER_ROLES.every((role) => normalizeBuyerProfile({ latestRole: role }).latestRole === role),
  );
}

// ---- The report ------------------------------------------------------------

{
  const s = survey({
    questions: [
      choice(),
      { ...createQuestion("scale", "q_scale"), prompt: "How likely?", scaleMax: 10 },
      { ...createQuestion("text", "q_text"), prompt: "Anything else?" },
    ],
  });

  const rows: SurveyResponseRow[] = [
    row({ uid: "u1", revenueUsd: 100, answers: [answer({ questionId: "q_choice", optionIds: ["a"] })] }),
    row({ uid: "u2", revenueUsd: 300, answers: [answer({ questionId: "q_choice", optionIds: ["b"] })] }),
    row({ uid: "u3", revenueUsd: 0, answers: [answer({ questionId: "q_choice", optionIds: ["a"] })] }),
    row({ uid: "u4", status: "dismissed", answers: [] }),
    row({ uid: "u5", status: "asked", answers: [], optedOut: true }),
  ];
  const report = buildSurveyReport(s, rows);

  check("everyone asked is counted as asked", report.asked === 5);
  check("only answers count as answers", report.responses === 3);
  check("dismissals are counted", report.dismissed === 1);
  check("opt-outs are counted", report.optedOut === 1);
  check(
    "the response rate is answered over asked",
    Math.abs(report.responseRate - 3 / 5) < 1e-9,
    String(report.responseRate),
  );
  check(
    "the opt-out rate is opt-outs over asks",
    Math.abs(report.optOutRate - 1 / 5) < 1e-9,
    "the health metric for the whole feature: a response rate can look fine while the people who hated being asked remove themselves",
  );
  check("respondent revenue is totalled", report.revenueUsd === 400);

  const q = report.questions[0];
  check("a question counts only the people who answered it", q.responses === 3);
  check(
    "shares are of the answers to that question",
    Math.abs(q.options.reduce((sum, o) => sum + o.share, 0) - 1) < 1e-9,
    q.options.map((o) => `${o.optionId}=${o.share}`).join(" "),
  );
  check(
    "options are ordered by popularity",
    q.options[0].optionId === "a" && q.options[0].responses === 2,
  );
  check(
    "revenue per account is revenue over accounts, not over buyers",
    // Two people chose "a", one of whom spent nothing: $100 across 2 is $50. Using
    // buyers as the denominator would report $100 and overstate the group.
    q.options.find((o) => o.optionId === "a")?.revenuePerAccount === 50,
    JSON.stringify(q.options.find((o) => o.optionId === "a")),
  );
  check(
    "buyers are counted separately from accounts",
    q.options.find((o) => o.optionId === "a")?.buyers === 1,
  );
  check(
    "an unchosen option doesn't appear",
    !q.options.some((o) => o.optionId === "c"),
    "a zero row is noise; its absence is the same information",
  );
  check("labels come from the survey", q.options[0].label === "A child");

  // The property the whole per-order design turns on. One customer, three answers,
  // one lifetime value: dividing by rows would make the most loyal cohort look the
  // most valuable, which is circular and would misdirect the budget.
  const seriesReport = buildSurveyReport(s, [
    row({ uid: "u1", askNumber: 1, ordinal: 1, revenueUsd: 300, answeredAt: 1000, answers: [answer({ questionId: "q_choice", optionIds: ["a"] })] }),
    row({ uid: "u1", askNumber: 2, ordinal: 2, revenueUsd: 300, answeredAt: 2000, answers: [answer({ questionId: "q_choice", optionIds: ["a"] })] }),
    row({ uid: "u1", askNumber: 3, ordinal: 4, revenueUsd: 300, answeredAt: 3000, answers: [answer({ questionId: "q_choice", optionIds: ["a"] })] }),
  ]);
  check(
    "one account's lifetime value is counted once however often they answered",
    seriesReport.revenueUsd === 300,
    String(seriesReport.revenueUsd),
  );
  check(
    "an option's revenue per account is per account, not per answer",
    seriesReport.questions[0].options[0].revenuePerAccount === 300,
  );
  check("three answers from one person is three answers", seriesReport.responses === 3);
  check("three answers from one person is one respondent", seriesReport.respondents === 1);
  check(
    "answers per respondent shows how much of a series this became",
    seriesReport.answersPerRespondent === 3,
  );

  const scaleReport = buildSurveyReport(s, [
    row({ uid: "a", answers: [answer({ questionId: "q_scale", value: 10 })] }),
    row({ uid: "b", answers: [answer({ questionId: "q_scale", value: 7 })] }),
  ]).questions[1];
  check("a rating question averages", scaleReport.average === 8.5, String(scaleReport.average));
  check(
    "ratings are bucketed so they cross-tab like any other answer",
    scaleReport.options.length === 2,
  );
  check(
    "rating buckets read in numeric order",
    scaleReport.options[0].optionId === "7",
    scaleReport.options.map((o) => o.optionId).join(","),
  );

  const otherReport = buildSurveyReport(survey({ questions: [choice({ allowOther: true })] }), [
    row({ uid: "a", revenueUsd: 60, answers: [answer({ questionId: "q_choice", text: "A neighbour" })] }),
  ]).questions[0];
  check(
    "a written-in answer lands in its own bucket",
    otherReport.options[0]?.optionId === OTHER_OPTION_ID,
    "otherwise the person answered and the chart forgot them",
  );
  check("the write-in bucket is labelled for a human", otherReport.options[0]?.label === "Something else");
  check("write-in revenue is attributed", otherReport.options[0]?.revenueUsd === 60);

  const textReport = buildSurveyReport(s, [
    row({ uid: "a", answeredAt: 1, answers: [answer({ questionId: "q_text", text: "older" })] }),
    row({ uid: "b", answeredAt: 9, answers: [answer({ questionId: "q_text", text: "newer" })] }),
  ]).questions[2];
  check("free text is kept verbatim, newest first", textReport.samples[0] === "newer");
  check(
    "free text samples are capped",
    buildSurveyReport(s, [...Array(200)].map((_, i) =>
      row({ uid: `u${i}`, answeredAt: i, answers: [answer({ questionId: "q_text", text: `t${i}` })] }),
    )).questions[2].samples.length === MAX_TEXT_SAMPLES,
  );

  const empty = buildSurveyReport(s, []);
  check(
    "an unanswered survey reports zeroes rather than dividing by zero",
    empty.responseRate === 0 &&
      empty.optOutRate === 0 &&
      empty.answersPerRespondent === 0 &&
      empty.questions.every((q2) => q2.responses === 0 && q2.average === 0),
  );
  check(
    "an unanswered survey has no segments, ordinals or transitions",
    empty.segments.length === 0 && empty.ordinals.length === 0 && empty.transitions.length === 0,
    "an empty table is honest; a table of zero rows labelled with every role is not",
  );

  check(
    "the truncation flag is carried through",
    buildSurveyReport(s, rows, { truncated: true }).truncated === true,
    "a report that silently became a sample is a report that lies about its population",
  );

  check(
    "an answer to a since-deleted option still counts",
    // Deleting an option must not make the people who chose it vanish from the
    // totals, or the shares stop describing the population that answered.
    (() => {
      const trimmed = survey({ questions: [choice({ options: [{ id: "a", label: "A child", buyerRole: "parent" }] })] });
      const r = buildSurveyReport(trimmed, [
        row({ uid: "x", answers: [answer({ questionId: "q_choice", optionIds: ["b"] })] }),
      ]).questions[0];
      return r.responses === 1 && r.options[0]?.optionId === "b" && r.options[0]?.label === "b";
    })(),
  );
}

// ---- The report: ordinals, segments and transitions ------------------------
//
// The three views the per-order design was built to produce. They all read the
// same tagged rows, so the thing worth checking is that each one's denominator is
// the population it claims to describe.

{
  const s = survey({ maxAsks: 3, questions: [choice()] });
  const pick = (optionId: string) => [answer({ questionId: "q_choice", optionIds: [optionId] })];

  check("a first purchase buckets as first", ordinalBucket(1) === "first");
  check("a second purchase buckets as second", ordinalBucket(2) === "second");
  check(
    "anything further along buckets together",
    ordinalBucket(3) === "later" && ordinalBucket(9) === "later",
    "the cap and the cooldown make ordinals sparse, so 'exactly the third' is a cell with nobody in it",
  );
  check(
    "an unplaceable purchase is its own bucket rather than a first order",
    ordinalBucket(0) === "unknown",
    "counting a row we couldn't place as a first order would overstate the finding this report exists to test",
  );

  const report = buildSurveyReport(s, [
    // A parent whose first book is for their own child and whose later ones are gifts.
    row({ uid: "p1", ordinal: 1, answeredAt: 1000, revenueUsd: 100, answers: pick("a"), context: facets({ themeId: "birthday" }) }),
    row({ uid: "p1", ordinal: 2, answeredAt: 2000, revenueUsd: 100, answers: pick("c"), context: facets({ themeId: "zoo" }) }),
    // A grandparent, twice.
    row({ uid: "g1", ordinal: 1, answeredAt: 1500, revenueUsd: 400, answers: pick("b"), context: facets({ themeId: "birthday", settingId: "farm" }) }),
    row({ uid: "g1", ordinal: 3, answeredAt: 2500, revenueUsd: 400, answers: pick("b"), context: facets({ themeId: "birthday" }) }),
  ]);

  const parents = report.segments.find((seg) => seg.role === "parent");
  const grandparents = report.segments.find((seg) => seg.role === "grandparent");
  const unknown = report.segments.find((seg) => seg.role === "unknown");
  check("segments name the roles that answered", parents !== undefined && grandparents !== undefined);
  check(
    "an answer that identified nobody is its own segment",
    unknown !== undefined && unknown.label === "Couldn't tell",
    "dropping it would make every share describe a smaller population than the header claims",
  );
  check(
    "segment shares are of all answers",
    Math.abs(report.segments.reduce((sum, seg) => sum + seg.share, 0) - 1) < 1e-9,
    report.segments.map((seg) => `${seg.role}=${seg.share}`).join(" "),
  );
  check("segments are ordered biggest first", report.segments[0].responses >= report.segments[1].responses);
  check(
    "a segment's revenue is per account, not per answer",
    grandparents?.revenuePerAccount === 400,
    JSON.stringify(grandparents),
  );
  check(
    "a segment reports what those buyers' books were about",
    grandparents?.subjects[0]?.id === "birthday",
  );
  check(
    "theme and setting share one ranked subject list",
    grandparents?.subjects.some((subject) => subject.id === "farm") === true,
    "an admin asking what grandparents buy wants one list, not two half-empty ones",
  );
  check(
    "a segment reports where in their history those answers sat",
    grandparents?.ordinals.some((o) => o.id === "first") === true,
  );

  const firstOrders = report.ordinals.find((o) => o.bucket === "first");
  check("first orders are reported", firstOrders?.responses === 2);
  check(
    "an empty ordinal bucket is left out",
    !report.ordinals.some((o) => o.bucket === "unknown"),
    "a labelled row with nobody in it reads as a finding",
  );
  check(
    "the ordinal slice names who was buying",
    firstOrders?.roles.some((r) => r.id === "parent") === true &&
      firstOrders?.roles.some((r) => r.id === "grandparent") === true,
  );
  check(
    "the ordinal slice names what the books were about",
    firstOrders?.subjects[0]?.id === "birthday",
  );
  check(
    "a purchase with no subject doesn't pad the subject list",
    // A Spark top-up has no theme; bucketing it as "unknown" would bury the real
    // answers under the biggest row in the table.
    buildSurveyReport(s, [row({ uid: "x", answers: pick("a"), context: facets() })]).ordinals[0].subjects
      .length === 0,
  );

  const stay = report.transitions.find((t) => t.from === "grandparent" && t.to === "grandparent");
  const move = report.transitions.find((t) => t.from === "parent" && t.to === "unknown");
  check("a move between consecutive answers is counted", move?.moves === 1);
  check(
    "staying put is counted too",
    stay?.moves === 1,
    "hiding the diagonal would make every visible move look more common than it is",
  );
  check(
    "an account with one answer contributes no moves",
    buildSurveyReport(s, [row({ uid: "solo", answers: pick("a") })]).transitions.length === 0,
  );
  check(
    "three answers from one account are two moves",
    buildSurveyReport(s, [
      row({ uid: "u1", answeredAt: 1, answers: pick("a") }),
      row({ uid: "u1", answeredAt: 2, answers: pick("b") }),
      row({ uid: "u1", answeredAt: 3, answers: pick("c") }),
    ]).transitions.reduce((sum, t) => sum + t.moves, 0) === 2,
  );
  check(
    "transition shares are of all moves",
    Math.abs(report.transitions.reduce((sum, t) => sum + t.share, 0) - 1) < 1e-9,
  );
  check(
    "transitions are ordered by answer date, not by the order rows arrived",
    // Rows come back from Firestore in whatever order the index gives; a move read
    // backwards would invert the single finding this view exists to produce.
    buildSurveyReport(s, [
      row({ uid: "u1", answeredAt: 2000, answers: pick("c") }),
      row({ uid: "u1", answeredAt: 1000, answers: pick("a") }),
    ]).transitions[0]?.from === "parent",
  );
}

// ---- Prose + small helpers -------------------------------------------------

{
  check(
    "the audience description is a sentence",
    /^After .*\.$/.test(describeSurveyAudience(survey())),
    describeSurveyAudience(survey()),
  );
  check(
    "an item-type filter is described",
    describeSurveyAudience(survey({ appliesTo: ["print"] })).includes("printed book"),
  );
  check(
    "a sample is described",
    describeSurveyAudience(survey({ sampleRate: 0.25 })).includes("25%"),
  );
  check(
    "a full sample isn't mentioned",
    !describeSurveyAudience(survey()).includes("100%"),
  );
  check(
    "how often it repeats is described",
    describeSurveyAudience(survey({ maxAsks: 3 })).includes("3 times"),
    "the ask cap is the setting most likely to be set once and forgotten",
  );
  check(
    "a one-off says so rather than staying silent",
    describeSurveyAudience(survey()).includes("once ever"),
  );

  check(
    "the ask policy reads as a sentence",
    /^[A-Z].*\.$/.test(describeAskPolicy(createAskPolicy())),
    describeAskPolicy(createAskPolicy()),
  );
  check(
    "a daily cooldown is described in days, not hours",
    describeAskPolicy({ cooldownHours: 24, stopAfterDismissals: 2 }).includes("a day"),
  );
  check(
    "a long cooldown is described in days",
    describeAskPolicy({ cooldownHours: 72, stopAfterDismissals: 2 }).includes("3 days"),
  );
  check(
    "a short cooldown is described in hours",
    describeAskPolicy({ cooldownHours: 6, stopAfterDismissals: 2 }).includes("6 hours"),
  );
  check(
    "switching off the dismissal stop is stated plainly",
    describeAskPolicy({ cooldownHours: 24, stopAfterDismissals: 0 }).includes("never stopping"),
    "an admin who zeroes this has removed the only automatic protection, and should read that back",
  );

  check(
    "buyer-role coverage is described",
    describeBuyerRoleCoverage(survey()).includes("identify a buyer"),
  );
  check(
    "no tags at all is called out",
    describeBuyerRoleCoverage(
      survey({ questions: [choice({ options: [createOption("A", "a"), createOption("B", "b")] })] }),
    ).includes("couldn't tell"),
    "a survey with no role tags produces charts with one column, and it should be obvious why",
  );
  check(
    "a survey with nothing to tag says so rather than reporting 0 of 0",
    describeBuyerRoleCoverage(
      survey({ questions: [{ ...createQuestion("text", "t"), prompt: "Why?" }] }),
    ).includes("No options"),
  );

  check(
    "a profile with no answers says so",
    describeBuyerProfile(emptyBuyerProfile()).includes("Hasn't answered"),
  );
  check(
    "a profile description is a sentence",
    (() => {
      const p = foldAnswers(emptyBuyerProfile(), survey(), [answer({ questionId: "q_choice", optionIds: ["a"] })], 1);
      return /^[A-Z].*\.$/.test(describeBuyerProfile(p));
    })(),
  );
  check(
    "a profile names the durable fact as well as the newest one",
    (() => {
      const s = survey();
      let p = foldAnswers(emptyBuyerProfile(), s, [answer({ questionId: "q_choice", optionIds: ["a"] })], 1);
      p = foldAnswers(p, s, [answer({ questionId: "q_choice", optionIds: ["b"] })], 2);
      const text = describeBuyerProfile(p).toLowerCase();
      return text.includes("grandparent") && text.includes("children of their own");
    })(),
    "the sentence the whole feature was built for is two facts, not one",
  );
  check(
    "a profile doesn't repeat a fact the newest answer already implies",
    (() => {
      const p = foldAnswers(emptyBuyerProfile(), survey(), [answer({ questionId: "q_choice", optionIds: ["a"] })], 1);
      return !describeBuyerProfile(p).includes("children of their own");
    })(),
  );
  check(
    "answers that identify nobody are described honestly",
    (() => {
      const p = foldAnswers(emptyBuyerProfile(), survey(), [answer({ questionId: "q_choice", optionIds: ["c"] })], 1);
      return describeBuyerProfile(p).includes("none of which identify");
    })(),
  );

  check(
    "adding a question adds time",
    estimateSeconds(survey({ questions: [choice(), choice({ id: "q2" })] })) >
      estimateSeconds(survey()),
  );
  check(
    "free text is estimated as the slowest kind",
    estimateSeconds(survey({ questions: [{ ...createQuestion("text", "t"), prompt: "?" }] })) >
      estimateSeconds(survey({ questions: [{ ...createQuestion("scale", "s"), prompt: "?" }] })),
  );
  check(
    "a later ask is estimated as shorter once the ask-once questions have gone",
    estimateSeconds(
      prepareSurvey(survey({ questions: [choice(), choice({ id: "q2", askOnce: true })] }), 2, ["q2"]),
    ) < estimateSeconds(survey({ questions: [choice(), choice({ id: "q2", askOnce: true })] })),
  );

  check(
    "every purchase kind the confirmation screen shows maps to a target",
    ["order", "ebook", "sparks", "gift", "subscription"].every(
      (kind) => itemTypeForPurchaseKind(kind) !== undefined,
    ),
    "an unmapped kind silently excludes that purchase from every targeted survey",
  );
  check(
    "an unknown purchase kind maps to nothing rather than guessing",
    itemTypeForPurchaseKind("mystery") === undefined,
  );

  check(
    "only choice questions are treated as countable",
    QUESTION_KINDS.filter(isChoiceQuestion).join(",") === "single,multi",
  );

  check(
    "a new choice question starts answerable",
    createQuestion("single").options.length >= 2,
    "one option is a question with no choice in it",
  );
  check(
    "a new question repeats by default",
    createQuestion("single").askOnce === false,
    "a question worth adding is usually about the order in front of the customer",
  );
  check(
    "a new option identifies nobody until somebody says it does",
    createOption().buyerRole === null,
  );
  check("a new rating question is labelled at both ends", (() => {
    const q = createQuestion("scale");
    return q.scaleLowLabel.length > 0 && q.scaleHighLabel.length > 0;
  })());
  check(
    "a new survey starts switched off",
    createSurvey().enabled === false,
    "a half-written survey must not be live the moment it's added",
  );
  check(
    "a new survey is asked once until somebody decides otherwise",
    createSurvey().maxAsks === 1,
  );
  check(
    "generated ids are unique",
    new Set([...Array(200)].map(() => createSurvey().id)).size > 190,
  );
}

// ---- Report -----------------------------------------------------------------

console.log(`${checks.length} invariant(s) held.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} invariant(s) FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log("All survey invariants hold.");
}
