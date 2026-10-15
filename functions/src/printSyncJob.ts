/**
 * Scheduled print-order status reconciliation.
 *
 * The safety net under `/print-webhook`: Lulu deactivates a webhook that fails
 * persistently, and a delivery lost while we were down is never retried — either
 * way an order silently stops updating and a shipped book never emails its
 * customer. This sweep re-derives the truth from the provider on a timer.
 *
 * Every 15 minutes: often enough that a missed SHIPPED event reaches the customer
 * the same hour, rare enough to be a handful of provider requests per sweep (only
 * non-terminal orders from the last few weeks are polled).
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "./storage";
import { ALL_SECRETS } from "./secrets";
import { reconcileOpenPrintOrders } from "./printSync";
import { recordHeartbeat } from "./printOrders";
import { checkHeartbeats } from "./printOrderWatchdog";

export const syncPrintOrders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeoutSeconds: 300,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    try {
      const result = await reconcileOpenPrintOrders();
      // Proof of life for the watchdog: a sweep that stopped running looks exactly
      // like a sweep with nothing to do, until somebody notices a shipped book
      // never got its email.
      await recordHeartbeat(
        "syncPrintOrders",
        true,
        `${result.synced}/${result.scanned} synced, ${result.changed.length} changed, ${result.errors.length} errors`,
      );
      // Only worth a log line when something moved — an idle sweep is the norm.
      if (result.changed.length > 0) {
        logger.info(
          `[print-sync] ${result.changed.length} order(s) changed stage: ` +
            result.changed.map((c) => `${c.orderId} ${c.from ?? "?"}→${c.to}`).join(", "),
        );
      }
      if (result.errors.length > 0) {
        logger.warn(
          `[print-sync] ${result.errors.length} order(s) failed to sync: ` +
            result.errors.map((e) => `${e.orderId} (${e.message})`).join(", "),
        );
      }
      // This job is the watchdog's watchdog: if the thing that watches everything
      // else has itself gone quiet, nothing else would ever say so.
      await checkHeartbeats(["syncPrintOrders", "retryFulfillments"]).catch((err) =>
        logger.warn("[print-sync] heartbeat check failed", err),
      );
    } catch (err) {
      logger.error("[print-sync] sweep failed", err);
      await recordHeartbeat("syncPrintOrders", false, err instanceof Error ? err.message : String(err));
    }
  },
);
