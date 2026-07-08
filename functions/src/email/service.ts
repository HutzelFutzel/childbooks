/**
 * The provider-agnostic send orchestrator — the one function the rest of the
 * backend calls to send a system email.
 *
 * It resolves the live brand kit (`appConfig/branding` + `appConfig/seo`) and
 * the admin email config (`appConfig/emailConfig`), honors the master switch +
 * per-template toggle + daily cap, renders the template (code templates in
 * `core/email`), sends via ZeptoMail, records telemetry, and de-duplicates on an
 * optional idempotency key so webhook-retried triggers can't double-send.
 *
 * Every path is best-effort: a send never throws back into the trigger (a
 * payment/gift/referral flow must not fail because an email couldn't go out).
 */
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { getBrandingConfig, getEmailConfig, getEmailStats, getSeoConfig } from "../appConfig";
import { mapMessage, recordEmailEvent } from "./tracker";
import { sendEmail } from "./sender";
import {
  resolveSenderAddress,
  type EmailConfig,
} from "../../../books-frontend/src/core/config/emailConfig";
import { sentOnDay } from "../../../books-frontend/src/core/config/emailStats";
import { EMAIL_TEMPLATE_REGISTRY, renderEmail } from "../../../books-frontend/src/core/email/registry";
import { applyTokens } from "../../../books-frontend/src/core/email/layout";
import type {
  BrandContext,
  EmailFooterContext,
  EmailTemplateId,
  EmailTemplateVarsMap,
  RenderContext,
} from "../../../books-frontend/src/core/email/types";

const DEDUPE_COLLECTION = "emailLog";

/** Look up a user's email + display name via the Admin Auth SDK (best-effort). */
export async function recipientForUid(
  uid: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    ensureAdmin();
    const user = await getAuth().getUser(uid);
    return { email: user.email ?? null, name: user.displayName ?? null };
  } catch {
    return { email: null, name: null };
  }
}

async function buildContext(config: EmailConfig, category: RenderContext["category"]): Promise<RenderContext> {
  const [branding, seo] = await Promise.all([getBrandingConfig(), getSeoConfig()]);
  const brand: BrandContext = {
    brandName: branding.brandName || seo.siteName || "Childbook Studio",
    tagline: branding.tagline || "",
    logoUrl: branding.logo?.imageUrl ?? null,
    logoDarkUrl: branding.logoDark?.imageUrl ?? null,
    iconUrl: branding.icon?.imageUrl ?? null,
    primaryColor: branding.colors.primary,
    accentColor: branding.colors.accent,
    siteUrl: seo.siteUrl || "https://childbook.studio",
  };
  const footer: EmailFooterContext = {
    footerText: config.global.footerText,
    supportEmail: config.global.supportEmail,
    supportUrl: config.global.supportUrl,
    unsubscribeUrl: config.global.unsubscribeUrl || null,
    physicalAddress: config.global.physicalAddress,
  };
  return { brand, footer, category };
}

/** Flatten string/number vars into a token map for subject-override substitution. */
function subjectTokens(vars: Record<string, unknown>, brandName: string): Record<string, unknown> {
  const out: Record<string, unknown> = { brandName };
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return out;
}

/** Claim a dedupe key exactly once (create() ⇒ retries are no-ops). */
async function claimDedupe(key: string): Promise<boolean> {
  try {
    ensureAdmin();
    await getFirestore().collection(DEDUPE_COLLECTION).doc(key).create({ at: Date.now() });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    return true; // on any other error, don't block the send
  }
}

export interface SendTemplateOptions<Id extends EmailTemplateId> {
  templateId: Id;
  vars: EmailTemplateVarsMap[Id];
  /** Recipient email; if omitted, provide `uid` to resolve it from Auth. */
  to?: string | null;
  /** Resolve the recipient email + fallback name from this user id. */
  uid?: string;
  /** Idempotency key — the same key never sends twice. */
  dedupeKey?: string;
  /** Bypass the enabled/cap checks (used by the admin "send test" action). */
  isTest?: boolean;
}

export interface SendTemplateResult {
  ok: boolean;
  skipped?: "disabled" | "no_recipient" | "duplicate" | "capped" | "not_configured";
  error?: string;
}

/**
 * Render + send one templated email. Returns a structured result; callers in
 * hot paths should not await-and-throw — they typically fire-and-log.
 */
export async function sendTemplatedEmail<Id extends EmailTemplateId>(
  opts: SendTemplateOptions<Id>,
): Promise<SendTemplateResult> {
  try {
    const config = await getEmailConfig();
    const settings = config.templates[opts.templateId];
    const meta = EMAIL_TEMPLATE_REGISTRY[opts.templateId];

    if (!opts.isTest) {
      if (!config.global.enabled) return { ok: false, skipped: "disabled" };
      if (!settings?.enabled) return { ok: false, skipped: "disabled" };
    }

    // Resolve recipient (explicit `to` wins; else look up by uid).
    let to = opts.to ?? null;
    let fallbackName: string | null = null;
    if (!to && opts.uid) {
      const r = await recipientForUid(opts.uid);
      to = r.email;
      fallbackName = r.name;
    }
    if (!to) return { ok: false, skipped: "no_recipient" };

    // Daily cap (skip for tests).
    if (!opts.isTest && config.global.maxDailySends > 0) {
      const stats = await getEmailStats();
      if (sentOnDay(stats) >= config.global.maxDailySends) {
        console.warn("[email] daily send cap reached; skipping", opts.templateId);
        return { ok: false, skipped: "capped" };
      }
    }

    // De-dupe (skip for tests).
    if (!opts.isTest && opts.dedupeKey) {
      const claimed = await claimDedupe(`${opts.templateId}_${opts.dedupeKey}`);
      if (!claimed) return { ok: true, skipped: "duplicate" };
    }

    const ctx = await buildContext(config, meta.category);
    const rendered = renderEmail(opts.templateId, opts.vars, ctx);

    // Subject override (with `{token}` substitution) if the admin set one.
    const override = settings?.subjectOverride?.trim();
    const subject = override
      ? applyTokens(override, subjectTokens(opts.vars as Record<string, unknown>, ctx.brand.brandName))
      : rendered.subject;

    const senderKey = settings?.senderKey ?? meta.defaultSenderKey;
    const result = await sendEmail({
      from: resolveSenderAddress(config, senderKey),
      toAddress: to,
      toName:
        (typeof (opts.vars as { name?: string }).name === "string"
          ? (opts.vars as { name?: string }).name
          : fallbackName) ?? undefined,
      replyTo: config.senders.replyTo || undefined,
      subject,
      html: rendered.html,
      text: rendered.text,
      track: meta.category === "marketing",
      templateId: opts.templateId,
      reference: opts.dedupeKey,
    });

    if (result.notConfigured) return { ok: false, skipped: "not_configured" };

    if (result.ok) {
      await recordEmailEvent(opts.templateId, "sent");
      if (result.messageId) await mapMessage(result.messageId, opts.templateId, opts.uid);
    } else {
      await recordEmailEvent(opts.templateId, "failed");
    }
    return { ok: result.ok, error: result.error };
  } catch (err) {
    console.error("[email] sendTemplatedEmail failed", opts.templateId, err);
    return { ok: false, error: err instanceof Error ? err.message : "Send failed." };
  }
}
