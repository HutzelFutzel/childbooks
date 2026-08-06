/** Formatting helpers shared across the Analysis dashboard. */

const numberFmt = new Intl.NumberFormat();

export function fmtNumber(n: number): string {
  return numberFmt.format(n);
}

export function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

/** Money in a given currency (e.g. "$24.99", "€99.00"), or em-dash when null. */
export function fmtMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Sparks balance (integer-ish), or em-dash when null. */
export function fmtSparks(n: number | null): string {
  if (n == null) return "—";
  return numberFmt.format(Math.round(n));
}

/** Short absolute date for a `YYYY-MM-DD` day key (e.g. "Jun 3"). */
export function fmtDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Date + time for an epoch ms, or em-dash when null. */
export function fmtDateTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Coarse relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function fmtRelative(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** A duration in ms as the coarsest unit that still reads precisely. */
export function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

/** A 0–1 ratio as a percentage. */
export function fmtPct(ratio: number | null, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** `YYYY-MM-DD` for a date input, in local time. */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A short source/provider label (mirrors the backend mapping). */
export function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  if (source === "password") return "Email";
  if (source === "google.com") return "Google";
  if (source === "anonymous") return "Guest";
  return source;
}
