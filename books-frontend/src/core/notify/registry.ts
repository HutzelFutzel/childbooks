/**
 * The Slack notification registry — the single source of truth for "what Slack
 * messages the product can send".
 *
 * Imported by BOTH the backend (which gates each `notifySlack` call on the
 * admin toggle) and the admin dashboard (Communication → Admin Slack, which
 * renders one toggle per message). Keep this module pure: no React, no Firebase,
 * no Node APIs.
 *
 * Adding a Slack message = add an id here + a registry entry, then pass that id
 * as `messageKey` at the `notifySlack` call site. The admin toggle picks it up
 * automatically.
 */

/** Which Slack channel a message posts to (drives which webhook URL is used). */
export type SlackChannel = "growth" | "ops" | "contact" | "release";

/** Every channel, in admin-display order (drives the test-send buttons). */
export const SLACK_CHANNELS = ["growth", "ops", "contact", "release"] as const;

export function isSlackChannel(v: unknown): v is SlackChannel {
  return typeof v === "string" && (SLACK_CHANNELS as readonly string[]).includes(v);
}

/** Every distinct Slack message the product can send. Order drives the admin list. */
export const SLACK_MESSAGE_IDS = [
  "signup",
  "purchase",
  "subscription_started",
  "subscription_cancelled",
  "referral_accepted",
  "referral_paid",
  "coupon_redeemed",
  "contact_form",
  "affiliate_application",
  "admin_alert",
  "daily_summary",
  "release_notes",
] as const;

export type SlackMessageKey = (typeof SLACK_MESSAGE_IDS)[number];

export function isSlackMessageKey(v: unknown): v is SlackMessageKey {
  return typeof v === "string" && (SLACK_MESSAGE_IDS as readonly string[]).includes(v);
}

export interface SlackMessageMeta {
  id: SlackMessageKey;
  label: string;
  description: string;
  channel: SlackChannel;
}

export const SLACK_MESSAGE_REGISTRY: Record<SlackMessageKey, SlackMessageMeta> = {
  signup: {
    id: "signup",
    label: "New signup",
    description: "Posted to #growth when a real (non-guest) account is created.",
    channel: "growth",
  },
  purchase: {
    id: "purchase",
    label: "Purchase / order placed",
    description: "Posted to #growth on a paid print order, ebook, Spark pack or gift.",
    channel: "growth",
  },
  subscription_started: {
    id: "subscription_started",
    label: "New subscriber",
    description: "Posted to #growth when a subscription becomes active.",
    channel: "growth",
  },
  subscription_cancelled: {
    id: "subscription_cancelled",
    label: "Subscription cancelled",
    description: "Posted to #growth when a subscription is cancelled.",
    channel: "growth",
  },
  referral_accepted: {
    id: "referral_accepted",
    label: "Referral accepted",
    description: "Posted to #growth when someone joins through an invitation — the referral funnel's leading signal.",
    channel: "growth",
  },
  referral_paid: {
    id: "referral_paid",
    label: "Referral paid out",
    description: "Posted to #growth when a referral reward is granted to either side.",
    channel: "growth",
  },
  coupon_redeemed: {
    id: "coupon_redeemed",
    label: "Coupon redeemed",
    description:
      "Posted to #growth when a coupon is actually used on a settled payment — not when someone merely types a valid code. Carries the code, the discount given, and the order it came off, so a leaked or over-performing code is visible while it's still cheap to pause.",
    channel: "growth",
  },
  contact_form: {
    id: "contact_form",
    label: "Contact form submission",
    description: "Posted to #contact when a visitor submits the public contact form.",
    channel: "contact",
  },
  affiliate_application: {
    id: "affiliate_application",
    label: "Affiliate application",
    description:
      "Posted to #growth when someone applies to the affiliate program. Review, then create them in Rewardful if approved.",
    channel: "growth",
  },
  admin_alert: {
    id: "admin_alert",
    label: "Admin / ops alerts",
    description:
      "Posted to #ops for operational alerts (fulfillment failures, refunds, grant abuse). Turning this off hides operational problems — leave on unless you have another alerting path.",
    channel: "ops",
  },
  daily_summary: {
    id: "daily_summary",
    label: "Daily KPI summary",
    description:
      "Posted to #growth once a day (evening) with signups, logins, revenue, orders and other headline KPIs for the day.",
    channel: "growth",
  },
  release_notes: {
    id: "release_notes",
    label: "What's new (release notes)",
    description:
      "Posted to #releases after every deploy that reaches the live site: an AI summary of what changed since the last release, written for non-technical readers. Releases with nothing user-visible post nothing at all. Nothing gets skipped either — when a release can't be summarized, its changes are carried into the next one, which is why a note sometimes covers several days. Generated with no human review; the model and its prompt are under Configuration → AI pipeline.",
    channel: "release",
  },
};

/** Ordered list of message metadata (drives the admin list). */
export const SLACK_MESSAGES: SlackMessageMeta[] = SLACK_MESSAGE_IDS.map(
  (id) => SLACK_MESSAGE_REGISTRY[id],
);
