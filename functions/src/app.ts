/**
 * Express app mounted by the single `api` HTTPS function.
 *
 * Routes (auth):
 *   GET  /health                  liveness probe                  (open)
 *   GET  /providers               which AI providers have keys     (open)
 *   ANY  /proxy/openai/*          transparent OpenAI proxy         (verified)
 *   ANY  /proxy/google/*          transparent Gemini proxy         (verified)
 *   *    /print/*                  print fulfillment endpoints      (verified)
 *   POST /print-webhook           provider status callback         (HMAC-signed)
 *   *    /admin/print/webhooks    status-webhook management        (admin)
 *
 * Every request runs through `attachUser` (verifies the Firebase ID token if
 * present). `/proxy` and `/print` additionally `requireVerified` (a verified,
 * non-anonymous account). The print provider (Lulu) is an internal detail; no
 * provider identity is exposed in the route namespace or error responses.
 */
import express, { type Express } from "express";
import { attachUser, requireAdmin, requireVerified } from "./auth";
import { registerProviderRoutes } from "./providers";
import { registerProxyRoutes } from "./proxy";
import { registerLuluRoutes, registerPrintWebhookRoute } from "./lulu";
import { registerAiRoutes } from "./ai";
import { registerAdminRoutes } from "./admin";
import { registerHealthRoutes } from "./health";
import { registerRuntimeRoutes } from "./readiness";
import { registerAnalyticsRoutes } from "./analytics";
import {
  registerStripeAdminRoutes,
  registerStripeUserRoutes,
  registerStripeWebhookRoute,
} from "./stripe";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");

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

  // Stripe's event webhook — tokenless (authenticated by signature), so it MUST
  // be registered before the `/checkout` + `requireVerified` guard below.
  registerStripeWebhookRoute(app);

  // Protected surfaces — registered before their route handlers so the guard
  // runs first. All require a verified, non-anonymous account (guests and
  // unverified users are gated out of generation + fulfillment + payments).
  // `/admin` additionally requires admin status (Firestore `admins/{uid}`).
  app.use("/proxy", requireVerified);
  app.use("/print", requireVerified);
  app.use("/ai", requireVerified);
  app.use("/checkout", requireVerified);
  app.use("/account", requireVerified);
  app.use("/admin", requireVerified, requireAdmin);

  // Proxy routes attach their own raw body parser; the rest attach json.
  registerProxyRoutes(app);
  registerLuluRoutes(app);
  registerAiRoutes(app);
  registerAdminRoutes(app);
  registerHealthRoutes(app);
  registerRuntimeRoutes(app);
  registerAnalyticsRoutes(app);
  registerStripeUserRoutes(app);
  registerStripeAdminRoutes(app);

  return app;
}
