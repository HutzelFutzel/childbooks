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

export const ALL_SECRETS = [
  OPENAI_API_KEY,
  GOOGLE_API_KEY,
  LULU_SANDBOX_CLIENT_KEY,
  LULU_SANDBOX_CLIENT_SECRET,
  LULU_LIVE_CLIENT_KEY,
  LULU_LIVE_CLIENT_SECRET,
  STRIPE_SANDBOX_SECRET_KEY,
  STRIPE_SANDBOX_WEBHOOK_SECRET,
  STRIPE_LIVE_SECRET_KEY,
  STRIPE_LIVE_WEBHOOK_SECRET,
];
