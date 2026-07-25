/**
 * Market (country) reference data shared by the backend aggregators and the
 * admin dashboard UI.
 *
 * A "market" is an ISO-3166 alpha-2 country code, plus the sentinel `ZZ` for
 * traffic whose country couldn't be derived. Two things live here:
 *
 *   - {@link COUNTRY_TZ} — a representative IANA timezone per country, so an
 *     event can be bucketed into the LOCAL hour of the person who caused it.
 *     For a global product a single dashboard timezone smears every daily
 *     rhythm into a meaningless average.
 *   - {@link MULTI_ZONE_COUNTRIES} — countries the representative zone can't
 *     honestly stand for (the US spans six). Charts label these so nobody
 *     over-reads a ±3h-smeared curve.
 *
 * Country → timezone (not the reverse) because that's the direction analytics
 * needs; `functions/src/geo.ts` keeps the timezone → country map used to infer
 * a country from a browser signal in the first place.
 */

/** The sentinel used when a country can't be determined. */
export const UNKNOWN_COUNTRY = "ZZ";

/**
 * Representative IANA timezone per country — the zone the largest share of
 * that country's population lives in. Countries absent from this map fall back
 * to the dashboard's configured timezone.
 */
export const COUNTRY_TZ: Record<string, string> = {
  // North America
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City",
  // Central & South America
  GT: "America/Guatemala", CR: "America/Costa_Rica", PA: "America/Panama",
  CO: "America/Bogota", PE: "America/Lima", VE: "America/Caracas",
  CL: "America/Santiago", AR: "America/Argentina/Buenos_Aires",
  BR: "America/Sao_Paulo", UY: "America/Montevideo", BO: "America/La_Paz",
  PY: "America/Asuncion", EC: "America/Guayaquil", DO: "America/Santo_Domingo",
  CU: "America/Havana", PR: "America/Puerto_Rico", JM: "America/Jamaica",
  // Europe
  GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon",
  ES: "Europe/Madrid", FR: "Europe/Paris", BE: "Europe/Brussels",
  NL: "Europe/Amsterdam", DE: "Europe/Berlin", CH: "Europe/Zurich",
  AT: "Europe/Vienna", IT: "Europe/Rome", DK: "Europe/Copenhagen",
  NO: "Europe/Oslo", SE: "Europe/Stockholm", FI: "Europe/Helsinki",
  PL: "Europe/Warsaw", CZ: "Europe/Prague", SK: "Europe/Bratislava",
  HU: "Europe/Budapest", RO: "Europe/Bucharest", BG: "Europe/Sofia",
  GR: "Europe/Athens", HR: "Europe/Zagreb", RS: "Europe/Belgrade",
  SI: "Europe/Ljubljana", EE: "Europe/Tallinn", LV: "Europe/Riga",
  LT: "Europe/Vilnius", UA: "Europe/Kyiv", RU: "Europe/Moscow",
  TR: "Europe/Istanbul", LU: "Europe/Luxembourg", IS: "Atlantic/Reykjavik",
  // Middle East & Africa
  IL: "Asia/Jerusalem", LB: "Asia/Beirut", AE: "Asia/Dubai", SA: "Asia/Riyadh",
  QA: "Asia/Qatar", KW: "Asia/Kuwait", IQ: "Asia/Baghdad", IR: "Asia/Tehran",
  EG: "Africa/Cairo", MA: "Africa/Casablanca", TN: "Africa/Tunis",
  DZ: "Africa/Algiers", NG: "Africa/Lagos", GH: "Africa/Accra",
  KE: "Africa/Nairobi", ZA: "Africa/Johannesburg", ET: "Africa/Addis_Ababa",
  // Asia
  PK: "Asia/Karachi", IN: "Asia/Kolkata", LK: "Asia/Colombo", BD: "Asia/Dhaka",
  NP: "Asia/Kathmandu", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh",
  ID: "Asia/Jakarta", MY: "Asia/Kuala_Lumpur", SG: "Asia/Singapore",
  PH: "Asia/Manila", HK: "Asia/Hong_Kong", TW: "Asia/Taipei",
  CN: "Asia/Shanghai", KR: "Asia/Seoul", JP: "Asia/Tokyo", KZ: "Asia/Almaty",
  // Oceania
  AU: "Australia/Sydney", NZ: "Pacific/Auckland", FJ: "Pacific/Fiji",
  GU: "Pacific/Guam",
};

/**
 * Countries whose population is spread across enough offsets that the
 * representative zone carries real error. Hour-of-day charts flag these so a
 * smeared curve isn't read as a precise one.
 */
export const MULTI_ZONE_COUNTRIES = new Set([
  "US", "CA", "RU", "BR", "AU", "MX", "ID", "KZ", "CL", "EC",
]);

/**
 * The timezone to bucket a country's events in. `fallback` (the dashboard's
 * configured zone) covers unmapped countries and unknown traffic.
 */
export function timezoneForCountry(country: string | null | undefined, fallback: string): string {
  if (!country) return fallback;
  return COUNTRY_TZ[country.toUpperCase()] ?? fallback;
}

let displayNames: Intl.DisplayNames | null | undefined;

/** Human country name for a code ("DE" → "Germany"); falls back to the code. */
export function countryLabel(code: string): string {
  const c = (code || "").toUpperCase();
  if (!c || c === UNKNOWN_COUNTRY) return "Unknown";
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(c) ?? c;
  } catch {
    return c;
  }
}

/** Regional-indicator flag emoji for a code, or a globe for unknown markets. */
export function countryFlag(code: string): string {
  const c = (code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === UNKNOWN_COUNTRY) return "🌍";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Normalize an arbitrary string to a market code, or null when unusable. */
export function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const c = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}
