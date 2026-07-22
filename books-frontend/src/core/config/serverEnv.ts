/**
 * Backend env → typed config (architectural preparation, not used by the
 * desktop app yet).
 *
 * Today the Tauri client reads keys from local app settings. When the app is
 * split into frontend + backend, the backend will own the secrets and build its
 * config from environment variables — see `.env.example` at the repo root.
 *
 * This module is the single mapping between those env var names and the typed
 * config the existing provider adapters already consume. It is intentionally
 * PURE: it takes an env bag as a parameter (never touches `process.import.meta`
 * directly), so it is safe to bundle and trivial to unit-test. The backend will
 * simply call `loadServerConfig(process.env)`.
 */
import {
  createDefaultFulfillmentConfig,
  type AssetHostConfig,
  type FulfillmentConfig,
  type FulfillmentEnv,
} from "../settings";

/** Canonical env var names — keep in sync with `.env.example`. */
export const SERVER_ENV_VARS = {
  openaiApiKey: "OPENAI_API_KEY",
  googleApiKey: "GOOGLE_API_KEY",
  /**
   * Lulu issues SEPARATE OAuth client credentials per environment (the sandbox
   * pair only works against api.sandbox.lulu.com, the live pair only against
   * api.lulu.com). We hold both and select by `LULU_ENV`. The legacy
   * `LULU_CLIENT_KEY`/`LULU_CLIENT_SECRET` names are still honored as a fallback
   * for whichever env is active.
   */
  luluClientKey: "LULU_CLIENT_KEY",
  luluClientSecret: "LULU_CLIENT_SECRET",
  luluSandboxClientKey: "LULU_SANDBOX_CLIENT_KEY",
  luluSandboxClientSecret: "LULU_SANDBOX_CLIENT_SECRET",
  luluLiveClientKey: "LULU_LIVE_CLIENT_KEY",
  luluLiveClientSecret: "LULU_LIVE_CLIENT_SECRET",
  luluEnv: "LULU_ENV",
  /**
   * Stripe uses separate keys per environment (test/sandbox vs live). We hold
   * both and select by `STRIPE_ENV` (mirrors `LULU_ENV`). The legacy single
   * `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` names are honored as a fallback.
   */
  stripeEnv: "STRIPE_ENV",
  stripeSecretKey: "STRIPE_SECRET_KEY",
  stripeWebhookSecret: "STRIPE_WEBHOOK_SECRET",
  stripeSandboxSecretKey: "STRIPE_SANDBOX_SECRET_KEY",
  stripeSandboxWebhookSecret: "STRIPE_SANDBOX_WEBHOOK_SECRET",
  stripeLiveSecretKey: "STRIPE_LIVE_SECRET_KEY",
  stripeLiveWebhookSecret: "STRIPE_LIVE_WEBHOOK_SECRET",
  /**
   * Emulator-only override. The Stripe CLI listener (`scripts/dev.mjs`) mints its
   * own signing secret per run and injects it here; when present under the
   * Functions emulator it wins over any static sandbox value in `.env.local`, so
   * keeping a value in that file is harmless locally. Never set in production.
   */
  stripeEmulatorWebhookSecret: "STRIPE_EMULATOR_WEBHOOK_SECRET",
  /** Public base URL of the storefront, for Checkout success/cancel redirects. */
  publicAppUrl: "PUBLIC_APP_URL",
  assetHostKind: "ASSET_HOST_KIND",
  assetUploadBaseUrl: "ASSET_UPLOAD_BASE_URL",
  assetPublicBaseUrl: "ASSET_PUBLIC_BASE_URL",
  assetAuthHeader: "ASSET_AUTH_HEADER",
  firebaseApiKey: "FIREBASE_API_KEY",
  firebaseProjectId: "FIREBASE_PROJECT_ID",
  firebaseStorageBucket: "FIREBASE_STORAGE_BUCKET",
  firebaseAuthDomain: "FIREBASE_AUTH_DOMAIN",
  firebaseAppId: "FIREBASE_APP_ID",
  firebaseMessagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  firebaseClientEmail: "FIREBASE_CLIENT_EMAIL",
  firebasePrivateKey: "FIREBASE_PRIVATE_KEY",
} as const;

/** Stripe runtime configuration (selected per environment). */
export interface StripeConfig {
  env: FulfillmentEnv;
  secretKey: string;
  webhookSecret: string;
  /** Public storefront base URL for Checkout success/cancel redirects. */
  appUrl: string;
}

/** Everything the backend needs at runtime, in domain terms. */
export interface ServerConfig {
  /** AI provider keys (text + image generation). */
  openaiApiKey: string;
  googleApiKey: string;
  /** Print-on-demand fulfillment (reuses the same shape the adapters consume). */
  fulfillment: FulfillmentConfig;
  /** Payments (Stripe). */
  stripe: StripeConfig;
}

/** A bag of environment variables (e.g. `process.env`). */
export type EnvBag = Record<string, string | undefined>;

function parseEnv(value: string | undefined): FulfillmentEnv {
  return value === "live" ? "live" : "sandbox";
}

/**
 * Pick the Lulu OAuth credentials matching the active environment, falling back
 * to the legacy single-pair env vars when the env-specific ones are unset.
 */
function selectLuluCreds(
  env: EnvBag,
  luluEnv: FulfillmentEnv,
): { clientKey: string; clientSecret: string } {
  const legacyKey = env[SERVER_ENV_VARS.luluClientKey] ?? "";
  const legacySecret = env[SERVER_ENV_VARS.luluClientSecret] ?? "";
  if (luluEnv === "live") {
    return {
      clientKey: env[SERVER_ENV_VARS.luluLiveClientKey] || legacyKey,
      clientSecret: env[SERVER_ENV_VARS.luluLiveClientSecret] || legacySecret,
    };
  }
  return {
    clientKey: env[SERVER_ENV_VARS.luluSandboxClientKey] || legacyKey,
    clientSecret: env[SERVER_ENV_VARS.luluSandboxClientSecret] || legacySecret,
  };
}

/**
 * Pick the Stripe secret + webhook secret matching the active environment,
 * falling back to the legacy single-pair env vars when the env-specific ones
 * are unset.
 */
function selectStripe(env: EnvBag, stripeEnv: FulfillmentEnv): { secretKey: string; webhookSecret: string } {
  const legacySecret = env[SERVER_ENV_VARS.stripeSecretKey] ?? "";
  const legacyWebhook = env[SERVER_ENV_VARS.stripeWebhookSecret] ?? "";
  // Under the local Functions emulator the Stripe CLI listener signs events with
  // its own per-run secret (injected as STRIPE_EMULATOR_WEBHOOK_SECRET). Prefer it
  // over any static sandbox secret in .env.local so the two never drift apart.
  // Unset in production (no emulator), so live/sandbox resolution is unaffected.
  const emulatorWebhook =
    env.FUNCTIONS_EMULATOR === "true" ? (env[SERVER_ENV_VARS.stripeEmulatorWebhookSecret] ?? "") : "";
  if (stripeEnv === "live") {
    return {
      secretKey: env[SERVER_ENV_VARS.stripeLiveSecretKey] || legacySecret,
      webhookSecret: emulatorWebhook || env[SERVER_ENV_VARS.stripeLiveWebhookSecret] || legacyWebhook,
    };
  }
  return {
    secretKey: env[SERVER_ENV_VARS.stripeSandboxSecretKey] || legacySecret,
    webhookSecret: emulatorWebhook || env[SERVER_ENV_VARS.stripeSandboxWebhookSecret] || legacyWebhook,
  };
}

function parseAssetHost(env: EnvBag): AssetHostConfig {
  const kind = env[SERVER_ENV_VARS.assetHostKind];
  if (kind === "firebase") {
    return {
      kind: "firebase",
      apiKey: env[SERVER_ENV_VARS.firebaseApiKey] ?? "",
      projectId: env[SERVER_ENV_VARS.firebaseProjectId] ?? "",
      storageBucket: env[SERVER_ENV_VARS.firebaseStorageBucket] ?? "",
      authDomain: env[SERVER_ENV_VARS.firebaseAuthDomain] || undefined,
      appId: env[SERVER_ENV_VARS.firebaseAppId] || undefined,
      messagingSenderId: env[SERVER_ENV_VARS.firebaseMessagingSenderId] || undefined,
      clientEmail: env[SERVER_ENV_VARS.firebaseClientEmail] || undefined,
      privateKey: env[SERVER_ENV_VARS.firebasePrivateKey]?.replace(/\\n/g, "\n") || undefined,
    };
  }
  if (kind === "httpPut") {
    return {
      kind: "httpPut",
      uploadBaseUrl: env[SERVER_ENV_VARS.assetUploadBaseUrl] ?? "",
      publicBaseUrl: env[SERVER_ENV_VARS.assetPublicBaseUrl] ?? "",
      authHeader: env[SERVER_ENV_VARS.assetAuthHeader] || undefined,
    };
  }
  return { kind: "manual" };
}

/** Options for {@link loadServerConfig}. */
export interface LoadServerConfigOptions {
  /**
   * Force BOTH Lulu and Stripe to this environment, overriding the `LULU_ENV` /
   * `STRIPE_ENV` env vars. Used by the admin sandbox↔live toggle, which stores
   * the active environment at runtime (Firestore) rather than at deploy time.
   */
  envOverride?: FulfillmentEnv;
}

/**
 * Build a {@link ServerConfig} from environment variables. Missing values fall
 * back to safe defaults (empty keys, sandbox env, manual asset host).
 */
export function loadServerConfig(env: EnvBag, opts: LoadServerConfigOptions = {}): ServerConfig {
  const luluEnv = opts.envOverride ?? parseEnv(env[SERVER_ENV_VARS.luluEnv]);
  const luluCreds = selectLuluCreds(env, luluEnv);
  const fulfillment: FulfillmentConfig = {
    ...createDefaultFulfillmentConfig(),
    lulu: {
      clientKey: luluCreds.clientKey,
      clientSecret: luluCreds.clientSecret,
      env: luluEnv,
    },
    assetHost: parseAssetHost(env),
  };

  // Stripe defaults to its own env, but in practice it should track the same
  // environment as fulfillment (sandbox in dev, live in prod). If STRIPE_ENV is
  // unset we mirror LULU_ENV so a single switch flips the whole backend.
  const stripeEnv =
    opts.envOverride ?? (env[SERVER_ENV_VARS.stripeEnv] ? parseEnv(env[SERVER_ENV_VARS.stripeEnv]) : luluEnv);
  const stripeCreds = selectStripe(env, stripeEnv);

  return {
    openaiApiKey: env[SERVER_ENV_VARS.openaiApiKey] ?? "",
    googleApiKey: env[SERVER_ENV_VARS.googleApiKey] ?? "",
    fulfillment,
    stripe: {
      env: stripeEnv,
      secretKey: stripeCreds.secretKey,
      webhookSecret: stripeCreds.webhookSecret,
      appUrl: (env[SERVER_ENV_VARS.publicAppUrl] ?? "").replace(/\/+$/, ""),
    },
  };
}
