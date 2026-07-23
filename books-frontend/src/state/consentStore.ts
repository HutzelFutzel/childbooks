/**
 * Reactive cookie-consent state.
 *
 * Hydrates from the versioned localStorage record and exposes the visitor's
 * choice + whether the banner should show. When the admin bumps the cookie
 * `consentVersion`, a previously-stored decision no longer matches and the
 * banner re-appears (re-consent). The "Cookie settings" footer link calls
 * `openPreferences()` to reopen it anytime.
 */
import { create } from "zustand";
import {
  readConsent,
  updateConsentMode,
  writeConsent,
  type ConsentChoice,
} from "../ui/consent/consent";

interface ConsentState {
  /** True once we've read localStorage on the client. */
  hydrated: boolean;
  /** The active consent version (from the admin cookie config). */
  version: string;
  /** Whether a valid decision exists for the active version. */
  decided: boolean;
  analytics: boolean;
  marketing: boolean;
  /** Whether the banner / preferences panel is visible. */
  open: boolean;

  /** Load the stored decision for the given active version (idempotent-ish). */
  hydrate: (version: string) => void;
  /** Persist a decision, apply Consent Mode, and close the banner. */
  decide: (choice: ConsentChoice) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  /** Reopen the banner/preferences (e.g. from the footer "Cookie settings"). */
  openPreferences: () => void;
  close: () => void;
}

export const useConsentStore = create<ConsentState>((set, get) => ({
  hydrated: false,
  version: "1",
  decided: false,
  analytics: false,
  marketing: false,
  open: false,

  hydrate(version) {
    const record = readConsent();
    const valid = !!record && record.version === version;
    set({
      hydrated: true,
      version,
      decided: valid,
      analytics: valid ? record!.analytics : false,
      marketing: valid ? record!.marketing : false,
      // Show the banner when there's no valid decision for this version.
      open: !valid,
    });
    // If a valid prior decision exists, re-apply Consent Mode for this session.
    if (valid && record) {
      updateConsentMode({ analytics: record.analytics, marketing: record.marketing });
    }
  },

  decide(choice) {
    const version = get().version;
    writeConsent({ ...choice, version, at: Date.now() });
    updateConsentMode(choice);
    set({ decided: true, analytics: choice.analytics, marketing: choice.marketing, open: false });
  },

  acceptAll() {
    get().decide({ analytics: true, marketing: true });
  },

  rejectAll() {
    get().decide({ analytics: false, marketing: false });
  },

  openPreferences() {
    set({ open: true });
  },

  close() {
    // Only allow closing without a decision if one already exists.
    if (get().decided) set({ open: false });
  },
}));
