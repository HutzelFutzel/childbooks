/**
 * The ZeptoMail transactional send client.
 *
 * ZeptoMail (Zoho's transactional email product) authenticates with a single
 * static "Send Mail Token" in the Authorization header — no OAuth refresh dance.
 * We POST the fully-rendered HTML + text to its Email API. Delivery outcomes
 * (delivered / open / click / bounce) arrive asynchronously via the webhook in
 * `webhook.ts`, not in this response.
 *
 * This module is intentionally provider-specific and thin: everything above it
 * (config resolution, rendering, stats) is provider-agnostic, so swapping to a
 * different ESP later means changing only this file.
 */
import { ZEPTOMAIL_TOKEN } from "../secrets";

/** Default US data-center endpoint; override with ZEPTOMAIL_API_URL (e.g. .eu). */
const DEFAULT_API_URL = "https://api.zeptomail.com/v1.1/email";

export interface SendEmailArgs {
  /** Full "from" identity, e.g. `Childbook Studio <noreply@childbook.studio>`. */
  from: string;
  toAddress: string;
  toName?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Enable open/click tracking (used for marketing category). */
  track?: boolean;
  /** Correlation tag echoed back so webhooks can attribute to a template. */
  templateId: string;
  /** Idempotency/correlation reference stored on the message. */
  reference?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** ZeptoMail request id, when returned — used to correlate webhook events. */
  messageId?: string;
  error?: string;
  /** True when email isn't configured (missing token) — caller can no-op quietly. */
  notConfigured?: boolean;
}

/** Parse `Name <addr@x>` (or a bare address) into ZeptoMail's address object. */
function parseAddress(input: string): { address: string; name?: string } {
  const m = input.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    const name = m[1].replace(/^"|"$/g, "").trim();
    return name ? { address: m[2].trim(), name } : { address: m[2].trim() };
  }
  return { address: input.trim() };
}

/** Whether email sending is configured (token present). */
export function emailConfigured(): boolean {
  return Boolean(process.env.ZEPTOMAIL_TOKEN || safeSecret());
}

function safeSecret(): string {
  try {
    return ZEPTOMAIL_TOKEN.value() || "";
  } catch {
    return "";
  }
}

/**
 * Send one email through ZeptoMail. Never throws — returns a structured result
 * so the caller (a best-effort trigger) can record a failure and move on.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const token = process.env.ZEPTOMAIL_TOKEN || safeSecret();
  if (!token) return { ok: false, notConfigured: true, error: "ZeptoMail token not configured." };

  const apiUrl = process.env.ZEPTOMAIL_API_URL || DEFAULT_API_URL;
  const from = parseAddress(args.from);
  const to = parseAddress(args.toAddress);

  const body: Record<string, unknown> = {
    from,
    to: [{ email_address: { address: to.address, ...(args.toName ? { name: args.toName } : {}) } }],
    subject: args.subject,
    htmlbody: args.html,
    textbody: args.text,
    track_opens: Boolean(args.track),
    track_clicks: Boolean(args.track),
    // Echoed back in webhooks so we can attribute events to a template.
    client_reference: args.reference ?? args.templateId,
    mime_headers: { "X-Childbooks-Template": args.templateId },
  };
  if (args.replyTo) {
    const rt = parseAddress(args.replyTo);
    body.reply_to = [{ address: rt.address, ...(rt.name ? { name: rt.name } : {}) }];
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Zoho-enczapikey ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const json = (await res.json().catch(() => ({}))) as {
      request_id?: string;
      message?: string;
      error?: { message?: string; details?: unknown };
    };

    if (!res.ok) {
      const message = json.error?.message || json.message || `ZeptoMail returned ${res.status}.`;
      return { ok: false, error: message };
    }
    return { ok: true, messageId: json.request_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed." };
  }
}
