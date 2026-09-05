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
  "referral_invite",
  "referral_invite_sent",
  "referral_invite_accepted",
  "referral_reminder",
  "referral_reward",
  "coupon_granted",
  "coupon_redeemed",
  "contact_form",
  "contact_form_ack",
  "affiliate_application_ack",
  "policy_update",
  "admin_invite",
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

/** The footer/contact block shown in every email, from `adminSettings/emailConfig`. */
export interface EmailFooterContext {
  footerText: string;
  /**
   * Carried through for internal callers (e.g. `contactRecipient` fallback);
   * deliberately NOT rendered in the footer — see `footerHtml` in `layout.ts`.
   */
  supportEmail: string;
  /** Optional extra "Help center" link; the footer's `/contact` link is always shown too. */
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
  /**
   * The invitation itself, sent to an address the inviter typed. Person-to-person
   * and one-off (with its own decline link, which suppresses the address
   * permanently), so it's transactional rather than marketing — the same footing
   * as `gift_received`, which also goes to someone who has no account yet.
   *
   * `benefit` is the frozen promise from the invitation's terms, never re-derived
   * from the live config.
   */
  referral_invite: {
    inviterName?: string;
    benefit: string;
    acceptUrl: string;
    declineUrl: string;
    message?: string;
    expiresOn?: string;
  };
  /** Receipt for the inviter: what was promised, to whom, and their share link. */
  referral_invite_sent: {
    name?: string;
    recipientEmail: string;
    benefit: string;
    inviteUrl: string;
  };
  /** The moment worth celebrating: someone accepted, here's what's still to come. */
  referral_invite_accepted: {
    name?: string;
    friendName?: string;
    benefit: string;
    /** What still has to happen before the reward lands. */
    pending?: string;
  };
  /** One nudge, sent once, to an invitation that was never opened. */
  referral_reminder: {
    inviterName?: string;
    benefit: string;
    acceptUrl: string;
    declineUrl: string;
    expiresOn?: string;
  };
  /**
   * A reward landed. `benefit` describes it in words ("100 Sparks", "15% off your
   * next book") because rewards are no longer only Sparks; `sparks`/`balance`
   * stay optional so a Spark reward can still show the new balance.
   */
  referral_reward: {
    name?: string;
    kind: "referrer" | "referred";
    benefit: string;
    sparks?: number;
    balance?: number;
    /** How to use it, when the reward isn't simply added to the balance. */
    howToUse?: string;
  };
  /**
   * A discount is now waiting on the account, without the customer having typed
   * anything — the auto-grant case (they scanned a code, we recognized the
   * arrival, they signed up).
   *
   * This email exists because a silent auto-grant is indistinguishable from no
   * grant at all: the whole point of the poster was to make someone feel they
   * got something, and a discount they only discover at checkout (or never)
   * wasted the acquisition. `summary` and `notes` are the FROZEN promise from the
   * grant's terms, never re-derived — the coupon may have been edited since.
   */
  coupon_granted: {
    name?: string;
    summary: string;
    notes?: string[];
    /** Present only for a code they'd have to type; auto-grants have none. */
    code?: string;
    expiresOn?: string;
    shopUrl?: string;
  };
  /**
   * A coupon actually came off a payment. Sent alongside (not instead of) the
   * order receipt: the receipt proves what they paid, this proves the discount
   * worked, and conflating the two is how "did my code apply?" support tickets
   * start.
   */
  coupon_redeemed: {
    name?: string;
    summary: string;
    /** Formatted with its currency symbol by the caller, e.g. "€8.40". */
    savedAmount: string;
    itemLabel: string;
    orderRef?: string;
    code?: string;
    /** Set when the same coupon can still be used again. */
    usesLeft?: number;
  };
  /** Sent to the support inbox when a visitor submits the public contact form. */
  contact_form: { fromName: string; fromEmail: string; topic?: string; message: string };
  /**
   * Sent to the SUBMITTER right after `/contact` accepts their message. This is
   * the trust signal that makes a contact form a credible substitute for a
   * published address — without it, the visitor has only our word that anything
   * happened. `ref` is the human-quotable reference they can cite if they follow
   * up; `topic` is the resolved label (e.g. "Billing, refund, or subscription"),
   * not the raw submitted id; `message` is echoed back so they have a record of
   * what they sent.
   */
  contact_form_ack: { name?: string; ref: string; topic?: string; message: string };
  /**
   * Sent to the applicant after `/affiliate-applications` accepts their form.
   * Confirms we received the application and sets the "we'll review" expectation;
   * `ref` is the quotable reference.
   */
  affiliate_application_ack: {
    name?: string;
    ref: string;
    channel: string;
    channelUrl: string;
    audience: string;
    pitch: string;
  };
  /**
   * Sent to users when a legal document changes materially. A service message
   * about the account's governing policy — transactional, NOT gated on marketing
   * opt-in.
   */
  policy_update: { name?: string; policyName: string; effectiveDate?: string; documentUrl: string };
  /**
   * Sent when a T1/T2 owner invites someone who has no account yet. Carries a
   * Firebase password-set action link (generated server-side, same mechanism
   * as a password reset) so the very first thing they do is set a password —
   * they land already granted plain-admin access (an owner sets what they can
   * actually see afterward).
   */
  admin_invite: { inviterName?: string; setPasswordUrl: string };
}

export type EmailTemplateVars<Id extends EmailTemplateId> = EmailTemplateVarsMap[Id];
