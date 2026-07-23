"use client";

import { useEffect } from "react";
import { initAnalytics } from "../../lib/firebase";
import { useConsentStore } from "../../state/consentStore";
import { initConsentModeDefaults } from "./consent";
import { CookieBanner } from "./CookieBanner";
import type { CookieConfig } from "../../core/config/cookieConfig";

/**
 * Orchestrates cookie consent for the whole app (rendered once in the root
 * layout). On mount it sets the Google Consent Mode v2 default (all non-essential
 * denied) and hydrates the stored decision against the active `consentVersion`.
 * Analytics (Google Analytics for Firebase) is initialized ONLY once the visitor
 * grants the analytics category — so no analytics cookies fire before consent.
 *
 * When cookie consent is disabled in the admin config, the banner never shows and
 * analytics stays off (fail-closed).
 */
export function ConsentManager({
  config,
  privacyUrl,
  cookiePolicyUrl,
}: {
  config: CookieConfig;
  privacyUrl?: string;
  cookiePolicyUrl?: string;
}) {
  const hydrate = useConsentStore((s) => s.hydrate);
  const hydrated = useConsentStore((s) => s.hydrated);
  const analyticsGranted = useConsentStore((s) => s.analytics);
  const decided = useConsentStore((s) => s.decided);

  // Set the Consent Mode default as early as possible, then hydrate the store.
  useEffect(() => {
    initConsentModeDefaults();
    hydrate(config.consentVersion);
  }, [hydrate, config.consentVersion]);

  // Load analytics only after explicit analytics consent.
  useEffect(() => {
    if (hydrated && decided && analyticsGranted) {
      void initAnalytics();
    }
  }, [hydrated, decided, analyticsGranted]);

  if (!config.enabled) return null;

  return <CookieBanner config={config} privacyUrl={privacyUrl} cookiePolicyUrl={cookiePolicyUrl} />;
}
