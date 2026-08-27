/**
 * The routing contract shared by the middleware, the navigation helpers and
 * `generateStaticParams`.
 *
 * Everything here is derived from the locale manifest rather than restated, so
 * there is exactly one place that decides a locale's URL shape
 * (`pathPrefix`) and one place that decides whether it has URLs at all (the
 * publish gate).
 */
import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALES } from "@/core/i18n/locales";
import { routedLocaleIds } from "@/core/i18n/publish";

/**
 * Name of the cookie holding a visitor's explicit language choice.
 *
 * Read before `Accept-Language`, because a header describes the browser its
 * owner configured once and a cookie records a decision they just made on this
 * site.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * English keeps the unprefixed URLs it already ranks on, so prefixing is
 * `as-needed` rather than `always`: `/blog` stays English, `/de/blog` is German.
 *
 * This mirrors `pathPrefix: null` on the English manifest entry — asserted by
 * `yarn check:locales`, since the two encode the same decision and a mismatch
 * would either double-prefix English or leave German unreachable.
 */
export const routing = defineRouting({
  locales: routedLocaleIds(),
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "as-needed",
  // Negotiate from `Accept-Language` for first-time visitors, but only ever
  // towards a published locale — `routedLocaleIds()` is the whole candidate set.
  localeDetection: true,
  localeCookie: {
    name: LOCALE_COOKIE,
    // A language choice is a preference, not a session: it should survive
    // closing the browser, and it carries nothing identifying.
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

/**
 * The `Accept-Language` tags each routed locale answers to, most specific
 * first — `en-GB` must resolve to English rather than falling through to the
 * `x-default`.
 */
export function acceptLanguageTags(): Record<string, readonly string[]> {
  const routed = new Set(routing.locales);
  return Object.fromEntries(
    LOCALES.filter((l) => routed.has(l.id)).map((l) => [l.id, l.hreflang]),
  );
}
