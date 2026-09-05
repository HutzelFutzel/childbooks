/**
 * The referral program's public surface — the only module the rest of the backend
 * imports.
 *
 * Everything else in this folder is an implementation detail: `store` (Firestore
 * shapes), `invitations` (lifecycle), `events` (triggers → rewards), `rewards`
 * (payout + limits), `redemption` (using an earned discount), `stripeRewards`
 * (the Stripe-owned rewards), `clawback` (reversal) and `stats` (funnel).
 */
import { getAuth } from "firebase-admin/auth";
import { getReferralConfig } from "../appConfig";
import {
  freezeTerms,
  inviteTeaser,
  notesForSide,
  type InvitationView,
  type ReferralOverview,
  type RewardView,
} from "../../../books-frontend/src/core/config/referral";
import { onReferralEvent } from "./events";
import {
  checkEligibility,
  ensureReferralCode,
  invitesLeftToday,
  shareUrlFor,
} from "./invitations";
import { db, listInvitationsFor, listRewardsFor, type InvitationDoc, type RewardDoc } from "./store";

export { ensureReferralCode, shareUrlFor, declineUrlFor, sendInvitations, acceptInvitation, declineInvitation, previewInvitation, checkEligibility } from "./invitations";
export { onReferralEvent, markFirstBookCompleted } from "./events";
export { clawbackForRef, blockInvitation } from "./clawback";
export { referralStatsSummary } from "./stats";
export { sweepInvitations, voidUnacceptedInvitations } from "./maintenance";
export { recordDiscountCost, releaseReward, voidHeldReward, type ReleaseOutcome } from "./rewards";
export {
  discountedAmount,
  effectivePercentOff,
  finalizeDiscountsForPayment,
  findRedeemableDiscount,
  redeemDiscount,
  reserveDiscount,
  type RedeemableDiscount,
} from "./redemption";
export type { SendResult, SendOutcome, AcceptOutcome } from "./invitations";

// ---- The invite screen's payload --------------------------------------------

function invitationView(invitation: InvitationDoc): InvitationView {
  return {
    id: invitation.id,
    code: invitation.code,
    recipientEmail: invitation.recipientEmail,
    status: invitation.status,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    progress: invitation.progress,
    referrerSummary: invitation.terms.referrerSummary,
    referrerNotes: notesForSide(invitation.terms, "referrer"),
    remindersSent: invitation.remindersSent,
    rewarded: invitation.rewardedCount > 0,
  };
}

function rewardView(reward: RewardDoc): RewardView {
  return {
    id: reward.id,
    side: reward.side,
    status: reward.status,
    summary: reward.summary,
    unlocks: reward.unlocks,
    at: reward.grantedAt ?? reward.createdAt,
    expiresAt: reward.discountExpiresAt > 0 ? reward.discountExpiresAt : null,
    used: reward.redeemedAt > 0,
  };
}

/**
 * Everything the invite screen shows, in one round trip: the live offer, the
 * caller's link, their sent invitations with progress, and their rewards.
 *
 * The offer copy comes from the CURRENT config (it's what a new invitation would
 * promise), while each listed invitation shows its own FROZEN promise — which is
 * exactly the distinction a user needs to see when the program has changed since
 * they invited someone.
 */
export async function referralOverview(uid: string): Promise<ReferralOverview> {
  const config = await getReferralConfig();
  const [code, auth] = await Promise.all([
    ensureReferralCode(uid),
    getAuth().getUser(uid).catch(() => null),
  ]);
  const terms = freezeTerms(config);
  const eligibility = await checkEligibility(uid, config, { emailVerified: auth?.emailVerified === true });
  const [invitations, rewards, left] = await Promise.all([
    listInvitationsFor(uid),
    listRewardsFor(uid),
    invitesLeftToday(uid, config),
  ]);

  return {
    enabled: config.enabled,
    code,
    shareUrl: await shareUrlFor(code),
    headline: config.presentation.headline,
    subline: config.presentation.subline,
    teaser: inviteTeaser(terms),
    referrerSummary: terms.referrerSummary,
    referredSummary: terms.referredSummary,
    referrerNotes: notesForSide(terms, "referrer"),
    referredNotes: notesForSide(terms, "referred"),
    canInvite: eligibility.canInvite,
    cannotInviteReason: eligibility.reason,
    invitationsLeftToday: left,
    // Only invitations this user SENT (the ones they accepted belong to someone
    // else's list, and would leak that person's activity).
    invitations: invitations.filter((i) => i.inviterUid === uid).map(invitationView),
    rewards: rewards.map(rewardView),
  };
}

// ---- Subscriptions ----------------------------------------------------------

/**
 * A subscription invoice was paid. Decides between "became a member" and
 * "renewed", and — for renewals — which invoice number this is, which is what
 * `nthInvoice` rules key on.
 *
 * The count comes from per-invoice marker documents rather than a counter, so a
 * webhook retry can't inflate it: the marker id IS the invoice id.
 *
 * Returns that count so the CAMPAIGN engine can key its own `nthInvoice` rules
 * on the same number. Deriving it twice would be two chances to disagree, and
 * "reward the third renewal" paying on the second is not a bug anyone finds
 * quickly.
 */
export async function onSubscriptionInvoicePaid(args: {
  uid: string;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
}): Promise<number> {
  try {
    const markers = db().collection(`users/${args.uid}/subscriptions/${args.subscriptionId}/paidInvoices`);
    await markers.doc(args.invoiceId).set({ at: Date.now(), amount: args.amount }, { merge: true });
    const count = (await markers.limit(50).get()).size;
    if (count <= 1) {
      await onReferralEvent(args.uid, "subscription_started", { ref: args.invoiceId, amount: args.amount });
      return count;
    }
    await onReferralEvent(args.uid, "subscription_renewed", {
      ref: args.invoiceId,
      amount: args.amount,
      invoiceNumber: count,
    });
    return count;
  } catch (err) {
    console.warn("[referrals] subscription invoice hook failed", err);
    return 0;
  }
}

// A membership discount used to be resolved here, referral-only. It now runs
// through the shared resolver in the checkout route with every other source, so
// a referral perk, a campaign offer and a typed code compete for the one Stripe
// coupon a subscription can carry.
