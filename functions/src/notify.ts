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
 *   - SLACK_WEBHOOK_URL          required for any ping — #growth.
 *   - SLACK_OPS_WEBHOOK_URL      optional — #ops.
 *   - SLACK_CONTACT_WEBHOOK_URL  optional — #contact.
 *   - SLACK_RELEASE_WEBHOOK_URL  optional — #releases.
 * Any channel whose own URL is unset falls back to SLACK_WEBHOOK_URL, so a
 * single webhook / single channel works out of the box, and you can split
 * channels out later just by setting the matching secret.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getSlackConfig } from "./appConfig";
import { slackMessageEnabled } from "../../books-frontend/src/core/config/slackConfig";
import type { SlackChannel, SlackMessageKey } from "../../books-frontend/src/core/notify/registry";
import { UNKNOWN_COUNTRY, countryFlag } from "../../books-frontend/src/core/analytics/markets";
import {
  deviceLabel,
  osLabel,
  browserLabel,
  type DeviceClass,
  type OsFamily,
  type BrowserFamily,
} from "../../books-frontend/src/core/analytics/device";

/** Which Slack channel a message is for (drives which webhook is used). */
export type NotifyChannel = SlackChannel;

/** The Secret Manager name holding each channel's webhook URL. */
export const CHANNEL_WEBHOOK_SECRET: Record<NotifyChannel, string> = {
  growth: "SLACK_WEBHOOK_URL",
  ops: "SLACK_OPS_WEBHOOK_URL",
  contact: "SLACK_CONTACT_WEBHOOK_URL",
  release: "SLACK_RELEASE_WEBHOOK_URL",
};

/** Why a Slack ping was (or wasn't) delivered — surfaced by the test action. */
export type NotifyResult =
  | { sent: true }
  | { sent: false; reason: "emulator" | "not_configured" | "disabled" | "duplicate" | "error" };

/**
 * The webhook URL for a channel, or undefined when none is configured. Any
 * channel without its own URL falls back to #growth's, so a single webhook
 * covers everything until you're ready to split channels out.
 */
function webhookFor(channel: NotifyChannel): string | undefined {
  return process.env[CHANNEL_WEBHOOK_SECRET[channel]] || process.env.SLACK_WEBHOOK_URL || undefined;
}

/**
 * Post a plain-text message to Slack.
 *
 * When `ref` is supplied the message is sent AT MOST ONCE: a tiny Firestore
 * marker (`slackNotified/{channel}_{ref}`) makes retries idempotent, so a
 * Stripe webhook that fires twice (or a subscription that stays "active" across
 * renewals) only pings once.
 *
 * When `messageKey` is supplied the ping is gated on the admin toggle in
 * `appConfig/slackConfig` (Communication → Admin Slack) — a disabled message is
 * silently skipped.
 *
 * `force` (used by the admin "Send Test Notification" action) bypasses the
 * emulator guard, the toggle check, and the idempotency marker so it always
 * attempts a real delivery to verify the webhook.
 */
export async function notifySlack(opts: {
  text: string;
  channel?: NotifyChannel;
  ref?: string;
  /** Gate this ping on the admin per-message toggle (default ON when unset). */
  messageKey?: SlackMessageKey;
  /** Bypass emulator/toggle/dedupe guards (admin test send). */
  force?: boolean;
  /**
   * Optional Block Kit layout. When present Slack renders these instead of
   * `text`, which stays as the notification/preview fallback (and is what
   * shows in the mobile push), so callers must always supply a useful `text`.
   */
  blocks?: unknown[];
}): Promise<NotifyResult> {
  try {
    // Prod only — the emulator sets FUNCTIONS_EMULATOR (see auth.ts, stripeClient.ts).
    if (!opts.force && process.env.FUNCTIONS_EMULATOR === "true") return { sent: false, reason: "emulator" };

    const channel = opts.channel ?? "growth";
    const url = webhookFor(channel);
    if (!url) return { sent: false, reason: "not_configured" };

    // Admin per-message toggle (best-effort — a config read failure never blocks
    // an alert; we default to sending).
    if (!opts.force && opts.messageKey) {
      try {
        const cfg = await getSlackConfig();
        if (!slackMessageEnabled(cfg, opts.messageKey)) return { sent: false, reason: "disabled" };
      } catch {
        // fall through — a possible ping beats a missed alert.
      }
    }

    // Idempotency: claim a one-time marker keyed on the underlying fact.
    if (!opts.force && opts.ref) {
      const key = `${channel}_${opts.ref}`.replace(/\//g, "_");
      try {
        ensureAdmin();
        await getFirestore().collection("slackNotified").doc(key).create({ at: Date.now() });
      } catch (err) {
        // ALREADY_EXISTS ⇒ we've pinged for this fact before; stay quiet.
        if ((err as { code?: number }).code === 6) return { sent: false, reason: "duplicate" };
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
        body: JSON.stringify(
          opts.blocks?.length ? { text: opts.text, blocks: opts.blocks } : { text: opts.text },
        ),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.error("[notify] slack responded", res.status);
        return { sent: false, reason: "error" };
      }
      return { sent: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[notify] slack failed", err);
    return { sent: false, reason: "error" };
  }
}

/** Format a money amount for a Slack line (best-effort, dependency-free). */
export function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

/** Format providerId into clean human label: "google.com" -> "Google", "password" -> "Email", etc. */
export function formatProviderLabel(providerId?: string | null): string {
  if (!providerId) return "Email";
  const p = providerId.trim().toLowerCase();
  if (p === "google.com" || p === "google") return "Google";
  if (p === "password" || p === "email") return "Email";
  if (p === "apple.com" || p === "apple") return "Apple";
  if (p === "github.com" || p === "github") return "GitHub";
  if (p === "facebook.com" || p === "facebook") return "Facebook";
  if (p === "anonymous" || p === "guest") return "Guest";
  return providerId.replace(/\.com$/i, "");
}

export interface SignupNotificationOptions {
  email: string;
  providerId?: string | null;
  country?: string | null;
  device?: DeviceClass | string | null;
  os?: OsFamily | string | null;
  browser?: BrowserFamily | string | null;
  guestSparksSpent?: number | null;
}

/**
 * Format the single-line compact signup alert for Slack (#growth).
 * e.g. "🎉 New signup — xyz@gmail.com (Google) · 🇺🇸 US · Desktop · macOS · Chrome · ⚡ 3 guest sparks spent"
 */
export function formatSignupSlackMessage(opts: SignupNotificationOptions): string {
  const provider = formatProviderLabel(opts.providerId);
  const base = `🎉 New signup — ${opts.email} (${provider})`;

  const segments: string[] = [base];

  // Country
  const c = (opts.country || "").trim().toUpperCase();
  if (c && c !== UNKNOWN_COUNTRY && c !== "XX" && c !== "ZZ") {
    segments.push(`${countryFlag(c)} ${c}`);
  } else {
    segments.push("🌍 Unknown");
  }

  // Device / OS / Browser
  if (opts.device && opts.device !== "unknown") {
    segments.push(deviceLabel(opts.device));
  }
  if (opts.os && opts.os !== "other" && opts.os !== "unknown") {
    segments.push(osLabel(opts.os));
  }
  if (opts.browser && opts.browser !== "other" && opts.browser !== "unknown") {
    segments.push(browserLabel(opts.browser));
  }

  // Guest sparks spent
  const spent =
    typeof opts.guestSparksSpent === "number" && Number.isFinite(opts.guestSparksSpent)
      ? Math.max(0, Math.round(opts.guestSparksSpent))
      : 0;
  if (spent > 0) {
    segments.push(`⚡ ${spent} guest spark${spent === 1 ? "" : "s"} spent`);
  } else {
    segments.push("⚡ 0 guest sparks spent");
  }

  return segments.join(" · ");
}

/** Total sparks spent from the user's ledger (e.g. prior guest usage before signup). */
export async function getSparksSpent(uid: string): Promise<number> {
  try {
    ensureAdmin();
    const snap = await getFirestore()
      .collection(`users/${uid}/sparksLedger`)
      .where("type", "==", "spend")
      .get();
    let total = 0;
    for (const doc of snap.docs) {
      const amt = doc.data()?.amount;
      if (typeof amt === "number") {
        total += Math.abs(amt);
      }
    }
    return total;
  } catch (err) {
    console.warn("[notify] could not load sparks spent", err);
    return 0;
  }
}

