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

// ZeptoMail (Zoho's transactional email service). The send token authenticates
// the send API; the webhook secret verifies incoming delivery/open/bounce
// events. Both are environment-agnostic (one account), so they live in the
// base secret set. Optional at runtime — email is a best-effort layer.
export const ZEPTOMAIL_TOKEN = defineSecret("ZEPTOMAIL_TOKEN");
export const ZEPTOMAIL_WEBHOOK_SECRET = defineSecret("ZEPTOMAIL_WEBHOOK_SECRET");

// Slack incoming-webhook URL(s) for event notifications (signups, purchases,
// ops alerts). Environment-agnostic and best-effort — `notifySlack` no-ops when
// unset — but note that binding a secret requires it to EXIST in Secret Manager
// at deploy time, so create it (`yarn setSecrets`) before the next deploy.
// SLACK_OPS_WEBHOOK_URL is optional; ops alerts fall back to SLACK_WEBHOOK_URL.
export const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");

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

const BASE_SECRETS = [
  OPENAI_API_KEY,
  GOOGLE_API_KEY,
  ZEPTOMAIL_TOKEN,
  ZEPTOMAIL_WEBHOOK_SECRET,
  SLACK_WEBHOOK_URL,
];
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
