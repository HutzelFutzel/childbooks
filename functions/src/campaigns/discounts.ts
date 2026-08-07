/**
 * Redeeming a campaign **discount** against something we price ourselves (print
 * books, the digital edition, Spark packs).
 *
 * Mechanically identical to the referral discount path in
 * `referrals/redemption.ts` — reserve on session creation, convert on payment,
 * let an abandoned checkout's reservation lapse — because a customer with a
 * referral discount and a campaign discount must experience exactly one set of
 * rules. The two sources are unified for the caller by
 * {@link bestEarnedDiscount}, which is the ONE place stacking is decided.
 */
import type { DiscountItemType } from "../../../books-frontend/src/core/config/discountImpact";
import { getCampaignsConfig } from "../appConfig";
import {
  db,
  listRedemptionsFor,
  normalizeRedemption,
  REDEMPTIONS,
  type RedemptionDoc,
} from "./store";
import { bumpStat } from "./stats";
import { FieldValue } from "firebase-admin/firestore";

/** How long a checkout session holds an earned discount. Matches referrals. */
export const RESERVATION_TTL_MS = 30 * 60_000;

export interface CampaignDiscount {
  redemptionId: string;
  campaignId: string;
  percentOff: number;
  /** Frozen description, for the checkout line the buyer sees. */
  summary: string;
  expiresAt: number;
  /** Whether it may combine with another source's discount. */
  stackable: boolean;
  priority: number;
  /** Memberships: does it ride every renewal, or only the first invoice? */
  recurring: boolean;
}

/** Is this a live, unreserved, unredeemed discount valid for `itemType`? */
function isRedeemable(redemption: RedemptionDoc, itemType: DiscountItemType): boolean {
  if (redemption.status !== "granted") return false;
  if (redemption.effect.kind !== "purchaseDiscount") return false;
  if (redemption.redeemedAt > 0) return false;
  if (redemption.discountExpiresAt > 0 && Date.now() > redemption.discountExpiresAt) return false;
  // A live reservation means another checkout is mid-flight with it.
  if (redemption.reservedAt > 0 && Date.now() - redemption.reservedAt < RESERVATION_TTL_MS) return false;
  const scope = redemption.effect.appliesTo;
  return scope.length === 0 || scope.includes(itemType);
}

/**
 * Every campaign discount this account could use on `itemType`, best first.
 *
 * "Best" is the largest percentage, then the soonest expiry so nothing is wasted.
 * Deliberately NOT highest-priority: priority breaks ties between campaigns for
 * the operator's benefit, but a customer offered 20% and charged 10% experiences
 * a bug, whatever the config says.
 */
export async function earnedCampaignDiscounts(
  uid: string,
  itemType: DiscountItemType,
): Promise<CampaignDiscount[]> {
  try {
    const [redemptions, config] = await Promise.all([listRedemptionsFor(uid), getCampaignsConfig()]);
    const byId = new Map(config.campaigns.map((c) => [c.id, c]));
    return redemptions
      .filter((r) => isRedeemable(r, itemType))
      .map((r) => {
        const campaign = byId.get(r.campaignId);
        const effect = r.effect as Extract<RedemptionDoc["effect"], { kind: "purchaseDiscount" }>;
        return {
          redemptionId: r.id,
          campaignId: r.campaignId,
          percentOff: effect.percentOff,
          summary: r.summary,
          expiresAt: r.discountExpiresAt,
          stackable: campaign?.stackable ?? false,
          priority: campaign?.priority ?? 0,
          recurring: effect.recurring,
        };
      })
      .sort(
        (a, b) =>
          b.percentOff - a.percentOff ||
          (a.expiresAt || Infinity) - (b.expiresAt || Infinity) ||
          b.priority - a.priority,
      );
  } catch {
    // A lookup failure must never block a purchase — the buyer pays full price.
    return [];
  }
}

/**
 * Hold a discount for a checkout attempt. Returns false when someone else got
 * there first, in which case the caller charges full price rather than risk
 * giving the same discount away twice.
 */
export async function reserveCampaignDiscount(
  redemptionId: string,
  paymentId: string,
  /** The money this discount takes off, so the payout can be costed for real. */
  discountAmount = 0,
): Promise<boolean> {
  try {
    const ref = db().doc(`${REDEMPTIONS}/${redemptionId}`);
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const redemption = normalizeRedemption(snap.id, snap.data());
      if (redemption.redeemedAt > 0) return false;
      if (redemption.reservedAt > 0 && Date.now() - redemption.reservedAt < RESERVATION_TTL_MS) return false;
      tx.set(
        ref,
        {
          reservedAt: Date.now(),
          reservedFor: paymentId,
          reservedAmount: Math.round(discountAmount * 100) / 100,
        },
        { merge: true },
      );
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Settle every campaign discount a completed payment consumed: mark it used and
 * book what it actually cost.
 *
 * A discount's cost is booked HERE rather than at grant time because until it's
 * redeemed it has cost nothing — a budget that counted unredeemed discounts would
 * throttle a campaign on money it never spent.
 */
export async function finalizeCampaignDiscounts(paymentId: string, fullAmount = 0): Promise<void> {
  if (!paymentId) return;
  try {
    const snap = await db().collection(REDEMPTIONS).where("reservedFor", "==", paymentId).limit(10).get();
    for (const doc of snap.docs) {
      const redemption = normalizeRedemption(doc.id, doc.data());
      if (redemption.redeemedAt > 0) continue;
      await db().runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return;
        const current = normalizeRedemption(fresh.id, fresh.data());
        if (current.redeemedAt > 0) return;
        // Keyed on the payment id so a webhook retry is a no-op and a DIFFERENT
        // payment can't consume someone else's reservation.
        if (current.reservedFor && current.reservedFor !== paymentId) return;
        tx.set(doc.ref, { redeemedAt: Date.now(), redeemedOn: paymentId }, { merge: true });
      });

      let amount = (doc.get("reservedAmount") as number) ?? 0;
      if (amount <= 0 && fullAmount > 0 && redemption.effect.kind === "purchaseDiscount") {
        amount = Math.round(((fullAmount * redemption.effect.percentOff) / 100) * 100) / 100;
      }
      if (amount > 0) {
        await doc.ref.set({ cost: FieldValue.increment(amount) }, { merge: true }).catch(() => {});
        await bumpStat(redemption.campaignId, "cost", Math.round(amount * 100) / 100);
      }
    }
  } catch (err) {
    console.warn("[campaigns] could not finalize discounts for", paymentId, err);
  }
}
