/**
 * Small distribution helpers shared by the admin reports.
 *
 * Totals alone hide the thing you usually want to know: "the average book has 8
 * pages" is useless if half of them have 2 and one has 60. Every behavioural
 * number in the project/user reports is therefore published as a distribution
 * (avg + median + p90 + max) rather than a single figure.
 */

/**
 * Nearest-rank percentile over an ASCENDING-sorted array. Callers sort once and
 * ask for several percentiles.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * One metric's shape across a set of things.
 *
 * Defined in `core/analytics/types.ts` because it crosses the wire: the client
 * renders these verbatim, and a second declaration is a second thing to forget to
 * update when a field is added.
 */
export type { StatSummary } from "../../books-frontend/src/core/analytics/types";
import type { StatSummary } from "../../books-frontend/src/core/analytics/types";

export function emptyStat(): StatSummary {
  return { count: 0, total: 0, avg: 0, p25: 0, median: 0, p75: 0, p90: 0, p95: 0, min: 0, max: 0 };
}

/**
 * Summarize raw values. Rounded to 2 decimals by default — these are counts,
 * dollars and durations read by a human, never re-used in further arithmetic.
 * Pass more `digits` for values that are fractions of a cent (cost per page).
 */
export function summarize(values: number[], digits = 2): StatSummary {
  if (values.length === 0) return emptyStat();
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const scale = 10 ** digits;
  const r = (n: number) => Math.round(n * scale) / scale;
  return {
    count: sorted.length,
    total: r(total),
    avg: r(total / sorted.length),
    p25: r(percentile(sorted, 25)),
    median: r(percentile(sorted, 50)),
    p75: r(percentile(sorted, 75)),
    p90: r(percentile(sorted, 90)),
    p95: r(percentile(sorted, 95)),
    min: r(sorted[0]),
    max: r(sorted[sorted.length - 1]),
  };
}

/** Safe ratio: returns 0 rather than NaN/Infinity on an empty denominator. */
export function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

/** The highest-count key of a tally (ties broken by name, for stable output). */
export function topKey(tally: Record<string, number>): string | null {
  const entries = Object.entries(tally);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Add every key of `src` into `dest` in place. */
export function mergeTally(dest: Record<string, number>, src?: Record<string, number>): void {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (typeof v === "number") dest[k] = (dest[k] ?? 0) + v;
  }
}
