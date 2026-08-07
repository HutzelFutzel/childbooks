/**
 * The campaign event bus: one function the rest of the backend calls when
 * something happens to a user, which works out which campaigns care and what
 * (if anything) they pay.
 *
 * Call sites stay dumb on purpose — `onCampaignEvent(uid, "purchase", …)` from
 * the Stripe webhook, `"signup"` from the auth route, and so on. All the
 * knowledge about who is owed what lives here and in the frozen terms, so adding
 * a campaign never means touching payment code again.
 *
 * Two deliberate properties:
 *
 *   - **Everything is best-effort.** A campaign must never break the flow that
 *     fired it. A promotion bug that fails a payment webhook is far more
 *     expensive than a promotion that doesn't pay.
 *
 *   - **Enrollment is lazy.** Accounts are enrolled the first time they touch a
 *     campaign rather than swept in up front. A campaign aimed at "everyone who
 *     signs up before March" would otherwise need a backfill over the whole user
 *     table the moment it's saved, and would race with signups either way.
 */
import {
  audienceVerdict,
  campaignIsLive,
  evaluateTerms,
  freezeTerms,
  inHoldout,
  type Campaign,
  type CampaignTrigger,
  type TriggerFacts,
  type UserFacts,
} from "../../../books-frontend/src/core/config/campaigns";
import { getCampaignsConfig } from "../appConfig";
import { deliverEffect } from "./effects";
import { invalidateFacts, userFacts } from "./facts";
import {
  claimEvent,
  db,
  ensureEnrollment,
  getEnrollment,
  recordTrace,
  type EnrollmentDoc,
} from "./store";
import { bumpStat } from "./stats";

export interface CampaignEventContext {
  /** Payment/invoice id — the idempotency handle AND the clawback handle. */
  ref?: string | null;
  /** Qualifying amount in the pricing base currency. */
  amount?: number;
  /** What was bought (`print` / `ebook` / `pack` / `plan`). */
  itemType?: TriggerFacts["itemType"];
  productId?: string;
  projectId?: string;
  /** For `subscription_renewed`: which invoice this is (1 = the first). */
  invoiceNumber?: number;
  surveyId?: string;
  /** Days elapsed, for the scheduled triggers. */
  daysSince?: number;
}

/**
 * Something happened to a user: enroll them in whatever campaigns now apply, and
 * pay out whatever their frozen terms promise for it.
 *
 * The engine's master switch is checked here; an individual campaign's `paused`
 * state is not allowed to renege on an enrollment that already exists, because
 * that enrollment carries a promise and honoring it is cheaper than the support
 * thread that follows breaking it.
 */
export async function onCampaignEvent(
  uid: string,
  trigger: CampaignTrigger,
  ctx: CampaignEventContext = {},
): Promise<void> {
  try {
    const config = await getCampaignsConfig();
    if (!config.enabled || config.campaigns.length === 0) return;

    // Claim the event before doing anything with side effects. The ref falls back
    // to the uid+trigger for events that have no natural handle (a signup happens
    // once per account by definition).
    const eventRef = ctx.ref || `${uid}_${trigger}`;
    const fresh = await claimEvent({
      type: trigger,
      ref: eventRef,
      uid,
      payload: { ...ctx },
    });
    if (!fresh) return;

    // A purchase has to be counted before evaluation so that `firstPurchase`
    // reads true on the first one rather than on the second.
    if (isPurchase(trigger)) await countPurchase(uid);
    invalidateFacts(uid);

    const user = await userFacts(uid);
    const facts: TriggerFacts = {
      trigger,
      at: Date.now(),
      itemType: ctx.itemType,
      amount: ctx.amount,
      productId: ctx.productId,
      projectId: ctx.projectId,
      ref: ctx.ref ?? null,
      invoiceNumber: ctx.invoiceNumber,
      surveyId: ctx.surveyId,
      daysSince: ctx.daysSince,
    };

    for (const campaign of config.campaigns) {
      await runCampaign(campaign, user, facts, ctx);
    }
  } catch (err) {
    console.error("[campaigns] event handling failed", trigger, err);
  }
}

function isPurchase(trigger: CampaignTrigger): boolean {
  return trigger === "purchase" || trigger === "subscription_started";
}

/**
 * Maintain `lifetime.purchases` on the user doc.
 *
 * Owned by the bus rather than the payment code because the bus is the one place
 * that already deduplicates by payment ref — incrementing from `updatePayment`
 * (which is called repeatedly for one payment) would over-count, and an
 * over-counted purchase silently disqualifies a "first purchase" offer.
 */
async function countPurchase(uid: string): Promise<void> {
  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    await db()
      .doc(`users/${uid}`)
      .set({ lifetime: { purchases: FieldValue.increment(1) } }, { merge: true });
  } catch {
    // Best-effort; a missed count keeps a "first purchase" offer open one more
    // time rather than closing it early.
  }
}

async function runCampaign(
  campaign: Campaign,
  user: UserFacts,
  facts: TriggerFacts,
  ctx: CampaignEventContext,
): Promise<void> {
  // Standing price overrides are read at quote time by `pricing.ts`; they have
  // nothing to deliver and no enrollment to create.
  if (!campaign.rules.some((r) => r.enabled && r.trigger === facts.trigger)) return;

  let enrollment = await getEnrollment(user.uid, campaign.id);

  if (!enrollment) {
    // Only a LIVE campaign takes new members. A paused one keeps paying the
    // people already in it and admits nobody new.
    if (!campaignIsLive(campaign, facts.at)) return;
    const verdict = audienceVerdict(campaign, user, facts.at);
    if (!verdict.eligible && !verdict.holdout) return;

    enrollment = await ensureEnrollment({
      uid: user.uid,
      campaignId: campaign.id,
      terms: freezeTerms(campaign, facts.at),
      expiresAt: campaign.window.endsAt,
      holdout: inHoldout(campaign, user.uid),
    });
    await bumpStat(campaign.id, "enrollments");
    if (enrollment.holdout) await bumpStat(campaign.id, "holdouts");
  }

  // Expiry is the liability tail's off-switch: an enrollment that has run out of
  // time stops earning, however long ago it was created.
  if (enrollment.expiresAt > 0 && facts.at > enrollment.expiresAt) return;

  // Purchases are recorded for BOTH groups — the holdout's purchases are the
  // counterfactual the whole campaign is measured against.
  if (isPurchase(facts.trigger)) {
    await bumpStat(campaign.id, enrollment.holdout ? "holdoutPurchases" : "purchases");
    if (facts.amount) {
      await bumpStat(campaign.id, enrollment.holdout ? "holdoutRevenue" : "revenue", facts.amount);
    }
  }

  // The holdout is measured, never paid. That's the entire point of it.
  if (enrollment.holdout) return;

  const { matched, evaluations } = evaluateTerms(enrollment.terms, user, facts);
  const failures = evaluations.filter((e) => !e.matched).flatMap((e) => e.failures);
  if (failures.length > 0) {
    await recordTrace(user.uid, campaign.id, { trigger: facts.trigger, failures });
  }

  for (const rule of matched) {
    await deliverEffect({
      enrollment,
      rule,
      trigger: facts.trigger,
      uid: user.uid,
      qualifyingRef: ctx.ref ?? null,
      purchaseAmount: ctx.amount,
      purchasedProjectId: ctx.projectId ?? null,
      campaignName: campaign.name,
    });
    // Re-read so a second matching rule sees the updated per-account tallies
    // rather than paying against a stale count.
    enrollment = (await getEnrollment(user.uid, campaign.id)) ?? enrollment;
  }
}

/**
 * Enroll an account in every campaign it currently qualifies for, without any
 * event to pay out.
 *
 * This is what makes "you'll get X when you buy this" showable BEFORE the click:
 * the offers panel calls it, so the enrollment (and therefore the frozen promise)
 * exists at the moment the customer reads it rather than at the moment they act.
 */
export async function ensureEnrollments(uid: string): Promise<EnrollmentDoc[]> {
  const out: EnrollmentDoc[] = [];
  try {
    const config = await getCampaignsConfig();
    if (!config.enabled) return out;
    const user = await userFacts(uid);
    const at = Date.now();
    for (const campaign of config.campaigns) {
      const existing = await getEnrollment(uid, campaign.id);
      if (existing) {
        out.push(existing);
        continue;
      }
      if (!campaignIsLive(campaign, at)) continue;
      const verdict = audienceVerdict(campaign, user, at);
      if (!verdict.eligible && !verdict.holdout) continue;
      const enrollment = await ensureEnrollment({
        uid,
        campaignId: campaign.id,
        terms: freezeTerms(campaign, at),
        expiresAt: campaign.window.endsAt,
        holdout: inHoldout(campaign, uid),
      });
      await bumpStat(campaign.id, "enrollments");
      if (enrollment.holdout) await bumpStat(campaign.id, "holdouts");
      out.push(enrollment);
    }
  } catch (err) {
    console.warn("[campaigns] enrollment sweep failed", err);
  }
  return out;
}
