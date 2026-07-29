/**
 * Express app mounted by the single `api` HTTPS function.
 *
 * Routes (auth):
 *   GET  /health                  liveness probe                  (open)
 *   GET  /providers               which AI providers have keys     (open)
 *   GET  /providers/models        server-side model discovery      (open, cached)
 *   *    /print/*                  print fulfillment endpoints      (verified)
 *   POST /print-webhook           provider status callback         (HMAC-signed)
 *   POST /internal/print/sync     pull order status                (emulator only)
 *   GET  /invite/preview          what an invitation promises      (open)
 *   POST /invite/decline          opt an address out for good      (open)
 *   *    /referrals/*             invite, accept, overview         (any identity)
 *   *    /admin/print/webhooks    status-webhook management        (admin)
 *   POST /admin/print/sync        pull order status now            (admin)
 *
 * Every request runs through `attachUser` (verifies the Firebase ID token if
 * present). `/print` additionally `requireVerified` (a verified, non-anonymous
 * account). The print provider (Lulu) is an internal detail; no provider
 * identity is exposed in the route namespace or error responses.
 */
import express, { type Express } from "express";
import { attachUser, requireAdmin, requireAuth, requireVerified } from "./auth";
import { registerProviderRoutes } from "./providers";
import { registerLuluRoutes, registerPrintWebhookRoute } from "./lulu";
import { registerPrintSyncAdminRoutes, registerPrintSyncDevRoute } from "./printSync";
import { registerAiRoutes } from "./ai";
import { registerMigrationRoutes } from "./migration";
import { registerAuthRoutes } from "./authRoutes";
import { registerAdminRoutes } from "./admin";
import { registerGdprRoutes } from "./gdpr";
import { registerHealthRoutes } from "./health";
import { registerRenderRoutes } from "./renders";
import { registerRenderJobRoutes } from "./renderJobs";
import { registerRuntimeRoutes } from "./readiness";
import { registerAnalyticsRoutes } from "./analytics";
import {
  registerStripeAdminRoutes,
  registerStripeUserRoutes,
  registerStripeWebhookRoute,
} from "./stripe";
import { registerEmailWebhookRoute } from "./email/webhook";
import { registerContactAdminRoutes, registerContactRoutes } from "./contact/routes";
import { registerBlogRoutes } from "./blog";
import { registerBlogStatsAdminRoutes, registerBlogTrackingRoute } from "./blogStats";
import { registerReferralPublicRoutes, registerReferralUserRoutes } from "./referrals/routes";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  // Cloud Functions sits behind Google's front end; trust X-Forwarded-For so
  // req.ip is the real client (used by the guest-grant per-IP throttle).
  app.set("trust proxy", true);

  // Identify the caller (if a valid token is present) for every request.
  app.use(attachUser);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Open: lets the client learn which providers exist before any user action.
  registerProviderRoutes(app);

  // Open (but authenticated by HMAC signature, not a Firebase token): the print
  // provider's status-callback webhook. MUST be registered before the `/print`
  // + `requireVerified` guard below so the provider can reach it tokenless.
  registerPrintWebhookRoute(app);

  // The same status updates, PULLED, for local dev where the webhook above can
  // never be delivered (no public URL). No-ops outside the emulator.
  registerPrintSyncDevRoute(app);

  // Stripe's event webhook — tokenless (authenticated by signature), so it MUST
  // be registered before the `/checkout` + `requireVerified` guard below.
  registerStripeWebhookRoute(app);

  // ZeptoMail's delivery-event webhook — tokenless (verified by signature when
  // configured). Registered here so it's reachable without a Firebase token.
  registerEmailWebhookRoute(app);

  // Public contact form — tokenless (the marketing site has no Firebase
  // session), gated by App Check + a Firestore-backed rate limit. Registered
  // before the auth guards so visitors can reach it; `attachUser` still ran, so
  // a signed-in sender is identified without requiring a session.
  registerContactRoutes(app);

  // Public blog analytics beacon — tokenless + cookieless (no consent needed).
  // Registered before the auth guards so visitors on the marketing site can
  // reach it; it only writes anonymous aggregates (see blogStats.ts).
  registerBlogTrackingRoute(app);

  // Invitation preview + decline — tokenless by necessity: the invited person has
  // no account, and the decline link is the program's whole opt-out story.
  registerReferralPublicRoutes(app);

  // Protected surfaces — registered before their route handlers so the guard
  // runs first. Fulfillment + payments require a verified, non-anonymous
  // account; `/ai` only requires *some* authenticated identity (guests and
  // unverified users generate with their granted Sparks — the Sparks balance,
  // a zero negative buffer, and the per-IP grant throttle bound their spend).
  // `/admin` additionally requires admin status (Firestore `admins/{uid}`).
  app.use("/print", requireVerified);
  app.use("/ai", requireAuth);
  app.use("/checkout", requireVerified);
  app.use("/account", requireVerified);
  // Guest-draft import: any signed-in (even not-yet-verified) full account may
  // pull its own guest drafts across — ownership of the guest side is proven by
  // the guest ID token inside the request (see migration.ts).
  app.use("/migrate", requireAuth);
  // Post-signup welcome + email verification: signed-in but NOT-yet-verified
  // accounts must reach these (verifying is the point), so `requireAuth` only.
  app.use("/auth", requireAuth);
  // Referrals: any signed-in identity, guests included. Accepting an invitation
  // has to work at the guest stage (that's when the link is followed) and the
  // invite screen explains what's still missing rather than 403-ing, so the
  // stricter checks live in the handlers.
  app.use("/referrals", requireAuth);
  app.use("/admin", requireVerified, requireAdmin);

  registerLuluRoutes(app);
  registerPrintSyncAdminRoutes(app);
  registerAiRoutes(app);
  registerMigrationRoutes(app);
  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerContactAdminRoutes(app);
  registerBlogRoutes(app);
  registerBlogStatsAdminRoutes(app);
  registerGdprRoutes(app);
  registerHealthRoutes(app);
  registerRenderRoutes(app);
  // Server-side rendering: `/account/...` for the owner who asked for it, and
  // `/internal/render/...` for headless Chrome, which has no session and is
  // authenticated by the job's single-use token instead.
  registerRenderJobRoutes(app);
  registerRuntimeRoutes(app);
  registerAnalyticsRoutes(app);
  registerStripeUserRoutes(app);
  registerStripeAdminRoutes(app);
  registerReferralUserRoutes(app);

  return app;
}
