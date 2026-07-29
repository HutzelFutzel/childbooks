/**
 * The referral event bus: one function the rest of the backend calls when
 * something happens to a user, which figures out whether that user was referred
 * and what (if anything) it pays.
 *
 * Call sites stay dumb on purpose — `onReferralEvent(uid, "first_purchase", …)`
 * from the Stripe webhook, `"email_verified"` from the verification route, and so
 * on. All the knowledge about who owes whom what lives here and in the frozen
 * terms, so adding a trigger never means touching payment code again.
 *
 * Everything is best-effort: a referral must never break the flow that fired it.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  rulesForTrigger,
  type InvitationProgress,
  type RewardRule,
  type RewardSide,
  type RewardTrigger,
} from "../../../books-frontend/src/core/config/referral";
import { applyReward } from "./rewards";
import { bumpStat, type StatField } from "./stats";
import { INVITATIONS, db, getInvitation, type InvitationDoc } from "./store";

export interface ReferralEventContext {
  /** Payment/invoice id, so a refund can find and reverse what it paid for. */
  ref?: string | null;
  /** Qualifying amount in the payment's currency, for `minPurchaseAmount`. */
  amount?: number;
  /** For `subscription_renewed`: which invoice this is (1 = the first one). */
  invoiceNumber?: number;
}

/** Which progress flag a trigger sets (if any) and which counter it bumps. */
const TRIGGER_EFFECTS: Partial<Record<RewardTrigger, { flag: keyof InvitationProgress; stat?: StatField }>> = {
  // No counter for `invite_accepted`: a link invitation is BORN with `signedUp`
  // set (it only exists because someone accepted), so the flag-flip below would
  // never fire for it and the funnel would count email acceptances only.
  // `acceptInvitation` counts both channels instead.
  invite_accepted: { flag: "signedUp" },
  email_verified: { flag: "verified", stat: "verified" },
  first_book_completed: { flag: "activated", stat: "activated" },
  first_purchase: { flag: "purchased", stat: "purchased" },
};

/**
 * A referred user reached a milestone: record it and pay out whatever the
 * invitation's frozen terms promise for it.
 *
 * The program's master switch is deliberately NOT consulted here. Turning the
 * program off stops new invitations; it does not renege on invitations already
 * accepted — those carry a promise, and honoring it is cheaper than the support
 * thread that follows breaking it.
 */
export async function onReferralEvent(
  uid: string,
  trigger: RewardTrigger,
  ctx: ReferralEventContext = {},
): Promise<void> {
  try {
    const invitation = await invitationForReferredUser(uid);
    if (!invitation) return;

    const effect = TRIGGER_EFFECTS[trigger];
    if (effect && !invitation.progress[effect.flag]) {
      await db()
        .doc(`${INVITATIONS}/${invitation.id}`)
        .set({ progress: { [effect.flag]: true } }, { merge: true });
      if (effect.stat) await bumpStat(effect.stat);
    }

    // Expiry is the liability tail's off-switch: an invitation that has run out
    // of time stops earning, even if it was accepted long ago.
    if (invitation.expiresAt > 0 && Date.now() > invitation.expiresAt) {
      if (invitation.status === "accepted") {
        await db().doc(`${INVITATIONS}/${invitation.id}`).set({ status: "expired" }, { merge: true });
      }
      return;
    }

    const rules = rulesForTrigger(invitation.terms, trigger);
    for (const rule of rules) {
      await payRule(invitation, rule, trigger, ctx);
    }
  } catch (err) {
    console.error("[referrals] event handling failed", trigger, err);
  }
}

/** The invitation a user was referred through, if they were referred at all. */
async function invitationForReferredUser(uid: string): Promise<InvitationDoc | null> {
  const snap = await db().doc(`users/${uid}`).get();
  if (!snap.exists) return null;
  const invitationId = snap.get("referralInvitationId") as string | undefined;
  if (!invitationId) return null;
  const invitation = await getInvitation(invitationId);
  if (!invitation || invitation.acceptedBy !== uid) return null;
  // Blocked/void invitations are the abuse verdict — they never pay.
  if (invitation.status !== "accepted") return null;
  return invitation;
}

async function payRule(
  invitation: InvitationDoc,
  rule: RewardRule,
  trigger: RewardTrigger,
  ctx: ReferralEventContext,
): Promise<void> {
  const referredUid = invitation.acceptedBy;
  if (!referredUid) return;

  if (rule.conditions.minPurchaseAmount > 0 && (ctx.amount ?? 0) < rule.conditions.minPurchaseAmount) return;
  if (trigger === "subscription_renewed" && (ctx.invoiceNumber ?? 0) < rule.conditions.nthInvoice) return;
  if (rule.conditions.referredMustBeVerified && !(await isVerified(referredUid))) return;

  const sides: { side: RewardSide; uid: string; counterpart: string }[] = [
    { side: "referrer", uid: invitation.inviterUid, counterpart: referredUid },
    { side: "referred", uid: referredUid, counterpart: invitation.inviterUid },
  ];

  for (const { side, uid, counterpart } of sides) {
    const reward = side === "referrer" ? rule.referrer : rule.referred;
    if (!reward) continue;
    // `referrerMustBeSubscriber` is checked INSIDE applyReward (see holdReason),
    // not here: skipping it here would mean no reward document ever exists, so
    // it never shows up anywhere for the inviter to see or an admin to release
    // once they do subscribe. Held, not silently dropped.
    await applyReward({
      invitation,
      rule,
      side,
      reward,
      trigger,
      uid,
      counterpartUid: counterpart,
      qualifyingRef: ctx.ref ?? null,
    });
  }
}

async function isVerified(uid: string): Promise<boolean> {
  try {
    const user = await getAuth().getUser(uid);
    return user.emailVerified === true;
  } catch {
    return false;
  }
}

/**
 * Mark a referred user's account as having finished a book. Separate from the
 * event itself so the (hot) studio path can call it without loading the whole
 * referral module: the flag is what makes the `first_book_completed` trigger
 * fire exactly once per user, no matter how many books they finish.
 */
export async function markFirstBookCompleted(uid: string): Promise<void> {
  try {
    const ref = db().doc(`users/${uid}`);
    const first = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("firstBookCompletedAt")) return false;
      tx.set(ref, { firstBookCompletedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (first) await onReferralEvent(uid, "first_book_completed");
  } catch (err) {
    console.warn("[referrals] first-book milestone failed", err);
  }
}
