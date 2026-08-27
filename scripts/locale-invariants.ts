/**
 * Locale invariants — the properties that must hold for every locale we ship.
 *
 * These are the failures that don't throw and don't show up in a typecheck. A
 * message key present in English and missing in German renders blank or falls
 * back silently. A translation that dropped `{minutes}` shows a customer a
 * literal brace. Two locales both claiming `hreflang="de-DE"` makes Google
 * discard the whole cluster. None of it is visible until it's in front of
 * somebody, and all of it is cheap to assert.
 *
 * Run by `yarn check:locales`, which bundles this with esbuild first — same
 * reasoning as `pricing-invariants.ts`: the registry and the pseudo-localizer
 * live in the Next workspace as TypeScript, and restating either one in a plain
 * .mjs checker would let the checker pass while the shipped code was wrong.
 *
 * Grows with each phase rather than being replaced: key parity now, hreflang
 * reciprocity once routing exists, publish-gate conditions once the admin
 * lifecycle does, slug rules once the blog is locale-aware. One script, one
 * command, one place to look.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LOCALE,
  LOCALES,
  fallbackChain,
  localePath,
  transliterate,
  type LocaleDefinition,
} from "../books-frontend/src/core/i18n/locales";
import {
  LOCALES_WITH_CATALOGUE,
  PUBLISHED_LOCALE_IDS,
  isPublished,
  publishBlockers,
  publishedLocales,
  routedLocaleIds,
} from "../books-frontend/src/core/i18n/publish";
import { hreflangLanguages, localeUrl } from "../books-frontend/src/core/i18n/urls";
import { routing } from "../books-frontend/src/i18n/routing";
import { pseudoLocalizeMessage, type MessageTree } from "../books-frontend/src/core/i18n/pseudo";
import { isIsoCountry } from "../books-frontend/src/core/config/countries";
import {
  createDefaultMarketsConfig,
  enabledMarkets,
  registryFrom,
} from "../books-frontend/src/core/config/markets";

/**
 * The markets a fresh deployment opens. A static check can't know what an admin
 * has switched on since, so this is the floor these invariants hold against —
 * runtime market changes are the publish gate's business, not this script's.
 */
const SEED_REGISTRY = registryFrom(createDefaultMarketsConfig());
import {
  SITE_TEXT_SLOTS,
  createDefaultSiteContentConfig,
  normalizeSiteContentConfig,
  siteTextFor,
  withSiteTextOverride,
} from "../books-frontend/src/core/config/siteContent";
import { slugify } from "../books-frontend/src/core/config/blog";
import { VARIANT_AXIS_DEFS } from "../books-frontend/src/core/config/variants";
import { SHIPPING_METHODS } from "../books-frontend/src/core/fulfillment/types";
import { LULU_BOOK_FORMATS } from "../books-frontend/src/core/fulfillment/lulu/products";
import { parse as parseIcu } from "@formatjs/icu-messageformat-parser";
import { FULFILLMENT_STATUS, STAGE_STATUS } from "../books-frontend/src/ui/checkout/orderStatus";

const failures: string[] = [];
const checks: string[] = [];
const notes: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Advisory: true today, worth seeing, not worth failing a build over. */
function note(message: string): void {
  notes.push(message);
}

// The .mjs wrapper knows where the repo is; the bundle it builds does not (it
// executes from node_modules/.cache), so the path arrives by environment
// rather than being guessed from `import.meta.url` or `cwd`.
const ROOT = process.env.CHILDBOOKS_ROOT;
if (!ROOT) throw new Error("CHILDBOOKS_ROOT is not set — run this through `yarn check:locales`.");
const MESSAGES_DIR = join(ROOT, "books-frontend", "messages");
const SRC_DIR = join(ROOT, "books-frontend", "src");

/** Every TypeScript source file under the frontend, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

// ---- Registry shape --------------------------------------------------------

{
  const ids = LOCALES.map((l) => l.id);
  check("locale ids are unique", new Set(ids).size === ids.length, ids.join(", "));

  const roots = LOCALES.filter((l) => l.pathPrefix === null);
  check(
    "exactly one locale is served at the root",
    roots.length === 1,
    `${roots.length} locales have a null pathPrefix`,
  );

  const prefixes = LOCALES.map((l) => l.pathPrefix).filter((p): p is string => p !== null);
  check("URL prefixes are unique", new Set(prefixes).size === prefixes.length, prefixes.join(", "));
  check(
    "URL prefixes are bare path segments",
    prefixes.every((p) => /^[a-z]{2}(-[a-z]{2})?$/i.test(p)),
    prefixes.join(", "),
  );

  const xDefaults = LOCALES.filter((l) => l.xDefault);
  check(
    "exactly one locale answers hreflang x-default",
    xDefaults.length === 1,
    xDefaults.map((l) => l.id).join(", ") || "none",
  );

  const fallbackLocale = LOCALES.find((l) => l.id === DEFAULT_LOCALE);
  check("DEFAULT_LOCALE exists in the registry", fallbackLocale !== undefined, DEFAULT_LOCALE);
  // The root URL, x-default and the end of every fallback chain must be the
  // same locale. Split them and a missing translation sends a reader to one
  // language while search engines are told about another.
  check(
    "DEFAULT_LOCALE is the root locale",
    fallbackLocale?.pathPrefix === null,
    `pathPrefix=${String(fallbackLocale?.pathPrefix)}`,
  );
  check("DEFAULT_LOCALE is the x-default locale", fallbackLocale?.xDefault === true);
  check(
    "DEFAULT_LOCALE falls back to nothing",
    (fallbackLocale?.fallback.length ?? -1) === 0,
    fallbackLocale?.fallback.join(", "),
  );
}

// ---- hreflang --------------------------------------------------------------

{
  const claimed = new Map<string, string[]>();
  for (const locale of LOCALES) {
    check(
      `${locale.id} declares at least one hreflang tag`,
      locale.hreflang.length > 0,
    );
    // A tag pointing at two URLs is the one hreflang mistake Google resolves by
    // ignoring the entire set, so it can never be a warning.
    for (const tag of locale.hreflang) {
      claimed.set(tag.toLowerCase(), [...(claimed.get(tag.toLowerCase()) ?? []), locale.id]);
    }
    check(
      `${locale.id} claims its own bare language tag`,
      locale.hreflang.some((t) => t.toLowerCase() === locale.id.toLowerCase()),
      locale.hreflang.join(", "),
    );
    check(
      `${locale.id} hreflang tags are well-formed BCP-47`,
      locale.hreflang.every((t) => /^[a-z]{2}(-[A-Z]{2})?$/.test(t)),
      locale.hreflang.join(", "),
    );
  }

  const contested = [...claimed.entries()].filter(([, owners]) => owners.length > 1);
  check(
    "no hreflang tag is claimed by two locales",
    contested.length === 0,
    contested.map(([tag, owners]) => `${tag} → ${owners.join(" + ")}`).join("; "),
  );
}

// ---- Fallback chains -------------------------------------------------------

for (const locale of LOCALES) {
  const chain = fallbackChain(locale);
  check(
    `${locale.id} fallback chain has no repeats`,
    new Set(chain).size === chain.length,
    chain.join(" → "),
  );
  check(
    `${locale.id} fallback chain does not include itself`,
    !chain.includes(locale.id),
    chain.join(" → "),
  );
  check(
    `${locale.id} fallback chain resolves to known locales`,
    chain.every((id) => LOCALES.some((l) => l.id === id)),
    chain.join(" → "),
  );
  if (locale.id !== DEFAULT_LOCALE) {
    check(
      `${locale.id} fallback chain terminates at ${DEFAULT_LOCALE}`,
      chain[chain.length - 1] === DEFAULT_LOCALE,
      chain.join(" → "),
    );
  }
}

// ---- Markets ---------------------------------------------------------------

{
  const owner = new Map<string, string[]>();
  for (const locale of LOCALES) {
    for (const market of locale.defaultForMarkets) {
      owner.set(market, [...(owner.get(market) ?? []), locale.id]);
    }
  }

  const contested = [...owner.entries()].filter(([, ls]) => ls.length > 1);
  check(
    "no market has two default languages",
    contested.length === 0,
    contested.map(([m, ls]) => `${m} → ${ls.join(" + ")}`).join("; "),
  );

  // Every country we take money from needs a language we greet them in.
  // Otherwise a visitor from a market we actively sell to lands on whatever the
  // root happens to be, which is a decision nobody made.
  //
  // Checked against the SEEDED markets, since that's the only market list a
  // static check can know — an admin can open a country at runtime, and the
  // runtime consequence is handled by `publishBlockers`, not here.
  const unclaimed = enabledMarkets(SEED_REGISTRY).filter((m) => !owner.has(m));
  check(
    "every seeded market has a default language",
    unclaimed.length === 0,
    unclaimed.join(", "),
  );

  // Every claimed market must at least be a real country. It need NOT be open:
  // markets are admin-managed now, so a locale can name a country before it's
  // switched on, and the publish gate is what keeps that from going live.
  for (const locale of LOCALES) {
    const bogus = locale.defaultForMarkets.filter((m) => !isIsoCountry(m));
    check(`${locale.id} claims only real countries`, bogus.length === 0, bogus.join(", "));

    const closed = locale.defaultForMarkets.filter((m) => !SEED_REGISTRY.enabled.has(m));
    if (closed.length > 0) {
      note(
        `${locale.id} (${locale.englishName}) claims ${closed.join(", ")}, which the seed doesn't open — publishable only once an admin opens one of its markets.`,
      );
    }
    if (locale.defaultForMarkets.length === 0) {
      note(
        `${locale.id} (${locale.englishName}) names no market — not publishable until one is assigned.`,
      );
    }
  }
}

// ---- Story calibration -----------------------------------------------------

for (const locale of LOCALES) {
  const { wordCountFactor, promptName, riskyCoverGlyphs } = locale.story;
  check(
    `${locale.id} word-count factor is plausible`,
    wordCountFactor >= 0.5 && wordCountFactor <= 2,
    String(wordCountFactor),
  );
  check(`${locale.id} declares a prompt language name`, promptName.trim().length > 0);
  // A glyph flagged as risky for cover baking must actually be a character the
  // language uses, or the warning it drives is noise.
  check(
    `${locale.id} risky cover glyphs are single characters`,
    riskyCoverGlyphs.every((g) => [...g].length === 1),
    riskyCoverGlyphs.join(""),
  );
}

check(
  `${DEFAULT_LOCALE} word-count factor is exactly 1`,
  LOCALES.find((l) => l.id === DEFAULT_LOCALE)?.story.wordCountFactor === 1,
);

// ---- Fonts -----------------------------------------------------------------

for (const locale of LOCALES) {
  check(
    `${locale.id} declares font subsets`,
    locale.fontSubsets.length > 0,
  );
  // Every language we plan to support is Latin-script, and `latin` is the
  // subset that carries the ASCII range — a locale without it would render
  // tofu for its own alphabet.
  check(
    `${locale.id} includes the latin font subset`,
    locale.fontSubsets.includes("latin"),
    locale.fontSubsets.join(", "),
  );
}

// ---- Slug transliteration --------------------------------------------------

/**
 * Cases that must survive the slug pipeline, per locale.
 *
 * Two distinct bugs are pinned here. **Atomic letters** — `ß`, `œ` — are not
 * decomposable, so NFKD leaves them intact and the `[^a-z0-9]` pass turns them
 * into a hyphen: "Straße" becomes "stra-e" and "Cœur" becomes "c-ur". Those are
 * language-independent, which is why the English rows test them too. **Dropped
 * umlauts** are correct-but-wrong: NFKD strips `ü` to a bare `u`, where German
 * convention spells it `ue`.
 */
const SLUG_CASES: Record<string, [input: string, expected: string][]> = {
  en: [
    ["How to write a bedtime story", "how-to-write-a-bedtime-story"],
    ["Café & Co.", "cafe-co"],
    // A French or German word inside an English title hits the atomic-letter
    // bug just as hard, so the base map has to apply everywhere.
    ["Hors d'œuvre ideas", "hors-d-oeuvre-ideas"],
    ["Reading on the Straße", "reading-on-the-strasse"],
  ],
  de: [
    ["Straße", "strasse"],
    ["Gutenachtgeschichten für Kinder", "gutenachtgeschichten-fuer-kinder"],
    ["Größe & Schönheit", "groesse-schoenheit"],
  ],
  fr: [
    ["Cœur de lion", "coeur-de-lion"],
    ["À l'école, très tôt", "a-l-ecole-tres-tot"],
    // French keeps the bare vowel where German spells it out — the one case
    // that justifies the map being per-locale at all.
    ["Voyelle aigüe", "voyelle-aigue"],
  ],
};

for (const locale of LOCALES) {
  for (const [input, expected] of SLUG_CASES[locale.id] ?? []) {
    const actual = slugify(transliterate(locale, input));
    check(`${locale.id} slug "${input}" → "${expected}"`, actual === expected, `got "${actual}"`);
  }
  // Applying the pipeline to its own output must be a no-op, or a post that is
  // re-saved slowly rewrites its own URL and quietly 404s every inbound link.
  for (const [input] of SLUG_CASES[locale.id] ?? []) {
    const once = slugify(transliterate(locale, input));
    const twice = slugify(transliterate(locale, once));
    check(`${locale.id} slug for "${input}" is idempotent`, once === twice, `${once} → ${twice}`);
  }
}

// ---- Route paths -----------------------------------------------------------

for (const locale of LOCALES) {
  check(
    `${locale.id} root path is well-formed`,
    /^\/([a-z]{2})?$/.test(localePath(locale, "/")),
    localePath(locale, "/"),
  );
  check(
    `${locale.id} child path has no double slash`,
    !localePath(locale, "/blog").includes("//"),
    localePath(locale, "/blog"),
  );
}

// ---- Publish gate ----------------------------------------------------------

/**
 * The gate is the difference between a language existing and a customer being
 * served it, so its inputs have to be true rather than merely declared.
 *
 * The catalogue list is the sharp edge: it is hand-written because the Edge
 * middleware has no filesystem, which means nothing but this check stops it
 * drifting from the files actually on disk. Drift in one direction publishes a
 * locale whose messages are missing; in the other it hides a finished
 * translation.
 */
{
  const onDisk = existsSync(MESSAGES_DIR)
    ? readdirSync(MESSAGES_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort()
    : [];
  const declared = [...LOCALES_WITH_CATALOGUE].sort();
  check(
    "LOCALES_WITH_CATALOGUE matches the messages directory",
    declared.join(",") === onDisk.join(","),
    `declared [${declared.join(", ")}] vs on disk [${onDisk.join(", ")}]`,
  );

  const unknown = PUBLISHED_LOCALE_IDS.filter((id) => !LOCALES.some((l) => l.id === id));
  check("every published locale id exists in the registry", unknown.length === 0, unknown.join(", "));
  check(
    "published locale ids are unique",
    new Set(PUBLISHED_LOCALE_IDS).size === PUBLISHED_LOCALE_IDS.length,
    PUBLISHED_LOCALE_IDS.join(", "),
  );

  // Publishing is explicit, but it is not allowed to be wrong: a locale on the
  // list with an outstanding blocker would be silently dropped by `isPublished`,
  // leaving somebody convinced they had shipped a language that 404s.
  for (const id of PUBLISHED_LOCALE_IDS) {
    const locale = LOCALES.find((l) => l.id === id);
    if (!locale) continue;
    const blockers = publishBlockers(locale);
    check(`published locale ${id} has no publish blockers`, blockers.length === 0, blockers.join("; "));
    check(`published locale ${id} is actually served`, isPublished(id));
  }

  // Without this the site has no root: `as-needed` prefixing would have nothing
  // to serve at `/`, and every fallback chain would terminate at a 404.
  check(
    `${DEFAULT_LOCALE} is published`,
    isPublished(DEFAULT_LOCALE),
    publishBlockers(LOCALES.find((l) => l.id === DEFAULT_LOCALE)!).join("; "),
  );

  const routed = routedLocaleIds();
  check("at least one locale is routed", routed.length > 0);
  check(
    "every routed locale is published",
    routed.every((id) => isPublished(id)),
    routed.join(", "),
  );
  // An unpublished locale must have no URL at all. A redirect or an English page
  // under a German URL both tell a crawler the URL means something.
  const leaked = LOCALES.filter((l) => !isPublished(l.id) && routed.includes(l.id)).map((l) => l.id);
  check("no unpublished locale is routed", leaked.length === 0, leaked.join(", "));

  for (const locale of LOCALES) {
    if (isPublished(locale.id)) continue;
    note(
      `${locale.id} (${locale.englishName}) is not published: ${
        publishBlockers(locale).join("; ") || "held back deliberately — see PUBLISHED_LOCALE_IDS"
      }.`,
    );
  }
}

// ---- Router configuration --------------------------------------------------

/**
 * The routing config and the locale manifest encode the same decisions twice —
 * once for `next-intl`, once for everything else — so they have to agree.
 */
{
  check(
    "router locales match the routed set",
    [...routing.locales].sort().join(",") === [...routedLocaleIds()].sort().join(","),
    `${routing.locales.join(", ")} vs ${routedLocaleIds().join(", ")}`,
  );
  check("router default locale is DEFAULT_LOCALE", routing.defaultLocale === DEFAULT_LOCALE);
  // `as-needed` is what keeps English on the unprefixed URLs it already ranks
  // on. Switching to `always` would move every one of them to `/en/…`.
  check("router prefixes locales as-needed", routing.localePrefix === "as-needed");
  check(
    "as-needed prefixing agrees with the manifest's root locale",
    LOCALES.find((l) => l.id === routing.defaultLocale)?.pathPrefix === null,
  );

  /**
   * The matcher, tested against the paths whose behaviour actually matters.
   *
   * `true` means the middleware runs and the request gets a locale; `false`
   * means it passes through untouched.
   *
   * The pattern is read back out of `middleware.ts` rather than imported: Next
   * statically analyses that `config` export and rejects anything but a literal,
   * so the literal in the shipped file is the only copy there is — and the one
   * worth testing.
   */
  const MATCHER_CASES: [path: string, shouldRun: boolean][] = [
    ["/", true],
    ["/blog", true],
    ["/blog/how-to-write-a-bedtime-story", true],
    ["/print-pricing", true],
    // Not indexed and not locale-prefixed, but they still need a resolved
    // locale to render in.
    ["/studio", true],
    ["/admin", true],
    // Webhook and revalidation targets. A rewrite here moves the endpoint out
    // from under Stripe and Lulu.
    ["/api/revalidate", false],
    ["/api", false],
    // Metadata routes must stay at the root — a crawler asks for
    // `/sitemap.xml`, never `/en/sitemap.xml`.
    ["/sitemap.xml", false],
    ["/robots.txt", false],
    ["/favicon.ico", false],
    ["/_next/static/chunk.js", false],
    // A page whose name merely starts with "api" is still a page.
    ["/api-docs", true],
  ];

  const middlewareFile = join(SRC_DIR, "middleware.ts");
  check("middleware.ts exists", existsSync(middlewareFile), middlewareFile);
  const matcher = existsSync(middlewareFile)
    ? /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(readFileSync(middlewareFile, "utf8"))?.[1]
    : undefined;
  check("middleware declares a matcher", matcher !== undefined);

  if (matcher) {
    // The literal is TypeScript source, so `\\.` in the file is a single
    // backslash in the pattern the router compiles.
    const pattern = new RegExp(`^${matcher.replace(/\\\\/g, "\\")}$`);
    const wrong = MATCHER_CASES.filter(([path, shouldRun]) => pattern.test(path) !== shouldRun).map(
      ([path, shouldRun]) => `${path} should ${shouldRun ? "" : "not "}be matched`,
    );
    check("middleware matcher covers the right paths", wrong.length === 0, wrong.join("; "));
  }
}

// ---- Locale URLs and hreflang ----------------------------------------------

{
  const SITE = "https://example.com";
  const published = publishedLocales();

  for (const locale of published) {
    for (const path of ["/", "/blog", "/print-pricing/hardcover"]) {
      const url = localeUrl(SITE, locale, path);
      check(
        `${locale.id} URL for ${path} has no double slash`,
        !url.slice("https://".length).includes("//"),
        url,
      );
      check(`${locale.id} URL for ${path} is absolute`, url.startsWith(SITE), url);
    }
  }

  const root = LOCALES.find((l) => l.id === DEFAULT_LOCALE)!;
  // The homepage URL is the single most linked-to string the site owns; a
  // trailing-slash change here invalidates canonical equality everywhere.
  check("root locale homepage URL is unchanged", localeUrl(SITE, root, "/") === `${SITE}/`);

  const languages = hreflangLanguages(SITE, "/blog");
  if (published.length < 2) {
    // Declaring a one-page "cluster" tells a crawler nothing the canonical
    // hasn't, so the correct output is nothing at all.
    check(
      "no hreflang is emitted while one locale is published",
      languages === undefined,
      JSON.stringify(languages),
    );
  } else {
    check("hreflang declares x-default", Boolean(languages?.["x-default"]));
    // Reciprocity: every published locale must appear, or Google discards the
    // whole set.
    const absent = published.filter(
      (l) => !l.hreflang.every((tag) => languages?.[tag] === localeUrl(SITE, l, "/blog")),
    );
    check("hreflang lists every published locale", absent.length === 0, absent.map((l) => l.id).join(", "));
    const unpublished = LOCALES.filter((l) => !isPublished(l.id)).filter((l) =>
      l.hreflang.some((tag) => languages?.[tag]),
    );
    check(
      "hreflang never points at an unpublished locale",
      unpublished.length === 0,
      unpublished.map((l) => l.id).join(", "),
    );
  }
}

// ---- Message catalogues ----------------------------------------------------

/** Flatten a catalogue to dotted keys, so a namespace that became a string is a diff and not a crash. */
function flatten(tree: MessageTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else if (value && typeof value === "object") {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
  }
  return out;
}

/**
 * The ICU argument names a message takes.
 *
 * Collected only at the outermost brace depth, so a nested message —
 * `{count, plural, one {# book} other {# books}}` — reports `count` and not the
 * literal words inside its branches. Depth tracking rather than ICU parsing:
 * the goal is to compare two versions of the same message, which this does
 * exactly, without a parser to keep correct.
 */
function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i += 1) {
    const ch = message[i];
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch !== "{") continue;
    if (depth === 0) {
      const name = /^\{\s*([A-Za-z0-9_]+)\s*[,}]/.exec(message.slice(i))?.[1];
      if (name) found.add(name);
    }
    depth += 1;
  }
  return found;
}

function loadCatalogue(locale: string): MessageTree | null {
  const file = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as MessageTree;
}

{
  check("messages directory exists", existsSync(MESSAGES_DIR), MESSAGES_DIR);

  const source = loadCatalogue(DEFAULT_LOCALE);
  check(`${DEFAULT_LOCALE}.json exists`, source !== null, `${MESSAGES_DIR}/${DEFAULT_LOCALE}.json`);

  if (source) {
    const sourceKeys = flatten(source);
    check(`${DEFAULT_LOCALE}.json is not empty`, sourceKeys.size > 0);
    check(
      `${DEFAULT_LOCALE}.json has no blank messages`,
      [...sourceKeys].every(([, v]) => v.trim().length > 0),
      [...sourceKeys].filter(([, v]) => v.trim().length === 0).map(([k]) => k).join(", "),
    );

    // Pseudo-localization runs over every message on every dev request. If it
    // can mangle an ICU argument, the pseudo-locale throws at runtime on the
    // exact pages it exists to inspect.
    for (const [key, value] of sourceKeys) {
      const before = [...placeholders(value)].sort().join(",");
      const after = [...placeholders(pseudoLocalizeMessage(value))].sort().join(",");
      check(`pseudo-localizing ${key} preserves its placeholders`, before === after, `${before} → ${after}`);
    }

    // Every locale that has a catalogue must match English exactly. A locale
    // with no catalogue yet is fine — it isn't publishable, and the publish
    // gate is what turns "incomplete" into "not live".
    for (const locale of LOCALES) {
      if (locale.id === DEFAULT_LOCALE) continue;
      const target = loadCatalogue(locale.id);
      if (!target) {
        note(`${locale.id} has no message catalogue yet (messages/${locale.id}.json).`);
        continue;
      }
      const targetKeys = flatten(target);

      const missing = [...sourceKeys.keys()].filter((k) => !targetKeys.has(k));
      check(`${locale.id} has every key from ${DEFAULT_LOCALE}`, missing.length === 0, missing.join(", "));

      // Orphans are how a catalogue rots: a key renamed in English leaves a
      // translated string nothing reads, and nobody notices for a year.
      const orphans = [...targetKeys.keys()].filter((k) => !sourceKeys.has(k));
      check(`${locale.id} has no keys absent from ${DEFAULT_LOCALE}`, orphans.length === 0, orphans.join(", "));

      const blank = [...targetKeys].filter(([, v]) => v.trim().length === 0).map(([k]) => k);
      check(`${locale.id} has no blank messages`, blank.length === 0, blank.join(", "));

      const mismatched: string[] = [];
      for (const [key, sourceValue] of sourceKeys) {
        const targetValue = targetKeys.get(key);
        if (targetValue === undefined) continue;
        const a = [...placeholders(sourceValue)].sort().join(",");
        const b = [...placeholders(targetValue)].sort().join(",");
        if (a !== b) mismatched.push(`${key} (${a || "none"} vs ${b || "none"})`);
      }
      // A dropped placeholder renders a literal `{minutes}` to a customer; an
      // invented one throws inside intl-messageformat.
      check(`${locale.id} placeholders match ${DEFAULT_LOCALE}`, mismatched.length === 0, mismatched.join("; "));
    }

    /**
     * Every message has to survive the parser that will format it.
     *
     * Placeholder parity above compares two messages to each other, which says
     * nothing about whether either one is valid ICU: `{count, plural, one {#}}`
     * with no `other` branch, or a brace left unclosed, matches its English
     * counterpart's argument list perfectly and still throws at render time — in
     * one locale, on whichever page reads it. Parsing here is the same work
     * next-intl does at runtime, so anything this accepts will format.
     */
    for (const locale of LOCALES) {
      const catalogue = loadCatalogue(locale.id);
      if (!catalogue) continue;
      const broken: string[] = [];
      for (const [key, value] of flatten(catalogue)) {
        try {
          parseIcu(value, { requiresOtherClause: true });
        } catch (err) {
          broken.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      check(`${locale.id} messages are all valid ICU`, broken.length === 0, broken.join("; "));
    }

    // A catalogue for a locale that doesn't exist is either a typo or a locale
    // somebody translated and forgot to register.
    if (existsSync(MESSAGES_DIR)) {
      const stray = readdirSync(MESSAGES_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .filter((id) => !LOCALES.some((l) => l.id === id));
      check("no catalogue exists for an unregistered locale", stray.length === 0, stray.join(", "));
    }
  }
}

// ---- Message keys are actually reachable -----------------------------------

/**
 * The catalogue and the code have to agree in both directions.
 *
 * A `t("hero.badge")` with no matching message renders the key itself — the
 * landing page would say `marketing.hero.badge` to a customer. The reverse, a
 * message nobody reads, is how a catalogue rots: a key renamed in code leaves
 * its translations behind, and the next translator faithfully updates a string
 * that no longer reaches a page.
 *
 * Landing-page copy is checked exactly rather than by scanning, because every
 * editable string already has a registry: `SITE_TEXT_SLOTS`. The slot id *is*
 * the message key, so the two lists must match, and a new slot without copy is
 * caught the moment it's added.
 */
{
  const source = loadCatalogue(DEFAULT_LOCALE);
  const keys = source ? new Set(flatten(source).keys()) : new Set<string>();

  const missingSlots = SITE_TEXT_SLOTS.filter((slot) => !keys.has(`marketing.${slot}`));
  check(
    "every landing-page text slot has default copy",
    missingSlots.length === 0,
    missingSlots.join(", "),
  );

  const referenced = new Set<string>();
  // Keys assembled at runtime — `t(`images.${id}`)` — can't be resolved here, so
  // their prefix marks everything beneath it as reached. Narrower than ignoring
  // dynamic lookups entirely, and it can't be silently over-broad: the prefix
  // has to appear literally in the source.
  const dynamicPrefixes = new Set<string>();
  const unresolved: string[] = [];

  for (const file of existsSync(SRC_DIR) ? sourceFiles(SRC_DIR) : []) {
    const text = readFileSync(file, "utf8");
    const relative = file.slice(SRC_DIR.length + 1);

    // The namespace(s) this file translates against, so `t("x")` is checked as
    // `ns.x` — the same way next-intl resolves it.
    const namespaces = [...text.matchAll(/(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g)].map(
      (m) => m[1],
    );
    if (namespaces.length === 0) continue;

    for (const [, key] of text.matchAll(/\bt\(\s*"([^"]+)"/g)) {
      const candidates = namespaces.map((ns) => `${ns}.${key}`);
      const hit = candidates.find((c) => keys.has(c));
      if (hit) referenced.add(hit);
      else unresolved.push(`${relative} → ${candidates.join(" | ")}`);
    }

    // Nav links and footer columns hold their key in a table and translate it
    // as `t(l.label)`, so the call site has no literal to find — but the key
    // name is still written verbatim somewhere in the file. Any literal that
    // names a real message counts as reading it. Deliberately generous: the
    // point is to catch keys nothing mentions at all, not to prove each call.
    for (const [, literal] of text.matchAll(/"([A-Za-z][A-Za-z0-9_.]*)"/g)) {
      for (const ns of namespaces) {
        if (keys.has(`${ns}.${literal}`)) referenced.add(`${ns}.${literal}`);
      }
    }
    // Any template that builds a dotted key, wherever it's assembled — the key
    // is often composed into a variable first and only later handed to `t()`.
    // The prefix must be non-empty and end at a dot, so `` `${slot}.title` ``
    // (which would otherwise yield the bare namespace and vouch for every
    // message under it) is deliberately not a match.
    for (const [, prefix] of text.matchAll(/`([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.)\$\{/g)) {
      for (const ns of namespaces) dynamicPrefixes.add(`${ns}.${prefix}`);
    }
  }

  check("every t() key exists in the catalogue", unresolved.length === 0, unresolved.join("; "));

  // Slot-driven copy is reached through `t(slotId)`, which is a variable, not a
  // literal — the registry above is what proves those keys are live.
  for (const slot of SITE_TEXT_SLOTS) referenced.add(`marketing.${slot}`);

  // Order status works the same way: the descriptor tables ARE the registry, and
  // the derived-key invariant below already proves each one resolves. Without
  // this the scan reports fourteen live messages as unread, and a note that cries
  // wolf is a note nobody reads the day it's right.
  for (const s of Object.values(STAGE_STATUS)) referenced.add(`checkout.status.${s.key}`);
  for (const s of Object.values(FULFILLMENT_STATUS)) {
    referenced.add(`checkout.status.${s.key}.label`);
    referenced.add(`checkout.status.${s.key}.detail`);
  }

  const orphans = [...keys].filter(
    (k) => !referenced.has(k) && ![...dynamicPrefixes].some((p) => k.startsWith(p)),
  );
  if (orphans.length > 0) {
    note(`${orphans.length} message(s) nothing reads: ${orphans.join(", ")}`);
  }
}

// ---- Domain copy shown at checkout -----------------------------------------

/**
 * Binding, axis and option descriptions are the one body of customer copy that
 * still has an English original in code — the provider catalogue needs it to
 * seed admin product names — so the picker reads the catalogue and falls back to
 * that constant.
 *
 * The fallback is what makes this check necessary. Without it a missing key is
 * invisible: the picker renders confident English inside a German page and
 * nothing fails. So the expected keys are derived from the code constants and
 * asserted, in every locale with a catalogue — which also means adding a binding
 * or a paper stock fails here until it has been described.
 */
{
  const en = loadCatalogue(DEFAULT_LOCALE);
  const keys = en ? flatten(en) : new Map<string, string>();
  const absent = (expected: string[]) => expected.filter((key) => !keys.has(key));

  const bindings = [...new Set(LULU_BOOK_FORMATS.map((f) => f.product.binding))].sort();
  const bindingKeys = bindings.flatMap((binding) => [
    `checkout.binding.${binding}.noun`,
    `checkout.binding.${binding}.blurb`,
  ]);
  check(
    "every binding we sell is described in the catalogue",
    absent(bindingKeys).length === 0,
    absent(bindingKeys).join(", "),
  );

  const variantKeys = Object.entries(VARIANT_AXIS_DEFS).flatMap(([axis, def]) => [
    `checkout.variant.axis.${axis}.label`,
    `checkout.variant.axis.${axis}.hint`,
    ...def.options.flatMap((option) => [
      `checkout.variant.option.${axis}.${option.value}.label`,
      `checkout.variant.option.${axis}.${option.value}.hint`,
    ]),
  ]);
  check(
    "every variant axis and option is described in the catalogue",
    absent(variantKeys).length === 0,
    absent(variantKeys).join(", "),
  );

  const shippingKeys = SHIPPING_METHODS.map((m) => `checkout.shipping.method.${m}`);
  check(
    "every shipping method has a name in the catalogue",
    absent(shippingKeys).length === 0,
    absent(shippingKeys).join(", "),
  );

  // The status maps hold keys rather than words now, so a typo in one is a
  // rendered message id on an order screen — the worst place to find out.
  const statusKeys = [
    ...Object.values(STAGE_STATUS).map((s) => `checkout.status.${s.key}`),
    ...Object.values(FULFILLMENT_STATUS).flatMap((s) => [
      `checkout.status.${s.key}.label`,
      `checkout.status.${s.key}.detail`,
    ]),
  ];
  check(
    "every order status resolves to a message",
    absent(statusKeys).length === 0,
    absent(statusKeys).join(", "),
  );
}

// ---- Per-locale landing copy -----------------------------------------------

/**
 * The override store has two properties that are easy to break and expensive to
 * notice: the version-1 migration, and the deliberate absence of cross-locale
 * fallback.
 *
 * The migration matters because there is live copy in production stored in the
 * old flat shape. Losing it would blank the landing page; misreading it into the
 * wrong locale would show German visitors English overrides. The no-fallback
 * rule matters because inheriting an English override into German is invisible —
 * the page renders fine, in the wrong language, over a translation that exists.
 */
{
  const legacy = normalizeSiteContentConfig({
    version: 1,
    text: { "hero.title": "Legacy headline", "cta.button": "Legacy button" },
  });
  check(
    "version 1 copy migrates into the default locale",
    siteTextFor(legacy, DEFAULT_LOCALE)["hero.title"] === "Legacy headline",
    JSON.stringify(legacy.textByLocale),
  );
  check(
    "migrated copy does not leak into another locale",
    Object.keys(siteTextFor(legacy, "de")).length === 0,
    JSON.stringify(siteTextFor(legacy, "de")),
  );
  check("normalizing reports version 2", legacy.version === 2, String(legacy.version));

  // Re-reading a document must not change it, or every write would rewrite the
  // whole map and two admins editing at once would clobber each other.
  check(
    "normalizing is idempotent",
    JSON.stringify(normalizeSiteContentConfig(legacy)) === JSON.stringify(legacy),
  );

  // An explicit per-locale value must win over the legacy flat map, so a
  // document mid-migration doesn't revert to its old copy.
  const both = normalizeSiteContentConfig({
    version: 1,
    text: { "hero.title": "Old" },
    textByLocale: { en: { "hero.title": "New" } },
  });
  check(
    "an explicit override beats the legacy value",
    siteTextFor(both, "en")["hero.title"] === "New",
    siteTextFor(both, "en")["hero.title"],
  );

  const unknown = normalizeSiteContentConfig({
    version: 2,
    textByLocale: { en: { "hero.title": "Kept", "not.a.slot": "Dropped" }, zz: { "hero.title": "Dropped" } },
  });
  check("unknown locales are dropped", unknown.textByLocale.zz === undefined);
  check("unknown slots are dropped", siteTextFor(unknown, "en")["not.a.slot"] === undefined);
  check("known slots survive", siteTextFor(unknown, "en")["hero.title"] === "Kept");

  let edited = withSiteTextOverride(createDefaultSiteContentConfig(), "de", "hero.title", "Deutsch");
  check(
    "an override is written to the locale it was edited in",
    siteTextFor(edited, "de")["hero.title"] === "Deutsch" &&
      Object.keys(siteTextFor(edited, "en")).length === 0,
    JSON.stringify(edited.textByLocale),
  );
  edited = withSiteTextOverride(edited, "de", "hero.title", null);
  // An empty per-locale object left behind would make "has this language been
  // translated?" answer yes for a language with nothing in it.
  check(
    "clearing the last override removes the locale entirely",
    edited.textByLocale.de === undefined,
    JSON.stringify(edited.textByLocale),
  );
}

// ---- Implicit-locale formatting --------------------------------------------

/**
 * No customer-facing code may ask `Intl` to guess the locale.
 *
 * `new Intl.NumberFormat(undefined, …)` means "use whatever locale this process
 * is set to". In a browser that's the reader; on a server it's the container,
 * which is how a German visitor came to be shown `$1,234.50` instead of
 * `1.234,50 €`. It doesn't throw and it looks right on a developer's laptop,
 * where the process locale and the reader usually agree — so nothing catches it
 * except a rule that says don't.
 *
 * `ui/admin` is exempt on purpose: it's staff-only, English-only, and never
 * server-rendered for a customer, so threading a locale through it would be
 * ceremony with no reader on the other end.
 */
{
  const EXEMPT = [join("ui", "admin")];
  const files = existsSync(SRC_DIR)
    ? sourceFiles(SRC_DIR).filter((f) => !EXEMPT.some((e) => f.includes(e)))
    : [];
  check("frontend sources are readable", files.length > 0, SRC_DIR);

  const guessing: string[] = [];
  // Counted, not failed: the grouping separator in `1,234` is locale-sensitive
  // too, and these are the remaining sites. Lower stakes than a misplaced
  // currency symbol and a much wider sweep, so the number is reported to keep
  // the debt honest rather than asserted to zero before the work is done.
  let grouping = 0;

  for (const file of files) {
    const relative = file.slice(SRC_DIR.length + 1);
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (/new Intl\.[A-Za-z]+Format\(\s*(undefined|\))/.test(line)) {
        guessing.push(`${relative}:${i + 1}`);
      }
      // A locale argument makes it deliberate; a bare call is the implicit case.
      if (/\.toLocale(Date|Time)?String\(\s*\)/.test(line)) grouping += 1;
    });
  }

  check(
    "no customer-facing code lets Intl infer the locale",
    guessing.length === 0,
    guessing.join(", "),
  );
  if (grouping > 0) {
    note(
      `${grouping} customer-facing call(s) still use a bare .toLocaleString() — locale-correct grouping is a separate sweep.`,
    );
  }
}

// ---- Report ----------------------------------------------------------------

console.log(`${checks.length} checks passed across ${LOCALES.length} locales.`);
for (const n of notes) console.log(`  note: ${n}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log("\nAll locale invariants hold.");
}
