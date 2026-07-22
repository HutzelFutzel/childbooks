/**
 * Ebook (digital edition) sales — pricing + post-payment delivery.
 *
 * Fully admin-configurable via `PricingSettings.ebook` (enabled flag, per-
 * currency prices, print-bundle discount, tax code). The flow mirrors print
 * orders: the client renders + uploads the PDF at checkout, the webhook marks
 * the payment paid and only THEN grants the download by writing a
 * `users/{uid}/downloads/{id}` entitlement (owner-readable, backend-only
 * writes).
 *
 * Downloads are a GENERAL surface: each entitlement carries a `type` (today
 * only `"ebook"`, but future digital products slot in without a schema change),
 * a download counter, and an `events` audit subcollection (time + IP + device
 * per download). The private file URL is deliberately kept OFF the client-
 * readable entitlement doc — it lives on the admin payment record and is only
 * handed out through the gated `/account/downloads/:id/link` endpoint, so every
 * download is authorized and logged (and the link stays revocable).
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  getAdminPayment,
  hasPaidPrintOrder,
  updatePayment,
} from "./payments";
import { ebookPlanPrice, type EbookSettings } from "../../books-frontend/src/core/config/products";
import type { PlanDefinition } from "../../books-frontend/src/core/config/plans";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Firestore path for a user's download entitlements. */
function downloadsCol(uid: string): string {
  return `users/${uid}/downloads`;
}

export interface EbookQuote {
  enabled: boolean;
  currency: string;
  /** Final price after the plan price + print-bundle discount (0 ⇒ included with the plan). */
  price: number;
  /** Sticker price before any plan pricing or discount. */
  listPrice: number;
  /** Applied print-bundle discount (0 when the buyer has no paid print order). */
  discountPct: number;
  /** Whether the buyer already owns this ebook (re-download instead of re-buy). */
  owned: boolean;
  /** The buyer's plan, ONLY when it changed the price (drives the storefront wording). */
  planId: string | null;
  planName: string | null;
  /** True when the buyer's plan makes the ebook free (granted without checkout). */
  included: boolean;
}

/**
 * Price the ebook for a buyer + project: sticker price per currency, replaced
 * by the buyer's plan price when one is configured (0 ⇒ included free), minus
 * the print-bundle discount when they already bought a print copy.
 */
export async function priceEbook(
  uid: string,
  projectId: string,
  currency: string,
  settings: EbookSettings,
  plan: PlanDefinition | null,
): Promise<EbookQuote> {
  const cur = currency.toUpperCase();
  const listPrice = settings.prices[cur] ?? 0;
  // Sticker price gates availability for everyone; the plan price only
  // re-prices an ebook that is on sale.
  const paidPlan = plan && !plan.isFree ? plan : null;
  const planPrice = paidPlan ? ebookPlanPrice(settings, paidPlan.id, cur) : null;
  const planApplied = paidPlan != null && planPrice != null && planPrice < listPrice;
  const effective = planApplied ? planPrice : listPrice;
  const base: EbookQuote = {
    enabled: settings.enabled && listPrice > 0,
    currency: cur,
    price: effective,
    listPrice,
    discountPct: 0,
    owned: false,
    planId: planApplied && paidPlan ? paidPlan.id : null,
    planName: planApplied && paidPlan ? paidPlan.presentation.name : null,
    included: false,
  };
  if (!base.enabled) return base;

  const [owned, hasPrint] = await Promise.all([
    ownsEbook(uid, projectId),
    settings.printBundleDiscountPct > 0 && effective > 0
      ? hasPaidPrintOrder(uid, projectId)
      : Promise.resolve(false),
  ]);
  const discountPct = hasPrint ? Math.max(0, Math.min(100, settings.printBundleDiscountPct)) : 0;
  const price = Math.round(effective * (1 - discountPct / 100) * 100) / 100;
  return { ...base, owned, discountPct, price, included: planApplied && price <= 0 };
}

export async function ownsEbook(uid: string, projectId: string): Promise<boolean> {
  const snap = await db().doc(`${downloadsCol(uid)}/${projectId}`).get();
  return snap.exists;
}

/**
 * Deliver a PAID ebook payment: write the owner-readable download entitlement.
 * Idempotent — re-delivery refreshes the same doc WITHOUT resetting the download
 * counter/seen state, so duplicate webhooks are harmless. The file URL is NOT
 * stored here (it stays on the admin payment doc and is served via the gated
 * link endpoint), so the raw storage URL is never exposed to the client.
 */
export async function deliverPaidEbook(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  if (!payment || payment.kind !== "ebook" || !payment.ebook) return;
  const { projectId, title, fileUrl } = payment.ebook;
  if (!projectId || !fileUrl) return;
  const ref = db().doc(`${downloadsCol(payment.ownerUid)}/${projectId}`);
  const snap = await ref.get();
  const existing = snap.data() as Record<string, unknown> | undefined;
  await ref.set(
    {
      id: projectId,
      type: "ebook",
      projectId,
      title,
      paymentId,
      purchasedAt: (existing?.purchasedAt as number) ?? Date.now(),
      downloadCount: (existing?.downloadCount as number) ?? 0,
      lastDownloadedAt: (existing?.lastDownloadedAt as number) ?? null,
      seenAt: (existing?.seenAt as number) ?? null,
    },
    { merge: true },
  );
  await updatePayment({
    paymentId,
    uid: payment.ownerUid,
    event: "ebook.delivered",
  });
}

/**
 * Revoke the download entitlement granted by a now-fully-refunded ebook
 * payment. Only removes the entitlement if it still points at THIS payment —
 * a later re-purchase writes a fresh paymentId and must survive the refund of
 * the earlier one. Idempotent (deleting a missing doc is a no-op).
 */
export async function revokeRefundedEbook(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  if (!payment || payment.kind !== "ebook" || !payment.ebook?.projectId) return;
  const ref = db().doc(`${downloadsCol(payment.ownerUid)}/${payment.ebook.projectId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  if ((snap.data() as Record<string, unknown>).paymentId !== paymentId) return;
  await ref.delete();
  await updatePayment({ paymentId, uid: payment.ownerUid, event: "ebook.revoked" });
}

export interface DownloadContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Authorize + record a download, then return the private file URL to fetch.
 *
 * Verifies the caller owns the entitlement, appends an audit event (time, IP,
 * device) to its `events` subcollection, bumps the counter, and marks it seen.
 * Returns null when the entitlement (or its backing file) can't be found, so the
 * caller can 404 without leaking whether the id exists.
 */
export async function logDownloadAndResolveUrl(
  uid: string,
  id: string,
  ctx: DownloadContext,
): Promise<string | null> {
  const ref = db().doc(`${downloadsCol(uid)}/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;

  // The file URL is kept off the client-readable entitlement; resolve it from
  // the (admin-only) payment record that granted this download.
  const paymentId = (d.paymentId as string) ?? "";
  if (!paymentId) return null;
  const payment = await getAdminPayment(paymentId);
  const fileUrl = payment && payment.ownerUid === uid ? payment.ebook?.fileUrl ?? null : null;
  if (!fileUrl) return null;

  const at = Date.now();
  await ref.collection("events").add({
    at,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 400) : null,
  });
  await ref.set(
    {
      downloadCount: FieldValue.increment(1),
      lastDownloadedAt: at,
      seenAt: (d.seenAt as number) ?? at,
    },
    { merge: true },
  );
  return fileUrl;
}

/** Stamp `seenAt` on every not-yet-seen entitlement (clears the "new" badge). */
export async function markDownloadsSeen(uid: string): Promise<void> {
  const snap = await db().collection(downloadsCol(uid)).get();
  const now = Date.now();
  const batch = db().batch();
  let pending = 0;
  for (const doc of snap.docs) {
    if ((doc.data() as Record<string, unknown>).seenAt == null) {
      batch.set(doc.ref, { seenAt: now }, { merge: true });
      pending += 1;
    }
  }
  if (pending > 0) await batch.commit();
}
