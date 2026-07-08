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
import { retryFailedFulfillments } from "./stripe";

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
    } catch (err) {
      logger.error("[fulfillment-retry] sweep failed", err);
    }
  },
);
