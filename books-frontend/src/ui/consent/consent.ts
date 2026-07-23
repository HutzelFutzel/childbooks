/**
 * Client-side cookie-consent primitives: the stored record, its versioned
 * localStorage persistence, and the Google Consent Mode v2 signalling helpers.
 *
 * Framework-agnostic (no React) so it can run from the earliest possible point.
 * The banner UI + orchestration live in `ConsentManager`/`CookieBanner`; the
 * reactive state lives in `state/consentStore`.
 */

/** Opt-in categories the visitor can grant (necessary is always on). */
export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}

/** The persisted consent record (localStorage). */
export interface ConsentRecord extends ConsentChoice {
  /** The `consentVersion` this choice was made against (drives re-consent). */
  version: string;
  /** Epoch ms the choice was made. */
  at: number;
}

const STORAGE_KEY = "cb_cookie_consent";

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (typeof parsed.version !== "string") return null;
    return {
      version: parsed.version,
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      at: typeof parsed.at === "number" ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}

export function writeConsent(record: ConsentRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // storage blocked (private mode) — consent mode still applies for the session
  }
}

// ---- Google Consent Mode v2 -----------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type DataLayer = unknown[];

function dataLayer(): DataLayer {
  const w = window as unknown as { dataLayer?: DataLayer };
  w.dataLayer = w.dataLayer || [];
  return w.dataLayer;
}

/** The classic gtag shim — queues commands onto the dataLayer for any Google tag. */
function gtag(...args: unknown[]): void {
  dataLayer().push(args);
}

/**
 * Push the Consent Mode v2 DEFAULT state (everything non-essential denied).
 * Call as early as possible — before any Google tag loads — so tags added later
 * (GA4, Google Ads) start in the correct, consent-denied state.
 */
export function initConsentModeDefaults(): void {
  if (typeof window === "undefined") return;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "granted",
    personalization_storage: "denied",
    security_storage: "granted",
  });
}

/** Push a Consent Mode v2 UPDATE reflecting the visitor's choice. */
export function updateConsentMode(choice: ConsentChoice): void {
  if (typeof window === "undefined") return;
  const analytics = choice.analytics ? "granted" : "denied";
  const marketing = choice.marketing ? "granted" : "denied";
  gtag("consent", "update", {
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
    analytics_storage: analytics,
    personalization_storage: marketing,
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
