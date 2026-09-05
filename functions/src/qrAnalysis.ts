/**
 * Tracked-QR acquisition analysis.
 *
 * A scan is anonymous telemetry. It becomes an identified arrival only after a
 * signed-in account offers the QR token back to the server, and it becomes a
 * coupon conversion only when a grant sourced from that token settles. Keeping
 * those stages separate is essential: dividing "people" by raw scan events is a
 * useful directional rate, but it is not a unique-device conversion rate.
 *
 * This report joins existing source-of-truth records instead of adding a second
 * analytics write path:
 *   - `qrScans` for scan events and their UTC daily series,
 *   - `users.*.acquisition` for identified and first-touch accounts,
 *   - `couponGrants.source` for QR-attributed entitlements,
 *   - `couponRedemptions` for paid uses of those grants.
 *
 * Defensive caps keep an admin request bounded. The payload names every cap so
 * the UI can call affected values lower bounds instead of displaying fiction.
 */
import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getCouponsConfig, getQrCodesConfig } from "./appConfig";
import { qrScanStats } from "./acquisition";
import { normalizeGrant, normalizeRedemption } from "./coupons/store";
import {
  arrivalToken,
  matchesArrival,
  normalizeAcquisitionProfile,
} from "../../books-frontend/src/core/profile/acquisition";
import type {
  QrAnalysisCode,
  QrAnalysisDay,
  QrAnalysisLifetimeTotals,
  QrAnalysisRates,
  QrAnalysisReport,
  QrAnalysisWindowTotals,
} from "../../books-frontend/src/core/config/qrCodes";

const DAY_MS = 86_400_000;
const MAX_USERS = 20_000;
const MAX_GRANTS = 20_000;
const MAX_REDEMPTIONS = 50_000;

function db() {
  ensureAdmin();
  return getFirestore();
}

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function emptyMoney(): Record<string, number> {
  return {};
}

function emptyWindow(): QrAnalysisWindowTotals {
  return {
    scans: 0,
    firstTouchAccounts: 0,
    couponGrants: 0,
    couponRedemptions: 0,
    orderValueByCurrency: emptyMoney(),
    discountByCurrency: emptyMoney(),
  };
}

function emptyLifetime(): QrAnalysisLifetimeTotals {
  return {
    scans: 0,
    identifiedAccounts: 0,
    firstTouchAccounts: 0,
    couponGrants: 0,
    couponRedemptions: 0,
  };
}

function emptyDay(day: string): QrAnalysisDay {
  return { day, ...emptyWindow() };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addMoney(target: Record<string, number>, currency: string, amount: number): void {
  const key = currency.trim().toUpperCase() || "UNKNOWN";
  target[key] = round2((target[key] ?? 0) + amount);
}

function addWindow(target: QrAnalysisWindowTotals, source: QrAnalysisWindowTotals): void {
  target.scans += source.scans;
  target.firstTouchAccounts += source.firstTouchAccounts;
  target.couponGrants += source.couponGrants;
  target.couponRedemptions += source.couponRedemptions;
  for (const [currency, amount] of Object.entries(source.orderValueByCurrency)) {
    addMoney(target.orderValueByCurrency, currency, amount);
  }
  for (const [currency, amount] of Object.entries(source.discountByCurrency)) {
    addMoney(target.discountByCurrency, currency, amount);
  }
}

function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : null;
}

function rates(
  totals: QrAnalysisWindowTotals,
  lifetime: QrAnalysisLifetimeTotals,
): QrAnalysisRates {
  return {
    scanToIdentifiedPct: pct(lifetime.identifiedAccounts, lifetime.scans),
    scanToGrantPct: pct(totals.couponGrants, totals.scans),
    grantToRedemptionPct: pct(totals.couponRedemptions, totals.couponGrants),
  };
}

function dayKeys(from: number, to: number): string[] {
  const keys: string[] = [];
  const first = Date.parse(`${dayKey(from)}T00:00:00.000Z`);
  for (let at = first; at <= to; at += DAY_MS) {
    keys.push(dayKey(at));
    if (keys.length >= 400) break;
  }
  return keys;
}

function inWindow(at: number, from: number, to: number): boolean {
  return at >= from && at <= to;
}

function cappedDocs(
  docs: QueryDocumentSnapshot[],
  cap: number,
): { docs: QueryDocumentSnapshot[]; capped: boolean } {
  return { docs: docs.slice(0, cap), capped: docs.length > cap };
}

/**
 * Build the complete QR report for one bounded window and the equally-sized
 * window immediately before it.
 */
export async function qrAnalysisReport(rawFrom: number, rawTo: number): Promise<QrAnalysisReport> {
  const now = Date.now();
  const to = Math.min(Number.isFinite(rawTo) ? rawTo : now, now);
  // Scan telemetry exists per UTC day, not per event. Align the requested
  // window to whole day buckets so "Last 30d" is exactly 30 rows and the first
  // day is not counted in both current and previous comparisons.
  const proposedFrom = Number.isFinite(rawFrom) ? rawFrom : to - 30 * DAY_MS;
  const requestedDays = Math.min(366, Math.max(1, Math.ceil((to - proposedFrom) / DAY_MS)));
  const todayStart = Date.parse(`${dayKey(to)}T00:00:00.000Z`);
  const from = todayStart - (requestedDays - 1) * DAY_MS;
  const previousTo = from - 1;
  const previousFrom = from - requestedDays * DAY_MS;
  const currentDays = dayKeys(from, to);
  const previousDays = new Set(dayKeys(previousFrom, previousTo));
  const currentDaySet = new Set(currentDays);

  const [qrConfig, couponsConfig, userSnap, grantSnap, redemptionSnap] = await Promise.all([
    getQrCodesConfig(),
    getCouponsConfig(),
    db().collection("users").select("acquisition").limit(MAX_USERS + 1).get(),
    db()
      .collection("couponGrants")
      .where("source", ">=", "qr:")
      .where("source", "<", "qr;")
      .limit(MAX_GRANTS + 1)
      .get(),
    db()
      .collection("couponRedemptions")
      .where("settledAt", ">=", previousFrom)
      .where("settledAt", "<=", to)
      .orderBy("settledAt", "desc")
      .limit(MAX_REDEMPTIONS + 1)
      .get(),
  ]);

  const tracked = qrConfig.codes.filter((code) => code.tracked);
  const tokens = new Map(tracked.map((code) => [arrivalToken("qr", code.id), code.id]));
  const [scanMap, users, grants, redemptions] = await Promise.all([
    qrScanStats(tracked.map((code) => code.id)),
    Promise.resolve(cappedDocs(userSnap.docs, MAX_USERS)),
    Promise.resolve(cappedDocs(grantSnap.docs, MAX_GRANTS)),
    Promise.resolve(cappedDocs(redemptionSnap.docs, MAX_REDEMPTIONS)),
  ]);

  const codes = new Map<
    string,
    QrAnalysisCode & {
      identifiedUids: Set<string>;
      firstTouchUids: Set<string>;
    }
  >();
  for (const code of tracked) {
    const token = arrivalToken("qr", code.id);
    const linkedCoupons = couponsConfig.coupons
      .filter(
        (coupon) =>
          coupon.issuance === "autoGrant" &&
          coupon.audience.arrivedVia.length > 0 &&
          matchesArrival([token], coupon.audience.arrivedVia),
      )
      .map((coupon) => ({ id: coupon.id, name: coupon.name, status: coupon.status }));
    const series = currentDays.map(emptyDay);
    codes.set(code.id, {
      qrId: code.id,
      name: code.name,
      destination: code.data,
      updatedAt: code.updatedAt,
      lastScanAt: scanMap[code.id]?.lastScanAt ?? 0,
      linkedCoupons,
      totals: emptyWindow(),
      previousTotals: emptyWindow(),
      lifetime: emptyLifetime(),
      rates: { scanToIdentifiedPct: null, scanToGrantPct: null, grantToRedemptionPct: null },
      series,
      identifiedUids: new Set(),
      firstTouchUids: new Set(),
    });
  }

  // Scans are already aggregated by UTC day, so no document scan is needed.
  for (const code of codes.values()) {
    const stats = scanMap[code.qrId];
    code.lifetime.scans = stats?.scans ?? 0;
    for (const [day, count] of Object.entries(stats?.daily ?? {})) {
      if (currentDaySet.has(day)) {
        code.totals.scans += count;
        const point = code.series.find((row) => row.day === day);
        if (point) point.scans += count;
      } else if (previousDays.has(day)) {
        code.previousTotals.scans += count;
      }
    }
  }

  // Account profiles preserve every token ever seen, plus first/latest details.
  // Only `first` has immutable timing semantics, so the daily funnel reports
  // first-touch accounts and the lifetime card reports any identified account.
  const identifiedOverall = new Set<string>();
  const firstTouchOverall = new Set<string>();
  for (const doc of users.docs) {
    const profile = normalizeAcquisitionProfile(doc.get("acquisition"));
    for (const [token, qrId] of tokens) {
      if (!profile.tokens.includes(token)) continue;
      const code = codes.get(qrId);
      if (!code) continue;
      code.identifiedUids.add(doc.id);
      identifiedOverall.add(doc.id);
    }
    const first = profile.first;
    const qrId = first ? tokens.get(first.token) : undefined;
    const code = qrId ? codes.get(qrId) : undefined;
    if (!first || !code) continue;
    code.firstTouchUids.add(doc.id);
    firstTouchOverall.add(doc.id);
    if (inWindow(first.at, from, to)) {
      code.totals.firstTouchAccounts += 1;
      const point = code.series.find((row) => row.day === dayKey(first.at));
      if (point) point.firstTouchAccounts += 1;
    } else if (inWindow(first.at, previousFrom, previousTo)) {
      code.previousTotals.firstTouchAccounts += 1;
    }
  }

  // A grant's source is the exact arrival that created it, even when its coupon
  // matched the broad `qr` audience. Keep a lookup for attributing redemptions.
  const sourceByGrant = new Map<string, string>();
  for (const doc of grants.docs) {
    const grant = normalizeGrant(doc.id, doc.data());
    const qrId = tokens.get(grant.source);
    const code = qrId ? codes.get(qrId) : undefined;
    if (!code) continue;
    sourceByGrant.set(`${grant.uid}\u0000${grant.couponId}`, qrId!);
    code.lifetime.couponGrants += 1;
    code.lifetime.couponRedemptions += grant.redeemedCount;
    if (inWindow(grant.grantedAt, from, to)) {
      code.totals.couponGrants += 1;
      const point = code.series.find((row) => row.day === dayKey(grant.grantedAt));
      if (point) point.couponGrants += 1;
    } else if (inWindow(grant.grantedAt, previousFrom, previousTo)) {
      code.previousTotals.couponGrants += 1;
    }
  }

  for (const doc of redemptions.docs) {
    const redemption = normalizeRedemption(doc.id, doc.data());
    if (redemption.status !== "redeemed" || !redemption.settledAt) continue;
    const qrId = sourceByGrant.get(`${redemption.uid}\u0000${redemption.couponId}`);
    const code = qrId ? codes.get(qrId) : undefined;
    if (!code) continue;
    const target = inWindow(redemption.settledAt, from, to)
      ? code.totals
      : inWindow(redemption.settledAt, previousFrom, previousTo)
        ? code.previousTotals
        : null;
    if (!target) continue;
    target.couponRedemptions += 1;
    addMoney(target.orderValueByCurrency, redemption.currency, redemption.originalSubtotal);
    addMoney(target.discountByCurrency, redemption.currency, redemption.discountAmount);
    if (target === code.totals) {
      const point = code.series.find((row) => row.day === dayKey(redemption.settledAt!));
      if (point) {
        point.couponRedemptions += 1;
        addMoney(point.orderValueByCurrency, redemption.currency, redemption.originalSubtotal);
        addMoney(point.discountByCurrency, redemption.currency, redemption.discountAmount);
      }
    }
  }

  const totalWindow = emptyWindow();
  const totalPrevious = emptyWindow();
  const totalLifetime = emptyLifetime();
  const overallSeries = currentDays.map(emptyDay);
  const serializableCodes: QrAnalysisCode[] = [];
  for (const code of codes.values()) {
    code.lifetime.identifiedAccounts = code.identifiedUids.size;
    code.lifetime.firstTouchAccounts = code.firstTouchUids.size;
    code.rates = rates(code.totals, code.lifetime);
    addWindow(totalWindow, code.totals);
    addWindow(totalPrevious, code.previousTotals);
    totalLifetime.scans += code.lifetime.scans;
    totalLifetime.couponGrants += code.lifetime.couponGrants;
    totalLifetime.couponRedemptions += code.lifetime.couponRedemptions;
    code.series.forEach((point, index) => addWindow(overallSeries[index], point));
    const { identifiedUids: _identified, firstTouchUids: _first, ...row } = code;
    serializableCodes.push(row);
  }
  totalLifetime.identifiedAccounts = identifiedOverall.size;
  totalLifetime.firstTouchAccounts = firstTouchOverall.size;

  serializableCodes.sort(
    (a, b) =>
      b.totals.scans - a.totals.scans ||
      b.totals.couponRedemptions - a.totals.couponRedemptions ||
      a.name.localeCompare(b.name),
  );

  return {
    from,
    to,
    previousFrom,
    previousTo,
    generatedAt: Date.now(),
    trackedCodes: tracked.length,
    untrackedCodes: qrConfig.codes.length - tracked.length,
    totals: totalWindow,
    previousTotals: totalPrevious,
    lifetime: totalLifetime,
    rates: rates(totalWindow, totalLifetime),
    series: overallSeries,
    codes: serializableCodes,
    capped: {
      users: users.capped,
      grants: grants.capped,
      redemptions: redemptions.capped,
    },
  };
}
