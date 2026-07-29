/**
 * The Stripe side of referral rewards — used only where **Stripe owns the
 * invoice**, which is subscriptions.
 *
 * Deliberate split, because it's the difference between a small change and a
 * checkout refactor:
 *
 *   - Print books, the digital edition and Spark packs are priced by US, in a
 *     Checkout Session we build per purchase. An earned discount on those is
 *     applied by lowering our own line item (see `redemption.ts`), which keeps
 *     shipping undiscounted and runs through the existing margin math. A
 *     session-level Stripe coupon would also discount the shipping line, since
 *     shipping is a line item here and the products are created inline (so
 *     `applies_to` can't single out the book).
 *
 *   - Memberships renew on Stripe's schedule, so a membership discount and a
 *     free month have to exist as real Stripe coupons on the subscription.
 *
 * Every function is best-effort and returns null on failure: a reward that can't
 * be delivered is recorded as such, never thrown into a payment flow.
 */
import type Stripe from "stripe";
import { getStripe, isSandbox, stripeConfigured } from "../stripeClient";
import { db } from "./store";

/** Subscription states that can carry a discount (mirrors `plans.ts`). */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface ActiveSubscriptionInfo {
  id: string;
  /** Major-unit invoice amount, so a gifted month can be costed at what it's worth. */
  amount: number;
  currency: string | null;
}

/** The user's live Stripe subscription, if they have one. */
export async function activeSubscription(uid: string): Promise<ActiveSubscriptionInfo | null> {
  try {
    const snap = await db().collection(`users/${uid}/subscriptions`).get();
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (ACTIVE_STATUSES.has(typeof d.status === "string" ? d.status : "")) {
        return {
          id: (d.id as string) ?? doc.id,
          amount: typeof d.amount === "number" ? d.amount : 0,
          currency: typeof d.currency === "string" ? d.currency : null,
        };
      }
    }
  } catch {
    // treated as "no subscription"
  }
  return null;
}

/**
 * A single-use percentage coupon for one earned reward. `max_redemptions: 1`
 * plus a `redeem_by` bound means even a leaked coupon id is worth one discount
 * for a limited time.
 */
export async function createReferralCoupon(args: {
  percentOff: number;
  /** Repeat across N invoices (free months); omitted ⇒ a one-off discount. */
  months?: number;
  expiresAt: number;
  name: string;
}): Promise<string | null> {
  if (!stripeConfigured()) return null;
  try {
    const params: Stripe.CouponCreateParams = {
      percent_off: Math.min(100, Math.max(1, args.percentOff)),
      name: args.name,
      max_redemptions: 1,
      metadata: { source: "referral", env: isSandbox() ? "sandbox" : "live" },
    };
    if (args.months && args.months > 1) {
      params.duration = "repeating";
      params.duration_in_months = args.months;
    } else {
      params.duration = "once";
    }
    // `redeem_by` bounds when the coupon may first be applied; a repeating
    // coupon that has already attached keeps running for its months.
    const redeemBy = Math.floor(args.expiresAt / 1000);
    if (redeemBy > Math.floor(Date.now() / 1000)) params.redeem_by = redeemBy;
    const coupon = await getStripe().coupons.create(params);
    return coupon.id;
  } catch (err) {
    console.error("[referrals] coupon create failed", err);
    return null;
  }
}

/**
 * Gift membership months by attaching a 100%-off coupon to the EXISTING
 * subscription, so it lands on the next invoice. Never a trial extension:
 * trials interact badly with plan changes and proration, and a coupon survives
 * both.
 *
 * Returns the coupon id when applied, null when the user has no live
 * subscription (the caller records the reward as undeliverable rather than
 * silently dropping it).
 */
export async function applyFreeMonths(
  uid: string,
  months: number,
): Promise<{ couponId: string; subscription: ActiveSubscriptionInfo } | null> {
  const subscription = await activeSubscription(uid);
  if (!subscription) return null;
  const couponId = await createReferralCoupon({
    percentOff: 100,
    months,
    expiresAt: Date.now() + 30 * 86_400_000,
    name: months === 1 ? "Referral: 1 free month" : `Referral: ${months} free months`,
  });
  if (!couponId) return null;
  try {
    await getStripe().subscriptions.update(subscription.id, { discounts: [{ coupon: couponId }] });
    return { couponId, subscription };
  } catch (err) {
    console.error("[referrals] free-month coupon apply failed", err);
    return null;
  }
}

/** Revoke a coupon a clawback is reversing (best-effort). */
export async function deleteCoupon(couponId: string): Promise<void> {
  if (!couponId || !stripeConfigured()) return;
  try {
    await getStripe().coupons.del(couponId);
  } catch {
    // Already gone, or already redeemed — nothing more we can do.
  }
}
