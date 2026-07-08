/**
 * The email template registry — the single map from a template id to its
 * metadata (label, category, default sender, sample vars) and its renderer.
 *
 * The admin dashboard reads {@link EMAIL_TEMPLATE_REGISTRY} to list templates,
 * preview them with {@link SAMPLE_VARS}, and drive per-template toggles. The
 * backend calls {@link renderEmail} to produce the MIME trio at send time.
 */
import { RENDERERS } from "./templates";
import {
  EMAIL_TEMPLATE_IDS,
  type EmailCategory,
  type EmailSenderKey,
  type EmailTemplateId,
  type EmailTemplateVarsMap,
  type RenderContext,
  type RenderedEmail,
} from "./types";

export interface EmailTemplateMeta<Id extends EmailTemplateId> {
  id: Id;
  label: string;
  description: string;
  category: EmailCategory;
  defaultSenderKey: EmailSenderKey;
  /** Realistic sample vars for the admin preview + "send test" action. */
  sample: EmailTemplateVarsMap[Id];
}

type Registry = { [Id in EmailTemplateId]: EmailTemplateMeta<Id> };

export const EMAIL_TEMPLATE_REGISTRY: Registry = {
  welcome: {
    id: "welcome",
    label: "Welcome",
    description: "Sent after a new account is created — introduces the product.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex" },
  },
  order_confirmation: {
    id: "order_confirmation",
    label: "Order confirmation",
    description: "Sent when a print order is paid and queued for printing.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", orderRef: "CB-10428", itemLabel: "Hardcover picture book · 24 pages" },
  },
  order_shipped: {
    id: "order_shipped",
    label: "Order shipped",
    description: "Sent when the print provider ships the book.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", orderRef: "CB-10428", carrier: "DHL", trackingUrl: "https://example.com/track/123" },
  },
  order_failed: {
    id: "order_failed",
    label: "Order problem",
    description: "Sent if a paid order fails to reach the printer after retries.",
    category: "transactional",
    defaultSenderKey: "support",
    sample: { name: "Alex", orderRef: "CB-10428" },
  },
  subscription_started: {
    id: "subscription_started",
    label: "Subscription started",
    description: "Sent when a subscription becomes active.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", planName: "Storyteller", sparks: 500 },
  },
  subscription_cancelled: {
    id: "subscription_cancelled",
    label: "Subscription cancelled",
    description: "Sent when a subscription is set to cancel.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", planName: "Storyteller", endDate: "August 1, 2026" },
  },
  sparks_purchased: {
    id: "sparks_purchased",
    label: "Sparks purchased",
    description: "Sent after a one-time Spark pack purchase.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", sparks: 300, balance: 420 },
  },
  gift_purchased: {
    id: "gift_purchased",
    label: "Gift purchased",
    description: "Sent to the buyer of a Spark gift with the claim code.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", sparks: 300, code: "K3ZQ-8MHW-P2XA", recipientEmail: "jamie@example.com" },
  },
  gift_received: {
    id: "gift_received",
    label: "Gift received",
    description: "Sent to a gift recipient when an email address was provided.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { sparks: 300, code: "K3ZQ-8MHW-P2XA", senderName: "Alex", message: "Have fun making a book!" },
  },
  gift_claimed: {
    id: "gift_claimed",
    label: "Gift claimed",
    description: "Sent to the person who redeems a gift code.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Jamie", sparks: 300, balance: 300 },
  },
  referral_reward: {
    id: "referral_reward",
    label: "Referral reward",
    description: "Sent to referrer/referred when a referral reward is granted.",
    category: "transactional",
    defaultSenderKey: "default",
    sample: { name: "Alex", sparks: 100, kind: "referrer" },
  },
};

/** Ordered list of template metadata (drives the admin list). */
export const EMAIL_TEMPLATES: EmailTemplateMeta<EmailTemplateId>[] = EMAIL_TEMPLATE_IDS.map(
  (id) => EMAIL_TEMPLATE_REGISTRY[id] as EmailTemplateMeta<EmailTemplateId>,
);

/** Render a template to its subject/html/text trio. */
export function renderEmail<Id extends EmailTemplateId>(
  id: Id,
  vars: EmailTemplateVarsMap[Id],
  ctx: RenderContext,
): RenderedEmail {
  const renderer = RENDERERS[id];
  return renderer(vars, ctx);
}

/** Convenience: render a template with its built-in sample vars (previews/tests). */
export function renderSample<Id extends EmailTemplateId>(id: Id, ctx: RenderContext): RenderedEmail {
  return renderEmail(id, EMAIL_TEMPLATE_REGISTRY[id].sample, ctx);
}
