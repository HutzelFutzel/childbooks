/**
 * Slack notifications for interesting events — new signups, purchases, new
 * subscribers, and operational alerts.
 *
 * Two hard rules, both because a notification must NEVER affect the flow that
 * triggered it (a payment, a signup, an alert):
 *   - PROD ONLY: no-ops in the emulator, so local dev never pings Slack.
 *   - BEST-EFFORT: every failure (missing config, network, timeout) is caught
 *     and swallowed — this function never throws.
 *
 * Config (Cloud Secret Manager, injected into process.env; see secrets.ts):
 *   - SLACK_WEBHOOK_URL      required for any ping.
 *   - SLACK_OPS_WEBHOOK_URL  optional. Operational alerts use it when set,
 *                            otherwise they fall back to SLACK_WEBHOOK_URL — so
 *                            a single webhook / single channel works out of the
 *                            box, and you can split #growth / #ops later.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";

/** Which Slack channel a message is for (drives which webhook is used). */
export type NotifyChannel = "growth" | "ops";

/** The webhook URL for a channel, or undefined when none is configured. */
function webhookFor(channel: NotifyChannel): string | undefined {
  if (channel === "ops") {
    return process.env.SLACK_OPS_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || undefined;
  }
  return process.env.SLACK_WEBHOOK_URL || undefined;
}

/**
 * Post a plain-text message to Slack.
 *
 * When `ref` is supplied the message is sent AT MOST ONCE: a tiny Firestore
 * marker (`slackNotified/{channel}_{ref}`) makes retries idempotent, so a
 * Stripe webhook that fires twice (or a subscription that stays "active" across
 * renewals) only pings once.
 */
export async function notifySlack(opts: {
  text: string;
  channel?: NotifyChannel;
  ref?: string;
}): Promise<void> {
  try {
    // Prod only — the emulator sets FUNCTIONS_EMULATOR (see auth.ts, stripeClient.ts).
    if (process.env.FUNCTIONS_EMULATOR === "true") return;

    const channel = opts.channel ?? "growth";
    const url = webhookFor(channel);
    if (!url) return; // not configured — silently skip

    // Idempotency: claim a one-time marker keyed on the underlying fact.
    if (opts.ref) {
      const key = `${channel}_${opts.ref}`.replace(/\//g, "_");
      try {
        ensureAdmin();
        await getFirestore().collection("slackNotified").doc(key).create({ at: Date.now() });
      } catch (err) {
        // ALREADY_EXISTS ⇒ we've pinged for this fact before; stay quiet.
        if ((err as { code?: number }).code === 6) return;
        // Any other marker failure: fall through and still try to notify — a
        // possible duplicate beats a missed alert.
      }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: opts.text }),
        signal: ctrl.signal,
      });
      if (!res.ok) console.error("[notify] slack responded", res.status);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[notify] slack failed", err);
  }
}

/** Format a money amount for a Slack line (best-effort, dependency-free). */
export function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}
