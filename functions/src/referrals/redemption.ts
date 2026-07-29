/**
 * Redeeming an earned **discount** reward against something we price ourselves
 * (print books, the digital edition, Spark packs).
 *
 * The discount is applied by lowering our own line item rather than by attaching
 * a Stripe coupon, for three reasons: shipping stays undiscounted (it's a
 * separate line item, and a session coupon would cut it too), the reduced price
 * flows through the same margin math as every other price, and single use is
 * enforced by our own reward document instead of Stripe's redemption counter.
 *
 * Single use across an abandoned checkout is handled with a short RESERVATION
 * rather than a distributed transaction: creating a session reserves the reward
 * for {@link RESERVATION_TTL_MS}, a completed payment converts the reservation
 * into a permanent redemption, and an abandoned checkout simply lets the
 * reservation lapse. Nothing to clean up, and the worst case is a user waiting a
 * few minutes to retry with the same reward.
 */
import type { DiscountItemType } from "../../../books-frontend/src/core/config/discountImpact";
import type { PricingSettings } from "../../../books-frontend/src/core/config/products";
import { recordDiscountCost } from "./rewards";
import { REWARDS, db, listRewardsFor, normalizeReward, type RewardDoc } from "./store";

/** How long a checkout session holds an earned discount. */
export const RESERVATION_TTL_MS = 30 * 60_000;

export interface RedeemableDiscount {
  rewardId: string;
  percentOff: number;
  /** Frozen description, for the checkout line the buyer sees. */
  summary: string;
  expiresAt: number;
}

/** Whether a reward is a live, unreserved, unredeemed discount valid for `itemType`. */
export function isRedeemable(reward: RewardDoc, itemType: DiscountItemType): boolean {
  if (reward.status !== "granted") return false;
  if (reward.reward.kind !== "discount") return false;
  if (reward.redeemedAt > 0) return false;
  if (reward.discountExpiresAt > 0 && Date.now() > reward.discountExpiresAt) return false;
  // A live reservation means another checkout is mid-flight with it.
  if (reward.reservedAt > 0 && Date.now() - reward.reservedAt < RESERVATION_TTL_MS) return false;
  const scope = reward.reward.appliesTo;
  return scope.length === 0 || scope.includes(itemType);
}

/**
 * The discount the user should get on this purchase: the one expiring soonest,
 * so nothing is wasted. Returns null when they have none — the overwhelmingly
 * common case, and one indexed query answers it.
 */
export async function findRedeemableDiscount(
  uid: string,
  itemType: DiscountItemType,
): Promise<RedeemableDiscount | null> {
  try {
    const candidates = (await listRewardsFor(uid))
      .filter((reward) => isRedeemable(reward, itemType))
      .map((reward) => ({
        rewardId: reward.id,
        percentOff: reward.reward.kind === "discount" ? reward.reward.percentOff : 0,
        summary: reward.summary,
        expiresAt: reward.discountExpiresAt,
      }))
      .sort((a, b) => (a.expiresAt || Infinity) - (b.expiresAt || Infinity));
    return candidates[0] ?? null;
  } catch {
    // A lookup failure must never block a purchase — the buyer just pays full price.
    return null;
  }
}

/**
 * The discount percentage actually applied, clamped to the catalog-wide maximum
 * discount. The admin editor already blocks configuring past break-even; this is
 * the second, binding guard for the case where prices or costs moved AFTER the
 * reward was granted.
 */
export function effectivePercentOff(percentOff: number, settings: PricingSettings): number {
  return Math.max(0, Math.min(percentOff, settings.maxDiscountPct));
}

/** Apply a percentage to a major-unit amount, rounded to cents. */
export function discountedAmount(amount: number, percentOff: number): number {
  if (percentOff <= 0) return amount;
  return Math.round(amount * (1 - percentOff / 100) * 100) / 100;
}

/**
 * Hold a discount for a checkout attempt. Returns false when someone else got
 * there first, in which case the caller charges full price rather than risk
 * giving the same reward away twice.
 */
export async function reserveDiscount(
  rewardId: string,
  paymentId: string,
  /** The money this discount takes off, so the payout can be costed for real. */
  discountAmount = 0,
): Promise<boolean> {
  try {
    const ref = db().doc(`${REWARDS}/${rewardId}`);
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const reward = normalizeReward(snap.id, snap.data());
      if (reward.redeemedAt > 0) return false;
      if (reward.reservedAt > 0 && Date.now() - reward.reservedAt < RESERVATION_TTL_MS) return false;
      tx.set(
        ref,
        { reservedAt: Date.now(), reservedFor: paymentId, reservedAmount: Math.round(discountAmount * 100) / 100 },
        { merge: true },
      );
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Settle every discount a completed payment consumed: mark it used and book what
 * it actually cost.
 *
 * Found by querying the reservation rather than threading a reward id through
 * Stripe metadata — the reservation already records exactly this relationship,
 * and one equality query beats four checkout paths each remembering to pass an
 * extra field.
 */
export async function finalizeDiscountsForPayment(
  paymentId: string,
  /**
   * The UNDISCOUNTED total this payment was for, when the reservation couldn't
   * know it. Memberships are the case: the reward is reserved before Stripe has
   * raised an invoice, so what the discount is worth is only knowable here.
   */
  fullAmount = 0,
): Promise<void> {
  if (!paymentId) return;
  try {
    const snap = await db().collection(REWARDS).where("reservedFor", "==", paymentId).limit(10).get();
    for (const doc of snap.docs) {
      const reward = normalizeReward(doc.id, doc.data());
      if (reward.redeemedAt > 0) continue;
      await redeemDiscount(reward.id, paymentId);
      let amount = (doc.get("reservedAmount") as number) ?? 0;
      if (amount <= 0 && fullAmount > 0 && reward.reward.kind === "discount") {
        amount = Math.round(((fullAmount * reward.reward.percentOff) / 100) * 100) / 100;
      }
      await recordDiscountCost(reward.id, amount);
    }
  } catch (err) {
    console.warn("[referrals] could not finalize discounts for", paymentId, err);
  }
}

/**
 * Convert a reservation into a permanent redemption once the payment landed.
 * Keyed on the payment id so a webhook retry is a no-op and a DIFFERENT
 * payment can't consume someone else's reservation.
 */
export async function redeemDiscount(rewardId: string, paymentId: string): Promise<void> {
  try {
    const ref = db().doc(`${REWARDS}/${rewardId}`);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const reward = normalizeReward(snap.id, snap.data());
      if (reward.redeemedAt > 0) return;
      if (reward.reservedFor && reward.reservedFor !== paymentId) return;
      tx.set(ref, { redeemedAt: Date.now(), redeemedOn: paymentId }, { merge: true });
    });
  } catch (err) {
    console.warn("[referrals] could not mark discount redeemed", rewardId, err);
  }
}
