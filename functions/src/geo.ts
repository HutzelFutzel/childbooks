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
import type { Express, Request, Response } from "express";
import {
  parseDeviceFacts,
  type DeviceFacts,
} from "../../books-frontend/src/core/analytics/device";

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

/**
 * Guess where the visitor is, so checkout and the format picker can open on a
 * country instead of on a hardcoded "US".
 *
 * Deliberately the same coarse derivation the analytics use, and for the same
 * privacy reason: edge header, then locale region, then timezone. No IP is
 * geolocated and none is stored. That makes it a HINT and nothing more, which
 * is exactly the right strength for this job — the answer only preselects a
 * dropdown the customer can change, and it is never the thing that decides
 * what they're allowed to buy. That decision belongs to the destination they
 * actually enter, checked server-side at quote time.
 *
 * Tokenless: this runs on the marketing pages and in the wizard, long before
 * anyone signs in.
 *
 * NOTE ON DEPLOYMENT: none of the edge headers above are set by Firebase App
 * Hosting on its own, so in practice the locale and timezone fallbacks do the
 * work until a CDN that sets one is put in front. Both come from the browser,
 * so treat the result as the visitor's own claim about where they are.
 */
export function registerGeoRoutes(app: Express): void {
  app.get("/geo/country", (req: Request, res: Response) => {
    const one = (key: string): string | undefined => {
      const raw = req.query[key];
      return typeof raw === "string" ? raw.slice(0, 100) : undefined;
    };
    const country = countryFromSignals({
      headers: req.headers,
      locale: one("locale") ?? req.headers["accept-language"]?.toString(),
      tz: one("tz"),
    });
    // Varies per visitor, so it must never land in a shared cache. Short-lived
    // because a wrong guess should stop being repeated quickly.
    res.set("Cache-Control", "private, max-age=300");
    res.json({ country: country === "ZZ" ? null : country });
  });
}

/**
 * Coarse device class from the User-Agent string, for the blog aggregates.
 *
 * Kept separate from {@link deviceFactsFromHeaders} because it answers a
 * narrower question with a narrower contract: the blog beacon already rejects
 * bots and empty user-agents, so it has no "unknown" bucket and never needed
 * one. Widening this to three-plus-unknown would silently reclassify historical
 * `blogStats.byDevice` counts.
 */
export function deviceFromUA(ua: string): "mobile" | "tablet" | "desktop" {
  const s = (ua || "").toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk|nexus 7|nexus 10/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|windows phone|blackberry|bb10|opera mini/.test(s)) return "mobile";
  if (/android/.test(s)) return /mobile/.test(s) ? "mobile" : "tablet";
  return "desktop";
}

/**
 * Full device facts for a request, read from the headers the browser sent.
 *
 * Server-side by design: the same parse run against a client-supplied string
 * would be a field the measured party controls. Client hints are preferred over
 * the User-Agent where available (Chromium has frozen the UA string) — see
 * `core/analytics/device.ts` for the parse order and the privacy constraints
 * that bound what's collected here.
 */
export function deviceFactsFromHeaders(headers: IncomingHttpHeaders): DeviceFacts {
  const one = (key: string): string | null => {
    const raw = headers[key];
    const val = Array.isArray(raw) ? raw[0] : raw;
    return typeof val === "string" ? val : null;
  };
  return parseDeviceFacts({
    ua: one("user-agent"),
    hints: {
      platform: one("sec-ch-ua-platform"),
      mobile: one("sec-ch-ua-mobile"),
      brands: one("sec-ch-ua"),
    },
  });
}
