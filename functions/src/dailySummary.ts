/**
 * Daily KPI digest — one Slack message per day (evening) with the headline
 * numbers: signups, guests, logins, active users, revenue (+ refund rate),
 * orders, top product, checkout conversion, unfulfilled paid orders, funnel
 * leakage and open alerts since the last digest.
 *
 * Reuses the exact same computations the admin Analysis dashboard uses
 * (`computeOverview`, `computeFunnel` in analytics.ts; `financeSummary` in
 * finance.ts) rather than re-deriving numbers from the raw collections, so the
 * digest can never drift from what the dashboard shows for the same window.
 *
 * The window is a persisted watermark (`adminState/dailySummary.coveredThroughMs`),
 * not "yesterday relative to whenever this run happens to fire". That matters
 * because this job is best-effort like every other Slack notification here
 * (see `notify.ts`) — a cold start, a transient Slack error or a bad deploy can
 * skip a run outright. A window computed purely from "now" would silently and
 * permanently drop that day from the digest (the dashboard itself is
 * unaffected — only what got reported in Slack). Anchoring to the watermark
 * instead means the NEXT successful run just reports everything since the
 * LAST successful one, however long that turns out to be, so nothing sent
 * through Slack is ever lost — only delayed.
 *
 * On failure we also raise an admin alert so a silent outage doesn't go
 * unnoticed forever, and the watermark is left untouched so the same
 * uncovered range is retried (and grows) until it's actually reported.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { SLACK_WEBHOOK_URL } from "./secrets";
import { getAdminSettings } from "./adminSettings";
import { computeOverview, computeFunnel } from "./analytics";
import { financeSummary } from "./finance";
import { listAlerts, raiseAlert, type AdminAlert } from "./alerts";
import { notifySlack } from "./notify";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Safety valve on how far back a single digest will ever reach, even if the
 * watermark is very stale (a long outage, the toggle left off for weeks, …).
 * Past this, older history is dropped from the NEXT message (with a visible
 * note) rather than trying to summarize an unbounded window in one Slack post.
 */
const MAX_CATCHUP_MS = 14 * DAY_MS;

const STATE_DOC = "adminState/dailySummary";

/** Epoch ms through which the digest has already reported, or null if it has
 * never successfully sent (first run ever). */
async function getCoveredThroughMs(): Promise<number | null> {
  try {
    ensureAdmin();
    const snap = await getFirestore().doc(STATE_DOC).get();
    const v = snap.exists ? snap.get("coveredThroughMs") : null;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null; // Degrade to the one-day fallback in the scheduler below.
  }
}

/** Advance the watermark. Only called once a window has actually been
 * accounted for (sent, or already claimed by an earlier attempt). */
async function setCoveredThroughMs(ms: number): Promise<void> {
  try {
    ensureAdmin();
    await getFirestore()
      .doc(STATE_DOC)
      .set({ coveredThroughMs: ms, updatedAt: Date.now() }, { merge: true });
  } catch (err) {
    // If this write fails, the next run just re-covers the same ground — a
    // possible duplicate post (caught by the `ref` idempotency key below)
    // beats silently forgetting where we left off.
    logger.error("[daily-summary] failed to persist watermark", err);
  }
}

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

/**
 * Human label for [from, to). A window that lines up with a single local
 * calendar day (the normal, nightly case) reads as just that date; a wider
 * catch-up window (a missed run) reads as the date range it actually spans.
 */
function formatRangeLabel(from: number, to: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
  const start = fmt.format(new Date(from));
  const end = fmt.format(new Date(Math.max(from, to - 1)));
  return start === end ? start : `${start} – ${end}`;
}

function pctChange(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? " (new)" : "";
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return "";
  return ` (${pct > 0 ? "+" : ""}${pct}% vs prior period)`;
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

/** `num` as a share of `den`, formatted as a whole-number percentage. */
function pctOf(num: number, den: number): string | null {
  if (!(den > 0)) return null;
  return `${Math.round((num / den) * 100)}%`;
}

/** A finance `productId` (e.g. `print:square-hardcover`) as a display label. */
function productLabel(key: string): string {
  const slug = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * Build the Slack message text for [from, to). Exported for testing.
 *
 * `note`, when set, is rendered as its own line right under the header — used
 * by the scheduler below to call out a catch-up window so it's obvious in
 * Slack (not just in the logs) that a run was missed and this message is
 * covering more than one day.
 */
export async function buildDailySummaryText(
  range: { from: number; to: number },
  tz: string,
  opts: { note?: string } = {},
): Promise<string> {
  const { from, to } = range;
  const settings = await getAdminSettings();

  const [overview, funnel, finance, alerts] = await Promise.all([
    computeOverview(from, to, settings, { country: null, tzMode: "fixed" }),
    computeFunnel({ from, to, settings, country: null }),
    financeSummary({ fromMs: from, toMs: to, timezone: tz, groupLimit: 5 }),
    listAlerts(200),
  ]);

  const dayLabel = formatRangeLabel(from, to, tz);

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
  const guestsStarted = funnel.stages.find((s) => s.key === "guests")?.value ?? 0;
  const paidStage = funnel.stages.find((s) => s.key === "paid");
  const fulfilledStage = funnel.stages.find((s) => s.key === "fulfilled");
  const unfulfilledPaid = Math.max(0, (paidStage?.value ?? 0) - (fulfilledStage?.value ?? 0));
  const topProduct = finance.byProduct[0];
  const capped = overview.capped || overview.eventsCapped || finance.capped || funnel.capped;

  const lines: string[] = [];
  lines.push(`📊 *Daily summary — ${dayLabel}*`);
  if (opts.note) lines.push(opts.note);
  if (capped) {
    lines.push("⚠️ _One or more scans hit their safety cap — some numbers below are a lower bound._");
  }
  lines.push(
    `👤 Signups: ${overview.totals.newSignups}${pctChange(overview.totals.newSignups, overview.previousTotals.newSignups)}` +
      `   🕶️ Guests: ${guestsStarted}` +
      `   🔑 Logins: ${overview.totals.logins}` +
      `   🟢 Active users: ${overview.totals.activeUsers}`,
  );

  const revenueBits = [`gross ${usd(finance.totalRevenueUsd)}`];
  if (refundCount > 0) {
    const rate = pctOf(refundUsd, finance.totalRevenueUsd);
    revenueBits.push(`${plural(refundCount, "refund")} ${usd(refundUsd)}${rate ? ` (${rate} of gross)` : ""}`);
  }
  lines.push(`💰 Net revenue: ${usd(finance.netUsd)} (${revenueBits.join(", ")})`);

  const orderBits: string[] = [];
  if (printOrders) orderBits.push(`${plural(printOrders, "print order")}`);
  if (ebookOrders) orderBits.push(`${plural(ebookOrders, "ebook")}`);
  if (packOrders) orderBits.push(`${plural(packOrders, "Spark pack")}`);
  if (subPayments) orderBits.push(`${plural(subPayments, "subscription payment")}`);
  if (orderBits.length > 0) lines.push(`🛒 Orders: ${orderBits.join(" · ")}`);

  if (topProduct && (topProduct.revenueUsd > 0 || topProduct.units > 0)) {
    lines.push(
      `🏆 Top product: ${productLabel(topProduct.key)} — ${usd(topProduct.netUsd)} net (${plural(topProduct.units, "unit")})`,
    );
  }

  if (paidStage && paidStage.stepPct != null) {
    lines.push(`🎯 Checkout → paid: ${paidStage.stepPct}%${unfulfilledPaid > 0 ? ` · ⚙️ ${plural(unfulfilledPaid, "paid order")} unfulfilled` : ""}`);
  }

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
 * itself always uses the admin-configured `adminSettings.timezone`, and is
 * anchored to the watermark rather than to when this fires — see the file
 * header comment).
 *
 * The upper bound is always the most recent local midnight (`adminSettings.
 * timezone`) at or before "now", not "now" itself — so the digest only ever
 * reports on complete calendar days, and two back-to-back runs tile exactly
 * (no gap, no overlap) as long as each one succeeds. The lower bound is the
 * watermark left by the last successful send, so a missed run just makes the
 * next message cover more days instead of dropping the missed one.
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
    let to = 0;
    try {
      const settings = await getAdminSettings();
      to = localMidnightMs(dayKeyDaysAgo(0, settings.timezone), settings.timezone);

      const coveredThrough = await getCoveredThroughMs();
      let from = coveredThrough ?? to - DAY_MS;
      let note: string | undefined;
      if (to - from > MAX_CATCHUP_MS) {
        // Very stale watermark (long outage, toggle left off for weeks, …).
        // Report what we can and say so, rather than trying to summarize an
        // unbounded window in one Slack post.
        from = to - MAX_CATCHUP_MS;
        note = `⚠️ _Watermark was very stale — showing only the last ${Math.round(MAX_CATCHUP_MS / DAY_MS)} days._`;
      } else if (to - from > DAY_MS * 1.5) {
        const days = Math.round((to - from) / DAY_MS);
        note = `⏳ _Catching up ${days} days since the last summary — nothing lost._`;
      }

      if (to <= from) {
        logger.info("[daily-summary] nothing new since the last summary — skipping");
        return;
      }

      const text = await buildDailySummaryText({ from, to }, settings.timezone, { note });
      const result = await notifySlack({
        channel: "growth",
        messageKey: "daily_summary",
        ref: `daily_${from}_${to}`,
        text,
      });
      // Advance the watermark whenever this exact window is accounted for —
      // either we just sent it, or an earlier attempt already claimed it
      // (`duplicate`). Any other reason (disabled/not configured/error)
      // leaves the watermark where it was, so the same uncovered range is
      // retried — and grows — until it's actually reported.
      if (result.sent || result.reason === "duplicate") {
        await setCoveredThroughMs(to);
      }
      const range = `${new Date(from).toISOString()} → ${new Date(to).toISOString()}`;
      if (result.sent) logger.info(`[daily-summary] posted summary for ${range}`);
      else logger.info(`[daily-summary] skipped (${result.reason}) for ${range}`);
    } catch (err) {
      logger.error("[daily-summary] failed", err);
      await raiseAlert({
        severity: "warning",
        kind: "dailySummary.failed",
        message: `Daily KPI summary failed to build/send: ${(err as Error)?.message ?? "unknown error"}`,
        ref: to ? String(to) : dayKeyDaysAgo(1, "UTC"),
      }).catch(() => {});
    }
  },
);
