/**
 * Where a user's affiliate attribution lives: `users/{uid}.affiliate`.
 *
 * Why our own record at all, when Rewardful has one? Because the click and the
 * purchase are weeks apart here — somebody arrives through an affiliate link,
 * signs up, spends a fortnight making a book, and only then checks out. A cookie
 * doesn't reliably survive that (cleared storage, another device, an expired
 * window), so the referral is captured onto the account at the moment we see it
 * and read back at checkout, which is also the only place we can decide whether
 * this particular purchase is in the affiliate's scope.
 *
 * On the user's own document (rather than an admin-only collection) because it's
 * keyed by uid, read on every checkout, and contains nothing the visitor's own
 * Rewardful cookie doesn't already tell them.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import type { BillingEnv } from "../../../books-frontend/src/core/config/plans";

export interface AttributionRecord {
  /** The Rewardful referral UUID — the value Stripe/Rewardful attribute on. */
  referral: string;
  /**
   * Who owns the referral and under which campaign, as reported by the browser
   * (`Rewardful.affiliate` / `Rewardful.campaign`). Used ONLY to resolve our own
   * commission scope — never to decide who gets paid, which is Rewardful's call
   * based on the referral UUID.
   */
  affiliateId: string | null;
  affiliateName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /**
   * The billing environment the referral was captured in. Rewardful does not
   * process Stripe test-mode events at all, so a sandbox capture must never be
   * stamped onto a live customer (or counted anywhere).
   */
  env: BillingEnv;
  capturedAt: number;
  /**
   * When we wrote the referral onto the Stripe customer. This is the conversion
   * boundary: before it, a newer click replaces the referral (Rewardful is
   * last-touch); after it, the customer belongs to that affiliate and the record
   * is frozen.
   */
  stampedAt: number | null;
}

function db() {
  ensureAdmin();
  return getFirestore();
}

function toRecord(raw: unknown): AttributionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.referral !== "string" || !d.referral) return null;
  return {
    referral: d.referral,
    affiliateId: typeof d.affiliateId === "string" ? d.affiliateId : null,
    affiliateName: typeof d.affiliateName === "string" ? d.affiliateName : null,
    campaignId: typeof d.campaignId === "string" ? d.campaignId : null,
    campaignName: typeof d.campaignName === "string" ? d.campaignName : null,
    env: d.env === "live" ? "live" : "sandbox",
    capturedAt: typeof d.capturedAt === "number" ? d.capturedAt : 0,
    stampedAt: typeof d.stampedAt === "number" ? d.stampedAt : null,
  };
}

export async function readAttribution(uid: string): Promise<AttributionRecord | null> {
  const snap = await db().doc(`users/${uid}`).get();
  return snap.exists ? toRecord(snap.get("affiliate")) : null;
}

/** Replace the attribution block (pre-conversion only — see `stampedAt`). */
export async function writeAttribution(uid: string, record: AttributionRecord): Promise<void> {
  await db().doc(`users/${uid}`).set({ affiliate: record }, { merge: true });
}

/**
 * Freeze the record at the moment the referral reaches the Stripe customer.
 * Guarded on the referral it was written for, so a concurrent re-capture can't
 * leave us marked as having stamped something else.
 */
export async function markAttributionStamped(uid: string, referral: string): Promise<void> {
  const ref = db().doc(`users/${uid}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? toRecord(snap.get("affiliate")) : null;
    if (!current || current.referral !== referral || current.stampedAt) return;
    tx.set(ref, { affiliate: { ...current, stampedAt: Date.now() } }, { merge: true });
  });
}
