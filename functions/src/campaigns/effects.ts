/**
 * Delivering one campaign benefit — the only place a campaign ever pays out.
 *
 * Three invariants hold every payout together, borrowed wholesale from the
 * referral engine because they were right there:
 *
 *   1. **Exactly once.** The redemption document id is derived from
 *      (campaign, rule, account[, event]) and claimed with `.create()`. A webhook
 *      that fires five times, a backfill and a retry all converge on one payout.
 *
 *   2. **Never silently unbounded.** Before delivering, the payout is checked
 *      against the per-account cap, the campaign's global cap, and its daily and
 *      lifetime budgets. Past any of them it's recorded as `review` and an ops
 *      alert fires — held, not lost, and never quietly paid.
 *
 *   3. **Frozen terms.** What gets delivered comes from the enrollment's
 *      snapshot, not live config. Only the SAFETY limits are read live: those
 *      protect the business, so a months-old enrollment doesn't get to opt out.
 *
 * Delivery differs by kind. Sparks go through the normal ledger (so lot
 * accounting, expiry and the finance stream all just work). Spend refunds do the
 * same, plus a watermark on the consumed history. Discounts are stored
 * redeemable-at-checkout. Price overrides are never delivered at all — they're
 * read at quote time by `pricing.ts`.
 */
import {
  describeEffect,
  describeTrigger,
  type CampaignEffect,
  type CampaignRule,
  type CampaignTrigger,
} from "../../../books-frontend/src/core/config/campaigns";
import { grantLiabilityUsd } from "../../../books-frontend/src/core/config/economics";
import { getCampaignsConfig, getSparksConfig } from "../appConfig";
import { notifySlack } from "../notify";
import { grantSparks } from "../sparks";
import { markRefunded, planRefund } from "./refund";
import {
  addLifetimeSpend,
  db,
  DAY_MS,
  getEnrollment,
  isAlreadyExists,
  lifetimeSpend,
  redemptionId,
  REDEMPTIONS,
  releaseGlobalSlot,
  reserveGlobalSlot,
  tallyEnrollment,
  type EnrollmentDoc,
  type RedemptionDoc,
} from "./store";
import { bumpStat, costToday } from "./stats";

export interface DeliverArgs {
  enrollment: EnrollmentDoc;
  rule: CampaignRule;
  trigger: CampaignTrigger;
  uid: string;
  /** Payment/invoice that qualified it — the handle a refund claws back on. */
  qualifyingRef: string | null;
  /** Qualifying purchase amount, base currency (sizes a refund's cap). */
  purchaseAmount?: number;
  /** The project that was bought, for a project-scoped refund. */
  purchasedProjectId?: string | null;
  /** Admin-facing campaign name, denormalized onto the redemption. */
  campaignName: string;
}

export type DeliverOutcome = "granted" | "duplicate" | "held" | "failed" | "nothing";

/**
 * The worst-case cost of an effect in the pricing base currency, for the budget
 * breaker and the admin's cost stats.
 *
 * A discount costs NOTHING until it's redeemed, so it books at 0 here and the
 * real amount is added when it's actually used — a budget that counted unredeemed
 * discounts would throttle a campaign on money that was never spent.
 */
async function estimateCost(effect: CampaignEffect, sparks: number): Promise<number> {
  if (effect.kind === "sparks" || effect.kind === "spendRefund") {
    return grantLiabilityUsd(await getSparksConfig(), sparks);
  }
  return 0;
}

/** Whether this payout has to wait for a human, and why. */
async function holdReason(args: DeliverArgs, cost: number): Promise<string | null> {
  if (args.rule.requiresApproval) {
    return "This rule pays out on something no code can verify, so it's checked by hand.";
  }

  const limits = args.enrollment.terms.limits;

  const perRule = args.enrollment.perRule[args.rule.id] ?? 0;
  if (args.rule.maxPerAccount > 0 && perRule >= args.rule.maxPerAccount) {
    return `This account has already claimed this rule ${perRule} time(s), and it's capped at ${args.rule.maxPerAccount}.`;
  }
  if (limits.maxPerAccount > 0 && args.enrollment.redeemedCount >= limits.maxPerAccount) {
    return `This account is at the campaign's per-account cap of ${limits.maxPerAccount}.`;
  }

  // Live, not frozen: budgets protect the business, so an old enrollment can't
  // opt out of them.
  const config = await getCampaignsConfig();
  const campaign = config.campaigns.find((c) => c.id === args.enrollment.campaignId);
  const dailyBudget = campaign?.limits.dailyBudget ?? limits.dailyBudget;
  const totalBudget = campaign?.limits.lifetimeBudget ?? limits.lifetimeBudget;

  if (dailyBudget > 0 && cost > 0) {
    const spent = await costToday(args.enrollment.campaignId);
    if (spent + cost > dailyBudget) {
      return `Today's payouts (${round2(spent)}) would exceed this campaign's ${dailyBudget} daily budget.`;
    }
  }
  if (totalBudget > 0 && cost > 0) {
    const spent = await lifetimeSpend(args.enrollment.campaignId);
    if (spent + cost > totalBudget) {
      return `Total payouts (${round2(spent)}) would exceed this campaign's ${totalBudget} lifetime budget.`;
    }
  }
  return null;
}

/**
 * Deliver one benefit, idempotently. Returns what happened so callers can log,
 * but never throws — a failed payout must not fail the payment that triggered it.
 */
export async function deliverEffect(args: DeliverArgs): Promise<DeliverOutcome> {
  const repeatable = args.rule.maxPerAccount !== 1;
  const id = redemptionId({
    campaignId: args.enrollment.campaignId,
    ruleId: args.rule.id,
    uid: args.uid,
    repeatable,
    instanceRef: args.qualifyingRef,
  });
  const ref = db().doc(`${REDEMPTIONS}/${id}`);
  const summary = describeEffect(args.rule.effect, { plain: true });
  const unlocks = describeTrigger(args.rule.trigger, args.rule.afterDays);

  // Claim first: whoever creates the doc owns the delivery.
  try {
    await ref.create({
      campaignId: args.enrollment.campaignId,
      campaignName: args.campaignName,
      ruleId: args.rule.id,
      uid: args.uid,
      trigger: args.trigger,
      effect: args.rule.effect,
      status: "pending",
      summary,
      unlocks,
      qualifyingRef: args.qualifyingRef,
      cost: 0,
      sparks: 0,
      refundedEntryIds: [],
      createdAt: Date.now(),
      grantedAt: null,
      note: null,
      discountExpiresAt: 0,
      redeemedAt: 0,
      redeemedOn: null,
      reservedAt: 0,
      reservedFor: null,
    } satisfies Omit<RedemptionDoc, "id">);
  } catch (err) {
    if (isAlreadyExists(err)) return "duplicate";
    console.error("[campaigns] could not claim redemption", id, err);
    return "failed";
  }

  return await settle(args, id);
}

/**
 * Everything after the claim: size it, check the limits, deliver, book it, tell
 * the customer.
 *
 * Separate from {@link deliverEffect} because the claim is what makes a payout
 * exactly-once. A redemption that ended up held has ALREADY been claimed, so
 * releasing it later has to re-enter here rather than through `.create()` (which
 * would report a duplicate and strand it forever).
 */
async function settle(
  args: DeliverArgs,
  id: string,
  /** An admin has already decided this one pays — skip the cap/budget gate. */
  opts: { ignoreLimits?: boolean } = {},
): Promise<DeliverOutcome> {
  const ref = db().doc(`${REDEMPTIONS}/${id}`);
  const campaignId = args.enrollment.campaignId;

  try {
    const sparksConfig = await getSparksConfig();

    // Size the payout BEFORE the limit gate: a refund's cost depends on what the
    // customer actually spent, and a zero-value payout should never consume a
    // slot in a capped offer.
    const sized = await sizeEffect(args, sparksConfig.sparkValueUsd);
    if (sized.sparks <= 0 && args.rule.effect.kind !== "purchaseDiscount") {
      await ref.set(
        { status: "void", note: sized.note ?? "Nothing to pay out for this account." },
        { merge: true },
      );
      return "nothing";
    }

    const cost = await estimateCost(args.rule.effect, sized.sparks);
    const hold = opts.ignoreLimits ? null : await holdReason(args, cost);
    if (hold) {
      await ref.set({ status: "review", cost, sparks: sized.sparks, note: hold }, { merge: true });
      await bumpStat(campaignId, "held");
      await notifySlack({
        channel: "ops",
        messageKey: "admin_alert",
        ref: `campaign_review_${id}`,
        text: `⏸️ Campaign payout held — ${args.campaignName}: ${describeEffect(args.rule.effect, { plain: true })} to ${args.uid.slice(0, 8)}. ${hold}`,
      });
      return "held";
    }

    // Reserve the global slot only once we're certain we're about to pay, and
    // give it back if delivery then fails — otherwise a run of failures would
    // silently exhaust a "first 100" offer without anyone receiving anything.
    const limits = args.enrollment.terms.limits;
    if (!opts.ignoreLimits && !(await reserveGlobalSlot(campaignId, limits.maxTotal))) {
      await ref.set(
        { status: "review", cost, sparks: sized.sparks, note: `This campaign is at its cap of ${limits.maxTotal} total redemptions.` },
        { merge: true },
      );
      await bumpStat(campaignId, "held");
      return "held";
    }

    const delivered = await deliver(args, id, sized);
    if (!delivered.ok) {
      if (!opts.ignoreLimits) await releaseGlobalSlot(campaignId);
      await ref.set({ status: "review", cost, sparks: sized.sparks, note: delivered.note }, { merge: true });
      await bumpStat(campaignId, "held");
      await notifySlack({
        channel: "ops",
        messageKey: "admin_alert",
        ref: `campaign_undeliverable_${id}`,
        text: `⚠️ Campaign payout couldn't be delivered — ${args.campaignName} to ${args.uid.slice(0, 8)}. ${delivered.note}`,
      });
      return "held";
    }

    await ref.set(
      {
        status: "granted",
        cost,
        sparks: sized.sparks,
        grantedAt: Date.now(),
        note: sized.note,
        ...delivered.patch,
      },
      { merge: true },
    );

    await Promise.all([
      tallyEnrollment(args.uid, campaignId, args.rule.id),
      addLifetimeSpend(campaignId, cost),
      bumpStat(campaignId, "redemptions"),
      bumpStat(campaignId, "cost", cost),
      bumpStat(campaignId, "sparks", sized.sparks),
    ]);

    await notifySlack({
      channel: "growth",
      messageKey: "referral_paid",
      ref: `campaign_paid_${id}`,
      text: `🎁 ${args.campaignName} paid out — ${describeEffect(args.rule.effect, { plain: true })} (${describeTrigger(args.trigger, args.rule.afterDays)}).`,
    });
    return "granted";
  } catch (err) {
    console.error("[campaigns] payout failed", id, err);
    await ref
      .set({ status: "review", note: "Delivery threw — needs a look." }, { merge: true })
      .catch(() => {});
    return "failed";
  }
}

interface SizedEffect {
  /** Sparks to hand over (0 for discounts). */
  sparks: number;
  /** Ledger entries a refund consumed. */
  entryIds: string[];
  /** A caveat worth recording, e.g. which cap bound the refund. */
  note: string | null;
}

/**
 * How much this effect is actually worth for this account. Only a spend refund
 * needs work: everything else is a fixed number the admin typed.
 */
async function sizeEffect(args: DeliverArgs, sparkValueUsd: number): Promise<SizedEffect> {
  const effect = args.rule.effect;
  if (effect.kind === "sparks") return { sparks: effect.sparks, entryIds: [], note: null };
  if (effect.kind !== "spendRefund") return { sparks: 0, entryIds: [], note: null };

  const plan = await planRefund({
    uid: args.uid,
    effect,
    enrolledAt: args.enrollment.enrolledAt,
    purchasedProjectId: args.purchasedProjectId,
    purchaseAmount: args.purchaseAmount,
    sparkValueUsd,
  });

  const notes: string[] = [];
  if (plan.cappedBy === "sparks") notes.push(`capped at ${effect.maxRefundSparks} Sparks`);
  if (plan.cappedBy === "purchase") notes.push(`capped at ${effect.maxPctOfPurchase}% of the purchase`);
  if (plan.cappedBy === "belowMinimum") notes.push(`under the ${effect.minRefundSparks}-Spark minimum`);
  if (plan.truncated) notes.push("spend history was longer than one scan");

  return {
    sparks: plan.sparks,
    entryIds: plan.entryIds,
    note: notes.length > 0 ? `${plan.qualifyingSparks} Sparks qualified; ${notes.join(", ")}.` : null,
  };
}

interface Delivered {
  ok: boolean;
  note: string;
  patch: Record<string, unknown>;
}

async function deliver(args: DeliverArgs, id: string, sized: SizedEffect): Promise<Delivered> {
  const effect = args.rule.effect;

  if (effect.kind === "sparks" || effect.kind === "spendRefund") {
    // Switching the Sparks economy off is a kill switch, so honor it rather than
    // minting into a currency the admin has just disabled. Held, not lost:
    // turning it back on and releasing the payout pays it.
    if (!(await getSparksConfig()).enabled) {
      return { ok: false, note: "The Sparks economy is switched off, so Sparks can't be granted.", patch: {} };
    }
    const expiresInDays = effect.kind === "sparks" ? effect.expiresInDays : 0;
    await grantSparks({
      uid: args.uid,
      amount: sized.sparks,
      // A spend refund is genuinely a refund; a promo grant is a grant. The
      // distinction survives onto the ledger so finance can tell the two apart.
      type: effect.kind === "spendRefund" ? "refund" : "grant",
      reason: `campaign:${args.enrollment.campaignId}:${args.rule.id}`,
      source: "campaign",
      ref: id,
      expiresInDays,
    });
    if (effect.kind === "spendRefund") {
      await markRefunded(args.uid, sized.entryIds, id);
    }
    return { ok: true, note: "", patch: { refundedEntryIds: sized.entryIds } };
  }

  if (effect.kind === "purchaseDiscount") {
    // 0 days means "until the campaign ends" — a discount that outlives the
    // campaign that promised it is an open-ended liability.
    const expiresAt =
      effect.expiresInDays > 0
        ? Date.now() + effect.expiresInDays * DAY_MS
        : args.enrollment.expiresAt || 0;
    return { ok: true, note: "", patch: { discountExpiresAt: expiresAt } };
  }

  // A standing price override is read at quote time, never delivered. Reaching
  // here means a rule was built that the schema should have refused.
  return { ok: false, note: "Price overrides aren't delivered — this rule is misconfigured.", patch: {} };
}

export type ReleaseOutcome = DeliverOutcome | "not_found" | "not_held" | "voided";

/**
 * Pay out a redemption that was held, on an admin's say-so. The limits that held
 * it are deliberately NOT re-checked — the admin read the reason and decided —
 * but delivery can still fail, in which case it goes back to held with the new
 * reason.
 */
export async function releaseRedemption(id: string): Promise<ReleaseOutcome> {
  const snap = await db().doc(`${REDEMPTIONS}/${id}`).get();
  if (!snap.exists) return "not_found";
  const d = snap.data() as Record<string, unknown>;
  const status = d.status as string;
  // `pending` is a claim whose delivery never finished (a crash mid-flight); it's
  // stuck for the same reason and released the same way.
  if (status !== "review" && status !== "pending") return "not_held";

  const uid = d.uid as string;
  const campaignId = d.campaignId as string;
  const enrollment = await getEnrollment(uid, campaignId);
  if (!enrollment) return "failed";

  const ruleId = d.ruleId as string;
  const rule =
    enrollment.terms.rules.find((r) => r.id === ruleId) ??
    ({
      id: ruleId,
      enabled: true,
      trigger: (d.trigger as CampaignTrigger) ?? "purchase",
      conditions: [],
      effect: d.effect as CampaignEffect,
      afterDays: 0,
      maxPerAccount: 1,
      // An admin releasing a held payout IS the approval.
      requiresApproval: false,
    } satisfies CampaignRule);

  return await settle(
    {
      enrollment,
      rule: { ...rule, requiresApproval: false },
      trigger: (d.trigger as CampaignTrigger) ?? "purchase",
      uid,
      qualifyingRef: (d.qualifyingRef as string) ?? null,
      campaignName: (d.campaignName as string) ?? campaignId,
    },
    id,
    { ignoreLimits: true },
  );
}

/** Decline a held payout: it never pays, and it stops showing as pending work. */
export async function voidRedemption(id: string, reason: string): Promise<ReleaseOutcome> {
  const ref = db().doc(`${REDEMPTIONS}/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return "not_found";
  const status = snap.get("status") as string;
  if (status !== "review" && status !== "pending") return "not_held";
  await ref.set({ status: "void", note: `Declined by an admin — ${reason}` }, { merge: true });
  return "voided";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
