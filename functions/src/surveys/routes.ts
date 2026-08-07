/**
 * The customer-facing survey surface: four small routes, all of them deliberately
 * unable to fail loudly.
 *
 *   - `GET  /account/survey`         "is there anything to ask this person?"
 *   - `POST /account/survey`         answers
 *   - `POST /account/survey/dismiss` "no thanks", recorded and respected
 *   - `POST /account/survey/opt-out` "don't ask again", honoured everywhere
 *
 * The server picks the survey, not the client. Targeting, sampling, the ask
 * cooldown and "have we already asked about this purchase" all resolve here, and
 * the response carries only the one question set the account should see. A client
 * that received the whole config and chose for itself could be talked into
 * answering a survey aimed at someone else, and every response would be suspect.
 *
 * Two properties this file exists to hold:
 *
 *   - **One row per purchase, and asking twice about the same purchase is
 *     impossible.** The row's id is derived from the payment, so a reloaded
 *     confirmation page finds the ask that's already there and re-renders it
 *     rather than counting a second one. Without that, a customer who refreshes
 *     would deflate the response rate and burn one of their three asks.
 *   - **What was asked is a stored fact.** The question set depends on what they've
 *     answered before, which can change between the ask and the submit. So the ask
 *     records the question ids, and the submit validates against exactly those.
 *
 * Nothing here is allowed to break the screen it renders on. The GET soft-fails to
 * "nothing to ask" and the POSTs to a quiet success, because this all hangs off a
 * purchase confirmation: a customer who just paid must never see an error from the
 * optional questionnaire underneath their download button.
 *
 * Mounted under `/account`, which `app.ts` guards with `requireVerified`.
 */
import express, { type Express, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth";
import {
  pickSurvey,
  prepareSurvey,
  validateAnswers,
  type Survey,
  type SurveyItemType,
} from "../../../books-frontend/src/core/config/surveys";
import { getSurveysConfig } from "../appConfig";
import { userFacts } from "../campaigns/facts";
import { onCampaignEvent } from "../campaigns/events";
import { purchaseFacetsFor, type ContextHint } from "./context";
import {
  readSurveyOptOut,
  recordAnswersOnProfile,
  setSurveyOptOut,
} from "./profile";
import {
  keyForAsk,
  listResponsesForUser,
  markAsked,
  markDismissed,
  markOptedOut,
  purchaseKey,
  saveAnswers,
  summarizeHistory,
  type ResponseDoc,
} from "./store";

const ITEM_TYPES = ["print", "ebook", "pack", "plan"] as const;

const contextSchema = z.object({
  itemType: z.enum(ITEM_TYPES).optional(),
  productId: z.string().max(120).optional(),
  projectId: z.string().max(120).optional(),
  paymentId: z.string().max(200).optional(),
});

const answerSchema = z.object({
  questionId: z.string().min(1).max(64),
  optionIds: z.array(z.string().max(64)).max(40).default([]),
  text: z.string().max(2000).default(""),
  value: z.number().min(0).max(100).default(0),
});

const submitSchema = contextSchema.extend({
  surveyId: z.string().min(1).max(64),
  answers: z.array(answerSchema).max(20),
});

const dismissSchema = z.object({
  surveyId: z.string().min(1).max(64),
  paymentId: z.string().max(200).optional(),
});

const optOutSchema = z.object({
  optOut: z.boolean().default(true),
  surveyId: z.string().max(64).optional(),
  paymentId: z.string().max(200).optional(),
});

export function registerSurveyRoutes(app: Express): void {
  const json = express.json({ limit: "16kb" });

  /**
   * What to ask, if anything.
   *
   * Recording the ask is a side effect of asking, on purpose: it's what makes the
   * response rate a real denominator and what stops the same card reappearing.
   * A GET with a side effect is a little impure, but the alternative — a separate
   * "I showed it" call the client might not make — produces a response rate that
   * quietly flatters itself.
   */
  app.get("/account/survey", async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const hint = contextFrom(req.query);
      const config = await getSurveysConfig();
      if (!config.enabled) {
        res.json({ survey: null });
        return;
      }

      const [facts, rows, optedOut] = await Promise.all([
        userFacts(uid),
        listResponsesForUser(uid),
        readSurveyOptOut(uid),
      ]);

      const now = Date.now();
      const key = purchaseKey(hint.paymentId ?? null, now);
      const forThisPurchase = rows.filter((row) => row.key === key);

      // Already dealt with this purchase. Re-asking about the same order after a
      // dismissal is the one thing guaranteed to annoy somebody.
      if (forThisPurchase.some((row) => row.status !== "asked")) {
        res.json({ survey: null });
        return;
      }

      // Asked, not yet resolved: a reload, or a second tab. Re-render exactly what
      // was asked instead of picking again — picking again would hit the cooldown
      // and make the card vanish underneath someone mid-answer.
      const pending = forThisPurchase.find((row) => row.status === "asked");
      if (pending) {
        const survey = resumeSurvey(config.surveys, pending);
        res.json({ survey, askNumber: pending.askNumber });
        return;
      }

      const history = summarizeHistory(rows);
      const prompt = pickSurvey(config, {
        uid,
        itemType: hint.itemType,
        purchaseCount: facts.purchaseCount,
        history: history.entries,
        lastAskedAt: history.lastAskedAt,
        consecutiveDismissals: history.consecutiveDismissals,
        optedOut,
        now,
      });
      if (!prompt) {
        res.json({ survey: null });
        return;
      }

      await markAsked({
        uid,
        surveyId: prompt.survey.id,
        key,
        askNumber: prompt.askNumber,
        askedQuestionIds: prompt.survey.questions.map((q) => q.id),
        context: await purchaseFacetsFor(uid, hint),
        facets: {
          country: facts.country,
          isSubscriber: facts.isSubscriber,
          purchaseCount: facts.purchaseCount,
        },
      });

      res.json({ survey: prompt.survey, askNumber: prompt.askNumber });
    } catch (err) {
      console.warn("[surveys] pick failed", err);
      res.json({ survey: null });
    }
  });

  /**
   * Answers.
   *
   * Validated against the questions this customer was actually shown — read from
   * the ask record rather than recomputed — then persisted, then folded into the
   * account's buyer profile, then announced to the campaign engine as a
   * `survey_completed` event. That last step is how "answer three questions, get 20
   * Sparks" works without this module knowing anything about rewards.
   *
   * The campaign event is fired only for a first submission. `saveAnswers`
   * returning false means the answers were already in, and paying twice for one
   * set of answers is exactly the kind of double-spend the event bus's
   * idempotency exists to prevent — but it's cheaper to not ask it to.
   */
  app.post(
    "/account/survey",
    json,
    async (req: AuthedRequest, res: Response) => {
      const parsed = submitSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: { message: "We couldn't read those answers." } });
        return;
      }
      try {
        const uid = req.uid!;
        const config = await getSurveysConfig();
        const configured = config.surveys.find(
          (s) => s.id === parsed.data.surveyId,
        );
        if (!configured) {
          // The survey was deleted between the ask and the answer. Nothing to store
          // them against, and nothing useful to say to the customer about it.
          res.json({ ok: true, thanks: "Thank you." });
          return;
        }

        const hint = contextFrom(parsed.data);
        const rows = await listResponsesForUser(uid);
        const key = keyForAsk(rows, configured.id, hint.paymentId ?? null);
        const asked = rows.find(
          (row) => row.surveyId === configured.id && row.key === key,
        );
        // Validated against what was on the card. Falling back to the whole survey
        // covers the case where the ask record never landed — better to accept a
        // slightly wider answer set than to throw away real answers.
        const survey = asked
          ? restrictTo(configured, asked.askedQuestionIds)
          : configured;

        // The validator both CLEANS and complains: unknown option ids are dropped,
        // ratings out of range are discarded, text is truncated. So by the time
        // `answers` comes back it is already safe to store, and the complaints are
        // about presentation ("pick up to 2", "this one's needed") rather than about
        // the data.
        //
        // Which is why a complaint doesn't reject the submission when something
        // valid came with it. The client ran this same validator before enabling its
        // button, so a complaint here means the survey changed underneath the
        // customer — an admin adding a required question while somebody was typing.
        // Throwing away three good answers over a question that didn't exist when
        // they were asked is the worse of the two failures, and it's unrecoverable:
        // the card is gone and they won't be asked again about this purchase.
        const validation = validateAnswers(survey, parsed.data.answers);
        if (validation.answers.length === 0) {
          res.status(400).json({
            error: { message: "Some answers need a look." },
            errors: validation.errors,
          });
          return;
        }

        const [facts, context] = await Promise.all([
          userFacts(uid),
          purchaseFacetsFor(uid, hint),
        ]);
        const fresh = await saveAnswers({
          uid,
          surveyId: survey.id,
          key,
          answers: validation.answers,
          context,
          facets: {
            country: facts.country,
            isSubscriber: facts.isSubscriber,
            purchaseCount: facts.purchaseCount,
          },
        });

        if (fresh) {
          // The profile is what campaigns and the admin read, so it's updated on the
          // way through rather than derived on demand. `survey` here is the restricted
          // set, which is fine: role tags live on the options they answered.
          await recordAnswersOnProfile(uid, survey, validation.answers);
          // Best-effort and awaited: a reward promised for answering should be in the
          // balance by the time the "thank you" renders, and the bus already swallows
          // its own failures.
          await onCampaignEvent(uid, "survey_completed", {
            surveyId: survey.id,
          });
        }

        res.json({ ok: true, thanks: survey.thanks || "Thank you." });
      } catch (err) {
        console.warn("[surveys] submit failed", err);
        // A customer who answered honestly and lost the answers to a Firestore blip
        // gets thanked anyway. They can't fix it, and telling them makes it worse.
        res.json({ ok: true, thanks: "Thank you." });
      }
    },
  );

  /** "No thanks" — recorded, and a run of them stops the asking. */
  app.post(
    "/account/survey/dismiss",
    json,
    async (req: AuthedRequest, res: Response) => {
      const parsed = dismissSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Which survey?" } });
        return;
      }
      const uid = req.uid!;
      await markDismissed(
        uid,
        parsed.data.surveyId,
        await resolveKey(uid, parsed.data.surveyId, parsed.data.paymentId),
      );
      res.json({ ok: true });
    },
  );

  /**
   * "Don't ask again", and its undo.
   *
   * One route for both directions so there is exactly one writer of the preference
   * — the card's own link and the toggle in account settings both land here. It
   * also stamps the card it was pressed from, which is what turns opt-outs into a
   * rate the admin can watch rather than an invisible slow leak.
   */
  app.post(
    "/account/survey/opt-out",
    json,
    async (req: AuthedRequest, res: Response) => {
      const parsed = optOutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Couldn't read that." } });
        return;
      }
      try {
        const uid = req.uid!;
        await setSurveyOptOut(uid, parsed.data.optOut);
        if (parsed.data.optOut && parsed.data.surveyId) {
          await markOptedOut(
            uid,
            parsed.data.surveyId,
            await resolveKey(uid, parsed.data.surveyId, parsed.data.paymentId),
          );
        }
        res.json({ ok: true, optOut: parsed.data.optOut });
      } catch (err) {
        console.warn("[surveys] opt-out failed", err);
        // Reported as a failure, unlike everything else here: this is the one action
        // where silently doing nothing would be a betrayal rather than a shrug.
        res.status(500).json({ error: { message: "Couldn't save that." } });
      }
    },
  );
}

/**
 * Which row a "no thanks" or a "don't ask again" belongs to.
 *
 * With a payment id it's free. Without one it costs a read, which is worth paying
 * on an action taken once: writing the dismissal to a row the ask isn't on would
 * leave the ask open and count the pair as two.
 */
async function resolveKey(
  uid: string,
  surveyId: string,
  paymentId: string | undefined,
): Promise<string> {
  if (paymentId && paymentId.trim()) return purchaseKey(paymentId);
  try {
    return keyForAsk(await listResponsesForUser(uid), surveyId, null);
  } catch {
    return purchaseKey(null);
  }
}

/** Re-render an ask that's already recorded, exactly as it was recorded. */
function resumeSurvey(surveys: Survey[], row: ResponseDoc): Survey | null {
  const configured = surveys.find((s) => s.id === row.surveyId);
  if (!configured) return null;
  const survey = restrictTo(configured, row.askedQuestionIds);
  if (survey.questions.length === 0) return null;
  return prepareSurvey(survey, row.askNumber);
}

/**
 * Narrow a survey to the questions on one card.
 *
 * An empty list means the ask predates question-level filtering, so the whole
 * survey stands — the alternative would be a card with nothing on it.
 */
function restrictTo(survey: Survey, questionIds: string[]): Survey {
  if (questionIds.length === 0) return survey;
  const wanted = new Set(questionIds);
  return {
    ...survey,
    questions: survey.questions.filter((q) => wanted.has(q.id)),
  };
}

function parseItemType(value: unknown): SurveyItemType | undefined {
  return typeof value === "string" &&
    (ITEM_TYPES as readonly string[]).includes(value)
    ? (value as SurveyItemType)
    : undefined;
}

function contextFrom(raw: Record<string, unknown>): ContextHint {
  return {
    itemType: parseItemType(raw.itemType),
    productId: str(raw.productId),
    projectId: str(raw.projectId),
    paymentId: str(raw.paymentId),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 200)
    : null;
}
