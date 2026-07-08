/**
 * Global, admin-managed **email** configuration for system (transactional) and
 * marketing email sent via ZeptoMail.
 *
 * Owns everything an admin should be able to change WITHOUT a deploy: the sender
 * identities (from / reply-to / support / marketing), a master kill switch,
 * per-template enable toggles + subject overrides + optional send delay, the
 * daily send cap, and the contact/legal footer shown in every email.
 *
 * Stored at the world-readable `appConfig/emailConfig` doc (the values here — a
 * noreply address, a support email, a postal address — appear in outgoing email
 * anyway, so there's nothing secret). The ZeptoMail API token + webhook secret
 * are NOT here; they live in Cloud Secret Manager. Writes go only through the
 * admin-gated backend (`/admin/config/email`).
 */
import { z } from "zod";
import {
  EMAIL_TEMPLATE_IDS,
  type EmailSenderKey,
  type EmailTemplateId,
} from "../email/types";
import { EMAIL_TEMPLATE_REGISTRY } from "../email/registry";

export interface EmailSenders {
  /** Primary system sender, e.g. "Childbook Studio <noreply@childbook.studio>". */
  default: string;
  /** Where replies should go (a monitored inbox), e.g. "hello@childbook.studio". */
  replyTo: string;
  /** Sender used for support-context emails (e.g. order problems). */
  support: string;
  /** Sender used for marketing/newsletter email. */
  marketing: string;
}

export interface EmailTemplateSettings {
  enabled: boolean;
  /** Which configured sender identity to send this template as. */
  senderKey: EmailSenderKey;
  /** Optional subject override (supports `{token}` from the template's vars). */
  subjectOverride: string;
  /** Optional delay before sending, in minutes (0 = send immediately). */
  delayMinutes: number;
}

export interface EmailGlobalSettings {
  /** Master kill switch — when false, NO email is sent (incident response). */
  enabled: boolean;
  /** Copyright / legal line shown in the footer. */
  footerText: string;
  /** Support email shown (and used as mailto) in the footer. */
  supportEmail: string;
  /** Help/contact page URL shown in the footer. */
  supportUrl: string;
  /** Base URL for one-click unsubscribe (marketing only). Empty disables it. */
  unsubscribeUrl: string;
  /** Postal address for CAN-SPAM compliance (shown when non-empty). */
  physicalAddress: string;
  /** Safety valve: refuse to send beyond this many emails/day. 0 = unlimited. */
  maxDailySends: number;
}

export interface EmailConfig {
  version: 1;
  global: EmailGlobalSettings;
  senders: EmailSenders;
  /** Per-template settings, keyed by template id. */
  templates: Record<EmailTemplateId, EmailTemplateSettings>;
  updatedAt: number;
}

const DEFAULT_DOMAIN = "childbook.studio";

function defaultTemplateSettings(id: EmailTemplateId): EmailTemplateSettings {
  return {
    enabled: true,
    senderKey: EMAIL_TEMPLATE_REGISTRY[id].defaultSenderKey,
    subjectOverride: "",
    delayMinutes: 0,
  };
}

export function createDefaultEmailConfig(): EmailConfig {
  const templates = {} as Record<EmailTemplateId, EmailTemplateSettings>;
  for (const id of EMAIL_TEMPLATE_IDS) templates[id] = defaultTemplateSettings(id);
  return {
    version: 1,
    global: {
      enabled: true,
      footerText: `© ${new Date().getFullYear()} Childbook Studio`,
      supportEmail: `hello@${DEFAULT_DOMAIN}`,
      supportUrl: `https://${DEFAULT_DOMAIN}/help`,
      unsubscribeUrl: `https://${DEFAULT_DOMAIN}/unsubscribe`,
      physicalAddress: "",
      maxDailySends: 0,
    },
    senders: {
      default: `Childbook Studio <noreply@${DEFAULT_DOMAIN}>`,
      replyTo: `hello@${DEFAULT_DOMAIN}`,
      support: `Childbook Studio <hello@${DEFAULT_DOMAIN}>`,
      marketing: `Childbook Studio <team@${DEFAULT_DOMAIN}>`,
    },
    templates,
    updatedAt: Date.now(),
  };
}

// ---- Normalization ---------------------------------------------------------

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function senderKey(v: unknown, fallback: EmailSenderKey): EmailSenderKey {
  return v === "default" || v === "support" || v === "marketing" ? v : fallback;
}

function normalizeTemplateSettings(id: EmailTemplateId, input: unknown): EmailTemplateSettings {
  const d = defaultTemplateSettings(id);
  const t = (input ?? {}) as Partial<EmailTemplateSettings>;
  return {
    enabled: bool(t.enabled, d.enabled),
    senderKey: senderKey(t.senderKey, d.senderKey),
    subjectOverride: str(t.subjectOverride, d.subjectOverride, 300),
    delayMinutes: Math.round(num(t.delayMinutes, d.delayMinutes, 0, 60 * 24 * 30)),
  };
}

export function normalizeEmailConfig(input: unknown): EmailConfig {
  const d = createDefaultEmailConfig();
  const c = (input ?? {}) as Partial<EmailConfig>;
  const g = (c.global ?? {}) as Partial<EmailGlobalSettings>;
  const s = (c.senders ?? {}) as Partial<EmailSenders>;
  const tin = (c.templates ?? {}) as Record<string, unknown>;

  const templates = {} as Record<EmailTemplateId, EmailTemplateSettings>;
  for (const id of EMAIL_TEMPLATE_IDS) templates[id] = normalizeTemplateSettings(id, tin[id]);

  return {
    version: 1,
    global: {
      enabled: bool(g.enabled, d.global.enabled),
      footerText: str(g.footerText, d.global.footerText, 300),
      supportEmail: str(g.supportEmail, d.global.supportEmail, 320),
      supportUrl: str(g.supportUrl, d.global.supportUrl, 500),
      unsubscribeUrl: str(g.unsubscribeUrl, d.global.unsubscribeUrl, 500),
      physicalAddress: str(g.physicalAddress, d.global.physicalAddress, 300),
      maxDailySends: Math.round(num(g.maxDailySends, d.global.maxDailySends, 0, 1_000_000)),
    },
    senders: {
      default: str(s.default, d.senders.default, 320),
      replyTo: str(s.replyTo, d.senders.replyTo, 320),
      support: str(s.support, d.senders.support, 320),
      marketing: str(s.marketing, d.senders.marketing, 320),
    },
    templates,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

/** Resolve the configured sender address for a template (senderKey → address). */
export function resolveSenderAddress(config: EmailConfig, key: EmailSenderKey): string {
  return config.senders[key] || config.senders.default;
}

// ---- Validation (backend, before persisting) -------------------------------

export const emailConfigSchema = z.object({
  version: z.literal(1).optional(),
  global: z
    .object({
      enabled: z.boolean(),
      footerText: z.string().max(300),
      supportEmail: z.string().max(320),
      supportUrl: z.string().max(500),
      unsubscribeUrl: z.string().max(500),
      physicalAddress: z.string().max(300),
      maxDailySends: z.number(),
    })
    .partial()
    .optional(),
  senders: z
    .object({
      default: z.string().max(320),
      replyTo: z.string().max(320),
      support: z.string().max(320),
      marketing: z.string().max(320),
    })
    .partial()
    .optional(),
  templates: z
    .record(
      z.string(),
      z
        .object({
          enabled: z.boolean(),
          senderKey: z.enum(["default", "support", "marketing"]),
          subjectOverride: z.string().max(300),
          delayMinutes: z.number(),
        })
        .partial(),
    )
    .optional(),
  updatedAt: z.number().optional(),
});
