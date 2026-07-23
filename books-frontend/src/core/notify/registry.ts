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
export type SlackChannel = "growth" | "ops";

/** Every distinct Slack message the product can send. Order drives the admin list. */
export const SLACK_MESSAGE_IDS = [
  "signup",
  "purchase",
  "subscription_started",
  "subscription_cancelled",
  "referral_paid",
  "admin_alert",
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
  referral_paid: {
    id: "referral_paid",
    label: "Referral paid out",
    description: "Posted to #growth when a referral reward is paid after a first purchase.",
    channel: "growth",
  },
  admin_alert: {
    id: "admin_alert",
    label: "Admin / ops alerts",
    description:
      "Posted to #ops for operational alerts (fulfillment failures, refunds, grant abuse). Turning this off hides operational problems — leave on unless you have another alerting path.",
    channel: "ops",
  },
};

/** Ordered list of message metadata (drives the admin list). */
export const SLACK_MESSAGES: SlackMessageMeta[] = SLACK_MESSAGE_IDS.map(
  (id) => SLACK_MESSAGE_REGISTRY[id],
);
