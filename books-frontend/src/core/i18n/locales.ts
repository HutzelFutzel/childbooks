/**
 * The locales this product exists in. Not a default — a CEILING, exactly like
 * {@link SUPPORTED_MARKETS} next door in `config/products.ts`.
 *
 * Adding a locale is not a switch an admin can flip: it needs a message
 * catalogue, a story-generation calibration, per-locale marketing copy and (for
 * anything indexable) reciprocal hreflang. A locale that goes live half-filled
 * shows a visitor two languages on one page, so the honest model is a short
 * explicit list in code and a lifecycle flag on top of it.
 *
 * The split of responsibility, which everything downstream depends on:
 *
 *   - **This file decides a locale EXISTS.** It gets a URL, a catalogue, and is
 *     previewable by admins. Nothing here makes it public.
 *   - **Firestore decides a locale is PUBLIC** (`draft` → `review` →
 *     `published`, landing with the admin Localization section). Only published
 *     locales are indexable, appear in the sitemap, or emit hreflang.
 *
 * One entry per *routed* locale, which is a **language**, not a country. `/de/`
 * serves Germany and (later) Austria and Switzerland; minting `/de-de/` and
 * `/de-ch/` for byte-identical copy would split ranking signals across
 * near-duplicates for no reader's benefit. Regional targeting is expressed by
 * listing several BCP-47 tags in {@link LocaleDefinition.hreflang} pointing at
 * the one URL, which is what that attribute is for.
 */
import type { AgeBandId } from "../config/ageWritingCatalog";

/**
 * Everything that makes one locale different from another, with **no optional
 * fields**.
 *
 * The exhaustiveness is the point. When a later phase discovers a new axis
 * along which languages differ, adding it here makes every existing locale
 * fail to compile until somebody has decided what it should be — the same
 * compile-time trip wire `CONFIG_TAB_EXHAUSTIVE` uses in `config/permissions.ts`.
 * A field that looks pointless at three locales (see {@link fontSubsets}) is
 * carrying its weight the day a fourth one needs it.
 */
export interface LocaleDefinition {
  /**
   * Language subtag, and the id used everywhere: the URL segment, the catalogue
   * filename, the Firestore key, and `<html lang>`.
   */
  id: string;
  /** Name in its own language — what the language switcher shows. Never a flag: one flag cannot mean three languages. */
  endonym: string;
  /** Name in English, for admin UI and logs. */
  englishName: string;
  /**
   * URL segment, or `null` for the locale served at the root.
   *
   * English stays at `/` rather than moving to `/en/`: the site already ranks
   * on those URLs and migrating every one of them buys nothing.
   */
  pathPrefix: string | null;
  /**
   * The BCP-47 tags this one URL is the right answer for, most specific first.
   *
   * Several regions legitimately map to one URL — `/` answers both `en-US` and
   * `en-GB`. Emitted verbatim as `hreflang` alternates once published.
   */
  hreflang: readonly string[];
  /**
   * True for the locale that answers `hreflang="x-default"` — where a visitor
   * whose language we don't speak should land. Exactly one locale sets it,
   * asserted by `yarn check:locales`.
   */
  xDefault: boolean;
  /** Reading direction. All four launch markets are `ltr`; the field exists so adding Arabic is a decision rather than an oversight. */
  direction: "ltr" | "rtl";
  /**
   * Locales to fall back through when a message is missing, most preferred
   * first. Never falls back *to* a language the reader didn't ask for without
   * this being explicit and visible.
   */
  fallback: readonly string[];
  /**
   * Markets this locale is the default *presentation* for — nothing more.
   *
   * Currency, tax and shipping follow the destination country, never the
   * language the visitor picked: a German customer reading in English still
   * pays EUR with German VAT. This field only answers "which language do we
   * greet a visitor from this market in".
   *
   * An empty array means the language exists but we've named no market it
   * greets. Note the type: plain ISO codes, NOT a union of currently-open
   * markets. Markets are now admin-managed data, so binding this list to them
   * at compile time is impossible — and would be wrong anyway, since a locale's
   * claim on a market has to be expressible BEFORE that market opens.
   *
   * The check that matters is a runtime one: the publish gate refuses a locale
   * whose markets aren't open, because a fully French site that then declines
   * to ship a book to France is worse than no French site.
   */
  defaultForMarkets: readonly string[];
  /** Story-generation calibration. See {@link StoryLanguage}. */
  story: StoryLanguage;
  /**
   * Language-specific slug spellings, on top of {@link BASE_TRANSLITERATION}.
   *
   * Only for cases where a language has a *convention* that differs from what
   * stripping the accent produces: NFKD turns `ü` into a bare `u`, which is
   * fine in French ("aigüe" → "aigue") and wrong in German, where the accepted
   * spelling is `ue`. Characters NFKD cannot handle at all belong in the shared
   * base map instead, because they break every language equally.
   *
   * An empty map means "the base map plus NFKD is already correct here".
   */
  slugTransliteration: Readonly<Record<string, string>>;
  /**
   * Google Fonts subsets the book-text fonts must ship for this language.
   *
   * `latin` (U+0000–00FF plus Œ/œ and friends) already covers German umlauts,
   * ß, and every French accent, so all three launch locales declare only it.
   * The field earns its place the first time a language needs `latin-ext`
   * (Polish, Czech, Turkish) — `yarn check:locales` asserts the catalogue
   * actually ships what is declared here, so a missing glyph is a failed check
   * rather than a tofu box in a printed book.
   */
  fontSubsets: readonly string[];
}

/** How the generation pipeline is told to write in this language. */
export interface StoryLanguage {
  /**
   * The language as the model should be instructed to write it, injected as
   * `{{languageName}}`. Prompt *instructions* stay in English — models follow
   * them reliably and one canonical registry beats six diverging copies — but
   * the story prose itself must come out in this language.
   */
  promptName: string;
  /**
   * Multiplier on the English word-count bounds for the same amount of story.
   *
   * Compounding languages say the same thing in fewer, longer words; Romance
   * languages take more. A single English-calibrated range makes German books
   * underfill their layouts and French ones overflow.
   *
   * These are starting calibrations, not measurements. Phase 5's golden-set
   * eval is what turns them into real numbers.
   */
  wordCountFactor: number;
  /**
   * Per-age-band replacements for `ageWritingCatalog`'s LLM guidance, where the
   * English original encodes English reading mechanics (sight words, phonics
   * progression, rhyme) that don't transfer.
   *
   * Deliberately sparse: an absent band means the English guidance is fine as
   * written. The field itself is required so "we checked and it's fine" and "we
   * never looked" are different states.
   */
  ageGuidance: Partial<Record<AgeBandId, string>>;
  /**
   * Glyphs image models routinely mangle when asked to bake cover typography.
   *
   * Non-empty means prefer overlay text over `textMode: "in-image"` for this
   * language, or at least warn — a cover reading "STRAE" is a reprint, and it
   * is discovered by the customer rather than by us.
   */
  riskyCoverGlyphs: readonly string[];
}

/**
 * Every locale that exists, in the order a language switcher should list them.
 *
 * `satisfies` rather than a type annotation so each `id` keeps its literal type
 * and {@link LocaleId} stays an exact union, while the object shape is still
 * checked field-by-field.
 */
export const LOCALES = [
  {
    id: "en",
    endonym: "English",
    englishName: "English",
    pathPrefix: null,
    hreflang: ["en-US", "en-GB", "en"],
    xDefault: true,
    direction: "ltr",
    fallback: [],
    defaultForMarkets: ["US", "GB", "CA", "AU"],
    story: {
      promptName: "English",
      wordCountFactor: 1,
      ageGuidance: {},
      riskyCoverGlyphs: [],
    },
    slugTransliteration: {},
    fontSubsets: ["latin"],
  },
  {
    id: "de",
    endonym: "Deutsch",
    englishName: "German",
    pathPrefix: "de",
    hreflang: ["de-DE", "de"],
    xDefault: false,
    direction: "ltr",
    fallback: ["en"],
    defaultForMarkets: ["DE"],
    story: {
      promptName: "German (Deutsch)",
      // Compounding: "Gutenachtgeschichte" is one word where English spends
      // three, so the same story lands short against English bounds.
      wordCountFactor: 0.88,
      ageGuidance: {},
      riskyCoverGlyphs: ["ä", "ö", "ü", "Ä", "Ö", "Ü", "ß"],
    },
    // German spells a dropped umlaut out rather than losing it: "für" is "fuer",
    // not "fur". `ß` needs no entry — it's in the shared base map, because it
    // breaks every language's slugs, not just German ones.
    slugTransliteration: {
      ä: "ae",
      ö: "oe",
      ü: "ue",
      Ä: "ae",
      Ö: "oe",
      Ü: "ue",
    },
    fontSubsets: ["latin"],
  },
  {
    id: "fr",
    endonym: "Français",
    englishName: "French",
    pathPrefix: "fr",
    hreflang: ["fr-FR", "fr"],
    xDefault: false,
    direction: "ltr",
    fallback: ["en"],
    defaultForMarkets: ["FR"],
    story: {
      promptName: "French (Français)",
      wordCountFactor: 1.15,
      ageGuidance: {},
      riskyCoverGlyphs: ["à", "â", "ç", "é", "è", "ê", "ë", "î", "ï", "ô", "ù", "û", "œ"],
    },
    // NFKD strips every French accent to the right bare letter, and `œ` — which
    // it cannot decompose — is handled by the shared base map.
    slugTransliteration: {},
    fontSubsets: ["latin"],
  },
] as const satisfies readonly LocaleDefinition[];

/** Every locale id that exists. Use in `Record<LocaleId, …>` to get the compile-time trip wire. */
export type LocaleId = (typeof LOCALES)[number]["id"];

/**
 * The locale served at `/`, and the one every fallback chain terminates at.
 *
 * Also the only locale whose message catalogue is allowed to be the source of
 * truth: `yarn check:locales` compares every other catalogue against this one.
 */
export const DEFAULT_LOCALE: LocaleId = "en";

/**
 * Pseudo-locale for finding un-extracted strings and layout that can't take a
 * longer translation. Never routed, never published, never in `LOCALES` — it is
 * generated from the English catalogue at request time (see `pseudo.ts`).
 */
export const PSEUDO_LOCALE = "en-XA";

export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === "string" && LOCALES.some((l) => l.id === value);
}

/** The definition for a locale id, or `undefined` if it doesn't exist. */
export function findLocale(id: string): LocaleDefinition | undefined {
  return LOCALES.find((l) => l.id === id);
}

/**
 * The definition for a locale id, falling back to {@link DEFAULT_LOCALE}.
 *
 * For call sites that have already validated the id (routing, request config)
 * and shouldn't have to handle an impossible `undefined`.
 */
export function localeOrDefault(id: string): LocaleDefinition {
  return findLocale(id) ?? (LOCALES.find((l) => l.id === DEFAULT_LOCALE) as LocaleDefinition);
}

/**
 * The path for a route in a given locale — `/about` → `/de/about`.
 *
 * The root locale is returned unprefixed, which is why `pathPrefix` is nullable
 * rather than `""`: an empty segment silently produces `//about`.
 */
export function localePath(locale: LocaleDefinition, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!locale.pathPrefix) return clean;
  return clean === "/" ? `/${locale.pathPrefix}` : `/${locale.pathPrefix}${clean}`;
}

/**
 * The fallback chain for a locale, ending at {@link DEFAULT_LOCALE}, without
 * the locale itself.
 *
 * Resolvers walk this in order. It always terminates at English, so a lookup
 * can't loop or come back empty — but note that reaching the end of it means
 * showing a reader a language they didn't ask for, which is why the publish
 * gate exists to make that state unreachable in production.
 */
export function fallbackChain(locale: LocaleDefinition): string[] {
  const chain = [...locale.fallback];
  if (locale.id !== DEFAULT_LOCALE && !chain.includes(DEFAULT_LOCALE)) chain.push(DEFAULT_LOCALE);
  return chain;
}

/**
 * Latin letters that Unicode normalisation cannot help with, and what they
 * should become in a URL.
 *
 * NFKD only decomposes characters that are *composed* of a base letter plus a
 * mark. These aren't — `ß` and `œ` are atomic — so they pass through NFKD
 * untouched and are then eaten by the `[^a-z0-9]` pass in `slugify()`, turning
 * "Straße" into "stra-e" and "Cœur" into "c-ur".
 *
 * Shared across every locale rather than per-language, because the letter is
 * what breaks, not the language: an English post titled "Hors d'œuvre" or a
 * German place name in a French article hits exactly the same bug.
 */
export const BASE_TRANSLITERATION: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "ss",
  œ: "oe",
  Œ: "oe",
  æ: "ae",
  Æ: "ae",
  ø: "o",
  Ø: "o",
  ł: "l",
  Ł: "l",
  đ: "d",
  Đ: "d",
  þ: "th",
  Þ: "th",
};

/**
 * Rewrite a string's un-normalisable and language-specific letters, ready for
 * `slugify()` to finish the job.
 *
 * Must run *before* NFKD, since it works on the composed characters. Split out
 * from `slugify()` so the blog can call it per post locale and
 * `yarn check:locales` can assert it against a table of cases — this function
 * is the reason "Straße" reaches `strasse`.
 */
export function transliterate(locale: LocaleDefinition, input: string): string {
  // Locale last: a language-specific convention (German `ü` → `ue`) must be
  // able to override the shared default, never the other way round.
  const map = { ...BASE_TRANSLITERATION, ...locale.slugTransliteration };
  let out = input;
  for (const [from, to] of Object.entries(map)) out = out.split(from).join(to);
  return out;
}
