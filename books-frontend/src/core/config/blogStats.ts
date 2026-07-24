/**
 * Blog article analytics — shared shapes.
 *
 * Privacy-first + cookieless by design (no consent needed): the tracking beacon
 * stores NO cookies / localStorage, the backend NEVER persists an IP, and the
 * only per-visitor value that touches the database is a **daily-rotating,
 * irreversible hash** (`sha256(date | pepper | ip | ua)`) used solely to dedupe
 * a day's unique visitors. Hashes rotate every UTC midnight and live in a
 * short-lived `blogStats/{slug}/days/{date}` doc, so nothing links a person
 * across days. Country is derived from coarse, already-exposed client signals
 * (browser locale / timezone) or an edge geo header — never from a stored IP.
 *
 * Everything else is a plain aggregate counter per post: views, unique
 * visitors, CTA clicks, and low-cardinality breakdowns (country, device,
 * channel, referrer host, scroll-depth funnel). All aggregates — never raw
 * events — which keeps the data non-identifying (k-anonymity friendly) and
 * cheap to render in the admin dashboard.
 */

/** Ordered scroll-depth buckets (percent of the article reached). */
export const READ_BUCKETS = ["25", "50", "75", "100"] as const;
export type ReadBucket = (typeof READ_BUCKETS)[number];

/** One day of the rolling time-series: views / uniques / cta clicks. */
export interface BlogDailyPoint {
  v: number;
  u: number;
  c: number;
}

/** Per-post aggregate document (`blogStats/{slug}`). Backend-written only. */
export interface BlogStats {
  version: 1;
  slug: string;
  /** Total pageviews (all visits). */
  views: number;
  /** Sum of per-day unique visitors (daily-unique, not cross-day tracking). */
  uniques: number;
  /** Total clicks on a call-to-action (any link into the studio). */
  ctaClicks: number;
  /** Views by ISO-3166 country code ("ZZ" = unknown). */
  byCountry: Record<string, number>;
  /** CTA clicks by country — where your converting readers are. */
  ctaByCountry: Record<string, number>;
  /** Views by device class: mobile / tablet / desktop. */
  byDevice: Record<string, number>;
  /** Views by acquisition channel: direct / organic / social / referral / … */
  byChannel: Record<string, number>;
  /** Views by referring host (only for referral/social traffic). */
  byReferrerHost: Record<string, number>;
  /** Scroll-depth funnel: how many sessions reached 25/50/75/100 %. */
  readBuckets: Record<string, number>;
  /** Rolling daily series keyed by UTC "YYYY-MM-DD". */
  daily: Record<string, BlogDailyPoint>;
  updatedAt: number;
}

/** Lightweight per-post row for the admin list. */
export interface BlogStatsListItem {
  slug: string;
  views: number;
  uniques: number;
  ctaClicks: number;
}

// ---- Helpers ---------------------------------------------------------------

function numMap(v: unknown, maxKeys = 1000): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= maxKeys) break;
    const num = typeof val === "number" && Number.isFinite(val) ? val : 0;
    if (num > 0 && k) {
      out[String(k).slice(0, 120)] = num;
      n += 1;
    }
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function normalizeDaily(v: unknown): Record<string, BlogDailyPoint> {
  const out: Record<string, BlogDailyPoint> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const p = (val ?? {}) as Partial<BlogDailyPoint>;
    out[k] = { v: num(p.v), u: num(p.u), c: num(p.c) };
  }
  return out;
}

export function createDefaultBlogStats(slug = ""): BlogStats {
  return {
    version: 1,
    slug,
    views: 0,
    uniques: 0,
    ctaClicks: 0,
    byCountry: {},
    ctaByCountry: {},
    byDevice: {},
    byChannel: {},
    byReferrerHost: {},
    readBuckets: {},
    daily: {},
    updatedAt: 0,
  };
}

export function normalizeBlogStats(input: unknown, slug?: string): BlogStats {
  const s = (input ?? {}) as Partial<BlogStats>;
  return {
    version: 1,
    slug: (slug ?? (typeof s.slug === "string" ? s.slug : "")).slice(0, 120),
    views: num(s.views),
    uniques: num(s.uniques),
    ctaClicks: num(s.ctaClicks),
    byCountry: numMap(s.byCountry),
    ctaByCountry: numMap(s.ctaByCountry),
    byDevice: numMap(s.byDevice),
    byChannel: numMap(s.byChannel),
    byReferrerHost: numMap(s.byReferrerHost),
    readBuckets: numMap(s.readBuckets),
    daily: normalizeDaily(s.daily),
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
  };
}

/** Sorted [key, count] pairs, highest first, capped to `limit`. */
export function topEntries(map: Record<string, number>, limit = 8): [string, number][] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/** The daily series as an ascending, date-sorted array (for charts). */
export function dailySeries(stats: BlogStats): { date: string; v: number; u: number; c: number }[] {
  return Object.entries(stats.daily)
    .map(([date, p]) => ({ date, ...p }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
