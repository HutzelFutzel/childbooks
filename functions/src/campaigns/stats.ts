/**
 * Per-campaign daily counters and the admin report.
 *
 * Counters are per-(campaign, day) documents incremented with
 * `FieldValue.increment`, the same shape as `referralStats/{day}` — so the report
 * charts without scanning the redemption collection, and survives restarts.
 *
 * The one number here that isn't obvious is `holdoutPurchases`. Treated and
 * holdout accounts are counted separately on purpose: comparing them is the only
 * way to know whether a campaign CAUSED anything. A campaign report without a
 * control group can only ever tell you what you paid, never what you earned.
 *
 * Every write is telemetry: it must never throw back into a payment flow.
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  campaignRates,
  emptyDayStats,
  normalizeDayStats,
  totalDayStats,
  type CampaignDayStats,
  type CampaignReport,
  type CampaignStatField,
} from "../../../books-frontend/src/core/config/campaigns";
import { db, dayKey, DAY_MS, STATS } from "./store";

// The shapes and the derived rates live in the shared config module, so the admin
// dashboard reads the same definitions the engine writes.
export {
  campaignRates,
  emptyDayStats,
  normalizeDayStats,
  type CampaignDayStats,
  type CampaignRates,
  type CampaignReport,
  type CampaignStatField,
} from "../../../books-frontend/src/core/config/campaigns";

function statsId(campaignId: string, day: string): string {
  return `${campaignId.replace(/[^A-Za-z0-9_-]/g, "_")}__${day}`;
}

export async function bumpStat(
  campaignId: string,
  field: CampaignStatField,
  by = 1,
  at = Date.now(),
): Promise<void> {
  if (by === 0) return;
  try {
    const day = dayKey(at);
    await db()
      .doc(`${STATS}/${statsId(campaignId, day)}`)
      .set(
        { campaignId, day, [field]: FieldValue.increment(by), updatedAt: Date.now() },
        { merge: true },
      );
  } catch {
    // telemetry only
  }
}

/** Today's payout total for one campaign — the input to the daily breaker. */
export async function costToday(campaignId: string): Promise<number> {
  try {
    const snap = await db().doc(`${STATS}/${statsId(campaignId, dayKey())}`).get();
    const v = snap.exists ? snap.get("cost") : 0;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  } catch {
    // Fail OPEN: a stats read failure must not silently freeze all payouts.
    return 0;
  }
}

/**
 * The daily series for one campaign in range, plus totals and derived rates.
 * Day docs are tiny and the range is bounded by the dashboard, so reading them
 * by id beats a range query plus its index.
 */
export async function campaignReport(
  campaignId: string,
  from: number,
  to: number,
): Promise<CampaignReport> {
  const series: CampaignDayStats[] = [];

  const days: string[] = [];
  for (let at = from; at <= to + DAY_MS; at += DAY_MS) {
    const key = dayKey(at);
    if (!days.includes(key)) days.push(key);
    if (days.length > 400) break;
  }
  const refs = days.map((d) => db().doc(`${STATS}/${statsId(campaignId, d)}`));
  const snaps = refs.length > 0 ? await db().getAll(...refs) : [];
  snaps.forEach((snap, i) => {
    series.push(normalizeDayStats(days[i], snap.exists ? snap.data() : undefined));
  });

  const totals = totalDayStats(series);
  return { campaignId, from, to, totals, series, rates: campaignRates(totals) };
}
