/**
 * Stripe SDK access + environment detection.
 *
 * The backend holds a SECRET key + a webhook signing secret per environment
 * (sandbox/test vs live), selected by `serverConfig().stripe` (which mirrors the
 * fulfillment env unless STRIPE_ENV overrides it). This module is the single
 * place that constructs the SDK so the rest of the code never touches keys.
 *
 * The client is memoized per secret key, so flipping the env (or rotating the
 * key) transparently builds a fresh client on the next call.
 */
import Stripe from "stripe";
import { loadServerConfig } from "../../books-frontend/src/core/config/serverEnv";
import type { BillingEnv } from "../../books-frontend/src/core/config/plans";
import { serverConfig } from "./config";

const clientsByKey = new Map<string, Stripe>();

function clientFor(key: string): Stripe {
  const trimmed = key.trim();
  if (!trimmed) throw new StripeNotConfiguredError();
  const existing = clientsByKey.get(trimmed);
  if (existing) return existing;
  // Omit apiVersion so the SDK uses the version its types are built for; the
  // account's default API version still governs webhook event shapes.
  const client = new Stripe(trimmed, { appInfo: { name: "childbooks" } });
  clientsByKey.set(trimmed, client);
  return client;
}

/** Whether Stripe is configured at all (a secret key is present) for the ACTIVE environment. */
export function stripeConfigured(): boolean {
  return Boolean(serverConfig().stripe.secretKey.trim());
}

/**
 * The Stripe client for the active environment (honors the sandbox↔live
 * runtime toggle). Throws a typed-ish error when no secret key is configured
 * so callers can surface a clear 503.
 */
export function getStripe(): Stripe {
  return clientFor(serverConfig().stripe.secretKey);
}

/**
 * The Stripe secret key configured for an EXPLICIT environment, ignoring
 * whatever the sandbox↔live runtime toggle currently has active. Mirrors
 * `readiness.ts`'s `configFor()` — used by tooling (plan price sync) that
 * must reconcile against live before flipping the toggle.
 */
function keyFor(env: BillingEnv): string {
  return loadServerConfig(process.env as Record<string, string | undefined>, { envOverride: env }).stripe.secretKey;
}

/** Whether Stripe is configured for a SPECIFIC environment (not just the active one). */
export function stripeConfiguredFor(env: BillingEnv): boolean {
  return Boolean(keyFor(env).trim());
}

/** The Stripe client for a SPECIFIC environment, regardless of which is active. */
export function getStripeFor(env: BillingEnv): Stripe {
  return clientFor(keyFor(env));
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured (no secret key).");
    this.name = "StripeNotConfiguredError";
  }
}

/** The mode implied by a secret/publishable key, or "unknown". */
export function keyMode(key: string): "test" | "live" | "unknown" {
  const k = key.trim();
  if (!k) return "unknown";
  if (k.includes("_live_")) return "live";
  if (k.includes("_test_")) return "test";
  return "unknown";
}

/** Mask a secret for safe display: keep the prefix and last 4 chars. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "(unset)";
  const last4 = k.slice(-4);
  const prefix = k.slice(0, Math.min(8, k.length));
  return `${prefix}…${last4}`;
}

/**
 * The storefront base URL for Checkout/portal redirects — and for the render
 * page headless Chrome opens, which is served by that same app. In production a
 * missing PUBLIC_APP_URL is a hard error — silently falling back to localhost
 * would send paying customers to a dead URL after payment. The emulator keeps
 * the dev default (the Next dev server on :1420).
 */
export function appBaseUrl(): string {
  const url = serverConfig().stripe.appUrl;
  if (url) return url;
  if (process.env.FUNCTIONS_EMULATOR === "true") return "http://localhost:1420";
  throw new Error(
    "PUBLIC_APP_URL is not configured — Stripe redirect URLs cannot be built. " +
      "Set it (e.g. functions/.env.<projectId> or Secret Manager) and redeploy.",
  );
}

/** Whether the active Stripe environment is the test/sandbox one. */
export function isSandbox(): boolean {
  return serverConfig().stripe.env !== "live";
}

/**
 * Which Stripe account the active key talks to.
 *
 * Anything PERSISTED that names a Stripe object (customer ids, above all) has to
 * be scoped by this: the two environments are separate accounts, so an id minted
 * in one is `resource_missing` in the other, and the sandbox↔live toggle can
 * flip which one is active while those stored ids stay put.
 */
export function activeBillingEnv(): BillingEnv {
  return isSandbox() ? "sandbox" : "live";
}
