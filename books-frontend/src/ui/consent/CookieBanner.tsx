"use client";

import { useState } from "react";
import { Cookie } from "lucide-react";
import { Button } from "../components/Button";
import { Toggle } from "../components/Toggle";
import { useConsentStore } from "../../state/consentStore";
import { OPTIONAL_COOKIE_CATEGORIES, type CookieConfig } from "../../core/config/cookieConfig";

/**
 * First-party cookie consent banner, built from our own component kit so it
 * inherits the live brand color (the `brand-*` tokens are driven by the admin's
 * branding). Offers Accept all / Reject all on the same level (GDPR requires
 * rejecting to be as easy as accepting) plus a Customize panel with per-category
 * toggles. Copy comes from the admin cookie config.
 */
export function CookieBanner({
  config,
  privacyUrl,
  cookiePolicyUrl,
}: {
  config: CookieConfig;
  privacyUrl?: string;
  cookiePolicyUrl?: string;
}) {
  const open = useConsentStore((s) => s.open);
  const decided = useConsentStore((s) => s.decided);
  const acceptAll = useConsentStore((s) => s.acceptAll);
  const rejectAll = useConsentStore((s) => s.rejectAll);
  const decide = useConsentStore((s) => s.decide);
  const storedAnalytics = useConsentStore((s) => s.analytics);
  const storedMarketing = useConsentStore((s) => s.marketing);

  const [customizing, setCustomizing] = useState(false);
  const [choice, setChoice] = useState({ analytics: storedAnalytics, marketing: storedMarketing });

  if (!open) return null;

  const policyUrl = cookiePolicyUrl || privacyUrl;

  const CATEGORY_LABELS: Record<(typeof OPTIONAL_COOKIE_CATEGORIES)[number], string> = {
    analytics: "Analytics",
    marketing: "Marketing",
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={config.title}
      className="fixed inset-x-0 bottom-0 z-[100] px-3 pb-3 sm:px-5 sm:pb-5"
    >
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-xl">
        <div className="flex gap-3 p-4 sm:p-5">
          <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 sm:flex">
            <Cookie className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-ink-900">{config.title}</h2>
              <p className="text-xs leading-relaxed text-ink-500">
                {config.body}{" "}
                {policyUrl && (
                  <a
                    href={policyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Learn more
                  </a>
                )}
              </p>
            </div>

            {customizing && (
              <div className="space-y-2 rounded-xl bg-ink-50/70 p-3">
                <label className="flex items-start justify-between gap-3 opacity-70">
                  <span className="min-w-0">
                    <span className="text-xs font-semibold text-ink-800">Strictly necessary</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">
                      {config.categoryText.necessary}
                    </span>
                  </span>
                  <Toggle checked disabled onChange={() => {}} label="Necessary (always on)" />
                </label>
                {OPTIONAL_COOKIE_CATEGORIES.map((cat) => (
                  <label key={cat} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="text-xs font-semibold text-ink-800">{CATEGORY_LABELS[cat]}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">
                        {config.categoryText[cat]}
                      </span>
                    </span>
                    <Toggle
                      checked={choice[cat]}
                      onChange={(v) => setChoice((c) => ({ ...c, [cat]: v }))}
                      label={`${CATEGORY_LABELS[cat]} enabled`}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={acceptAll}>
                Accept all
              </Button>
              <Button size="sm" variant="secondary" onClick={rejectAll}>
                Reject non-essential
              </Button>
              {customizing ? (
                <Button size="sm" variant="ghost" onClick={() => decide(choice)}>
                  Save choices
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setCustomizing(true)}>
                  Customize
                </Button>
              )}
              {decided && (
                <button
                  type="button"
                  onClick={() => useConsentStore.getState().close()}
                  className="ml-auto text-[11px] font-medium text-ink-400 hover:text-ink-600"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
