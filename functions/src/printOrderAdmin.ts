/**
 * Admin API for the order overview — the data behind Analysis → Orders and the
 * handful of actions an operator can take on an order.
 *
 *   GET  /admin/orders                    list (filters: state, attention, country, q)
 *   GET  /admin/orders/analytics          the overview report
 *   GET  /admin/orders/connection         the printer link: auth, webhook, jobs
 *   POST /admin/orders/connection/check   run the link check now (and repair the webhook)
 *   GET  /admin/orders/:key               one order: record, timeline, payment
 *
 *   POST /admin/orders/:key/retry         try placing again (no live job yet)
 *   POST /admin/orders/:key/replace       place a new job for a dead one
 *   POST /admin/orders/:key/cancel        cancel the live job at the printer   (dangerous)
 *   POST /admin/orders/:key/cancel-and-refund  cancel, refund the rest, email the customer (dangerous)
 *   POST /admin/orders/:key/recipient     correct phone / tax id / address, then place again
 *   POST /admin/orders/:key/resend-email  resend confirmation / shipped / failed
 *   POST /admin/orders/:key/sync          ask the printer for this order's status now
 *   POST /admin/orders/:key/ack           "I've handled this" (with a note)
 *
 * Print-file actions (`rerun-print-prep`, `use-standard-files`) and the print
 * preparation dashboard live with the pipeline, in `printPrep.ts`.
 *
 * Every action is recorded on the order's timeline with who did it, and goes
 * through the same writer as everything else — so the queue and the Slack alert
 * can't disagree about whether something is still open.
 */
import express, { type Express, type Request, type Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import type { AuthedRequest } from "./auth";
import { serverConfig } from "./config";
import { fulfillmentProvider, luluCredentialsPresent, sendAdminError } from "./lulu";
import { applyOrderStatusUpdate } from "./orders";
import {
  correctFulfillmentRecipient,
  getAdminPayment,
  markFulfillmentCancelled,
  markFulfillmentRejected,
  rearmFulfillment,
  type RecipientCorrection,
} from "./payments";
import {
  JOB_HEARTBEATS,
  PRINT_ORDERS,
  getPrintOrder,
  listOrderEvents,
  normalizeRecord,
  readHeartbeats,
  readPrintHealth,
  recordOrderEmail,
  recordOrderEvent,
  syncOrderFromPayment,
} from "./printOrders";
import { checkPrinterLink } from "./printOrderWatchdog";
import { ensurePrintOrdersBackfilled } from "./printOrderBackfill";
import { fulfillPaidOrder, refundRemaining, sendConfirmationIfPlaced } from "./stripe";
import { readPrintPrepForAdmin } from "./printPrep";
import {
  sendOrderCancelledEmail,
  sendOrderConfirmationEmail,
  sendOrderFailedEmail,
  sendOrderShippedEmail,
} from "./email/triggers";
import { phoneProblem, taxIdProblem } from "../../books-frontend/src/core/fulfillment/recipientFormat";
import { toUsd } from "./finance";
import { orderRecordsCache } from "./printOrderRecordsCache";
import { computeOrderAnalytics } from "../../books-frontend/src/core/orders/analytics";
import { countryLabel, normalizeCountry } from "../../books-frontend/src/core/analytics/markets";
import {
  providerJobIsLive,
  type PrintOrderRecord,
  type PrintOrderState,
  PRINT_ORDER_STATES,
} from "../../books-frontend/src/core/orders/lifecycle";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** The most records one request will read. A very large shop would page; this one doesn't need to yet. */
const SCAN_CAP = 3000;

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message } });
}

async function actorOf(req: Request): Promise<string> {
  const uid = (req as AuthedRequest).uid;
  if (!uid) return "admin";
  try {
    const user = await getAuth().getUser(uid);
    return user.email ?? uid;
  } catch {
    return uid;
  }
}

/**
 * Newest first; filtering happens in memory (every order is one small document).
 * Cached briefly and shared between the list and the report — see
 * `printOrderRecordsCache.ts` for the invalidation rules.
 */
async function loadRecords(opts?: { fresh?: boolean }): Promise<PrintOrderRecord[]> {
  return orderRecordsCache.get(
    "all",
    async () => {
      await ensurePrintOrdersBackfilled();
      const snap = await db().collection(PRINT_ORDERS).orderBy("createdAt", "desc").limit(SCAN_CAP).get();
      const now = Date.now();
      return snap.docs.map((d) => normalizeRecord(d.id, d.data() as Record<string, unknown>, now));
    },
    opts,
  );
}

/** `?fresh=1` — an explicit refresh that must not be answered from the cache. */
const wantsFresh = (req: Request): boolean => str(req.query.fresh) === "1";

/** Sandbox and live orders live side by side; by default show the environment being served. */
function inScope(r: PrintOrderRecord, env: string): boolean {
  if (env === "all") return true;
  return !r.env || r.env === env;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function registerPrintOrderAdminRoutes(app: Express): void {
  const json = express.json({ limit: "100kb" });

  // ---- Reads --------------------------------------------------------------------

  app.get("/admin/orders", async (req: Request, res: Response) => {
    try {
      const activeEnv = serverConfig().fulfillment.lulu.env;
      const env = str(req.query.env) || activeEnv;
      const state = str(req.query.state);
      const attention = str(req.query.attention) === "1";
      const country = normalizeCountry(str(req.query.country));
      const q = str(req.query.q).toLowerCase();
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

      let rows = (await loadRecords({ fresh: wantsFresh(req) })).filter((r) => inScope(r, env));
      if (state && (PRINT_ORDER_STATES as readonly string[]).includes(state)) {
        rows = rows.filter((r) => r.state === (state as PrintOrderState));
      }
      if (attention) rows = rows.filter((r) => r.needsAttention);
      if (country) rows = rows.filter((r) => r.destinationCountry === country);
      if (q) {
        rows = rows.filter((r) =>
          [r.key, r.paymentId, r.uid, r.recipientEmail, r.recipientName, r.currentJobId, ...r.jobIds, r.projectId]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        );
      }
      // The ones that need a person float to the top, oldest problem first.
      rows.sort((a, b) => {
        if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
        if (a.needsAttention && b.needsAttention) return (a.attention?.since ?? 0) - (b.attention?.since ?? 0);
        return (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt);
      });
      res.json({ total: rows.length, env, orders: rows.slice(0, limit) });
    } catch (err) {
      console.error("[orders-admin] list failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not list orders.");
    }
  });

  app.get("/admin/orders/analytics", async (req: Request, res: Response) => {
    try {
      const activeEnv = serverConfig().fulfillment.lulu.env;
      const env = str(req.query.env) || activeEnv;
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const country = normalizeCountry(str(req.query.country));
      const records = (await loadRecords({ fresh: wantsFresh(req) })).filter((r) => inScope(r, env));

      // One rate per currency actually present, instead of a conversion per order.
      const currencies = new Set<string>(["USD"]);
      for (const r of records) {
        if (r.currency) currencies.add(r.currency.toUpperCase());
        if (r.actualCost) currencies.add(r.actualCost.currency.toUpperCase());
        if (r.estimatedCost) currencies.add(r.estimatedCost.currency.toUpperCase());
      }
      const rates = new Map<string, number | null>();
      await Promise.all(
        [...currencies].map(async (c) => {
          try {
            rates.set(c, c === "USD" ? 1 : await toUsd(1, c));
          } catch {
            rates.set(c, null);
          }
        }),
      );

      res.json(
        computeOrderAnalytics(records, {
          now: Date.now(),
          windowDays: days,
          country,
          usdRate: (c) => rates.get(c.toUpperCase()) ?? null,
          countryLabel: (c) => countryLabel(c),
        }),
      );
    } catch (err) {
      console.error("[orders-admin] analytics failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not build the orders report.");
    }
  });

  app.get("/admin/orders/connection", async (_req: Request, res: Response) => {
    try {
      const env = serverConfig().fulfillment.lulu.env;
      const [health, beats] = await Promise.all([readPrintHealth(env), readHeartbeats()]);
      const now = Date.now();
      const byJob = new Map(beats.map((b) => [b.job, b]));
      res.json({
        env,
        credentialsPresent: luluCredentialsPresent(env),
        health,
        jobs: Object.entries(JOB_HEARTBEATS).map(([job, spec]) => {
          const beat = byJob.get(job);
          return {
            job,
            label: spec.label,
            lastRunAt: beat?.at ?? null,
            ok: beat ? beat.ok : null,
            summary: beat?.summary ?? null,
            maxSilenceMs: spec.maxSilenceMs,
            stale: beat ? now - beat.at > spec.maxSilenceMs : false,
          };
        }),
      });
    } catch (err) {
      console.error("[orders-admin] connection failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not read the printer connection.");
    }
  });

  app.post("/admin/orders/connection/check", json, async (_req: Request, res: Response) => {
    try {
      const result = await checkPrinterLink();
      res.json({ ok: result.ok, repaired: result.repaired });
    } catch (err) {
      sendAdminError(res, err);
    }
  });

  app.get("/admin/orders/:key", async (req: Request, res: Response) => {
    try {
      const record = await getPrintOrder(req.params.key);
      if (!record) return fail(res, 404, "That order doesn't exist.");
      const [events, payment, printPrep] = await Promise.all([
        listOrderEvents(record.key),
        record.paymentId ? getAdminPayment(record.paymentId) : Promise.resolve(null),
        record.paymentId ? readPrintPrepForAdmin(record.paymentId).catch(() => null) : Promise.resolve(null),
      ]);
      res.json({
        record,
        events,
        printPrep,
        payment: payment
          ? {
              id: payment.id,
              status: payment.status,
              amount: payment.amount,
              currency: payment.currency,
              feeAmount: payment.feeAmount,
              refundedAmount: payment.refundedAmount,
              stripePaymentIntentId: payment.stripePaymentIntentId,
              fulfillmentState: payment.fulfillmentState,
              attempts: payment.fulfillmentAttempts,
              lastError: payment.lastFulfillmentError,
              rejectedOrderIds: payment.rejectedOrderIds,
              printPrepEligible: Boolean(payment.fulfillment?.printPrep),
              checkoutFiles: payment.fulfillment?.sourceFileUrls ?? null,
              placedFiles: payment.placedFileUrls,
              recipient: payment.fulfillment?.recipient ?? null,
            }
          : null,
      });
    } catch (err) {
      console.error("[orders-admin] detail failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not load the order.");
    }
  });

  // ---- Actions ------------------------------------------------------------------

  /** Resolve the order and its payment, or answer the request with why not. */
  async function load(req: Request, res: Response) {
    const record = await getPrintOrder(req.params.key);
    if (!record) {
      fail(res, 404, "That order doesn't exist.");
      return null;
    }
    const payment = record.paymentId ? await getAdminPayment(record.paymentId) : null;
    return { record, payment };
  }

  const jobAlive = (r: PrintOrderRecord) => Boolean(r.currentJobId) && providerJobIsLive(r.luluStatus);

  // Try placing again. Safe even if an earlier attempt secretly succeeded: the
  // provider is asked for a job with this order's key first (see `createOrder`).
  app.post("/admin/orders/:key/retry", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      if (!payment || !payment.fulfillment) return fail(res, 409, "This order has no stored fulfillment plan to place.");
      if (payment.status === "refunded") return fail(res, 409, "This order was refunded; it won't be placed.");
      if (jobAlive(record) || payment.orderId) {
        return fail(res, 409, "A print job already exists for this order. Use Replace if it was rejected.");
      }
      const by = await actorOf(req);
      await rearmFulfillment(payment.id, payment.ownerUid);
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} retried placement`,
        patch: { fulfillmentState: "retrying" },
        silent: true,
      });
      await fulfillPaidOrder(payment.id);
      await sendConfirmationIfPlaced(payment.id);
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      console.error("[orders-admin] retry failed", err);
      fail(res, 500, (err as Error)?.message ?? "Retry failed.");
    }
  });

  // The printer killed (or we cancelled) the job: send a fresh one. Refused while
  // the old job could still be produced — that would print the book twice.
  app.post("/admin/orders/:key/replace", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      if (!payment || !payment.fulfillment) return fail(res, 409, "This order has no stored fulfillment plan to place.");
      if (payment.status === "refunded") return fail(res, 409, "This order was refunded; it won't be placed.");
      if (jobAlive(record)) {
        return fail(res, 409, "The current print job is still active. Cancel it first, or wait for the printer to reject it.");
      }
      const deadJob = payment.orderId ?? record.currentJobId;
      if (!deadJob) return fail(res, 409, "There is no dead job to replace. Use Retry instead.");
      const by = await actorOf(req);
      await markFulfillmentRejected({
        paymentId: payment.id,
        uid: payment.ownerUid,
        orderId: deadJob,
        reason: `Replaced by ${by}`,
        replace: true,
        exhausted: false,
      });
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} replaced dead job ${deadJob}`,
        // The order is re-placing, not rejected for good — until it isn't.
        patch: { autoReplacing: true, fulfillmentState: "retrying" },
        silent: true,
      });
      await fulfillPaidOrder(payment.id);
      await sendConfirmationIfPlaced(payment.id);
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      console.error("[orders-admin] replace failed", err);
      fail(res, 500, (err as Error)?.message ?? "Replace failed.");
    }
  });

  app.post("/admin/orders/:key/cancel", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record } = ctx;
      if (!record.currentJobId || !jobAlive(record)) return fail(res, 409, "There is no active print job to cancel.");
      const by = await actorOf(req);
      const cancelled = await fulfillmentProvider().cancelOrder(record.currentJobId);
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} canceled job ${record.currentJobId} at the printer`,
        silent: true,
      });
      await applyOrderStatusUpdate(cancelled, "lulu_poll");
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      // The printer refuses once production has started; say so as-is.
      sendAdminError(res, err);
    }
  });

  // The one-step way out for an order that won't be made: stop it at the printer,
  // give the money back, tell the customer. Refuses to refund if the printer
  // refuses to cancel — a refund for a book still being printed is paid twice.
  app.post("/admin/orders/:key/cancel-and-refund", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      if (!payment) return fail(res, 409, "This order has no payment to refund.");
      if (payment.status === "refunded") return fail(res, 409, "This order is already fully refunded.");
      if (payment.status !== "paid" && payment.status !== "partially_refunded") {
        return fail(res, 409, `The payment is ${payment.status}; there is nothing to refund.`);
      }
      if (record.state === "shipped") return fail(res, 409, "This order has shipped. Refund it from Payments if you mean to.");
      const by = await actorOf(req);

      let cancelledJob: Awaited<ReturnType<ReturnType<typeof fulfillmentProvider>["cancelOrder"]>> | null = null;
      if (record.currentJobId && jobAlive(record)) {
        try {
          cancelledJob = await fulfillmentProvider().cancelOrder(record.currentJobId);
        } catch (err) {
          console.warn("[orders-admin] cancel-and-refund: printer refused to cancel", record.key, err);
          return fail(
            res,
            409,
            `The printer wouldn't cancel job ${record.currentJobId} (${(err as Error)?.message ?? "error"}). ` +
              "It has probably started production — nothing was refunded.",
          );
        }
      }

      // Stop any automatic placement before the money goes back.
      await markFulfillmentCancelled({ paymentId: payment.id, uid: payment.ownerUid, refunded: true });
      const refund = await refundRemaining(payment);
      const amountLabel = formatMoney(refund.amount, refund.currency);
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message:
          `${by} canceled ${cancelledJob ? `job ${record.currentJobId} at the printer` : "the order"} ` +
          `and refunded ${amountLabel} (${refund.refundId})` +
          (str(req.body?.reason) ? `: ${str(req.body?.reason).slice(0, 300)}` : ""),
        // Written ahead of the refund webhook so the cancel below lands as
        // "refunded" rather than briefly paging as canceled-without-refund.
        patch: {
          paymentStatus: "refunded",
          refundedAmount: payment.amount,
          fulfillmentState: "failed",
          autoReplacing: false,
        },
        silent: true,
      });
      if (cancelledJob) await applyOrderStatusUpdate(cancelledJob, "lulu_poll");

      if (payment.ownerUid) {
        try {
          const sent = await sendOrderCancelledEmail({
            uid: payment.ownerUid,
            orderRef: record.currentJobId ?? record.key,
            refunded: true,
            refundAmount: amountLabel,
          });
          await recordOrderEmail(record.key, "cancelled", sent, `admin:${by}`);
        } catch (mailErr) {
          console.warn("[orders-admin] cancellation email failed", record.key, mailErr);
          await recordOrderEmail(record.key, "cancelled", { ok: false, error: (mailErr as Error)?.message ?? "error" });
        }
      }
      res.json({ ok: true, refundId: refund.refundId, record: await getPrintOrder(record.key) });
    } catch (err) {
      console.error("[orders-admin] cancel-and-refund failed", err);
      fail(res, 500, (err as Error)?.message ?? "Cancel and refund failed.");
    }
  });

  // The printer refused a detail only the customer could supply (a phone number,
  // a customs id, an address line). Correct it from their reply and place again.
  app.post("/admin/orders/:key/recipient", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      if (!payment || !payment.fulfillment) return fail(res, 409, "This order has no stored fulfillment plan.");
      if (payment.status === "refunded") return fail(res, 409, "This order was refunded; it won't be placed.");
      if (jobAlive(record)) {
        return fail(res, 409, "The current print job is still active. Cancel it at the printer first, then correct and re-place.");
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const fix: RecipientCorrection = {};
      for (const key of [
        "name",
        "email",
        "phoneNumber",
        "line1",
        "line2",
        "townOrCity",
        "stateOrCounty",
        "postalOrZipCode",
        "taxId",
      ] as const) {
        if (typeof body[key] === "string") fix[key] = (body[key] as string).slice(0, 200);
      }
      if (Object.keys(fix).length === 0) return fail(res, 400, "Nothing to correct.");
      const country = payment.fulfillment.recipient.address.countryCode.toUpperCase();
      if (fix.phoneNumber !== undefined) {
        const problem = phoneProblem(fix.phoneNumber);
        if (problem) return fail(res, 400, `Phone: ${problem}`);
      }
      if (fix.taxId !== undefined) {
        const problem = taxIdProblem(country, fix.taxId);
        if (problem) return fail(res, 400, `Tax id: ${problem}`);
      }
      const by = await actorOf(req);
      await correctFulfillmentRecipient(payment.id, fix);
      const deadJob = payment.orderId ?? null;
      if (deadJob) {
        await markFulfillmentRejected({
          paymentId: payment.id,
          uid: payment.ownerUid,
          orderId: deadJob,
          reason: `Recipient corrected by ${by}`,
          replace: true,
          exhausted: false,
        });
      } else {
        await rearmFulfillment(payment.id, payment.ownerUid);
      }
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} corrected the recipient (${Object.keys(fix).join(", ")}) and re-placed the order`,
        patch: { autoReplacing: Boolean(deadJob), fulfillmentState: "retrying" },
        silent: true,
      });
      await fulfillPaidOrder(payment.id);
      await sendConfirmationIfPlaced(payment.id);
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      console.error("[orders-admin] recipient correction failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not correct the recipient.");
    }
  });

  app.post("/admin/orders/:key/resend-email", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      const kind = str(req.body?.kind);
      if (!record.uid) return fail(res, 409, "This order has no customer account to email.");
      const by = await actorOf(req);
      let result;
      if (kind === "confirmation") {
        if (!payment || !record.currentJobId) return fail(res, 409, "The order isn't placed yet, so there is nothing to confirm.");
        result = await sendOrderConfirmationEmail({
          uid: record.uid,
          orderRef: record.currentJobId,
          itemLabel: "Your custom picture book",
          paymentId: payment.id,
          resend: true,
        });
      } else if (kind === "shipped") {
        if (!record.currentJobId || record.state !== "shipped") return fail(res, 409, "The order hasn't shipped.");
        const shipment = record.shipments.find((s) => s.trackingUrl) ?? record.shipments[0];
        result = await sendOrderShippedEmail({
          uid: record.uid,
          orderRef: record.currentJobId,
          carrier: shipment?.carrier ?? null,
          trackingUrl: shipment?.trackingUrl ?? null,
          resend: true,
        });
      } else if (kind === "failed") {
        result = await sendOrderFailedEmail({
          uid: record.uid,
          orderRef: record.currentJobId ?? record.key,
          paymentId: record.paymentId ?? record.key,
          resend: true,
        });
      } else {
        return fail(res, 400, "kind must be confirmation, shipped or failed.");
      }
      await recordOrderEmail(record.key, kind as "confirmation" | "shipped" | "failed", result, `admin:${by}`);
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} resent the ${kind} email${result.ok ? "" : " (not sent)"}`,
        silent: true,
      });
      res.json({ ok: result.ok, result, record: await getPrintOrder(record.key) });
    } catch (err) {
      console.error("[orders-admin] resend failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not resend the email.");
    }
  });

  app.post("/admin/orders/:key/sync", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record, payment } = ctx;
      if (!record.currentJobId) {
        // Nothing at the printer to ask about — re-derive from the payment instead.
        if (payment) {
          await syncOrderFromPayment(payment, {
            type: "synced",
            source: `admin:${await actorOf(req)}`,
            message: "Re-synced from payment",
          });
        }
        return res.json({ record: await getPrintOrder(record.key) });
      }
      const order = await fulfillmentProvider().getOrder(record.currentJobId);
      await applyOrderStatusUpdate(order, "lulu_poll");
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      sendAdminError(res, err);
    }
  });

  app.post("/admin/orders/:key/ack", json, async (req: Request, res: Response) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { record } = ctx;
      if (!record.attention) return fail(res, 409, "This order doesn't need attention right now.");
      const note = str(req.body?.note).slice(0, 500);
      if (!note) return fail(res, 400, "Say what you did, so the next person knows.");
      const by = await actorOf(req);
      await recordOrderEvent({
        key: record.key,
        type: "admin_action",
        source: `admin:${by}`,
        message: `${by} marked "${record.attention.reason}" as handled: ${note}`,
        patch: { ack: { reason: record.attention.reason, at: Date.now(), by, note } },
        // Resolving it is the point; the Slack thread should say so.
      });
      res.json({ record: await getPrintOrder(record.key) });
    } catch (err) {
      console.error("[orders-admin] ack failed", err);
      fail(res, 500, (err as Error)?.message ?? "Could not acknowledge.");
    }
  });
}
