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
 * toggles. Copy + labels come from the admin cookie config.
 *
 * Visual hierarchy: Accept all and Reject non-essential are always the SAME
 * button size and both a single click — only color/weight differ (Accept is
 * the filled primary action, Reject a plain outlined one). Differing button
 * *size* between accept/reject is a named example of a deceptive "Hindering"
 * pattern in EDPB guidance, so that's intentionally never varied here; only the
 * optional, non-mandatory "Customize" path is styled as a lower-key text link.
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
  const labels = config.buttonLabels;

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
                    {labels.learnMore}
                  </a>
                )}
              </p>
            </div>

            {customizing && (
              <div className="space-y-2 rounded-xl bg-ink-50/70 p-3">
                <label className="flex items-start justify-between gap-3 opacity-70">
                  <span className="min-w-0">
                    <span className="text-xs font-semibold text-ink-800">
                      {config.categoryLabels.necessary}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">
                      {config.categoryText.necessary}
                    </span>
                  </span>
                  <Toggle checked disabled onChange={() => {}} label="Necessary (always on)" />
                </label>
                {OPTIONAL_COOKIE_CATEGORIES.map((cat) => (
                  <label key={cat} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="text-xs font-semibold text-ink-800">
                        {config.categoryLabels[cat]}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">
                        {config.categoryText[cat]}
                      </span>
                    </span>
                    <Toggle
                      checked={choice[cat]}
                      onChange={(v) => setChoice((c) => ({ ...c, [cat]: v }))}
                      label={`${config.categoryLabels[cat]} enabled`}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {/* The two mandatory, equal-weight actions: same size, one click each. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="font-semibold" onClick={acceptAll}>
                  {labels.acceptAll}
                </Button>
                <Button size="sm" variant="secondary" onClick={rejectAll}>
                  {labels.rejectAll}
                </Button>
              </div>
              {/* Optional, non-mandatory third path — styled lower-key on purpose;
                  it adds a choice, it never stands in for Reject above. */}
              {customizing ? (
                <button
                  type="button"
                  onClick={() => decide(choice)}
                  className="text-[11px] font-medium text-ink-500 hover:text-ink-700 hover:underline"
                >
                  {labels.save}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCustomizing(true)}
                  className="text-[11px] font-medium text-ink-500 hover:text-ink-700 hover:underline"
                >
                  {labels.customize}
                </button>
              )}
              {decided && (
                <button
                  type="button"
                  onClick={() => useConsentStore.getState().close()}
                  className="ml-auto text-[11px] font-medium text-ink-400 hover:text-ink-600"
                >
                  {labels.close}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
