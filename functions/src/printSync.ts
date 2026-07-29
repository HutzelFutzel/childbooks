/**
 * Print-order status reconciliation — PULLING what the webhook PUSHES.
 *
 * `/print-webhook` is the fast path for provider status changes, but it can't be
 * the only one:
 *   - It needs a publicly reachable URL, which local development doesn't have.
 *     Reconciling on a timer is what lets the whole order lifecycle be exercised
 *     against the emulators with no tunnel.
 *   - In production it's a single point of failure. Lulu deactivates a webhook
 *     that fails persistently (see `registerPrintWebhookRoute`), and a delivery
 *     lost while we were down is never retried — after which an order silently
 *     stops updating and a shipped book never emails its customer.
 *
 * Both are the same operation: ask the provider for an order's current state and
 * feed it through `applyOrderStatusUpdate`, exactly as the webhook does. That
 * function is idempotent (history entries are deduped, cost booking is keyed on
 * the cumulative charge, rejection handling fires only on the TRANSITION into a
 * dead state), so polling the same unchanged order costs a request and changes
 * nothing.
 */
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import express, { type Express, type Request, type Response } from "express";
import { ensureAdmin } from "./storage";
import { fulfillmentProvider, sendAdminError } from "./lulu";
import { applyOrderStatusUpdate } from "./orders";
import type { OrderStage } from "../../books-frontend/src/core/fulfillment/types";

function db() {
  ensureAdmin();
  return getFirestore();
}

/**
 * Stages that will never change again, so their orders are not worth a request.
 * `error` is deliberately NOT terminal: a rejected order can be re-placed (see
 * `handleRejectedOrder`), and the replacement's progress has to be observable.
 */
const TERMINAL_STAGES: ReadonlySet<string> = new Set<OrderStage>(["complete", "cancelled"]);

/**
 * How far back to look for orders worth polling. Lulu jobs reach a terminal
 * state in days, not weeks; anything older and still open is stuck in a way a
 * status fetch won't resolve, and shouldn't cost a provider request on every
 * sweep forever.
 */
const DEFAULT_MAX_AGE_DAYS = 45;

/** Bounded so one sweep can't spend minutes hammering the provider's API. */
const DEFAULT_LIMIT = 100;

export interface PrintSyncResult {
  /** Open orders considered. */
  scanned: number;
  /** Orders whose status was successfully fetched and applied. */
  synced: number;
  /** Orders whose stage actually moved (the interesting number). */
  changed: { orderId: string; from: string | null; to: string }[];
  /** Per-order failures. A sweep never throws — one bad order can't stop the rest. */
  errors: { orderId: string; message: string }[];
}

export interface PrintSyncOptions {
  limit?: number;
  maxAgeDays?: number;
}

/**
 * Fetch the provider's current status for every open order and apply it.
 *
 * Sequential on purpose: the provider rate-limits, and this runs on a timer with
 * nobody waiting on it. Failures are collected per order rather than thrown, so
 * an order the provider has forgotten (or a transient 502) doesn't stop the sweep.
 */
export async function reconcileOpenPrintOrders(
  options: PrintSyncOptions = {},
): Promise<PrintSyncResult> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? DEFAULT_LIMIT), 1), 500);
  const maxAgeDays = Math.min(Math.max(Math.floor(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 1), 365);
  const since = Timestamp.fromMillis(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const result: PrintSyncResult = { scanned: 0, synced: 0, changed: [], errors: [] };

  // Filtered on `createdAt` alone (a single-field index every collection has) and
  // narrowed in memory: `stage not-in [...]` plus an inequality on another field
  // would need a composite index, which is a lot of deploy ceremony for a sweep
  // that reads at most a few hundred docs.
  const snap = await db()
    .collection("orders")
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const open = snap.docs.filter((doc) => {
    const stage = doc.get("stage") as string | undefined;
    return !stage || !TERMINAL_STAGES.has(stage);
  });
  if (open.length === 0) return result;

  const provider = fulfillmentProvider();

  for (const doc of open) {
    // The provider's own id, which is what `getOrder` takes. Older records may
    // only have the doc id (they're the same value today, but don't rely on it).
    const providerOrderId = (doc.get("providerOrderId") as string | undefined) || doc.id;
    result.scanned += 1;
    try {
      const previousStage = (doc.get("stage") as string | undefined) ?? null;
      const order = await provider.getOrder(providerOrderId);
      const applied = await applyOrderStatusUpdate(order);
      if (!applied) {
        result.errors.push({ orderId: providerOrderId, message: "no matching order record" });
        continue;
      }
      result.synced += 1;
      if (order.stage !== previousStage) {
        result.changed.push({ orderId: providerOrderId, from: previousStage, to: order.stage });
      }
    } catch (err) {
      result.errors.push({
        orderId: providerOrderId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Admin: reconcile now instead of waiting for the scheduled sweep. The manual
 * lever for "a customer says it shipped and our record disagrees".
 */
export function registerPrintSyncAdminRoutes(app: Express): void {
  app.post(
    "/admin/print/sync",
    express.json({ limit: "1mb" }),
    async (req: Request, res: Response) => {
      try {
        const { limit, maxAgeDays } = (req.body ?? {}) as { limit?: number; maxAgeDays?: number };
        res.json(await reconcileOpenPrintOrders({ limit, maxAgeDays }));
      } catch (err) {
        sendAdminError(res, err);
      }
    },
  );
}

/**
 * Emulator-only reconciliation, polled by `scripts/dev.mjs`.
 *
 * Local development has no publicly reachable URL, so the provider's status
 * webhook can never be delivered here — this is how an order's lifecycle
 * (IN_PRODUCTION → SHIPPED, or a REJECTED file validation) still reaches the
 * emulator, with no tunnel and without weakening the admin guard to do it.
 *
 * It's registered ahead of the auth guards, so it must not exist anywhere else:
 * `FUNCTIONS_EMULATOR` is set by the emulator suite itself and can't be
 * influenced by a request, so in production this route 404s like any unknown path.
 */
export function registerPrintSyncDevRoute(app: Express): void {
  if (process.env.FUNCTIONS_EMULATOR !== "true") return;
  app.post("/internal/print/sync", async (_req: Request, res: Response) => {
    try {
      res.json(await reconcileOpenPrintOrders());
    } catch (err) {
      console.error("[print-sync] dev sweep failed", err);
      res.status(500).json({ error: { message: "sync failed" } });
    }
  });
}
