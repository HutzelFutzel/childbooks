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
 *   2. Slack — how a human actually finds out. Still "best-effort" in the sense
 *      that a Slack outage must not 500 the visitor (they'd retry into a second
 *      ticket before we had dedupe), but the ping is AWAITED before we respond
 *      so Cloud Run cannot freeze the instance out from under it.
 *   3. An acknowledgement email BACK TO THE SUBMITTER (`contact_form_ack`),
 *      carrying their reference. Same await-before-respond rule as Slack.
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
import { sendTemplatedEmail, type SendTemplateResult } from "../email/service";
import { notifySlack, type NotifyResult } from "../notify";
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

async function notifyContactSlack(opts: {
  ref: string;
  uid: string | null | undefined;
  name: string;
  email: string;
  topicLabel: string;
  timeSensitive: boolean;
  message: string;
}): Promise<NotifyResult> {
  const account = await contactAccountContext(opts.uid);
  return notifySlack({
    channel: "contact",
    messageKey: "contact_form",
    ref: opts.ref,
    text:
      `✉️ ${opts.ref} · ${opts.topicLabel}${opts.timeSensitive ? " ⏱" : ""}\n` +
      `${opts.name} <${opts.email}>${opts.uid ? ` · uid ${opts.uid}` : ""}\n` +
      `${formatAccountLine(account)}\n` +
      opts.message.slice(0, 500),
  });
}

function logSideEffect(
  kind: "slack" | "email",
  ref: string,
  result: NotifyResult | SendTemplateResult,
): void {
  if (kind === "slack") {
    const slack = result as NotifyResult;
    if (slack.sent) return;
    // emulator / disabled / duplicate are expected quiet skips; error and
    // not_configured are the ones that mean a human never saw the message.
    if (slack.reason === "error" || slack.reason === "not_configured") {
      console.error("[contact] slack not delivered", ref, slack.reason);
    }
    return;
  }
  const email = result as SendTemplateResult;
  if (email.ok) return;
  if (email.skipped === "disabled" || email.skipped === "duplicate" || email.skipped === "capped") return;
  console.error("[contact] email not delivered", ref, email.skipped ?? email.error);
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
        console.warn("[contact] dropped as automated", {
          elapsedMs,
          honeypot: Boolean(company.trim()),
        });
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

      // 7–9. Slack + emails MUST complete (or fail) before we respond. Cloud Run
      // allocates CPU only during the request; a `void` after `res.json()` is
      // how a ticket lands in the admin inbox with no Slack ping. Failures are
      // logged, never thrown — the visitor already has a durable reference.
      const sideEffects: Promise<void>[] = [
        notifyContactSlack({
          ref: saved.ref,
          uid: req.uid,
          name,
          email,
          topicLabel: meta.label,
          timeSensitive: Boolean(meta.timeSensitive),
          message,
        })
          .then((result) => logSideEffect("slack", saved.ref, result))
          .catch((err) => console.error("[contact] slack notify failed", saved.ref, err)),
        sendTemplatedEmail({
          templateId: "contact_form_ack",
          to: email,
          dedupeKey: saved.ref,
          vars: { name, ref: saved.ref, topic: meta.label, message },
        })
          .then((result) => logSideEffect("email", saved.ref, result))
          .catch((err) => console.error("[contact] ack email failed", saved.ref, err)),
      ];
      if (config.global.contactRecipient) {
        sideEffects.push(
          sendTemplatedEmail({
            templateId: "contact_form",
            to: config.global.contactRecipient,
            replyTo: email,
            dedupeKey: saved.ref,
            vars: { fromName: name, fromEmail: email, topic: meta.label, message },
          })
            .then((result) => logSideEffect("email", saved.ref, result))
            .catch((err) => console.error("[contact] copy email failed", saved.ref, err)),
        );
      }
      await Promise.all(sideEffects);

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
