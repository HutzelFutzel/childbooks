/**
 * Client access to the user's Stripe subscriptions, mirrored read-only from
 * `users/{uid}/subscriptions` (written by the backend from Stripe webhooks). Used
 * to show the current plan + a "Manage subscription" entry point.
 */
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../lib/firebase";

/** Stripe statuses that mean the subscription is currently providing benefits. */
export const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface UserSubscription {
  id: string;
  status: string;
  priceId: string | null;
  productId: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  amount: number | null;
  currency: string | null;
  updatedAt: number | null;
}

function toMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

function map(id: string, d: Record<string, unknown>): UserSubscription {
  return {
    id: typeof d.id === "string" ? d.id : id,
    status: typeof d.status === "string" ? d.status : "incomplete",
    priceId: typeof d.priceId === "string" ? d.priceId : null,
    productId: typeof d.productId === "string" ? d.productId : null,
    currentPeriodEnd: typeof d.currentPeriodEnd === "number" ? d.currentPeriodEnd : null,
    cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
    amount: typeof d.amount === "number" ? d.amount : null,
    currency: typeof d.currency === "string" ? d.currency : null,
    updatedAt: toMs(d.updatedAt),
  };
}

/** Subscribe to the signed-in user's subscriptions, newest-updated first. */
export function subscribeUserSubscriptions(cb: (subs: UserSubscription[]) => void): Unsubscribe {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    cb([]);
    return () => {};
  }
  const col = collection(getFirebaseDb(), `users/${uid}/subscriptions`);
  return onSnapshot(
    col,
    (snap) => {
      const list = snap.docs.map((doc) => map(doc.id, doc.data() as Record<string, unknown>));
      list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      cb(list);
    },
    () => cb([]),
  );
}

/** The user's current benefit-providing subscription, if any. */
export function activeSubscription(subs: UserSubscription[]): UserSubscription | null {
  return subs.find((s) => ACTIVE_SUB_STATUSES.has(s.status)) ?? null;
}
