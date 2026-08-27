/**
 * Which locales are actually live — the gate between "this language exists in
 * the manifest" and "a customer can be served it".
 *
 * `LOCALES` describes every language the codebase knows how to render. That is
 * deliberately not the same list as the one we route, index, or offer in the
 * language switcher: a locale is a promise to the reader that the whole journey
 * works in their language, and most of that journey isn't translated the moment
 * the manifest entry lands.
 *
 * Publishing is therefore an explicit act — adding an id to
 * {@link PUBLISHED_LOCALE_IDS} — that is then *checked* against the things that
 * make it safe. Both halves matter. Deriving publication automatically would
 * put a half-translated language live the moment its catalogue appeared;
 * trusting the list alone would let a typo ship French to customers we can't
 * ship books to.
 */
import {
  DEFAULT_LOCALE,
  LOCALES,
  findLocale,
  type LocaleDefinition,
  type LocaleId,
} from "./locales";
import type { MarketRegistry } from "../config/markets";

/**
 * Locale ids with a message catalogue checked in at `messages/<id>.json`.
 *
 * Declared rather than read from disk because this list is needed in the Edge
 * middleware, which has no filesystem. `yarn check:locales` asserts it against
 * the actual directory, so the declaration cannot drift from reality without
 * failing CI.
 */
export const LOCALES_WITH_CATALOGUE: readonly string[] = ["en", "de"];

/**
 * The locales a visitor can currently reach. Adding an id here is the publish
 * decision, and it must be accompanied by whatever
 * {@link publishBlockers} demands.
 *
 * German has a catalogue draft and a market but is not listed: its
 * *content* — the landing copy, plan names and FAQ that live in Firestore — is
 * still English-only, so publishing it would serve a page that is German at the
 * edges and English in the middle. That's Phase 3's job.
 */
export const PUBLISHED_LOCALE_IDS: readonly LocaleId[] = ["en"];

/**
 * Everything standing between a locale and publication, as human-readable
 * reasons. Empty means it's safe to publish.
 *
 * Returned as a list rather than a boolean so `yarn check:locales` and the admin
 * UI can say *why* a language isn't live, which is the question anyone looking
 * at an unpublished locale is actually asking.
 */
export function publishBlockers(
  locale: LocaleDefinition,
  registry?: MarketRegistry,
): string[] {
  const blockers: string[] = [];

  if (!LOCALES_WITH_CATALOGUE.includes(locale.id)) {
    blockers.push(`no message catalogue (messages/${locale.id}.json)`);
  }

  // A locale with no market is a language we can greet someone in and then
  // refuse to sell to. See `defaultForMarkets` in the manifest.
  if (locale.defaultForMarkets.length === 0) {
    blockers.push("no market ships to its speakers yet");
  } else if (registry && !locale.defaultForMarkets.some((m) => registry.enabled.has(m))) {
    // Naming a market isn't the same as selling to it. Markets are admin-managed
    // now, so the manifest can legitimately claim a country that hasn't been
    // opened — and publishing on the strength of that claim is exactly the
    // "fully translated site that won't post a book" this gate exists to stop.
    blockers.push(
      `none of its markets (${locale.defaultForMarkets.join(", ")}) are open for business`,
    );
  }

  return blockers;
}

/** True when a locale is both explicitly published and free of blockers. */
export function isPublished(id: string, registry?: MarketRegistry): boolean {
  const locale = findLocale(id);
  if (!locale) return false;
  if (!PUBLISHED_LOCALE_IDS.includes(locale.id as LocaleId)) return false;
  // Belt and braces: the invariant makes this state unreachable, but a locale
  // that lost its catalogue should disappear from the site rather than serve
  // raw message keys.
  return publishBlockers(locale, registry).length === 0;
}

/** Published locales, in manifest order (the order a switcher should list them). */
export function publishedLocales(registry?: MarketRegistry): LocaleDefinition[] {
  return LOCALES.filter((l) => isPublished(l.id, registry));
}

/**
 * The locale ids the router knows about.
 *
 * This is what the middleware matches URL prefixes against and what
 * `generateStaticParams` builds pages for, so an unpublished locale has no
 * route at all: `/fr/blog` is a 404, not a redirect and not an English page
 * wearing a French URL. A redirect would tell a crawler the French URL is
 * meaningful; a 404 correctly says it doesn't exist yet.
 */
export function routedLocaleIds(): string[] {
  const ids = publishedLocales().map((l) => l.id);
  // The router must always have somewhere to send a request, even in the
  // pathological case where the default locale itself is blocked.
  return ids.length > 0 ? ids : [DEFAULT_LOCALE];
}
