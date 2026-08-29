/**
 * Admin Analysis dashboard backend.
 *
 * All cross-user analytics is computed HERE with the Admin SDK, because the
 * Firestore rules only let a user read their own `users/{uid}/**`. The client
 * (admin-gated UI) just renders what these routes return.
 *
 * Data sources:
 *   - Firebase Auth user list (`listUsers`) — signups (creationTime), last
 *     activity (lastSignInTime/lastRefreshTime), provider, email. Retroactive.
 *   - `analyticsEvents/*` (written by the Auth blocking functions) — the login
 *     time-series. Forward-only (empty until the triggers have run).
 *   - `usageAggregates` (collection group) — lifetime AI spend per user.
 *
 * Exclusions (an admin's own email, test accounts, whole domains) come from
 * `adminSettings` and are applied at aggregation time, so excluded users never
 * appear in any number, chart or table.
 */
import express, { type Express, type Request, type Response } from "express";
import { ZodError } from "zod";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getAdminSettings, saveAdminSettings } from "./adminSettings";
import { getSparksConfig } from "./appConfig";
import { getPlansConfig } from "./plans";
import { adminAdjustSparks } from "./sparks";
import { financeSummary, type FinanceCategory } from "./finance";
import { listAlerts, resolveAlert } from "./alerts";
import { retryFailedFulfillments } from "./stripe";
import { printCostCalibration } from "./orders";
import { importInfraCosts } from "./infraCosts";
import { deleteCustomCost, listCustomCosts, sweepCustomCosts, upsertCustomCost } from "./customCosts";
import { getProductsConfig } from "./products";
import {
  getProjectMirror,
  listProjectMirrors,
  projectDocKey,
  projectFinanceIndex,
  summarizeProjects,
  summarizeUsers,
  type ProjectMilestone,
  type ProjectQuery,
} from "./projects";
import {
  getActionRun,
  getRunCalls,
  listActionRuns,
  type RunKind,
  type RunOutcome,
} from "./actionRun";
import { mergeTally, percentile } from "./stats";
import { toUsd } from "./finance";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import { priceForAction } from "../../books-frontend/src/core/config/sparks";
import {
  MULTI_ZONE_COUNTRIES,
  normalizeCountry,
  timezoneForCountry,
  UNKNOWN_COUNTRY,
} from "../../books-frontend/src/core/analytics/markets";
import {
  intervalForPriceId,
  resolvePlanByPriceId,
  type PlanDefinition,
  type PlansConfig,
} from "../../books-frontend/src/core/config/plans";
import { DEVICE_FILTERS, previousRange } from "../../books-frontend/src/core/analytics/types";
import {
  browserVersionKey,
  browserVersionLabel,
  deviceLabel,
  KNOWN_DEVICE_CLASSES,
  osLabel,
  viewportLabel,
} from "../../books-frontend/src/core/analytics/device";
import { readDeviceDays } from "./deviceStats";
import {
  buyerFacts,
  normalizeBuyerProfile,
  type BuyerFacts,
} from "../../books-frontend/src/core/config/surveys";
import { hasPermission, maskDisplayName, maskEmail } from "../../books-frontend/src/core/config/permissions";
import { logAudit, type PermissionedRequest } from "./permissions";
import type {
  ActionCostReport,
  ActionCostSeriesPoint,
  ActionCostStats,
  ActiveUsersSource,
  ActivityGrid,
  ActivityMetric,
  AdminSettings,
  AnalyticsOverview,
  AnalyticsTotals,
  CostGranularity,
  AnalyticsUserRow,
  AnalyticsUsersResult,
  BillingCadence,
  BreakdownSlice,
  CadenceFilter,
  CountryActivity,
  CrossDeviceCohort,
  CrossDeviceReport,
  DeviceCountRow,
  DeviceFilter,
  DeviceReport,
  DeviceSegmentRow,
  DeviceSeriesPoint,
  FunnelReport,
  FunnelStage,
  PlanFilter,
  ProductFamily,
  ProductRow,
  ProductSeriesPoint,
  ProductsReport,
  SortDir,
  TimeSeriesPoint,
  TimezoneMode,
  UserEconomics,
  UserSort,
} from "../../books-frontend/src/core/analytics/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Cap the Auth scan so one request can't run unbounded against a huge project. */
const MAX_USERS_SCAN = 20_000;
/**
 * Cap the auth-event scan. `analyticsEvents` is append-only and never pruned,
 * so an uncapped range read grows without bound as the project ages.
 */
const MAX_EVENTS_SCAN = 100_000;
const SCAN_CACHE_TTL_MS = 30_000;

/** A flattened, exclusion-filtered view of an Auth account. */
interface ScannedUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  source: string;
  createdAt: number | null;
  lastActiveAt: number | null;
  emailVerified: boolean;
  isAnonymous: boolean;
}

interface ScanResult {
  users: ScannedUser[];
  excludedCount: number;
  capped: boolean;
}

let scanCache: { key: string; at: number; value: ScanResult } | null = null;

/**
 * Briefly memoize a whole-collection scan.
 *
 * One dashboard refresh fans out to overview + users + funnel, and each of
 * those needs the same `users` and `payments` collections. Without this, adding
 * the market dimension would have tripled the read cost of every refresh; with
 * it, they share a single scan and the dashboard is cheaper than before.
 */
function cachedScan<T>(ttlMs: number): (load: () => Promise<T>) => Promise<T> {
  let cache: { at: number; value: Promise<T> } | null = null;
  return (load) => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.value;
    const value = load().catch((err) => {
      cache = null; // Never cache a failure.
      throw err;
    });
    cache = { at: Date.now(), value };
    return value;
  };
}

function parseTime(stamp?: string): number | null {
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : ms;
}

function sourceOf(user: UserRecord): string {
  const providerId = user.providerData?.[0]?.providerId;
  if (providerId) return providerId;
  return "anonymous";
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function makeExcluder(settings: AdminSettings): (email: string | null) => boolean {
  const emails = new Set(settings.excludedEmails);
  const domains = new Set(settings.excludedDomains);
  return (email) => {
    if (!email) return false;
    const e = email.toLowerCase();
    if (emails.has(e)) return true;
    return domains.has(domainOf(e));
  };
}

/**
 * Page through every Auth account once, drop excluded users, and flatten to the
 * fields the dashboard needs. Cached briefly (keyed by the exclusion signature)
 * so repeated refreshes don't re-scan.
 */
async function scanUsers(settings: AdminSettings): Promise<ScanResult> {
  const key = JSON.stringify([settings.excludedEmails, settings.excludedDomains]);
  if (scanCache && scanCache.key === key && Date.now() - scanCache.at < SCAN_CACHE_TTL_MS) {
    return scanCache.value;
  }
  ensureAdmin();
  const isExcluded = makeExcluder(settings);
  const users: ScannedUser[] = [];
  let excludedCount = 0;
  let scanned = 0;
  let capped = false;
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) {
      scanned += 1;
      if (isExcluded(u.email ?? null)) {
        excludedCount += 1;
        continue;
      }
      const created = parseTime(u.metadata.creationTime);
      const lastActive =
        parseTime(u.metadata.lastRefreshTime ?? undefined) ??
        parseTime(u.metadata.lastSignInTime) ??
        created;
      users.push({
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        source: sourceOf(u),
        createdAt: created,
        lastActiveAt: lastActive,
        emailVerified: u.emailVerified,
        isAnonymous: u.providerData.length === 0,
      });
    }
    pageToken = page.pageToken;
    if (scanned >= MAX_USERS_SCAN) {
      capped = Boolean(pageToken);
      break;
    }
  } while (pageToken);

  const value: ScanResult = { users, excludedCount, capped };
  scanCache = { key, at: Date.now(), value };
  return value;
}

interface EventRow {
  type: string;
  uid: string | null;
  email: string | null;
  country: string | null;
  at: number;
  /**
   * Form factor the event happened on, or null for events written before device
   * capture existed. Null is load-bearing: it means "not recorded", and any
   * breakdown built from these must exclude rather than bucket it, or the whole
   * pre-capture backlog silently lands in one form factor.
   */
  device: string | null;
  os: string | null;
  browser: string | null;
  browserMajor: number | null;
}

interface EventScan {
  events: EventRow[];
  /** True when the scan hit {@link MAX_EVENTS_SCAN} — counts are a lower bound. */
  capped: boolean;
}

/** Fetch recorded auth events within the window (login time-series source). */
async function fetchEvents(from: number, to: number): Promise<EventScan> {
  ensureAdmin();
  try {
    const snap = await getFirestore()
      .collection("analyticsEvents")
      .where("at", ">=", from)
      .where("at", "<=", to)
      .orderBy("at", "asc")
      .limit(MAX_EVENTS_SCAN)
      .get();
    const events = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v ? v : null);
      return {
        type: typeof data.type === "string" ? data.type : "",
        uid: typeof data.uid === "string" ? data.uid : null,
        email: typeof data.email === "string" ? data.email : null,
        country: normalizeCountry(data.country),
        at: typeof data.at === "number" ? data.at : 0,
        device: str(data.device),
        os: str(data.os),
        browser: str(data.browser),
        browserMajor: typeof data.browserMajor === "number" ? data.browserMajor : null,
      };
    });
    return { events, capped: snap.size >= MAX_EVENTS_SCAN };
  } catch {
    return { events: [], capped: false };
  }
}

/** Lifetime AI spend per uid from the `usageAggregates` collection group. */
async function fetchSpendByUid(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  ensureAdmin();
  try {
    const snap = await getFirestore().collectionGroup("usageAggregates").get();
    for (const doc of snap.docs) {
      // path: users/{uid}/usageAggregates/{period}
      const segments = doc.ref.path.split("/");
      const uid = segments[1];
      const cost = (doc.data() as { costUsd?: unknown }).costUsd;
      if (uid && typeof cost === "number" && Number.isFinite(cost)) {
        out.set(uid, (out.get(uid) ?? 0) + cost);
      }
    }
  } catch {
    // Collection-group query may be unavailable; degrade to no spend.
  }
  return out;
}

const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due"]);
const PAID_LIKE_STATUSES = new Set(["paid", "refunded", "partially_refunded"]);

/** Per-user fields the dashboard reads off the `users/{uid}` doc. */
interface UserMeta {
  sparkBalance: number | null;
  /** Market, denormalized by the auth blocking functions (see analyticsEvents.ts). */
  country: string | null;
  /** Timestamp when user registered / linked a permanent account. */
  signedUpAt: number | null;
  /**
   * What the surveys worked out about who they buy for, or null if they've never
   * answered. Summarized here — the raw answer keys stay on the document, since a
   * thousand rows each carrying eighty of them is a payload nobody reads.
   */
  buyer: BuyerFacts | null;
  /**
   * The device rollup written by the session beacon + blocking functions (see
   * `deviceStats.ts`), or null for accounts that predate it. Riding along on this
   * scan is what makes cross-device cohorts free: the alternative is a second
   * pass over `users`, which would double the cost of every refresh.
   */
  device: UserDeviceMeta | null;
}

/** The device facts the dashboard needs per account. Mirrors `meta.device`. */
interface UserDeviceMeta {
  /** Most recent session's form factor / OS / browser. */
  device: string | null;
  os: string | null;
  browser: string | null;
  browserMajor: number | null;
  /** Form factor of the first recorded session — the entry-device attribution. */
  firstDevice: string | null;
  /** Form factor at account creation. */
  signupDevice: string | null;
  /** Form factor of the first completed purchase. */
  purchaseDevice: string | null;
  viewport: string | null;
  /** Sessions per form factor (at most four keys). */
  counts: Record<string, number>;
  sessions: number;
  /** Epoch ms of the first session on a form factor other than `firstDevice`. */
  switchedAt: number | null;
  lastSeenAt: number | null;
}

function readUserDeviceMeta(raw: unknown): UserDeviceMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const numOrNull = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const counts: Record<string, number> = {};
  if (d.counts && typeof d.counts === "object") {
    for (const [k, v] of Object.entries(d.counts as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) counts[k] = v;
    }
  }
  const meta: UserDeviceMeta = {
    device: str(d.device),
    os: str(d.os),
    browser: str(d.browser),
    browserMajor: numOrNull(d.browserMajor),
    firstDevice: str(d.firstDevice),
    signupDevice: str(d.signupDevice),
    purchaseDevice: str(d.purchaseDevice),
    viewport: str(d.viewport),
    counts,
    sessions: numOrNull(d.sessions) ?? 0,
    switchedAt: numOrNull(d.switchedAt),
    lastSeenAt: numOrNull(d.lastSeenAt),
  };
  // A doc where the map exists but holds nothing useful is the same as absent —
  // returning a hollow object would make every "has device data" test true.
  const empty =
    !meta.device && !meta.firstDevice && !meta.signupDevice && meta.sessions === 0;
  return empty ? null : meta;
}

/**
 * The form factor an account is ATTRIBUTED to, best signal first.
 *
 * Entry device, not latest device: the dashboard's device filter selects people
 * by where they came in and then reports everything they did afterwards. Using
 * the latest device instead would move a person between segments every time they
 * picked up a different screen, which makes any trend meaningless.
 */
function entryDeviceOf(meta: UserMeta | undefined): string | null {
  const d = meta?.device;
  if (!d) return null;
  return d.firstDevice ?? d.signupDevice ?? d.device ?? null;
}

/** True when the account has been seen on more than one form factor. */
function isMultiDevice(d: UserDeviceMeta): boolean {
  const seen = Object.keys(d.counts).filter((k) => k !== "unknown");
  return seen.length > 1 || d.switchedAt != null;
}

/**
 * One pass over the `users` collection for every per-user field the dashboard
 * needs. Spark balance and market are read together because they come from the
 * same document — two separate scans of the collection would double the cost of
 * every refresh for no benefit.
 */
const userMetaCache = cachedScan<Map<string, UserMeta>>(SCAN_CACHE_TTL_MS);

function fetchUserMeta(): Promise<Map<string, UserMeta>> {
  return userMetaCache(async () => {
    const out = new Map<string, UserMeta>();
    ensureAdmin();
    try {
      const snap = await getFirestore().collection("users").get();
      for (const doc of snap.docs) {
        const d = doc.data() as {
          sparkBalance?: unknown;
          country?: unknown;
          signedUpAt?: unknown;
          surveyProfile?: unknown;
          meta?: unknown;
        };
        const balance =
          typeof d.sparkBalance === "number" && Number.isFinite(d.sparkBalance)
            ? d.sparkBalance
            : null;
        const signedUpAt =
          typeof d.signedUpAt === "number" && Number.isFinite(d.signedUpAt)
            ? d.signedUpAt
            : null;
        const profile = normalizeBuyerProfile(d.surveyProfile);
        const meta = (d.meta ?? {}) as Record<string, unknown>;
        out.set(doc.id, {
          sparkBalance: balance,
          country: normalizeCountry(d.country),
          signedUpAt,
          // Null rather than an empty profile, so the table can show "never asked"
          // and "answered but told us nothing" as the different things they are.
          buyer: profile.answers > 0 ? buyerFacts(profile) : null,
          device: readUserDeviceMeta(meta.device),
        });
      }
    } catch {
      // ignore — degrade to no per-user metadata
    }
    return out;
  });
}

interface SubInfo {
  status: string;
  priceId: string | null;
  amount: number | null;
  currency: string | null;
}

/** The active subscription per uid from the admin `subscriptions` collection. */
async function fetchSubscriptionByUid(): Promise<Map<string, SubInfo>> {
  const out = new Map<string, SubInfo>();
  ensureAdmin();
  try {
    const snap = await getFirestore().collection("subscriptions").get();
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const uid = typeof d.ownerUid === "string" ? d.ownerUid : null;
      const status = typeof d.status === "string" ? d.status : "";
      if (!uid || !ACTIVE_SUB_STATUSES.has(status)) continue;
      // Prefer the first active subscription we find for a user.
      if (out.has(uid)) continue;
      out.set(uid, {
        status,
        priceId: typeof d.priceId === "string" ? d.priceId : null,
        amount: typeof d.amount === "number" ? d.amount : null,
        currency: typeof d.currency === "string" ? d.currency.toUpperCase() : null,
      });
    }
  } catch {
    // ignore — degrade to no subscriptions
  }
  return out;
}

interface RevenueInfo {
  total: number;
  currency: string | null;
  /** Shipping destination of the user's most recent print order, if any. */
  country: string | null;
}

/**
 * Lifetime gross revenue per uid from the admin `payments` collection, plus the
 * market their orders shipped to. The market rides along on this scan because
 * it's the best fallback for accounts that predate market capture at sign-in:
 * somebody who ordered a book told us where they are.
 */
const revenueCache = cachedScan<Map<string, RevenueInfo>>(SCAN_CACHE_TTL_MS);

/**
 * Exported for the survey report, which cross-tabs answers against lifetime
 * value. Sharing the scan (and its cache) rather than re-deriving revenue there
 * is the difference between "grandparents are worth more" meaning the same thing
 * on two screens and meaning two things.
 */
export function fetchRevenueByUid(): Promise<Map<string, RevenueInfo>> {
  return revenueCache(async () => {
    const out = new Map<string, RevenueInfo>();
    ensureAdmin();
    try {
      const snap = await getFirestore().collection("payments").get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const uid = typeof d.ownerUid === "string" ? d.ownerUid : null;
        const status = typeof d.status === "string" ? d.status : "";
        const amount = typeof d.amount === "number" ? d.amount : 0;
        if (!uid || !PAID_LIKE_STATUSES.has(status)) continue;
        const currency = typeof d.currency === "string" ? d.currency.toUpperCase() : null;
        const plan = d.fulfillment as { destinationCountry?: unknown } | null;
        const country =
          normalizeCountry(d.billingCountry) ?? normalizeCountry(plan?.destinationCountry);
        const prev = out.get(uid) ?? { total: 0, currency, country };
        prev.total += amount;
        if (!prev.currency) prev.currency = currency;
        if (!prev.country) prev.country = country;
        out.set(uid, prev);
      }
    } catch {
      // ignore — degrade to no revenue
    }
    return out;
  });
}

/**
 * Which purchase in the customer's history each payment was — 1 for their first.
 *
 * Exported for the survey report, where "what do people buy FIRST" is the whole
 * question. Derived here rather than stored on the response row because the count
 * at answer time is a race: a confirmation screen can render before the webhook
 * that increments the lifetime counter has landed, and an ordinal that was one
 * short when it was written stays one short forever. Recomputing it means the
 * report self-corrects as payments settle.
 *
 * Only paid-like payments count, so an abandoned checkout doesn't push everything
 * after it up by one.
 */
const ordinalCache = cachedScan<Map<string, number>>(SCAN_CACHE_TTL_MS);

export function fetchPurchaseOrdinals(): Promise<Map<string, number>> {
  return ordinalCache(async () => {
    const out = new Map<string, number>();
    ensureAdmin();
    try {
      const snap = await getFirestore().collection("payments").get();
      const byUid = new Map<string, { id: string; at: number }[]>();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const uid = typeof d.ownerUid === "string" ? d.ownerUid : null;
        const status = typeof d.status === "string" ? d.status : "";
        if (!uid || !PAID_LIKE_STATUSES.has(status)) continue;
        const list = byUid.get(uid) ?? [];
        list.push({ id: doc.id, at: tsToMillis(d.createdAt) ?? 0 });
        byUid.set(uid, list);
      }
      for (const list of byUid.values()) {
        // Ties broken by id so the ordering is total and stable: two payments with
        // the same timestamp must not swap places between two reads of the report.
        list.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        list.forEach((payment, i) => out.set(payment.id, i + 1));
      }
    } catch {
      // Degrade to unknown ordinals. The report labels them as such rather than
      // guessing, because a wrong ordinal is indistinguishable from a real one.
    }
    return out;
  });
}

/** Resolve the plan + billing cadence a subscription's price id maps to. */
function resolvePlanInfo(
  plans: PlansConfig,
  sub: SubInfo | undefined,
): { plan: PlanDefinition | null; cadence: BillingCadence | null } {
  if (!sub || !sub.priceId) return { plan: null, cadence: null };
  const plan = resolvePlanByPriceId(plans, sub.priceId);
  if (!plan) return { plan: null, cadence: null };
  return { plan, cadence: intervalForPriceId(plan, sub.priceId) };
}

/**
 * Memoized `Intl.DateTimeFormat` per zone. Market-mode bucketing formats every
 * event in its own market's zone, so a fresh formatter per call would dominate
 * the cost of building the grids.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(tz);
  if (cached) return cached;
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", opts);
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  }
  FORMATTERS.set(tz, fmt);
  return fmt;
}

/** Day/weekday/hour for an instant in the given IANA timezone. */
function tzParts(at: number, tz: string): { dayKey: string; weekday: number; hour: number } {
  const parts = formatterFor(tz).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: wd[get("weekday")] ?? 0,
    hour: Math.min(23, Math.max(0, parseInt(get("hour"), 10) || 0)),
  };
}

/** Ordered list of day keys spanning [from,to] in tz (zero-fill the axis). */
function dayKeysBetween(from: number, to: number, tz: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = from; t <= to + DAY_MS; t += DAY_MS) {
    const { dayKey } = tzParts(Math.min(t, to), tz);
    if (!seen.has(dayKey)) {
      seen.add(dayKey);
      keys.push(dayKey);
    }
  }
  return keys;
}

/** Sortable bucket key for an instant at the given granularity (in tz). */
function bucketKey(at: number, tz: string, g: CostGranularity): string {
  const p = tzParts(at, tz);
  return g === "hour" ? `${p.dayKey} ${String(p.hour).padStart(2, "0")}` : p.dayKey;
}

/**
 * Ordered, de-duplicated bucket axis spanning [from,to] at the granularity,
 * each with a representative epoch (for label formatting). Zero-fills the chart.
 */
function bucketAxis(
  from: number,
  to: number,
  tz: string,
  g: CostGranularity,
): { key: string; ts: number }[] {
  const step = g === "hour" ? HOUR_MS : DAY_MS;
  const out: { key: string; ts: number }[] = [];
  const seen = new Set<string>();
  for (let t = from; t <= to + step; t += step) {
    const clamped = Math.min(t, to);
    const key = bucketKey(clamped, tz, g);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, ts: clamped });
    }
  }
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  password: "Email",
  "google.com": "Google",
  anonymous: "Guest",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function emptyMatrix(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

/** One activity instant, already resolved to a market and an actor. */
interface ActivityPoint {
  at: number;
  /** Market the instant belongs to (drives local-time bucketing). */
  country: string;
  /** Who caused it — lets a cell count people, not just events. */
  actor: string;
}

/**
 * Accumulates a weekday × hour grid, counting both events and distinct people.
 *
 * Distinct-user counts need a set per cell (168 of them) because the same
 * person signing in five times on Tuesday evening is one person, not five —
 * and that distinction is the whole difference between "when are our customers
 * around" and "who refreshes the most".
 */
class GridBuilder {
  private readonly events = emptyMatrix();
  private readonly cellUsers: Set<string>[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => new Set<string>()),
  );
  private readonly weekdayUsers = Array.from({ length: 7 }, () => new Set<string>());
  private readonly hourUsers = Array.from({ length: 24 }, () => new Set<string>());

  add(weekday: number, hour: number, actor: string): void {
    this.events[weekday][hour] += 1;
    if (!actor) return;
    this.cellUsers[weekday][hour].add(actor);
    this.weekdayUsers[weekday].add(actor);
    this.hourUsers[hour].add(actor);
  }

  build(): ActivityGrid {
    const users = this.cellUsers.map((row) => row.map((s) => s.size));
    const byWeekday = this.events.map((row) => row.reduce((a, b) => a + b, 0));
    const byHour = new Array<number>(24).fill(0);
    let peak = 0;
    for (const row of this.events) {
      for (let h = 0; h < 24; h += 1) {
        byHour[h] += row[h];
        if (row[h] > peak) peak = row[h];
      }
    }
    return {
      events: this.events,
      users,
      byWeekday,
      byHour,
      usersByWeekday: this.weekdayUsers.map((s) => s.size),
      usersByHour: this.hourUsers.map((s) => s.size),
      peak,
    };
  }
}

/**
 * Build the three metric grids from one pass of activity points.
 *
 * `tzMode` decides which clock each point is read against: `market` uses the
 * point's own market (so the curve describes the person), `fixed` uses one zone
 * for everything (so the curve describes the business's own day).
 */
function buildActivity(
  signups: ActivityPoint[],
  logins: ActivityPoint[],
  tzMode: TimezoneMode,
  fixedTz: string,
): Record<ActivityMetric, ActivityGrid> {
  const builders: Record<ActivityMetric, GridBuilder> = {
    all: new GridBuilder(),
    signups: new GridBuilder(),
    logins: new GridBuilder(),
  };
  const feed = (points: ActivityPoint[], metric: "signups" | "logins") => {
    for (const p of points) {
      const tz = tzMode === "market" ? timezoneForCountry(p.country, fixedTz) : fixedTz;
      const { weekday, hour } = tzParts(p.at, tz);
      builders[metric].add(weekday, hour, p.actor);
      builders.all.add(weekday, hour, p.actor);
    }
  };
  feed(signups, "signups");
  feed(logins, "logins");
  return {
    all: builders.all.build(),
    signups: builders.signups.build(),
    logins: builders.logins.build(),
  };
}

/** Resolve each account's market, best signal first. */
function resolveUserCountries(
  users: ScannedUser[],
  meta: Map<string, UserMeta>,
  eventCountryByUid: Map<string, string>,
  revenue: Map<string, RevenueInfo>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const u of users) {
    const country =
      // 1. Denormalized at sign-in/login from the client locale — the freshest.
      meta.get(u.uid)?.country ??
      // 2. An event inside the window, for accounts whose doc predates capture.
      eventCountryByUid.get(u.uid) ??
      // 3. Where they had a book shipped — slow but definitive.
      revenue.get(u.uid)?.country ??
      UNKNOWN_COUNTRY;
    out.set(u.uid, country);
  }
  return out;
}

/** The subset of headline counters computable for an arbitrary window. */
function countTotals(
  users: ScannedUser[],
  events: EventRow[],
  countryOf: (uid: string) => string,
  country: string | null,
  from: number,
  to: number,
  inSegment: (uid: string) => boolean = () => true,
  meta?: Map<string, UserMeta>,
): { totals: AnalyticsTotals; activeSource: ActiveUsersSource } {
  const inMarket = (uid: string) => (!country || countryOf(uid) === country) && inSegment(uid);
  let totalUsers = 0;
  let totalGuests = 0;
  let newSignups = 0;
  for (const u of users) {
    if (!inMarket(u.uid)) continue;
    if (u.isAnonymous) {
      totalGuests += 1;
    } else {
      totalUsers += 1;
      const signupTime = meta?.get(u.uid)?.signedUpAt ?? u.createdAt;
      if (signupTime != null && signupTime >= from && signupTime <= to) {
        newSignups += 1;
      }
    }
  }

  let logins = 0;
  const activeFromEvents = new Set<string>();
  let sawAnyEvent = false;
  for (const e of events) {
    if (e.at < from || e.at > to) continue;
    if (e.uid && !inMarket(e.uid)) continue;
    sawAnyEvent = true;
    if (e.uid) activeFromEvents.add(e.uid);
    if (e.type === "login") logins += 1;
  }

  // The event log is the only source that can answer "active during THIS
  // window"; Auth's single last-sign-in stamp can only approximate a trailing
  // one. Prefer events whenever the log covers the window at all.
  let activeUsers = activeFromEvents.size;
  let activeSource: ActiveUsersSource = "events";
  if (!sawAnyEvent) {
    activeSource = "auth";
    activeUsers = users.filter(
      (u) =>
        !u.isAnonymous &&
        inMarket(u.uid) &&
        u.lastActiveAt != null &&
        u.lastActiveAt >= from &&
        u.lastActiveAt <= to,
    ).length;
  }

  return {
    totals: { totalUsers, totalGuests, newSignups, logins, activeUsers },
    activeSource,
  };
}

/** Exported so the scheduled daily-summary job can reuse the same computation
 * the admin dashboard uses, instead of re-implementing the metrics. */
export async function computeOverview(
  from: number,
  to: number,
  settings: AdminSettings,
  opts: { country: string | null; tzMode: TimezoneMode; device?: DeviceFilter },
): Promise<AnalyticsOverview> {
  const { country, tzMode } = opts;
  const device: DeviceFilter = opts.device ?? "all";
  // A market-filtered view reads most naturally in that market's own clock.
  const tz = country ? timezoneForCountry(country, settings.timezone) : settings.timezone;
  const prev = previousRange({ from, to });

  const [{ users, excludedCount, capped }, current, previous, meta, revenue] = await Promise.all([
    scanUsers(settings),
    fetchEvents(from, to),
    fetchEvents(prev.from, prev.to),
    fetchUserMeta(),
    fetchRevenueByUid(),
  ]);

  // Events carry their own market; use them to fill in accounts whose user doc
  // predates market capture.
  const eventCountryByUid = new Map<string, string>();
  for (const e of [...current.events, ...previous.events]) {
    if (e.uid && e.country && !eventCountryByUid.has(e.uid)) eventCountryByUid.set(e.uid, e.country);
  }
  const userCountry = resolveUserCountries(users, meta, eventCountryByUid, revenue);
  const countryOf = (uid: string) => userCountry.get(uid) ?? UNKNOWN_COUNTRY;
  /** Market of an event: its own stamp, else its actor's resolved market. */
  const eventCountry = (e: EventRow) =>
    e.country ?? (e.uid ? countryOf(e.uid) : UNKNOWN_COUNTRY);
  const inMarket = (c: string) => !country || c === country;
  /**
   * Entry-device filter. Applied per PERSON, not per event, so a mobile signup
   * who later converts on a laptop still counts as mobile traffic that converted
   * — the whole reason this filter is entry-scoped (see `DeviceFilter`).
   * Accounts with no device data are excluded from a filtered view rather than
   * defaulted in: "unknown" is not evidence of any form factor.
   */
  const inDevice = (uid: string) =>
    device === "all" || entryDeviceOf(meta.get(uid)) === device;

  const dayKeys = dayKeysBetween(from, to, tz);
  const seriesMap = new Map<string, TimeSeriesPoint>();
  for (const day of dayKeys) seriesMap.set(day, { day, signups: 0, logins: 0 });

  const sources = new Map<string, number>();
  const signupDeviceCounts = new Map<string, number>();
  const signupPoints: ActivityPoint[] = [];
  const loginPoints: ActivityPoint[] = [];

  for (const u of users) {
    const c = countryOf(u.uid);
    if (!inMarket(c) || !inDevice(u.uid)) continue;
    sources.set(u.source, (sources.get(u.source) ?? 0) + 1);
    if (u.isAnonymous) continue;
    const signupTime = meta.get(u.uid)?.signedUpAt ?? u.createdAt;
    if (signupTime == null || signupTime < from || signupTime > to) continue;
    const point = seriesMap.get(tzParts(signupTime, tz).dayKey);
    if (point) point.signups += 1;
    signupPoints.push({ at: signupTime, country: c, actor: u.uid });
  }

  for (const e of current.events) {
    if (e.uid && !inDevice(e.uid)) continue;
    // The form-factor split of signups comes from the event log rather than the
    // Auth scan, because Auth records no device — and only from events that
    // actually carry one, so a pre-capture backlog reads as "no data" instead of
    // quietly inflating whichever bucket it got defaulted into.
    if (e.type === "signup" && e.device) {
      signupDeviceCounts.set(e.device, (signupDeviceCounts.get(e.device) ?? 0) + 1);
    }
    if (e.type !== "login") continue;
    const c = eventCountry(e);
    if (!inMarket(c)) continue;
    const point = seriesMap.get(tzParts(e.at, tz).dayKey);
    if (point) point.logins += 1;
    loginPoints.push({ at: e.at, country: c, actor: e.uid ?? e.email ?? "" });
  }

  const signupSources: BreakdownSlice[] = Array.from(sources.entries())
    .map(([key, value]) => ({ key, label: sourceLabel(key), value }))
    .sort((a, b) => b.value - a.value);
  const signupDevices: BreakdownSlice[] = Array.from(signupDeviceCounts.entries())
    .map(([key, value]) => ({ key, label: deviceLabel(key), value }))
    .sort((a, b) => b.value - a.value);

  const { totals, activeSource } = countTotals(
    users,
    current.events,
    countryOf,
    country,
    from,
    to,
    inDevice,
    meta,
  );
  const { totals: previousTotals, activeSource: previousActiveSource } = countTotals(
    users,
    previous.events,
    countryOf,
    country,
    prev.from,
    prev.to,
    inDevice,
    meta,
  );

  return {
    range: { from, to },
    timezone: tz,
    country,
    device,
    tzMode,
    generatedAt: Date.now(),
    totals,
    previousTotals,
    activeUsersSource: activeSource,
    // The two windows can be measured differently (the event log is
    // forward-only, so an older window may have no events and fall back to
    // Auth stamps). When they disagree, the UI suppresses the active-users
    // delta rather than presenting a methodology artefact as a trend.
    activeUsersComparable: activeSource === previousActiveSource,
    series: dayKeys.map((d) => seriesMap.get(d)!),
    signupSources,
    signupDevices,
    activity: buildActivity(signupPoints, loginPoints, tzMode, tz),
    countries: buildCountryBreakdown(users, current.events, countryOf, eventCountry, from, to, meta),
    excludedCount,
    capped,
    eventsCapped: current.capped,
  };
}

/** Per-market signups / logins / active users, ranked by engagement. */
function buildCountryBreakdown(
  users: ScannedUser[],
  events: EventRow[],
  countryOf: (uid: string) => string,
  eventCountry: (e: EventRow) => string,
  from: number,
  to: number,
  meta?: Map<string, UserMeta>,
): CountryActivity[] {
  interface Acc {
    totalUsers: number;
    signups: number;
    logins: number;
    active: Set<string>;
  }
  const acc = new Map<string, Acc>();
  const get = (c: string) => {
    const existing = acc.get(c);
    if (existing) return existing;
    const fresh: Acc = { totalUsers: 0, signups: 0, logins: 0, active: new Set() };
    acc.set(c, fresh);
    return fresh;
  };

  for (const u of users) {
    if (u.isAnonymous) continue;
    const a = get(countryOf(u.uid));
    a.totalUsers += 1;
    const signupTime = meta?.get(u.uid)?.signedUpAt ?? u.createdAt;
    if (signupTime != null && signupTime >= from && signupTime <= to) a.signups += 1;
  }
  for (const e of events) {
    if (e.at < from || e.at > to) continue;
    const a = get(eventCountry(e));
    if (e.type === "login") a.logins += 1;
    if (e.uid) a.active.add(e.uid);
  }

  return [...acc.entries()]
    .map(([country, a]) => ({
      country,
      totalUsers: a.totalUsers,
      signups: a.signups,
      logins: a.logins,
      activeUsers: a.active.size,
      timezone: timezoneForCountry(country, "UTC"),
      timezoneApproximate: MULTI_ZONE_COUNTRIES.has(country),
    }))
    .sort(
      (a, b) =>
        b.signups + b.activeUsers - (a.signups + a.activeUsers) || b.totalUsers - a.totalUsers,
    );
}

function compareRows(a: AnalyticsUserRow, b: AnalyticsUserRow, sort: UserSort): number {
  switch (sort) {
    case "created":
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    case "events":
      return a.events - b.events;
    case "spend":
      return (a.spendUsd ?? 0) - (b.spendUsd ?? 0);
    case "email":
      return (a.email ?? "").localeCompare(b.email ?? "");
    case "sparks":
      return (a.sparkBalance ?? 0) - (b.sparkBalance ?? 0);
    case "revenue":
      return (a.revenue ?? 0) - (b.revenue ?? 0);
    case "plan":
      return (a.planName ?? "").localeCompare(b.planName ?? "");
    case "lastActive":
    default:
      return (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0);
  }
}

async function computeUsers(
  from: number,
  to: number,
  settings: AdminSettings,
  opts: {
    sort: UserSort;
    dir: SortDir;
    limit: number;
    search: string;
    includeGuests: boolean;
    planFilter: PlanFilter;
    cadenceFilter: CadenceFilter;
    country: string | null;
    /** Entry-device filter — the same person-scoped selection as the overview. */
    device: DeviceFilter;
    /**
     * False (the default) masks `email`/`displayName` on every row — a plain
     * admin sees `j***@example.com`, never the real address, unless they also
     * hold `analysis.users.pii` (see `functions/src/permissions.ts`). Search
     * still matches against the REAL underlying value below, before masking —
     * masking is an output concern, not a filter.
     */
    revealPii: boolean;
  },
): Promise<AnalyticsUsersResult> {
  const [{ users }, { events }, spendByUid, metaByUid, subByUid, revenueByUid, plans] =
    await Promise.all([
      scanUsers(settings),
      fetchEvents(from, to),
      fetchSpendByUid(),
      fetchUserMeta(),
      fetchSubscriptionByUid(),
      fetchRevenueByUid(),
      getPlansConfig(),
    ]);

  // Keyed on uid, not email: guests have no email, and guests are where every
  // user journey in this product starts — joining on email hid all their
  // activity behind a permanent zero.
  const eventsByUid = new Map<string, number>();
  const eventCountryByUid = new Map<string, string>();
  for (const e of events) {
    if (!e.uid) continue;
    eventsByUid.set(e.uid, (eventsByUid.get(e.uid) ?? 0) + 1);
    if (e.country && !eventCountryByUid.has(e.uid)) eventCountryByUid.set(e.uid, e.country);
  }
  const userCountry = resolveUserCountries(users, metaByUid, eventCountryByUid, revenueByUid);

  const search = opts.search.trim().toLowerCase();
  let rows: AnalyticsUserRow[] = users
    .filter((u) => (opts.includeGuests ? true : !u.isAnonymous))
    .filter((u) => {
      if (!search) return true;
      return (
        (u.email ?? "").toLowerCase().includes(search) ||
        (u.displayName ?? "").toLowerCase().includes(search)
      );
    })
    .map((u) => {
      const sub = subByUid.get(u.uid);
      const { plan, cadence } = resolvePlanInfo(plans, sub);
      const isSubscribed = Boolean(sub) && !!plan && !plan.isFree;
      const revenue = revenueByUid.get(u.uid) ?? null;
      const country = userCountry.get(u.uid) ?? UNKNOWN_COUNTRY;
      const economics: UserEconomics = {
        sparkBalance: metaByUid.get(u.uid)?.sparkBalance ?? null,
        planId: plan?.id ?? null,
        planName: plan?.presentation.name ?? null,
        isSubscribed,
        billingCadence: isSubscribed ? cadence : null,
        subscriptionStatus: sub?.status ?? null,
        subscriptionAmount: isSubscribed ? sub?.amount ?? null : null,
        subscriptionCurrency: isSubscribed ? sub?.currency ?? null : null,
        revenue: revenue ? revenue.total : null,
        revenueCurrency: revenue ? revenue.currency : null,
      };
      return {
        uid: u.uid,
        email: opts.revealPii ? u.email : maskEmail(u.email),
        displayName: opts.revealPii ? u.displayName : maskDisplayName(u.displayName),
        piiMasked: !opts.revealPii,
        country: country === UNKNOWN_COUNTRY ? null : country,
        source: u.source,
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt,
        emailVerified: u.emailVerified,
        isAnonymous: u.isAnonymous,
        events: eventsByUid.get(u.uid) ?? 0,
        spendUsd: spendByUid.has(u.uid) ? spendByUid.get(u.uid)! : null,
        buyer: metaByUid.get(u.uid)?.buyer ?? null,
        entryDevice: entryDeviceOf(metaByUid.get(u.uid)),
        currentDevice: metaByUid.get(u.uid)?.device?.device ?? null,
        multiDevice: (() => {
          const d = metaByUid.get(u.uid)?.device;
          return d ? isMultiDevice(d) : false;
        })(),
        ...economics,
      } satisfies AnalyticsUserRow;
    })
    .filter((row) => {
      if (opts.planFilter === "paid" && !row.isSubscribed) return false;
      if (opts.planFilter === "free" && row.isSubscribed) return false;
      if (opts.cadenceFilter !== "all" && row.billingCadence !== opts.cadenceFilter) return false;
      if (opts.country) {
        const c = row.country ?? UNKNOWN_COUNTRY;
        if (c !== opts.country) return false;
      }
      if (opts.device !== "all" && row.entryDevice !== opts.device) return false;
      return true;
    });

  const total = rows.length;
  rows.sort((a, b) => {
    const cmp = compareRows(a, b, opts.sort);
    return opts.dir === "asc" ? cmp : -cmp;
  });
  rows = rows.slice(0, opts.limit);
  return { rows, total };
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: "Invalid settings.", issues: err.issues } });
    return;
  }
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

// ---- Per-action cost intelligence ------------------------------------------

/** Max usage line items to scan in one report (bounds an unbounded collection). */
const MAX_USAGE_SCAN = 50_000;

interface CostAcc {
  action: string;
  tier: "quick" | "premium" | null;
  costs: number[];
  total: number;
  unpriced: number;
}

/** Group key that keeps image tiers separate while text actions stay merged. */
function costGroupKey(action: string, tier: "quick" | "premium" | null): string {
  return tier ? `${action}::${tier}` : action;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Aggregate `users/{uid}/usage` line items (collection group) within a window
 * into per-action cost stats + the realized Spark margin, plus a zero-filled
 * cost time-series at the requested granularity. Cross-user, so it runs with the
 * Admin SDK like the rest of this dashboard.
 */
async function computeActionCosts(opts: {
  from: number;
  to: number;
  granularity: CostGranularity;
  tz: string;
}): Promise<ActionCostReport> {
  ensureAdmin();
  const { from, to, granularity, tz } = opts;
  const sparks = await getSparksConfig();

  const byAction = new Map<string, CostAcc>();
  const bucketAgg = new Map<string, { costUsd: number; count: number }>();
  let totalEvents = 0;
  let totalCostUsd = 0;
  let hasUnpriced = false;
  let capped = false;

  try {
    const snap = await getFirestore()
      .collectionGroup("usage")
      .where("at", ">=", from)
      .where("at", "<=", to)
      .limit(MAX_USAGE_SCAN)
      .get();
    capped = snap.size >= MAX_USAGE_SCAN;
    for (const doc of snap.docs) {
      const d = doc.data() as { action?: unknown; costUsd?: unknown; at?: unknown; tier?: unknown };
      const action = typeof d.action === "string" ? d.action : "unknown";
      const tier: "quick" | "premium" | null =
        d.tier === "quick" || d.tier === "premium" ? d.tier : null;
      const at = typeof d.at === "number" ? d.at : null;
      totalEvents += 1;
      const key = costGroupKey(action, tier);
      const acc = byAction.get(key) ?? { action, tier, costs: [], total: 0, unpriced: 0 };
      const priced = typeof d.costUsd === "number" && Number.isFinite(d.costUsd);
      if (priced) {
        acc.costs.push(d.costUsd as number);
        acc.total += d.costUsd as number;
        totalCostUsd += d.costUsd as number;
      } else {
        acc.unpriced += 1;
        hasUnpriced = true;
      }
      byAction.set(key, acc);
      if (at != null) {
        const key = bucketKey(at, tz, granularity);
        const b = bucketAgg.get(key) ?? { costUsd: 0, count: 0 };
        b.count += 1;
        if (priced) b.costUsd += d.costUsd as number;
        bucketAgg.set(key, b);
      }
    }
  } catch {
    // Collection-group query may need an index on first use; degrade to empty.
  }

  const series: ActionCostSeriesPoint[] = bucketAxis(from, to, tz, granularity).map(
    ({ key, ts }) => {
      const b = bucketAgg.get(key) ?? { costUsd: 0, count: 0 };
      return { bucket: key, ts, costUsd: round4(b.costUsd), count: b.count };
    },
  );

  const actions: ActionCostStats[] = [...byAction.values()]
    .map((acc) => {
      const sorted = [...acc.costs].sort((a, b) => a - b);
      const count = acc.costs.length + acc.unpriced;
      const avg = sorted.length > 0 ? acc.total / sorted.length : 0;
      const p90 = percentile(sorted, 90);
      // Always compute the price as if enabled, so the admin can preview margins
      // before flipping the economy on; the report carries `sparksEnabled` too.
      const sparkPrice = priceForAction({ ...sparks, enabled: true }, acc.action, avg);
      const valueOf = (s: number | null) => (s != null ? s * sparks.sparkValueUsd : null);
      const priceValue = valueOf(sparkPrice);
      return {
        action: acc.action,
        tier: acc.tier,
        count,
        totalUsd: round4(acc.total),
        minUsd: round4(sorted[0] ?? 0),
        avgUsd: round4(avg),
        medianUsd: round4(percentile(sorted, 50)),
        p90Usd: round4(p90),
        maxUsd: round4(sorted[sorted.length - 1] ?? 0),
        unpricedCount: acc.unpriced,
        sparkPrice,
        marginUsd: priceValue != null && sparkPrice && sparkPrice > 0 ? round4(priceValue - avg) : null,
        underwaterAtP90: priceValue != null && sparkPrice != null && sparkPrice > 0 ? priceValue < p90 : false,
      } satisfies ActionCostStats;
    })
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return {
    range: { from, to },
    granularity,
    timezone: tz,
    series,
    generatedAt: Date.now(),
    sparksEnabled: sparks.enabled,
    sparkValueUsd: sparks.sparkValueUsd,
    actions,
    totalEvents,
    totalCostUsd: round4(totalCostUsd),
    hasUnpriced,
    capped,
  };
}

// ---- Top products ------------------------------------------------------------

/** Cap the finance scan behind the products/funnel reports. */
const MAX_PRODUCT_SCAN = 50_000;

/** Split a product key (`print:square-hardcover`) into family + slug. */
function parseProductKey(key: string): { family: ProductFamily; slug: string } {
  const idx = key.indexOf(":");
  const head = idx >= 0 ? key.slice(0, idx) : key;
  const slug = idx >= 0 ? key.slice(idx + 1) : "";
  const family: ProductFamily =
    head === "print" || head === "ebook" || head === "pack" || head === "plan" ? head : "other";
  return { family, slug };
}

const FAMILY_LABELS: Record<ProductFamily, string> = {
  print: "Print book",
  ebook: "Ebook",
  pack: "Spark pack",
  plan: "Subscription",
  other: "Other",
};

/** Turn a slug into a title ("square-hardcover" → "Square hardcover"). */
function titleize(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * Rank every sellable thing by what it actually contributed over the window.
 *
 * Built from the finance stream rather than the orders collection so print
 * books, ebooks, Spark packs and subscription plans all land in ONE ranking —
 * the question "what should we sell more of" doesn't respect those boundaries.
 * Costs (print COGS, Stripe fees, refunds, tax) carry the same product key as
 * the revenue they offset, so `netUsd` is a real contribution figure and not
 * just gross.
 */
async function computeProducts(opts: {
  from: number;
  to: number;
  tz: string;
  country: string | null;
  productNames: Map<string, string>;
}): Promise<ProductsReport> {
  ensureAdmin();
  const { from, to, tz, country } = opts;

  interface Acc {
    productId: string;
    sku: string | null;
    units: number;
    orders: number;
    revenueUsd: number;
    costUsd: number;
    refundUsd: number;
    byCountry: Map<string, { revenueUsd: number; units: number }>;
    byDay: Map<string, ProductSeriesPoint>;
  }
  const acc = new Map<string, Acc>();
  let capped = false;
  let scanned = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let q: FirebaseFirestore.Query = getFirestore()
      .collection("financeEvents")
      .where("at", ">=", from)
      .where("at", "<=", to)
      .orderBy("at", "asc")
      .limit(5_000);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      const d = doc.data() as Record<string, unknown>;
      const productId = typeof d.productId === "string" ? d.productId : "";
      if (!productId) continue;
      const c = normalizeCountry(d.country) ?? UNKNOWN_COUNTRY;
      if (country && c !== country) continue;

      const amountUsd = typeof d.amountUsd === "number" ? d.amountUsd : 0;
      const units = typeof d.units === "number" && Number.isFinite(d.units) ? d.units : 0;
      const at = typeof d.at === "number" ? d.at : from;
      const kind = typeof d.kind === "string" ? d.kind : "";

      const a =
        acc.get(productId) ??
        ({
          productId,
          sku: null,
          units: 0,
          orders: 0,
          revenueUsd: 0,
          costUsd: 0,
          refundUsd: 0,
          byCountry: new Map(),
          byDay: new Map(),
        } satisfies Acc);
      if (typeof d.sku === "string" && d.sku) a.sku = d.sku;
      a.units += units;
      if (amountUsd >= 0) a.revenueUsd += amountUsd;
      else a.costUsd += -amountUsd;
      if (kind === "refund" && amountUsd < 0) a.refundUsd += -amountUsd;
      // "Orders" counts revenue lines only; fees and COGS are the same sale.
      if (amountUsd > 0 && kind !== "refund") a.orders += 1;

      if (amountUsd > 0 || units !== 0) {
        const cn = a.byCountry.get(c) ?? { revenueUsd: 0, units: 0 };
        if (amountUsd > 0) cn.revenueUsd += amountUsd;
        cn.units += units;
        a.byCountry.set(c, cn);
      }

      const dayKey = tzParts(at, tz).dayKey;
      const day = a.byDay.get(dayKey) ?? { day: dayKey, revenueUsd: 0, netUsd: 0, units: 0 };
      if (amountUsd >= 0) day.revenueUsd += amountUsd;
      day.netUsd += amountUsd;
      day.units += units;
      a.byDay.set(dayKey, day);

      acc.set(productId, a);
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (scanned >= MAX_PRODUCT_SCAN) {
      capped = true;
      break;
    }
    if (snap.size < 5_000) break;
  }

  const dayKeys = dayKeysBetween(from, to, tz);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const products: ProductRow[] = [...acc.values()]
    .map((a) => {
      const netUsd = a.revenueUsd - a.costUsd;
      const { family, slug } = parseProductKey(a.productId);
      const name = opts.productNames.get(a.productId) ?? titleize(slug);
      return {
        productId: a.productId,
        label: name ? `${name}` : FAMILY_LABELS[family],
        family,
        sku: a.sku,
        units: a.units,
        orders: a.orders,
        revenueUsd: r2(a.revenueUsd),
        costUsd: r2(a.costUsd),
        netUsd: r2(netUsd),
        refundUsd: r2(a.refundUsd),
        refundRatePct:
          a.revenueUsd > 0 ? Math.round((a.refundUsd / a.revenueUsd) * 1000) / 10 : null,
        netPerUnitUsd: a.units > 0 ? r2(netUsd / a.units) : null,
        marginPct: a.revenueUsd > 0 ? Math.round((netUsd / a.revenueUsd) * 1000) / 10 : null,
        countries: [...a.byCountry.keys()].filter((c) => c !== UNKNOWN_COUNTRY).length,
        topCountries: [...a.byCountry.entries()]
          .map(([c, v]) => ({ country: c, revenueUsd: r2(v.revenueUsd), units: v.units }))
          .sort((x, y) => y.revenueUsd - x.revenueUsd || y.units - x.units)
          .slice(0, 5),
        // Zero-filled so a product's gap reads as "sold nothing", not "no data".
        series: dayKeys.map(
          (day) =>
            a.byDay.get(day) ?? { day, revenueUsd: 0, netUsd: 0, units: 0 },
        ).map((p) => ({ day: p.day, revenueUsd: r2(p.revenueUsd), netUsd: r2(p.netUsd), units: p.units })),
      } satisfies ProductRow;
    })
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.netUsd - a.netUsd);

  return {
    range: { from, to },
    timezone: tz,
    country,
    generatedAt: Date.now(),
    products,
    totals: {
      revenueUsd: r2(products.reduce((s, p) => s + p.revenueUsd, 0)),
      costUsd: r2(products.reduce((s, p) => s + p.costUsd, 0)),
      netUsd: r2(products.reduce((s, p) => s + p.netUsd, 0)),
      units: products.reduce((s, p) => s + p.units, 0),
      orders: products.reduce((s, p) => s + p.orders, 0),
    },
    capped,
  };
}

/** Display names for the catalog's print products, keyed by product key. */
async function productDisplayNames(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const config = await getProductsConfig();
    for (const p of config.products) {
      out.set(`print:${p.id}`, p.presentation.name);
      if (p.provider.sku) out.set(`print:${p.provider.sku}`, p.presentation.name);
    }
  } catch {
    // Catalog unavailable — the report falls back to titleized slugs.
  }
  try {
    const plans = await getPlansConfig();
    for (const plan of plans.plans) out.set(`plan:${plan.id}`, plan.presentation.name);
  } catch {
    // Same fallback for plans.
  }
  out.set("ebook", "Ebook");
  return out;
}

// ---- Devices -----------------------------------------------------------------

/**
 * How long a signup cohort is followed for the cross-device analysis.
 *
 * Deliberately independent of the dashboard's window, and deliberately longer
 * than most of its presets. Somebody who starts a book on the train and finishes
 * it on a laptop at the weekend switches days later — measured over "today" the
 * switch rate would read as near zero, and the conclusion drawn from it ("nobody
 * moves between devices") would be an artefact of the window rather than a fact
 * about users.
 */
const COHORT_OBSERVATION_DAYS = 30;

/** Accumulator for one row of a device breakdown. */
interface DeviceAcc {
  sessions: number;
  users: number;
  signups: number;
  purchases: number;
  revenueUsd: number;
  refundUsd: number;
}

function emptyDeviceAcc(): DeviceAcc {
  return { sessions: 0, users: 0, signups: 0, purchases: 0, revenueUsd: 0, refundUsd: 0 };
}

function bumpAcc(map: Map<string, DeviceAcc>, key: string): DeviceAcc {
  const acc = map.get(key) ?? emptyDeviceAcc();
  map.set(key, acc);
  return acc;
}

function toSegmentRows(
  map: Map<string, DeviceAcc>,
  label: (key: string) => string,
): DeviceSegmentRow[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pct = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : null;
  return [...map.entries()]
    .map(([key, a]) => ({
      key,
      label: label(key),
      sessions: a.sessions,
      users: a.users,
      signups: a.signups,
      purchases: a.purchases,
      revenueUsd: r2(a.revenueUsd),
      // Per USER, never per session: a phone gets picked up far more often than
      // a laptop, so a per-session rate would rank the device people use most
      // as the device that converts worst purely for being used most.
      conversionPct: pct(a.purchases, a.users),
      refundRatePct: pct(a.refundUsd, a.revenueUsd),
    }))
    .sort((a, b) => b.sessions - a.sessions || b.users - a.users);
}

/**
 * Everything behind the Analysis → Devices tab.
 *
 * Reads from three places, each answering what only it can:
 *   - `deviceStats/{date}` — the daily session series and the viewport split.
 *     Global (no market dimension), hence `seriesAllMarkets`.
 *   - `users/{uid}.meta.device` — per-account rollups. Market-scopable, and the
 *     only source that can express "the same person on two devices", which is
 *     what every cross-device number needs.
 *   - `payments` — purchases, revenue and refunds by the device CHECKOUT
 *     happened on (`payments.device`, stamped at session creation).
 */
export async function computeDevices(opts: {
  from: number;
  to: number;
  settings: AdminSettings;
  country: string | null;
}): Promise<DeviceReport> {
  ensureAdmin();
  const { from, to, settings, country } = opts;
  const tz = country ? timezoneForCountry(country, settings.timezone) : settings.timezone;

  const [{ users, capped }, meta, revenue, eventScan, days] = await Promise.all([
    scanUsers(settings),
    fetchUserMeta(),
    fetchRevenueByUid(),
    fetchEvents(from, to),
    readDeviceDays(from, to),
  ]);

  const eventCountryByUid = new Map<string, string>();
  for (const e of eventScan.events) {
    if (e.uid && e.country && !eventCountryByUid.has(e.uid)) eventCountryByUid.set(e.uid, e.country);
  }
  const userCountry = resolveUserCountries(users, meta, eventCountryByUid, revenue);
  const inMarket = (uid: string) => !country || (userCountry.get(uid) ?? UNKNOWN_COUNTRY) === country;

  // ---- Session series + viewport split (global) ----
  const sessionTotals: Record<string, number> = {};
  const osSessions: Record<string, number> = {};
  const browserSessions: Record<string, number> = {};
  const viewportSessions: Record<string, number> = {};
  let totalSessions = 0;
  const series: DeviceSeriesPoint[] = days.map((d) => {
    totalSessions += d.sessions;
    mergeTally(sessionTotals, d.byDevice);
    mergeTally(osSessions, d.byOs);
    mergeTally(browserSessions, d.byBrowser);
    mergeTally(viewportSessions, d.byViewport);
    const sessions: Record<string, number> = {};
    for (const cls of KNOWN_DEVICE_CLASSES) sessions[cls] = d.byDevice[cls] ?? 0;
    return { day: d.date, sessions };
  });

  // ---- Per-account rollups (market-scoped) ----
  const byDevice = new Map<string, DeviceAcc>();
  const byOs = new Map<string, DeviceAcc>();
  const byBrowser = new Map<string, DeviceAcc>();
  let observedUsers = 0;
  let multiDeviceUsers = 0;

  for (const u of users) {
    if (!inMarket(u.uid)) continue;
    const d = meta.get(u.uid)?.device;
    if (!d) continue;
    observedUsers += 1;
    if (isMultiDevice(d)) multiDeviceUsers += 1;

    // Form factor: exact per-device session counts, so somebody who uses a phone
    // and a laptop contributes real sessions to both rows.
    for (const [cls, n] of Object.entries(d.counts)) {
      if (cls === "unknown") continue;
      bumpAcc(byDevice, cls).sessions += n;
    }
    const entry = entryDeviceOf(meta.get(u.uid));
    if (entry && entry !== "unknown") bumpAcc(byDevice, entry).users += 1;
    // OS/browser keep only the latest reading per account (see the field docs on
    // `DeviceSegmentRow.sessions`), so their session counts are attributed to
    // wherever the account is now.
    if (d.os && d.os !== "other") {
      const acc = bumpAcc(byOs, d.os);
      acc.users += 1;
      acc.sessions += d.sessions;
    }
    if (d.browser && d.browser !== "other") {
      const acc = bumpAcc(byBrowser, browserVersionKey({ browser: d.browser, browserMajor: d.browserMajor }));
      acc.users += 1;
      acc.sessions += d.sessions;
    }
  }

  // ---- Signups by device, from the event log ----
  for (const e of eventScan.events) {
    if (e.type !== "signup" || !e.device) continue;
    if (e.uid && !inMarket(e.uid)) continue;
    bumpAcc(byDevice, e.device).signups += 1;
    if (e.os) bumpAcc(byOs, e.os).signups += 1;
    if (e.browser) {
      bumpAcc(byBrowser, browserVersionKey({ browser: e.browser, browserMajor: e.browserMajor })).signups += 1;
    }
  }

  // ---- Purchases + revenue by checkout device ----
  const purchaseDeviceCounts: Record<string, number> = {};
  try {
    const snap = await getFirestore()
      .collection("payments")
      .where("createdAt", ">=", new Date(from))
      .where("createdAt", "<=", new Date(to))
      .orderBy("createdAt", "desc")
      .limit(MAX_PRODUCT_SCAN)
      .get();
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const status = typeof d.status === "string" ? d.status : "";
      if (!PAID_LIKE_STATUSES.has(status)) continue;
      const uid = typeof d.ownerUid === "string" ? d.ownerUid : "";
      if (uid && !inMarket(uid)) continue;
      const dev = typeof d.device === "string" ? d.device : null;
      if (!dev || dev === "unknown") continue;
      const currency = typeof d.currency === "string" ? d.currency : "USD";
      const gross = await toUsd(typeof d.amount === "number" ? d.amount : 0, currency);
      const refunded =
        typeof d.refundedAmount === "number" && d.refundedAmount > 0
          ? await toUsd(d.refundedAmount, currency)
          : 0;
      purchaseDeviceCounts[dev] = (purchaseDeviceCounts[dev] ?? 0) + 1;
      const acc = bumpAcc(byDevice, dev);
      acc.purchases += 1;
      acc.revenueUsd += gross;
      acc.refundUsd += refunded;
      const os = typeof d.deviceOs === "string" ? d.deviceOs : null;
      if (os) {
        const a = bumpAcc(byOs, os);
        a.purchases += 1;
        a.revenueUsd += gross;
        a.refundUsd += refunded;
      }
    }
  } catch {
    // Degrade to the session/user half of the report.
  }

  return {
    range: { from, to },
    timezone: tz,
    country,
    generatedAt: Date.now(),
    totals: {
      sessions: totalSessions,
      users: observedUsers,
      multiDevicePct:
        observedUsers > 0
          ? Math.round((multiDeviceUsers / observedUsers) * 1000) / 10
          : null,
    },
    series,
    byDevice: toSegmentRows(byDevice, deviceLabel),
    byOs: toSegmentRows(byOs, osLabel),
    byBrowser: toSegmentRows(byBrowser, browserVersionLabel),
    byViewport: toCountRows(viewportSessions, viewportLabel),
    crossDevice: buildCrossDevice({ users, meta, revenue, inMarket, capped }),
    hasSessionData: totalSessions > 0 || observedUsers > 0,
    seriesAllMarkets: country != null,
    capped,
  };
}

function toCountRows(
  tally: Record<string, number>,
  label: (key: string) => string,
): DeviceCountRow[] {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  return Object.entries(tally)
    .map(([key, sessions]) => ({
      key,
      label: label(key),
      sessions,
      sharePct: total > 0 ? Math.round((sessions / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

/**
 * The cross-device cohorts: group accounts by the device they signed up on and
 * report what happened next.
 *
 * The cohort window is {@link COHORT_OBSERVATION_DAYS} back from now and ignores
 * the dashboard's own range — see that constant for why. It also means this card
 * doesn't move when an admin changes the timeframe, which is worth stating in the
 * UI rather than letting them discover it.
 */
function buildCrossDevice(input: {
  users: ScannedUser[];
  meta: Map<string, UserMeta>;
  revenue: Map<string, RevenueInfo>;
  inMarket: (uid: string) => boolean;
  capped: boolean;
}): CrossDeviceReport {
  const { users, meta, revenue, inMarket, capped } = input;
  const cutoff = Date.now() - COHORT_OBSERVATION_DAYS * DAY_MS;

  interface CohortAcc {
    users: number;
    switched: number;
    lags: number[];
    paidAfterSwitch: number;
    paidSameDevice: number;
    purchaseDevices: Record<string, number>;
  }
  const acc = new Map<string, CohortAcc>();

  for (const u of users) {
    if (u.isAnonymous) continue;
    if (u.createdAt == null || u.createdAt < cutoff) continue;
    if (!inMarket(u.uid)) continue;
    const d = meta.get(u.uid)?.device;
    if (!d) continue;
    const signupDevice = d.signupDevice ?? d.firstDevice;
    if (!signupDevice || signupDevice === "unknown") continue;

    const c =
      acc.get(signupDevice) ??
      ({
        users: 0,
        switched: 0,
        lags: [],
        paidAfterSwitch: 0,
        paidSameDevice: 0,
        purchaseDevices: {},
      } satisfies CohortAcc);
    acc.set(signupDevice, c);

    c.users += 1;
    const switched = isMultiDevice(d);
    if (switched) {
      c.switched += 1;
      // Only count a lag we can actually measure. A switch we inferred from the
      // per-device counts without a timestamp (an account that predates the
      // `switchedAt` field) would otherwise contribute a zero and drag the
      // median towards "instantly", which is the opposite of the truth.
      if (d.switchedAt != null && d.switchedAt > u.createdAt) {
        c.lags.push(d.switchedAt - u.createdAt);
      }
    }
    // Lifetime revenue as the conversion test, not a purchase inside the window:
    // the question is whether this cohort EVER buys, and a purchase two months
    // after signup still answers it. Cheap, too — the scan is already loaded.
    const paid = (revenue.get(u.uid)?.total ?? 0) > 0;
    if (paid) {
      if (switched) c.paidAfterSwitch += 1;
      else c.paidSameDevice += 1;
      const on = d.purchaseDevice;
      if (on && on !== "unknown") c.purchaseDevices[on] = (c.purchaseDevices[on] ?? 0) + 1;
    }
  }

  const pct = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : null;

  const cohorts: CrossDeviceCohort[] = [...acc.entries()]
    .map(([signupDevice, c]) => {
      const stayed = c.users - c.switched;
      return {
        signupDevice,
        users: c.users,
        switched: c.switched,
        switchedPct: pct(c.switched, c.users),
        medianSwitchLagMs:
          c.lags.length > 0 ? percentile([...c.lags].sort((a, b) => a - b), 50) : null,
        paidAfterSwitch: c.paidAfterSwitch,
        paidSameDevice: c.paidSameDevice,
        conversionSwitchedPct: pct(c.paidAfterSwitch, c.switched),
        conversionSameDevicePct: pct(c.paidSameDevice, stayed),
        purchaseDevices: Object.entries(c.purchaseDevices)
          .map(([device, purchases]) => ({ device, purchases }))
          .sort((a, b) => b.purchases - a.purchases),
      };
    })
    .sort((a, b) => b.users - a.users);

  return { cohorts, observationDays: COHORT_OBSERVATION_DAYS, reliable: !capped };
}

// ---- Conversion funnel -------------------------------------------------------

/**
 * Where money leaks out of the purchase path.
 *
 * Built from the `payments` collection, which already distinguishes a checkout
 * that was STARTED (`pending`) from one that completed (`paid`) — so checkout
 * abandonment, the single most expensive drop-off in the product, is sitting in
 * data that was never queried. Signups come from the Auth scan so the funnel
 * starts at acquisition rather than at checkout.
 */
export async function computeFunnel(opts: {
  from: number;
  to: number;
  settings: AdminSettings;
  country: string | null;
  device?: DeviceFilter;
}): Promise<FunnelReport> {
  ensureAdmin();
  const { from, to, settings, country } = opts;
  const device: DeviceFilter = opts.device ?? "all";

  const [{ users }, { events }, meta, revenue] = await Promise.all([
    scanUsers(settings),
    fetchEvents(from, to),
    fetchUserMeta(),
    fetchRevenueByUid(),
  ]);
  const eventCountryByUid = new Map<string, string>();
  for (const e of events) {
    if (e.uid && e.country && !eventCountryByUid.has(e.uid)) eventCountryByUid.set(e.uid, e.country);
  }
  const userCountry = resolveUserCountries(users, meta, eventCountryByUid, revenue);
  const inMarket = (uid: string) => !country || (userCountry.get(uid) ?? UNKNOWN_COUNTRY) === country;
  /**
   * Entry-device filter, per person. This is the filter whose scoping matters
   * most: an EVENT-scoped device filter here would keep a mobile signup and drop
   * that same person's desktop purchase, so mobile would appear to convert at
   * near zero and the obvious conclusion ("mobile checkout is broken") would be
   * the opposite of what the data says.
   */
  const inDevice = (uid: string) =>
    device === "all" || entryDeviceOf(meta.get(uid)) === device;
  const included = (uid: string) => inMarket(uid) && inDevice(uid);

  let signups = 0;
  let guests = 0;
  for (const u of users) {
    if (!included(u.uid)) continue;
    if (u.isAnonymous) {
      if (u.createdAt != null && u.createdAt >= from && u.createdAt <= to) guests += 1;
    } else {
      const signupTime = meta.get(u.uid)?.signedUpAt ?? u.createdAt;
      if (signupTime != null && signupTime >= from && signupTime <= to) signups += 1;
    }
  }

  interface KindAcc {
    started: number;
    paid: number;
    failed: number;
    abandonedUsd: number;
  }
  const byKind = new Map<string, KindAcc>();
  let started = 0;
  let paid = 0;
  let fulfilled = 0;
  let abandonedCheckouts = 0;
  let abandonedUsd = 0;
  let capped = false;

  try {
    // Bounded at BOTH ends: a `>= from` scan of a historical window would spend
    // its whole cap on payments made after the window and report zero checkouts.
    const snap = await getFirestore()
      .collection("payments")
      .where("createdAt", ">=", new Date(from))
      .where("createdAt", "<=", new Date(to))
      .orderBy("createdAt", "desc")
      .limit(MAX_PRODUCT_SCAN)
      .get();
    capped = snap.size >= MAX_PRODUCT_SCAN;
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const created = tsToMillis(d.createdAt);
      if (created == null) continue;
      const uid = typeof d.ownerUid === "string" ? d.ownerUid : "";
      if (country) {
        const plan = d.fulfillment as { destinationCountry?: unknown } | null;
        const payCountry =
          normalizeCountry(d.billingCountry) ??
          normalizeCountry(plan?.destinationCountry) ??
          (uid ? userCountry.get(uid) ?? UNKNOWN_COUNTRY : UNKNOWN_COUNTRY);
        if (payCountry !== country) continue;
      }
      // Attribute the checkout to the buyer's ENTRY device, not the device the
      // checkout itself happened on — the point of the filter is to follow the
      // person, and `payments.device` (the actual checkout device) is what the
      // Devices tab reports separately.
      if (device !== "all" && (!uid || !inDevice(uid))) continue;
      const status = typeof d.status === "string" ? d.status : "pending";
      const kind = typeof d.kind === "string" ? d.kind : "order";
      const amount = typeof d.amount === "number" ? d.amount : 0;
      const currency = typeof d.currency === "string" ? d.currency : "USD";

      const k = byKind.get(kind) ?? { started: 0, paid: 0, failed: 0, abandonedUsd: 0 };
      started += 1;
      k.started += 1;
      if (status === "paid" || status === "refunded" || status === "partially_refunded") {
        paid += 1;
        k.paid += 1;
        if (d.orderId) fulfilled += 1;
      } else {
        // Pending sessions from the last hour may still complete — counting
        // them as abandoned would permanently overstate the leak.
        const settled = status === "failed" || Date.now() - created > HOUR_MS;
        if (settled) {
          abandonedCheckouts += 1;
          const usd = await toUsd(amount, currency);
          abandonedUsd += usd;
          k.abandonedUsd += usd;
        }
        if (status === "failed") k.failed += 1;
      }
      byKind.set(kind, k);
    }
  } catch {
    // Degrade to the acquisition stages only.
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pct = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : null;

  const raw: { key: string; label: string; value: number; hint?: string }[] = [
    { key: "guests", label: "Guests started", value: guests, hint: "Anonymous sessions created — everyone begins here." },
    { key: "signups", label: "Accounts created", value: signups },
    { key: "checkout", label: "Checkout started", value: started },
    { key: "paid", label: "Paid", value: paid },
    { key: "fulfilled", label: "Fulfilled", value: fulfilled, hint: "Paid orders with a print job placed." },
  ];
  const first = raw[0].value;
  const stages: FunnelStage[] = raw.map((s, i) => ({
    ...s,
    stepPct: i === 0 ? null : pct(s.value, raw[i - 1].value),
    overallPct: pct(s.value, first),
  }));

  return {
    range: { from, to },
    country,
    generatedAt: Date.now(),
    stages,
    abandonedCheckouts,
    abandonedUsd: r2(abandonedUsd),
    byKind: [...byKind.entries()]
      .map(([kind, k]) => ({
        kind,
        started: k.started,
        paid: k.paid,
        failed: k.failed,
        conversionPct: pct(k.paid, k.started),
        abandonedUsd: r2(k.abandonedUsd),
      }))
      .sort((a, b) => b.started - a.started),
    capped,
  };
}

/** Firestore Timestamp (or epoch number) → epoch ms. */
function tsToMillis(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function parseRange(req: Request): { from: number; to: number } {
  const now = Date.now();
  const to = Number(req.query.to);
  const from = Number(req.query.from);
  const safeTo = Number.isFinite(to) && to > 0 ? to : now;
  const safeFrom = Number.isFinite(from) && from > 0 ? from : safeTo - 30 * DAY_MS;
  return { from: Math.min(safeFrom, safeTo), to: Math.max(safeFrom, safeTo) };
}

const SORTS: UserSort[] = [
  "lastActive",
  "created",
  "events",
  "spend",
  "email",
  "sparks",
  "revenue",
  "plan",
];
const PLAN_FILTERS: PlanFilter[] = ["all", "paid", "free"];
const CADENCE_FILTERS: CadenceFilter[] = ["all", "month", "year"];

/**
 * The shared market filter every analysis route accepts. `?country=DE` scopes
 * the whole dashboard to one market; absent (or `all`) means every market.
 * `ZZ` is a real value — it isolates traffic we couldn't attribute.
 */
function parseCountry(req: Request): string | null {
  const raw = String(req.query.country ?? "").trim().toUpperCase();
  if (!raw || raw === "ALL") return null;
  if (raw === UNKNOWN_COUNTRY) return UNKNOWN_COUNTRY;
  return normalizeCountry(raw);
}

function parseTzMode(req: Request): TimezoneMode {
  return req.query.tzMode === "fixed" ? "fixed" : "market";
}

/**
 * The dashboard-wide entry-device filter: `?device=mobile` scopes a report to
 * people who ARRIVED on a phone — wherever they went afterwards. See
 * `DeviceFilter` for why it must not be event-scoped.
 */
function parseDevice(req: Request): DeviceFilter {
  const raw = String(req.query.device ?? "").trim().toLowerCase();
  return (DEVICE_FILTERS as string[]).includes(raw) ? (raw as DeviceFilter) : "all";
}

export function registerAnalyticsRoutes(app: Express): void {
  const json = express.json({ limit: "1mb" });

  app.get("/admin/settings", async (req: Request, res: Response) => {
    try {
      const settings = await getAdminSettings();
      const admin = (req as PermissionedRequest).admin;
      if (admin && hasPermission(admin, "analysis.users.pii", "read")) {
        res.json(settings);
        return;
      }
      // excludedEmails is a list of real addresses — mask it for anyone without
      // the PII grant, same as every other identity field on this dashboard.
      res.json({
        ...settings,
        excludedEmails: settings.excludedEmails.map((e) => maskEmail(e) ?? e),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/settings", json, async (req: Request, res: Response) => {
    try {
      const admin = (req as PermissionedRequest).admin;
      const body = { ...req.body };
      if (!admin || !hasPermission(admin, "analysis.users.pii", "read")) {
        // The GET side of this route masks excludedEmails for anyone without
        // the PII grant, so a save-back from a client that only ever saw the
        // masked list must never overwrite the real one with those masks — pin
        // it to whatever's actually stored instead of trusting the body.
        body.excludedEmails = (await getAdminSettings()).excludedEmails;
      }
      res.json(await saveAdminSettings(body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/analytics/overview", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const settings = await getAdminSettings();
      res.json(
        await computeOverview(from, to, settings, {
          country: parseCountry(req),
          tzMode: parseTzMode(req),
          device: parseDevice(req),
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // Top products — one ranking across print books, ebooks, Spark packs and
  // subscription plans, with a per-product time series and market split.
  app.get("/admin/analytics/products", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const settings = await getAdminSettings();
      const country = parseCountry(req);
      res.json(
        await computeProducts({
          from,
          to,
          tz: country ? timezoneForCountry(country, settings.timezone) : settings.timezone,
          country,
          productNames: await productDisplayNames(),
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // Acquisition → checkout → paid → fulfilled, with the abandoned-checkout
  // value the funnel is really there to expose.
  app.get("/admin/analytics/funnel", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const settings = await getAdminSettings();
      res.json(
        await computeFunnel({
          from,
          to,
          settings,
          country: parseCountry(req),
          device: parseDevice(req),
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // Device mix, per-form-factor economics, and the cross-device cohorts that
  // answer "they start on a phone — do they ever come back on a laptop, and does
  // that decide whether they buy?".
  app.get("/admin/analytics/devices", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const settings = await getAdminSettings();
      res.json(await computeDevices({ from, to, settings, country: parseCountry(req) }));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/analytics/action-costs", async (req: Request, res: Response) => {
    try {
      const granularity: CostGranularity = req.query.granularity === "hour" ? "hour" : "day";
      const now = Date.now();
      let to = Number(req.query.to);
      if (!Number.isFinite(to) || to <= 0) to = now;
      let from = Number(req.query.from);
      if (!Number.isFinite(from) || from <= 0) {
        const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
        from = to - days * DAY_MS;
      }
      // Bound the bucket count: hourly is only sensible over a short span.
      const maxSpan = granularity === "hour" ? 14 * DAY_MS : 365 * DAY_MS;
      if (to - from > maxSpan) from = to - maxSpan;
      const settings = await getAdminSettings();
      res.json(
        await computeActionCosts({ from, to, granularity, tz: settings.timezone }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/analytics/users", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const settings = await getAdminSettings();
      const sortParam = String(req.query.sort ?? "lastActive") as UserSort;
      const sort = SORTS.includes(sortParam) ? sortParam : "lastActive";
      const dir: SortDir = req.query.dir === "asc" ? "asc" : "desc";
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 50;
      const search = String(req.query.search ?? "");
      const device = parseDevice(req);
      const includeGuests = req.query.includeGuests === "true";
      const planParam = String(req.query.plan ?? "all") as PlanFilter;
      const planFilter = PLAN_FILTERS.includes(planParam) ? planParam : "all";
      const cadenceParam = String(req.query.cadence ?? "all") as CadenceFilter;
      const cadenceFilter = CADENCE_FILTERS.includes(cadenceParam) ? cadenceParam : "all";
      const admin = (req as PermissionedRequest).admin;
      const revealPii = Boolean(admin && hasPermission(admin, "analysis.users.pii", "read"));
      res.json(
        await computeUsers(from, to, settings, {
          sort,
          dir,
          limit,
          search,
          includeGuests,
          planFilter,
          cadenceFilter,
          country: parseCountry(req),
          device,
          revealPii,
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // One row's real email/name, for an owner (or an admin granted
  // `analysis.users.pii`) who needs the actual identity behind a masked row —
  // audit-logged so "who looked up whom" is always answerable.
  app.get("/admin/analytics/users/:uid/reveal", async (req: Request, res: Response) => {
    try {
      const { uid } = req.params;
      const user = await getAuth().getUser(uid);
      const actorUid = (req as PermissionedRequest).uid;
      if (actorUid) await logAudit(actorUid, "pii_reveal", uid, {});
      res.json({ uid, email: user.email ?? null, displayName: user.displayName ?? null });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Finance dashboard -----------------------------------------------------

  // The "total win" over a custom window: revenue − every cost, filterable by
  // category and drillable per user / per project. Backed by `financeEvents`.
  app.get("/admin/finance/summary", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const catParam = String(req.query.category ?? "");
      const category = (
        ["sparks", "books", "subscriptions", "waste", "infra", "ops"] as FinanceCategory[]
      ).find((c) => c === catParam);
      const uid = String(req.query.uid ?? "").trim() || undefined;
      const projectId = String(req.query.projectId ?? "").trim() || undefined;
      const productId = String(req.query.productId ?? "").trim() || undefined;
      const groupLimit = Number(req.query.groupLimit) || undefined;
      const settings = await getAdminSettings();
      const country = parseCountry(req);
      res.json(
        await financeSummary({
          fromMs: from,
          toMs: to,
          category,
          uid,
          projectId,
          productId,
          country: country ?? undefined,
          groupLimit,
          timezone: country
            ? timezoneForCountry(country, settings.timezone)
            : settings.timezone,
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // Configured-vs-actual print cost calibration: per SKU, what the product
  // cost table predicted at checkout vs what the provider actually charged.
  // The drift signal that keeps the cost table (and with it every margin and
  // safe-discount number in the planner) honest.
  app.get("/admin/finance/print-calibration", async (req: Request, res: Response) => {
    try {
      const days = Number(req.query.days) || 90;
      res.json(await printCostCalibration(days));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Projects & action runs -----------------------------------------------

  /** Read the optional books-report slicers off the query string. */
  const projectFiltersFrom = (req: Request): Partial<ProjectQuery> => {
    const str = (k: string) => String(req.query[k] ?? "").trim() || undefined;
    const int = (k: string) => {
      const raw = str(k);
      if (raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    return {
      milestoneReached: str("milestoneReached") as ProjectMilestone | undefined,
      milestoneMissing: str("milestoneMissing") as ProjectMilestone | undefined,
      imageModel: str("imageModel"),
      tier: str("tier") as ImageTier | undefined,
      artStyleKey: str("artStyleKey"),
      productSku: str("productSku"),
      ageRangeId: str("ageRangeId"),
      minPages: int("minPages"),
      maxPages: int("maxPages"),
      minCast: int("minCast"),
      maxCast: int("maxCast"),
      minImages: int("minImages"),
      maxImages: int("maxImages"),
    };
  };

  // Per-project P&L and behaviour. Joins the server-owned project mirrors with
  // one pass over the finance stream, so the table below shows what each book
  // cost us, what it earned, and how the user got there.
  app.get("/admin/projects", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const uid = String(req.query.uid ?? "").trim() || undefined;
      const limit = Number(req.query.limit) || 200;
      const allocateSubscriptions = req.query.allocateSubscriptions === "true";
      const [mirrors, finance] = await Promise.all([
        listProjectMirrors({
          uid,
          limit,
          // The window is on activity, so this reads as "books worked on in
          // this period" rather than "the most recent books, whenever".
          fromMs: from,
          toMs: to,
          ...projectFiltersFrom(req),
        }),
        projectFinanceIndex({ fromMs: from, toMs: to, uid, allocateSubscriptions }),
      ]);
      const rows = mirrors.map((m) => ({
        ...m,
        key: projectDocKey(m.uid, m.projectId),
        pnl: finance.byProject.get(projectDocKey(m.uid, m.projectId)) ?? null,
      }));
      res.json({
        projects: rows,
        // Distributions and the per-user cut are derived from the same filtered
        // set, so the three views of this page can never disagree.
        stats: summarizeProjects(mirrors, finance.byProject),
        users: summarizeUsers(mirrors, finance.byProject),
        // A full page means there is more behind it, and the distributions only
        // describe what was loaded — say so rather than implying a population.
        truncated: mirrors.length >= limit,
        unallocatedSubscriptionUsd: finance.unallocatedSubscriptionUsd,
        capped: finance.capped,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // One project in full: mirror, P&L, and the action runs behind it.
  app.get("/admin/projects/:key", async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key);
      const mirror = await getProjectMirror(key);
      if (!mirror) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      // Scoped to the book's own lifetime rather than the dashboard's timeframe:
      // opening one book means you want its whole story, and starting at its
      // creation keeps the finance scan bounded without cutting anything off.
      const from = Math.min(mirror.createdAt || Date.now(), mirror.firstActionAt || Date.now());
      const to = Date.now();
      const [finance, runs] = await Promise.all([
        projectFinanceIndex({
          fromMs: from,
          toMs: to,
          uid: mirror.uid,
          allocateSubscriptions: req.query.allocateSubscriptions === "true",
        }),
        listActionRuns({
          fromMs: from,
          toMs: to,
          uid: mirror.uid,
          projectId: mirror.projectId,
          limit: 500,
        }),
      ]);
      res.json({ project: mirror, pnl: finance.byProject.get(key) ?? null, runs });
    } catch (err) {
      handleError(res, err);
    }
  });

  // The user-call level cost log: one row per thing someone clicked, with what
  // it cost us, what we charged, and what we absorbed.
  app.get("/admin/runs", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const runs = await listActionRuns({
        fromMs: from,
        toMs: to,
        uid: String(req.query.uid ?? "").trim() || undefined,
        projectId: String(req.query.projectId ?? "").trim() || undefined,
        action: String(req.query.action ?? "").trim() || undefined,
        tier: (String(req.query.tier ?? "").trim() || undefined) as ImageTier | undefined,
        kind: (String(req.query.kind ?? "").trim() || undefined) as RunKind | undefined,
        outcome: (String(req.query.outcome ?? "").trim() || undefined) as RunOutcome | undefined,
        limit: Number(req.query.limit) || 200,
      });
      res.json({ runs });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Drill into one run: the individual provider calls it was made of.
  app.get("/admin/runs/:runId", async (req: Request, res: Response) => {
    try {
      const run = await getActionRun(String(req.params.runId));
      if (!run) {
        res.status(404).json({ error: { message: "Run not found." } });
        return;
      }
      res.json({ run, calls: await getRunCalls(run.uid, run.runId) });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Operational alerts (fulfillment failures, grant-abuse velocity, …).
  app.get("/admin/alerts", async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 100;
      res.json({ alerts: await listAlerts(limit) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/alerts/:id/resolve", json, async (req: Request, res: Response) => {
    try {
      await resolveAlert(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Manually trigger the failed-fulfillment retry sweep (also runs scheduled).
  app.post("/admin/fulfillment/retry", json, async (_req: Request, res: Response) => {
    try {
      const placed = await retryFailedFulfillments();
      res.json({ ok: true, placed });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Manually (re)import a day of infra costs — handy to backfill or to verify
  // the BigQuery billing-export connection right after configuring it.
  app.post("/admin/finance/infra/import", json, async (req: Request, res: Response) => {
    try {
      const date = typeof (req.body as { date?: unknown })?.date === "string"
        ? String((req.body as { date?: string }).date)
        : undefined;
      res.json(await importInfraCosts(date));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Custom operating costs (email service, tooling, …) — CRUD + booking.
  app.get("/admin/finance/custom-costs", async (_req: Request, res: Response) => {
    try {
      res.json({ costs: await listCustomCosts() });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/finance/custom-costs", json, async (req: Request, res: Response) => {
    try {
      const cost = await upsertCustomCost(req.body);
      // Book any already-due periods right away so the dashboard reflects the
      // new/edited cost without waiting for the nightly sweep.
      const sweep = await sweepCustomCosts();
      res.json({ cost, sweep });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/finance/custom-costs/:id", async (req: Request, res: Response) => {
    try {
      await deleteCustomCost(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Manually adjust a user's Sparks wallet (positive or negative delta). The
  // change is recorded as an immutable "adjust" ledger entry for the audit trail.
  app.post("/admin/users/:uid/sparks", json, async (req: Request, res: Response) => {
    try {
      const uid = String(req.params.uid ?? "").trim();
      if (!uid) {
        res.status(400).json({ error: { message: "Missing user id." } });
        return;
      }
      const body = (req.body ?? {}) as { delta?: unknown; reason?: unknown };
      const delta = Number(body.delta);
      if (!Number.isFinite(delta) || delta === 0) {
        res.status(400).json({ error: { message: "Provide a non-zero numeric delta." } });
        return;
      }
      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : "Admin adjustment";
      const balance = await adminAdjustSparks(uid, delta, reason);
      res.json({ uid, delta, balance });
    } catch (err) {
      handleError(res, err);
    }
  });
}
