/**
 * Turning a resolved discount into a real Stripe coupon — needed only where
 * **Stripe owns the invoice**, which means memberships.
 *
 * Everywhere else we build the Checkout Session ourselves and simply quote a
 * lower line item, which keeps shipping undiscounted and runs through the
 * existing margin math. A membership renews on Stripe's schedule, so its
 * discount has to exist as an object Stripe can apply to an invoice we never
 * see being raised.
 *
 * One function for every caller, deliberately. Referral rewards, campaign
 * offers and typed coupon codes all need the same thing — a short-lived,
 * single-use percentage coupon — and separate copies would drift apart on
 * exactly the two fields that make it safe: `max_redemptions` and `redeem_by`.
 * Without both, a coupon id that leaks out of a Checkout URL is an unlimited
 * discount for anyone who finds it.
 */
import type Stripe from "stripe";
import { getStripe, isSandbox, stripeConfigured } from "./stripeClient";

/**
 * Mint a single-use percentage coupon for one checkout.
 *
 * Best-effort by design: returns null rather than throwing, because a discount
 * that can't be created must never be the reason a purchase can't be started.
 * Callers decide what to do with the reservation they already hold — see the
 * subscription route, which refuses only when the customer TYPED a code and is
 * therefore watching for it.
 */
export async function createSingleUseCoupon(args: {
  percentOff: number;
  /** Repeat across N invoices (free months); omitted ⇒ a one-off discount. */
  months?: number;
  /** When the coupon may no longer be applied for the FIRST time. */
  expiresAt: number;
  name: string;
  /** Which engine asked for it, so Stripe's dashboard says who to blame. */
  source: "referral" | "coupon";
}): Promise<string | null> {
  if (!stripeConfigured()) return null;
  try {
    const params: Stripe.CouponCreateParams = {
      percent_off: Math.min(100, Math.max(1, args.percentOff)),
      // Stripe caps coupon names at 40 characters and rejects longer ones
      // outright. A summary written by an operator ("20% off your first
      // membership month") runs past that, and losing the tail of a label the
      // customer also sees on their invoice beats losing the discount.
      name: args.name.slice(0, 40),
      max_redemptions: 1,
      metadata: { source: args.source, env: isSandbox() ? "sandbox" : "live" },
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
    console.error("[stripe] single-use coupon create failed", args.source, err);
    return null;
  }
}
