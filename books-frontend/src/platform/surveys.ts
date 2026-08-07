/**
 * Client access to profiling surveys.
 *
 * The server decides what to ask; this asks it. Targeting, sampling and "has this
 * person already been asked" all live server-side, so there's no local state to
 * get out of sync and no way for a browser to talk itself into a question set
 * aimed at someone else.
 *
 * Every call soft-fails. The survey card hangs off a purchase confirmation, and
 * the confirmation is the screen where a customer finds out their money did
 * something — an optional questionnaire must never be able to put an error on it.
 */
import { backendFetch } from "./backend";
import type {
  Survey,
  SurveyAnswer,
  SurveyItemType,
} from "../core/config/surveys";

export type {
  Survey,
  SurveyAnswer,
  SurveyItemType,
} from "../core/config/surveys";

/** What was just bought, so the server can target on it. */
export interface SurveyContext {
  itemType?: SurveyItemType;
  productId?: string;
  projectId?: string;
  paymentId?: string;
}

/** A survey to show, with which time round this is for the customer. */
export interface SurveyAsk {
  survey: Survey;
  /** 1 the first time this account has seen this survey. */
  askNumber: number;
}

/**
 * The one survey to show, or null.
 *
 * Asking records the ask, which is what makes the response rate a real number and
 * what stops the card coming back. So only call this when it's actually about to
 * be rendered — a speculative fetch would count as having asked.
 *
 * Safe to call again for the same purchase: the server resolves a repeat call to
 * the ask it already recorded, so a reloaded confirmation page re-renders the same
 * card instead of burning another of the customer's few asks.
 */
export async function fetchSurvey(
  context: SurveyContext,
): Promise<SurveyAsk | null> {
  try {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(context)) {
      if (value) qs.set(key, String(value));
    }
    const res = await backendFetch(`/account/survey${qs.size ? `?${qs}` : ""}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      survey?: Survey | null;
      askNumber?: number;
    };
    if (!json.survey) return null;
    return { survey: json.survey, askNumber: json.askNumber ?? 1 };
  } catch {
    return null;
  }
}

/**
 * Submit answers. Resolves to the thank-you line to show in place of the questions.
 *
 * Resolves rather than rejects even on failure: the customer has already spent
 * their goodwill answering, they can't retry usefully, and telling them their
 * answers were lost is worse than thanking them.
 */
export async function submitSurvey(args: {
  surveyId: string;
  answers: SurveyAnswer[];
  context: SurveyContext;
}): Promise<string> {
  try {
    const res = await backendFetch("/account/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        surveyId: args.surveyId,
        answers: args.answers,
        ...args.context,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { thanks?: string };
    return json.thanks || "Thank you.";
  } catch {
    return "Thank you.";
  }
}

/**
 * "Not now" — recorded against this purchase, so the card never comes back for
 * this order and a run of dismissals stops the asking altogether. Fire and forget.
 */
export function dismissSurvey(surveyId: string, paymentId?: string | null): void {
  void backendFetch("/account/survey/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ surveyId, paymentId: paymentId ?? undefined }),
  }).catch(() => {});
}

/**
 * "Don't ask again", and its undo from account settings.
 *
 * Awaited rather than fired and forgotten, and it reports failure — unlike
 * everything else in this module. A lost answer costs a data point; a lost opt-out
 * means carrying on asking somebody who asked us to stop, which is the one failure
 * here that a customer would rightly be annoyed by.
 */
export async function setSurveyOptOut(args: {
  optOut: boolean;
  surveyId?: string;
  paymentId?: string | null;
}): Promise<boolean> {
  try {
    const res = await backendFetch("/account/survey/opt-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        optOut: args.optOut,
        surveyId: args.surveyId,
        paymentId: args.paymentId ?? undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
