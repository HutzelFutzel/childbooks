/**
 * Turning a route into the set of URLs that route has across locales.
 *
 * Kept apart from the metadata helpers in `server/` because the same mapping is
 * needed by things that aren't page metadata — the sitemap, the language
 * switcher — and because getting reciprocity right is a single rule best stated
 * once: every locale's URL for a path lists every other locale's URL for that
 * same path, including its own.
 */
import { localePath, type LocaleDefinition } from "./locales";
import { publishedLocales } from "./publish";

/** Absolute URL for a path in a given locale. */
export function localeUrl(siteUrl: string, locale: LocaleDefinition, path = "/"): string {
  return `${siteUrl.replace(/\/$/, "")}${localePath(locale, path)}`;
}

/**
 * The `hreflang` map for a path, in the shape Next's `alternates.languages`
 * wants, or `undefined` when there is nothing to declare.
 *
 * `undefined` while a single locale is published is the correct output, not a
 * shortcut: `hreflang` describes a *choice* between equivalent pages, so a
 * one-entry map plus an `x-default` pointing at itself tells a crawler nothing
 * it didn't already know from the canonical. The annotations start appearing on
 * their own the day a second locale passes the publish gate.
 *
 * Only published locales are listed. An unpublished locale's URL is a 404, and
 * pointing `hreflang` at a 404 is worse than omitting it — Google drops the
 * whole cluster's annotations when the reciprocal link doesn't resolve.
 */
export function hreflangLanguages(
  siteUrl: string,
  path = "/",
): Record<string, string> | undefined {
  const locales = publishedLocales();
  if (locales.length < 2) return undefined;

  const languages: Record<string, string> = {};
  for (const locale of locales) {
    const url = localeUrl(siteUrl, locale, path);
    // A locale can answer to several regional tags — `/` is the right page for
    // both `en-US` and `en-GB` — and each needs its own annotation.
    for (const tag of locale.hreflang) languages[tag] = url;
    if (locale.xDefault) languages["x-default"] = url;
  }
  return languages;
}

/**
 * Canonical URL plus `hreflang` alternates for a path, ready to spread into a
 * `Metadata` object.
 *
 * The canonical is always the *current* locale's URL: each localized page is the
 * canonical version of itself. Pointing every translation at the English URL —
 * a common reflex — would ask Google to drop the translations from the index.
 */
export function alternatesFor(
  siteUrl: string,
  locale: LocaleDefinition,
  path = "/",
): { canonical: string; languages?: Record<string, string> } {
  return {
    canonical: localeUrl(siteUrl, locale, path),
    languages: hreflangLanguages(siteUrl, path),
  };
}
