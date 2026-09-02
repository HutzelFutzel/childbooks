/**
 * Public affiliate-program application endpoint.
 *
 * `POST /affiliate-applications` is TOKENLESS (marketing site, often no Firebase
 * session), so it MUST be registered before the auth guards in `app.ts`. Abuse
 * controls reuse the contact form's App Check + rate-limit + domain checks.
 *
 * WHERE A SUBMISSION GOES:
 *   1. Firestore (`affiliateApplications`) — system of record.
 *   2. Slack — how a human finds out. Awaited before we respond so Cloud Run
 *      cannot freeze the instance out from under the ping.
 *   3. Ack email to the applicant (`affiliate_application_ack`) — trust signal,
 *      also awaited.
 *
 * Approval is manual: create the partner in Rewardful, then Sync. This endpoint
 * never provisions Rewardful accounts.
 */
import express, { type Express, type Response } from "express";
import { z } from "zod";
import { sendTemplatedEmail } from "../email/service";
import { notifySlack } from "../notify";
import { appCheckRejects } from "../appCheck";
import type { AuthedRequest } from "../auth";
import {
  AFFILIATE_AUDIENCE_LABELS,
  AFFILIATE_CHANNEL_LABELS,
  isAffiliateAudienceId,
  isAffiliateChannelId,
} from "../../../books-frontend/src/core/affiliates/application";
import { checkSenderDomain, consumeRateLimit, fingerprint, looksAutomated } from "../contact/abuse";
import { saveAffiliateApplication } from "./applicationStore";

const applySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  channel: z.string().trim().max(40),
  channelUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), "URL must start with http(s)"),
  audience: z.string().trim().max(40),
  pitch: z.string().trim().min(20).max(2000),
  /** Honeypot — real users leave it blank. */
  company: z.string().max(200).optional().default(""),
  elapsedMs: z.number().optional(),
});

function pretendAccepted(res: Response): void {
  res.json({ ok: true });
}

function resolveChannel(raw: string) {
  return isAffiliateChannelId(raw) ? raw : "other";
}

function resolveAudience(raw: string) {
  return isAffiliateAudienceId(raw) ? raw : "prefer_not";
}

export function registerAffiliateApplicationRoutes(app: Express): void {
  const json = express.json({ limit: "32kb" });

  app.post("/affiliate-applications", json, async (req: AuthedRequest, res: Response) => {
    try {
      const parsed = applySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Please check the form and try again." } });
        return;
      }
      const { name, email, channelUrl, pitch, company, elapsedMs } = parsed.data;
      const channel = resolveChannel(parsed.data.channel);
      const audience = resolveAudience(parsed.data.audience);

      if (looksAutomated({ honeypot: company, elapsedMs })) {
        pretendAccepted(res);
        return;
      }

      if (await appCheckRejects(req, "affiliate-applications")) {
        pretendAccepted(res);
        return;
      }

      const ip = (req.ip || "unknown").toString();
      if (await consumeRateLimit(`aff_ip_${ip}`)) {
        res.status(429).json({ error: { message: "Too many applications. Please try again later." } });
        return;
      }
      if (await consumeRateLimit(`aff_email_${email.toLowerCase()}`)) {
        res.status(429).json({ error: { message: "Too many applications. Please try again later." } });
        return;
      }

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

      const saved = await saveAffiliateApplication({
        name,
        email,
        channel,
        channelUrl,
        audience,
        pitch,
        uid: req.uid ?? null,
        senderHash: fingerprint(ip),
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
      });

      const channelLabel = AFFILIATE_CHANNEL_LABELS[channel];
      const audienceLabel = AFFILIATE_AUDIENCE_LABELS[audience];

      // Await Slack + ack before responding: Cloud Run freezes CPU after the
      // HTTP response, so a `void` ping is how an application lands in Firestore
      // with no Slack notice. Failures are logged, never thrown.
      await Promise.all([
        notifySlack({
          channel: "growth",
          messageKey: "affiliate_application",
          ref: saved.ref,
          text:
            `🤝 ${saved.ref} · Affiliate application\n` +
            `${name} <${email}>${req.uid ? ` · uid ${req.uid}` : ""}\n` +
            `${channelLabel} · ${audienceLabel}\n` +
            `${channelUrl}\n` +
            pitch.slice(0, 500),
        })
          .then((result) => {
            if (!result.sent && (result.reason === "error" || result.reason === "not_configured")) {
              console.error("[affiliates] slack not delivered", saved.ref, result.reason);
            }
          })
          .catch((err) => console.error("[affiliates] application slack notify failed", err)),
        sendTemplatedEmail({
          templateId: "affiliate_application_ack",
          to: email,
          dedupeKey: saved.ref,
          vars: {
            name,
            ref: saved.ref,
            channel: channelLabel,
            channelUrl,
            audience: audienceLabel,
            pitch,
          },
        }).catch((err) => console.error("[affiliates] ack email failed", saved.ref, err)),
      ]);

      res.json({ ok: true, ref: saved.ref });
    } catch (err) {
      console.error("[affiliates] application failed", err);
      res.status(500).json({ error: { message: "Could not submit your application. Please try again." } });
    }
  });
}
