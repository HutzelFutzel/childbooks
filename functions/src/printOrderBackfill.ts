/**
 * Build the print-order record for orders that predate it.
 *
 * Everything the record knows is already written down somewhere else — the payment
 * (money, plan, attempts), the legacy order document (job, status, shipments). This
 * reads those and writes the record once, so the admin overview and the sweeps see
 * the whole history rather than only orders placed after this shipped.
 *
 * Safe to run any number of times: an order that already has a record is left
 * alone (the live writers own it from then on), and history is imported silently —
 * a two-month-old order is never paged about.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getAdminPayment } from "./payments";
import { getPrintOrder, patchFromPayment, printOrderKey, recordOrderEvent } from "./printOrders";
import { patchFromAdminOrderDoc } from "./orders";
import type { PrintOrderPatch } from "../../books-frontend/src/core/orders/lifecycle";

function db() {
  ensureAdmin();
  return getFirestore();
}

const FLAG = "systemFlags/printOrdersBackfill";

/** Don't let one invocation run into its own timeout; the next sweep carries on. */
const TIME_BUDGET_MS = 200_000;

const STAGE_TO_STATUS: Record<string, string> = {
  draft: "CREATED",
  onHold: "UNPAID",
  inProgress: "IN_PRODUCTION",
  complete: "SHIPPED",
  cancelled: "CANCELED",
  error: "REJECTED",
};

const toMs = (v: unknown): number | null => {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return typeof v === "number" ? v : null;
};

export interface BackfillResult {
  scanned: number;
  created: number;
  skipped: number;
  complete: boolean;
}

let knownDone = false;

/** Run the backfill once per deployment's lifetime (cheap no-op afterwards). */
export async function ensurePrintOrdersBackfilled(): Promise<void> {
  if (knownDone) return;
  try {
    const flag = await db().doc(FLAG).get();
    if (flag.exists && flag.get("done") === true) {
      knownDone = true;
      return;
    }
    const result = await backfillPrintOrders();
    if (result.complete) {
      await db().doc(FLAG).set({ done: true, at: Date.now(), created: result.created }, { merge: true });
      knownDone = true;
    }
  } catch (err) {
    // The sweep must still run on the records that exist.
    console.error("[printOrders] backfill failed", err);
  }
}

async function jobPatch(jobId: string): Promise<PrintOrderPatch> {
  const snap = await db().doc(`orders/${jobId}`).get();
  if (!snap.exists) return { jobIds: [jobId], currentJobId: jobId };
  const d = snap.data() as Record<string, unknown>;
  const stage = typeof d.stage === "string" ? d.stage : null;
  const status = ((typeof d.statusName === "string" && d.statusName) || (stage && STAGE_TO_STATUS[stage]) || null) as
    | string
    | null;
  const charges = Array.isArray(d.charges) ? (d.charges as { amount?: number; currency?: string }[]) : [];
  const currency = charges.find((c) => c.currency)?.currency ?? null;
  const total = currency
    ? charges.filter((c) => c.currency === currency).reduce((sum, c) => sum + (c.amount ?? 0), 0)
    : null;
  const shipments = Array.isArray(d.shipments)
    ? (d.shipments as { carrier?: string; trackingNumber?: string; trackingUrl?: string }[]).map((s) => ({
        carrier: s.carrier ?? null,
        trackingUrl: s.trackingUrl ?? null,
        trackingNumber: s.trackingNumber ?? null,
      }))
    : [];
  const placedAt = toMs(d.createdAt);
  const touched = toMs(d.updatedAt) ?? placedAt;
  return {
    ...patchFromAdminOrderDoc(d),
    jobIds: [jobId],
    currentJobId: jobId,
    luluStatus: status ? status.toUpperCase() : null,
    stage,
    shipments,
    actualCost: total != null && currency && total > 0 ? { amount: total, currency } : null,
    ...(placedAt ? { placedAt, stageSince: touched ?? placedAt } : {}),
    ...(status?.toUpperCase() === "SHIPPED" && touched ? { shippedAt: touched } : {}),
  };
}

export async function backfillPrintOrders(): Promise<BackfillResult> {
  const started = Date.now();
  const result: BackfillResult = { scanned: 0, created: 0, skipped: 0, complete: true };

  const payments = await db().collection("payments").where("kind", "==", "order").get();
  for (const doc of payments.docs) {
    const status = doc.get("status") as string | undefined;
    if (status !== "paid" && status !== "refunded" && status !== "partially_refunded") continue;
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.complete = false;
      break;
    }
    result.scanned += 1;
    const key = printOrderKey(doc.id);
    if (!key || (await getPrintOrder(key))) {
      result.skipped += 1;
      continue;
    }
    const payment = await getAdminPayment(doc.id);
    if (!payment) continue;

    // The job that is current: the placed one, else the last one that was rejected.
    const jobId = payment.orderId ?? payment.rejectedOrderIds[payment.rejectedOrderIds.length - 1] ?? null;
    const job = jobId ? await jobPatch(jobId) : {};
    const patch: PrintOrderPatch = {
      ...patchFromPayment(payment),
      ...job,
      // The payment's own record of the job wins where they overlap.
      jobIds: [...payment.rejectedOrderIds, ...(payment.orderId ? [payment.orderId] : [])],
      paidAt: payment.paidAt ?? undefined,
      autoReplacing: payment.fulfillmentState === "retrying" && !payment.orderId && payment.rejectedOrderIds.length > 0,
    };
    if (!payment.orderId && payment.rejectedOrderIds.length > 0) {
      // A rejected job is the last thing that happened to it.
      patch.luluStatus = "REJECTED";
    }
    await recordOrderEvent({
      key,
      type: "synced",
      source: "backfill",
      message: "Imported from existing payment and order records",
      patch,
      silent: true,
      dedupeId: "backfill",
    });
    result.created += 1;
  }

  // Orders whose payment we can't see (dev/legacy): give them a job-keyed record
  // so they still appear, but only those without a payment link at all.
  const orphans = await db().collection("orders").get();
  for (const doc of orphans.docs) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.complete = false;
      break;
    }
    if (doc.get("paymentId")) continue;
    result.scanned += 1;
    const key = printOrderKey(null, doc.id);
    if (!key || (await getPrintOrder(key))) {
      result.skipped += 1;
      continue;
    }
    await recordOrderEvent({
      key,
      type: "synced",
      source: "backfill",
      message: "Imported from legacy order record",
      patch: {
        ...(await jobPatch(doc.id)),
        paymentStatus: "paid",
        paidAt: toMs(doc.get("createdAt")) ?? undefined,
      },
      silent: true,
      dedupeId: "backfill",
    });
    result.created += 1;
  }
  return result;
}
