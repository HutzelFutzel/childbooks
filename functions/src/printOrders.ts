/**
 * The print-order record — our own, complete picture of every customer order.
 *
 * `printOrders/{paymentId}` holds one document per customer purchase (keyed by the
 * payment id, which exists before the print provider's job does and stays the same
 * across replacement jobs), plus an append-only `events` subcollection:
 *
 *   printOrders/{key}                 current state — see `PrintOrderRecord`
 *   printOrders/{key}/events/{id}     what happened, when, and who/what said so
 *
 * EVERY writer goes through {@link recordOrderEvent}: Stripe fulfillment, the
 * provider webhook, the reconcile poll, email triggers, refunds and admin actions.
 * That single path is what makes the record trustworthy — state and "needs a
 * person" are derived in one place (`core/orders/lifecycle`), inside a
 * transaction, so no two writers can leave it contradicting itself.
 *
 * The legacy `orders/{jobId}` (provider job detail, finance booking) and
 * `users/{uid}/orders/{jobId}` (the customer's history) documents stay as they
 * are; this record sits above them and links to them by job id.
 *
 * Nothing here ever throws into the flow that called it: a payment or a webhook
 * must not fail because bookkeeping did. The watchdog re-derives the record from
 * the payment if a write is lost.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { raiseAlert, resolveAlert } from "./alerts";
import { notifySlack } from "./notify";
import { serverConfig } from "./config";
import type { AdminPaymentRecord } from "./payments";
import {
  ATTENTION_REASON_ACTION,
  ATTENTION_REASON_LABEL,
  applyPatch,
  emptyPrintOrder,
  type AttentionReason,
  type PrintOrderAttention,
  type PrintOrderPatch,
  type PrintOrderRecord,
  type PrintOrderState,
} from "../../books-frontend/src/core/orders/lifecycle";

export const PRINT_ORDERS = "printOrders";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** What produced an update — recorded on every event. */
export type OrderEventSource =
  | "stripe"
  | "fulfillment"
  | "lulu_webhook"
  | "lulu_poll"
  | "email"
  | "watchdog"
  | "backfill"
  | `admin:${string}`;

export type OrderEventType =
  | "paid"
  | "placing"
  | "placement_failed"
  | "placed"
  | "replaced"
  | "provider_status"
  | "rejected"
  | "address_corrected"
  | "refund"
  | "email_sent"
  | "email_failed"
  | "alert_raised"
  | "alert_resolved"
  | "drift"
  | "admin_action"
  | "synced";

export interface OrderEvent {
  id: string;
  at: number;
  type: OrderEventType;
  source: OrderEventSource;
  message: string | null;
  fromState: PrintOrderState | null;
  toState: PrintOrderState | null;
  luluStatus: string | null;
  data: Record<string, unknown> | null;
}

/** The key for an order: the payment id, or a job-derived key for legacy/dev orders. */
export function printOrderKey(paymentId?: string | null, jobId?: string | null): string | null {
  const p = paymentId?.trim();
  if (p) return p;
  const j = jobId?.trim();
  return j ? `job_${j}` : null;
}

/** Drop `undefined` (Firestore rejects it) while keeping `null`. */
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clean(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = clean(v);
    }
    return out as T;
  }
  return value;
}

/** Read a stored document into a total record (older docs may miss newer fields). */
export function normalizeRecord(key: string, data: Record<string, unknown> | undefined, now: number): PrintOrderRecord {
  const base = emptyPrintOrder(key, now);
  if (!data) return base;
  const d = data as Partial<PrintOrderRecord>;
  return {
    ...base,
    ...d,
    key,
    jobIds: Array.isArray(d.jobIds) ? d.jobIds : [],
    shipments: Array.isArray(d.shipments) ? d.shipments : [],
    emails: { ...base.emails, ...(d.emails ?? {}) },
    files: { ...base.files, ...(d.files ?? {}) },
    changeSources: { ...base.changeSources, ...(d.changeSources ?? {}) },
    refundedAmount: typeof d.refundedAmount === "number" ? d.refundedAmount : 0,
    attempts: typeof d.attempts === "number" ? d.attempts : 0,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : now,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : now,
  };
}

export interface RecordOrderEventArgs {
  key: string;
  type: OrderEventType;
  source: OrderEventSource;
  message?: string | null;
  patch?: PrintOrderPatch;
  /** Small, JSON-safe context stored on the event (never the full provider payload). */
  data?: Record<string, unknown> | null;
  /**
   * Write the event only when the state or provider status actually moved. A poll
   * that finds nothing new still refreshes `lastSyncAt` on the record, but leaves
   * no event behind — which is what keeps a 15-minute sweep from burying the
   * timeline (the old `statusHistory` array grew on every poll).
   */
  onlyIfChanged?: boolean;
  /** Idempotency: the event id. A repeated call with the same id writes nothing new. */
  dedupeId?: string;
  /** Skip the Slack/alert side effects (the watchdog batches its own). */
  silent?: boolean;
}

export interface RecordOrderEventResult {
  record: PrintOrderRecord;
  previous: PrintOrderRecord | null;
  /** Attention that began with THIS write. */
  raised: PrintOrderAttention | null;
  /** Attention that ended with THIS write. */
  resolved: PrintOrderAttention | null;
  wrote: boolean;
}

const PROVIDER_FIELDS = ["luluStatus", "currentJobId"] as const;

/**
 * Apply a patch to an order record and append an event, atomically.
 *
 * Returns null (after logging) on failure instead of throwing — see the file
 * header. The caller's flow always continues.
 */
export async function recordOrderEvent(
  args: RecordOrderEventArgs,
): Promise<RecordOrderEventResult | null> {
  try {
    const result = await writeOrderEvent(args);
    if (!args.silent) await announceTransition(result);
    return result;
  } catch (err) {
    console.error("[printOrders] could not record event", args.key, args.type, err);
    return null;
  }
}

async function writeOrderEvent(args: RecordOrderEventArgs): Promise<RecordOrderEventResult> {
  const ref = db().doc(`${PRINT_ORDERS}/${args.key}`);
  const eventId = args.dedupeId ?? randomUUID();
  const eventRef = ref.collection("events").doc(eventId);

  return db().runTransaction(async (tx: Transaction) => {
    const [snap, existingEvent] = await Promise.all([tx.get(ref), args.dedupeId ? tx.get(eventRef) : null]);
    const now = Date.now();
    const exists = snap.exists;
    const current = normalizeRecord(args.key, snap.data(), now);
    const previous = exists ? current : null;

    const patch: PrintOrderPatch = clean({ ...(args.patch ?? {}) });
    // Which channel was first to tell us about a provider status change.
    if (args.type === "provider_status" || args.type === "placed") {
      const statusChanged =
        patch.luluStatus !== undefined && patch.luluStatus !== current.luluStatus;
      if (statusChanged && (args.source === "lulu_webhook" || args.source === "lulu_poll")) {
        const bucket = args.source === "lulu_webhook" ? "webhook" : "poll";
        patch.changeSources = {
          ...current.changeSources,
          [bucket]: current.changeSources[bucket] + 1,
        };
      }
    }
    if (args.source === "lulu_webhook") patch.lastWebhookAt = now;
    if (args.source === "lulu_poll") patch.lastSyncAt = now;
    patch.lastUpdateSource = args.source;

    const next = applyPatch(current, patch, now);

    const moved =
      !exists ||
      next.state !== current.state ||
      PROVIDER_FIELDS.some((f) => next[f] !== current[f]);
    const duplicate = Boolean(existingEvent?.exists);
    const writeEvent = !duplicate && (!args.onlyIfChanged || moved);

    tx.set(ref, clean(next));
    if (writeEvent) {
      const event: Omit<OrderEvent, "id"> = {
        at: now,
        type: args.type,
        source: args.source,
        message: args.message ? args.message.slice(0, 1000) : null,
        fromState: exists ? current.state : null,
        toState: next.state,
        luluStatus: next.luluStatus,
        data: args.data ? clean(args.data) : null,
      };
      tx.set(eventRef, clean(event));
    }

    const raised =
      next.attention && next.attention.reason !== current.attention?.reason ? next.attention : null;
    const resolved =
      current.attention && next.attention?.reason !== current.attention.reason
        ? current.attention
        : null;
    return { record: next, previous, raised, resolved, wrote: writeEvent };
  });
}

// ---- Alerts ------------------------------------------------------------------

function adminOrdersUrl(key?: string): string {
  const base = (serverConfig().stripe.appUrl || "").replace(/\/$/, "");
  return `${base}/admin/analysis/orders${key ? `?order=${encodeURIComponent(key)}` : ""}`;
}

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "";
  return `${amount.toFixed(2)} ${(currency ?? "").toUpperCase()}`.trim();
}

/** One line that says who, what and how much — enough to act without opening anything. */
export function describeOrder(r: PrintOrderRecord): string {
  const bits = [
    r.recipientEmail ?? r.uid ?? "unknown customer",
    r.destinationCountry ? `→ ${r.destinationCountry}` : "",
    r.sku ? `SKU ${r.sku}` : "",
    r.amountPaid != null ? money(r.amountPaid, r.currency) : "",
    r.env === "sandbox" ? "(sandbox)" : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function alertRef(key: string, att: PrintOrderAttention): string {
  return `${key}_${att.since}`;
}

function alertKind(reason: AttentionReason): string {
  return `order.${reason}`;
}

function alertMessage(record: PrintOrderRecord, att: PrintOrderAttention): string {
  return (
    `${ATTENTION_REASON_LABEL[att.reason]} — ${describeOrder(record)}\n` +
    `${att.detail}\n` +
    `Do: ${ATTENTION_REASON_ACTION[att.reason]}\n` +
    `Order ${record.paymentId ?? record.key}${record.currentJobId ? ` · job ${record.currentJobId}` : ""} · ${adminOrdersUrl(record.key)}`
  );
}

/** Close the inbox alert for an attention that no longer applies, and say so in #ops. */
export async function announceResolved(record: PrintOrderRecord, resolved: PrintOrderAttention): Promise<void> {
  if (record.env === "sandbox") return;
  try {
    await resolveAlert(`${alertKind(resolved.reason)}_${alertRef(record.key, resolved)}`).catch(() => undefined);
    await notifySlack({
      channel: "ops",
      messageKey: "admin_alert",
      ref: `resolved_${record.key}_${resolved.since}`,
      text: `✅ Resolved — ${ATTENTION_REASON_LABEL[resolved.reason]} · ${describeOrder(record)}`,
    });
  } catch (err) {
    console.warn("[printOrders] could not announce resolution", record.key, err);
  }
}

/** Raise (or resolve) the human-facing alert for an attention transition. */
async function announceTransition(result: RecordOrderEventResult): Promise<void> {
  const { record, raised, resolved } = result;
  // Sandbox orders are rehearsals: they still land in the queue, but they never page anyone.
  const quiet = record.env === "sandbox";
  try {
    if (raised && !quiet) {
      await raiseAlert({
        severity: "critical",
        kind: alertKind(raised.reason),
        message: alertMessage(record, raised),
        meta: { key: record.key, paymentId: record.paymentId, uid: record.uid, jobId: record.currentJobId },
        ref: alertRef(record.key, raised),
      });
    }
  } catch (err) {
    console.warn("[printOrders] could not announce attention change", record.key, err);
  }
  if (resolved) await announceResolved(record, resolved);
}

/**
 * Announce several newly raised attentions at once, grouped by cause. One root
 * cause hitting a dozen orders (the printer is down, its invoice is unpaid) is one
 * problem, so it is one message — a dozen would bury the fix.
 */
export async function announceAttentionBatch(
  items: { record: PrintOrderRecord; attention: PrintOrderAttention }[],
): Promise<void> {
  const live = items.filter((i) => i.record.env !== "sandbox");
  const byReason = new Map<AttentionReason, typeof live>();
  for (const item of live) {
    const list = byReason.get(item.attention.reason) ?? [];
    list.push(item);
    byReason.set(item.attention.reason, list);
  }
  for (const [reason, list] of byReason) {
    if (list.length < 3) {
      for (const { record, attention } of list) {
        await raiseAlert({
          severity: "critical",
          kind: alertKind(reason),
          message: alertMessage(record, attention),
          meta: { key: record.key, paymentId: record.paymentId, uid: record.uid, jobId: record.currentJobId },
          ref: alertRef(record.key, attention),
        });
      }
      continue;
    }
    const lines = list.slice(0, 10).map(({ record }) => `• ${describeOrder(record)} (${record.paymentId ?? record.key})`);
    await raiseAlert({
      severity: "critical",
      kind: alertKind(reason),
      message:
        `${ATTENTION_REASON_LABEL[reason]} — ${list.length} orders affected\n` +
        `${lines.join("\n")}${list.length > 10 ? `\n…and ${list.length - 10} more` : ""}\n` +
        `Do: ${ATTENTION_REASON_ACTION[reason]}\n${adminOrdersUrl()}`,
      meta: { reason, count: list.length, keys: list.map((l) => l.record.key).slice(0, 50) },
      ref: `batch_${reason}_${Math.floor(Date.now() / 3_600_000)}`,
    });
  }
}

// ---- Building the record from the payment ---------------------------------------

/** What the payment alone tells us about the order. */
export function patchFromPayment(payment: AdminPaymentRecord): PrintOrderPatch {
  const plan = payment.fulfillment;
  const cfgEnv = serverConfig().fulfillment.lulu.env;
  const patch: PrintOrderPatch = {
    paymentId: payment.id,
    uid: payment.ownerUid || null,
    env: cfgEnv,
    paymentStatus: payment.status,
    amountPaid: payment.amount,
    currency: payment.currency,
    refundedAmount: payment.refundedAmount,
    fulfillmentState: payment.fulfillmentState,
    attempts: payment.fulfillmentAttempts,
    lastError: payment.lastFulfillmentError,
  };
  if (payment.paidAt) patch.paidAt = payment.paidAt;
  if (plan) {
    patch.projectId = plan.merchantReference ?? null;
    patch.sku = plan.productSku;
    patch.copies = plan.copies;
    patch.pages = plan.pageCount;
    patch.shippingMethod = plan.shippingMethod;
    patch.destinationCountry = plan.destinationCountry?.toUpperCase() ?? null;
    patch.recipientName = plan.recipient?.name ?? null;
    patch.recipientEmail = plan.recipient?.email ?? null;
    patch.files = {
      interior: plan.sourceFileUrls?.interior ?? null,
      cover: plan.sourceFileUrls?.cover ?? null,
    };
    if (plan.estimatedCost) {
      patch.estimatedCost = { amount: plan.estimatedCost.amount, currency: plan.estimatedCost.currency };
    }
  }
  if (payment.orderId) patch.currentJobId = payment.orderId;
  return patch;
}

/**
 * Bring the order record in line with its payment (creating it if this is the
 * first we've seen). Only PRINT orders that were actually paid get a record — an
 * abandoned checkout is not an order.
 */
export async function syncOrderFromPayment(
  payment: AdminPaymentRecord | null,
  event: { type: OrderEventType; source: OrderEventSource; message?: string | null; data?: Record<string, unknown> },
  extra?: PrintOrderPatch,
  opts?: { silent?: boolean; onlyIfChanged?: boolean; dedupeId?: string },
): Promise<RecordOrderEventResult | null> {
  if (!payment || payment.kind !== "order") return null;
  const paid = payment.status === "paid" || payment.status === "refunded" || payment.status === "partially_refunded";
  if (!paid) return null;
  const key = printOrderKey(payment.id);
  if (!key) return null;
  return recordOrderEvent({
    key,
    type: event.type,
    source: event.source,
    message: event.message ?? null,
    data: event.data ?? null,
    patch: { ...patchFromPayment(payment), ...(extra ?? {}) },
    ...opts,
  });
}

// ---- Emails ------------------------------------------------------------------------

export type OrderEmailKind = "confirmation" | "shipped" | "failed";

/**
 * Put the outcome of a customer email on the order, so "did they get told?" is a
 * lookup rather than an archaeology project. A duplicate (already sent) changes
 * nothing; a send that did not happen is recorded as such.
 */
export async function recordOrderEmail(
  key: string | null,
  kind: OrderEmailKind,
  result: { ok: boolean; skipped?: string; error?: string },
  source: OrderEventSource = "email",
): Promise<void> {
  if (!key) return;
  if (result.skipped === "duplicate") return;
  const now = Date.now();
  const field = `${kind}At` as "confirmationAt" | "shippedAt" | "failedAt";
  if (result.ok) {
    await recordOrderEvent({
      key,
      type: "email_sent",
      source,
      message: `${kind} email sent`,
      patch: { emails: { [field]: now, lastError: null } as unknown as PrintOrderRecord["emails"] },
      silent: true,
    });
    return;
  }
  // "skipped: …" is a deliberate non-send (template disabled, no address, daily
  // cap); a bare message is a real delivery failure. The watchdog only pages on
  // the latter.
  const why = result.error ?? `skipped: ${result.skipped ?? "not sent"}`;
  await recordOrderEvent({
    key,
    type: "email_failed",
    source,
    message: `${kind} email not sent: ${why}`,
    patch: { emails: { lastError: `${kind}: ${why}` } as unknown as PrintOrderRecord["emails"] },
    silent: true,
  });
}

// ---- Reads -----------------------------------------------------------------------

export async function getPrintOrder(key: string): Promise<PrintOrderRecord | null> {
  const snap = await db().doc(`${PRINT_ORDERS}/${key}`).get();
  return snap.exists ? normalizeRecord(key, snap.data(), Date.now()) : null;
}

export async function listOrderEvents(key: string, limit = 200): Promise<OrderEvent[]> {
  const snap = await db()
    .collection(`${PRINT_ORDERS}/${key}/events`)
    .orderBy("at", "asc")
    .limit(Math.min(limit, 500))
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderEvent, "id">) }));
}

/** Every order that can still change (the sweeps and the queue only need these). */
export async function listOpenOrders(): Promise<PrintOrderRecord[]> {
  const out: PrintOrderRecord[] = [];
  const snap = await db().collection(PRINT_ORDERS).where("open", "==", true).get();
  const now = Date.now();
  for (const doc of snap.docs) out.push(normalizeRecord(doc.id, doc.data(), now));
  return out;
}

/** Find an order's record key from a provider job id (webhooks only know the job). */
export async function findKeyByJobId(jobId: string): Promise<string | null> {
  if (!jobId) return null;
  const snap = await db()
    .collection(PRINT_ORDERS)
    .where("jobIds", "array-contains", jobId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

// ---- Heartbeats -------------------------------------------------------------------

/** Scheduled jobs and how long a silence is acceptable. */
export const JOB_HEARTBEATS: Record<string, { label: string; maxSilenceMs: number }> = {
  syncPrintOrders: { label: "Printer status sync", maxSilenceMs: 50 * 60_000 },
  retryFulfillments: { label: "Order placement retry", maxSilenceMs: 100 * 60_000 },
  orderWatchdog: { label: "Order watchdog", maxSilenceMs: 50 * 60_000 },
};

export interface Heartbeat {
  job: string;
  at: number;
  ok: boolean;
  summary: string | null;
}

/** Record that a scheduled job ran. Never throws. */
export async function recordHeartbeat(job: string, ok: boolean, summary?: string): Promise<void> {
  try {
    await db()
      .doc(`jobHeartbeats/${job}`)
      .set({ job, at: Date.now(), ok, summary: summary ? summary.slice(0, 500) : null }, { merge: true });
  } catch (err) {
    console.warn("[printOrders] heartbeat write failed", job, err);
  }
}

export async function readHeartbeats(): Promise<Heartbeat[]> {
  const snap = await db().collection("jobHeartbeats").get();
  return snap.docs.map((d) => {
    const x = d.data() as Partial<Heartbeat>;
    return { job: d.id, at: x.at ?? 0, ok: x.ok !== false, summary: x.summary ?? null };
  });
}

// ---- Provider connection health ---------------------------------------------------

/**
 * What we know about the link to the print provider, per environment. Written by
 * the webhook receiver (deliveries, bad signatures) and by the watchdog (auth and
 * webhook-registration checks); read by the admin connection panel.
 */
export interface PrintHealth {
  env: string;
  lastWebhookAt: number | null;
  /** Deliveries whose signature we could not verify, in a row. */
  signatureFailures: number;
  lastSignatureFailureAt: number | null;
  /** Failed auth checks in a row (the watchdog alerts at three). */
  authFailures: number;
  lastAuthOkAt: number | null;
  lastAuthError: string | null;
  /** The webhook URL we registered (so the watchdog can restore it). */
  webhookUrl: string | null;
  webhookId: string | null;
  webhookStatus: string | null;
  webhookCheckedAt: number | null;
  /** Refs of the open outage alerts, so a recovery can close exactly those. */
  webhookAlertRef: string | null;
  signatureAlertRef: string | null;
  checkedAt: number | null;
}

const EMPTY_HEALTH = (env: string): PrintHealth => ({
  env,
  lastWebhookAt: null,
  signatureFailures: 0,
  lastSignatureFailureAt: null,
  authFailures: 0,
  lastAuthOkAt: null,
  lastAuthError: null,
  webhookUrl: null,
  webhookId: null,
  webhookStatus: null,
  webhookCheckedAt: null,
  webhookAlertRef: null,
  signatureAlertRef: null,
  checkedAt: null,
});

export async function readPrintHealth(env: string): Promise<PrintHealth> {
  const snap = await db().doc(`printHealth/${env}`).get();
  return { ...EMPTY_HEALTH(env), ...((snap.data() as Partial<PrintHealth> | undefined) ?? {}), env };
}

/** Merge into the health document. Never throws — health bookkeeping must not break a webhook. */
export async function patchPrintHealth(env: string, patch: Partial<PrintHealth>): Promise<void> {
  try {
    await db().doc(`printHealth/${env}`).set(clean({ ...patch, env }), { merge: true });
  } catch (err) {
    console.warn("[printOrders] health write failed", env, err);
  }
}
