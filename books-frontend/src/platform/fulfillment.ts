/**
 * Fulfillment wiring — the single place that picks concrete adapters.
 *
 * TODAY (private, no backend): we build a Lulu provider that talks to Lulu
 * directly from the desktop client (Tauri's plugin fetch bypasses CORS) and an
 * asset host that uploads print files to a user-configured object store. The
 * Lulu OAuth2 credentials are read from the env file at build time. Sandbox and
 * live are SEPARATE Lulu accounts with their own key/secret, so we keep both
 * pairs (`VITE_LULU_SANDBOX_*` / `VITE_LULU_LIVE_*`) and select the one matching
 * `VITE_LULU_ENV`, falling back to the saved settings config.
 *
 * LATER (frontend/backend split): add a `createBackendProvider({ baseUrl })`
 * adapter that calls your server (which internally reuses this same Lulu
 * provider + a backend-signed asset host), then branch here. Nothing else in
 * the app changes because everyone depends on the {@link FulfillmentProvider}
 * and {@link AssetHost} ports — not on these implementations.
 *
 * Mirrors the adapter-selection pattern in `platform/storage.ts`.
 */
import type { AssetHostConfig, FulfillmentConfig, FulfillmentEnv } from "../core/settings";
import {
  createFirebaseStorageAssetHost,
  type FirebaseAssetHostConfig,
} from "../core/fulfillment/assetHost/firebase";
import {
  createFirebaseServiceAccountAssetHost,
  type FirebaseServiceAccountConfig,
} from "../core/fulfillment/assetHost/firebaseServiceAccount";
import { createHttpPutAssetHost } from "../core/fulfillment/assetHost/httpPut";
import { createManualAssetHost } from "../core/fulfillment/assetHost/manual";
import { createLuluProvider } from "../core/fulfillment/lulu/provider";
import type { AssetHost, FulfillmentProvider } from "../core/fulfillment/types";
import { httpFetch } from "./http";

/** Vite inlines `VITE_*` env vars at build time. */
const ENV = import.meta.env as Record<string, string | undefined>;

/**
 * Firebase service-account config from the env file. When present we upload as
 * admin (no open Storage rules needed). PRIVATE BUILDS ONLY — the key is inlined
 * into the bundle. Returns null unless all fields are present.
 */
function envFirebaseServiceAccount(): FirebaseServiceAccountConfig | null {
  const clientEmail = ENV.VITE_FIREBASE_CLIENT_EMAIL;
  const privateKey = ENV.VITE_FIREBASE_PRIVATE_KEY;
  const storageBucket = ENV.VITE_FIREBASE_STORAGE_BUCKET;
  if (!clientEmail || !privateKey || !storageBucket) return null;
  return {
    clientEmail,
    // Allow the key to be stored with escaped "\n" in a single-line env value.
    privateKey: privateKey.replace(/\\n/g, "\n"),
    storageBucket,
  };
}

/**
 * Firebase web config from the env file. Returns null unless the minimum fields
 * are present, so the saved settings config can act as the fallback.
 */
function envFirebaseConfig(): FirebaseAssetHostConfig | null {
  const apiKey = ENV.VITE_FIREBASE_API_KEY;
  const projectId = ENV.VITE_FIREBASE_PROJECT_ID;
  const storageBucket = ENV.VITE_FIREBASE_STORAGE_BUCKET;
  if (!apiKey || !projectId || !storageBucket) return null;
  return {
    apiKey,
    projectId,
    storageBucket,
    authDomain: ENV.VITE_FIREBASE_AUTH_DOMAIN,
    appId: ENV.VITE_FIREBASE_APP_ID,
    messagingSenderId: ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  };
}

/**
 * Resolve the active Lulu credentials from the env file. The env toggle picks
 * BOTH the environment and its matching key/secret pair, so they can never
 * drift apart (a sandbox key against the live host always 401s). Falls back to
 * the saved settings config when an env var is absent.
 */
function resolveLuluCreds(config: FulfillmentConfig): {
  clientKey: string;
  clientSecret: string;
  env: FulfillmentEnv;
} {
  const env: FulfillmentEnv = ENV.VITE_LULU_ENV === "live" ? "live" : "sandbox";
  const clientKey =
    env === "live" ? ENV.VITE_LULU_LIVE_CLIENT_KEY : ENV.VITE_LULU_SANDBOX_CLIENT_KEY;
  const clientSecret =
    env === "live" ? ENV.VITE_LULU_LIVE_CLIENT_SECRET : ENV.VITE_LULU_SANDBOX_CLIENT_SECRET;
  return {
    clientKey: clientKey ?? config.lulu.clientKey,
    clientSecret: clientSecret ?? config.lulu.clientSecret,
    env,
  };
}

export function createAssetHost(config: AssetHostConfig): AssetHost {
  // Env-configured Firebase wins, so adding the config to `.env` is all it takes
  // to enable hosting — no settings UI needed. A service account (admin) takes
  // precedence over the public Web SDK config when both are present.
  const envServiceAccount = envFirebaseServiceAccount();
  if (envServiceAccount) return createFirebaseServiceAccountAssetHost(envServiceAccount);

  const envFirebase = envFirebaseConfig();
  if (envFirebase) return createFirebaseStorageAssetHost(envFirebase);

  switch (config.kind) {
    case "firebase":
      return createFirebaseStorageAssetHost({
        apiKey: config.apiKey,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        authDomain: config.authDomain,
        appId: config.appId,
        messagingSenderId: config.messagingSenderId,
      });
    case "httpPut":
      return createHttpPutAssetHost({
        uploadBaseUrl: config.uploadBaseUrl,
        publicBaseUrl: config.publicBaseUrl,
        authHeader: config.authHeader,
      });
    case "manual":
    default:
      return createManualAssetHost();
  }
}

/**
 * Build the active fulfillment provider from current settings. Pass the
 * `fulfillment` slice of {@link AppSettings} (e.g. from the settings store) so
 * this stays decoupled from React/state.
 */
export function createFulfillment(config: FulfillmentConfig): FulfillmentProvider {
  // Direct-from-client (no backend). Swap point for a backend provider later.
  const creds = resolveLuluCreds(config);
  return createLuluProvider({
    httpFetch,
    assetHost: createAssetHost(config.assetHost),
    clientKey: () => creds.clientKey,
    clientSecret: () => creds.clientSecret,
    env: creds.env,
  });
}
