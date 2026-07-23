/**
 * Public contact form endpoint.
 *
 * `POST /contact` is TOKENLESS (the marketing site has no Firebase session), so
 * it MUST be registered before the auth guards in `app.ts`. It renders the
 * `contact_form` email to the admin's configured contact inbox with reply-to set
 * to the submitter, and (best-effort) pings #growth on Slack.
 *
 * Abuse protection, since it's open:
 *   - a hidden honeypot field (`company`) — bots fill it, humans don't;
 *   - a coarse per-IP + per-email in-memory rate limit;
 *   - strict length caps + a basic email-shape check.
 * None of these are perfect on their own, but together they stop casual spam
 * without a captcha. `trust proxy` is set in app.ts so `req.ip` is the real client.
 */
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { getEmailConfig } from "./appConfig";
import { sendTemplatedEmail } from "./email/service";
import { notifySlack } from "./notify";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  topic: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().min(1).max(5000),
  /** Honeypot — real users leave it blank; any value ⇒ silently drop as spam. */
  company: z.string().max(200).optional().default(""),
});

/** Coarse in-memory rate limit: N submissions per window per key (per instance). */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  // Opportunistic cleanup so the map can't grow unbounded on a warm instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

export function registerContactRoutes(app: Express): void {
  const json = express.json({ limit: "32kb" });

  app.post("/contact", json, async (req: Request, res: Response) => {
    try {
      const parsed = contactSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Please check the form and try again." } });
        return;
      }
      const { name, email, topic, message, company } = parsed.data;

      // Honeypot tripped → pretend success so bots don't learn anything.
      if (company && company.length > 0) {
        res.json({ ok: true });
        return;
      }

      const ip = (req.ip || "unknown").toString();
      if (rateLimited(`ip_${ip}`) || rateLimited(`email_${email.toLowerCase()}`)) {
        res.status(429).json({ error: { message: "Too many messages. Please try again later." } });
        return;
      }

      const config = await getEmailConfig();
      if (!config.global.contactEnabled) {
        res.status(503).json({ error: { message: "The contact form is currently unavailable." } });
        return;
      }
      const recipient = config.global.contactRecipient || config.global.supportEmail;
      if (!recipient) {
        res.status(500).json({ error: { message: "Contact is not configured." } });
        return;
      }

      const result = await sendTemplatedEmail({
        templateId: "contact_form",
        to: recipient,
        replyTo: email,
        vars: { fromName: name, fromEmail: email, topic: topic || undefined, message },
      });

      // Best-effort Slack ping (never blocks the response).
      void notifySlack({
        channel: "growth",
        messageKey: "contact_form",
        text: `✉️ Contact form — ${name} <${email}>${topic ? ` · ${topic}` : ""}`,
      });

      if (!result.ok && result.skipped === "not_configured") {
        res.status(500).json({ error: { message: "Email is not configured yet." } });
        return;
      }
      // Even if delivery telemetry failed, treat a non-hard-error as success for
      // the user — the message is queued/logged and support can follow up.
      res.json({ ok: true });
    } catch (err) {
      console.error("[contact] submission failed", err);
      res.status(500).json({ error: { message: "Could not send your message. Please try again." } });
    }
  });
}
