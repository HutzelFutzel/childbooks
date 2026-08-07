/**
 * The campaign engine's scheduled half: the two things that happen because time
 * passed rather than because a customer did something.
 *
 *   1. **Time-based triggers.** "7 days after you signed up" has no event to
 *      hang off, so a sweep has to go looking. It's the only trigger family that
 *      can't be driven from a webhook, and it's deliberately narrow: only
 *      accounts enrolled in a campaign that actually has such a rule are ever
 *      examined, so the sweep's cost scales with campaign use, not user count.
 *
 *   2. **Promotional Spark expiry.** A grant with a finite life is only actually
 *      finite if something enforces it. Without this, `expiresInDays` is a
 *      promise to ourselves that we never keep, and every campaign quietly adds
 *      to a permanent liability.
 *
 * Daily rather than hourly: nothing here is time-critical to the hour, and both
 * passes read broadly enough that running them 24× more often would be pure cost.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "../storage";
import { ALL_SECRETS } from "../secrets";
import { TRIGGER_META } from "../../../books-frontend/src/core/config/campaigns";
import { getCampaignsConfig } from "../appConfig";
import { expireSparkLots } from "../sparks";
import { onCampaignEvent } from "./events";
import { DAY_MS, db, ENROLLMENTS, normalizeEnrollment } from "./store";

/** Ceiling on one sweep pass, so a large tenant can't blow the time budget. */
const MAX_ENROLLMENTS = 2000;

export const sweepCampaigns = onSchedule(
  {
    schedule: "every 24 hours",
    timeoutSeconds: 540,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    try {
      const fired = await fireScheduledTriggers();
      if (fired > 0) logger.info(`[campaigns] scheduled sweep fired ${fired} trigger(s)`);
    } catch (err) {
      logger.error("[campaigns] scheduled sweep failed", err);
    }
    try {
      const { lots, sparks } = await expireSparkLots();
      if (lots > 0) logger.info(`[campaigns] expired ${lots} Spark lot(s) worth ${sparks} Sparks`);
    } catch (err) {
      logger.error("[campaigns] Spark expiry failed", err);
    }
  },
);

/**
 * Fire the day-based triggers that have come due.
 *
 * The event bus deduplicates on (trigger, ref), and each ref below identifies the
 * exact occurrence — an account+rule for a signup timer, a project+rule for a
 * project timer. So a sweep that runs twice, or retries after a partial failure,
 * pays exactly once. That's what makes it safe to re-scan the same enrollments
 * every day instead of maintaining a cursor.
 */
async function fireScheduledTriggers(): Promise<number> {
  const config = await getCampaignsConfig();
  if (!config.enabled) return 0;

  // Only campaigns that actually have a scheduled rule are worth scanning for, so
  // the sweep's cost scales with campaign use rather than with user count.
  const scheduled = config.campaigns.filter((c) =>
    c.rules.some((r) => r.enabled && TRIGGER_META[r.trigger].scheduled),
  );
  if (scheduled.length === 0) return 0;

  let fired = 0;
  const now = Date.now();

  for (const campaign of scheduled) {
    const snap = await db()
      .collection(ENROLLMENTS)
      .where("campaignId", "==", campaign.id)
      .limit(MAX_ENROLLMENTS)
      .get();
    if (snap.empty) continue;

    const live = snap.docs
      .map((doc) => normalizeEnrollment(doc.id, doc.data()))
      // Holdouts are measured, never paid — and an expired enrollment has stopped
      // earning, however long ago it was created.
      .filter((e) => !e.holdout && (e.expiresAt === 0 || now <= e.expiresAt));

    for (const enrollment of live) {
      for (const rule of enrollment.terms.rules) {
        if (!rule.enabled || rule.trigger !== "days_after_signup") continue;
        if (now < enrollment.enrolledAt + rule.afterDays * DAY_MS) continue;
        await onCampaignEvent(enrollment.uid, "days_after_signup", {
          // These fire once per account, so the enrollment plus the rule IS the
          // occurrence — no day key needed, and none wanted (it would re-fire).
          ref: `${campaign.id}_${rule.id}_${enrollment.uid}`,
          daysSince: Math.floor((now - enrollment.enrolledAt) / DAY_MS),
        });
        fired += 1;
      }
    }

    // Project timers fire once per BOOK, so they're driven from the project
    // mirror rather than the enrollment. Found with one range query per rule
    // (over books that came due today) instead of one query per enrolled
    // account — the difference between a handful of reads and thousands.
    const enrolledUids = new Set(live.map((e) => e.uid));
    const projectRules = campaign.rules.filter(
      (r) => r.enabled && r.trigger === "days_after_project_created",
    );
    for (const rule of projectRules) {
      const dueBefore = now - rule.afterDays * DAY_MS;
      const projects = await db()
        .collection("projects")
        .where("createdAt", ">=", dueBefore - LOOKBACK_MS)
        .where("createdAt", "<=", dueBefore)
        .limit(MAX_PROJECTS)
        .get();
      for (const doc of projects.docs) {
        const uid = doc.get("uid") as string | undefined;
        const projectId = doc.get("projectId") as string | undefined;
        if (!uid || !projectId || !enrolledUids.has(uid)) continue;
        await onCampaignEvent(uid, "days_after_project_created", {
          ref: `${campaign.id}_${rule.id}_${projectId}`,
          projectId,
          daysSince: rule.afterDays,
        });
        fired += 1;
      }
    }
  }
  return fired;
}

/**
 * How far back a project timer looks for books that came due.
 *
 * Wider than the daily cadence on purpose: a sweep that was skipped (a deploy, an
 * outage) would otherwise leave a day of books permanently unpaid, and there is
 * no second chance — the due date has passed. Re-examining a week of books every
 * day is cheap, and the event log makes it idempotent.
 */
const LOOKBACK_MS = 7 * DAY_MS;

/** Ceiling on the project scan, for the same reason as {@link MAX_ENROLLMENTS}. */
const MAX_PROJECTS = 2000;
