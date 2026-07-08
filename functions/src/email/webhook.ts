/**
 * The ZeptoMail event webhook — the source of real delivery statistics
 * (delivered / open / click / bounce / spam / unsubscribe).
 *
 * Mounted OUTSIDE the auth guards (ZeptoMail sends no Firebase token). When a
 * webhook secret is configured AND a signature header is present, we verify an
 * HMAC-SHA256 of the raw body (mirrors the Lulu/Stripe webhook pattern); if the
 * account isn't configured to sign, events are still accepted so stats aren't
 * silently lost. Each event is attributed to its template (via the messageId we
 * mapped at send time) and appended to `appConfig/emailStats`.
 */
import express, { type Express, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { recordEmailEvents } from "../appConfig";
import { maybeAlertDeliverability, templateForMessage } from "./tracker";
import type { EmailEventType } from "../../../books-frontend/src/core/email/types";

function webhookSecret(): string {
  try {
    return process.env.ZEPTOMAIL_WEBHOOK_SECRET || "";
  } catch {
    return "";
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function verifySignature(raw: Buffer, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const sig = signature.trim();
  const hex = createHmac("sha256", secret).update(raw).digest("hex");
  const b64 = createHmac("sha256", secret).update(raw).digest("base64");
  return safeEqual(sig, hex) || safeEqual(sig, b64);
}

/** Map a ZeptoMail event name to our internal event type (defensive/tolerant). */
function mapEventType(name: string): EmailEventType | null {
  const n = name.toLowerCase();
  if (n.includes("deliver")) return "delivered";
  if (n.includes("open")) return "opened";
  if (n.includes("click")) return "clicked";
  if (n.includes("bounce")) return "bounced";
  if (n.includes("spam") || n.includes("complain")) return "complained";
  if (n.includes("unsub")) return "unsubscribed";
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

interface ParsedEvent {
  name: string;
  messageId: string;
  templateHint: string;
}

/** Pull a flat list of {name, messageId} from ZeptoMail's varied payload shapes. */
function extractEvents(payload: unknown): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const name = firstString(obj, ["event_name", "eventname", "event", "type"]);
    if (name) {
      out.push({
        name,
        messageId: firstString(obj, [
          "request_id",
          "requestid",
          "message_id",
          "messageid",
          "client_reference",
          "clientreference",
          "message_reference",
        ]),
        templateHint: firstString(obj, ["X-Childbooks-Template", "x-childbooks-template", "template"]),
      });
    }
    // Recurse into common containers (event_message[], events[], details[], data{}).
    for (const key of ["event_message", "events", "email_message", "data", "details"]) {
      const child = obj[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  if (Array.isArray(payload)) payload.forEach(visit);
  else visit(payload);
  return out;
}

export function registerEmailWebhookRoute(app: Express): void {
  app.post(
    "/zeptomail-webhook",
    express.raw({ type: "*/*", limit: "2mb" }),
    async (req: Request, res: Response) => {
      try {
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        const raw: Buffer = Buffer.isBuffer(rawBody)
          ? rawBody
          : Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === "string" ? req.body : "");

        // Verify only when we have a secret AND the request carries a signature.
        const secret = webhookSecret();
        const signature =
          req.get("X-Zoho-Signature") ??
          req.get("Zoho-Signature") ??
          req.get("X-ZM-Signature") ??
          "";
        if (secret && signature && !verifySignature(raw, signature, secret)) {
          res.status(401).json({ error: { message: "Invalid signature." } });
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString("utf8") || "{}");
        } catch {
          res.status(400).json({ error: { message: "Invalid payload." } });
          return;
        }

        const events = extractEvents(payload);
        const entries: { templateId: string; type: EmailEventType }[] = [];
        let sawNegative = false;
        for (const ev of events) {
          const type = mapEventType(ev.name);
          if (!type) continue;
          const templateId = ev.templateHint || (await templateForMessage(ev.messageId));
          entries.push({ templateId, type });
          if (type === "bounced" || type === "complained") sawNegative = true;
        }

        if (entries.length > 0) await recordEmailEvents(entries);
        if (sawNegative) await maybeAlertDeliverability();

        res.json({ ok: true, recorded: entries.length });
      } catch (err) {
        console.error("[email] webhook handler error", err);
        // 5xx so ZeptoMail retries transient failures.
        res.status(500).json({ error: { message: "Webhook processing failed." } });
      }
    },
  );
}
