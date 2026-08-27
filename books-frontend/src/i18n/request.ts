/**
 * How every server render resolves its locale and messages.
 *
 * `next-intl` looks for this file by convention (`src/i18n/request.ts`) and
 * calls it once per request, so it is the single place the active locale is
 * decided.
 *
 * The locale comes from the `[locale]` URL segment the middleware matched. It is
 * validated against the *published* set rather than the manifest: an id that
 * isn't routed can still arrive here — the segment acts as a catch-all for
 * unknown paths — and answering it with real messages would serve an
 * unpublished language instead of the 404 the layout is about to render.
 */
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, PSEUDO_LOCALE, fallbackChain, localeOrDefault } from "@/core/i18n/locales";
import { isPublished } from "@/core/i18n/publish";
import { pseudoLocalize, type MessageTree } from "@/core/i18n/pseudo";

/**
 * `PSEUDO_LOCALE=1 yarn dev` renders every message accented, padded and
 * bracketed. See `core/i18n/pseudo.ts` for what that buys.
 *
 * Gated on the build being non-production as well as the flag, so the one
 * mistake that would matter — shipping ⟦Ţüřñ á šţóřý⟧ to a customer — needs two
 * independent things to go wrong.
 */
const PSEUDO_ENABLED = process.env.NODE_ENV !== "production" && process.env.PSEUDO_LOCALE === "1";

async function loadCatalogue(locale: string): Promise<MessageTree> {
  return ((await import(`../../messages/${locale}.json`)) as { default: MessageTree }).default;
}

/**
 * Overlay `messages` onto `base`, key by key.
 *
 * A partially translated catalogue is the normal state of a live locale, not an
 * error: copy lands over days and `check:locales` reports what's outstanding.
 * Without a merge, `next-intl` would render the key itself — a customer reading
 * `marketing.hero.badge` — so an untranslated string falls back through the
 * locale's own chain instead, which for every non-English locale ends at
 * English.
 *
 * Blank strings are treated as absent. An empty value in a catalogue means a
 * translator hasn't filled it in, and showing nothing is worse than showing
 * English.
 */
function mergeCatalogues(base: MessageTree, overlay: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    if (typeof value === "string") {
      if (value.trim() !== "") out[key] = value;
    } else if (value && typeof value === "object") {
      out[key] = existing && typeof existing === "object" ? mergeCatalogues(existing, value) : value;
    }
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isPublished(requested) ? requested : DEFAULT_LOCALE;

  // Least-preferred first, so each merge overwrites the one beneath it and the
  // requested locale wins.
  const chain = [...fallbackChain(localeOrDefault(locale))].reverse();
  let messages: MessageTree = {};
  for (const id of [...chain, locale]) {
    messages = mergeCatalogues(messages, await loadCatalogue(id));
  }

  return {
    // `en-XA` is a user-assigned region subtag, so `Intl` resolves it back to
    // `en` for number and date formatting while still being visible in
    // `<html lang>` — the pseudo-locale changes the words, never the maths.
    locale: PSEUDO_ENABLED ? PSEUDO_LOCALE : locale,
    messages: PSEUDO_ENABLED ? pseudoLocalize(messages) : messages,
  };
});
