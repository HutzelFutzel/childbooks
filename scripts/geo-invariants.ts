/**
 * Country-inference invariants — the properties that must hold for the market
 * we stamp on a signup, a session, and the admin users table.
 *
 * These are the failures that don't throw: an English-UI visitor in Berlin
 * stamped US because Chrome's default locale is `en-US`; an Accept-Language
 * list `de,en-US;q=0.9` matching a later `-US`; a locale guess overwriting a
 * timezone reading. None of them show up in a typecheck.
 *
 * Run by `yarn check:geo`, which bundles this against the shipped
 * `functions/src/geo.ts` rather than restating the rules.
 */
import {
  countryFromSignals,
  primaryLocaleTag,
  regionFromLocale,
  shouldWriteCountry,
  type GeoGuess,
} from "../functions/src/geo";
import { UNKNOWN_COUNTRY } from "../books-frontend/src/core/analytics/markets";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function guess(
  opts: { locale?: string; tz?: string; headers?: Record<string, string> },
): GeoGuess {
  return countryFromSignals({
    headers: opts.headers ?? {},
    locale: opts.locale,
    tz: opts.tz,
  });
}

// ---- The bug that shipped: English UI in Germany is not the United States ----

check(
  "en-US + Europe/Berlin → DE (timezone beats English locale)",
  guess({ locale: "en-US", tz: "Europe/Berlin" }).country === "DE" &&
    guess({ locale: "en-US", tz: "Europe/Berlin" }).source === "tz",
);

check(
  "en-US + America/New_York → US",
  guess({ locale: "en-US", tz: "America/New_York" }).country === "US" &&
    guess({ locale: "en-US", tz: "America/New_York" }).source === "tz",
);

check(
  "en-US with no timezone is unknown, not US",
  guess({ locale: "en-US" }).country === UNKNOWN_COUNTRY &&
    guess({ locale: "en-US" }).source === "unknown",
);

check(
  "de-DE + Europe/Berlin → DE",
  guess({ locale: "de-DE", tz: "Europe/Berlin" }).country === "DE",
);

check(
  "de-DE with no timezone still yields DE from the locale region",
  guess({ locale: "de-DE" }).country === "DE" && guess({ locale: "de-DE" }).source === "locale",
);

check(
  "pt-BR with no timezone yields BR (non-English region is a real signal)",
  guess({ locale: "pt-BR" }).country === "BR" && guess({ locale: "pt-BR" }).source === "locale",
);

// ---- Accept-Language lists must not search past the first tag ----

check(
  "de,en-US;q=0.9 + Berlin → DE (later en-US must not win)",
  guess({ locale: "de,en-US;q=0.9", tz: "Europe/Berlin" }).country === "DE",
);

check(
  "de,en-US;q=0.9 with no tz is unknown (primary tag has no region, English ignored)",
  guess({ locale: "de,en-US;q=0.9" }).country === UNKNOWN_COUNTRY,
);

check(
  "de-DE,de;q=0.9,en-US;q=0.8 → DE from the first tag",
  guess({ locale: "de-DE,de;q=0.9,en-US;q=0.8" }).country === "DE" &&
    guess({ locale: "de-DE,de;q=0.9,en-US;q=0.8" }).source === "locale",
);

check(
  "en-US,en;q=0.9,de;q=0.8 with no tz is unknown",
  guess({ locale: "en-US,en;q=0.9,de;q=0.8" }).country === UNKNOWN_COUNTRY,
);

check(
  "primaryLocaleTag strips weights and later tags",
  primaryLocaleTag("de-DE,de;q=0.9,en-US;q=0.8") === "de-DE" &&
    primaryLocaleTag("de,en-US;q=0.9") === "de" &&
    primaryLocaleTag("en-US") === "en-US",
);

// ---- English region tags are language, not location ----

check("regionFromLocale(en-US) is null", regionFromLocale("en-US") === null);
check("regionFromLocale(en-GB) is null", regionFromLocale("en-GB") === null);
check("regionFromLocale(en) is null", regionFromLocale("en") === null);
check("regionFromLocale(de-DE) is DE", regionFromLocale("de-DE") === "DE");
check("regionFromLocale(de) is null (no region)", regionFromLocale("de") === null);
check("regionFromLocale(fr-CA) is CA", regionFromLocale("fr-CA") === "CA");
check("regionFromLocale(zh-Hant-TW) is TW", regionFromLocale("zh-Hant-TW") === "TW");

// ---- CDN headers still win, App Engine headers must not ----

check(
  "Cloudflare header beats a conflicting timezone",
  guess({
    locale: "en-US",
    tz: "Europe/Berlin",
    headers: { "cf-ipcountry": "FR" },
  }).country === "FR" &&
    guess({
      locale: "en-US",
      tz: "Europe/Berlin",
      headers: { "cf-ipcountry": "FR" },
    }).source === "header",
);

check(
  "x-appengine-country is ignored (Cloud Functions region, not the visitor)",
  guess({
    tz: "Europe/Berlin",
    headers: { "x-appengine-country": "US" },
  }).country === "DE" &&
    guess({
      tz: "Europe/Berlin",
      headers: { "x-appengine-country": "US" },
    }).source === "tz",
);

check(
  "unknown CDN sentinels (XX, ZZ, T1) are skipped",
  guess({ headers: { "cf-ipcountry": "XX" }, tz: "Europe/Berlin" }).country === "DE",
);

// ---- Overwrite policy: locale never clobbers; tz/header correct a bad stamp ----

check(
  "locale does not overwrite an existing country",
  shouldWriteCountry({ country: "DE", source: "locale" }, "US") === false,
);

check(
  "locale fills a blank",
  shouldWriteCountry({ country: "DE", source: "locale" }, undefined) === true &&
    shouldWriteCountry({ country: "DE", source: "locale" }, "ZZ") === true,
);

check(
  "timezone overwrites a leftover US locale stamp",
  shouldWriteCountry({ country: "DE", source: "tz" }, "US") === true,
);

check(
  "timezone does not rewrite the same country (keeps the session-ping floor cheap)",
  shouldWriteCountry({ country: "DE", source: "tz" }, "DE") === false,
);

check(
  "unknown / ZZ never writes",
  shouldWriteCountry({ country: UNKNOWN_COUNTRY, source: "unknown" }, undefined) === false &&
    shouldWriteCountry({ country: "US", source: "unknown" }, undefined) === false,
);

check(
  "header overwrites a disagreeing stored country",
  shouldWriteCountry({ country: "FR", source: "header" }, "DE") === true,
);

// ---- Report -----------------------------------------------------------------

console.log(`${checks.length} invariant(s) held.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} invariant(s) FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log("All geo invariants hold.");
}
