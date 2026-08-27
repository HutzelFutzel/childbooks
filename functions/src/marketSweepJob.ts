/**
 * Scheduled refresh of the print provider's country coverage.
 *
 * Coverage is evidence with a shelf life. The provider adds and drops
 * destinations without announcing it, so a sweep run once by hand becomes a
 * claim about a world that has moved on — and the way that surfaces is a
 * customer in a country we still advertise having their order refused at the
 * last step. Re-asking weekly turns that into a warning on the admin Markets
 * tab instead.
 *
 * Weekly, not daily: it's ~250 provider requests, the answer changes on the
 * order of months, and the same rate limiter serves checkout quoting. Sunday
 * 04:10 UTC keeps it clear of the daily finance and digest jobs.
 *
 * The scheduled run is forced because its purpose is freshness, not merely
 * finishing unknown rows from a previous attempt. The resulting capability is
 * immediately reprojected into the public product catalog.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "./storage";
import { ALL_SECRETS } from "./secrets";
import { runMarketSweep } from "./marketDiscovery";
import { reprojectPublicProducts } from "./products";

export const sweepMarketCoverage = onSchedule(
  {
    schedule: "10 4 * * 0",
    timeZone: "UTC",
    timeoutSeconds: 540,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    try {
      // Coverage has a shelf life. A weekly refresh must re-check settled
      // countries too, then publish the new answer to the storefront.
      const result = await runMarketSweep({ force: true });
      await reprojectPublicProducts();
      if (result.probed === 0) {
        // Not an error: every country already has a settled verdict, which is
        // the steady state once a full sweep has completed.
        logger.info(`[market-sweep] nothing to probe${result.message ? ` — ${result.message}` : ""}`);
        return;
      }
      logger.info(
        `[market-sweep] probed ${result.probed}: ${result.available} reachable, ` +
          `${result.refused} refused, ${result.unknown} unknown`,
      );
      // Worth a warning rather than a silent retry next week: a throttled run
      // leaves `unknown` rows, and an enabled country with no verdict is
      // exactly the case the Markets tab flags for attention.
      if (result.throttled) {
        logger.warn(`[market-sweep] incomplete — ${result.message ?? "rate-limited"}`);
      }
    } catch (err) {
      logger.error("[market-sweep] sweep failed", err);
    }
  },
);
