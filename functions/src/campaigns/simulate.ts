/**
 * Dry-running a campaign before it ships.
 *
 * The admin editor can validate that a campaign is *coherent*; only this can
 * tell you what it will *cost*. Projecting a draft against real accounts is the
 * difference between "10% of spend back on every book" reading as a nice offer
 * and reading as ${x} a month — and that number is not guessable from the config.
 *
 * Two properties make this trustworthy:
 *
 *   - It runs the SAME pure evaluator and the SAME refund calculator the payout
 *     path uses. A simulator with its own arithmetic is a simulator that
 *     disagrees with production exactly when it matters.
 *   - It writes nothing. No enrollment, no event claim, no counter. An admin has
 *     to be able to poke at a draft without half-enrolling their customers.
 */
import {
  audienceVerdict,
  evaluateTerms,
  freezeTerms,
  inHoldout,
  summarizeRules,
  notesForRules,
  type Campaign,
  type CampaignRule,
  type SimulationResult,
  type SimulationRow,
  type TriggerFacts,
  type UserFacts,
} from "../../../books-frontend/src/core/config/campaigns";
import { grantLiabilityUsd } from "../../../books-frontend/src/core/config/economics";
import { getSparksConfig } from "../appConfig";
import { userFacts } from "./facts";
import { planRefund } from "./refund";
import { db } from "./store";

// Declared in the shared config module so the admin dashboard types its own
// rendering off the same shapes this returns.
export type { SimulationResult, SimulationRow } from "../../../books-frontend/src/core/config/campaigns";

/** How many accounts a projection samples. Bounded — this runs in a request. */
const SAMPLE_SIZE = 200;

/**
 * Project a campaign over a sample of real accounts, assuming each one performs
 * the modelled event.
 *
 * This is a WORST CASE by construction: it assumes every eligible account
 * triggers every rule. That's the right default for a spend check — you want to
 * know the ceiling before you find it — and the copy in the admin UI says so
 * rather than letting the number read as a forecast.
 */
export async function simulateCampaign(
  campaign: Campaign,
  event: {
    trigger: CampaignRule["trigger"];
    itemType?: TriggerFacts["itemType"];
    amount?: number;
    projectId?: string;
  },
): Promise<SimulationResult> {
  const at = Date.now();
  const terms = freezeTerms(campaign, at);
  const sparksConfig = await getSparksConfig();

  const snap = await db().collection("users").limit(SAMPLE_SIZE).get();
  const rows: SimulationRow[] = [];

  for (const doc of snap.docs) {
    let facts: UserFacts;
    try {
      facts = await userFacts(doc.id);
    } catch {
      continue;
    }
    const verdict = audienceVerdict(campaign, facts, at);
    const holdout = inHoldout(campaign, doc.id);

    if (!verdict.eligible && !verdict.holdout) {
      rows.push({
        uid: doc.id,
        eligible: false,
        reason: verdict.reason,
        holdout: false,
        matchedRuleIds: [],
        sparks: 0,
        costUsd: 0,
      });
      continue;
    }

    const triggerFacts: TriggerFacts = {
      trigger: event.trigger,
      at,
      itemType: event.itemType,
      amount: event.amount,
      projectId: event.projectId,
      invoiceNumber: 1,
    };
    // Match the event bus, which counts the purchase before evaluating — so a
    // "first purchase" rule reads the same here as it will in production.
    const asBuyer =
      event.trigger === "purchase" || event.trigger === "subscription_started"
        ? { ...facts, purchaseCount: facts.purchaseCount + 1 }
        : facts;

    const { matched } = evaluateTerms(terms, asBuyer, triggerFacts);
    let sparks = 0;
    for (const rule of matched) {
      if (holdout) break; // measured, never paid
      if (rule.effect.kind === "sparks") sparks += rule.effect.sparks;
      else if (rule.effect.kind === "spendRefund") {
        const plan = await planRefund({
          uid: doc.id,
          effect: rule.effect,
          // A prospective enrollment starts now, which is what makes
          // `sinceEnrollment` project as zero — correctly, since no spend has
          // happened under the offer yet.
          enrolledAt: at,
          purchasedProjectId: event.projectId ?? null,
          purchaseAmount: event.amount,
          sparkValueUsd: sparksConfig.sparkValueUsd,
        });
        sparks += plan.sparks;
      }
    }

    rows.push({
      uid: doc.id,
      eligible: verdict.eligible,
      reason: verdict.reason,
      holdout,
      matchedRuleIds: matched.map((r) => r.id),
      sparks,
      costUsd: sparks > 0 ? grantLiabilityUsd(sparksConfig, sparks) : 0,
    });
  }

  const paying = rows.filter((r) => r.sparks > 0);
  const totalCostUsd = round2(paying.reduce((sum, r) => sum + r.costUsd, 0));

  return {
    campaignId: campaign.id,
    summary: campaign.presentation.headline.trim() || summarizeRules(terms.rules),
    notes: notesForRules(terms.rules),
    sampled: rows.length,
    eligible: rows.filter((r) => r.eligible).length,
    wouldPay: paying.length,
    totalSparks: paying.reduce((sum, r) => sum + r.sparks, 0),
    totalCostUsd,
    avgCostUsd: paying.length > 0 ? round2(totalCostUsd / paying.length) : 0,
    worst: paying.sort((a, b) => b.costUsd - a.costUsd).slice(0, 10),
    truncated: snap.size >= SAMPLE_SIZE,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
