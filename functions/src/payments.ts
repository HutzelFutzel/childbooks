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
import { toUsd } from "./finance";
import { normalizeCountry, UNKNOWN_COUNTRY } from "../../books-frontend/src/core/analytics/markets";

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
 * How far a PAID print order has got towards the print provider — the one part
 * of fulfillment the customer can see.
 *
 * Placement happens in a webhook and can fail after the money is taken, so
 * "paid" alone is not enough to tell somebody what's happening to their book.
 * `retrying` is deliberately distinct from `failed`: the sweep is still working
 * on it and there is nothing for the customer to do yet.
 */
export type FulfillmentState = "pending" | "placed" | "retrying" | "failed";

/**
 * What the webhook needs to deliver a purchased ebook AFTER payment: where the
 * already-uploaded PDF lives plus the project it belongs to. Stored on the
 * admin payment doc only; once the payment settles the buyer gets a
 * `users/{uid}/downloads/{projectId}` entitlement and fetches the file through
 * the gated download-link endpoint (the location stays off the client doc).
 */
export interface EbookFulfillment {
  projectId: string;
  title: string;
  /**
   * Storage OBJECT PATH of the PDF. The download link is rebuilt from this on
   * every request (`publicUrlForPath`), which is what keeps an entitlement
   * valid across a bucket or host change and keeps the link revocable — delete
   * the object's download token and every previously handed-out URL dies.
   */
  filePath?: string;
  /**
   * Absolute download URL, as written by ebook payments made BEFORE `filePath`
   * existed. Read-only fallback: never set on new payments, because a stored
   * absolute URL outlives the hostname it was built from.
   */
  fileUrl?: string;
  /**
   * Content fingerprint (see `core/print/fingerprint`) the PDF was rendered
   * from, if known. Carried onto the download entitlement at delivery time so
   * a later visit can tell whether the book's design has moved on since this
   * copy was made — without it, an owned ebook can only ever be re-served,
   * never refreshed.
   */
  fingerprint?: string | null;
}

/**
 * The plan needed to fulfill an order AFTER payment. Built at checkout (assets
 * already uploaded → hosted URLs), persisted on the admin payment doc, and read
 * by the webhook to place the print order. No binary blobs (URLs only).
 */
export interface FulfillmentPlan {
  /**
   * The provider package id that actually prints — the format's base SKU with
   * the customer's variant composed in. Lookup of the catalog product uses
   * trim+binding equality against this, not string equality.
   */
  productSku: string;
  /**
   * Domain variant the customer chose (`premium-colour` / …). Optional on
   * orders placed before variants existed; derive from `productSku` when absent.
   */
  variant?: { print: string; paper: string; finish: string } | null;
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
  /**
   * The CONFIGURED cost estimate captured at checkout time (from the product's
   * cost table / live shipping quote via `computeMargin`). Stamped here so the
   * finance stream can compare "what the admin thinks it costs" against what
   * the print provider actually charges — the drift signal that keeps the cost
   * table (and with it the discount planner's numbers) honest.
   */
  estimatedCost?: {
    /** production + shipping, in `currency`. */
    amount: number;
    production: number;
    shipping: number;
    currency: string;
    /** Whether the shipping part came from a live provider quote or the table. */
    shippingSource: "live" | "table";
    /**
     * Whether the production part came from a live provider quote or the table.
     * Optional: orders placed before this was recorded have no value.
     */
    productionSource?: "live" | "table";
  } | null;
}

export interface CreatePendingPaymentArgs {
  paymentId: string;
  uid: string;
  kind: PaymentKind;
  /** Major-unit amount (e.g. 24.99), best-effort estimate before Stripe confirms. */
  amount: number;
  currency: string;
  description: string;
  /** Null for zero-amount grants (e.g. plan-included ebooks) with no Stripe session. */
  stripeSessionId: string | null;
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
    // Only print orders have a fulfillment leg to report on; for everything else
    // "paid" is the whole story and an always-pending field would just confuse.
    ...(args.kind === "order"
      ? { fulfillmentState: "pending" as FulfillmentState, fulfillmentIssue: null }
      : {}),
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
 *
 * Also mirrors a NEUTRAL state onto the buyer's own copy. The raw `error` is a
 * provider diagnosis and stays admin-side; the customer gets a state and, once
 * retries are spent, a message they can act on. Before this, a paid order whose
 * placement failed looked identical to one on its way to the press.
 */
export async function markFulfillmentFailed(args: {
  paymentId: string;
  uid: string;
  error: string;
  /** True once the retry budget is spent — the customer needs to hear from us. */
  exhausted: boolean;
}): Promise<void> {
  const now = Date.now();
  await Promise.all([
    db()
      .doc(`payments/${args.paymentId}`)
      .set(
        {
          fulfillmentAttempts: FieldValue.increment(1),
          fulfillmentFailedAt: now,
          lastFulfillmentError: args.error.slice(0, 1000),
          fulfillmentClaimedAt: FieldValue.delete(),
          fulfillmentState: args.exhausted ? "failed" : "retrying",
          events: FieldValue.arrayUnion({ at: now, type: "fulfillment.failed" }),
        },
        { merge: true },
      ),
    args.uid
      ? db()
          .doc(`users/${args.uid}/payments/${args.paymentId}`)
          .set(
            {
              fulfillmentState: args.exhausted ? "failed" : "retrying",
              fulfillmentIssue: args.exhausted
                ? "We couldn't send this book to the press. Our team is on it — " +
                  "we'll email you, and you won't be charged twice."
                : null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
      : Promise.resolve(),
  ]);
}

/**
 * The provider ACCEPTED a print job and then rejected it — bad print file, a
 * destination it won't serve, a package it won't make. The customer has paid and
 * nothing is being printed.
 *
 * This is a different shape of failure from {@link markFulfillmentFailed}: there
 * the order never reached the provider, so the retry sweep could simply try
 * again. Here a job id exists and `orderId` is set, which is precisely what the
 * sweep (and {@link claimFulfillment}) treat as "done" — so a rejection was
 * terminal and, worse, silent. Moving the dead job id aside re-arms the same
 * bounded machinery instead of inventing a parallel one.
 *
 * The rejected order document is left intact: it's what happened, and support
 * needs it. `supersededOrderIds` keeps the trail.
 */
export async function markFulfillmentRejected(args: {
  paymentId: string;
  uid: string;
  /** The provider job that was rejected. */
  orderId: string;
  /** The provider's reason (admin-only; the customer gets neutral wording). */
  reason: string;
  /**
   * Whether to re-arm the retry sweep. False for failures a retry can't fix, or
   * where we can't be sure nothing was produced — those wait for a human.
   */
  replace: boolean;
  /** True once the retry budget is spent. */
  exhausted: boolean;
}): Promise<void> {
  const now = Date.now();
  const state: FulfillmentState = args.exhausted || !args.replace ? "failed" : "retrying";
  const adminPatch: Record<string, unknown> = {
    fulfillmentState: state,
    lastFulfillmentError: args.reason.slice(0, 1000),
    rejectedOrderIds: FieldValue.arrayUnion(args.orderId),
    events: FieldValue.arrayUnion({ at: now, type: "fulfillment.rejected" }),
  };
  if (args.replace && !args.exhausted) {
    adminPatch.fulfillmentAttempts = FieldValue.increment(1);
    adminPatch.fulfillmentFailedAt = now;
    // Both of these are "already fulfilled" signals. Clearing them is what lets
    // the sweep pick this payment up again; `rejectedOrderIds` above preserves
    // the link to the job that died.
    adminPatch.orderId = FieldValue.delete();
    adminPatch.fulfillmentClaimedAt = FieldValue.delete();
    adminPatch.supersededOrderIds = FieldValue.arrayUnion(args.orderId);
  }

  await Promise.all([
    db().doc(`payments/${args.paymentId}`).set(adminPatch, { merge: true }),
    args.uid
      ? db()
          .doc(`users/${args.uid}/payments/${args.paymentId}`)
          .set(
            {
              fulfillmentState: state,
              // Never the provider's words — they name our supplier and mean
              // nothing to a customer. What they need is what we're doing about it.
              fulfillmentIssue:
                state === "retrying"
                  ? "The press couldn't accept this book on the first try. We're sending it " +
                    "again automatically — nothing for you to do, and you won't be charged twice."
                  : "The press couldn't accept this book. Our team has been alerted and will " +
                    "be in touch about a reprint or a refund. You won't be charged twice.",
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
      : Promise.resolve(),
  ]);
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
  /**
   * ISO-3166 alpha-2 billing market, resolved from the settled charge. Kept on
   * the admin record only (the buyer's own copy has no need for it) so the
   * payments analytics can be sliced per market without re-reading Stripe.
   */
  billingCountry?: string | null;
  /** Mirrored to the buyer's copy so they can see where their order stands. */
  fulfillmentState?: FulfillmentState;
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
  if (args.fulfillmentState !== undefined) {
    userPatch.fulfillmentState = args.fulfillmentState;
    // Reaching a good state clears whatever the last failure told the customer.
    if (args.fulfillmentState === "placed" || args.fulfillmentState === "pending") {
      userPatch.fulfillmentIssue = null;
    }
  }

  const adminPatch: Record<string, unknown> = { ...userPatch };
  if (args.stripePaymentIntentId !== undefined) adminPatch.stripePaymentIntentId = args.stripePaymentIntentId;
  if (args.stripeChargeId !== undefined) adminPatch.stripeChargeId = args.stripeChargeId;
  if (args.stripeCustomerId !== undefined) adminPatch.stripeCustomerId = args.stripeCustomerId;
  if (args.feeAmount !== undefined) adminPatch.feeAmount = args.feeAmount;
  if (args.netAmount !== undefined) adminPatch.netAmount = args.netAmount;
  if (args.billingCountry) adminPatch.billingCountry = args.billingCountry;
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
  /** Billing market, or the shipping destination when billing is unknown. */
  country: string | null;
}

function tsToMs(v: unknown): number | null {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function toListItem(id: string, d: Record<string, unknown>): PaymentListItem {
  const plan = d.fulfillment as { destinationCountry?: unknown } | null;
  return {
    id,
    // Billing first (who paid), destination as a fallback so pre-capture
    // orders still land in a market rather than in "unknown".
    country:
      normalizeCountry(d.billingCountry) ?? normalizeCountry(plan?.destinationCountry) ?? null,
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

/**
 * List payments for the admin dashboard, newest first, within an optional
 * window. `country` filters in memory (the field is derived from billing OR
 * shipping, so it isn't a single indexable field) — which means the display cap
 * must be applied AFTER filtering, or a market's list would be truncated by
 * payments from other markets.
 */
export async function listPayments(opts: {
  sinceMs?: number;
  limit?: number;
  country?: string | null;
}): Promise<PaymentListItem[]> {
  const limit = Math.min(opts.limit ?? 200, 500);
  let q: Query = db().collection("payments").orderBy("createdAt", "desc");
  if (opts.sinceMs) {
    q = db()
      .collection("payments")
      .where("createdAt", ">=", new Date(opts.sinceMs))
      .orderBy("createdAt", "desc");
  }
  // Over-fetch when filtering so the cap bounds the RESULT, not the candidates.
  q = q.limit(opts.country ? Math.min(limit * 10, MAX_PAYMENT_SCAN) : limit);
  const snap = await q.get();
  const items = snap.docs.map((doc) => toListItem(doc.id, doc.data() as Record<string, unknown>));
  const filtered = opts.country
    ? items.filter((p) => (p.country ?? UNKNOWN_COUNTRY) === opts.country)
    : items;
  return filtered.slice(0, limit);
}

/**
 * Cap for whole-window payment scans (analytics, not display). Well above the
 * display cap so a market's aggregates are computed from every payment in the
 * window rather than from whatever happened to fit in the first page.
 */
const MAX_PAYMENT_SCAN = 20_000;

/** Every payment in `[sinceMs, now]`, paged, up to {@link MAX_PAYMENT_SCAN}. */
async function scanPaymentsSince(
  sinceMs: number,
): Promise<{ items: PaymentListItem[]; capped: boolean }> {
  const items: PaymentListItem[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const PAGE = 1_000;
  for (;;) {
    let q: Query = db()
      .collection("payments")
      .where("createdAt", ">=", new Date(sinceMs))
      .orderBy("createdAt", "desc")
      .limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      items.push(toListItem(doc.id, doc.data() as Record<string, unknown>));
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (items.length >= MAX_PAYMENT_SCAN) return { items, capped: true };
    if (snap.size < PAGE) break;
  }
  return { items, capped: false };
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
  /**
   * Per-market rollup. Reported in USD (unlike {@link byCurrency}) because a
   * market comparison is only meaningful on one scale — a market's currency is
   * a property OF the market, so per-currency splitting would defeat the point.
   */
  byCountry: {
    country: string;
    grossUsd: number;
    netUsd: number;
    refundsUsd: number;
    paidCount: number;
    orderCount: number;
    averageOrderUsd: number;
    /** Share of paid checkouts that were refunded. */
    refundRatePct: number;
  }[];
  /** The market filter this report was computed under, if any. */
  country: string | null;
  /** True when the window held more payments than one scan covers. */
  capped: boolean;
  totalPayments: number;
  pendingCount: number;
  failedCount: number;
}

/** Aggregate payments in a rolling window for the admin "Payments" analysis tab. */
export async function paymentsAnalytics(
  windowDays: number,
  country?: string | null,
): Promise<PaymentsAnalytics> {
  const sinceMs = Date.now() - windowDays * 86_400_000;
  // A full windowed scan, not the display page: aggregating the first 500 rows
  // would silently under-report every total, and filtering that page by market
  // would under-report it again.
  const { items: all, capped } = await scanPaymentsSince(sinceMs);
  const items = country ? all.filter((p) => (p.country ?? UNKNOWN_COUNTRY) === country) : all;

  const byCountry = new Map<
    string,
    { grossUsd: number; feesUsd: number; refundsUsd: number; paidCount: number; orderCount: number; refundCount: number }
  >();
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
    const market = p.country ?? "ZZ";
    const cn = byCountry.get(market) ?? {
      grossUsd: 0,
      feesUsd: 0,
      refundsUsd: 0,
      paidCount: 0,
      orderCount: 0,
      refundCount: 0,
    };
    bucket.orderCount += 1;
    cn.orderCount += 1;
    if (p.status === "pending") pendingCount += 1;
    if (p.status === "failed") failedCount += 1;
    const isPaidLike = p.status === "paid" || p.status === "refunded" || p.status === "partially_refunded";
    if (isPaidLike) {
      bucket.paidCount += 1;
      bucket.grossVolume += p.amount;
      bucket.fees += p.feeAmount ?? 0;
      cn.paidCount += 1;
      cn.grossUsd += await toUsd(p.amount, cur);
      cn.feesUsd += p.feeAmount ? await toUsd(p.feeAmount, cur) : 0;
      if (p.refundedAmount > 0) {
        bucket.refunds += p.refundedAmount;
        bucket.refundCount += 1;
        cn.refundsUsd += await toUsd(p.refundedAmount, cur);
        cn.refundCount += 1;
      }
      const day = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "unknown";
      const key = `${day}|${cur}`;
      const s = seriesMap.get(key) ?? { gross: 0, count: 0 };
      s.gross += p.amount;
      s.count += 1;
      seriesMap.set(key, s);
    }
    byCurrency.set(cur, bucket);
    byCountry.set(market, cn);
  }

  return {
    windowDays,
    country: country ?? null,
    capped,
    byCountry: [...byCountry.entries()]
      .map(([market, c]) => ({
        country: market,
        grossUsd: round2(c.grossUsd),
        netUsd: round2(c.grossUsd - c.feesUsd - c.refundsUsd),
        refundsUsd: round2(c.refundsUsd),
        paidCount: c.paidCount,
        orderCount: c.orderCount,
        averageOrderUsd: c.paidCount > 0 ? round2(c.grossUsd / c.paidCount) : 0,
        refundRatePct:
          c.paidCount > 0 ? Math.round((c.refundCount / c.paidCount) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.grossUsd - a.grossUsd),
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
