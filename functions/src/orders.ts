/**
 * Order persistence — the source of truth for placed print orders.
 *
 * Two records are written per order:
 *   - `users/{uid}/orders/{orderId}` — the NEUTRAL, user-facing record. Readable
 *     by its owner (Firestore rules allow read under `users/{uid}/**`) and used
 *     to power the in-app order history. It deliberately contains NO provider
 *     identity and no raw provider payloads.
 *   - `orders/{orderId}` — the ADMIN/internal record. Denied to all clients (read
 *     only via a `requireAdmin` backend route or the console). Holds the real
 *     provider (e.g. "lulu"), environment, the create request/response and the
 *     full webhook history, for support + debugging.
 *
 * Both are written by the Admin SDK (which bypasses Storage/Firestore rules).
 */
import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { sendOrderFailedEmail, sendOrderShippedEmail } from "./email/triggers";
import { getAdminSettings } from "./adminSettings";
import { raiseAlert } from "./alerts";
import { markFulfillmentRejected } from "./payments";
import { productKey, recordFinanceEvent, toUsd } from "./finance";
import { getProductsConfig } from "./products";
import { normalizeCountry, UNKNOWN_COUNTRY } from "../../books-frontend/src/core/analytics/markets";
import type {
  FulfillmentOrder,
  Money,
  OrderDraft,
} from "../../books-frontend/src/core/fulfillment/types";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Recursively drop `undefined` (Firestore rejects it; we don't enable ignore). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Pull the provider's status name out of a raw payload, if present. */
function statusNameOf(raw: unknown): string | null {
  if (raw && typeof raw === "object") {
    const status = (raw as { status?: { name?: unknown } }).status;
    if (status && typeof status.name === "string") return status.name;
  }
  return null;
}

/** The neutral recipient view shared by both records. */
function neutralRecipient(draft: OrderDraft) {
  return stripUndefined({
    name: draft.recipient.name,
    email: draft.recipient.email ?? null,
    phone: draft.recipient.phoneNumber ?? null,
    address: draft.recipient.address,
  });
}

/** The create request, minus the (large, binary) print assets. */
function sanitizeDraft(draft: OrderDraft) {
  return stripUndefined({
    productSku: draft.productSku,
    copies: draft.copies,
    recipient: neutralRecipient(draft),
    shippingMethod: draft.shippingMethod,
    destinationCountry: draft.destinationCountry,
    currency: draft.currency,
    merchantReference: draft.merchantReference ?? null,
  });
}

export interface PersistCreatedOrderArgs {
  uid: string;
  /** The real provider backing the order (e.g. "lulu") — admin record only. */
  provider: string;
  /** Provider environment ("sandbox" | "live") — admin record only. */
  env: string;
  /** The paying payment id — anchors finance events + webhook cost booking. */
  paymentId?: string | null;
  /** The CONFIGURED cost estimate captured at checkout (calibration baseline). */
  estimatedCost?: {
    amount: number;
    production: number;
    shipping: number;
    currency: string;
    shippingSource: string;
    productionSource?: string;
  } | null;
  draft: OrderDraft;
  order: FulfillmentOrder;
}

/**
 * Write the neutral + admin records for a freshly-created order. Best-effort:
 * the order is already placed with the provider, so callers should not fail the
 * request if persistence throws — just log it.
 */
export async function persistCreatedOrder(args: PersistCreatedOrderArgs): Promise<void> {
  const { uid, provider, env, draft, order } = args;
  const orderId = order.id || `local-${randomUUID()}`;
  const now = FieldValue.serverTimestamp();

  const historyEntry = {
    at: Date.now(),
    stage: order.stage,
    message: order.issues[0] ?? null,
  };

  const userDoc = {
    id: orderId,
    projectId: draft.merchantReference ?? null,
    productSku: draft.productSku,
    copies: draft.copies,
    shippingMethod: draft.shippingMethod,
    recipient: neutralRecipient(draft),
    stage: order.stage,
    statusMessage: order.issues[0] ?? null,
    charges: stripUndefined(order.charges),
    shipments: stripUndefined(order.shipments),
    // The provider's verdict on the shipping address. A correction here means
    // the job may sit awaiting manual confirmation, so it belongs on the
    // customer's own record — not just in the provider's dashboard.
    addressValidation: order.addressValidation ? stripUndefined(order.addressValidation) : null,
    fileUrls: stripUndefined(order.printFiles ?? {}),
    statusHistory: [historyEntry],
    createdAt: now,
    updatedAt: now,
  };

  const adminDoc = {
    ...userDoc,
    ownerUid: uid,
    provider,
    env,
    providerOrderId: order.id || null,
    paymentId: args.paymentId ?? null,
    estimatedCost: args.estimatedCost ? stripUndefined(args.estimatedCost) : null,
    statusName: statusNameOf(order.raw),
    // Hoisted out of `createRequest` so the analytics scans can group by market
    // without reading into the nested provider request payload.
    destinationCountry: normalizeCountry(draft.destinationCountry),
    createRequest: sanitizeDraft(draft),
    createResponse: (order.raw as Record<string, unknown> | undefined) ?? null,
  };

  await Promise.all([
    db().doc(`orders/${orderId}`).set(adminDoc, { merge: true }),
    db().doc(`users/${uid}/orders/${orderId}`).set(userDoc, { merge: true }),
  ]);

  // Book the provider's placement-time charge as COGS (Lulu may also report
  // costs only later, via status webhooks — the same delta booking covers both).
  await bookPrintCostDelta({
    orderId,
    paymentId: args.paymentId ?? null,
    ownerUid: uid,
    projectId: draft.merchantReference ?? null,
    sku: draft.productSku,
    copies: draft.copies,
    destinationCountry: draft.destinationCountry,
    charges: order.charges,
    taxCharged: order.taxCharged,
    estimatedCost: args.estimatedCost ?? null,
  });
}

/**
 * Apply a provider status update (from a webhook) to a persisted order. Looks up
 * the admin record by provider order id to resolve the owner, then updates both
 * the admin and neutral user records and appends a status-history entry.
 *
 * Returns false when the order isn't one we have on record (so the caller can
 * acknowledge but log it).
 */
export async function applyOrderStatusUpdate(order: FulfillmentOrder): Promise<boolean> {
  if (!order.id) return false;
  const adminRef = db().doc(`orders/${order.id}`);
  const snap = await adminRef.get();
  if (!snap.exists) return false;

  const ownerUid = snap.get("ownerUid") as string | undefined;
  // Read before writing: the rejection handling below must fire on the TRANSITION
  // into a dead state, not on every re-post of the same status. Providers repeat
  // webhooks, and re-arming a replacement order each time would print a book per
  // delivery.
  const previousStage = snap.get("stage") as string | undefined;
  const historyEntry = {
    at: Date.now(),
    stage: order.stage,
    message: order.issues[0] ?? null,
  };

  // Fields safe for the neutral, user-facing record.
  const userUpdate = {
    stage: order.stage,
    statusMessage: order.issues[0] ?? null,
    charges: stripUndefined(order.charges),
    shipments: stripUndefined(order.shipments),
    updatedAt: FieldValue.serverTimestamp(),
    statusHistory: FieldValue.arrayUnion(historyEntry),
    // Only written when the provider has something to say: a later webhook
    // carrying no verdict must not erase the one recorded at placement.
    ...(order.addressValidation
      ? { addressValidation: stripUndefined(order.addressValidation) }
      : {}),
  };

  // Admin record additionally keeps the provider status name + raw payload.
  const adminUpdate = {
    ...userUpdate,
    statusName: statusNameOf(order.raw),
    lastWebhookAt: FieldValue.serverTimestamp(),
    lastWebhookRaw: (order.raw as Record<string, unknown> | undefined) ?? null,
  };

  await Promise.all([
    adminRef.set(adminUpdate, { merge: true }),
    ownerUid
      ? db().doc(`users/${ownerUid}/orders/${order.id}`).set(userUpdate, { merge: true })
      : Promise.resolve(),
  ]);

  // Lulu often finalizes (or revises) costs only after file validation, so the
  // ACTUAL charge can first appear — or change — on a status webhook. Book the
  // difference against what's already in the finance stream so `printCost`
  // always reflects what the provider really charges, not the placement quote.
  if (order.charges.length > 0) {
    await bookPrintCostDelta({
      orderId: order.id,
      paymentId: (snap.get("paymentId") as string | undefined) ?? null,
      ownerUid: ownerUid ?? null,
      projectId: (snap.get("projectId") as string | undefined) ?? null,
      sku: (snap.get("productSku") as string | undefined) ?? null,
      copies: (snap.get("copies") as number | undefined) ?? null,
      destinationCountry:
        (snap.get("destinationCountry") as string | undefined) ??
        (snap.get("createRequest.destinationCountry") as string | undefined) ??
        null,
      charges: order.charges,
      taxCharged: order.taxCharged,
      estimatedCost:
        (snap.get("estimatedCost") as { amount: number; currency: string } | undefined) ?? null,
    });
  }

  // The provider took the job and then killed it. The customer has paid and no
  // book is being made — the one status change that must never pass quietly.
  if (order.stage === "error" && previousStage !== "error") {
    await handleRejectedOrder({
      order,
      ownerUid: ownerUid ?? null,
      paymentId: (snap.get("paymentId") as string | undefined) ?? null,
      statusName: statusNameOf(order.raw),
    });
  }

  // Notify the customer when the provider reports the order shipped. Deduped on
  // the order id (the provider may re-post SHIPPED), best-effort — an email
  // failure must never fail the webhook ack.
  if (ownerUid && statusNameOf(order.raw) === "SHIPPED") {
    const shipment = order.shipments.find((s) => s.trackingUrl) ?? order.shipments[0];
    try {
      await sendOrderShippedEmail({
        uid: ownerUid,
        orderRef: order.id,
        carrier: shipment?.carrier ?? null,
        trackingUrl: shipment?.trackingUrl ?? null,
      });
    } catch (err) {
      console.warn("[orders] shipped email failed", order.id, err);
    }
  }
  return true;
}

/**
 * The retry budget a rejected order shares with placement failures. Mirrors
 * `MAX_FULFILLMENT_ATTEMPTS` in `stripe.ts`; kept here to avoid importing the
 * Stripe module (and its secrets) into the webhook path.
 */
const MAX_REPLACEMENT_ATTEMPTS = 5;

/**
 * React to a print job the provider rejected after accepting it.
 *
 * Three things have to happen, and none of them did before: a human is told
 * (money moved, nothing is being printed), the customer's own records stop
 * claiming the book is on its way, and the order is re-placed if a retry could
 * plausibly fix it.
 *
 * Re-placement is deliberately limited to an explicit REJECTED verdict. That
 * status means the provider declined to make the item, so there is no risk of
 * printing a second copy of something already in production — which is exactly
 * the risk a vaguer ERROR carries, so those wait for a person instead.
 *
 * Every step is best-effort: a failure here must not stop the webhook being
 * acknowledged, or the provider will retry the delivery and we'd re-enter this
 * path with the status change already recorded.
 */
async function handleRejectedOrder(args: {
  order: FulfillmentOrder;
  ownerUid: string | null;
  paymentId: string | null;
  statusName: string | null;
}): Promise<void> {
  const { order, ownerUid, paymentId, statusName } = args;
  const reason = order.issues[0] ?? statusName ?? "The print provider rejected this order.";
  const replaceable = (statusName ?? "").toUpperCase() === "REJECTED";

  let attempt = 0;
  let exhausted = false;
  if (paymentId && ownerUid) {
    try {
      const paySnap = await db().doc(`payments/${paymentId}`).get();
      attempt = ((paySnap.get("fulfillmentAttempts") as number | undefined) ?? 0) + 1;
      exhausted = attempt >= MAX_REPLACEMENT_ATTEMPTS;
      await markFulfillmentRejected({
        paymentId,
        uid: ownerUid,
        orderId: order.id,
        reason,
        replace: replaceable,
        exhausted,
      });
    } catch (err) {
      console.error("[orders] could not record rejection on payment", paymentId, err);
    }
  }

  const willRetry = replaceable && !exhausted && Boolean(paymentId && ownerUid);
  try {
    await raiseAlert({
      // A paid order that is never going to arrive unless somebody acts.
      severity: willRetry ? "warning" : "critical",
      kind: "fulfillment.rejected",
      message:
        `Print order ${order.id} was REJECTED by the provider` +
        (paymentId ? ` (payment ${paymentId})` : "") +
        `: ${reason}. ` +
        (willRetry
          ? `Re-placing automatically (attempt ${attempt} of ${MAX_REPLACEMENT_ATTEMPTS}).`
          : "NOT re-placed automatically — needs a reprint or a refund."),
      meta: {
        orderId: order.id,
        paymentId,
        uid: ownerUid,
        statusName,
        attempt,
        autoReplacing: willRetry,
      },
      // Per rejected job, so a re-posted webhook can't spam but a genuine second
      // rejection of a replacement job still surfaces.
      ref: `${order.id}_rejected`,
    });
  } catch (err) {
    console.error("[orders] rejection alert failed", order.id, err);
  }

  // Waste, not COGS: we paid for the render and the customer has nothing.
  try {
    await recordFinanceEvent({
      category: "waste",
      kind: "orderRejected",
      amountUsd: 0,
      uid: ownerUid ?? undefined,
      ref: `${order.id}_rejected`,
      meta: { orderId: order.id, paymentId, statusName, reason: reason.slice(0, 500) },
    });
  } catch (err) {
    console.warn("[orders] rejection finance event failed", order.id, err);
  }

  // Once nothing more will be attempted automatically, tell the customer
  // directly rather than leaving it to whether they revisit the order screen.
  if (ownerUid && !willRetry) {
    try {
      await sendOrderFailedEmail({
        uid: ownerUid,
        orderRef: order.id,
        paymentId: paymentId ?? order.id,
      });
    } catch (err) {
      console.warn("[orders] order_failed email failed", order.id, err);
    }
  }
}

// ---- Print COGS booking (finance stream) ------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The catalog's internal product key for a provider SKU, so the cost line
 * groups with the revenue line for the same product. Falls back to the SKU when
 * the catalog can't be read or the SKU is no longer in it (retired products).
 */
async function printProductKey(sku: string | null): Promise<string | undefined> {
  if (!sku) return undefined;
  try {
    const config = await getProductsConfig();
    const internalId = config.products.find((p) => p.provider.sku === sku)?.id;
    return productKey("print", internalId ?? sku);
  } catch {
    return productKey("print", sku);
  }
}

interface BookPrintCostArgs {
  orderId: string;
  paymentId: string | null;
  ownerUid: string | null;
  projectId: string | null;
  sku: string | null;
  copies: number | null;
  /**
   * Where the order SHIPS. Print COGS is dominated by shipping, so the
   * destination — not the buyer's billing country — is the market this cost
   * belongs to. Booking it here is what makes per-market print margin real.
   */
  destinationCountry?: string | null;
  /** The provider's CURRENT (cumulative) charge for the order. */
  charges: Money[];
  /** Tax portion of `charges`, when the provider breaks it out. */
  taxCharged?: Money;
  estimatedCost?: { amount: number; currency: string } | null;
}

/**
 * Book the provider's charge for an order into the finance stream as
 * `printCost`, using the CUMULATIVE-DELTA pattern (the same one refunds use):
 * the current charge total is compared against what's already been booked for
 * this order, and only the difference is written — keyed on the cumulative
 * level so webhook retries are no-ops. This makes the recorded COGS track what
 * Lulu ACTUALLY charges, covering all three placement-time gaps:
 *   - costs absent at creation → first webhook with costs books the full amount,
 *   - costs revised later (shipping reprice, tax finalization) → delta booked,
 *   - a lowered charge → a positive correction event.
 *
 * When the tax portion is known and the admin reclaims VAT
 * (`adminSettings.ops.reclaimVat`, same preference custom costs use), the
 * NET (excl-tax) figure is booked; otherwise the gross. The configured
 * checkout-time estimate rides along in `meta` for the calibration card.
 * Best-effort: never throws into fulfillment or webhook handling.
 */
export async function bookPrintCostDelta(args: BookPrintCostArgs): Promise<void> {
  try {
    const totalInclTax = round2(
      args.charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
    );
    if (totalInclTax <= 0) return;
    const currency = (args.charges[0]?.currency || "USD").toUpperCase();

    const reclaimVat = (await getAdminSettings()).ops.reclaimVat;
    const tax =
      args.taxCharged && (args.taxCharged.currency || currency).toUpperCase() === currency
        ? Number(args.taxCharged.amount) || 0
        : 0;
    const target = round2(reclaimVat && tax > 0 ? totalInclTax - tax : totalInclTax);
    if (target <= 0) return;

    const orderRef = db().doc(`orders/${args.orderId}`);
    const snap = await orderRef.get();
    const booked = snap.get("financeBookedCost") as
      | { amount?: number; currency?: string }
      | undefined;
    const refBase = args.paymentId || args.orderId;
    let already = typeof booked?.amount === "number" ? booked.amount : null;
    if (already == null) {
      // Orders booked before cumulative tracking existed wrote a single event
      // under `printCost_${paymentId}` — count it so we never double-book.
      const legacy = await db().doc(`financeEvents/printCost_${refBase}`).get();
      already = legacy.exists ? ((legacy.get("amount") as number | undefined) ?? 0) : 0;
    }

    const delta = round2(target - already);
    if (Math.abs(delta) < 0.005) return;

    await recordFinanceEvent({
      category: "books",
      kind: "printCost",
      // delta > 0 ⇒ more cost (negative USD); delta < 0 ⇒ correction back.
      amountUsd: -(await toUsd(delta, currency)),
      uid: args.ownerUid ?? undefined,
      projectId: args.projectId ?? undefined,
      currency,
      amount: delta,
      country: normalizeCountry(args.destinationCountry) ?? undefined,
      productId: await printProductKey(args.sku),
      sku: args.sku ?? undefined,
      // Cumulative-keyed: the same charge level can never book twice.
      ref: `${refBase}_${Math.round(target * 100)}`,
      meta: {
        orderId: args.orderId,
        ...(args.sku ? { sku: args.sku } : {}),
        ...(typeof args.copies === "number" ? { copies: args.copies } : {}),
        cumulativeCost: target,
        grossInclTax: totalInclTax,
        ...(tax > 0 ? { tax: round2(tax), bookedAs: reclaimVat ? "net" : "gross" } : {}),
        ...(args.estimatedCost
          ? {
              estimatedCost: args.estimatedCost.amount,
              estimatedCurrency: args.estimatedCost.currency,
            }
          : {}),
        ...(already > 0 ? { adjustment: true, previouslyBooked: already } : {}),
      },
    });
    await orderRef.set({ financeBookedCost: { amount: target, currency } }, { merge: true });
  } catch (err) {
    console.warn("[orders] print cost booking failed", args.orderId, err);
  }
}

// ---- Configured-vs-actual calibration ----------------------------------------

export interface PrintCalibrationRow {
  sku: string;
  /** Orders where BOTH the configured estimate and an actual charge exist. */
  orders: number;
  /** Sums over those matched orders, in USD. */
  estimatedUsd: number;
  actualUsd: number;
  /** (actual − estimate) / estimate, in %. Null when nothing matched. */
  driftPct: number | null;
  /** Orders with an actual charge but no stored estimate (pre-feature orders). */
  missingEstimate: number;
  /** Orders with an estimate whose provider costs haven't arrived yet. */
  pendingActual: number;
}

/**
 * Cost drift for one SKU shipped to one market. Split out from the per-SKU view
 * because shipping is the dominant term in print COGS: a SKU can be perfectly
 * calibrated at home and badly underpriced across a border, and the blended
 * per-SKU number hides exactly that.
 */
export interface PrintCalibrationMarketRow extends PrintCalibrationRow {
  country: string;
}

export interface PrintCalibrationSummary {
  fromMs: number;
  scanned: number;
  rows: PrintCalibrationRow[];
  /** The same drift, split per shipping destination (ranked by |drift|). */
  byMarket: PrintCalibrationMarketRow[];
}

const CALIBRATION_SCAN_LIMIT = 2_000;

/**
 * Compare the checkout-time CONFIGURED cost estimate against the provider's
 * ACTUAL charge, per SKU, over a trailing window — the drift signal that tells
 * the admin when the product cost table (which drives every margin and
 * safe-discount number in the planner) has fallen out of date.
 */
export async function printCostCalibration(days: number): Promise<PrintCalibrationSummary> {
  const clampedDays = Math.min(Math.max(Math.floor(days) || 90, 1), 365);
  const fromMs = Date.now() - clampedDays * 24 * 60 * 60 * 1000;
  const snap = await db()
    .collection("orders")
    .where("createdAt", ">=", Timestamp.fromMillis(fromMs))
    .orderBy("createdAt", "desc")
    .limit(CALIBRATION_SCAN_LIMIT)
    .get();

  const bySku = new Map<string, PrintCalibrationRow>();
  const byMarket = new Map<string, PrintCalibrationMarketRow>();
  for (const doc of snap.docs) {
    const sku = (doc.get("productSku") as string | undefined) || "unknown";
    const country =
      normalizeCountry(doc.get("destinationCountry")) ??
      normalizeCountry(doc.get("createRequest.destinationCountry")) ??
      UNKNOWN_COUNTRY;
    const row =
      bySku.get(sku) ??
      ({ sku, orders: 0, estimatedUsd: 0, actualUsd: 0, driftPct: null, missingEstimate: 0, pendingActual: 0 } satisfies PrintCalibrationRow);
    const marketKey = `${sku}|${country}`;
    const marketRow =
      byMarket.get(marketKey) ??
      ({ sku, country, orders: 0, estimatedUsd: 0, actualUsd: 0, driftPct: null, missingEstimate: 0, pendingActual: 0 } satisfies PrintCalibrationMarketRow);

    const est = doc.get("estimatedCost") as { amount?: number; currency?: string } | null;
    // Prefer the booked figure (net of reclaimed VAT — the true cost basis);
    // fall back to the raw charge total for orders that predate booking.
    const bookedCost = doc.get("financeBookedCost") as { amount?: number; currency?: string } | null;
    const charges = (doc.get("charges") as { amount?: string; currency?: string }[] | undefined) ?? [];
    const chargeTotal = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const actualAmount = bookedCost?.amount ?? (chargeTotal > 0 ? chargeTotal : 0);
    const actualCurrency = bookedCost?.currency ?? charges[0]?.currency ?? "USD";

    const hasEstimate = typeof est?.amount === "number" && est.amount > 0;
    const hasActual = actualAmount > 0;
    if (hasEstimate && hasActual) {
      const estUsd = await toUsd(est.amount!, est.currency ?? "USD");
      const actUsd = await toUsd(actualAmount, actualCurrency);
      row.orders += 1;
      row.estimatedUsd += estUsd;
      row.actualUsd += actUsd;
      marketRow.orders += 1;
      marketRow.estimatedUsd += estUsd;
      marketRow.actualUsd += actUsd;
    } else if (hasActual) {
      row.missingEstimate += 1;
      marketRow.missingEstimate += 1;
    } else if (hasEstimate) {
      row.pendingActual += 1;
      marketRow.pendingActual += 1;
    }
    bySku.set(sku, row);
    byMarket.set(marketKey, marketRow);
  }

  const withDrift = <T extends PrintCalibrationRow>(r: T): T => ({
    ...r,
    estimatedUsd: round2(r.estimatedUsd),
    actualUsd: round2(r.actualUsd),
    driftPct:
      r.orders > 0 && r.estimatedUsd > 0
        ? Math.round(((r.actualUsd - r.estimatedUsd) / r.estimatedUsd) * 1000) / 10
        : null,
  });

  const rows = [...bySku.values()].map(withDrift);
  rows.sort((a, b) => Math.abs(b.driftPct ?? 0) - Math.abs(a.driftPct ?? 0));
  const markets = [...byMarket.values()]
    .map(withDrift)
    // Single-order rows are noise at the market level — one odd shipping quote
    // shouldn't outrank a consistent bias across a dozen orders.
    .filter((r) => r.orders > 0)
    .sort((a, b) => Math.abs(b.driftPct ?? 0) - Math.abs(a.driftPct ?? 0));
  return { fromMs, scanned: snap.size, rows, byMarket: markets };
}
