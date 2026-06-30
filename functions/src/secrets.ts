/**
 * Secret declarations (Cloud Secret Manager).
 *
 * These are bound to the `api` function (see index.ts). At runtime Firebase
 * injects each one into `process.env` under the SAME name, so `serverConfig()`
 * (which reads `process.env`) picks them up with no extra wiring.
 *
 * Set them once with the CLI, e.g.:
 *   firebase functions:secrets:set OPENAI_API_KEY
 *
 * For the emulator, put plain values in `functions/.env.local` (or
 * `functions/.secret.local`) instead.
 */
import { defineSecret } from "firebase-functions/params";

export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const GOOGLE_API_KEY = defineSecret("GOOGLE_API_KEY");

// Lulu uses separate OAuth credentials per environment. `serverEnv` selects the
// pair matching LULU_ENV; the legacy LULU_CLIENT_KEY/SECRET act as a fallback.
export const LULU_SANDBOX_CLIENT_KEY = defineSecret("LULU_SANDBOX_CLIENT_KEY");
export const LULU_SANDBOX_CLIENT_SECRET = defineSecret("LULU_SANDBOX_CLIENT_SECRET");
export const LULU_LIVE_CLIENT_KEY = defineSecret("LULU_LIVE_CLIENT_KEY");
export const LULU_LIVE_CLIENT_SECRET = defineSecret("LULU_LIVE_CLIENT_SECRET");

// Stripe holds a secret API key + a webhook signing secret per environment.
// `serverEnv` selects the pair matching STRIPE_ENV (which mirrors LULU_ENV when
// unset). The legacy STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET act as a fallback.
export const STRIPE_SANDBOX_SECRET_KEY = defineSecret("STRIPE_SANDBOX_SECRET_KEY");
export const STRIPE_SANDBOX_WEBHOOK_SECRET = defineSecret("STRIPE_SANDBOX_WEBHOOK_SECRET");
export const STRIPE_LIVE_SECRET_KEY = defineSecret("STRIPE_LIVE_SECRET_KEY");
export const STRIPE_LIVE_WEBHOOK_SECRET = defineSecret("STRIPE_LIVE_WEBHOOK_SECRET");

const BASE_SECRETS = [OPENAI_API_KEY, GOOGLE_API_KEY];
const SANDBOX_SECRETS = [
  LULU_SANDBOX_CLIENT_KEY,
  LULU_SANDBOX_CLIENT_SECRET,
  STRIPE_SANDBOX_SECRET_KEY,
  STRIPE_SANDBOX_WEBHOOK_SECRET,
];
const LIVE_SECRETS = [
  LULU_LIVE_CLIENT_KEY,
  LULU_LIVE_CLIENT_SECRET,
  STRIPE_LIVE_SECRET_KEY,
  STRIPE_LIVE_WEBHOOK_SECRET,
];

/** Every secret the backend can use, regardless of environment (for tooling). */
export const ALL_SECRETS = [...BASE_SECRETS, ...SANDBOX_SECRETS, ...LIVE_SECRETS];

/**
 * The secrets actually BOUND to the `api` function at deploy time.
 *
 * Firebase requires every bound secret to exist in Secret Manager, so binding
 * the live pair would force you to create live keys even while running sandbox.
 * We therefore bind the live secrets only when `LIVE_ENABLED=true` (set in
 * `functions/.env.<projectId>` once you've added the live keys). This value is
 * read at deploy "discovery" time, where the project env file is loaded.
 *
 * Consequence: to use live mode at runtime (incl. the admin sandbox↔live
 * toggle) you must have deployed with `LIVE_ENABLED=true` so the live secrets
 * are injected. The go-live readiness check enforces this before letting you flip.
 */
export function boundSecrets() {
  const liveEnabled = process.env.LIVE_ENABLED === "true";
  return liveEnabled ? ALL_SECRETS : [...BASE_SECRETS, ...SANDBOX_SECRETS];
}

/** Whether the live secrets are bound in this deployment. */
export function liveSecretsBound(): boolean {
  return process.env.LIVE_ENABLED === "true";
}
