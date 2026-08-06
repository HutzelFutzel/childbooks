/**
 * Local mirror of the Rewardful account, and the one place affiliate cost enters
 * the P&L.
 *
 * Rewardful stays the system of record — every field here is overwritten by the
 * next sync and nothing is ever edited locally. What the mirror buys us:
 *
 *   - An admin dashboard that renders from our own Firestore instead of hammering
 *     a 45-request-per-30-seconds API on every page load.
 *   - The JOIN Rewardful cannot do: charge id → our payment → what was actually
 *     bought and by whom. That's what makes a commission attributable to a
 *     product line rather than a lump "marketing cost".
 *   - An audit signal: a commission whose purchase kind was OUT of the
 *     affiliate's scope means suppression didn't work. It should be impossible,
 *     so it raises an alert rather than being silently absorbed.
 *
 * Money: Rewardful reports integer cents in the sale's currency. We convert once
 * here (admin FX table) and store `amountUsd` alongside, so every aggregate the
 * dashboard and the ledger show is one comparable number.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { serverConfig } from "../config";
import { getAffiliateConfig } from "../appConfig";
import { recordFinanceEvent, toUsd, type FinanceCategory } from "../finance";
import { findPaymentIdByStripeId, findUidByCustomerId, getAdminPayment } from "../payments";
import { raiseAlert } from "../alerts";
import {
  isCommissionable,
  type AffiliateCampaignMirror,
  type AffiliateCommissionMirror,
  type AffiliatePartnerMirror,
  type AffiliatePayoutMirror,
  type AffiliateSyncStatus,
  type CommissionableKind,
} from "../../../books-frontend/src/core/config/affiliates";
import type {
  RewardfulAffiliateObject,
  RewardfulCampaignObject,
  RewardfulCommissionObject,
  RewardfulPayoutObject,
} from "./api";

export const CAMPAIGNS_COLLECTION = "affiliateCampaigns";
export const PARTNERS_COLLECTION = "affiliatePartners";
export const COMMISSIONS_COLLECTION = "affiliateCommissions";
export const PAYOUTS_COLLECTION = "affiliatePayouts";
/** Processed webhook event ids, so a 3-day retry storm can't double-count. */
export const EVENTS_COLLECTION = "affiliateWebhookEvents";
export const SYNC_DOC = "adminSettings/affiliateSync";

function db() {
  ensureAdmin();
  return getFirestore();
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function affiliateName(a: RewardfulAffiliateObject | null | undefined): string {
  if (!a) return "";
  const name = [text(a.first_name, 80), text(a.last_name, 80)].filter(Boolean).join(" ");
  return name || text(a.email, 200);
}

// ---- Campaigns --------------------------------------------------------------

export async function mirrorCampaign(obj: RewardfulCampaignObject): Promise<AffiliateCampaignMirror | null> {
  const id = text(obj.id, 64);
  if (!id) return null;
  const doc: AffiliateCampaignMirror = {
    id,
    name: text(obj.name, 120),
    rewardType: obj.reward_type === "amount" ? "amount" : "percent",
    commissionPercent: nullableNum(obj.commission_percent),
    commissionAmountCents: nullableNum(obj.commission_amount_cents),
    commissionAmountCurrency: text(obj.commission_amount_currency, 8) || null,
    minimumPayoutCents: nullableNum(obj.minimum_payout_cents),
    minimumPayoutCurrency: text(obj.minimum_payout_currency, 8) || null,
    maxCommissionPeriodMonths: nullableNum(obj.max_commission_period_months),
    maxCommissions: nullableNum(obj.max_commissions),
    daysBeforeReferralsExpire: nullableNum(obj.days_before_referrals_expire),
    daysUntilCommissionsAreDue: nullableNum(obj.days_until_commissions_are_due),
    isDefault: obj.default === true,
    visitors: num(obj.visitors),
    leads: num(obj.leads),
    conversions: num(obj.conversions),
    affiliates: num(obj.affiliates),
    createdAt: ms(obj.created_at),
    syncedAt: Date.now(),
  };
  await db().collection(CAMPAIGNS_COLLECTION).doc(id).set(doc, { merge: true });
  return doc;
}

// ---- Affiliates -------------------------------------------------------------

export async function mirrorPartner(obj: RewardfulAffiliateObject): Promise<AffiliatePartnerMirror | null> {
  const id = text(obj.id, 64);
  if (!id) return null;
  const doc: AffiliatePartnerMirror = {
    id,
    name: affiliateName(obj),
    email: text(obj.email, 200),
    state: text(obj.state, 32) || "active",
    campaignId: text(obj.campaign?.id, 64) || null,
    campaignName: text(obj.campaign?.name, 120) || null,
    visitors: num(obj.visitors),
    leads: num(obj.leads),
    conversions: num(obj.conversions),
    links: (Array.isArray(obj.links) ? obj.links : [])
      .slice(0, 10)
      .map((l) => ({ token: text(l.token, 80), url: text(l.url, 300) }))
      .filter((l) => l.token || l.url),
    createdAt: ms(obj.created_at),
    confirmedAt: ms(obj.confirmed_at),
    syncedAt: Date.now(),
    deletedAt: null,
  };
  await db().collection(PARTNERS_COLLECTION).doc(id).set(doc, { merge: true });
  return doc;
}

// ---- Commissions ------------------------------------------------------------

/** Map a purchase kind onto the P&L category its revenue was booked under. */
function categoryFor(kind: CommissionableKind | null): FinanceCategory {
  switch (kind) {
    case "order":
    case "ebook":
      return "books";
    case "subscription":
      return "subscriptions";
    case "sparkPack":
    case "sparkGift":
      return "sparks";
    default:
      // Unattributable commission (charge not found on our side) — still a real
      // marketing cost, so it lands in ops rather than vanishing.
      return "ops";
  }
}

/**
 * Resolve which of OUR purchases a commission was earned on. The Stripe charge id
 * is the reliable key; the customer id only tells us who, which is still worth
 * having when the charge predates the payment record or came from an invoice.
 */
async function resolveOurSide(
  chargeId: string | null,
  customerId: string | null,
): Promise<{ uid: string | null; paymentId: string | null; kind: CommissionableKind | null }> {
  let paymentId: string | null = null;
  let uid: string | null = null;
  let kind: CommissionableKind | null = null;
  try {
    if (chargeId) {
      paymentId = await findPaymentIdByStripeId("stripeChargeId", chargeId);
      if (paymentId) {
        const payment = await getAdminPayment(paymentId);
        if (payment) {
          uid = payment.ownerUid || null;
          kind = payment.kind as CommissionableKind;
        }
      }
    }
    if (!uid && customerId) uid = await findUidByCustomerId(customerId);
  } catch (err) {
    // A failed join costs us attribution detail, never the mirrored row.
    console.warn("[affiliates] could not resolve our side of a commission", err);
  }
  return { uid, paymentId, kind };
}

/**
 * Write one commission and book its cost.
 *
 * Cost timing is accrual, not cash: the cost is booked as soon as the commission
 * leaves `pending` (i.e. survived the refund window and is genuinely owed), dated
 * to the CHARGE it was earned on so it lands in the same period as the revenue it
 * came out of. A later void writes a compensating credit rather than editing
 * history, exactly like a refund.
 */
export async function mirrorCommission(
  obj: RewardfulCommissionObject,
): Promise<AffiliateCommissionMirror | null> {
  const id = text(obj.id, 64);
  if (!id) return null;

  const sale = obj.sale ?? null;
  const referral = sale?.referral ?? null;
  const currency = (text(obj.currency, 8) || "USD").toUpperCase();
  const amountCents = num(obj.amount);
  const state = text(obj.state, 16) || "pending";
  const stripeChargeId = text(sale?.stripe_charge_id, 120) || null;
  const stripeCustomerId = text(referral?.stripe_customer_id, 120) || null;

  const [amountUsd, ours, config] = await Promise.all([
    toUsd(amountCents / 100, currency),
    resolveOurSide(stripeChargeId, stripeCustomerId),
    getAffiliateConfig(),
  ]);

  const affiliateId = text(sale?.affiliate?.id, 64) || null;
  const campaignId = text(obj.campaign?.id, 64) || text(sale?.affiliate?.campaign?.id, 64) || null;
  const inScope = ours.kind
    ? isCommissionable(config, { campaignId, affiliateId, kind: ours.kind })
    : null;

  const ref = db().collection(COMMISSIONS_COLLECTION).doc(id);
  const previous = await ref.get();
  const costRecordedAt = nullableNum(previous.get("costRecordedAt"));
  const costVoidedAt = nullableNum(previous.get("costVoidedAt"));

  const doc: AffiliateCommissionMirror = {
    id,
    amountCents,
    currency,
    amountUsd,
    state,
    createdAt: ms(obj.created_at),
    dueAt: ms(obj.due_at),
    paidAt: ms(obj.paid_at),
    voidedAt: ms(obj.voided_at),
    chargedAt: ms(sale?.charged_at) ?? ms(sale?.invoiced_at),
    affiliateId,
    affiliateName: affiliateName(sale?.affiliate) || null,
    campaignId,
    campaignName: text(obj.campaign?.name, 120) || text(sale?.affiliate?.campaign?.name, 120) || null,
    saleAmountCents: nullableNum(sale?.sale_amount_cents),
    chargeAmountCents: nullableNum(sale?.charge_amount_cents),
    refundAmountCents: nullableNum(sale?.refund_amount_cents),
    saleCurrency: text(sale?.currency, 8).toUpperCase() || null,
    stripeChargeId,
    stripeCustomerId,
    uid: ours.uid,
    paymentId: ours.paymentId,
    purchaseKind: ours.kind,
    inScope,
    costRecordedAt,
    costVoidedAt,
    syncedAt: Date.now(),
    deletedAt: null,
  };
  await ref.set(doc, { merge: true });

  await bookCommissionCost(doc);
  await flagOutOfScope(doc);
  return doc;
}

/** Whether the ledger should carry this commission as a cost yet. */
function isOwed(state: string): boolean {
  return state === "due" || state === "paid";
}

/**
 * Book (or reverse) the commission in the finance ledger. Both writes are
 * idempotent on `ref`, so re-syncing the same commission forever is free.
 *
 * Only in the live environment: a sandbox deployment must never write into the
 * real P&L, and Rewardful has no test mode to mirror in the first place.
 */
async function bookCommissionCost(doc: AffiliateCommissionMirror): Promise<void> {
  if (serverConfig().stripe.env !== "live") return;
  const ref = db().collection(COMMISSIONS_COLLECTION).doc(doc.id);
  const category = categoryFor(doc.purchaseKind);
  const meta = {
    commissionId: doc.id,
    affiliateId: doc.affiliateId,
    affiliateName: doc.affiliateName,
    campaignId: doc.campaignId,
    campaignName: doc.campaignName,
    purchaseKind: doc.purchaseKind,
    paymentId: doc.paymentId,
    stripeChargeId: doc.stripeChargeId,
  };

  if (isOwed(doc.state) && !doc.costRecordedAt && doc.amountUsd > 0) {
    await recordFinanceEvent({
      category,
      kind: "affiliateCommission",
      amountUsd: -doc.amountUsd,
      uid: doc.uid ?? undefined,
      currency: doc.currency,
      amount: -(doc.amountCents / 100),
      // Dated to the charge, so the cost sits in the same period as the sale it
      // was earned on rather than whenever Rewardful got around to releasing it.
      at: doc.chargedAt ?? doc.createdAt ?? Date.now(),
      ref: `affcom_${doc.id}`,
      meta,
    });
    await ref.set({ costRecordedAt: Date.now() }, { merge: true });
    return;
  }

  // A void after the cost was booked: credit it back at the time of the void,
  // leaving both facts in the ledger (the same shape as a refund).
  if (doc.state === "voided" && doc.costRecordedAt && !doc.costVoidedAt) {
    await recordFinanceEvent({
      category,
      kind: "affiliateCommissionVoided",
      amountUsd: doc.amountUsd,
      uid: doc.uid ?? undefined,
      currency: doc.currency,
      amount: doc.amountCents / 100,
      at: doc.voidedAt ?? Date.now(),
      ref: `affcomvoid_${doc.id}`,
      meta,
    });
    await ref.set({ costVoidedAt: Date.now() }, { merge: true });
  }
}

/**
 * A commission for a purchase kind the affiliate's scope excludes means the
 * `rewardful: false` stamp didn't land — a real bug that quietly costs money, so
 * it gets an alert rather than a log line. Idempotent on the commission id.
 */
async function flagOutOfScope(doc: AffiliateCommissionMirror): Promise<void> {
  if (doc.inScope !== false || doc.state === "voided") return;
  await raiseAlert({
    severity: "warning",
    kind: "affiliateScopeViolation",
    message:
      `Commission of ${doc.currency} ${(doc.amountCents / 100).toFixed(2)} was created for ` +
      `${doc.purchaseKind ?? "an unknown purchase"}, which is outside ${doc.affiliateName || "the affiliate"}'s ` +
      `scope (campaign ${doc.campaignName ?? doc.campaignId ?? "unknown"}). Suppression did not apply.`,
    meta: { commissionId: doc.id, paymentId: doc.paymentId, campaignId: doc.campaignId },
    ref: doc.id,
  });
}

// ---- Payouts ----------------------------------------------------------------

export async function mirrorPayout(obj: RewardfulPayoutObject): Promise<AffiliatePayoutMirror | null> {
  const id = text(obj.id, 64);
  if (!id) return null;
  const currency = (text(obj.currency, 8) || "USD").toUpperCase();
  const amountCents = num(obj.amount);
  const doc: AffiliatePayoutMirror = {
    id,
    amountCents,
    currency,
    amountUsd: await toUsd(amountCents / 100, currency),
    state: text(obj.state, 16) || "pending",
    paidAt: ms(obj.paid_at),
    affiliateId: text(obj.affiliate?.id, 64) || null,
    affiliateName: affiliateName(obj.affiliate) || null,
    commissionCount: Array.isArray(obj.commissions) ? obj.commissions.length : 0,
    createdAt: ms(obj.created_at),
    syncedAt: Date.now(),
    deletedAt: null,
  };
  await db().collection(PAYOUTS_COLLECTION).doc(id).set(doc, { merge: true });
  return doc;
}

// ---- Deletions --------------------------------------------------------------

/**
 * Rewardful says an object is gone. The row is TOMBSTONED rather than deleted:
 * a commission that was already booked as a cost still happened, and silently
 * dropping the row would leave a ledger entry no one can trace.
 */
export async function markMirrorDeleted(collection: string, id: string): Promise<void> {
  const ref = db().collection(collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set({ deletedAt: Date.now(), syncedAt: Date.now() }, { merge: true });
}

/**
 * A deleted commission is one we no longer owe, so tombstoning it also has to
 * credit back any cost already booked — otherwise the ledger keeps charging for
 * a commission that no longer exists anywhere upstream.
 */
export async function markCommissionDeleted(id: string): Promise<void> {
  const ref = db().collection(COMMISSIONS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get("deletedAt")) return;
  const doc = snap.data() as AffiliateCommissionMirror;
  await ref.set({ deletedAt: Date.now(), syncedAt: Date.now() }, { merge: true });
  await bookCommissionCost({ ...doc, state: "voided", voidedAt: Date.now() });
}

// ---- Sync status ------------------------------------------------------------

export async function readSyncStatus(): Promise<Partial<AffiliateSyncStatus>> {
  const snap = await db().doc(SYNC_DOC).get();
  return snap.exists ? (snap.data() as Partial<AffiliateSyncStatus>) : {};
}

export async function writeSyncStatus(status: AffiliateSyncStatus): Promise<void> {
  await db().doc(SYNC_DOC).set(status, { merge: true });
}
