/**
 * The order watchdog — the thing that notices when nothing is happening.
 *
 * Every other piece of the order pipeline reacts to an event: a webhook arrives, a
 * sweep finds a change, a payment fails. The failures that cost money are the ones
 * where the event never comes — a job that stopped running, a webhook the printer
 * deactivated, a payment Stripe never told us about, an order that has been
 * "placing" since Tuesday. This runs every 15 minutes and looks for exactly those.
 *
 * What it pages for (and only this — see `raiseAlert`, critical = Slack):
 *   - an order that has waited too long in a state that needs a person
 *   - a scheduled job that has stopped checking in
 *   - the printer link: credentials failing, webhook missing/inactive/unverifiable
 *   - a paid Stripe checkout we never heard about
 *   - customer emails failing to send
 *
 * Where it can fix something itself (re-register the webhook, re-drive a stranded
 * order, adopt a missed payment) it does, and says so.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { ALL_SECRETS } from "./secrets";
import { serverConfig } from "./config";
import { raiseAlert, resolveAlert } from "./alerts";
import { defaultWebhookUrl, fulfillmentProvider, luluCredentialsPresent } from "./lulu";
import { reconcilePendingCheckouts } from "./stripe";
import { backfillPrintOrders, ensurePrintOrdersBackfilled } from "./printOrderBackfill";
import {
  JOB_HEARTBEATS,
  announceAttentionBatch,
  announceResolved,
  listOpenOrders,
  patchPrintHealth,
  readHeartbeats,
  readPrintHealth,
  recordHeartbeat,
  recordOrderEvent,
} from "./printOrders";
import {
  applyPatch,
  type PrintOrderAttention,
  type PrintOrderRecord,
} from "../../books-frontend/src/core/orders/lifecycle";

function db() {
  ensureAdmin();
  return getFirestore();
}

const HOUR = 3_600_000;

export interface WatchdogResult {
  open: number;
  attentionRaised: number;
  attentionResolved: number;
  staleJobs: string[];
  luluOk: boolean | null;
  webhookRepaired: boolean;
  pendingCheckoutsHealed: number;
}

// ---- 1. Orders that need a person -------------------------------------------------

/**
 * Re-evaluate every open order against the clock. Most "needs attention" reasons
 * are about elapsed time (paid two hours ago and still not placed), which no event
 * announces — so the clock has to be the trigger.
 */
async function reevaluateOpenOrders(): Promise<{ open: number; raised: number; resolved: number }> {
  const now = Date.now();
  const open = await listOpenOrders();
  const raised: { record: PrintOrderRecord; attention: PrintOrderAttention }[] = [];
  let resolved = 0;
  for (const rec of open) {
    const next = applyPatch(rec, {}, now);
    if (next.attention?.reason === rec.attention?.reason) continue;
    const result = await recordOrderEvent({
      key: rec.key,
      type: "synced",
      source: "watchdog",
      message: next.attention
        ? `Needs attention: ${next.attention.detail}`
        : "No longer needs attention",
      patch: {},
      // Announced below: several orders failing for one reason is one message.
      silent: true,
    });
    if (!result) continue;
    if (result.raised) raised.push({ record: result.record, attention: result.raised });
    if (result.resolved) {
      resolved += 1;
      await announceResolved(result.record, result.resolved);
    }
  }
  if (raised.length > 0) await announceAttentionBatch(raised);
  return { open: open.length, raised: raised.length, resolved };
}

// ---- 2. Scheduled jobs still running ---------------------------------------------

/**
 * Alert when a scheduled job has stopped checking in. An idle sweep and a dead one
 * look identical from outside, until a shipped book never emails its customer.
 * `exclude` lets a job skip checking itself.
 */
export async function checkHeartbeats(exclude: string[] = []): Promise<string[]> {
  const now = Date.now();
  const beats = new Map((await readHeartbeats()).map((b) => [b.job, b]));
  const stale: string[] = [];
  for (const [job, spec] of Object.entries(JOB_HEARTBEATS)) {
    if (exclude.includes(job)) continue;
    const beat = beats.get(job);
    // Never recorded: a fresh deploy that hasn't had its first run yet.
    if (!beat) continue;
    const ref = db().doc(`jobHeartbeats/${job}`);
    const silent = now - beat.at > spec.maxSilenceMs;
    const alertedFor = ((await ref.get()).get("alertedFor") as number | undefined) ?? null;
    if (silent) {
      stale.push(job);
      if (alertedFor !== beat.at) {
        await raiseAlert({
          severity: "critical",
          kind: "job.heartbeat_missing",
          message:
            `${spec.label} (${job}) has not run for ${Math.round((now - beat.at) / 60_000)} min ` +
            `(expected every ≤ ${Math.round(spec.maxSilenceMs / 60_000)} min). ` +
            "Do: check Cloud Scheduler and the function logs; run it manually from the admin if needed.",
          meta: { job, lastRunAt: beat.at, lastSummary: beat.summary },
          ref: `${job}_${beat.at}`,
        });
        await ref.set({ alertedFor: beat.at }, { merge: true });
      }
    } else if (alertedFor !== null) {
      await resolveAlert(`job.heartbeat_missing_${job}_${alertedFor}`).catch(() => undefined);
      await ref.set({ alertedFor: null }, { merge: true });
    }
    if (!beat.ok && !silent) {
      // It runs but fails every time; the summary says why.
      logger.warn(`[watchdog] ${job} last run failed: ${beat.summary ?? "no detail"}`);
    }
  }
  return stale;
}

// ---- 3. The printer link ----------------------------------------------------------

/** What URL the printer should be calling: the one an admin registered, else the standard path. */
function expectedWebhookUrl(stored: string | null): string | null {
  return stored || defaultWebhookUrl();
}

/**
 * Check the credentials and the status webhook, and repair the webhook if we can.
 *
 * Listing the webhooks authenticates AND proves the account is reachable, so one
 * call answers both. Three failures in a row means it is not a blip.
 */
export async function checkPrinterLink(): Promise<{ ok: boolean | null; repaired: boolean }> {
  const env = serverConfig().fulfillment.lulu.env;
  if (!luluCredentialsPresent(env)) return { ok: null, repaired: false };
  // A sandbox misbehaving is a to-do, not an emergency.
  const severity = env === "live" ? "critical" : "warning";
  const now = Date.now();
  const health = await readPrintHealth(env);
  const provider = fulfillmentProvider();
  let repaired = false;

  let hooks;
  try {
    hooks = (await provider.listStatusWebhooks?.()) ?? [];
  } catch (err) {
    const failures = health.authFailures + 1;
    const message = err instanceof Error ? err.message : String(err);
    await patchPrintHealth(env, { authFailures: failures, lastAuthError: message.slice(0, 500), checkedAt: now });
    if (failures >= 3) {
      await raiseAlert({
        severity,
        kind: "lulu.auth_failing",
        message:
          `The printer API has failed ${failures} checks in a row (${env}): ${message.slice(0, 300)}. ` +
          "No order can be placed or tracked while this lasts. " +
          "Do: check the Lulu credentials/secrets and the printer's status page.",
        meta: { env, failures },
        ref: `${env}_${health.lastAuthOkAt ?? 0}`,
      });
    }
    return { ok: false, repaired };
  }

  // Recovered: close the outage alert, if one was raised.
  if (health.authFailures >= 3) {
    await resolveAlert(`lulu.auth_failing_${env}_${health.lastAuthOkAt ?? 0}`).catch(() => undefined);
  }
  await patchPrintHealth(env, { authFailures: 0, lastAuthOkAt: now, lastAuthError: null, checkedAt: now });

  // ---- webhook
  const url = expectedWebhookUrl(health.webhookUrl);
  const mine = url ? hooks.filter((h) => h.url === url) : hooks;
  const active = mine.find((h) => h.isActive);
  let webhookStatus = active ? "active" : mine.length > 0 ? "inactive" : "missing";

  if (!active && url && provider.registerStatusWebhook) {
    try {
      // A deactivated webhook stays deactivated; the way back is a fresh one.
      for (const dead of mine) await provider.deleteStatusWebhook?.(dead.id).catch(() => undefined);
      const fresh = await provider.registerStatusWebhook(url);
      repaired = true;
      webhookStatus = "active";
      await patchPrintHealth(env, { webhookUrl: url, webhookId: fresh.id });
      logger.warn(`[watchdog] re-registered the printer status webhook (${env}) → ${url}`);
    } catch (err) {
      logger.error("[watchdog] could not re-register the printer webhook", err);
    }
  }

  // One alert per outage: raised when it starts, closed when it ends. (Keying it on
  // the check time would re-page every 15 minutes for as long as it lasts.)
  if (webhookStatus !== "active") {
    if (!health.webhookAlertRef) {
      const ref = `${env}_${now}`;
      await raiseAlert({
        severity,
        kind: "lulu.webhook_inactive",
        message:
          `The printer status webhook is ${webhookStatus} (${env}) and could not be repaired automatically. ` +
          "Status changes now arrive only by the 15-minute poll, so shipped emails will be late. " +
          "Do: Admin → System health → Printer webhook → Register.",
        meta: { env, url, webhookStatus },
        ref,
      });
      await patchPrintHealth(env, { webhookAlertRef: ref });
    }
  } else if (health.webhookAlertRef) {
    await resolveAlert(`lulu.webhook_inactive_${health.webhookAlertRef}`).catch(() => undefined);
    await patchPrintHealth(env, { webhookAlertRef: null });
  }
  await patchPrintHealth(env, { webhookStatus, webhookCheckedAt: now });

  // ---- signatures: deliveries that arrive but cannot be verified. A run of them
  // after a credential rotation means the webhook has silently stopped working.
  const fresh = await readPrintHealth(env);
  const signaturesBroken =
    fresh.signatureFailures >= 5 && fresh.lastSignatureFailureAt !== null && now - fresh.lastSignatureFailureAt < HOUR;
  if (signaturesBroken && !fresh.signatureAlertRef) {
    const ref = `${env}_${fresh.lastSignatureFailureAt}`;
    await raiseAlert({
      severity,
      kind: "lulu.webhook_signature",
      message:
        `${fresh.signatureFailures} printer webhook deliveries in a row failed signature verification. ` +
        "The API secret was probably rotated. Do: update LULU_*_CLIENT_SECRET to the current secret.",
      meta: { env, failures: fresh.signatureFailures },
      ref,
    });
    await patchPrintHealth(env, { signatureAlertRef: ref });
  } else if (!signaturesBroken && fresh.signatureAlertRef) {
    await resolveAlert(`lulu.webhook_signature_${fresh.signatureAlertRef}`).catch(() => undefined);
    await patchPrintHealth(env, { signatureAlertRef: null });
  }
  return { ok: true, repaired };
}

// ---- 4. Customer emails -----------------------------------------------------------

/**
 * Real send failures (not deliberate skips) across recent orders. One is a bad
 * address; several in a few hours is the email provider.
 */
async function checkOrderEmails(): Promise<void> {
  const now = Date.now();
  const snap = await db()
    .collection("printOrders")
    .where("updatedAt", ">=", now - 6 * HOUR)
    .get();
  let failures = 0;
  for (const doc of snap.docs) {
    const err = doc.get("emails.lastError") as string | null | undefined;
    if (err && !/: skipped:/.test(err) && !err.startsWith("skipped")) failures += 1;
  }
  if (failures >= 3) {
    await raiseAlert({
      severity: "critical",
      kind: "email.order_failing",
      message:
        `${failures} customer order emails failed to send in the last 6 hours. ` +
        "Do: check the email provider status and API key in Admin → System health.",
      meta: { failures },
      ref: `${Math.floor(now / (6 * HOUR))}`,
    });
  }
}

// ---- Entry point ------------------------------------------------------------------

export async function runOrderWatchdog(): Promise<WatchdogResult> {
  await ensurePrintOrdersBackfilled();

  const result: WatchdogResult = {
    open: 0,
    attentionRaised: 0,
    attentionResolved: 0,
    staleJobs: [],
    luluOk: null,
    webhookRepaired: false,
    pendingCheckoutsHealed: 0,
  };

  // Each check is independent: one failing must never blind the rest.
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      logger.error(`[watchdog] ${name} failed`, err);
    }
  };

  await step("orders", async () => {
    const r = await reevaluateOpenOrders();
    result.open = r.open;
    result.attentionRaised = r.raised;
    result.attentionResolved = r.resolved;
  });
  // The watchdog's own heartbeat is checked by the sync job (see printSyncJob).
  await step("heartbeats", async () => {
    result.staleJobs = await checkHeartbeats(["orderWatchdog"]);
  });
  await step("printer-link", async () => {
    const r = await checkPrinterLink();
    result.luluOk = r.ok;
    result.webhookRepaired = r.repaired;
  });
  await step("emails", checkOrderEmails);

  // Hourly: these call Stripe, so not on every 15-minute pass.
  const now = new Date();
  if (now.getUTCMinutes() < 15) {
    await step("missed-webhooks", async () => {
      result.pendingCheckoutsHealed = (await reconcilePendingCheckouts()).healed;
    });
  }
  // Daily, in the quiet hours: adopt anything that slipped past the live writers.
  if (now.getUTCHours() === 3 && now.getUTCMinutes() < 15) {
    await step("daily-reconcile", async () => {
      await backfillPrintOrders();
    });
  }
  return result;
}

export const orderWatchdog = onSchedule(
  {
    schedule: "every 15 minutes",
    timeoutSeconds: 300,
    secrets: ALL_SECRETS,
  },
  async () => {
    ensureAdmin();
    try {
      const r = await runOrderWatchdog();
      await recordHeartbeat(
        "orderWatchdog",
        true,
        `${r.open} open, +${r.attentionRaised}/-${r.attentionResolved} attention, ` +
          `${r.staleJobs.length} stale jobs, printer ${r.luluOk === null ? "n/a" : r.luluOk ? "ok" : "DOWN"}`,
      );
    } catch (err) {
      logger.error("[watchdog] run failed", err);
      await recordHeartbeat("orderWatchdog", false, err instanceof Error ? err.message : String(err));
    }
  },
);
