/**
 * Scheduled invitation sweep — the single reminder for untouched invitations and
 * the status flip for the ones that timed out (see `maintenance.ts` for why).
 *
 * Hourly rather than daily so an invitation's expiry reads as expired within the
 * hour: the invite screen showing "pending" for something that can no longer be
 * accepted is exactly the kind of small lie that generates support mail.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "../storage";
import { ALL_SECRETS } from "../secrets";
import { sweepInvitations } from "./maintenance";

export const sweepReferralInvitations = onSchedule(
  {
    schedule: "every 60 minutes",
    timeoutSeconds: 300,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    try {
      const { reminded, expired } = await sweepInvitations();
      if (reminded > 0 || expired > 0) {
        logger.info(`[referrals] sweep sent ${reminded} reminder(s), expired ${expired} invitation(s)`);
      }
    } catch (err) {
      logger.error("[referrals] sweep failed", err);
    }
  },
);
