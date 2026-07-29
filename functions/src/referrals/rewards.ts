/**
 * Granting one referral reward — the only place a referral ever pays out.
 *
 * Three invariants hold every payout together:
 *
 *   1. **Exactly once.** The reward document id is `invitation__rule__side`, and
 *      it's claimed with `.create()`. A webhook that fires five times, a
 *      backfill, and a retry all converge on one grant.
 *
 *   2. **Never silently unbounded.** Before delivering, the payout is checked
 *      against the inviter's lifetime cap and the program's daily budget. Past
 *      either, the reward is recorded as `review` and an ops alert fires — held,
 *      not lost, and never quietly paid. {@link releaseReward} is the other half
 *      of that promise: held is a decision an admin can make, not a dead end.
 *
 *   3. **Frozen terms.** The reward being granted comes from the invitation's
 *      snapshot, not from live config. Only the SAFETY limits are read live —
 *      those protect the business, so they're not something a months-old
 *      invitation gets to opt out of.
 *
 * Delivery differs by kind: Sparks are granted through the normal ledger,
 * discounts are stored as redeemable-at-checkout (see `redemption.ts`), and free
 * months attach a coupon to the live subscription. A reward that can't be
 * delivered (a free month for someone who has since cancelled) is held for
 * review rather than dropped.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getReferralConfig, getSparksConfig } from "../appConfig";
import { grantLiabilityUsd } from "../../../books-frontend/src/core/config/economics";
import {
  createDefaultConditions,
  describeReward,
  describeTrigger,
  type Reward,
  type RewardRule,
  type RewardSide,
  type RewardTrigger,
} from "../../../books-frontend/src/core/config/referral";
import { sendReferralRewardEmail } from "../email/triggers";
import { notifySlack } from "../notify";
import { hasActiveSubscription } from "../plans";
import { grantSparks } from "../sparks";
import { bumpStat, rewardCostToday } from "./stats";
import { activeSubscription, applyFreeMonths } from "./stripeRewards";
import {
  DAY_MS,
  INVITATIONS,
  REWARDS,
  db,
  getInvitation,
  isAlreadyExists,
  normalizeReward,
  rewardId,
  type InvitationDoc,
} from "./store";

export interface ApplyRewardArgs {
  invitation: InvitationDoc;
  rule: RewardRule;
  side: RewardSide;
  reward: Reward;
  trigger: RewardTrigger;
  /** Who receives the reward. */
  uid: string;
  /** The other party (used for the notification copy). */
  counterpartUid: string;
  /** Payment/invoice that qualified it — the handle a refund claws back on. */
  qualifyingRef: string | null;
}

export type ApplyOutcome = "granted" | "duplicate" | "held" | "failed";

/**
 * The worst-case cost of a reward, in the pricing base currency, used for the
 * budget breaker and the admin's cost stats.
 *
 * A discount costs NOTHING until it's redeemed, so it books at 0 here and the
 * real amount is added when it's actually used — a budget that counted unredeemed
 * coupons would throttle the program on money that was never spent.
 */
async function estimateCost(reward: Reward, uid: string): Promise<number> {
  if (reward.kind === "sparks") {
    return grantLiabilityUsd(await getSparksConfig(), reward.sparks);
  }
  if (reward.kind === "freeMonths") {
    // The invoice we won't collect. The Spark grant riding along with the gifted
    // month is deliberately excluded — the subscription's own grant path already
    // books that liability, and counting it twice would throttle the budget.
    const subscription = await activeSubscription(uid);
    return Math.round((subscription?.amount ?? 0) * reward.months * 100) / 100;
  }
  return 0;
}

/** Whether this payout has to wait for a human, and why. */
async function holdReason(args: ApplyRewardArgs, cost: number): Promise<string | null> {
  // Checked here — AFTER the claim, not before it in `payRule` — so a referrer
  // who isn't (yet) a subscriber gets a reward doc that's visibly held rather
  // than no reward at all. The admin can release it once they resubscribe, or
  // once they've decided the check no longer applies; skipping the claim
  // entirely would make that reward simply vanish with no trace.
  if (
    args.side === "referrer" &&
    args.rule.conditions.referrerMustBeSubscriber &&
    !(await hasActiveSubscription(args.uid))
  ) {
    return "This rule only pays the referrer while they have an active membership, and they don't right now.";
  }

  const config = await getReferralConfig();

  if (args.side === "referrer") {
    const snap = await db().doc(`users/${args.uid}`).get();
    const rewarded = snap.exists ? ((snap.get("referralRewardCount") as number) ?? 0) : 0;
    if (rewarded >= config.limits.maxRewardedReferralsPerUser) {
      return `Inviter is past the lifetime cap of ${config.limits.maxRewardedReferralsPerUser} rewarded referrals.`;
    }
  }

  const budget = config.limits.dailyBudgetAmount;
  if (budget > 0 && cost > 0) {
    const spent = await rewardCostToday();
    if (spent + cost > budget) {
      return `Today's referral payouts (${Math.round(spent * 100) / 100}) would exceed the ${budget} daily budget.`;
    }
  }
  return null;
}

/**
 * Grant one reward, idempotently. Returns what happened so callers can log, but
 * never throws — a failed reward must not fail the payment that triggered it.
 */
export async function applyReward(args: ApplyRewardArgs): Promise<ApplyOutcome> {
  const id = rewardId(args.invitation.id, args.rule.id, args.side);
  const ref = db().doc(`${REWARDS}/${id}`);

  // Claim first: whoever creates the doc owns the delivery.
  try {
    await ref.create({
      invitationId: args.invitation.id,
      ruleId: args.rule.id,
      trigger: args.trigger,
      side: args.side,
      uid: args.uid,
      counterpartUid: args.counterpartUid,
      reward: args.reward,
      status: "pending",
      qualifyingRef: args.qualifyingRef,
      summary: describeReward(args.reward, { plain: true }),
      unlocks: describeTrigger(args.trigger, args.side),
      cost: 0,
      createdAt: Date.now(),
      grantedAt: null,
    });
  } catch (err) {
    if (isAlreadyExists(err)) return "duplicate";
    console.error("[referrals] could not claim reward", id, err);
    return "failed";
  }

  return await settle(args, id);
}

/**
 * Everything after the claim: cost it, check the limits, deliver, book it, tell
 * both the user and #growth.
 *
 * Separate from {@link applyReward} because the claim is what makes a payout
 * exactly-once, and a reward that ended up held or half-delivered has already
 * been claimed — so releasing it later has to re-enter HERE, not through
 * `.create()` (which would just report a duplicate and strand it forever).
 */
async function settle(
  args: ApplyRewardArgs,
  id: string,
  /** An admin has already decided this one pays — skip the cap/budget gate. */
  opts: { ignoreLimits?: boolean } = {},
): Promise<ApplyOutcome> {
  const ref = db().doc(`${REWARDS}/${id}`);
  const summary = describeReward(args.reward, { plain: true });
  const unlocks = describeTrigger(args.trigger, args.side);

  try {
    const cost = await estimateCost(args.reward, args.uid);
    const hold = opts.ignoreLimits ? null : await holdReason(args, cost);
    if (hold) {
      await ref.set({ status: "review", cost, note: hold }, { merge: true });
      await notifySlack({
        channel: "ops",
        messageKey: "admin_alert",
        ref: `referral_review_${id}`,
        text: `⏸️ Referral reward held for review — ${summary} to ${args.side} ${args.uid.slice(0, 8)}. ${hold}`,
      });
      return "held";
    }

    const delivered = await deliver(args, id);
    if (!delivered.ok) {
      await ref.set({ status: "review", cost, note: delivered.note }, { merge: true });
      await notifySlack({
        channel: "ops",
        messageKey: "admin_alert",
        ref: `referral_undeliverable_${id}`,
        text: `⚠️ Referral reward couldn't be delivered — ${summary} to ${args.uid.slice(0, 8)}. ${delivered.note}`,
      });
      return "held";
    }

    await ref.set(
      {
        status: "granted",
        cost,
        grantedAt: Date.now(),
        note: null,
        ...delivered.patch,
      },
      { merge: true },
    );

    // Bookkeeping: the invitation's tallies, the inviter's REFERRAL count (what
    // the lifetime cap reads), and the daily funnel counters.
    const firstForReferral = await tallyInvitation(args);
    await Promise.all([
      firstForReferral
        ? db().doc(`users/${args.uid}`).set({ referralRewardCount: FieldValue.increment(1) }, { merge: true })
        : Promise.resolve(),
      bumpStat("rewardsGranted"),
      bumpStat("rewardCost", cost),
    ]);

    await announce(args, id, summary, unlocks, delivered);
    return "granted";
  } catch (err) {
    console.error("[referrals] reward delivery failed", id, err);
    await ref.set({ status: "review", note: "Delivery threw — needs a look." }, { merge: true }).catch(() => {});
    return "failed";
  }
}

/**
 * Increment the invitation's reward tally, and for a referrer payout claim the
 * "this referral has been rewarded" flag.
 *
 * Returns true only for the call that CLAIMED the flag, because that's the only
 * one that should consume a slot in the inviter's lifetime cap: the cap counts
 * rewarded referrals, and a three-rule ladder paying out for one friend must not
 * spend three of them.
 */
async function tallyInvitation(args: ApplyRewardArgs): Promise<boolean> {
  const ref = db().doc(`${INVITATIONS}/${args.invitation.id}`);
  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const first = args.side === "referrer" && snap.get("referrerRewarded") !== true;
      tx.set(
        ref,
        {
          rewardedCount: FieldValue.increment(1),
          ...(first ? { referrerRewarded: true } : {}),
        },
        { merge: true },
      );
      return first;
    });
  } catch (err) {
    // Bookkeeping only — the reward itself is already granted. Not counting it
    // is the safe direction to fail (the cap stays generous, not the payout).
    console.warn("[referrals] invitation tally failed", args.invitation.id, err);
    return false;
  }
}

export type ReleaseOutcome = ApplyOutcome | "not_found" | "not_held";

/**
 * Pay out a reward that was held for review, on an admin's say-so. The limits
 * that held it are deliberately NOT re-checked — the admin looked at the reason
 * and decided — but delivery can still fail (a cancelled membership), in which
 * case it goes straight back to held with the new reason.
 */
export async function releaseReward(rewardId: string): Promise<ReleaseOutcome> {
  const snap = await db().doc(`${REWARDS}/${rewardId}`).get();
  if (!snap.exists) return "not_found";
  const reward = normalizeReward(snap.id, snap.data());
  // `pending` means a claim whose delivery never finished (a crash mid-flight);
  // it's stuck for exactly the same reason and released the same way.
  if (reward.status !== "review" && reward.status !== "pending") return "not_held";

  const invitation = await getInvitation(reward.invitationId);
  if (!invitation) return "failed";

  return await settle(
    {
      invitation,
      // The frozen terms are the authority on what the rule was; a synthetic
      // stand-in covers a reward whose rule was edited out of an old snapshot.
      rule: invitation.terms.rules.find((r) => r.id === reward.ruleId) ?? {
        id: reward.ruleId,
        enabled: true,
        trigger: reward.trigger,
        referrer: null,
        referred: null,
        conditions: createDefaultConditions(),
      },
      side: reward.side,
      reward: reward.reward,
      trigger: reward.trigger,
      uid: reward.uid,
      counterpartUid: reward.counterpartUid,
      qualifyingRef: reward.qualifyingRef,
    },
    rewardId,
    { ignoreLimits: true },
  );
}

/** Decline a held reward: it never pays, and it stops showing up as pending work. */
export async function voidHeldReward(rewardId: string, reason: string): Promise<ReleaseOutcome> {
  const ref = db().doc(`${REWARDS}/${rewardId}`);
  const snap = await ref.get();
  if (!snap.exists) return "not_found";
  const reward = normalizeReward(snap.id, snap.data());
  if (reward.status !== "review" && reward.status !== "pending") return "not_held";
  await ref.set({ status: "void", note: `Declined by an admin — ${reason}` }, { merge: true });
  return "granted";
}

interface Delivered {
  ok: boolean;
  note: string;
  patch: Record<string, unknown>;
  /** New Spark balance, when the reward was Sparks (for the email). */
  balance?: number;
  /** How to use it, when it isn't simply added to the balance. */
  howToUse?: string;
}

async function deliver(args: ApplyRewardArgs, id: string): Promise<Delivered> {
  const { reward } = args;

  if (reward.kind === "sparks") {
    // Switching the Sparks economy off is a kill switch, so honor it here rather
    // than minting into a currency the admin has just disabled. Held, not lost:
    // turning it back on and releasing the reward pays it.
    if (!(await getSparksConfig()).enabled) {
      return {
        ok: false,
        note: "The Sparks economy is switched off, so Sparks can't be granted right now.",
        patch: {},
      };
    }
    // A false return means the ledger already carried this ref, so the Sparks are
    // there either way — which is all the reward ever promised.
    await grantSparks({
      uid: args.uid,
      amount: reward.sparks,
      type: "grant",
      reason: `referral:${args.rule.id}`,
      source: "referral",
      ref: id,
    });
    const snap = await db().doc(`users/${args.uid}`).get();
    const balance = snap.exists ? ((snap.get("sparkBalance") as number) ?? undefined) : undefined;
    return { ok: true, note: "", patch: {}, balance };
  }

  if (reward.kind === "discount") {
    const expiresAt = Date.now() + reward.expiresInDays * DAY_MS;
    return {
      ok: true,
      note: "",
      patch: { discountExpiresAt: expiresAt },
      howToUse: `It's applied automatically at checkout — no code to type. Valid until ${new Date(
        expiresAt,
      ).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
    };
  }

  const applied = await applyFreeMonths(args.uid, reward.months);
  if (!applied) {
    return {
      ok: false,
      note: "No active membership to apply the free month to (cancelled or never started).",
      patch: {},
    };
  }
  return {
    ok: true,
    note: "",
    patch: { stripeCouponId: applied.couponId },
    howToUse: "It comes off your next membership invoice automatically.",
  };
}

async function announce(
  args: ApplyRewardArgs,
  id: string,
  summary: string,
  unlocks: string,
  delivered: Delivered,
): Promise<void> {
  await sendReferralRewardEmail({
    uid: args.uid,
    kind: args.side,
    benefit: summary,
    sparks: args.reward.kind === "sparks" ? args.reward.sparks : undefined,
    balance: args.reward.kind === "sparks" ? delivered.balance : undefined,
    howToUse: delivered.howToUse,
    rewardId: id,
  });
  await notifySlack({
    channel: "growth",
    messageKey: "referral_paid",
    ref: `referral_reward_${id}`,
    text: `🎁 Referral reward — ${summary} to the ${args.side} (${unlocks}).`,
  });
}

/**
 * Book the real cost of a discount once it's actually used. Called from the
 * checkout path, because until a discount is redeemed it has cost nothing.
 */
export async function recordDiscountCost(rewardId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    await db()
      .doc(`${REWARDS}/${rewardId}`)
      .set({ cost: FieldValue.increment(amount) }, { merge: true });
    await bumpStat("rewardCost", Math.round(amount * 100) / 100);
  } catch {
    // telemetry only
  }
}
