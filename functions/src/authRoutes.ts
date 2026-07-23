/**
 * Post-signup account endpoints — the branded welcome + email-verification flow.
 *
 * The studio is guest-first: an anonymous session is created on load and later
 * LINKED to an email/Google identity (same uid). Linking doesn't fire a fresh
 * `beforeUserCreated`, so the client explicitly calls `POST /auth/welcome` right
 * after a successful upgrade. This one endpoint:
 *
 *   - For an UNVERIFIED email/password account: generates a Firebase email
 *     verification action link (Admin SDK) and sends our own branded ZeptoMail
 *     "welcome + verify" email carrying that link. Clicking it verifies the
 *     account exactly like Firebase's built-in email — but on-brand and
 *     retriggerable (the same call re-sends a fresh link, powering the banner's
 *     "Resend" button).
 *   - For an already-VERIFIED identity (e.g. Google): sends a plain welcome
 *     email, deduped so it goes out at most once.
 *
 * It also fires the #growth "new signup" Slack ping (deduped on uid) at this
 * real-account moment — the guest-upgrade path the blocking function misses.
 *
 * Guarded by `requireAuth` (see app.ts): a caller must be signed in, but need
 * NOT be verified (verifying is the whole point). Best-effort throughout — a
 * mail/Slack hiccup never fails the request.
 */
import express, { type Express, type Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { ensureAdmin } from "./storage";
import { type AuthedRequest } from "./auth";
import { getSeoConfig } from "./appConfig";
import { sendWelcomeEmail } from "./email/triggers";
import { notifySlack } from "./notify";

/** Where Firebase returns the user after they click the verification link. */
async function continueUrl(): Promise<string> {
  try {
    const seo = await getSeoConfig();
    const base = (seo.siteUrl || "https://childbook.studio").replace(/\/+$/, "");
    return `${base}/studio`;
  } catch {
    return "https://childbook.studio/studio";
  }
}

export function registerAuthRoutes(app: Express): void {
  const json = express.json({ limit: "64kb" });

  app.post("/auth/welcome", json, async (req: AuthedRequest, res: Response) => {
    try {
      ensureAdmin();
      const uid = req.uid;
      if (!uid) {
        res.status(401).json({ error: { message: "Authentication required." } });
        return;
      }

      const user = await getAuth().getUser(uid);
      const email = user.email ?? null;
      // Anonymous guests (no email) have nothing to welcome/verify — no-op.
      if (!email) {
        res.json({ ok: true, sent: false, verified: false });
        return;
      }

      const name = user.displayName ?? null;
      const providerId = user.providerData?.[0]?.providerId ?? "password";

      let verifyUrl: string | undefined;
      if (!user.emailVerified) {
        try {
          verifyUrl = await getAuth().generateEmailVerificationLink(email, {
            url: await continueUrl(),
          });
        } catch (err) {
          console.warn("[auth] could not generate verification link", err);
        }
      }

      // Verified → plain welcome, deduped once. Unverified → welcome+verify,
      // NOT deduped so the "Resend" button always sends a fresh link.
      const result = await sendWelcomeEmail({
        uid,
        name,
        verifyUrl,
        dedupe: user.emailVerified,
      });

      // #growth ping for the real account (deduped on uid via notifySlack's ref).
      await notifySlack({
        channel: "growth",
        messageKey: "signup",
        ref: `signup_${uid}`,
        text: `🎉 New signup — ${email} (${providerId})`,
      });

      res.json({ ok: true, sent: result.ok, verified: user.emailVerified });
    } catch (err) {
      console.error("[auth] /auth/welcome failed", err);
      // Never surface a hard error to the signup flow — the account is fine.
      res.json({ ok: false, sent: false });
    }
  });
}
