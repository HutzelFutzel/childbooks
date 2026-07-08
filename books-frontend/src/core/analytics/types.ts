/**
 * Shared types for the admin Analysis dashboard, used by BOTH the backend
 * aggregation routes (`functions/src/analytics.ts`) and the client store/UI.
 *
 * The dashboard is fully server-computed: Firestore rules only let a user read
 * their OWN `users/{uid}/**`, so cross-user analytics can't be read from the
 * browser. The client calls `/admin/analytics/*` (Admin SDK, admin-gated) and
 * just renders the result.
 */

/** Preset windows for the time-frame toggle (plus a custom range). */
export type Timeframe = "today" | "7d" | "30d" | "custom";

/** A resolved absolute window, epoch ms. */
export interface AnalyticsRange {
  from: number;
  to: number;
}

/** One day bucket on the time-series axis. `day` is a `YYYY-MM-DD` key (in tz). */
export interface TimeSeriesPoint {
  day: string;
  signups: number;
  logins: number;
}

/** A labeled slice for a breakdown chart (e.g. signup source). */
export interface BreakdownSlice {
  key: string;
  label: string;
  value: number;
}

/** Headline counters for the selected window. */
export interface AnalyticsTotals {
  /** Non-excluded, non-anonymous accounts that exist (lifetime). */
  totalUsers: number;
  /** Guests (anonymous) currently in Auth (lifetime, non-excluded). */
  totalGuests: number;
  /** Real accounts created within the window. */
  newSignups: number;
  /** Login events recorded within the window. */
  logins: number;
  /** Real accounts active (signed in / refreshed) within the window. */
  activeUsers: number;
}

/** The full payload behind the Analysis dashboard for one window. */
export interface AnalyticsOverview {
  range: AnalyticsRange;
  timezone: string;
  /** When the server computed this (epoch ms). */
  generatedAt: number;
  totals: AnalyticsTotals;
  /** Per-day series across the window (zero-filled, ascending). */
  series: TimeSeriesPoint[];
  /** Signup source split for accounts created in the window. */
  signupSources: BreakdownSlice[];
  /** Activity matrix `[weekday 0=Sun..6=Sat][hour 0..23]` (logins + signups). */
  weekdayHour: number[][];
  /** Activity totals by weekday (0=Sun..6=Sat). */
  byWeekday: number[];
  /** Activity totals by hour (0..23). */
  byHour: number[];
  /** How many accounts the exclusion list removed from this computation. */
  excludedCount: number;
  /** True when the user scan hit its safety cap (numbers are a lower bound). */
  capped: boolean;
}

/** Billing cadence of a user's active subscription. */
export type BillingCadence = "month" | "year";

/** The economical / subscription snapshot joined onto a user row. */
export interface UserEconomics {
  /** Current Sparks wallet balance (cached), or null when unavailable. */
  sparkBalance: number | null;
  /** The user's resolved plan id (e.g. "free", "storyteller"), or null. */
  planId: string | null;
  /** Human-readable plan name (e.g. "Storyteller"), or null. */
  planName: string | null;
  /** Whether the user is on a paid (non-free) subscription. */
  isSubscribed: boolean;
  /** Billing cadence of the active subscription, or null (free / none). */
  billingCadence: BillingCadence | null;
  /** Raw subscription status (`active`, `trialing`, `past_due`, …), or null. */
  subscriptionStatus: string | null;
  /** Recurring amount in major units, or null. */
  subscriptionAmount: number | null;
  /** Currency of the recurring amount (uppercase), or null. */
  subscriptionCurrency: string | null;
  /** Lifetime gross revenue collected from this user (major units), or null. */
  revenue: number | null;
  /** Currency of the lifetime revenue (uppercase), or null. */
  revenueCurrency: string | null;
}

/** One row in the users table. */
export interface AnalyticsUserRow extends UserEconomics {
  uid: string;
  email: string | null;
  displayName: string | null;
  /** Provider the account was created with (`password`, `google.com`, `anonymous`). */
  source: string | null;
  /** Epoch ms the account was created. */
  createdAt: number | null;
  /** Epoch ms of last sign-in / token refresh. */
  lastActiveAt: number | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  /** Recorded events (logins/signups) for this user within the window. */
  events: number;
  /** Lifetime AI spend in USD, or null when unavailable. */
  spendUsd: number | null;
}

export interface AnalyticsUsersResult {
  rows: AnalyticsUserRow[];
  /** Total matching rows before the limit (for the table footer). */
  total: number;
}

export type UserSort =
  | "lastActive"
  | "created"
  | "events"
  | "spend"
  | "email"
  | "sparks"
  | "revenue"
  | "plan";
export type SortDir = "asc" | "desc";

/** Subscription-tier filter for the users table. */
export type PlanFilter = "all" | "paid" | "free";
/** Billing-cadence filter for the users table. */
export type CadenceFilter = "all" | "month" | "year";

/** Result of an admin Sparks-wallet adjustment. */
export interface SparksAdjustResult {
  uid: string;
  /** Signed delta that was applied. */
  delta: number;
  /** Resulting wallet balance after the adjustment. */
  balance: number;
}

/**
 * Persisted admin dashboard settings. Stored in the backend-only
 * `adminSettings/global` doc (denied to all clients by the security rules) and
 * read/written exclusively through `/admin/settings`.
 */
export interface AdminSettings {
  /** Exact emails to exclude from every chart/table/count (lowercased). */
  excludedEmails: string[];
  /** Email domains to exclude (without the leading `@`, lowercased). */
  excludedDomains: string[];
  /** IANA timezone used for day/weekday/hour bucketing. */
  timezone: string;
  /** Auto-refresh interval in seconds, or null to disable. */
  autoRefreshSec: number | null;
  /** Infrastructure (Firebase/GCP) cost tracking for the finance dashboard. */
  infra: InfraCostSettings;
  /** Operating-cost (custom costs) bookkeeping preferences. */
  ops: OpsCostSettings;
}

/**
 * How real Firebase / Google Cloud spend flows into the finance stream. Two
 * modes, checked in order by the daily scheduled import:
 *   1. `bigQueryTable` set — query the Cloud Billing "detailed usage cost"
 *      export in BigQuery for yesterday's spend per service (exact, automatic).
 *      Requires the billing export to be enabled to that table.
 *   2. Else `monthlyBudgetUsd` set — a daily prorated slice of the entered
 *      monthly figure is recorded instead (approximate, zero setup).
 */
export interface InfraCostSettings {
  /**
   * Fully-qualified BigQuery table of the billing export, e.g.
   * `myproject.billing_export.gcp_billing_export_v1_XXXXXX`. Null ⇒ not used.
   */
  bigQueryTable: string | null;
  /** Fallback: approximate monthly infra spend in USD, prorated daily. Null ⇒ off. */
  monthlyBudgetUsd: number | null;
}

/**
 * How admin-entered custom costs (email service, tooling subscriptions, …) are
 * booked into the finance stream.
 */
export interface OpsCostSettings {
  /**
   * True when the business is VAT-registered and reclaims input tax — custom
   * costs are then booked at their NET amount (the true economic cost); false
   * books the GROSS amount actually leaving the account. Either way both
   * figures are kept on the event for auditing.
   */
  reclaimVat: boolean;
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  excludedEmails: [],
  excludedDomains: [],
  timezone: "UTC",
  autoRefreshSec: null,
  infra: { bigQueryTable: null, monthlyBudgetUsd: null },
  ops: { reclaimVat: false },
};

/**
 * Per-action cost statistics for the admin "Cost intelligence" view, computed
 * server-side from the `users/{uid}/usage` line items (collection group). Tells
 * the admin what each AI action actually costs (avg/high/low + frequency) and
 * whether the Spark price covers the tail.
 */
export interface ActionCostStats {
  /** The LLM action id (e.g. "pageIllustration"). */
  action: string;
  /**
   * For image actions, the quality tier this row is for ("quick" / "premium"),
   * so costs are reported separately per tier. Null/absent for text actions and
   * legacy line items recorded before tiers existed.
   */
  tier?: "quick" | "premium" | null;
  /** How many calls in the window. */
  count: number;
  /** Sum of priced cost (USD). */
  totalUsd: number;
  minUsd: number;
  avgUsd: number;
  medianUsd: number;
  p90Usd: number;
  maxUsd: number;
  /** Calls with no priced model (cost unknown) — totals are a lower bound. */
  unpricedCount: number;
  /** Sparks currently charged for this action (resolved at the average cost). */
  sparkPrice: number | null;
  /** Realized margin per call: sparkPrice·sparkValue − avgUsd (null when unpriced/free). */
  marginUsd: number | null;
  /** True when the Spark price's value is below the p90 cost (losing on the tail). */
  underwaterAtP90: boolean;
}

/** Time-bucket granularity for the cost time-series. */
export type CostGranularity = "hour" | "day";

/**
 * One time bucket on the cost time-series axis. `bucket` is a sortable key:
 * `YYYY-MM-DD` (day) or `YYYY-MM-DD HH` (hour), in the admin timezone.
 */
export interface ActionCostSeriesPoint {
  bucket: string;
  /** Epoch ms at the bucket start (for ordering + label formatting). */
  ts: number;
  /** Total priced cost in the bucket (USD). */
  costUsd: number;
  /** Number of calls in the bucket. */
  count: number;
}

export interface ActionCostReport {
  /** The absolute window the report covers (epoch ms). */
  range: AnalyticsRange;
  /** Bucketing granularity of {@link series}. */
  granularity: CostGranularity;
  /** Timezone used to bucket the series. */
  timezone: string;
  /** Zero-filled, ascending cost time-series across the window. */
  series: ActionCostSeriesPoint[];
  generatedAt: number;
  /** Whether the Sparks economy is currently enabled (affects price/margin cols). */
  sparksEnabled: boolean;
  sparkValueUsd: number;
  actions: ActionCostStats[];
  totalEvents: number;
  /** Sum of all priced cost across the window (USD). */
  totalCostUsd: number;
  /** True when any scanned event had an unpriced model. */
  hasUnpriced: boolean;
  /** True when the scan hit its safety cap (numbers are a lower bound). */
  capped: boolean;
}

/** Resolve a preset/custom timeframe into an absolute window. */
export function resolveRange(
  timeframe: Timeframe,
  custom?: { from: number; to: number },
  now: number = Date.now(),
): AnalyticsRange {
  const DAY = 24 * 60 * 60 * 1000;
  if (timeframe === "custom" && custom) {
    return { from: Math.min(custom.from, custom.to), to: Math.max(custom.from, custom.to) };
  }
  if (timeframe === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now };
  }
  if (timeframe === "7d") return { from: now - 7 * DAY, to: now };
  return { from: now - 30 * DAY, to: now };
}
