/**
 * Ebook (digital edition) sales — pricing + post-payment delivery.
 *
 * Fully admin-configurable via `PricingSettings.ebook` (enabled flag, per-
 * currency prices, print-bundle discount, tax code). The flow mirrors print
 * orders: the client renders + uploads the PDF at checkout, the webhook marks
 * the payment paid and only THEN grants the download by writing
 * `users/{uid}/ebooks/{projectId}` (owner-readable, backend-only writes).
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  getAdminPayment,
  hasPaidPrintOrder,
  updatePayment,
} from "./payments";
import type { EbookSettings } from "../../books-frontend/src/core/config/products";

function db() {
  ensureAdmin();
  return getFirestore();
}

export interface EbookQuote {
  enabled: boolean;
  currency: string;
  /** Final price after the print-bundle discount (if it applies). */
  price: number;
  /** Sticker price before the discount. */
  listPrice: number;
  /** Applied discount (0 when the buyer has no paid print order for the project). */
  discountPct: number;
  /** Whether the buyer already owns this ebook (re-download instead of re-buy). */
  owned: boolean;
}

/**
 * Price the ebook for a buyer + project: sticker price per currency, minus the
 * print-bundle discount when they already bought a print copy of the project.
 */
export async function priceEbook(
  uid: string,
  projectId: string,
  currency: string,
  settings: EbookSettings,
): Promise<EbookQuote> {
  const cur = currency.toUpperCase();
  const listPrice = settings.prices[cur] ?? 0;
  const base: EbookQuote = {
    enabled: settings.enabled && listPrice > 0,
    currency: cur,
    price: listPrice,
    listPrice,
    discountPct: 0,
    owned: false,
  };
  if (!base.enabled) return base;

  const [owned, hasPrint] = await Promise.all([
    ownsEbook(uid, projectId),
    settings.printBundleDiscountPct > 0
      ? hasPaidPrintOrder(uid, projectId)
      : Promise.resolve(false),
  ]);
  const discountPct = hasPrint ? Math.max(0, Math.min(100, settings.printBundleDiscountPct)) : 0;
  const price = Math.round(listPrice * (1 - discountPct / 100) * 100) / 100;
  return { ...base, owned, discountPct, price };
}

export interface OwnedEbook {
  projectId: string;
  title: string;
  fileUrl: string;
  paymentId: string;
  purchasedAt: number;
}

export async function ownsEbook(uid: string, projectId: string): Promise<boolean> {
  const snap = await db().doc(`users/${uid}/ebooks/${projectId}`).get();
  return snap.exists;
}

export async function getOwnedEbook(uid: string, projectId: string): Promise<OwnedEbook | null> {
  const snap = await db().doc(`users/${uid}/ebooks/${projectId}`).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    projectId,
    title: (d.title as string) ?? "",
    fileUrl: (d.fileUrl as string) ?? "",
    paymentId: (d.paymentId as string) ?? "",
    purchasedAt: (d.purchasedAt as number) ?? 0,
  };
}

/**
 * Deliver a PAID ebook payment: write the owner-readable entitlement doc with
 * the download URL. Idempotent — re-delivery just refreshes the same doc, so
 * duplicate webhooks are harmless.
 */
export async function deliverPaidEbook(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  if (!payment || payment.kind !== "ebook" || !payment.ebook) return;
  const { projectId, title, fileUrl } = payment.ebook;
  if (!projectId || !fileUrl) return;
  await db()
    .doc(`users/${payment.ownerUid}/ebooks/${projectId}`)
    .set(
      {
        projectId,
        title,
        fileUrl,
        paymentId,
        purchasedAt: Date.now(),
      },
      { merge: true },
    );
  await updatePayment({
    paymentId,
    uid: payment.ownerUid,
    event: "ebook.delivered",
  });
}
