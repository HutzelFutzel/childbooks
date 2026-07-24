/**
 * Blog analytics backend — cookieless, first-party, GDPR-friendly.
 *
 * Data model:
 *   - `blogStats/{slug}`            — the per-post aggregate (counters + coarse,
 *                                     low-cardinality breakdown maps + a rolling
 *                                     daily series). Written only here (Admin SDK).
 *   - `blogStats/{slug}/days/{date}` — a short-lived, per-UTC-day dedupe doc
 *                                     holding that day's set of daily-rotating
 *                                     visitor hashes. Used ONLY to count unique
 *                                     visitors; hashes are irreversible and rotate
 *                                     every midnight, so nothing links a person
 *                                     across days. Never read by clients.
 *
 * Privacy posture (why no consent banner is required):
 *   - No cookies / localStorage — nothing is stored on the visitor's device.
 *   - The raw IP is NEVER persisted; it feeds a one-way daily hash and the
 *     rate-limiter, then is discarded.
 *   - Country comes from coarse client signals (locale/timezone) or an edge
 *     header, not from a stored IP (see geo.ts).
 *   - Only aggregates are kept — no per-visitor event rows — so the data stays
 *     non-identifying.
 *
 * The ingest route (`POST /blog-track`) is tokenless (the marketing site has no
 * Firebase session) and MUST be registered before the auth guards in app.ts.
 * The read routes are admin-only and registered under the guarded `/admin`.
 */
import express, { type Express, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { countryFromSignals, deviceFromUA } from "./geo";
import { slugify } from "../../books-frontend/src/core/config/blog";
import {
  normalizeBlogStats,
  READ_BUCKETS,
  type BlogStats,
  type BlogStatsListItem,
} from "../../books-frontend/src/core/config/blogStats";

const STATS_COLLECTION = "blogStats";
/**
 * Cap a single day's dedupe set so it stays well under the 1 MB document limit
 * (~24-byte hash key + overhead per entry). Beyond this, that day's uniques stop
 * incrementing precisely, but views + all other counters keep working. The
 * `seen` map is index-exempt (firestore.indexes.json) so its dynamic hash keys
 * don't spawn unbounded single-field indexes.
 */
const MAX_SEEN_PER_DAY = 20_000;
/** Keep the rolling daily series bounded. */
const MAX_DAILY_DAYS = 180;
/** Cap each breakdown map's cardinality (keep the busiest keys). */
const MAX_MAP_KEYS = 300;

type EventType = "view" | "read" | "cta";

// ---- Classification helpers ------------------------------------------------

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|whatsapp|telegrambot|discordbot|preview|monitor|curl\/|wget|python-requests|headless|lighthouse|pingdom|uptimerobot|node-fetch|axios|go-http|okhttp|apache-httpclient|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|gptbot|ccbot|claudebot|google-inspectiontool/i;

function isBot(ua: string): boolean {
  return !ua || ua.length < 8 || BOT_RE.test(ua);
}

/** UTC day key, "YYYY-MM-DD". Uniqueness rotates on this boundary. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Daily-rotating, irreversible visitor hash. The date makes it rotate every
 * UTC midnight; the pepper (optional env secret) hardens it against rainbow
 * attacks. The raw IP/UA are consumed here and never stored.
 */
function dailyHash(ip: string, ua: string, date: string): string {
  const pepper = process.env.ANALYTICS_SALT || "cb-blog-analytics-v1";
  return createHash("sha256").update(`${date}|${pepper}|${ip}|${ua}`).digest("hex").slice(0, 24);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase().slice(0, 120);
  } catch {
    return "";
  }
}

const SEARCH_RE = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex|brave|startpage|qwant|naver|ask)\./;
const SOCIAL_RE =
  /(^|\.)(facebook|fb|instagram|t\.co|twitter|x\.com|pinterest|reddit|linkedin|youtube|tiktok|whatsapp|telegram|threads|snapchat|tumblr|mastodon|bsky)\./;

function channelFor(host: string, utmMedium: string): string {
  const m = utmMedium.toLowerCase();
  if (m) {
    if (/cpc|ppc|paid|ads?/.test(m)) return "paid";
    if (/social/.test(m)) return "social";
    if (/email|newsletter/.test(m)) return "email";
    if (/organic/.test(m)) return "organic";
    if (/referr?al/.test(m)) return "referral";
  }
  if (!host) return "direct";
  if (SEARCH_RE.test(`.${host}`)) return "organic";
  if (SOCIAL_RE.test(`.${host}`)) return "social";
  return "referral";
}

// ---- Aggregation -----------------------------------------------------------

function bump(map: Record<string, number>, key: string, n = 1): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + n;
}

/** Bound doc growth: trim the daily series + every breakdown map. */
function prune(stats: BlogStats): void {
  const days = Object.keys(stats.daily).sort();
  if (days.length > MAX_DAILY_DAYS) {
    for (const d of days.slice(0, days.length - MAX_DAILY_DAYS)) delete stats.daily[d];
  }
  const maps: (keyof BlogStats)[] = [
    "byCountry",
    "ctaByCountry",
    "byDevice",
    "byChannel",
    "byReferrerHost",
  ];
  for (const key of maps) {
    const map = stats[key] as Record<string, number>;
    const entries = Object.entries(map);
    if (entries.length <= MAX_MAP_KEYS) continue;
    const keep = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_MAP_KEYS);
    (stats[key] as Record<string, number>) = Object.fromEntries(keep);
  }
}

interface RecordInput {
  type: EventType;
  slug: string;
  country: string;
  device: string;
  channel: string;
  referrerHost: string;
  bucket?: number;
  hash: string;
}

/**
 * Apply one event to the post's aggregate (and, for views, its per-day dedupe
 * set) in a single transaction so concurrent beacons can't lose updates.
 */
async function recordBlogEvent(input: RecordInput): Promise<void> {
  const db = getFirestore();
  const mainRef = db.collection(STATS_COLLECTION).doc(input.slug);
  const date = todayKey();
  const dayRef = mainRef.collection("days").doc(date);

  await db.runTransaction(async (tx) => {
    const mainSnap = await tx.get(mainRef);

    // Uniqueness: only for views, via the day's rotating-hash set.
    let unique = false;
    if (input.type === "view") {
      const daySnap = await tx.get(dayRef);
      const seen = ((daySnap.exists ? daySnap.data()?.seen : {}) ?? {}) as Record<string, number>;
      if (!seen[input.hash] && Object.keys(seen).length < MAX_SEEN_PER_DAY) {
        seen[input.hash] = 1;
        unique = true;
        tx.set(dayRef, { seen, updatedAt: Date.now() }, { merge: true });
      }
    }

    const cur = normalizeBlogStats(mainSnap.exists ? mainSnap.data() : { slug: input.slug }, input.slug);
    const day = cur.daily[date] ?? { v: 0, u: 0, c: 0 };

    if (input.type === "view") {
      cur.views += 1;
      day.v += 1;
      bump(cur.byCountry, input.country);
      bump(cur.byDevice, input.device);
      bump(cur.byChannel, input.channel);
      if (input.referrerHost) bump(cur.byReferrerHost, input.referrerHost);
      if (unique) {
        cur.uniques += 1;
        day.u += 1;
      }
    } else if (input.type === "read") {
      const b = String(input.bucket ?? 0);
      if ((READ_BUCKETS as readonly string[]).includes(b)) bump(cur.readBuckets, b);
    } else {
      cur.ctaClicks += 1;
      day.c += 1;
      bump(cur.ctaByCountry, input.country);
    }

    cur.daily[date] = day;
    prune(cur);
    cur.updatedAt = Date.now();
    tx.set(mainRef, cur, { merge: false });
  });
}

// ---- Admin readers ---------------------------------------------------------

/** Full aggregate for one post. */
export async function getBlogStats(slug: string): Promise<BlogStats> {
  ensureAdmin();
  const snap = await getFirestore().collection(STATS_COLLECTION).doc(slug).get();
  return normalizeBlogStats(snap.exists ? snap.data() : { slug }, slug);
}

/** Lightweight totals for every post (drives the admin list column). */
export async function getAllBlogStats(): Promise<BlogStatsListItem[]> {
  ensureAdmin();
  const snap = await getFirestore().collection(STATS_COLLECTION).get();
  return snap.docs.map((d) => {
    const s = normalizeBlogStats(d.data(), d.id);
    return { slug: s.slug || d.id, views: s.views, uniques: s.uniques, ctaClicks: s.ctaClicks };
  });
}

// ---- Rate limiting (in-memory, per warm instance) --------------------------

const THROTTLE_MS = 1500;
const lastSeen = new Map<string, number>();

function throttled(key: string): boolean {
  const now = Date.now();
  const prev = lastSeen.get(key) ?? 0;
  if (now - prev < THROTTLE_MS) return true;
  lastSeen.set(key, now);
  if (lastSeen.size > 20_000) {
    for (const [k, v] of lastSeen) if (now - v > 60_000) lastSeen.delete(k);
  }
  return false;
}

// ---- Routes ----------------------------------------------------------------

/**
 * Public, tokenless ingest beacon. Accepts `text/plain` (so `navigator.send
 * Beacon` stays a CORS-simple request with no preflight) and always answers
 * 204 — analytics must never surface an error to a visitor.
 */
export function registerBlogTrackingRoute(app: Express): void {
  const parse = express.text({ type: () => true, limit: "8kb" });

  app.post("/blog-track", parse, async (req: Request, res: Response) => {
    try {
      const ua = String(req.headers["user-agent"] ?? "");
      if (isBot(ua)) return;

      let body: Record<string, unknown> = {};
      const raw = typeof req.body === "string" ? req.body : "";
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        return;
      }

      const type = body.type;
      if (type !== "view" && type !== "read" && type !== "cta") return;
      const slug = slugify(String(body.slug ?? ""));
      if (!slug) return;

      const ip = (req.ip || "unknown").toString();
      if (throttled(`${ip}:${slug}:${type}`)) return;

      const country = countryFromSignals({
        headers: req.headers,
        locale: String(body.locale ?? ""),
        tz: String(body.tz ?? ""),
      });
      const referrerHost = hostOf(String(body.referrer ?? ""));
      const channel = channelFor(referrerHost, String(body.utmMedium ?? ""));
      const bucket = type === "read" ? Number(body.bucket) : undefined;

      await recordBlogEvent({
        type,
        slug,
        country,
        device: deviceFromUA(ua),
        channel,
        referrerHost,
        bucket,
        hash: dailyHash(ip, ua, todayKey()),
      });
    } catch (err) {
      console.error("[blog-track] failed", err);
    } finally {
      res.status(204).end();
    }
  });
}

function handleError(res: Response, err: unknown): void {
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

/** Admin-only stats readers. Registered under the guarded `/admin` namespace. */
export function registerBlogStatsAdminRoutes(app: Express): void {
  app.get("/admin/blog/stats", async (_req: Request, res: Response) => {
    try {
      res.json({ stats: await getAllBlogStats() });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/blog/:slug/stats", async (req: Request, res: Response) => {
    try {
      res.json(await getBlogStats(slugify(String(req.params.slug))));
    } catch (err) {
      handleError(res, err);
    }
  });
}
