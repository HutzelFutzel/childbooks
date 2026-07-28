/**
 * Daily KPI digest — one Slack message per day (evening) with the headline
 * numbers: signups, logins, active users, revenue, orders, funnel leakage and
 * open alerts for the day that just ended.
 *
 * Reuses the exact same computations the admin Analysis dashboard uses
 * (`computeOverview`, `computeFunnel` in analytics.ts; `financeSummary` in
 * finance.ts) rather than re-deriving numbers from the raw collections, so the
 * digest can never drift from what the dashboard shows for the same window.
 *
 * Best-effort like every other Slack notification in this codebase: a failure
 * here must never do anything worse than a missing/late Slack message (see
 * `notify.ts`). On failure we also raise an admin alert so a silent outage
 * doesn't go unnoticed forever.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "./storage";
import { SLACK_WEBHOOK_URL } from "./secrets";
import { getAdminSettings } from "./adminSettings";
import { computeOverview, computeFunnel } from "./analytics";
import { financeSummary } from "./finance";
import { listAlerts, raiseAlert, type AdminAlert } from "./alerts";
import { notifySlack } from "./notify";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offset (ms) to ADD to a UTC instant to get the wall-clock reading in `tz`. */
function tzOffsetMs(atUtcMs: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(atUtcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asIfUtc - atUtcMs;
  } catch {
    return 0; // Unknown/unsupported zone — degrade to UTC rather than throw.
  }
}

/** Epoch ms for local midnight of `dateKey` ("YYYY-MM-DD") in `tz`. */
function localMidnightMs(dateKey: string, tz: string): number {
  const guess = new Date(`${dateKey}T00:00:00Z`).getTime();
  // One correction pass is enough for a once-a-day job — a DST transition
  // landing exactly on this boundary is a rare, acceptable rounding edge.
  return guess - tzOffsetMs(guess, tz);
}

/** "YYYY-MM-DD" key `daysAgo` days before today, read in `tz`. */
function dayKeyDaysAgo(daysAgo: number, tz: string): string {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysAgo)).toISOString().slice(0, 10);
}

/** [from, to) epoch bounds of one full local calendar day in `tz`. */
function localDayRange(dayKey: string, tz: string): { from: number; to: number } {
  const from = localMidnightMs(dayKey, tz);
  return { from, to: from + DAY_MS };
}

function pctChange(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? " (new)" : "";
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return "";
  return ` (${pct > 0 ? "+" : ""}${pct}% vs prior day)`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Sum of `.count` across every finance `byKind` row matching `kind`. */
function kindCount(byKind: { kind: string; count: number }[], kind: string): number {
  return byKind.filter((k) => k.kind === kind).reduce((sum, k) => sum + k.count, 0);
}

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** Build the Slack message text for one day's KPIs. Exported for testing. */
export async function buildDailySummaryText(dayKey: string, tz: string): Promise<string> {
  const settings = await getAdminSettings();
  const { from, to } = localDayRange(dayKey, tz);

  const [overview, funnel, finance, alerts] = await Promise.all([
    computeOverview(from, to, settings, { country: null, tzMode: "fixed" }),
    computeFunnel({ from, to, settings, country: null }),
    financeSummary({ fromMs: from, toMs: to, timezone: tz, groupLimit: 5 }),
    listAlerts(200),
  ]);

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(from + 12 * 60 * 60 * 1000));

  const alertsToday = alerts.filter((a: AdminAlert) => a.at >= from && a.at < to);
  const unresolvedToday = alertsToday.filter((a) => !a.resolvedAt);

  const printOrders = kindCount(finance.byKind, "printRevenue");
  const ebookOrders = kindCount(finance.byKind, "ebookRevenue");
  const packOrders = kindCount(finance.byKind, "packRevenue");
  const subPayments = kindCount(finance.byKind, "subscriptionRevenue");
  const refundRows = finance.byKind.filter((k) => k.kind === "refund");
  const refundCount = refundRows.reduce((s, k) => s + k.count, 0);
  const refundUsd = refundRows.reduce((s, k) => s + k.costUsd, 0);

  const topCountry = overview.countries.find((c) => c.signups > 0 || c.activeUsers > 0);

  const lines: string[] = [];
  lines.push(`📊 *Daily summary — ${dayLabel}*`);
  lines.push(
    `👤 Signups: ${overview.totals.newSignups}${pctChange(overview.totals.newSignups, overview.previousTotals.newSignups)}` +
      `   🔑 Logins: ${overview.totals.logins}` +
      `   🟢 Active users: ${overview.totals.activeUsers}`,
  );

  const revenueBits = [`gross ${usd(finance.totalRevenueUsd)}`];
  if (refundCount > 0) revenueBits.push(`${plural(refundCount, "refund")} ${usd(refundUsd)}`);
  lines.push(`💰 Net revenue: ${usd(finance.netUsd)} (${revenueBits.join(", ")})`);

  const orderBits: string[] = [];
  if (printOrders) orderBits.push(`${plural(printOrders, "print order")}`);
  if (ebookOrders) orderBits.push(`${plural(ebookOrders, "ebook")}`);
  if (packOrders) orderBits.push(`${plural(packOrders, "Spark pack")}`);
  if (subPayments) orderBits.push(`${plural(subPayments, "subscription payment")}`);
  if (orderBits.length > 0) lines.push(`🛒 Orders: ${orderBits.join(" · ")}`);

  if (funnel.abandonedCheckouts > 0) {
    lines.push(
      `🚧 Abandoned checkouts: ${funnel.abandonedCheckouts} (${usd(funnel.abandonedUsd)} left on the table)`,
    );
  }

  if (topCountry) {
    lines.push(
      `🌍 Top market: ${topCountry.country} — ${plural(topCountry.signups, "signup")}, ${topCountry.activeUsers} active`,
    );
  }

  if (alertsToday.length > 0) {
    lines.push(`⚠️ Alerts: ${alertsToday.length} (${unresolvedToday.length} unresolved)`);
  }

  return lines.join("\n");
}

/**
 * Runs once a day in the evening. Defaults to 20:00 UTC — adjust the cron
 * expression / `timeZone` below to your own business evening (the KPI window
 * itself always uses the admin-configured `adminSettings.timezone`, so the
 * numbers are calendar-day-correct regardless of when the job fires).
 */
export const sendDailySummary = onSchedule(
  {
    schedule: "0 20 * * *",
    timeZone: "UTC",
    timeoutSeconds: 120,
    secrets: [SLACK_WEBHOOK_URL],
  },
  async () => {
    ensureAdmin();
    try {
      const settings = await getAdminSettings();
      const dayKey = dayKeyDaysAgo(1, settings.timezone);
      const text = await buildDailySummaryText(dayKey, settings.timezone);
      const result = await notifySlack({
        channel: "growth",
        messageKey: "daily_summary",
        ref: `daily_${dayKey}`,
        text,
      });
      if (result.sent) logger.info(`[daily-summary] posted summary for ${dayKey}`);
      else logger.info(`[daily-summary] skipped for ${dayKey}: ${result.reason}`);
    } catch (err) {
      logger.error("[daily-summary] failed", err);
      await raiseAlert({
        severity: "warning",
        kind: "dailySummary.failed",
        message: `Daily KPI summary failed to build/send: ${(err as Error)?.message ?? "unknown error"}`,
        ref: dayKeyDaysAgo(1, "UTC"),
      }).catch(() => {});
    }
  },
);
