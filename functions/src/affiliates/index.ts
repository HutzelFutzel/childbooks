/**
 * The affiliate program's public surface — Rewardful attribution in, commission
 * scope out. Everything the rest of the backend needs is here.
 *
 * Three jobs, and only three:
 *
 *   1. **Capture** the referral onto the account when the browser reports one
 *      (`POST /affiliates/attribution`). Guests included: the studio is
 *      guest-first and linking an identity keeps the same uid, so a referral
 *      captured before signup survives it.
 *
 *   2. **Stamp** it onto the Stripe customer exactly once, which is what tells
 *      Rewardful this customer belongs to that affiliate. We deliberately do NOT
 *      use `client_reference_id` for this: it already carries our own paymentId,
 *      and customer metadata is the mechanism that also survives subscription
 *      renewals (each renewal invoice bills the same customer).
 *
 *   3. **Suppress** commissions on purchases outside the campaign's scope, by
 *      putting `rewardful: false` on the charge/subscription before the money
 *      moves. That's Rewardful's own sanctioned mechanism, and unlike deleting a
 *      commission afterwards it never notifies an affiliate about money they
 *      aren't going to get.
 *
 * Everything here is best-effort by construction: an affiliate program must
 * never be the reason a purchase can't be started. Callers get a safe default
 * (no attribution, no suppression) whenever anything goes wrong.
 */
import express, { type Express, type Response } from "express";
import { serverConfig } from "../config";
import { getStripe } from "../stripeClient";
import { getAffiliateConfig } from "../appConfig";
import { type AuthedRequest } from "../auth";
import {
  isCommissionable,
  isRewardfulId,
  type CommissionableKind,
} from "../../../books-frontend/src/core/config/affiliates";
import {
  markAttributionStamped,
  readAttribution,
  writeAttribution,
  type AttributionRecord,
} from "./store";

export type { AttributionRecord } from "./store";

/** The active billing environment (Rewardful only ever sees the live one). */
function activeEnv() {
  return serverConfig().stripe.env;
}

/**
 * The attribution that counts for the ACTIVE environment, or null. A record
 * captured in sandbox is invisible in live (and vice versa) because Rewardful
 * doesn't process Stripe test-mode events — pretending otherwise would stamp
 * referrals that can never convert and suppress commissions for no reason.
 */
async function activeAttribution(uid: string): Promise<AttributionRecord | null> {
  const record = await readAttribution(uid);
  if (!record) return null;
  return record.env === activeEnv() ? record : null;
}

// ---- 1. Capture -------------------------------------------------------------

export interface AttributionInput {
  referral: string;
  affiliateId?: string | null;
  affiliateName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
}

function cleanName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function cleanId(value: unknown): string | null {
  return isRewardfulId(value) ? String(value).trim() : null;
}

/**
 * Record (or replace) the caller's attribution. Returns whether anything was
 * stored, which the route reports back so a client can stop asking.
 *
 * Replacement is deliberate and matches Rewardful's last-touch model: until the
 * referral has been stamped onto the Stripe customer, the most recent affiliate
 * link wins. After that the customer is theirs and we leave it alone.
 */
export async function recordAttribution(
  uid: string,
  input: AttributionInput,
): Promise<{ stored: boolean; reason?: "invalid" | "disabled" | "converted" | "unchanged" }> {
  if (!isRewardfulId(input.referral)) return { stored: false, reason: "invalid" };
  const config = await getAffiliateConfig();
  if (!config.enabled) return { stored: false, reason: "disabled" };

  const referral = input.referral.trim();
  const existing = await readAttribution(uid);
  if (existing?.stampedAt) return { stored: false, reason: "converted" };
  if (
    existing &&
    existing.referral === referral &&
    existing.env === activeEnv() &&
    existing.campaignId === cleanId(input.campaignId)
  ) {
    return { stored: false, reason: "unchanged" };
  }

  await writeAttribution(uid, {
    referral,
    affiliateId: cleanId(input.affiliateId),
    affiliateName: cleanName(input.affiliateName),
    campaignId: cleanId(input.campaignId),
    campaignName: cleanName(input.campaignName),
    env: activeEnv(),
    capturedAt: Date.now(),
    stampedAt: null,
  });
  return { stored: true };
}

// ---- 2. Stamp ---------------------------------------------------------------

/**
 * Write the referral onto the Stripe customer, once. Called from the one place
 * that resolves a customer for checkout, so every purchase path is covered.
 *
 * Stripe merges metadata on update, so the `uid` we set at creation survives.
 * Never throws: a failed stamp costs the affiliate this conversion, which is
 * strictly better than costing the customer their purchase. The next checkout
 * tries again (`stampedAt` is only set on success).
 */
export async function stampCustomerAttribution(uid: string, customerId: string): Promise<void> {
  try {
    const config = await getAffiliateConfig();
    if (!config.enabled) return;
    const record = await activeAttribution(uid);
    if (!record || record.stampedAt) return;

    await getStripe().customers.update(customerId, {
      metadata: { referral: record.referral },
    });
    await markAttributionStamped(uid, record.referral);
  } catch (err) {
    console.warn("[affiliates] could not stamp attribution onto customer", err);
  }
}

// ---- 3. Suppress ------------------------------------------------------------

/**
 * Metadata to merge into a Checkout Session's `payment_intent_data` (one-off
 * purchases) or `subscription_data` (memberships): `{ rewardful: "false" }` when
 * this purchase must not pay a commission, otherwise nothing.
 *
 * Only ever returned for a customer we KNOW is attributed. Stamping every
 * unattributed charge would be harmless today but would silently kill coupon-
 * tracked commissions the day affiliate coupon codes are switched on — a trap
 * worth not setting.
 */
export async function affiliateChargeMetadata(
  uid: string,
  kind: CommissionableKind,
): Promise<Record<string, string>> {
  try {
    const config = await getAffiliateConfig();
    if (!config.enabled) return {};
    const record = await activeAttribution(uid);
    if (!record) return {};
    const allowed = isCommissionable(config, {
      campaignId: record.campaignId,
      affiliateId: record.affiliateId,
      kind,
    });
    return allowed ? {} : { rewardful: "false" };
  } catch (err) {
    // A config/read failure must not turn into an unintended commission, and
    // must not block checkout either — suppress and move on.
    console.warn("[affiliates] scope lookup failed; suppressing commission", err);
    return { rewardful: "false" };
  }
}

// ---- Routes -----------------------------------------------------------------

/**
 * Mounted under `/affiliates` with `requireAuth` (see app.ts) — guests must be
 * able to record a referral, since the click almost always happens before there
 * is a real account.
 */
export function registerAffiliateRoutes(app: Express): void {
  const json = express.json({ limit: "8kb" });

  app.post("/affiliates/attribution", json, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid;
      if (!uid) {
        res.status(401).json({ error: { message: "Authentication required." } });
        return;
      }
      const body = (req.body ?? {}) as AttributionInput;
      const result = await recordAttribution(uid, body);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.warn("[affiliates] attribution capture failed", err);
      // Tracking is not the user's problem — never surface an error into the app.
      res.json({ ok: false, stored: false });
    }
  });
}
