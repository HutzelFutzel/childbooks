/**
 * Nightly affiliate reconcile — the safety net under the unsigned webhook.
 *
 * Runs at 03:45 UTC, just before the infra-cost import, so the affiliate cost
 * side of the ledger is complete for yesterday by the time the daily summary
 * reads it.
 *
 * Once a day is enough: commissions sit `pending` for the campaign's refund
 * window (30 days by default) before any money is owed, so nothing here is ever
 * urgent — it exists so a missed webhook can't quietly cost or over-report money
 * for longer than a day.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "../storage";
import { ALL_SECRETS } from "../secrets";
import { raiseAlert } from "../alerts";
import { rewardfulConfigured } from "./api";
import { reconcileAffiliates } from "./sync";

export const syncAffiliates = onSchedule(
  {
    schedule: "45 3 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    // No API secret means the affiliate program isn't in use — not a failure.
    if (!rewardfulConfigured()) return;
    try {
      const status = await reconcileAffiliates();
      logger.info("[affiliates] reconcile complete", {
        campaigns: status.campaigns,
        partners: status.partners,
        commissions: status.commissions,
        payouts: status.payouts,
        scopeViolations: status.scopeViolations,
        durationMs: status.durationMs,
      });
    } catch (err) {
      // The mirror going stale is invisible in the product but shows up as wrong
      // numbers in the dashboard and a gap in the P&L, so it needs a human.
      await raiseAlert({
        severity: "warning",
        kind: "affiliateSyncFailed",
        message: `Affiliate reconcile failed: ${err instanceof Error ? err.message : String(err)}`,
        ref: new Date().toISOString().slice(0, 10),
      });
      logger.error("[affiliates] reconcile failed", err);
    }
  },
);
