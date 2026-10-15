/**
 * Order analytics — the numbers behind the admin Orders overview.
 *
 * Pure: records in, a report out. The backend feeds it the stored order records
 * (and exchange rates it looked up); the same function is what the invariants
 * run, so what the dashboard says is what was tested.
 *
 * Everything here answers one of four questions an operator actually has:
 *   - What needs me right now?                       (attention, pipeline)
 *   - Is the pipeline healthy and how fast is it?    (timing, reliability)
 *   - Is the link to the printer doing its job?      (sync)
 *   - Are we making money on these?                  (money)
 */
import {
  ATTENTION_REASON_LABEL,
  PRINT_ORDER_STATES,
  type AttentionReason,
  type PrintOrderRecord,
  type PrintOrderState,
} from "./lifecycle";

const DAY = 86_400_000;

export interface Percentiles {
  n: number;
  p50: number | null;
  p90: number | null;
}

export interface TimingBucket {
  key: string;
  label: string;
  orders: number;
  paidToPlaced: Percentiles;
  placedToShipped: Percentiles;
  paidToShipped: Percentiles;
}

export interface OrderAnalytics {
  generatedAt: number;
  windowDays: number;
  /** Orders paid inside the window. */
  orders: number;
  /** Open orders right now, whenever they were paid. */
  open: number;

  pipeline: Record<PrintOrderState, number>;

  attention: {
    count: number;
    byReason: { reason: AttentionReason; label: string; count: number }[];
    oldestMs: number | null;
  };

  throughput: { day: string; paid: number; placed: number; shipped: number; failed: number }[];

  timing: {
    overall: TimingBucket;
    byMarket: TimingBucket[];
    bySku: TimingBucket[];
  };

  reliability: {
    orders: number;
    firstTry: number;
    firstTryRate: number | null;
    needed: { retries: number; replacement: number };
    rejected: number;
    rejectionRate: number | null;
    addressCorrected: number;
    addressCorrectionRate: number | null;
    topErrors: { message: string; count: number }[];
  };

  sync: {
    viaWebhook: number;
    viaPoll: number;
    webhookShare: number | null;
    drifts: number;
  };

  emails: {
    confirmation: { sent: number; expected: number };
    shipped: { sent: number; expected: number };
    failed: { sent: number; expected: number };
    failures: number;
  };

  money: {
    currency: "USD";
    revenue: number;
    printCost: number;
    margin: number;
    marginRate: number | null;
    costBasis: { actual: number; estimated: number; missing: number };
    byMarket: { country: string; orders: number; revenue: number; printCost: number; margin: number }[];
  };
}

export interface AnalyticsOptions {
  now: number;
  windowDays: number;
  /** Destination country filter (ISO alpha-2), or null for all markets. */
  country: string | null;
  /** USD per one unit of the given currency (1 for USD). Unknown → null. */
  usdRate: (currency: string) => number | null;
  /** Human label for a destination country. */
  countryLabel?: (code: string) => string;
}

export function percentiles(values: number[]): Percentiles {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, p50: null, p90: null };
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return { n: sorted.length, p50: at(0.5), p90: at(0.9) };
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

function bucket(key: string, label: string, records: PrintOrderRecord[]): TimingBucket {
  const diff = (a: number | null, b: number | null) => (a != null && b != null && b >= a ? b - a : null);
  const collect = (from: (r: PrintOrderRecord) => number | null, to: (r: PrintOrderRecord) => number | null) =>
    records.map((r) => diff(from(r), to(r))).filter((v): v is number => v !== null);
  return {
    key,
    label,
    orders: records.length,
    paidToPlaced: percentiles(collect((r) => r.paidAt, (r) => r.placedAt)),
    placedToShipped: percentiles(collect((r) => r.placedAt, (r) => r.shippedAt)),
    paidToShipped: percentiles(collect((r) => r.paidAt, (r) => r.shippedAt)),
  };
}

/** Group an error into something countable: numbers and ids collapse, so "job 123" and "job 456" are one cause. */
export function normalizeError(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/\b(pay|job|order)_[A-Za-z0-9]+\b/g, "$1_<id>")
    .replace(/\d{3,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function computeOrderAnalytics(all: PrintOrderRecord[], opts: AnalyticsOptions): OrderAnalytics {
  const { now, windowDays } = opts;
  const since = now - windowDays * DAY;
  const label = opts.countryLabel ?? ((c: string) => c);
  const inMarket = (r: PrintOrderRecord) => !opts.country || r.destinationCountry === opts.country;
  const scoped = all.filter(inMarket);

  // "Cohort": orders paid in the window. Everything about speed and reliability is
  // measured on a cohort, so a quiet week doesn't read as a perfect one.
  const cohort = scoped.filter((r) => (r.paidAt ?? r.createdAt) >= since);
  const open = scoped.filter((r) => r.open);

  const pipeline = Object.fromEntries(PRINT_ORDER_STATES.map((s) => [s, 0])) as Record<PrintOrderState, number>;
  // Open orders are counted whenever they were paid; finished ones only within the window.
  for (const r of scoped) {
    if (r.open || (r.paidAt ?? r.createdAt) >= since) pipeline[r.state] += 1;
  }

  // ---- Attention
  const needing = scoped.filter((r) => r.needsAttention && r.attention);
  const reasons = new Map<AttentionReason, number>();
  for (const r of needing) reasons.set(r.attention!.reason, (reasons.get(r.attention!.reason) ?? 0) + 1);
  const oldest = needing.reduce<number | null>((acc, r) => {
    const age = now - r.attention!.since;
    return acc === null || age > acc ? age : acc;
  }, null);

  // ---- Throughput (per day, zero-filled so a gap reads as a gap)
  const days = new Map<string, { paid: number; placed: number; shipped: number; failed: number }>();
  for (let d = Math.min(windowDays, 120) - 1; d >= 0; d -= 1) {
    days.set(dayKey(now - d * DAY), { paid: 0, placed: 0, shipped: 0, failed: 0 });
  }
  const bump = (at: number | null, field: "paid" | "placed" | "shipped" | "failed") => {
    if (at == null) return;
    const slot = days.get(dayKey(at));
    if (slot) slot[field] += 1;
  };
  for (const r of scoped) {
    bump(r.paidAt, "paid");
    bump(r.placedAt, "placed");
    bump(r.shippedAt, "shipped");
    bump(r.failedAt ?? r.rejectedAt, "failed");
  }

  // ---- Timing: only orders that actually reached each milestone contribute.
  const byCountry = new Map<string, PrintOrderRecord[]>();
  const bySku = new Map<string, PrintOrderRecord[]>();
  for (const r of cohort) {
    const c = r.destinationCountry ?? "??";
    byCountry.set(c, [...(byCountry.get(c) ?? []), r]);
    const s = r.sku ?? "unknown";
    bySku.set(s, [...(bySku.get(s) ?? []), r]);
  }
  const buckets = (m: Map<string, PrintOrderRecord[]>, lbl: (k: string) => string) =>
    [...m.entries()]
      .map(([k, rs]) => bucket(k, lbl(k), rs))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 25);

  // ---- Reliability
  const rejectedAny = (r: PrintOrderRecord) => r.jobIds.length > 1 || r.state === "rejected" || r.autoReplacing;
  const firstTry = cohort.filter((r) => r.attempts === 0 && !rejectedAny(r) && r.state !== "failed");
  const errors = new Map<string, number>();
  for (const r of cohort) {
    if (r.lastError) {
      const k = normalizeError(r.lastError);
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
  }

  // ---- Sync
  let viaWebhook = 0;
  let viaPoll = 0;
  let drifts = 0;
  for (const r of scoped) {
    viaWebhook += r.changeSources.webhook;
    viaPoll += r.changeSources.poll;
    if (r.driftAt && r.driftAt >= since) drifts += 1;
  }

  // ---- Emails. "Expected" is what should have happened by now.
  const past = (r: PrintOrderRecord, ms: number) => now - (r.placedAt ?? r.paidAt ?? r.createdAt) > ms;
  const confirmationExpected = cohort.filter((r) => r.currentJobId && r.state !== "refunded" && past(r, 15 * 60_000));
  const shippedExpected = cohort.filter((r) => r.shippedAt && now - r.shippedAt > 15 * 60_000);
  const failedExpected = cohort.filter((r) => r.state === "failed" || r.state === "rejected");

  // ---- Money (USD). Orders whose currency we cannot convert are left out rather than guessed.
  const usd = (amount: number, currency: string): number | null => {
    const rateToUsd = opts.usdRate(currency);
    return rateToUsd == null ? null : amount * rateToUsd;
  };
  const moneyRows = cohort.filter((r) => r.paymentStatus && r.paymentStatus !== "refunded" && r.amountPaid != null);
  let revenue = 0;
  let printCost = 0;
  const basis = { actual: 0, estimated: 0, missing: 0 };
  const marketMoney = new Map<string, { orders: number; revenue: number; printCost: number }>();
  for (const r of moneyRows) {
    const rev = usd((r.amountPaid ?? 0) - (r.refundedAmount ?? 0), r.currency ?? "USD");
    if (rev == null) continue;
    const costRecord = r.actualCost ?? r.estimatedCost;
    const cost = costRecord ? usd(costRecord.amount, costRecord.currency) : null;
    if (r.actualCost && cost !== null) basis.actual += 1;
    else if (r.estimatedCost && cost !== null) basis.estimated += 1;
    else basis.missing += 1;
    revenue += rev;
    printCost += cost ?? 0;
    const c = r.destinationCountry ?? "??";
    const m = marketMoney.get(c) ?? { orders: 0, revenue: 0, printCost: 0 };
    m.orders += 1;
    m.revenue += rev;
    m.printCost += cost ?? 0;
    marketMoney.set(c, m);
  }

  return {
    generatedAt: now,
    windowDays,
    orders: cohort.length,
    open: open.length,
    pipeline,
    attention: {
      count: needing.length,
      byReason: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, label: ATTENTION_REASON_LABEL[reason], count }))
        .sort((a, b) => b.count - a.count),
      oldestMs: oldest,
    },
    throughput: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    timing: {
      overall: bucket("all", "All markets", cohort),
      byMarket: buckets(byCountry, (k) => (k === "??" ? "Unknown" : label(k))),
      bySku: buckets(bySku, (k) => k),
    },
    reliability: {
      orders: cohort.length,
      firstTry: firstTry.length,
      firstTryRate: rate(firstTry.length, cohort.length),
      needed: {
        retries: cohort.filter((r) => r.attempts > 0).length,
        replacement: cohort.filter((r) => r.jobIds.length > 1).length,
      },
      rejected: cohort.filter(rejectedAny).length,
      rejectionRate: rate(cohort.filter(rejectedAny).length, cohort.length),
      addressCorrected: cohort.filter((r) => r.addressCorrected).length,
      addressCorrectionRate: rate(cohort.filter((r) => r.addressCorrected).length, cohort.length),
      topErrors: [...errors.entries()]
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    },
    sync: {
      viaWebhook,
      viaPoll,
      webhookShare: rate(viaWebhook, viaWebhook + viaPoll),
      drifts,
    },
    emails: {
      confirmation: {
        sent: confirmationExpected.filter((r) => r.emails.confirmationAt).length,
        expected: confirmationExpected.length,
      },
      shipped: { sent: shippedExpected.filter((r) => r.emails.shippedAt).length, expected: shippedExpected.length },
      failed: { sent: failedExpected.filter((r) => r.emails.failedAt).length, expected: failedExpected.length },
      failures: cohort.filter((r) => r.emails.lastError && !/(^|: )skipped/.test(r.emails.lastError)).length,
    },
    money: {
      currency: "USD",
      revenue: round2(revenue),
      printCost: round2(printCost),
      margin: round2(revenue - printCost),
      marginRate: revenue > 0 ? (revenue - printCost) / revenue : null,
      costBasis: basis,
      byMarket: [...marketMoney.entries()]
        .map(([country, v]) => ({
          country,
          orders: v.orders,
          revenue: round2(v.revenue),
          printCost: round2(v.printCost),
          margin: round2(v.revenue - v.printCost),
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 25),
    },
  };
}
