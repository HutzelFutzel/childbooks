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
import { importInfraCosts } from "./infraCosts";
import { deleteCustomCost, listCustomCosts, sweepCustomCosts, upsertCustomCost } from "./customCosts";
import { priceForAction } from "../../books-frontend/src/core/config/sparks";
import {
  intervalForPriceId,
  resolvePlanByPriceId,
  type PlanDefinition,
  type PlansConfig,
} from "../../books-frontend/src/core/config/plans";
import type {
  ActionCostReport,
  ActionCostSeriesPoint,
  ActionCostStats,
  AdminSettings,
  AnalyticsOverview,
  CostGranularity,
  AnalyticsUserRow,
  AnalyticsUsersResult,
  BillingCadence,
  BreakdownSlice,
  CadenceFilter,
  PlanFilter,
  SortDir,
  TimeSeriesPoint,
  UserEconomics,
  UserSort,
} from "../../books-frontend/src/core/analytics/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Cap the Auth scan so one request can't run unbounded against a huge project. */
const MAX_USERS_SCAN = 20_000;
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
  email: string | null;
  at: number;
}

/** Fetch recorded auth events within the window (login time-series source). */
async function fetchEvents(from: number, to: number): Promise<EventRow[]> {
  ensureAdmin();
  try {
    const snap = await getFirestore()
      .collection("analyticsEvents")
      .where("at", ">=", from)
      .where("at", "<=", to)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        type: typeof data.type === "string" ? data.type : "",
        email: typeof data.email === "string" ? data.email : null,
        at: typeof data.at === "number" ? data.at : 0,
      };
    });
  } catch {
    return [];
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

/** The current cached Spark balance per uid (`users/{uid}.sparkBalance`). */
async function fetchSparkBalanceByUid(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  ensureAdmin();
  try {
    const snap = await getFirestore().collection("users").get();
    for (const doc of snap.docs) {
      const v = (doc.data() as { sparkBalance?: unknown }).sparkBalance;
      if (typeof v === "number" && Number.isFinite(v)) out.set(doc.id, v);
    }
  } catch {
    // ignore — degrade to no balances
  }
  return out;
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
}

/** Lifetime gross revenue per uid from the admin `payments` collection. */
async function fetchRevenueByUid(): Promise<Map<string, RevenueInfo>> {
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
      const prev = out.get(uid) ?? { total: 0, currency };
      prev.total += amount;
      if (!prev.currency) prev.currency = currency;
      out.set(uid, prev);
    }
  } catch {
    // ignore — degrade to no revenue
  }
  return out;
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

/** Day/weekday/hour for an instant in the given IANA timezone. */
function tzParts(at: number, tz: string): { dayKey: string; weekday: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(new Date(at));
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(new Date(at));
  }
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

async function computeOverview(
  from: number,
  to: number,
  settings: AdminSettings,
): Promise<AnalyticsOverview> {
  const tz = settings.timezone;
  const [{ users, excludedCount, capped }, events] = await Promise.all([
    scanUsers(settings),
    fetchEvents(from, to),
  ]);

  const dayKeys = dayKeysBetween(from, to, tz);
  const seriesMap = new Map<string, TimeSeriesPoint>();
  for (const day of dayKeys) seriesMap.set(day, { day, signups: 0, logins: 0 });

  const weekdayHour = emptyMatrix();
  const byWeekday = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  const sources = new Map<string, number>();

  let totalUsers = 0;
  let totalGuests = 0;
  let newSignups = 0;
  let activeUsers = 0;

  for (const u of users) {
    if (u.isAnonymous) totalGuests += 1;
    else totalUsers += 1;

    // Signups within the window (retroactive, from Auth creationTime).
    if (u.createdAt != null && u.createdAt >= from && u.createdAt <= to) {
      const p = tzParts(u.createdAt, tz);
      const point = seriesMap.get(p.dayKey);
      if (point && !u.isAnonymous) point.signups += 1;
      if (!u.isAnonymous) newSignups += 1;
      sources.set(u.source, (sources.get(u.source) ?? 0) + 1);
      // Signups also count as activity for the heatmap.
      weekdayHour[p.weekday][p.hour] += 1;
      byWeekday[p.weekday] += 1;
      byHour[p.hour] += 1;
    }

    if (!u.isAnonymous && u.lastActiveAt != null && u.lastActiveAt >= from && u.lastActiveAt <= to) {
      activeUsers += 1;
    }
  }

  // Logins from the event log (forward-only) feed the series + heatmap.
  let logins = 0;
  for (const e of events) {
    if (e.type !== "login") continue;
    logins += 1;
    const p = tzParts(e.at, tz);
    const point = seriesMap.get(p.dayKey);
    if (point) point.logins += 1;
    weekdayHour[p.weekday][p.hour] += 1;
    byWeekday[p.weekday] += 1;
    byHour[p.hour] += 1;
  }

  const signupSources: BreakdownSlice[] = Array.from(sources.entries())
    .map(([key, value]) => ({ key, label: sourceLabel(key), value }))
    .sort((a, b) => b.value - a.value);

  return {
    range: { from, to },
    timezone: tz,
    generatedAt: Date.now(),
    totals: { totalUsers, totalGuests, newSignups, logins, activeUsers },
    series: dayKeys.map((d) => seriesMap.get(d)!),
    signupSources,
    weekdayHour,
    byWeekday,
    byHour,
    excludedCount,
    capped,
  };
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
  },
): Promise<AnalyticsUsersResult> {
  const [{ users }, events, spendByUid, sparkByUid, subByUid, revenueByUid, plans] =
    await Promise.all([
      scanUsers(settings),
      fetchEvents(from, to),
      fetchSpendByUid(),
      fetchSparkBalanceByUid(),
      fetchSubscriptionByUid(),
      fetchRevenueByUid(),
      getPlansConfig(),
    ]);

  const eventsByEmail = new Map<string, number>();
  for (const e of events) {
    if (!e.email) continue;
    eventsByEmail.set(e.email, (eventsByEmail.get(e.email) ?? 0) + 1);
  }

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
      const economics: UserEconomics = {
        sparkBalance: sparkByUid.has(u.uid) ? sparkByUid.get(u.uid)! : null,
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
        email: u.email,
        displayName: u.displayName,
        source: u.source,
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt,
        emailVerified: u.emailVerified,
        isAnonymous: u.isAnonymous,
        events: u.email ? eventsByEmail.get(u.email.toLowerCase()) ?? 0 : 0,
        spendUsd: spendByUid.has(u.uid) ? spendByUid.get(u.uid)! : null,
        ...economics,
      } satisfies AnalyticsUserRow;
    })
    .filter((row) => {
      if (opts.planFilter === "paid" && !row.isSubscribed) return false;
      if (opts.planFilter === "free" && row.isSubscribed) return false;
      if (opts.cadenceFilter !== "all" && row.billingCadence !== opts.cadenceFilter) return false;
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
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

export function registerAnalyticsRoutes(app: Express): void {
  const json = express.json({ limit: "1mb" });

  app.get("/admin/settings", async (_req: Request, res: Response) => {
    try {
      res.json(await getAdminSettings());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/settings", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveAdminSettings(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/analytics/overview", async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const settings = await getAdminSettings();
      res.json(await computeOverview(from, to, settings));
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
      const includeGuests = req.query.includeGuests === "true";
      const planParam = String(req.query.plan ?? "all") as PlanFilter;
      const planFilter = PLAN_FILTERS.includes(planParam) ? planParam : "all";
      const cadenceParam = String(req.query.cadence ?? "all") as CadenceFilter;
      const cadenceFilter = CADENCE_FILTERS.includes(cadenceParam) ? cadenceParam : "all";
      res.json(
        await computeUsers(from, to, settings, {
          sort,
          dir,
          limit,
          search,
          includeGuests,
          planFilter,
          cadenceFilter,
        }),
      );
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
      const groupLimit = Number(req.query.groupLimit) || undefined;
      res.json(await financeSummary({ fromMs: from, toMs: to, category, uid, projectId, groupLimit }));
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
