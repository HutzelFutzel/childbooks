/**
 * Per-coupon daily counters, rejection tallies, and the admin report.
 *
 * Same shape as `campaignStats/{cid}__{day}`: per-(coupon, day) documents
 * incremented with `FieldValue.increment`, so the report charts without scanning
 * the redemption collection.
 *
 * The field that isn't obvious is the rejection tally. Counting WHY codes bounce
 * is the difference between two indistinguishable failures: a code nobody has
 * (zero attempts) and a code everybody has but whose cap is spent (thousands of
 * attempts, all `coupon_exhausted`). Without it, both look like "no redemptions"
 * and the operator has no idea whether to reprint the poster or raise the cap.
 *
 * Every write here is telemetry: it must never throw back into a payment flow.
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  couponRates,
  emptyCouponDayStats,
  normalizeCouponDayStats,
  describeRejection,
  totalCouponDayStats,
  type Coupon,
  type CouponDayStats,
  type CouponReport,
  type CouponRejectionReason,
  type CouponStatField,
} from "../../../books-frontend/src/core/config/coupons";
import { COUNTERS, db, dayKey, DAY_MS, safeId, STATS, statsId } from "./store";

export async function bumpStat(
  couponId: string,
  field: CouponStatField,
  by = 1,
  at = Date.now(),
): Promise<void> {
  if (by === 0 || !couponId) return;
  try {
    const day = dayKey(at);
    await db()
      .doc(`${STATS}/${statsId(couponId, day)}`)
      .set(
        { couponId, day, [field]: FieldValue.increment(by), updatedAt: Date.now() },
        { merge: true },
      );
  } catch {
    // telemetry only
  }
}

/** Bump several fields on one day document in a single write. */
export async function bumpStats(
  couponId: string,
  fields: Partial<Record<CouponStatField, number>>,
  at = Date.now(),
): Promise<void> {
  if (!couponId) return;
  const entries = Object.entries(fields).filter(([, by]) => typeof by === "number" && by !== 0);
  if (entries.length === 0) return;
  try {
    const day = dayKey(at);
    const patch: Record<string, unknown> = { couponId, day, updatedAt: Date.now() };
    for (const [field, by] of entries) patch[field] = FieldValue.increment(by as number);
    await db().doc(`${STATS}/${statsId(couponId, day)}`).set(patch, { merge: true });
  } catch {
    // telemetry only
  }
}

/**
 * Record why an attempt was refused.
 *
 * Stored on the coupon's counter document as a `rejections.{reason}` map rather
 * than per-day, because the operator's question ("why is this code bouncing?")
 * is about the coupon's whole life, and a per-day map would multiply document
 * count for no extra insight.
 *
 * An unknown code has no coupon to attribute to, so those land under the
 * synthetic `__unknown` key — which is itself a useful signal, since a spike
 * there means someone is guessing at codes.
 */
export async function recordRejection(
  couponId: string | null,
  reason: CouponRejectionReason,
): Promise<void> {
  try {
    const id = couponId ? safeId(couponId) : "__unknown";
    await db()
      .doc(`${COUNTERS}/${id}`)
      .set(
        {
          couponId: couponId ?? "",
          rejections: { [reason]: FieldValue.increment(1) },
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    if (couponId) await bumpStat(couponId, "rejected", 1);
  } catch {
    // telemetry only
  }
}

export interface CouponCounters {
  redeemed: number;
  discount: number;
  revenue: number;
  rejections: Partial<Record<CouponRejectionReason, number>>;
}

export async function readCounters(couponId: string): Promise<CouponCounters> {
  const empty: CouponCounters = { redeemed: 0, discount: 0, revenue: 0, rejections: {} };
  try {
    const snap = await db().doc(`${COUNTERS}/${safeId(couponId)}`).get();
    if (!snap.exists) return empty;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const raw = (snap.get("rejections") ?? {}) as Record<string, unknown>;
    const rejections: Partial<Record<CouponRejectionReason, number>> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (n(value) > 0) rejections[key as CouponRejectionReason] = n(value);
    }
    return {
      redeemed: n(snap.get("redeemed")),
      discount: n(snap.get("discount")),
      revenue: n(snap.get("revenue")),
      rejections,
    };
  } catch {
    return empty;
  }
}

/** Today's discount spend for one coupon — the input to the daily breaker. */
export async function discountToday(couponId: string): Promise<number> {
  try {
    const snap = await db().doc(`${STATS}/${statsId(couponId, dayKey())}`).get();
    const v = snap.exists ? snap.get("discount") : 0;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  } catch {
    // Fail OPEN: a stats read failure must not silently freeze every coupon.
    return 0;
  }
}

/**
 * The daily series for one coupon in range, plus totals, derived rates, the
 * rejection breakdown, and what's left of its caps.
 *
 * "What's left" is computed here rather than in the UI because it's the number
 * an operator acts on — a coupon with 3 uses left before a printed poster stops
 * working needs to be visible as such, not derivable from two other columns.
 */
export async function couponReport(
  coupon: Coupon,
  from: number,
  to: number,
): Promise<CouponReport> {
  const days: string[] = [];
  for (let at = from; at <= to + DAY_MS; at += DAY_MS) {
    const key = dayKey(at);
    if (!days.includes(key)) days.push(key);
    if (days.length > 400) break;
  }
  const refs = days.map((d) => db().doc(`${STATS}/${statsId(coupon.id, d)}`));
  const [snaps, counters] = await Promise.all([
    refs.length > 0 ? db().getAll(...refs) : Promise.resolve([]),
    readCounters(coupon.id),
  ]);
  const series: CouponDayStats[] = snaps.map((snap, i) =>
    normalizeCouponDayStats(days[i], snap.exists ? snap.data() : undefined),
  );
  const totals =
    series.length > 0 ? totalCouponDayStats(series) : emptyCouponDayStats("total");

  const rejections = Object.entries(counters.rejections)
    .map(([reason, count]) => ({
      reason: reason as CouponRejectionReason,
      count: count ?? 0,
      label: describeRejection(reason as CouponRejectionReason),
    }))
    .sort((a, b) => b.count - a.count);

  const { maxRedemptions, lifetimeBudget } = coupon.restrictions;
  return {
    couponId: coupon.id,
    from,
    to,
    totals,
    series,
    rates: couponRates(totals),
    rejections,
    // Against the LIFETIME counter, not the windowed total: a cap is a cap
    // whether it was spent inside the report's date range or before it.
    remainingRedemptions:
      maxRedemptions > 0 ? Math.max(0, maxRedemptions - counters.redeemed) : null,
    remainingBudget:
      lifetimeBudget > 0
        ? Math.max(0, Math.round((lifetimeBudget - counters.discount) * 100) / 100)
        : null,
  };
}
