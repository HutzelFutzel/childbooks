"use client";

import { useConsentStore } from "../../state/consentStore";

/**
 * Footer link that reopens the cookie consent banner so a visitor can change
 * their choice at any time (a GDPR requirement — consent must be withdrawable
 * as easily as it was given).
 */
export function CookieSettingsButton({ className }: { className?: string }) {
  const openPreferences = useConsentStore((s) => s.openPreferences);
  return (
    <button type="button" onClick={openPreferences} className={className}>
      Cookie settings
    </button>
  );
}
