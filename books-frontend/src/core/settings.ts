/** Application-level settings (local-first). */
import type { ProviderId } from "./config/options";

/** A reusable image asset uploaded by the user (stored in the blob store). */
export interface AssetItem {
  id: string;
  name: string;
  blobId: string;
  /** Natural aspect ratio (w/h) for default placement. */
  aspect?: number;
}

/** Which print environment Lulu requests target. */
export type FulfillmentEnv = "sandbox" | "live";

/**
 * Where print-ready files are uploaded so a print provider can fetch them.
 *   - "manual":   no host configured yet (orders fail with a clear message).
 *   - "httpPut":  a generic object store / file gateway reachable via HTTP PUT.
 *   - "firebase": Firebase Storage via the Web SDK (current default; the values
 *                 are the Firebase web config, sourced from the env file).
 * Config lives here for private/desktop use; it moves to a backend later.
 */
export type AssetHostConfig =
  | { kind: "manual" }
  | {
      kind: "httpPut";
      uploadBaseUrl: string;
      publicBaseUrl: string;
      authHeader?: string;
    }
  | {
      kind: "firebase";
      apiKey: string;
      projectId: string;
      storageBucket: string;
      authDomain?: string;
      appId?: string;
      messagingSenderId?: string;
      /**
       * Optional service-account credentials. When set, uploads authenticate as
       * admin (no open Storage rules needed). PRIVATE BUILDS ONLY — never ship
       * these in a distributed app; they belong on a backend.
       */
      clientEmail?: string;
      privateKey?: string;
    };

/**
 * Print-on-demand fulfillment configuration.
 *
 * Lulu uses OAuth2 client-credentials (a client key + secret pair). For the
 * desktop app these are sourced from the environment at build time (see
 * `platform/fulfillment.ts` / `.env`); this shape is kept so a backend can
 * reuse it verbatim via `loadServerConfig`.
 */
export interface FulfillmentConfig {
  lulu: { clientKey: string; clientSecret: string; env: FulfillmentEnv };
  assetHost: AssetHostConfig;
}

export interface AppSettings {
  apiKeys: Record<ProviderId, string>;
  /** Most-recently-used colors (newest first), for quick reuse in pickers. */
  colorHistory: string[];
  /** Reusable image assets available across the project library. */
  assets: AssetItem[];
  /** Print-on-demand fulfillment (Lulu + asset hosting). */
  fulfillment: FulfillmentConfig;
}

export function createDefaultFulfillmentConfig(): FulfillmentConfig {
  return {
    lulu: { clientKey: "", clientSecret: "", env: "sandbox" },
    // Firebase Storage is the default host; values come from the env file
    // (`VITE_FIREBASE_*`) — see `platform/fulfillment.ts`.
    assetHost: { kind: "firebase", apiKey: "", projectId: "", storageBucket: "" },
  };
}

export function createDefaultSettings(): AppSettings {
  return {
    apiKeys: { openai: "", google: "" },
    colorHistory: [],
    assets: [],
    fulfillment: createDefaultFulfillmentConfig(),
  };
}

export function hasKey(settings: AppSettings, provider: ProviderId): boolean {
  return Boolean(settings.apiKeys[provider]?.trim());
}

const COLOR_HISTORY_MAX = 18;

/** Add a color to the front of the MRU history (deduped, bounded). */
export function withColor(history: string[], color: string): string[] {
  const norm = color.trim();
  if (!norm) return history;
  const next = [norm, ...history.filter((c) => c.toLowerCase() !== norm.toLowerCase())];
  return next.slice(0, COLOR_HISTORY_MAX);
}
