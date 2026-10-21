"use client";

/**
 * Holds an admin page back until the config docs it reads have actually arrived.
 *
 * `appConfigStore` fills its fields with DEFAULTS and then overwrites them as
 * each Firestore snapshot lands. A page that renders in between shows seed
 * values that look like real (and wrong, or empty) data. `ConfigReady` shows a
 * skeleton for that gap instead, and says so if a doc could not be read at all.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { InlineError, PanelSkeleton, useAdminBusy } from "./LoadingState";

/** Never hold a page hostage: after this long, show it anyway (with a note). */
const GIVE_UP_AFTER_MS = 10_000;

/** Whether every doc in `ids` has delivered its first snapshot, and whether any failed. */
export function useConfigDocsStatus(ids: readonly string[]): { ready: boolean; failed: boolean } {
  const ready = useAppConfigStore((s) => ids.every((id) => s.loadedDocs[id] === true));
  const failed = useAppConfigStore((s) => ids.some((id) => s.failedDocs[id] === true));
  return { ready, failed };
}

/**
 * Which `appConfig` docs each admin page reads, by `section/tab`. A page that
 * isn't listed doesn't wait for config (it loads its own data, or none).
 */
const PAGE_DOCS: Record<string, readonly string[]> = {
  "configuration/catalog": ["products", "pricingSettings"],
  "configuration/markets": ["markets", "marketCapability", "pricingSettings"],
  "configuration/memberships": ["plans", "pricingSettings"],
  "configuration/sparks": ["sparks", "pricingSettings"],
  "configuration/financial": ["pricingSettings"],
  "configuration/discounts": ["pricingSettings", "sparks", "plans", "products"],
  "configuration/models": ["models"],
  "configuration/artStyles": ["artStyles"],
  "configuration/layouts": ["layouts"],
  "configuration/audience": ["audience", "ageWriting"],
  "configuration/storyCraft": ["storyCraft"],
  "configuration/bookLanguages": ["bookLanguages"],
  "configuration/typography": ["typography"],
  "configuration/guide": ["guide"],
  "configuration/prompts": ["prompts"],
  "marketing/announcements": ["announcements"],
  "marketing/seo": ["seo"],
  "marketing/branding": ["branding"],
  "marketing/qrCodes": ["qrCodes"],
  "marketing/campaigns": ["campaigns"],
  "communication/admin-slack": ["slackConfig"],
  "legal/documents": ["legal"],
  "legal/cookies": ["cookieConfig"],
};

const NO_DOCS: readonly string[] = [];

export function configDocsForPage(section: string, tab: string | null | undefined): readonly string[] {
  return PAGE_DOCS[`${section}/${tab ?? ""}`] ?? NO_DOCS;
}

/** Render `children` once every doc in `docs` has loaded; a skeleton until then. */
export function ConfigReady({ docs, children }: { docs: readonly string[]; children: ReactNode }) {
  const { ready, failed } = useConfigDocsStatus(docs);
  const [gaveUp, setGaveUp] = useState(false);
  const waiting = docs.length > 0 && !ready && !gaveUp;

  useAdminBusy(waiting);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (waiting) return <PanelSkeleton />;
  return (
    <>
      {(failed || (gaveUp && !ready)) && (
        <InlineError
          className="mb-4"
          message={
            failed
              ? "Some saved settings couldn't be loaded, so the values below may be defaults. Reload to try again."
              : "Settings are taking longer than usual to load — the values below may be defaults until they arrive."
          }
          onRetry={() => window.location.reload()}
        />
      )}
      {children}
    </>
  );
}
