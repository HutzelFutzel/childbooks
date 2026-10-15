/**
 * Scheduled sweep that retries paid orders whose print placement failed.
 *
 * `fulfillPaidOrder` never throws back into the Stripe webhook (a 500 would
 * only make Stripe retry an event that can't fix a fulfillment error), so
 * failures are persisted on the payment record instead — this job picks them
 * up with linear backoff and bounded attempts. Recovery/exhaustion both raise
 * admin alerts (see `retryFailedFulfillments`).
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "./storage";
import { ALL_SECRETS } from "./secrets";
import { retryFailedFulfillments, retryStrandedFulfillments } from "./stripe";
import { recordHeartbeat } from "./printOrders";

export const retryFulfillments = onSchedule(
  {
    schedule: "every 30 minutes",
    timeoutSeconds: 300,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    try {
      const placed = await retryFailedFulfillments();
      if (placed > 0) logger.info(`[fulfillment-retry] placed ${placed} order(s) on retry`);
      // Paid orders that never got as far as a failure record at all (the webhook
      // handler died mid-flight) — nothing else would ever pick these up.
      const stranded = await retryStrandedFulfillments();
      if (stranded > 0) logger.warn(`[fulfillment-retry] re-drove ${stranded} stranded paid order(s)`);
      await recordHeartbeat("retryFulfillments", true, `${placed} retried, ${stranded} stranded re-driven`);
    } catch (err) {
      logger.error("[fulfillment-retry] sweep failed", err);
      await recordHeartbeat("retryFulfillments", false, err instanceof Error ? err.message : String(err));
    }
  },
);
