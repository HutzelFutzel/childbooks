/**
 * Daily device aggregates (`deviceStats/{YYYY-MM-DD}`) — shared shapes.
 *
 * WHY AN AGGREGATE AND NOT AN EVENT LOG
 * -------------------------------------
 * A row per session would answer marginally more questions and cost a great
 * deal more in three separate currencies: Firestore writes, a collection that
 * grows forever with no natural pruning point, and — the one that actually
 * decides it — privacy. A per-session row tying a form factor, an OS, a browser
 * version and a timestamp to a uid is a behavioural log; the same numbers rolled
 * into daily counters are a statistic. Since every question the dashboard asks
 * ("what's the device mix", "is it moving", "does mobile convert") is answerable
 * from counters, there's no reason to keep the log.
 *
 * Per-USER device facts live on `users/{uid}.meta.device` as a fixed-size rollup
 * (see `core/profile/types.ts`), which is what makes the cross-device cohorts
 * computable without an event log. These daily docs only carry the time series.
 *
 * Every breakdown is a low-cardinality map, deliberately: form factors are a
 * closed set of four, OS and browser families are closed sets, and browser
 * versions are MAJOR-ONLY. Nothing here should ever be keyed by something a
 * client controls the shape of — that's how an aggregate doc grows past the 1 MB
 * limit and how a bounded dimension turns into a fingerprint.
 */

/** Per-day counters. Written only by the backend (Admin SDK). */
export interface DeviceDayStats {
  version: 1;
  /** UTC day key, `YYYY-MM-DD`. Also the document id. */
  date: string;
  /** Sessions started on this day (server-derived, 30-minute idle gap). */
  sessions: number;
  /** Sessions by form factor: mobile / tablet / desktop / unknown. */
  byDevice: Record<string, number>;
  /** Sessions by OS family. */
  byOs: Record<string, number>;
  /** Sessions by browser family. */
  byBrowser: Record<string, number>;
  /** Sessions by `family:major`, e.g. `safari:17` — the support-tail signal. */
  byBrowserVersion: Record<string, number>;
  /** Sessions by viewport bucket. Sparse: needs analytics consent to be sent. */
  byViewport: Record<string, number>;
  /**
   * Completed purchases, by the form factor checkout was started on.
   *
   * Signups have no counterpart here on purpose: they're already stamped on
   * `analyticsEvents`, which is both retroactively queryable per market and the
   * source the rest of the dashboard's signup numbers come from. A second tally
   * would only be a second thing to disagree.
   */
  purchasesByDevice: Record<string, number>;
  /** Gross revenue (USD) by the form factor checkout was started on. */
  revenueUsdByDevice: Record<string, number>;
  updatedAt: number;
}

/**
 * Cap on any single breakdown map. Every dimension here is a closed set well
 * under this, so hitting it means something started writing an unbounded key —
 * in which case losing the long tail is the correct failure mode.
 */
export const MAX_DEVICE_MAP_KEYS = 200;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_DEVICE_MAP_KEYS) break;
    const count = num(val);
    if (count > 0 && k) {
      out[String(k).slice(0, 60)] = count;
      n += 1;
    }
  }
  return out;
}

export function createDefaultDeviceDayStats(date = ""): DeviceDayStats {
  return {
    version: 1,
    date,
    sessions: 0,
    byDevice: {},
    byOs: {},
    byBrowser: {},
    byBrowserVersion: {},
    byViewport: {},
    purchasesByDevice: {},
    revenueUsdByDevice: {},
    updatedAt: 0,
  };
}

export function normalizeDeviceDayStats(input: unknown, date?: string): DeviceDayStats {
  const s = (input ?? {}) as Partial<DeviceDayStats>;
  return {
    version: 1,
    date: (date ?? (typeof s.date === "string" ? s.date : "")).slice(0, 10),
    sessions: num(s.sessions),
    byDevice: numMap(s.byDevice),
    byOs: numMap(s.byOs),
    byBrowser: numMap(s.byBrowser),
    byBrowserVersion: numMap(s.byBrowserVersion),
    byViewport: numMap(s.byViewport),
    purchasesByDevice: numMap(s.purchasesByDevice),
    revenueUsdByDevice: numMap(s.revenueUsdByDevice),
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
  };
}