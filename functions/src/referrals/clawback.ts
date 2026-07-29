/**
 * Reversing referral rewards when the purchase behind them goes away — a refund,
 * a chargeback, or an order we couldn't fulfill.
 *
 * Without this, "reward on first purchase" reads as "buy, get paid, refund" to
 * anyone who looks for it. With it, the exploit costs a chargeback fee and a
 * closed account.
 *
 * What can actually be reversed differs by reward:
 *   - **Sparks** are debited back, but never below zero — Sparks already spent on
 *     generation are gone (the provider was paid), and dragging a balance
 *     negative would punish a legitimate refund.
 *   - **Discounts** are revoked if unredeemed. If already redeemed, the discount
 *     was on a real purchase and stands.
 *   - **Free months** can't be un-given once invoiced, so the coupon is deleted
 *     to stop further months and ops gets told.
 */
import { FieldValue } from "firebase-admin/firestore";
import { notifySlack } from "../notify";
import { reverseGrantedSparks } from "../sparks";
import { bumpStat } from "./stats";
import { deleteCoupon } from "./stripeRewards";
import { REWARDS, db, listRewardsForQualifyingRef, type RewardDoc } from "./store";

/**
 * Reverse every reward a payment or invoice paid for. Safe to call more than
 * once: an already-reversed reward is skipped.
 */
export async function clawbackForRef(ref: string, reason: string): Promise<number> {
  try {
    const rewards = await listRewardsForQualifyingRef(ref);
    let reversed = 0;
    for (const reward of rewards) {
      if (await reverseOne(reward, reason)) reversed += 1;
    }
    if (reversed > 0) {
      await notifySlack({
        channel: "ops",
        messageKey: "admin_alert",
        ref: `referral_clawback_${ref}`,
        text: `↩️ Referral clawback — ${reversed} reward(s) reversed after ${reason} (${ref}).`,
      });
    }
    return reversed;
  } catch (err) {
    console.error("[referrals] clawback failed", ref, err);
    return 0;
  }
}

async function reverseOne(reward: RewardDoc, reason: string): Promise<boolean> {
  if (reward.status === "clawed_back" || reward.status === "void") return false;
  const ref = db().doc(`${REWARDS}/${reward.id}`);

  // Not yet delivered: voiding is the whole job.
  if (reward.status === "pending" || reward.status === "review") {
    await ref.set({ status: "void", note: `Voided — ${reason}.` }, { merge: true });
    return true;
  }

  let note = `Reversed — ${reason}.`;
  if (reward.reward.kind === "sparks") {
    const debited = await reverseGrantedSparks({
      uid: reward.uid,
      amount: reward.reward.sparks,
      reason: `referral-clawback:${reward.ruleId}`,
      ref: `clawback_${reward.id}`,
    });
    note = `Reversed — ${reason}. Recovered ${debited} of ${reward.reward.sparks} Sparks (the rest were already spent).`;
  } else if (reward.reward.kind === "discount") {
    if (reward.redeemedAt > 0) {
      // The discount was used on a purchase that stands on its own; taking it
      // back after the fact would mean re-charging someone. Leave it.
      await ref.set({ note: `${reason} — discount had already been used; left in place.` }, { merge: true });
      return false;
    }
    note = `Reversed — ${reason}. Unredeemed discount revoked.`;
  } else {
    await deleteCoupon(reward.stripeCouponId ?? "");
    note = `Reversed — ${reason}. Coupon deleted; months already invoiced can't be recovered.`;
  }

  await ref.set({ status: "clawed_back", clawedBackAt: Date.now(), note }, { merge: true });
  await Promise.all([bumpStat("clawbacks"), bumpStat("rewardCost", -reward.cost)]);
  return true;
}

/**
 * Block an invitation and everything it hasn't paid yet. Used by the admin when
 * a pattern is obviously farmed, and reachable from the ops alert.
 */
export async function blockInvitation(invitationId: string, reason: string): Promise<void> {
  await db()
    .doc(`referralInvitations/${invitationId}`)
    .set({ status: "blocked", blockedAt: Date.now(), blockedReason: reason }, { merge: true });
  const snap = await db().collection(REWARDS).where("invitationId", "==", invitationId).limit(50).get();
  await Promise.all(
    snap.docs.map((doc) => {
      const reward = doc.data() as { status?: string };
      if (reward.status !== "pending" && reward.status !== "review") return Promise.resolve();
      return doc.ref.set({ status: "void", note: `Blocked — ${reason}.` }, { merge: true });
    }),
  );
  await db()
    .doc(`referralInvitations/${invitationId}`)
    .set({ voidedAt: FieldValue.serverTimestamp() }, { merge: true });
}
