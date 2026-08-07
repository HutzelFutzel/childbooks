/**
 * The derived buyer profile: what the answers add up to, kept on the user document
 * so the rest of the product can target on it.
 *
 * The response rows are the record; this is the conclusion. Keeping it separately
 * earns its keep three times over: a campaign can gate on "grandparents" without
 * scanning anybody's answers, the admin's user drawer can say who somebody is in
 * one read, and the sticky facts survive rows being deleted.
 *
 * Two kinds of field, and the distinction is the whole reason this exists rather
 * than just reading the newest answer. Sticky facts (`hasOwnChildren`,
 * `isGrandparent`) only ever turn on: someone who bought for their own child still
 * has a child on their fourth order, when the book is for a friend. `latestRole` is
 * the newest identifiable relationship. Together they express the sentence the
 * whole per-order design was built for — *a parent, buying for a friend's child* —
 * which neither field says alone.
 *
 * Client writes to `surveyProfile` are refused by `firestore.rules`. Campaign
 * conditions read it, so a forgeable profile would be a self-service discount.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import {
  foldAnswers,
  normalizeBuyerProfile,
  type BuyerProfile,
  type Survey,
  type SurveyAnswer,
} from "../../../books-frontend/src/core/config/surveys";

function db() {
  ensureAdmin();
  return getFirestore();
}

/**
 * Fold one set of answers into the account's profile.
 *
 * Transactional because a customer can conceivably submit two confirmation cards
 * at once (two tabs, two orders), and the sticky flags are an accumulation — a
 * lost-update would drop the more informative of the two answers.
 *
 * Best-effort: a failure here costs targeting precision, and it must never cost
 * the customer their thank-you. The rows remain the record, so the profile can
 * always be rebuilt from them.
 */
export async function recordAnswersOnProfile(
  uid: string,
  survey: Survey,
  answers: SurveyAnswer[],
  at = Date.now(),
): Promise<BuyerProfile | null> {
  try {
    const ref = db().doc(`users/${uid}`);
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = normalizeBuyerProfile(snap.get("surveyProfile"));
      const next = foldAnswers(prev, survey, answers, at);
      tx.set(ref, { surveyProfile: next }, { merge: true });
      return next;
    });
  } catch (err) {
    console.warn("[surveys] profile update failed", err);
    return null;
  }
}

/**
 * Whether this account has asked not to be asked again.
 *
 * Read from the profile preference rather than inferred from a run of dismissals.
 * The two are different statements and only one of them is the customer's own: a
 * dismissal is "not now", an opt-out is "not ever".
 */
export async function readSurveyOptOut(uid: string): Promise<boolean> {
  try {
    const snap = await db().doc(`users/${uid}`).get();
    const prefs = (snap.get("preferences") ?? {}) as Record<string, unknown>;
    return prefs.surveyOptOut === true;
  } catch {
    // Failing open would ask somebody who has explicitly told us to stop. Failing
    // closed costs one unanswered survey.
    return true;
  }
}

/**
 * Set (or clear) the opt-out.
 *
 * Written here rather than by the client so there's exactly one writer: the card's
 * "don't ask again" and the toggle in account settings both come through this,
 * which is what keeps the two from disagreeing about a field that silences a
 * whole feature.
 */
export async function setSurveyOptOut(
  uid: string,
  optOut: boolean,
): Promise<void> {
  await db()
    .doc(`users/${uid}`)
    .set(
      { preferences: { surveyOptOut: optOut }, updatedAt: Date.now() },
      { merge: true },
    );
}
