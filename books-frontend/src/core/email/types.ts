/**
 * Shared, framework-agnostic types for the system-email layer.
 *
 * These are imported by BOTH the backend (which renders + sends via ZeptoMail)
 * and the admin dashboard (which previews templates and edits the config), so
 * this module stays pure: no React, no Firebase, no Node APIs.
 *
 * The single source of truth for "what emails exist" is {@link EMAIL_TEMPLATE_IDS}.
 * Adding an email = add an id here, a vars type in {@link EmailTemplateVarsMap},
 * and an entry in the registry (`registry.ts`). The admin toggle/stats and the
 * backend send path pick it up automatically.
 */

/** Transactional emails are always allowed; marketing requires opt-in + unsubscribe. */
export type EmailCategory = "transactional" | "marketing";

/** Which configured "from" identity an email is sent as. */
export type EmailSenderKey = "default" | "support" | "marketing";

/** Every system email the product can send. Order drives the admin list order. */
export const EMAIL_TEMPLATE_IDS = [
  "welcome",
  "order_confirmation",
  "order_shipped",
  "order_failed",
  "subscription_started",
  "subscription_cancelled",
  "sparks_purchased",
  "gift_purchased",
  "gift_received",
  "gift_claimed",
  "referral_reward",
  "contact_form",
  "policy_update",
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export function isEmailTemplateId(v: unknown): v is EmailTemplateId {
  return typeof v === "string" && (EMAIL_TEMPLATE_IDS as readonly string[]).includes(v);
}

/** Every kind of delivery outcome we count for a template (fed by ZeptoMail webhooks). */
export const EMAIL_EVENT_TYPES = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
  "complained",
  "unsubscribed",
] as const;

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

/**
 * The brand kit an email renders with, projected from `appConfig/branding`
 * (+ `appConfig/seo` for the site URL) at send time so every email always uses
 * the latest logo/colors without a deploy.
 */
export interface BrandContext {
  brandName: string;
  tagline: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  /** Canonical site URL, no trailing slash (used to build action links). */
  siteUrl: string;
}

/** The footer/contact block shown in every email, from `appConfig/emailConfig`. */
export interface EmailFooterContext {
  footerText: string;
  supportEmail: string;
  supportUrl: string;
  /** One-click unsubscribe URL — only rendered for marketing emails. */
  unsubscribeUrl: string | null;
  /** Postal address (CAN-SPAM). Rendered when non-empty. */
  physicalAddress: string;
}

/** Everything a template render function needs beyond its own vars. */
export interface RenderContext {
  brand: BrandContext;
  footer: EmailFooterContext;
  category: EmailCategory;
}

/** The output of rendering a template: a full MIME-ready trio. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Per-template variables. Keep these flat and JSON-serializable (they travel
 * through Firestore for the dedupe/test paths and are echoed in previews).
 */
export interface EmailTemplateVarsMap {
  welcome: { name?: string; verifyUrl?: string };
  order_confirmation: { name?: string; orderRef: string; itemLabel: string; orderUrl?: string };
  order_shipped: { name?: string; orderRef: string; carrier?: string; trackingUrl?: string };
  order_failed: { name?: string; orderRef: string };
  subscription_started: { name?: string; planName: string; sparks?: number; manageUrl?: string };
  subscription_cancelled: { name?: string; planName: string; endDate?: string };
  sparks_purchased: { name?: string; sparks: number; balance?: number };
  gift_purchased: { name?: string; sparks: number; code: string; recipientEmail?: string };
  gift_received: { sparks: number; code: string; message?: string; senderName?: string; claimUrl?: string };
  gift_claimed: { name?: string; sparks: number; balance?: number };
  referral_reward: { name?: string; sparks: number; kind: "referrer" | "referred" };
  /** Sent to the support inbox when a visitor submits the public contact form. */
  contact_form: { fromName: string; fromEmail: string; topic?: string; message: string };
  /**
   * Sent to users when a legal document changes materially. A service message
   * about the account's governing policy — transactional, NOT gated on marketing
   * opt-in.
   */
  policy_update: { name?: string; policyName: string; effectiveDate?: string; documentUrl: string };
}

export type EmailTemplateVars<Id extends EmailTemplateId> = EmailTemplateVarsMap[Id];
