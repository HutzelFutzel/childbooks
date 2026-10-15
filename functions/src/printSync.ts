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
import express, { type Express, type Request, type Response } from "express";
import { fulfillmentProvider, sendAdminError } from "./lulu";
import { applyOrderStatusUpdate } from "./orders";
import { listOpenOrders } from "./printOrders";
import { ensurePrintOrdersBackfilled } from "./printOrderBackfill";
import { serverConfig } from "./config";
import { providerJobIsLive } from "../../books-frontend/src/core/orders/lifecycle";

/** Bounded so one sweep can't spend minutes hammering the provider's API. */
const DEFAULT_LIMIT = 300;

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
  /** Accepted for compatibility; the open-order set no longer depends on age. */
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
  const limit = Math.min(Math.max(Math.floor(options.limit ?? DEFAULT_LIMIT), 1), 1000);
  const result: PrintSyncResult = { scanned: 0, synced: 0, changed: [], errors: [] };

  // The set of orders worth asking about comes from the order record, which knows
  // exactly which are still open and which job is current. The previous version
  // read the newest 100 job documents and filtered them afterwards: one busy week
  // and an order in production fell off the end of that window and silently
  // stopped updating — the exact failure this sweep exists to prevent. Orders
  // that predate the record are brought in by the backfill below.
  await ensurePrintOrdersBackfilled();
  const activeEnv = serverConfig().fulfillment.lulu.env;
  const open = (await listOpenOrders())
    // A sandbox job doesn't exist on the live account (and the reverse): asking
    // would just fail for every one of them, every sweep.
    .filter((r) => !r.env || r.env === activeEnv)
    .filter((r) => r.currentJobId && (!r.luluStatus || providerJobIsLive(r.luluStatus)))
    // Least recently checked first, so a cap never starves the same orders.
    .sort((a, b) => (a.lastSyncAt ?? 0) - (b.lastSyncAt ?? 0))
    .slice(0, limit);
  if (open.length === 0) return result;

  const provider = fulfillmentProvider();

  for (const record of open) {
    const providerOrderId = record.currentJobId as string;
    result.scanned += 1;
    try {
      const previousStage = record.stage ?? null;
      const order = await provider.getOrder(providerOrderId);
      const applied = await applyOrderStatusUpdate(order, "lulu_poll");
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
