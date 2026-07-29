/**
 * The public contact form endpoint.
 *
 * `POST /contact` is TOKENLESS (the marketing site has no Firebase session), so
 * it MUST be registered before the auth guards in `app.ts`. Its abuse controls
 * live in `abuse.ts` and the App Check gate in `../appCheck.ts`.
 *
 * WHERE A SUBMISSION GOES, in order:
 *   1. Firestore (`contactMessages`) — the system of record. If this fails the
 *      visitor is told so, because the alternative is claiming we received a
 *      message we then have no way to find.
 *   2. Slack — how a human actually finds out. Best-effort.
 *   3. An acknowledgement email BACK TO THE SUBMITTER (`contact_form_ack`),
 *      carrying their reference. This is the trust signal that makes a form a
 *      credible substitute for a published address — without it the visitor
 *      has only our word that anything happened. Best-effort; the reference
 *      already returned in the response is the real guarantee.
 *   4. An email COPY to an inbox — OPTIONAL and off by default
 *      (`contactRecipient` is empty). The whole point of storing submissions is
 *      that no inbox has to be published to receive them.
 *
 * A signed-in visitor's submission carries their ID token (every `backendFetch`
 * attaches it) and `attachUser` runs on all routes, so `req.uid` is available
 * here even though the endpoint is public — that's how a message gets tied to an
 * account without asking the user to retype anything.
 */
import express, { type Express, type Response } from "express";
import { z } from "zod";
import { getEmailConfig } from "../appConfig";
import { sendTemplatedEmail } from "../email/service";
import { notifySlack } from "../notify";
import { appCheckRejects } from "../appCheck";
import type { AuthedRequest } from "../auth";
import { contactTopic } from "../../../books-frontend/src/core/contact/topics";
import { checkSenderDomain, consumeRateLimit, fingerprint, looksAutomated } from "./abuse";
import { contactAccountContext, formatAccountLine } from "./enrich";
import {
  isContactMessageStatus,
  listContactMessages,
  saveContactMessage,
  setContactMessageHandled,
} from "./store";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  /**
   * Coerced rather than validated against the enum: a visitor whose browser is
   * still running a cached bundle posts the old FREE-TEXT topic, and rejecting
   * that would 400 a perfectly real message for the length of the cache. Anything
   * unrecognized becomes `other` (see `contactTopic`).
   */
  topic: z.string().trim().max(160).optional().default("other"),
  message: z.string().trim().min(1).max(5000),
  /** Honeypot — real users leave it blank; any value ⇒ silently drop as spam. */
  company: z.string().max(200).optional().default(""),
  /** How long the form was open, measured client-side (see `looksAutomated`). */
  elapsedMs: z.number().optional(),
});

/**
 * Bots learn from error messages, so every spam verdict returns the SAME shape a
 * real success does. A rejected submission is indistinguishable from an accepted
 * one, minus the reference.
 */
function pretendAccepted(res: Response): void {
  res.json({ ok: true });
}

export function registerContactRoutes(app: Express): void {
  const json = express.json({ limit: "32kb" });

  app.post("/contact", json, async (req: AuthedRequest, res: Response) => {
    try {
      const parsed = contactSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Please check the form and try again." } });
        return;
      }
      const { name, email, message, company, elapsedMs } = parsed.data;
      const meta = contactTopic(parsed.data.topic);

      // 1. Free checks first — no I/O, no quota consumed.
      if (looksAutomated({ honeypot: company, elapsedMs })) {
        pretendAccepted(res);
        return;
      }

      // 2. App Check. Logs-only until APP_CHECK_ENFORCED=true.
      if (await appCheckRejects(req, "contact")) {
        pretendAccepted(res);
        return;
      }

      // 3. Is the form even open? Cached config read, so cheap.
      const config = await getEmailConfig();
      if (!config.global.contactEnabled) {
        res.status(503).json({ error: { message: "The contact form is currently unavailable." } });
        return;
      }

      // 4. Rate limit before any DNS work, so an attacker can't make us resolve
      //    unlimited domains. IP first: a flood from one host shouldn't get to
      //    spend a victim's per-address quota too.
      const ip = (req.ip || "unknown").toString();
      if (await consumeRateLimit(`ip_${ip}`)) {
        res.status(429).json({ error: { message: "Too many messages. Please try again later." } });
        return;
      }
      if (await consumeRateLimit(`email_${email.toLowerCase()}`)) {
        res.status(429).json({ error: { message: "Too many messages. Please try again later." } });
        return;
      }

      // 5. Can we actually reply to this address?
      const domain = await checkSenderDomain(email);
      if (domain !== "ok") {
        res.status(400).json({
          error: {
            message:
              domain === "disposable"
                ? "Please use a permanent email address so we can reply."
                : "We couldn't find a mail server for that address — please check it.",
          },
        });
        return;
      }

      // 6. Persist. A failure here is reported honestly: the message is lost, so
      //    saying "sent" would be a lie the visitor can't recover from.
      const saved = await saveContactMessage({
        name,
        email,
        topic: meta.id,
        message,
        uid: req.uid ?? null,
        senderHash: fingerprint(ip),
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
      });

      // 7. Notify a human. Best-effort — the record above is the guarantee. The
      //    account line (signed-in/verified/lifetime revenue/last purchase) is
      //    an extra async lookup, so it's wrapped in its own IIFE rather than
      //    awaited inline — it must never delay the response to the visitor.
      void (async () => {
        const account = await contactAccountContext(req.uid);
        await notifySlack({
          channel: "contact",
          messageKey: "contact_form",
          ref: saved.ref,
          text:
            `✉️ ${saved.ref} · ${meta.label}${meta.timeSensitive ? " ⏱" : ""}\n` +
            `${name} <${email}>${req.uid ? ` · uid ${req.uid}` : ""}\n` +
            `${formatAccountLine(account)}\n` +
            message.slice(0, 500),
        });
      })().catch((err) => console.error("[contact] slack notify failed", err));

      // 8. Acknowledge to the SUBMITTER — the trust signal that makes the form a
      //    credible substitute for a published address. Best-effort: the ref
      //    already in the JSON response is the real guarantee, not this email.
      void sendTemplatedEmail({
        templateId: "contact_form_ack",
        to: email,
        dedupeKey: saved.ref,
        vars: { name, ref: saved.ref, topic: meta.label },
      });

      // 9. Optional email copy, only if an inbox was explicitly configured.
      if (config.global.contactRecipient) {
        void sendTemplatedEmail({
          templateId: "contact_form",
          to: config.global.contactRecipient,
          replyTo: email,
          dedupeKey: saved.ref,
          vars: { fromName: name, fromEmail: email, topic: meta.label, message },
        });
      }

      res.json({ ok: true, ref: saved.ref });
    } catch (err) {
      console.error("[contact] submission failed", err);
      res.status(500).json({ error: { message: "Could not send your message. Please try again." } });
    }
  });
}

/**
 * Admin-only inbox routes for `contactMessages`. Registered under `/admin`
 * (see `app.ts`), so `requireVerified` + `requireAdmin` already ran.
 */
export function registerContactAdminRoutes(app: Express): void {
  const json = express.json({ limit: "16kb" });

  app.get("/admin/contact/messages", async (req: AuthedRequest, res: Response) => {
    try {
      const rawStatus = req.query.status;
      const status = isContactMessageStatus(rawStatus) ? rawStatus : undefined;
      const limit = Number(req.query.limit) || undefined;
      const messages = await listContactMessages({ status, limit });
      res.json({ messages });
    } catch (err) {
      console.error("[contact] admin list failed", err);
      res.status(500).json({ error: { message: "Could not load messages." } });
    }
  });

  app.post(
    "/admin/contact/messages/:ref/handled",
    json,
    async (req: AuthedRequest, res: Response) => {
      try {
        const handled = (req.body as { handled?: boolean } | undefined)?.handled ?? true;
        const message = await setContactMessageHandled(
          String(req.params.ref),
          Boolean(handled),
          req.uid,
        );
        res.json({ message });
      } catch (err) {
        console.error("[contact] admin handled-toggle failed", err);
        res.status(500).json({ error: { message: "Could not update this message." } });
      }
    },
  );
}
