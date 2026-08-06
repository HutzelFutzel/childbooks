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

/** One metric's shape across a set of things. */
export interface StatSummary {
  /** How many samples contributed (rows that had the metric at all). */
  count: number;
  total: number;
  avg: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

export function emptyStat(): StatSummary {
  return { count: 0, total: 0, avg: 0, median: 0, p90: 0, min: 0, max: 0 };
}

/**
 * Summarize raw values. Rounded to 2 decimals — these are counts, dollars and
 * durations read by a human, never re-used in further arithmetic.
 */
export function summarize(values: number[]): StatSummary {
  if (values.length === 0) return emptyStat();
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    count: sorted.length,
    total: r(total),
    avg: r(total / sorted.length),
    median: r(percentile(sorted, 50)),
    p90: r(percentile(sorted, 90)),
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
