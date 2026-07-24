/**
 * Coarse, privacy-preserving country derivation for blog analytics.
 *
 * We deliberately DO NOT geolocate a stored IP. Country is inferred, in order,
 * from:
 *   1. an edge/CDN geo header (if the deployment sits behind one), then
 *   2. the region subtag of the browser locale (e.g. "de-DE" → DE), then
 *   3. a compact IANA-timezone → country map (e.g. "Europe/Berlin" → DE).
 * All three are already-exposed, non-precise signals — never fine-grained
 * geolocation — and the raw IP is used only transiently for the daily unique
 * hash (see blogStats.ts) and never written anywhere.
 *
 * Result is an ISO-3166 alpha-2 code, or "ZZ" when nothing is known.
 */
import type { IncomingHttpHeaders } from "node:http";

const GEO_HEADERS = [
  "cf-ipcountry", // Cloudflare
  "x-vercel-ip-country",
  "x-appengine-country", // Google App Engine / some GFE paths
  "x-country-code",
  "x-geo-country",
  "fastly-country-code",
];

function validCountry(code: string): string | null {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  // Common "unknown"/reserved sentinels emitted by edges.
  if (c === "XX" || c === "ZZ" || c === "T1" || c === "A1" || c === "A2") return null;
  return c;
}

function headerCountry(headers: IncomingHttpHeaders): string | null {
  for (const key of GEO_HEADERS) {
    const raw = headers[key];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (typeof val === "string") {
      const c = validCountry(val);
      if (c) return c;
    }
  }
  return null;
}

/** Region subtag from a BCP-47 locale: "pt-BR" → BR, "en" → null. */
export function regionFromLocale(locale: string): string | null {
  const m = /[-_]([A-Za-z]{2})(?![A-Za-z])/.exec(locale || "");
  return m ? validCountry(m[1]) : null;
}

/**
 * Compact IANA timezone → ISO country map covering the vast majority of real
 * traffic. Not exhaustive (unmapped zones fall through to "ZZ"), but a strong
 * fallback when the browser locale carries no region subtag.
 */
const TZ_COUNTRY: Record<string, string> = {
  // North America
  "America/New_York": "US", "America/Detroit": "US", "America/Chicago": "US",
  "America/Denver": "US", "America/Phoenix": "US", "America/Los_Angeles": "US",
  "America/Anchorage": "US", "Pacific/Honolulu": "US", "America/Indiana/Indianapolis": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "America/Winnipeg": "CA", "America/Halifax": "CA", "America/Mexico_City": "MX",
  "America/Tijuana": "MX", "America/Monterrey": "MX",
  // Central & South America
  "America/Guatemala": "GT", "America/Costa_Rica": "CR", "America/Panama": "PA",
  "America/Bogota": "CO", "America/Lima": "PE", "America/Caracas": "VE",
  "America/Santiago": "CL", "America/Argentina/Buenos_Aires": "AR",
  "America/Sao_Paulo": "BR", "America/Bahia": "BR", "America/Fortaleza": "BR",
  "America/Montevideo": "UY", "America/La_Paz": "BO", "America/Asuncion": "PY",
  "America/Guayaquil": "EC", "America/Santo_Domingo": "DO", "America/Havana": "CU",
  "America/Puerto_Rico": "PR", "America/Jamaica": "JM",
  // Europe
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Lisbon": "PT",
  "Europe/Madrid": "ES", "Europe/Paris": "FR", "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL", "Europe/Berlin": "DE", "Europe/Zurich": "CH",
  "Europe/Vienna": "AT", "Europe/Rome": "IT", "Europe/Copenhagen": "DK",
  "Europe/Oslo": "NO", "Europe/Stockholm": "SE", "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL", "Europe/Prague": "CZ", "Europe/Bratislava": "SK",
  "Europe/Budapest": "HU", "Europe/Bucharest": "RO", "Europe/Sofia": "BG",
  "Europe/Athens": "GR", "Europe/Zagreb": "HR", "Europe/Belgrade": "RS",
  "Europe/Ljubljana": "SI", "Europe/Tallinn": "EE", "Europe/Riga": "LV",
  "Europe/Vilnius": "LT", "Europe/Kyiv": "UA", "Europe/Kiev": "UA",
  "Europe/Moscow": "RU", "Europe/Istanbul": "TR", "Europe/Luxembourg": "LU",
  "Atlantic/Reykjavik": "IS",
  // Middle East & Africa
  "Asia/Jerusalem": "IL", "Asia/Tel_Aviv": "IL", "Asia/Beirut": "LB",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW", "Asia/Baghdad": "IQ", "Asia/Tehran": "IR",
  "Africa/Cairo": "EG", "Africa/Casablanca": "MA", "Africa/Tunis": "TN",
  "Africa/Algiers": "DZ", "Africa/Lagos": "NG", "Africa/Accra": "GH",
  "Africa/Nairobi": "KE", "Africa/Johannesburg": "ZA", "Africa/Addis_Ababa": "ET",
  // Asia
  "Asia/Karachi": "PK", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "Asia/Colombo": "LK", "Asia/Dhaka": "BD", "Asia/Kathmandu": "NP",
  "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Jakarta": "ID",
  "Asia/Kuala_Lumpur": "MY", "Asia/Singapore": "SG", "Asia/Manila": "PH",
  "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Shanghai": "CN",
  "Asia/Seoul": "KR", "Asia/Tokyo": "JP", "Asia/Almaty": "KZ",
  // Oceania
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Perth": "AU", "Australia/Adelaide": "AU",
  "Pacific/Auckland": "NZ", "Pacific/Fiji": "FJ", "Pacific/Guam": "GU",
};

function countryFromTz(tz: string): string | null {
  if (!tz) return null;
  const direct = TZ_COUNTRY[tz];
  return direct ? direct : null;
}

export function countryFromSignals(opts: {
  headers: IncomingHttpHeaders;
  locale?: string;
  tz?: string;
}): string {
  return (
    headerCountry(opts.headers) ??
    regionFromLocale(opts.locale ?? "") ??
    countryFromTz(opts.tz ?? "") ??
    "ZZ"
  );
}

/** Coarse device class from the User-Agent string. */
export function deviceFromUA(ua: string): "mobile" | "tablet" | "desktop" {
  const s = (ua || "").toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk|nexus 7|nexus 10/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|windows phone|blackberry|bb10|opera mini/.test(s)) return "mobile";
  if (/android/.test(s)) return /mobile/.test(s) ? "mobile" : "tablet";
  return "desktop";
}
