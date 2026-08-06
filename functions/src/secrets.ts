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
import { defineBoolean, defineSecret } from "firebase-functions/params";

export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const GOOGLE_API_KEY = defineSecret("GOOGLE_API_KEY");

// ZeptoMail (Zoho's transactional email service). The send token authenticates
// the send API; the webhook secret verifies incoming delivery/open/bounce
// events. Both are environment-agnostic (one account), so they live in the
// base secret set. Optional at runtime — email is a best-effort layer.
export const ZEPTOMAIL_TOKEN = defineSecret("ZEPTOMAIL_TOKEN");
export const ZEPTOMAIL_WEBHOOK_SECRET = defineSecret("ZEPTOMAIL_WEBHOOK_SECRET");

// Slack incoming-webhook URL(s) for event notifications — one per channel (see
// notify.ts / core/notify/registry.ts). Environment-agnostic and best-effort —
// `notifySlack` no-ops when unset — but note that binding a secret requires it
// to EXIST in Secret Manager at deploy time, so create it (`yarn setSecrets`)
// before the next deploy.
//   SLACK_WEBHOOK_URL          #growth — required; every other channel falls
//                              back to this one when its own URL is unset, so
//                              a single webhook works out of the box.
//   SLACK_OPS_WEBHOOK_URL      #ops — optional.
//   SLACK_CONTACT_WEBHOOK_URL  #contact — optional.
// (CI/CD pings use a SEPARATE SLACK_CI_WEBHOOK_URL that lives only in GitHub
// Actions secrets, not here — see scripts/set-secrets.mjs.)
export const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");
export const SLACK_OPS_WEBHOOK_URL = defineSecret("SLACK_OPS_WEBHOOK_URL");
export const SLACK_CONTACT_WEBHOOK_URL = defineSecret("SLACK_CONTACT_WEBHOOK_URL");

// Rewardful (affiliate program). ONE account, no sandbox counterpart — a
// Rewardful account is tied to one Stripe account and ignores test-mode events,
// so both of these live in the base set and the code refuses to act while Stripe
// is in sandbox instead.
//   REWARDFUL_API_SECRET    Full access to the account (Company Settings page).
//   REWARDFUL_WEBHOOK_TOKEN OURS, not theirs: Rewardful webhooks are unsigned,
//                           so the endpoint is authenticated by this token in
//                           the URL registered with them. Generate any long
//                           random string (e.g. `openssl rand -hex 32`).
// Optional at runtime — everything affiliate-related no-ops when unset — but
// like the Slack URLs they must EXIST in Secret Manager before the next deploy
// (`yarn setSecrets`), because `api` binds the whole set.
export const REWARDFUL_API_SECRET = defineSecret("REWARDFUL_API_SECRET");
export const REWARDFUL_WEBHOOK_TOKEN = defineSecret("REWARDFUL_WEBHOOK_TOKEN");

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
  SLACK_OPS_WEBHOOK_URL,
  SLACK_CONTACT_WEBHOOK_URL,
  REWARDFUL_API_SECRET,
  REWARDFUL_WEBHOOK_TOKEN,
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
 * Flag set via `LIVE_ENABLED=true` in `functions/.env.<projectId>` once
 * you've added the live keys, used ONLY to report readiness at runtime (see
 * `liveSecretsBound()` below) — it does NOT gate which secrets get bound.
 *
 * NOTE ON WHY IT CAN'T GATE SECRET BINDING: `api` used to bind only
 * BASE_SECRETS + SANDBOX_SECRETS unless this flag was true, to avoid forcing
 * live keys to exist for sandbox-only deploys. That doesn't work: Firebase's
 * deploy "discovery" step loads this file and evaluates the function's
 * `secrets: [...]` array BEFORE any parameter/secret has a real resolved
 * value — so ANY conditional logic here that branches on a param's
 * `.value()` (this includes plain `process.env.LIVE_ENABLED` reads AND
 * `defineBoolean(...).value()` reads — both were tried) silently sees only
 * a fallback (`undefined`/the compile-time `default`), never the actual
 * `.env.<projectId>` value. The deploy succeeds without error, it just
 * silently binds the wrong (sandbox-only) secret set every time, no matter
 * what the `.env` file says. `api` now binds `ALL_SECRETS` unconditionally
 * (see index.ts), matching the other functions in this file's callers
 * (`jobs.ts`, `fulfillmentRetry.ts`, `printSyncJob.ts`), which sidesteps the
 * issue entirely since it needs no conditional logic to resolve at all.
 *
 * `.value()` DOES resolve correctly for params/secrets read at RUNTIME
 * (i.e. inside a request/handler body, after the function has cold-started)
 * — that's why `liveSecretsBound()` below still works fine.
 */
const LIVE_ENABLED = defineBoolean("LIVE_ENABLED", { default: false });

/** Whether live mode is enabled for this deployment (runtime-only check). */
export function liveSecretsBound(): boolean {
  return LIVE_ENABLED.value();
}
