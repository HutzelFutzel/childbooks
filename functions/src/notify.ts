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
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getSlackConfig } from "./appConfig";
import { slackMessageEnabled } from "../../books-frontend/src/core/config/slackConfig";
import type { SlackChannel, SlackMessageKey } from "../../books-frontend/src/core/notify/registry";
import { UNKNOWN_COUNTRY, countryFlag } from "../../books-frontend/src/core/analytics/markets";
import {
  deviceLabel,
  osLabel,
  type DeviceClass,
  type OsFamily,
  type BrowserFamily,
} from "../../books-frontend/src/core/analytics/device";
import {
  describeArrivalToken,
  normalizeAcquisitionProfile,
  type AcquisitionProfile,
} from "../../books-frontend/src/core/profile/acquisition";

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

const SLACK_POST_TIMEOUT_MS = 5_000;
const SLACK_POST_ATTEMPTS = 2;
const SLACK_RETRY_DELAY_MS = 300;

function slackMarkerId(channel: NotifyChannel, ref: string): string {
  return `${channel}_${ref}`.replace(/\//g, "_");
}

function slackMarkerRef(id: string) {
  return getFirestore().collection("slackNotified").doc(id);
}

async function claimSlackMarker(id: string): Promise<"claimed" | "duplicate" | "skipped"> {
  try {
    ensureAdmin();
    await slackMarkerRef(id).create({ at: Date.now() });
    return "claimed";
  } catch (err) {
    // ALREADY_EXISTS ⇒ we've pinged for this fact before; stay quiet.
    if ((err as { code?: number }).code === 6) return "duplicate";
    // Any other marker failure: fall through and still try to notify — a
    // possible duplicate beats a missed alert.
    return "skipped";
  }
}

/** Drop a reservation so a later retry can send. Best-effort; never throws. */
async function releaseSlackMarker(id: string): Promise<void> {
  try {
    await slackMarkerRef(id).delete();
  } catch {
    // Leaving a stuck marker is worse than a possible duplicate, but a delete
    // hiccup isn't worth failing the caller — they already got `reason: error`.
  }
}

async function postSlackWebhook(
  url: string,
  payload: { text: string; blocks?: unknown[] },
): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SLACK_POST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.blocks?.length ? payload : { text: payload.text }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[notify] slack responded", res.status);
      return false;
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post a plain-text message to Slack.
 *
 * When `ref` is supplied the message is sent AT MOST ONCE: a tiny Firestore
 * marker (`slackNotified/{channel}_{ref}`) makes retries idempotent, so a
 * Stripe webhook that fires twice (or a subscription that stays "active" across
 * renewals) only pings once. The marker is a reservation, not a delivery
 * receipt: if the webhook POST fails (or the instance dies mid-send) it is
 * released so a later retry can actually notify, rather than being treated as
 * a duplicate of a ping that never arrived.
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
  let claimedKey: string | null = null;
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

    if (!opts.force && opts.ref) {
      const key = slackMarkerId(channel, opts.ref);
      const claim = await claimSlackMarker(key);
      if (claim === "duplicate") return { sent: false, reason: "duplicate" };
      if (claim === "claimed") claimedKey = key;
    }

    const payload = {
      text: opts.text,
      ...(opts.blocks?.length ? { blocks: opts.blocks } : {}),
    };

    for (let attempt = 1; attempt <= SLACK_POST_ATTEMPTS; attempt++) {
      try {
        if (await postSlackWebhook(url, payload)) return { sent: true };
      } catch (err) {
        console.error("[notify] slack failed", err);
      }
      if (attempt < SLACK_POST_ATTEMPTS) await sleep(SLACK_RETRY_DELAY_MS);
    }

    if (claimedKey) await releaseSlackMarker(claimedKey);
    return { sent: false, reason: "error" };
  } catch (err) {
    console.error("[notify] slack failed", err);
    if (claimedKey) await releaseSlackMarker(claimedKey);
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
  /** Compact attribution tag when non-direct (e.g. "via QR code · berlin-window"). */
  arrival?: string | null;
  /** Books the user already started as a guest before creating their account. */
  guestBooks?: number | null;
}

/** Format a valid ISO-2 country code as "🇺🇸 US", or null when unknown. */
export function formatCountryTag(country?: string | null): string | null {
  const c = (country || "").trim().toUpperCase();
  if (!c || c === UNKNOWN_COUNTRY || c === "XX" || c === "ZZ") return null;
  return `${countryFlag(c)} ${c}`;
}

/**
 * Format an account's acquisition profile into a short, high-signal phrase,
 * or null when the visit was direct with no referrer.
 */
export function formatArrivalForSlack(acq?: AcquisitionProfile | null): string | null {
  const arr = acq?.first ?? acq?.latest ?? null;
  if (!arr) return null;
  if (arr.kind === "utm") {
    const utm = [arr.source, arr.medium, arr.campaign].filter(Boolean).join("/");
    if (utm) return `via ${utm}`;
  }
  if (arr.kind !== "direct") {
    return `via ${describeArrivalToken(arr.token)}`;
  }
  if (arr.referrerHost) {
    return `from ${arr.referrerHost}`;
  }
  return null;
}

/**
 * Format the single-line compact signup alert for Slack (#growth).
 * Only includes non-empty, high-signal segments (no "Unknown" country or "0 sparks" noise).
 * e.g. "🎉 New signup — xyz@gmail.com (Google) · 🇺🇸 US · Desktop (macOS) · via QR code · berlin · ⚡ 3 guest sparks"
 */
export function formatSignupSlackMessage(opts: SignupNotificationOptions): string {
  const provider = formatProviderLabel(opts.providerId);
  const segments: string[] = [`🎉 New signup — ${opts.email} (${provider})`];

  const countryTag = formatCountryTag(opts.country);
  if (countryTag) segments.push(countryTag);

  const hasDevice = Boolean(opts.device && opts.device !== "unknown");
  const hasOs = Boolean(opts.os && opts.os !== "other" && opts.os !== "unknown");
  if (hasDevice && hasOs) {
    segments.push(`${deviceLabel(opts.device!)} (${osLabel(opts.os!)})`);
  } else if (hasDevice) {
    segments.push(deviceLabel(opts.device!));
  } else if (hasOs) {
    segments.push(osLabel(opts.os!));
  }

  if (opts.arrival) {
    segments.push(opts.arrival);
  }

  const books =
    typeof opts.guestBooks === "number" && Number.isFinite(opts.guestBooks)
      ? Math.max(0, Math.round(opts.guestBooks))
      : 0;
  if (books > 0) {
    segments.push(`📖 ${books} guest book${books === 1 ? "" : "s"}`);
  }

  const spent =
    typeof opts.guestSparksSpent === "number" && Number.isFinite(opts.guestSparksSpent)
      ? Math.max(0, Math.round(opts.guestSparksSpent))
      : 0;
  if (spent > 0) {
    segments.push(`⚡ ${spent} guest spark${spent === 1 ? "" : "s"}`);
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

export interface UserSlackIdentity {
  email: string | null;
  country: string | null;
  purchaseCount: number;
  projectCount: number;
  arrival: string | null;
}

/**
 * Best-effort lookup of a user's email, country, order count, and acquisition
 * tag for #growth Slack notifications. Never throws.
 */
export async function getUserSlackIdentity(uid: string | null | undefined): Promise<UserSlackIdentity> {
  const empty: UserSlackIdentity = {
    email: null,
    country: null,
    purchaseCount: 0,
    projectCount: 0,
    arrival: null,
  };
  if (!uid) return empty;
  try {
    ensureAdmin();
    const [authUser, userSnap] = await Promise.all([
      getAuth()
        .getUser(uid)
        .catch(() => null),
      getFirestore()
        .doc(`users/${uid}`)
        .get()
        .catch(() => null),
    ]);
    const data = (userSnap?.exists ? userSnap.data() : {}) as Record<string, unknown>;
    const lifetime = (data?.lifetime ?? {}) as Record<string, unknown>;
    const country =
      typeof data?.country === "string"
        ? data.country
        : typeof data?.signupCountry === "string"
          ? data.signupCountry
          : null;
    const rawPurchases = lifetime.purchases ?? data?.purchaseCount;
    const purchaseCount =
      typeof rawPurchases === "number" && Number.isFinite(rawPurchases)
        ? Math.max(0, Math.round(rawPurchases))
        : 0;
    const rawProjects = data?.projectCount ?? data?.projectCounter;
    const projectCount =
      typeof rawProjects === "number" && Number.isFinite(rawProjects)
        ? Math.max(0, Math.round(rawProjects))
        : 0;
    const arrival = formatArrivalForSlack(normalizeAcquisitionProfile(data?.acquisition));
    return {
      email: authUser?.email ?? null,
      country,
      purchaseCount,
      projectCount,
      arrival,
    };
  } catch {
    return empty;
  }
}

export interface PurchaseNotificationOptions {
  kind: "order" | "ebook" | "sparkPack" | "sparkGift" | string;
  gross: number;
  currency: string;
  /** Estimated net after Stripe fees and (for print orders) Lulu production + shipping, in `currency`. */
  netAfterCosts?: number | null;
  /** Human item summary from the payment record, e.g. "Square Hardcover ×2". */
  itemDescription?: string | null;
  /** Page count for printed books. */
  pageCount?: number | null;
  /** Title of the book (print or ebook). */
  bookTitle?: string | null;
  /** Sparks count for pack / gift purchases. */
  sparks?: number | null;
  /** Gift recipient email (for sparkGift). */
  recipientEmail?: string | null;
  /** Buyer email. */
  buyerEmail?: string | null;
  /** Billing country code (ISO-2). */
  billingCountry?: string | null;
  /** Shipping destination country code (ISO-2, print orders). */
  destinationCountry?: string | null;
  /** 1-based lifetime order number for this buyer (only shown when >= 2). */
  orderNumber?: number | null;
}

/**
 * Format a compact, high-signal purchase alert for #growth.
 * e.g. `📦 Print order — 34.99 EUR (~13.20 EUR net) · Square Hardcover ×1 (24p) · "Leo's Moon" · maya@gmail.com · 🇩🇪 DE · 🔁 Order #2`
 */
export function formatPurchaseSlackMessage(opts: PurchaseNotificationOptions): string {
  const label =
    opts.kind === "order"
      ? "📦 Print order"
      : opts.kind === "ebook"
        ? "📖 Ebook purchased"
        : opts.kind === "sparkGift"
          ? "🎁 Spark gift"
          : "✨ Spark pack";

  const priceStr =
    typeof opts.netAfterCosts === "number" && Number.isFinite(opts.netAfterCosts)
      ? `${money(opts.gross, opts.currency)} (~${money(opts.netAfterCosts, opts.currency)} net)`
      : money(opts.gross, opts.currency);

  const segments: string[] = [`${label} — ${priceStr}`];

  const cleanTitle = opts.bookTitle?.trim().replace(/\s+/g, " ").slice(0, 60) || null;

  if (opts.kind === "order") {
    const desc = opts.itemDescription?.trim() || null;
    const pages =
      typeof opts.pageCount === "number" && opts.pageCount > 0 ? `${opts.pageCount}p` : null;
    if (desc && pages) segments.push(`${desc} (${pages})`);
    else if (desc) segments.push(desc);
    else if (pages) segments.push(pages);
    if (cleanTitle) segments.push(`"${cleanTitle}"`);
  } else if (opts.kind === "ebook") {
    if (cleanTitle) segments.push(`"${cleanTitle}"`);
  } else if (opts.kind === "sparkGift") {
    const sp = typeof opts.sparks === "number" && opts.sparks > 0 ? `${opts.sparks} Sparks` : null;
    if (sp && opts.recipientEmail) segments.push(`${sp} → ${opts.recipientEmail}`);
    else if (sp) segments.push(sp);
    else if (opts.recipientEmail) segments.push(`→ ${opts.recipientEmail}`);
  } else {
    const sp =
      typeof opts.sparks === "number" && opts.sparks > 0
        ? `${opts.sparks} Sparks`
        : opts.itemDescription?.trim() || null;
    if (sp) segments.push(sp);
  }

  if (opts.buyerEmail) {
    segments.push(opts.buyerEmail);
  }

  const billTag = formatCountryTag(opts.billingCountry);
  const destTag = formatCountryTag(opts.destinationCountry);
  if (billTag && destTag && billTag !== destTag) {
    segments.push(`${billTag} → ${destTag}`);
  } else if (destTag || billTag) {
    segments.push((destTag ?? billTag)!);
  }

  if (typeof opts.orderNumber === "number" && opts.orderNumber >= 2) {
    segments.push(`🔁 Order #${opts.orderNumber}`);
  }

  return segments.join(" · ");
}

export interface SubscriptionNotificationOptions {
  event: "started" | "cancelled";
  planName: string;
  amount?: number | null;
  currency?: string | null;
  interval?: "month" | "year" | string | null;
  trialing?: boolean;
  email?: string | null;
  country?: string | null;
  /** Subscription start timestamp (epoch ms) to compute tenure on cancellation. */
  startedAtMs?: number | null;
}

function formatTenure(startedAtMs?: number | null, nowMs = Date.now()): string | null {
  if (typeof startedAtMs !== "number" || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return null;
  }
  const days = Math.max(0, Math.round((nowMs - startedAtMs) / 86_400_000));
  if (days < 1) return "same day";
  if (days < 45) return `${days}d`;
  const months = Math.round(days / 30.4);
  return `${months} mo${months === 1 ? "" : "s"}`;
}

/**
 * Format a compact subscription started/canceled alert for #growth.
 */
export function formatSubscriptionSlackMessage(opts: SubscriptionNotificationOptions): string {
  const intervalSuffix =
    opts.interval === "year" ? "/yr" : opts.interval === "month" ? "/mo" : "";
  const priceBit =
    typeof opts.amount === "number" && opts.amount > 0 && opts.currency
      ? `${money(opts.amount, opts.currency)}${intervalSuffix}`
      : null;

  const segments: string[] = [];
  if (opts.event === "started") {
    const trialTag = opts.trialing ? " (trial)" : "";
    segments.push(`💳 New subscriber — ${opts.planName}${trialTag}`);
    if (priceBit) segments.push(priceBit);
  } else {
    segments.push(
      `👋 Subscription canceled — ${opts.planName}${priceBit ? ` (${priceBit})` : ""}`,
    );
  }

  if (opts.email) segments.push(opts.email);
  const countryTag = formatCountryTag(opts.country);
  if (countryTag) segments.push(countryTag);

  if (opts.event === "cancelled") {
    const tenure = formatTenure(opts.startedAtMs);
    if (tenure) segments.push(`after ${tenure}`);
  }

  return segments.join(" · ");
}

export interface CouponNotificationOptions {
  couponName: string;
  code?: string | null;
  discountAmount: number;
  orderAmount: number;
  currency: string;
  itemLabel: string;
  email?: string | null;
  isNewCustomer?: boolean;
  usesLeft?: number | null;
}

/**
 * Format a coupon redemption alert for #growth.
 * Surfaces remaining uses only when finite and <= 10 so running-out codes stand out without noise.
 */
export function formatCouponSlackMessage(opts: CouponNotificationOptions): string {
  const tag = opts.code ? `${opts.code} (${opts.couponName})` : `${opts.couponName} (auto)`;
  const segments: string[] = [
    `🎟️ Coupon used — ${tag}: -${money(opts.discountAmount, opts.currency)} on ${opts.itemLabel} · paid ${money(opts.orderAmount, opts.currency)}`,
  ];
  if (opts.email) segments.push(opts.email);
  if (opts.isNewCustomer) segments.push("new customer");
  if (typeof opts.usesLeft === "number" && Number.isFinite(opts.usesLeft) && opts.usesLeft <= 10) {
    segments.push(opts.usesLeft <= 0 ? "last use" : `${opts.usesLeft} left`);
  }
  return segments.join(" · ");
}

/** Best-effort lookup of a book's title from the project mirror (`projects/{uid}__{projectId}`). */
export async function getProjectTitle(
  uid: string | null | undefined,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!uid || !projectId) return null;
  try {
    ensureAdmin();
    const snap = await getFirestore().doc(`projects/${uid}__${projectId}`).get();
    const title = snap.exists ? snap.get("derived.title") : null;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}

export interface ReferralAcceptedNotificationOptions {
  channel: "email" | "link" | string;
  inviterEmail?: string | null;
  inviterUid: string;
  friendEmail?: string | null;
  friendUid?: string | null;
}

export function formatReferralAcceptedSlackMessage(
  opts: ReferralAcceptedNotificationOptions,
): string {
  const friendWho = opts.friendEmail || (opts.friendUid ? opts.friendUid.slice(0, 8) : "a friend");
  const inviterWho = opts.inviterEmail || opts.inviterUid.slice(0, 8);
  const via = opts.channel === "email" ? "emailed invite" : "shared link";
  return `🤝 Referral accepted — ${friendWho} joined via ${via} from ${inviterWho}`;
}

export interface ReferralRewardNotificationOptions {
  summary: string;
  side: "referrer" | "referred" | string;
  unlocks: string;
  recipientEmail?: string | null;
  uid: string;
}

export function formatReferralRewardSlackMessage(
  opts: ReferralRewardNotificationOptions,
): string {
  const who = opts.recipientEmail || opts.uid.slice(0, 8);
  return `🎁 Referral reward — ${opts.summary} to ${opts.side} ${who} (${opts.unlocks})`;
}

export interface CampaignPayoutNotificationOptions {
  campaignName: string;
  effectSummary: string;
  triggerSummary: string;
  recipientEmail?: string | null;
  uid?: string | null;
}

export function formatCampaignPayoutSlackMessage(
  opts: CampaignPayoutNotificationOptions,
): string {
  const who = opts.recipientEmail || (opts.uid ? opts.uid.slice(0, 8) : null);
  return `🎁 ${opts.campaignName} paid out — ${opts.effectSummary}${who ? ` to ${who}` : ""} (${opts.triggerSummary})`;
}



