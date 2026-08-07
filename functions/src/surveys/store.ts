/**
 * Firestore access for profiling surveys.
 *
 * One collection, backend-only (see `firestore.rules`):
 *
 *   `surveyResponses/{uid}__{surveyId}__{key}` — one document per ASK, covering
 *   its whole lifecycle: `asked` when the card is shown, then `answered` or
 *   `dismissed`.
 *
 * That the key is the PURCHASE (falling back to the calendar day when a purchase
 * has no payment record) is the central design decision. A row per account would
 * collapse a customer's series into whichever order happened to be asked, and
 * "their first book was for their own child, their third was a gift" is the most
 * valuable thing this feature can learn. Purchase-keyed rows also keep the whole
 * thing idempotent: a reloaded confirmation page resolves to the same document, so
 * it can't count a second ask or double-fire a reward.
 *
 * That the ask and the answer share a document is also deliberate. It makes the
 * response rate exact without a separate impression counter, and "have we asked
 * about this purchase?" a document read rather than a query.
 *
 * Answers are stored with the option ids the customer picked rather than the
 * labels they read. Labels get reworded; ids don't, so a report spanning a copy
 * edit still adds up.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import {
  emptyHistoryEntry,
  emptyPurchaseFacets,
  type PurchaseFacets,
  type SurveyAnswer,
  type SurveyHistoryEntry,
  type SurveyItemType,
  type SurveyResponseStatus,
} from "../../../books-frontend/src/core/config/surveys";

export const RESPONSES = "surveyResponses";

/** Cap on a report's scan. Well past any realistic response volume for one survey. */
export const MAX_REPORT_ROWS = 5000;

function db(): Firestore {
  ensureAdmin();
  return getFirestore();
}

function safeId(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

/**
 * The per-ask half of a document id.
 *
 * The payment is the natural key — it's what the row is *about*, and it's stable
 * across reloads and retries. Purchases with no payment record (a subscription
 * confirmation) fall back to the UTC day, which is stable for exactly as long as
 * it needs to be: the ask cooldown already forbids two asks inside a day, so a
 * day can never hold two legitimate rows.
 */
export function purchaseKey(paymentId: string | null, at = Date.now()): string {
  if (paymentId && paymentId.trim()) return safeId(paymentId.trim());
  return `d${new Date(at).toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export function responseId(
  uid: string,
  surveyId: string,
  key: string,
): string {
  return `${safeId(uid)}__${safeId(surveyId)}__${safeId(key)}`;
}

/** How long after an ask an answer can still be matched back to it. */
const RESUME_WINDOW_MS = 36 * 3_600_000;

/**
 * Which ask a submission or a dismissal belongs to.
 *
 * With a payment, the key is the payment and there's nothing to work out. Without
 * one, recomputing the day-based key would be wrong in a way nobody would ever
 * notice: somebody who opens the card at 23:58 and answers at 00:01 would have
 * their answers written to a *different* row from the ask, leaving the original
 * marked "asked" forever, deflating the response rate and burning one of their
 * asks. So the open ask wins over the calendar, within a window short enough that
 * this can only ever mean "the card they still have on screen".
 */
export function keyForAsk(
  rows: ResponseDoc[],
  surveyId: string,
  paymentId: string | null,
  now = Date.now(),
): string {
  if (paymentId && paymentId.trim()) return purchaseKey(paymentId, now);
  const open = rows
    .filter(
      (row) =>
        row.surveyId === surveyId &&
        row.status === "asked" &&
        now - row.askedAt < RESUME_WINDOW_MS,
    )
    .sort((a, b) => b.askedAt - a.askedAt)[0];
  return open ? open.key : purchaseKey(null, now);
}

export interface ResponseDoc {
  uid: string;
  surveyId: string;
  /**
   * The per-ask half of this row's id, stored so a row can say which ask it is.
   *
   * It's recoverable from the document id, but every read here goes through
   * `.data()` — and the paymentless fallback key can't be recomputed from the row's
   * contents once the day has turned over.
   */
  key: string;
  status: SurveyResponseStatus;
  askedAt: number;
  answeredAt: number;
  /** Which ask this was for the account, 1-based. */
  askNumber: number;
  /**
   * The questions actually put on the card.
   *
   * Stored rather than recomputed because the set depends on what the customer had
   * already answered, and that can change between the ask and the submit (a second
   * tab, an admin edit). The record of what was asked has to be a fact, not a
   * re-derivation — it's what the submit route validates against.
   */
  askedQuestionIds: string[];
  /** They pressed "don't ask again" from this card. */
  optedOut: boolean;
  answers: SurveyAnswer[];
  /** What was bought. Snapshotted, because projects get edited and deleted. */
  context: PurchaseFacets;
  /**
   * Denormalized facts about the account at the moment it answered.
   *
   * Kept because they're the answer to "who were these people when they told us
   * this?", and because a country that changes later shouldn't retroactively move
   * an answer into a different market's column. Lifetime revenue and the purchase
   * ordinal are deliberately NOT snapshotted: revenue keeps moving, and the
   * ordinal is a race against the webhook that increments it. Both are joined
   * live at report time.
   */
  facets: {
    country: string | null;
    isSubscriber: boolean;
    purchaseCount: number;
  };
}

/**
 * Everything the ask policy needs to know about one account.
 *
 * One query, aggregated in memory. A customer holds at most a handful of rows (a
 * few surveys times a few asks each), so this stays a single cheap read no matter
 * how the policy evolves.
 */
export interface AskHistory {
  entries: SurveyHistoryEntry[];
  /** Most recent ask across every survey — the cooldown's input. */
  lastAskedAt: number;
  /** Dismissals since the last answer, across every survey. */
  consecutiveDismissals: number;
}

/**
 * Fold rows into the policy's inputs. Pure, so the admin simulator can run it over
 * a hypothetical history and get the same answer as production.
 */
export function summarizeHistory(rows: ResponseDoc[]): AskHistory {
  const byId = new Map<string, SurveyHistoryEntry>();
  let lastAskedAt = 0;

  for (const row of rows) {
    if (!row.surveyId) continue;
    const entry = byId.get(row.surveyId) ?? emptyHistoryEntry(row.surveyId);
    entry.asks += 1;
    if (row.status === "answered") entry.answers += 1;
    if (row.status === "dismissed") entry.dismissals += 1;
    entry.lastAskedAt = Math.max(entry.lastAskedAt, row.askedAt);
    for (const answer of row.answers) {
      if (answer.questionId && !entry.answeredQuestionIds.includes(answer.questionId)) {
        entry.answeredQuestionIds.push(answer.questionId);
      }
    }
    byId.set(row.surveyId, entry);
    lastAskedAt = Math.max(lastAskedAt, row.askedAt);
  }

  // Newest first, then count dismissals until an answer stops the run. Unresolved
  // asks are stepped over rather than counted: ignoring a card is not the same
  // statement as closing it, and the per-survey ask cap already limits how often
  // an ignored card can come back.
  const resolved = rows
    .filter((r) => r.status === "answered" || r.status === "dismissed")
    .sort((a, b) => resolvedAt(b) - resolvedAt(a));
  let consecutiveDismissals = 0;
  for (const row of resolved) {
    if (row.status === "answered") break;
    consecutiveDismissals += 1;
  }

  return { entries: [...byId.values()], lastAskedAt, consecutiveDismissals };
}

function resolvedAt(row: ResponseDoc): number {
  return row.answeredAt || row.askedAt;
}

/**
 * Record that the card was shown.
 *
 * `create` rather than `set`, so a reload can't reset an `answered` document back
 * to `asked` and lose the answers. Losing the ask record is harmless by
 * comparison — the caller treats a failure here as "shown anyway".
 */
export async function markAsked(args: {
  uid: string;
  surveyId: string;
  key: string;
  askNumber: number;
  askedQuestionIds: string[];
  context: PurchaseFacets;
  facets: ResponseDoc["facets"];
}): Promise<void> {
  const doc: ResponseDoc = {
    uid: args.uid,
    surveyId: args.surveyId,
    key: args.key,
    status: "asked",
    askedAt: Date.now(),
    answeredAt: 0,
    askNumber: args.askNumber,
    askedQuestionIds: args.askedQuestionIds,
    optedOut: false,
    answers: [],
    context: args.context,
    facets: args.facets,
  };
  try {
    await db()
      .collection(RESPONSES)
      .doc(responseId(args.uid, args.surveyId, args.key))
      .create(doc);
  } catch {
    // Already asked about this purchase — the document we'd be writing is the one
    // that's there.
  }
}

/**
 * Persist answers.
 *
 * Merged onto whatever the ask wrote, and returns false when this purchase's row
 * had already been answered. That "already" case is a double submit, not an edit:
 * the first answer is the honest one, and a second pass would also fire a second
 * `survey_completed` campaign event and pay twice for one set of answers.
 */
export async function saveAnswers(args: {
  uid: string;
  surveyId: string;
  key: string;
  answers: SurveyAnswer[];
  context: PurchaseFacets;
  facets: ResponseDoc["facets"];
}): Promise<boolean> {
  const ref = db()
    .collection(RESPONSES)
    .doc(responseId(args.uid, args.surveyId, args.key));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Partial<ResponseDoc>) : null;
    if (existing?.status === "answered") return false;

    const now = Date.now();
    tx.set(
      ref,
      {
        uid: args.uid,
        surveyId: args.surveyId,
        key: args.key,
        status: "answered" satisfies SurveyResponseStatus,
        askedAt: existing?.askedAt || now,
        answeredAt: now,
        askNumber: existing?.askNumber || 1,
        askedQuestionIds: existing?.askedQuestionIds ?? [],
        optedOut: existing?.optedOut === true,
        answers: args.answers,
        context: args.context,
        facets: args.facets,
      } satisfies ResponseDoc,
      { merge: true },
    );
    return true;
  });
}

/**
 * Record a "no thanks".
 *
 * Worth storing for two reasons: it's what makes the response rate honest, and a
 * run of them stops the asking without the customer having to say so.
 */
export async function markDismissed(
  uid: string,
  surveyId: string,
  key: string,
): Promise<void> {
  const ref = db().collection(RESPONSES).doc(responseId(uid, surveyId, key));
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists
        ? (snap.data() as Partial<ResponseDoc>)
        : null;
      // Never overwrite real answers with a dismissal: the confirmation screen can
      // be closed straight after submitting, and that's a completed survey.
      if (existing?.status === "answered") return;
      tx.set(
        ref,
        {
          uid,
          surveyId,
          key,
          status: "dismissed" satisfies SurveyResponseStatus,
          askedAt: existing?.askedAt || Date.now(),
        },
        { merge: true },
      );
    });
  } catch {
    // Best-effort: a lost dismissal costs one repeat ask, not correctness.
  }
}

/**
 * Stamp "don't ask again" onto the card it was pressed from.
 *
 * The preference itself lives on the user's profile — that's what stops the
 * asking. This flag is for the report: opt-outs per ask is the one number that
 * shows the feature wearing out its welcome, and a response rate can look healthy
 * while it climbs.
 */
export async function markOptedOut(
  uid: string,
  surveyId: string,
  key: string,
): Promise<void> {
  const ref = db().collection(RESPONSES).doc(responseId(uid, surveyId, key));
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists
        ? (snap.data() as Partial<ResponseDoc>)
        : null;
      tx.set(
        ref,
        {
          uid,
          surveyId,
          key,
          // Opting out without answering is a dismissal, and a firmer one. If they
          // answered first and then opted out, the answers stand.
          status:
            existing?.status === "answered"
              ? ("answered" satisfies SurveyResponseStatus)
              : ("dismissed" satisfies SurveyResponseStatus),
          askedAt: existing?.askedAt || Date.now(),
          optedOut: true,
        },
        { merge: true },
      );
    });
  } catch {
    // Best-effort. The profile flag is what actually stops the asking; losing this
    // costs one row of reporting accuracy.
  }
}

/**
 * Every response for one survey, newest first, bounded.
 *
 * Ordered in memory rather than by Firestore so this needs no composite index —
 * the scan is capped well below any volume where that would matter, and the cap
 * is reported so the admin knows when a report became a sample.
 */
export async function listResponses(
  surveyId: string,
  limit = MAX_REPORT_ROWS,
): Promise<{ rows: ResponseDoc[]; truncated: boolean }> {
  const snap = await db()
    .collection(RESPONSES)
    .where("surveyId", "==", surveyId)
    .limit(limit + 1)
    .get();
  const rows = snap.docs
    .slice(0, limit)
    .map((doc) => normalizeResponse(doc.data()));
  rows.sort(
    (a, b) => (b.answeredAt || b.askedAt) - (a.answeredAt || a.askedAt),
  );
  return { rows, truncated: snap.size > limit };
}

/** Every response by one account — the GDPR export, and the support view. */
export async function listResponsesForUser(
  uid: string,
): Promise<ResponseDoc[]> {
  const snap = await db().collection(RESPONSES).where("uid", "==", uid).get();
  return snap.docs.map((doc) => normalizeResponse(doc.data()));
}

/**
 * Delete every response by one account (GDPR erasure).
 *
 * Deleted outright rather than anonymized. Anonymizing would keep the answers in
 * the aggregate, and an erasure request is not the moment to be clever about
 * retaining someone's survey answers — a handful of rows leaving a cross-tab is
 * not a business problem.
 */
export async function deleteResponsesForUser(uid: string): Promise<number> {
  const snap = await db().collection(RESPONSES).where("uid", "==", uid).get();
  if (snap.empty) return 0;
  const batch = db().batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

function normalizeStatus(value: unknown): SurveyResponseStatus {
  return value === "answered" || value === "dismissed" ? value : "asked";
}

function normalizeResponse(raw: unknown): ResponseDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const answers = Array.isArray(d.answers) ? d.answers : [];
  const context = (d.context ?? {}) as Record<string, unknown>;
  const facets = (d.facets ?? {}) as Record<string, unknown>;
  const askedAt = num(d.askedAt);
  const paymentId =
    typeof context.paymentId === "string" ? context.paymentId : null;
  return {
    uid: typeof d.uid === "string" ? d.uid : "",
    surveyId: typeof d.surveyId === "string" ? d.surveyId : "",
    // Rows written before the key was stored can rebuild it, since the day it falls
    // back to is the day the ask was recorded.
    key: typeof d.key === "string" && d.key ? d.key : purchaseKey(paymentId, askedAt),
    status: normalizeStatus(d.status),
    askedAt,
    answeredAt: num(d.answeredAt),
    // Rows written before asks could repeat are all first asks.
    askNumber: Math.max(1, num(d.askNumber) || 1),
    askedQuestionIds: Array.isArray(d.askedQuestionIds)
      ? d.askedQuestionIds.filter((x): x is string => typeof x === "string")
      : [],
    optedOut: d.optedOut === true,
    answers: answers.map((a) => {
      const answer = (a ?? {}) as Record<string, unknown>;
      return {
        questionId:
          typeof answer.questionId === "string" ? answer.questionId : "",
        optionIds: Array.isArray(answer.optionIds)
          ? answer.optionIds.filter((x): x is string => typeof x === "string")
          : [],
        text: typeof answer.text === "string" ? answer.text : "",
        value: num(answer.value),
      };
    }),
    context: {
      ...emptyPurchaseFacets(),
      itemType: (context.itemType as SurveyItemType | null) ?? null,
      productId:
        typeof context.productId === "string" ? context.productId : null,
      projectId:
        typeof context.projectId === "string" ? context.projectId : null,
      paymentId,
      copies: num(context.copies),
      themeId: typeof context.themeId === "string" ? context.themeId : null,
      settingId:
        typeof context.settingId === "string" ? context.settingId : null,
      ageRangeId:
        typeof context.ageRangeId === "string" ? context.ageRangeId : null,
      artStyleKey:
        typeof context.artStyleKey === "string" ? context.artStyleKey : null,
      projectSeq: num(context.projectSeq),
    },
    facets: {
      country: typeof facets.country === "string" ? facets.country : null,
      isSubscriber: facets.isSubscriber === true,
      purchaseCount: num(facets.purchaseCount),
    },
  };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
