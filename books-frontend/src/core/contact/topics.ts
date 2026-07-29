/**
 * The contact-form topic registry — the single source of truth for "what a
 * visitor can be writing to us about".
 *
 * Imported by BOTH the public form (which renders the select) and the backend
 * (which validates the submitted id and stores the topic on the message so the
 * admin inbox can filter by it). Keep this module pure: no React, no Firebase,
 * no Node APIs.
 *
 * Every topic notifies the same #contact Slack channel (see
 * core/notify/registry.ts) — topic is a LABEL for the admin inbox, not a
 * routing decision. `timeSensitive` still flags legally time-boxed topics
 * (e.g. GDPR) within that single channel rather than splitting them off.
 */

/** Order drives the select. `other` is the fallback for anything unrecognized. */
export const CONTACT_TOPIC_IDS = [
  "order",
  "billing",
  "bug",
  "privacy",
  "press",
  "other",
] as const;

export type ContactTopicId = (typeof CONTACT_TOPIC_IDS)[number];

export function isContactTopicId(v: unknown): v is ContactTopicId {
  return typeof v === "string" && (CONTACT_TOPIC_IDS as readonly string[]).includes(v);
}

export interface ContactTopicMeta {
  id: ContactTopicId;
  /** Shown in the select. */
  label: string;
  /**
   * Marks topics carrying a legal deadline — GDPR data-subject requests must be
   * answered within one month (Art. 12(3)), so they're flagged in the admin
   * inbox rather than sitting in the same undifferentiated pile.
   */
  timeSensitive?: boolean;
}

export const CONTACT_TOPIC_REGISTRY: Record<ContactTopicId, ContactTopicMeta> = {
  order: {
    id: "order",
    label: "Problem with an order",
  },
  billing: {
    id: "billing",
    label: "Billing, refund, or subscription",
  },
  bug: {
    id: "bug",
    label: "Something is broken",
  },
  privacy: {
    id: "privacy",
    label: "Privacy or data request",
    timeSensitive: true,
  },
  press: {
    id: "press",
    label: "Press or partnership",
  },
  other: {
    id: "other",
    label: "Something else",
  },
};

/** Registry list in display order (for the select). */
export const CONTACT_TOPICS: ContactTopicMeta[] = CONTACT_TOPIC_IDS.map(
  (id) => CONTACT_TOPIC_REGISTRY[id],
);

/** Resolve a topic id, falling back to `other` for anything unrecognized. */
export function contactTopic(id: unknown): ContactTopicMeta {
  return isContactTopicId(id) ? CONTACT_TOPIC_REGISTRY[id] : CONTACT_TOPIC_REGISTRY.other;
}
