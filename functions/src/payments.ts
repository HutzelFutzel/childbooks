/**
 * Payment persistence — the source of truth for Stripe payments + subscriptions.
 *
 * Mirrors the dual-record pattern used for orders:
 *   - `payments/{paymentId}` — ADMIN/internal record. Denied to clients; holds the
 *     Stripe ids, the buyer uid, the fulfillment plan (so the webhook can place the
 *     print order AFTER payment), fees/net, and the raw event trail.
 *   - `users/{uid}/payments/{paymentId}` — NEUTRAL, user-facing record (readable by
 *     its owner via `users/{uid}/**`). Powers the in-app receipts/history. No
 *     provider identity, no fulfillment internals.
 *
 * Subscriptions follow the same split under `subscriptions/{id}` +
 * `users/{uid}/subscriptions/{id}`.
 *
 * `paymentId` is our OWN id (a uuid), stable across the session → payment_intent →
 * charge lifecycle, so every webhook can find the record by the `paymentId` we
 * stamp into Checkout Session metadata.
 */
import { getFirestore, FieldValue, type Query } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Recursively drop `undefined` (Firestore rejects it). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export type PaymentStatus =
  | "pending" // session created, not yet paid
  | "paid" // funds captured
  | "failed" // payment failed / session expired
  | "refunded" // fully refunded
  | "partially_refunded"; // partial refund

export type PaymentKind = "order" | "subscription" | "sparkPack" | "sparkGift" | "ebook";

/**
 * What the webhook needs to deliver a purchased ebook AFTER payment: the
 * already-uploaded PDF's token URL plus the project it belongs to. Stored on
 * the admin payment doc only; the buyer gets the URL via `users/{uid}/ebooks`
 * once the payment settles.
 */
export interface EbookFulfillment {
  projectId: string;
  title: string;
  fileUrl: string;
}

/**
 * The plan needed to fulfill an order AFTER payment. Built at checkout (assets
 * already uploaded → hosted URLs), persisted on the admin payment doc, and read
 * by the webhook to place the print order. No binary blobs (URLs only).
 */
export interface FulfillmentPlan {
  productSku: string;
  copies: number;
  shippingMethod: string;
  destinationCountry: string;
  currency: string;
  pageCount: number;
  merchantReference?: string | null;
  recipient: {
    name: string;
    email?: string | null;
    phoneNumber?: string | null;
    address: {
      line1: string;
      line2?: string | null;
      townOrCity: string;
      stateOrCounty?: string | null;
      postalOrZipCode: string;
      countryCode: string;
    };
  };
  /** Public URLs of the already-uploaded print-ready files. */
  sourceFileUrls: { interior?: string; cover?: string };
}

export interface CreatePendingPaymentArgs {
  paymentId: string;
  uid: string;
  kind: PaymentKind;
  /** Major-unit amount (e.g. 24.99), best-effort estimate before Stripe confirms. */
  amount: number;
  currency: string;
  description: string;
  stripeSessionId: string;
  stripeCustomerId?: string | null;
  /** Present for `order` payments — drives fulfillment after payment. */
  fulfillment?: FulfillmentPlan | null;
  /** Present for `ebook` payments — drives digital delivery after payment. */
  ebook?: EbookFulfillment | null;
  /** Free-form item summary for admin/user display. */
  items?: { label: string; amount: number; quantity: number }[];
}

/** Write the pending admin + user records for a freshly-created Checkout Session. */
export async function createPendingPayment(args: CreatePendingPaymentArgs): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const currency = args.currency.toUpperCase();

  const userDoc = stripUndefined({
    id: args.paymentId,
    kind: args.kind,
    status: "pending" as PaymentStatus,
    amount: args.amount,
    currency,
    description: args.description,
    items: args.items ?? [],
    receiptUrl: null,
    refundedAmount: 0,
    orderId: null,
    createdAt: now,
    updatedAt: now,
  });

  const adminDoc = stripUndefined({
    ...userDoc,
    ownerUid: args.uid,
    stripeSessionId: args.stripeSessionId,
    stripeCustomerId: args.stripeCustomerId ?? null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    feeAmount: null,
    netAmount: null,
    fulfillment: args.fulfillment ?? null,
    ebook: args.ebook ?? null,
    events: [{ at: Date.now(), type: "checkout.created" }],
  });

  await Promise.all([
    db().doc(`payments/${args.paymentId}`).set(adminDoc, { merge: true }),
    db().doc(`users/${args.uid}/payments/${args.paymentId}`).set(userDoc, { merge: true }),
  ]);
}

export interface AdminPaymentRecord {
  id: string;
  ownerUid: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amount: number;
  currency: string;
  feeAmount: number | null;
  refundedAmount: number;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  orderId: string | null;
  fulfillment: FulfillmentPlan | null;
  ebook: EbookFulfillment | null;
  /** Retry bookkeeping for paid orders whose print placement failed. */
  fulfillmentAttempts: number;
  fulfillmentFailedAt: number | null;
}

/** Fetch the admin payment record (with the fulfillment plan) by our id. */
export async function getAdminPayment(paymentId: string): Promise<AdminPaymentRecord | null> {
  const snap = await db().doc(`payments/${paymentId}`).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    id: paymentId,
    ownerUid: (d.ownerUid as string) ?? "",
    kind: (d.kind as PaymentKind) ?? "order",
    status: (d.status as PaymentStatus) ?? "pending",
    amount: (d.amount as number) ?? 0,
    currency: (d.currency as string) ?? "USD",
    feeAmount: (d.feeAmount as number) ?? null,
    refundedAmount: (d.refundedAmount as number) ?? 0,
    stripePaymentIntentId: (d.stripePaymentIntentId as string) ?? null,
    stripeChargeId: (d.stripeChargeId as string) ?? null,
    stripeCustomerId: (d.stripeCustomerId as string) ?? null,
    orderId: (d.orderId as string) ?? null,
    fulfillment: (d.fulfillment as FulfillmentPlan) ?? null,
    ebook: (d.ebook as EbookFulfillment) ?? null,
    fulfillmentAttempts: (d.fulfillmentAttempts as number) ?? 0,
    fulfillmentFailedAt: (d.fulfillmentFailedAt as number) ?? null,
  };
}

/**
 * Record a failed fulfillment attempt on the admin payment doc (retry state).
 * Clears the fulfillment claim so the scheduled retry can claim it again.
 */
export async function markFulfillmentFailed(paymentId: string, error: string): Promise<void> {
  await db()
    .doc(`payments/${paymentId}`)
    .set(
      {
        fulfillmentAttempts: FieldValue.increment(1),
        fulfillmentFailedAt: Date.now(),
        lastFulfillmentError: error.slice(0, 1000),
        fulfillmentClaimedAt: FieldValue.delete(),
        events: FieldValue.arrayUnion({ at: Date.now(), type: "fulfillment.failed" }),
      },
      { merge: true },
    );
}

/**
 * Paid payments whose print order still isn't placed after a failure — the
 * scheduled retry sweep works through these (bounded attempts).
 */
export async function listFailedFulfillments(maxAttempts: number): Promise<AdminPaymentRecord[]> {
  // Single-field range query (no composite index); status filtered in memory.
  const q = await db()
    .collection("payments")
    .where("fulfillmentFailedAt", ">", 0)
    .limit(100)
    .get();
  const out: AdminPaymentRecord[] = [];
  for (const doc of q.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.orderId) continue;
    if ((d.status as string) !== "paid") continue;
    const attempts = (d.fulfillmentAttempts as number) ?? 0;
    if (attempts >= maxAttempts) continue;
    const rec = await getAdminPayment(doc.id);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Whether the user has a PAID print order for a given project (matched via the
 * fulfillment plan's merchantReference). Drives the ebook print-bundle
 * discount. Single equality filter + in-memory refinement (no composite index).
 */
export async function hasPaidPrintOrder(uid: string, projectId: string): Promise<boolean> {
  const q = await db()
    .collection("payments")
    .where("ownerUid", "==", uid)
    .limit(300)
    .get();
  return q.docs.some((doc) => {
    const d = doc.data() as Record<string, unknown>;
    if ((d.kind as string) !== "order") return false;
    const status = d.status as string;
    if (status !== "paid" && status !== "partially_refunded") return false;
    const plan = d.fulfillment as { merchantReference?: string | null } | null;
    return plan?.merchantReference === projectId;
  });
}

/** Resolve our paymentId from a Stripe PaymentIntent or Charge id (webhook lookups). */
export async function findPaymentIdByStripeId(
  field: "stripePaymentIntentId" | "stripeSessionId" | "stripeChargeId",
  value: string,
): Promise<string | null> {
  const q = await db().collection("payments").where(field, "==", value).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

export interface UpdatePaymentArgs {
  paymentId: string;
  uid: string;
  status?: PaymentStatus;
  amount?: number;
  currency?: string;
  receiptUrl?: string | null;
  refundedAmount?: number;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeCustomerId?: string;
  feeAmount?: number | null;
  netAmount?: number | null;
  orderId?: string;
  event?: string;
}

/** Patch both the admin + user records and append an event marker (admin only). */
export async function updatePayment(args: UpdatePaymentArgs): Promise<void> {
  const userPatch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (args.status !== undefined) userPatch.status = args.status;
  if (args.amount !== undefined) userPatch.amount = args.amount;
  if (args.currency !== undefined) userPatch.currency = args.currency.toUpperCase();
  if (args.receiptUrl !== undefined) userPatch.receiptUrl = args.receiptUrl;
  if (args.refundedAmount !== undefined) userPatch.refundedAmount = args.refundedAmount;
  if (args.orderId !== undefined) userPatch.orderId = args.orderId;

  const adminPatch: Record<string, unknown> = { ...userPatch };
  if (args.stripePaymentIntentId !== undefined) adminPatch.stripePaymentIntentId = args.stripePaymentIntentId;
  if (args.stripeChargeId !== undefined) adminPatch.stripeChargeId = args.stripeChargeId;
  if (args.stripeCustomerId !== undefined) adminPatch.stripeCustomerId = args.stripeCustomerId;
  if (args.feeAmount !== undefined) adminPatch.feeAmount = args.feeAmount;
  if (args.netAmount !== undefined) adminPatch.netAmount = args.netAmount;
  if (args.event) adminPatch.events = FieldValue.arrayUnion({ at: Date.now(), type: args.event });

  await Promise.all([
    db().doc(`payments/${args.paymentId}`).set(stripUndefined(adminPatch), { merge: true }),
    db().doc(`users/${args.uid}/payments/${args.paymentId}`).set(stripUndefined(userPatch), { merge: true }),
  ]);
}

// ---- Admin listing + analytics ---------------------------------------------

export interface PaymentListItem {
  id: string;
  ownerUid: string;
  status: PaymentStatus;
  kind: PaymentKind;
  amount: number;
  currency: string;
  refundedAmount: number;
  feeAmount: number | null;
  netAmount: number | null;
  description: string;
  receiptUrl: string | null;
  orderId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: number | null;
}

function tsToMs(v: unknown): number | null {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function toListItem(id: string, d: Record<string, unknown>): PaymentListItem {
  return {
    id,
    ownerUid: (d.ownerUid as string) ?? "",
    status: (d.status as PaymentStatus) ?? "pending",
    kind: (d.kind as PaymentKind) ?? "order",
    amount: (d.amount as number) ?? 0,
    currency: (d.currency as string) ?? "USD",
    refundedAmount: (d.refundedAmount as number) ?? 0,
    feeAmount: (d.feeAmount as number) ?? null,
    netAmount: (d.netAmount as number) ?? null,
    description: (d.description as string) ?? "",
    receiptUrl: (d.receiptUrl as string) ?? null,
    orderId: (d.orderId as string) ?? null,
    stripePaymentIntentId: (d.stripePaymentIntentId as string) ?? null,
    createdAt: tsToMs(d.createdAt),
  };
}

/** List payments for the admin dashboard, newest first, within an optional window. */
export async function listPayments(opts: {
  sinceMs?: number;
  limit?: number;
}): Promise<PaymentListItem[]> {
  let q: Query = db().collection("payments").orderBy("createdAt", "desc");
  if (opts.sinceMs) {
    q = db()
      .collection("payments")
      .where("createdAt", ">=", new Date(opts.sinceMs))
      .orderBy("createdAt", "desc");
  }
  q = q.limit(Math.min(opts.limit ?? 200, 500));
  const snap = await q.get();
  return snap.docs.map((doc) => toListItem(doc.id, doc.data() as Record<string, unknown>));
}

export interface PaymentsAnalytics {
  windowDays: number;
  /** Per-currency rollups (we don't FX-convert; admin sees real currencies). */
  byCurrency: {
    currency: string;
    grossVolume: number; // sum of paid amounts
    netVolume: number; // gross − fees − refunds
    fees: number;
    refunds: number;
    orderCount: number;
    paidCount: number;
    refundCount: number;
    averageOrderValue: number;
  }[];
  /** Daily gross volume time series (base buckets), per currency. */
  series: { date: string; currency: string; gross: number; count: number }[];
  totalPayments: number;
  pendingCount: number;
  failedCount: number;
}

/** Aggregate payments in a rolling window for the admin "Payments" analysis tab. */
export async function paymentsAnalytics(windowDays: number): Promise<PaymentsAnalytics> {
  const sinceMs = Date.now() - windowDays * 86_400_000;
  const items = await listPayments({ sinceMs, limit: 500 });

  const byCurrency = new Map<
    string,
    {
      grossVolume: number;
      fees: number;
      refunds: number;
      orderCount: number;
      paidCount: number;
      refundCount: number;
    }
  >();
  const seriesMap = new Map<string, { gross: number; count: number }>();
  let pendingCount = 0;
  let failedCount = 0;

  for (const p of items) {
    const cur = p.currency.toUpperCase();
    const bucket = byCurrency.get(cur) ?? {
      grossVolume: 0,
      fees: 0,
      refunds: 0,
      orderCount: 0,
      paidCount: 0,
      refundCount: 0,
    };
    bucket.orderCount += 1;
    if (p.status === "pending") pendingCount += 1;
    if (p.status === "failed") failedCount += 1;
    const isPaidLike = p.status === "paid" || p.status === "refunded" || p.status === "partially_refunded";
    if (isPaidLike) {
      bucket.paidCount += 1;
      bucket.grossVolume += p.amount;
      bucket.fees += p.feeAmount ?? 0;
      if (p.refundedAmount > 0) {
        bucket.refunds += p.refundedAmount;
        bucket.refundCount += 1;
      }
      const day = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "unknown";
      const key = `${day}|${cur}`;
      const s = seriesMap.get(key) ?? { gross: 0, count: 0 };
      s.gross += p.amount;
      s.count += 1;
      seriesMap.set(key, s);
    }
    byCurrency.set(cur, bucket);
  }

  return {
    windowDays,
    byCurrency: [...byCurrency.entries()].map(([currency, b]) => ({
      currency,
      grossVolume: round2(b.grossVolume),
      netVolume: round2(b.grossVolume - b.fees - b.refunds),
      fees: round2(b.fees),
      refunds: round2(b.refunds),
      orderCount: b.orderCount,
      paidCount: b.paidCount,
      refundCount: b.refundCount,
      averageOrderValue: b.paidCount > 0 ? round2(b.grossVolume / b.paidCount) : 0,
    })),
    series: [...seriesMap.entries()]
      .map(([key, s]) => {
        const [date, currency] = key.split("|");
        return { date, currency, gross: round2(s.gross), count: s.count };
      })
      .sort((a, b) => a.date.localeCompare(b.date)),
    totalPayments: items.length,
    pendingCount,
    failedCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Subscriptions ----------------------------------------------------------

export interface SubscriptionUpsert {
  id: string;
  uid: string;
  status: string;
  priceId: string | null;
  productId: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  amount: number | null;
  currency: string | null;
  stripeCustomerId: string | null;
}

/** Upsert the admin + user subscription records from a subscription event. */
export async function upsertSubscription(sub: SubscriptionUpsert): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const userDoc = stripUndefined({
    id: sub.id,
    status: sub.status,
    priceId: sub.priceId,
    productId: sub.productId,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    amount: sub.amount,
    currency: sub.currency ? sub.currency.toUpperCase() : null,
    updatedAt: now,
  });
  const adminDoc = stripUndefined({
    ...userDoc,
    ownerUid: sub.uid,
    stripeCustomerId: sub.stripeCustomerId,
  });
  await Promise.all([
    db().doc(`subscriptions/${sub.id}`).set(adminDoc, { merge: true }),
    sub.uid
      ? db().doc(`users/${sub.uid}/subscriptions/${sub.id}`).set(userDoc, { merge: true })
      : Promise.resolve(),
  ]);
}

/** Look up the buyer uid for a Stripe customer id (set during checkout). */
export async function findUidByCustomerId(customerId: string): Promise<string | null> {
  const q = await db().collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

/** Persist the Stripe customer id on the user's profile (idempotent). */
export async function saveStripeCustomerId(uid: string, customerId: string): Promise<void> {
  await db().doc(`users/${uid}`).set({ stripeCustomerId: customerId }, { merge: true });
}

/** Read a previously-saved Stripe customer id for a user, if any. */
export async function getStripeCustomerId(uid: string): Promise<string | null> {
  const snap = await db().doc(`users/${uid}`).get();
  return snap.exists ? ((snap.get("stripeCustomerId") as string) ?? null) : null;
}

/**
 * Atomically claim the right to fulfill a paid payment, exactly once. Returns
 * true only for the first caller (others — webhook retries, duplicate events —
 * get false and must skip), preventing a paid order from being placed twice.
 */
export async function claimFulfillment(paymentId: string): Promise<boolean> {
  const ref = db().doc(`payments/${paymentId}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const d = snap.data() as Record<string, unknown>;
    if (d.orderId || d.fulfillmentClaimedAt) return false;
    tx.set(ref, { fulfillmentClaimedAt: Date.now() }, { merge: true });
    return true;
  });
}
