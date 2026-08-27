/**
 * Static country reference data.
 *
 * Pure data, no logic and no opinions about what we sell — that lives in
 * `config/markets.ts`. Everything here is either the ISO-3166-1 register or a
 * fact transcribed from Lulu's OpenAPI spec
 * (https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml), so a change
 * upstream is a change to a list in this file rather than a hunt through the
 * fulfillment adapter.
 *
 * Country NAMES deliberately aren't here: `core/analytics/markets.ts` already
 * derives them from `Intl.DisplayNames`, which localizes and stays current.
 */

/**
 * Every ISO-3166-1 alpha-2 officially assigned code.
 *
 * Includes uninhabited territories (AQ, BV, HM, TF, GS, UM). They cost one
 * probe each during discovery and come back refused, which is a cheaper and
 * more honest answer than a hand-curated "shippable places" list that would
 * quietly drift from what the printer actually does.
 */
export const ISO_COUNTRIES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS",
  "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
];

/** Fast membership test for {@link ISO_COUNTRIES}. */
const ISO_SET: ReadonlySet<string> = new Set(ISO_COUNTRIES);

/** Whether a string is an ISO-3166-1 alpha-2 code we recognise. */
export function isIsoCountry(code: string | null | undefined): boolean {
  return ISO_SET.has((code ?? "").trim().toUpperCase());
}

/**
 * Countries where Lulu requires an ISO-3166-2 subdivision code on the shipping
 * address. Omitting it is a hard 400 at print-job creation, so checkout has to
 * treat the region field as required here rather than optional.
 *
 * Transcribed from the `/shipping-options/` endpoint documentation.
 */
export const STATE_CODE_REQUIRED: ReadonlySet<string> = new Set([
  "AE", "AS", "AU", "BR", "CA", "CN", "CO", "CR", "ES", "FM", "HK", "HN", "ID", "IN", "IQ", "IT",
  "JM", "JP", "KN", "KR", "KY", "MH", "MP", "MX", "NR", "PF", "PG", "PW", "RU", "SO", "SV", "TW",
  "UM", "US", "VE", "VI",
]);

/**
 * A representative subdivision per {@link STATE_CODE_REQUIRED} country.
 *
 * Two uses, neither of which is a real order: probing coverage, and showing
 * checkout a worked example of the format for the countries that have no
 * verified list in `config/subdivisions.ts`.
 *
 * Best-effort: a few of these territories have no ISO subdivisions at all and
 * repeat the country code. A wrong value shows up as a refusal carrying Lulu's
 * own message, which is a visible, fixable result rather than a silent one.
 */
export const PROBE_STATE: Readonly<Record<string, string>> = {
  AE: "DU",
  AS: "AS",
  AU: "NSW",
  BR: "SP",
  CA: "ON",
  CN: "BJ",
  CO: "DC",
  CR: "SJ",
  ES: "M",
  FM: "PNI",
  HK: "HK",
  HN: "FM",
  ID: "JK",
  IN: "DL",
  IQ: "BG",
  IT: "RM",
  JM: "01",
  JP: "13",
  KN: "03",
  KR: "11",
  KY: "KY",
  MH: "MAJ",
  MP: "MP",
  MX: "CMX",
  NR: "14",
  PF: "PF",
  PG: "NCD",
  PW: "004",
  RU: "MOW",
  SO: "BN",
  SV: "SS",
  TW: "TPE",
  UM: "UM",
  US: "NY",
  VE: "A",
  VI: "VI",
};

/**
 * A deliverable street address per country, used ONLY to measure shipping rates
 * during calibration — never for a real order.
 *
 * Needed because the provider's cost endpoint validates a full address, unlike
 * the coverage sweep, which is happy with a country code. A market missing from
 * this table is therefore openable and quotable but not *measurable*: it has no
 * fallback row, so a passthrough product priced from the table alone refuses the
 * order rather than inventing a rate (see `hasUsableShippingCost`). That is the
 * safe direction, but it means opening a market and adding an entry here are the
 * same task — the admin Markets tab flags the ones missing an address.
 *
 * These are central, unambiguous, real thoroughfares chosen for postal-format
 * validity rather than accuracy of the house number. A wrong one shows up as a
 * calibration failure carrying the provider's own message, which is visible and
 * fixable, not silent.
 */
export const PROBE_ADDRESS: Readonly<
  Record<string, { city: string; postalCode: string; line1: string; state?: string }>
> = {
  AT: { city: "Wien", postalCode: "1010", line1: "Kaerntner Ring 1" },
  AU: { state: "NSW", city: "Sydney", postalCode: "2000", line1: "1 George St" },
  BE: { city: "Bruxelles", postalCode: "1000", line1: "Rue Royale 1" },
  BR: { state: "SP", city: "Sao Paulo", postalCode: "01310-100", line1: "Avenida Paulista 1000" },
  CA: { state: "ON", city: "Toronto", postalCode: "M5H 2N2", line1: "1 King St" },
  CH: { city: "Zuerich", postalCode: "8001", line1: "Bahnhofstrasse 1" },
  CZ: { city: "Praha", postalCode: "11000", line1: "Vaclavske namesti 1" },
  DE: { city: "Berlin", postalCode: "10115", line1: "Hauptstr 1" },
  DK: { city: "Koebenhavn", postalCode: "1050", line1: "Kongens Nytorv 1" },
  ES: { state: "M", city: "Madrid", postalCode: "28013", line1: "Gran Via 1" },
  FI: { city: "Helsinki", postalCode: "00100", line1: "Mannerheimintie 1" },
  FR: { city: "Paris", postalCode: "75001", line1: "1 Rue de Rivoli" },
  GB: { city: "London", postalCode: "SW1A 1AA", line1: "1 High St" },
  IE: { city: "Dublin", postalCode: "D01 F5P2", line1: "1 O'Connell St" },
  IT: { state: "RM", city: "Roma", postalCode: "00187", line1: "Via del Corso 1" },
  JP: { state: "13", city: "Tokyo", postalCode: "100-0001", line1: "1-1 Chiyoda" },
  MX: { state: "CMX", city: "Ciudad de Mexico", postalCode: "06600", line1: "Paseo de la Reforma 1" },
  NL: { city: "Amsterdam", postalCode: "1012 JS", line1: "Damrak 1" },
  NO: { city: "Oslo", postalCode: "0150", line1: "Karl Johans gate 1" },
  NZ: { city: "Auckland", postalCode: "1010", line1: "1 Queen St" },
  PL: { city: "Warszawa", postalCode: "00-001", line1: "Marszalkowska 1" },
  PT: { city: "Lisboa", postalCode: "1100-148", line1: "Rua Augusta 1" },
  SE: { city: "Stockholm", postalCode: "11120", line1: "Drottninggatan 1" },
  US: { state: "NY", city: "New York", postalCode: "10001", line1: "1 Main St" },
};

/** Whether calibration can measure a fallback shipping rate for this country. */
export function isMeasurable(country: string): boolean {
  return Object.hasOwn(PROBE_ADDRESS, (country ?? "").trim().toUpperCase());
}

/**
 * Countries where Lulu requires the RECIPIENT's tax identification number
 * (`shipping_address.recipient_tax_id`) — customs data supplied by the
 * customer, not a registration of ours.
 *
 * Lulu validates the format for exactly these three.
 */
export const TAX_ID_REQUIRED: ReadonlySet<string> = new Set(["BR", "CL", "MX"]);

/** What to call the recipient tax ID in each country that mandates one. */
export const TAX_ID_LABEL: Readonly<Record<string, string>> = {
  BR: "CPF / CNPJ",
  CL: "RUT",
  MX: "RFC",
};

/**
 * Countries where `recipient_tax_id` is accepted but never validated. Pass it
 * through when we have it; nothing breaks when we don't, so checkout doesn't
 * ask.
 */
export const TAX_ID_ACCEPTED: ReadonlySet<string> = new Set([
  "AF", "BA", "BF", "BH", "BI", "BJ", "BS", "BT", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ",
  "DM", "DZ", "ER", "ET", "FJ", "FM", "GA", "GD", "GM", "GN", "GQ", "GW", "HN", "HT", "IQ", "IR",
  "JO", "KH", "KI", "KM", "KN", "KP", "LA", "LB", "LC", "LR", "LS", "LY", "MG", "MH", "ML", "MM",
  "MN", "MV", "MW", "MZ", "NA", "NE", "NP", "NR", "OM", "PG", "PW", "QA", "RW", "SB", "SD", "SL",
  "SN", "SO", "SR", "SS", "SY", "SZ", "TG", "TL", "TO", "TZ", "UG", "VA", "ZM", "ZW",
]);

/**
 * The currency in circulation in each country, for the ones we might charge in.
 *
 * A country fact, not a pricing decision: which of these we ACCEPT is
 * `PricingSettings.currencies`, and {@link currencyForMarket} intersects the two.
 * Absent countries fall back to the base currency, which is why this table only
 * needs to name the ones whose local currency we plausibly support — adding EUR
 * to the catalog should not require also editing 20 country rows.
 */
const MARKET_CURRENCY: Readonly<Record<string, string>> = {
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR", FR: "EUR",
  GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR", LT: "EUR", LU: "EUR", LV: "EUR", MC: "EUR",
  MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR", SM: "EUR", VA: "EUR",
  GB: "GBP", GG: "GBP", IM: "GBP", JE: "GBP",
  AU: "AUD", CA: "CAD", CH: "CHF", CZ: "CZK", DK: "DKK", JP: "JPY", MX: "MXN", NO: "NOK",
  NZ: "NZD", PL: "PLN", SE: "SEK", BR: "BRL", US: "USD",
};

/**
 * What to charge a customer in this country.
 *
 * Local currency when we support it, the base currency otherwise — never a
 * currency the catalog has no prices or FX rate for, which would fail at
 * checkout rather than merely reading oddly. The whole point is that opening a
 * market doesn't silently start billing everyone in dollars: before this,
 * checkout hardcoded USD, so a German customer paid a dollar amount for a book
 * whose price was configured in euros.
 */
export function currencyForMarket(
  country: string | null | undefined,
  supported: readonly string[],
  base: string,
): string {
  const local = MARKET_CURRENCY[(country ?? "").trim().toUpperCase()];
  if (local && supported.some((c) => c.toUpperCase() === local)) return local;
  return base;
}

/**
 * Countries we refuse regardless of what the printer quotes.
 *
 * Not a legal nicety deferred to later: the payment processor declines these
 * and serving them breaches its terms, so the block belongs in the same layer
 * as "can we physically fulfil this". Re-check against Stripe's current
 * restricted list before opening each new wave of markets.
 */
export const SANCTIONS_DENYLIST: ReadonlySet<string> = new Set([
  "BY", // Belarus
  "CU", // Cuba
  "IR", // Iran
  "KP", // North Korea
  "RU", // Russia
  "SY", // Syria
]);

/** Countries worth probing: everything we're allowed to serve at all. */
export function probeableCountries(): string[] {
  return ISO_COUNTRIES.filter((c) => !SANCTIONS_DENYLIST.has(c));
}
