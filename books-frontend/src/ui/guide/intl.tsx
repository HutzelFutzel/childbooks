"use client";

/**
 * Trusted control labels for the Chat studio.
 *
 * Controls read the application's localization catalogue (`messages/*.json`,
 * namespace `guide`) in the UI language, never model output. In English an
 * admin override from Guided studio → Wording applies to the labels it covers.
 * The UI language is the browser's, limited to published locales.
 */
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import en from "../../../messages/en.json";
import de from "../../../messages/de.json";
import { guideCopy, type GuideCopyVars, type GuideLabelKey } from "../../core/guide/copy";
import { isPublished } from "../../core/i18n/publish";
import { useAppConfigStore } from "../../state/appConfigStore";

const CATALOGUES: Record<string, { guide: unknown }> = { en, de };

function uiLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const language = navigator.language?.slice(0, 2).toLowerCase() ?? "en";
  return CATALOGUES[language] && isPublished(language) ? language : "en";
}

export function GuideIntl({ children }: { children: React.ReactNode }) {
  const locale = useMemo(uiLocale, []);
  const messages = useMemo(
    () => ({ guide: { ...(en.guide as object), ...((CATALOGUES[locale]?.guide as object) ?? {}) } }),
    [locale],
  );
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

function icuVars(vars: GuideCopyVars = {}): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : (value as string | number);
  }
  return out;
}

/** A control label: the admin's wording in English, the catalogue otherwise. */
export function useGuideLabel(): (key: GuideLabelKey, vars?: GuideCopyVars) => string {
  const t = useTranslations("guide.labels");
  const overrides = useAppConfigStore((s) => s.guide.wording);
  const locale = useMemo(uiLocale, []);
  return useCallback(
    (key, vars) => (locale === "en" ? guideCopy(overrides, key, vars) : t(key, icuVars(vars))),
    [locale, overrides, t],
  );
}

/** Join names the way the UI language lists them ("Mia and Leo", "Mia und Leo"). */
export function useGuideList(): (names: readonly string[]) => string {
  const locale = useLocale();
  return useCallback(
    (names) => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names),
    [locale],
  );
}

export function useGuideT(
  namespace: "chrome" | "views" | "plate" | "sheet" | "conflict" | "storyTools" | "agent" | "ideas" | "examples" | "brief" | "looks",
) {
  return useTranslations(`guide.${namespace}`);
}
