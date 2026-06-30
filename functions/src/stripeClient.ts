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
import { serverConfig } from "./config";

let cached: { key: string; client: Stripe } | null = null;

/** Whether Stripe is configured at all (a secret key is present). */
export function stripeConfigured(): boolean {
  return Boolean(serverConfig().stripe.secretKey.trim());
}

/**
 * The Stripe client for the active environment. Throws a typed-ish error when no
 * secret key is configured so callers can surface a clear 503.
 */
export function getStripe(): Stripe {
  const key = serverConfig().stripe.secretKey.trim();
  if (!key) {
    throw new StripeNotConfiguredError();
  }
  if (cached && cached.key === key) return cached.client;
  // Omit apiVersion so the SDK uses the version its types are built for; the
  // account's default API version still governs webhook event shapes.
  const client = new Stripe(key, { appInfo: { name: "childbooks" } });
  cached = { key, client };
  return client;
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

/** The storefront base URL for redirects (defaults to the Next dev server). */
export function appBaseUrl(): string {
  const url = serverConfig().stripe.appUrl;
  // Local dev runs the Next app on :1420 (see books-frontend `dev` script).
  return url || "http://localhost:1420";
}

/** Whether the active Stripe environment is the test/sandbox one. */
export function isSandbox(): boolean {
  return serverConfig().stripe.env !== "live";
}
