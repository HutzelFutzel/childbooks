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
  luluClientKey: "LULU_CLIENT_KEY",
  luluClientSecret: "LULU_CLIENT_SECRET",
  luluEnv: "LULU_ENV",
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

/** Everything the backend needs at runtime, in domain terms. */
export interface ServerConfig {
  /** AI provider keys (text + image generation). */
  openaiApiKey: string;
  googleApiKey: string;
  /** Print-on-demand fulfillment (reuses the same shape the adapters consume). */
  fulfillment: FulfillmentConfig;
}

/** A bag of environment variables (e.g. `process.env`). */
export type EnvBag = Record<string, string | undefined>;

function parseEnv(value: string | undefined): FulfillmentEnv {
  return value === "live" ? "live" : "sandbox";
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

/**
 * Build a {@link ServerConfig} from environment variables. Missing values fall
 * back to safe defaults (empty keys, sandbox env, manual asset host).
 */
export function loadServerConfig(env: EnvBag): ServerConfig {
  const fulfillment: FulfillmentConfig = {
    ...createDefaultFulfillmentConfig(),
    lulu: {
      clientKey: env[SERVER_ENV_VARS.luluClientKey] ?? "",
      clientSecret: env[SERVER_ENV_VARS.luluClientSecret] ?? "",
      env: parseEnv(env[SERVER_ENV_VARS.luluEnv]),
    },
    assetHost: parseAssetHost(env),
  };

  return {
    openaiApiKey: env[SERVER_ENV_VARS.openaiApiKey] ?? "",
    googleApiKey: env[SERVER_ENV_VARS.googleApiKey] ?? "",
    fulfillment,
  };
}
