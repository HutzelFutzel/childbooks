/**
 * Aggregate **email delivery statistics**, kept in the world-readable
 * `appConfig/emailStats` document and surfaced on the admin dashboard.
 *
 * Mirrors `latencyStats` / `imageCostStats`: the backend appends counts as
 * emails are sent and as ZeptoMail webhooks report outcomes (delivered / opened
 * / clicked / bounced / complained / unsubscribed). Only aggregate counters are
 * stored — never per-recipient data.
 *
 * Three views are maintained:
 *   - `totals`    — lifetime-in-window counters
 *   - `templates` — the same counters, per template id
 *   - `daily`     — per-day (UTC `YYYY-MM-DD`) counters, capped to a window
 */
import { EMAIL_EVENT_TYPES, type EmailEventType } from "../email/types";

/** How many days of daily buckets to retain. */
export const EMAIL_DAILY_WINDOW = 60;

export type EmailEventCounts = Record<EmailEventType, number>;

export interface EmailStats {
  version: 1;
  totals: EmailEventCounts;
  /** Keyed by template id. */
  templates: Record<string, EmailEventCounts>;
  /** Keyed by UTC `YYYY-MM-DD`, capped to {@link EMAIL_DAILY_WINDOW} newest. */
  daily: Record<string, EmailEventCounts>;
  /** Last time each template was sent (epoch ms), keyed by template id. */
  lastSentAt: Record<string, number>;
  updatedAt: number;
}

export function zeroCounts(): EmailEventCounts {
  return {
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
    complained: 0,
    unsubscribed: 0,
  };
}

export function createDefaultEmailStats(): EmailStats {
  return {
    version: 1,
    totals: zeroCounts(),
    templates: {},
    daily: {},
    lastSentAt: {},
    updatedAt: 0,
  };
}

/** UTC day key for a timestamp, e.g. "2026-07-07". */
export function dayKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

function normalizeCounts(input: unknown): EmailEventCounts {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out = zeroCounts();
  for (const type of EMAIL_EVENT_TYPES) {
    const n = raw[type];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[type] = Math.round(n);
  }
  return out;
}

/** Keep only the newest N daily buckets (by date key). */
function capDaily(daily: Record<string, EmailEventCounts>): Record<string, EmailEventCounts> {
  const keys = Object.keys(daily).sort(); // ISO dates sort lexically
  if (keys.length <= EMAIL_DAILY_WINDOW) return daily;
  const keep = keys.slice(keys.length - EMAIL_DAILY_WINDOW);
  const out: Record<string, EmailEventCounts> = {};
  for (const k of keep) out[k] = daily[k];
  return out;
}

export function normalizeEmailStats(input: unknown): EmailStats {
  const raw = (input ?? {}) as Partial<EmailStats>;
  const templates: Record<string, EmailEventCounts> = {};
  const tin = (raw.templates ?? {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(tin)) templates[id] = normalizeCounts(v);

  const daily: Record<string, EmailEventCounts> = {};
  const din = (raw.daily ?? {}) as Record<string, unknown>;
  for (const [d, v] of Object.entries(din)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) daily[d] = normalizeCounts(v);
  }

  const lastSentAt: Record<string, number> = {};
  const lin = (raw.lastSentAt ?? {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(lin)) {
    if (typeof v === "number" && Number.isFinite(v)) lastSentAt[id] = v;
  }

  return {
    version: 1,
    totals: normalizeCounts(raw.totals),
    templates,
    daily: capDaily(daily),
    lastSentAt,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

export interface EmailEventInput {
  templateId: string;
  type: EmailEventType;
  /** Increment amount (default 1). */
  count?: number;
  /** Event time (defaults to now) — decides the daily bucket + lastSentAt. */
  at?: number;
}

/**
 * Append one event to every view. Pure — returns a new stats object. Unknown
 * template ids are tolerated (bucketed under their id) so a late-arriving
 * webhook for a since-removed template never throws.
 */
export function appendEmailEvent(stats: EmailStats, e: EmailEventInput): EmailStats {
  const at = e.at ?? Date.now();
  const inc = Math.max(0, Math.round(e.count ?? 1));
  if (inc === 0) return stats;
  const type = e.type;

  const totals = { ...stats.totals, [type]: (stats.totals[type] ?? 0) + inc };

  const tPrev = stats.templates[e.templateId] ?? zeroCounts();
  const templates = {
    ...stats.templates,
    [e.templateId]: { ...tPrev, [type]: (tPrev[type] ?? 0) + inc },
  };

  const dk = dayKey(at);
  const dPrev = stats.daily[dk] ?? zeroCounts();
  const daily = capDaily({
    ...stats.daily,
    [dk]: { ...dPrev, [type]: (dPrev[type] ?? 0) + inc },
  });

  const lastSentAt =
    type === "sent" ? { ...stats.lastSentAt, [e.templateId]: at } : stats.lastSentAt;

  return { version: 1, totals, templates, daily, lastSentAt, updatedAt: at };
}

/** Sum a subset of daily buckets within the last `days` (inclusive of today). */
export function sumRecentDays(stats: EmailStats, days: number, nowMs = Date.now()): EmailEventCounts {
  const out = zeroCounts();
  const cutoff = dayKey(nowMs - (days - 1) * 86_400_000);
  for (const [d, counts] of Object.entries(stats.daily)) {
    if (d < cutoff) continue;
    for (const type of EMAIL_EVENT_TYPES) out[type] += counts[type] ?? 0;
  }
  return out;
}

/** Count of `sent` events for a UTC day (used for the daily send cap). */
export function sentOnDay(stats: EmailStats, atMs = Date.now()): number {
  return stats.daily[dayKey(atMs)]?.sent ?? 0;
}
