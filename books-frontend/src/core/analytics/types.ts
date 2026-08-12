/**
 * Shared types for the admin Analysis dashboard, used by BOTH the backend
 * aggregation routes (`functions/src/analytics.ts`) and the client store/UI.
 *
 * The dashboard is fully server-computed: Firestore rules only let a user read
 * their OWN `users/{uid}/**`, so cross-user analytics can't be read from the
 * browser. The client calls `/admin/analytics/*` (Admin SDK, admin-gated) and
 * just renders the result.
 */
import type { BuyerFacts } from "../config/surveys";

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

/**
 * Where {@link AnalyticsTotals.activeUsers} came from.
 *
 * `events` counts distinct users in the auth event log — correct for any
 * window. `auth` is the fallback used before the blocking functions have
 * recorded anything: it tests each account's SINGLE last-sign-in stamp against
 * the window, which is fine for trailing windows but systematically undercounts
 * historical ones (a user active then AND since only carries the later stamp).
 */
export type ActiveUsersSource = "events" | "auth";

/** Which kind of activity a heatmap / hour chart is measuring. */
export type ActivityMetric = "all" | "signups" | "logins";

/**
 * How instants are mapped to a wall-clock hour.
 *
 * - `market` — every event is bucketed in ITS OWN market's timezone, so the
 *   curve reads as "what time it was for the person". The only view that means
 *   anything for a global audience.
 * - `fixed` — everything is bucketed in one zone (the selected market's, or the
 *   dashboard default). Answers operational questions like when to deploy.
 */
export type TimezoneMode = "market" | "fixed";

/** Weekday × hour activity, counted both as events and as distinct people. */
export interface ActivityGrid {
  /** `[weekday 0=Sun..6=Sat][hour 0..23]` event counts. */
  events: number[][];
  /** Same shape, distinct users — one power user can't fake a busy hour. */
  users: number[][];
  /** Marginal totals of {@link events}. */
  byWeekday: number[];
  byHour: number[];
  /** Marginal distinct-user totals (not the sum of the grid — people repeat). */
  usersByWeekday: number[];
  usersByHour: number[];
  /** Largest single cell in {@link events} (the heatmap's colour ceiling). */
  peak: number;
}

/** One market's slice of the window. */
export interface CountryActivity {
  /** ISO-3166 alpha-2, or "ZZ" when the market couldn't be derived. */
  country: string;
  /** Accounts (lifetime) whose resolved market is this one. */
  totalUsers: number;
  signups: number;
  logins: number;
  activeUsers: number;
  /** Representative IANA zone this market's local time is bucketed in. */
  timezone: string;
  /**
   * True when the market spans enough offsets that its local-time curve is
   * meaningfully smeared (the US spans six zones; Germany spans one).
   */
  timezoneApproximate: boolean;
}

/** The full payload behind the Analysis dashboard for one window. */
export interface AnalyticsOverview {
  range: AnalyticsRange;
  /** The zone the daily series and the `fixed` grids are bucketed in. */
  timezone: string;
  /** Active market filter (ISO-2), or null for "all markets". */
  country: string | null;
  /** Active entry-device filter (see {@link DeviceFilter}). */
  device: DeviceFilter;
  /** Which bucketing the returned {@link activity} grids used. */
  tzMode: TimezoneMode;
  /** When the server computed this (epoch ms). */
  generatedAt: number;
  totals: AnalyticsTotals;
  /**
   * The same counters for the immediately preceding window of equal length, so
   * every KPI can show a delta. A number with no trend isn't actionable.
   */
  previousTotals: AnalyticsTotals;
  activeUsersSource: ActiveUsersSource;
  /**
   * False when this window and the previous one measured active users by
   * different methods, which makes the delta between them meaningless.
   */
  activeUsersComparable: boolean;
  /** Per-day series across the window (zero-filled, ascending). */
  series: TimeSeriesPoint[];
  /** Signup source split for accounts created in the window. */
  signupSources: BreakdownSlice[];
  /**
   * Form-factor split of the signups in the window, from the auth event log.
   * Empty for windows that predate device capture — the event log is
   * forward-only, so an absent split means "not recorded", not "no phones".
   */
  signupDevices: BreakdownSlice[];
  /** Weekday × hour activity, per metric. */
  activity: Record<ActivityMetric, ActivityGrid>;
  /** Per-market breakdown, ranked by activity. */
  countries: CountryActivity[];
  /** How many accounts the exclusion list removed from this computation. */
  excludedCount: number;
  /** True when the user scan hit its safety cap (numbers are a lower bound). */
  capped: boolean;
  /** True when the event scan hit its cap (the series is a lower bound). */
  eventsCapped: boolean;
}

// ---- Products ---------------------------------------------------------------

/** Product families the "top products" ranking spans. */
export type ProductFamily = "print" | "ebook" | "pack" | "plan" | "other";

/** One day on a product's time-series axis. */
export interface ProductSeriesPoint {
  day: string;
  revenueUsd: number;
  netUsd: number;
  units: number;
}

/** One row in the top-products table. */
export interface ProductRow {
  /** Stable product key, e.g. `print:square-hardcover`, `plan:storyteller`. */
  productId: string;
  label: string;
  family: ProductFamily;
  /** Provider SKU (print only) — for reconciling against the provider. */
  sku: string | null;
  units: number;
  /** Money lines touching this product (a proxy for order count). */
  orders: number;
  revenueUsd: number;
  costUsd: number;
  netUsd: number;
  refundUsd: number;
  /** Refunds as a share of gross revenue — the product-quality signal. */
  refundRatePct: number | null;
  netPerUnitUsd: number | null;
  /** Net as a share of revenue. */
  marginPct: number | null;
  /** Distinct markets this product sold into. */
  countries: number;
  /** The markets that bought it most, best first. */
  topCountries: { country: string; revenueUsd: number; units: number }[];
  series: ProductSeriesPoint[];
}

export interface ProductsReport {
  range: AnalyticsRange;
  timezone: string;
  country: string | null;
  generatedAt: number;
  products: ProductRow[];
  totals: { revenueUsd: number; costUsd: number; netUsd: number; units: number; orders: number };
  capped: boolean;
}

// ---- Conversion funnel -------------------------------------------------------

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  /** Conversion from the previous stage, in %. Null for the first stage. */
  stepPct: number | null;
  /** Conversion from the first stage, in %. */
  overallPct: number | null;
  hint?: string;
}

/** Checkout conversion per payment kind (order / ebook / sparkPack / …). */
export interface FunnelKindRow {
  kind: string;
  started: number;
  paid: number;
  failed: number;
  conversionPct: number | null;
  /** Gross value of the checkouts that never completed, in USD. */
  abandonedUsd: number;
}

export interface FunnelReport {
  range: AnalyticsRange;
  country: string | null;
  generatedAt: number;
  stages: FunnelStage[];
  /** Checkout sessions started in the window that never reached `paid`. */
  abandonedCheckouts: number;
  abandonedUsd: number;
  byKind: FunnelKindRow[];
  capped: boolean;
}

// ---- Devices ----------------------------------------------------------------

/** One day on the device-mix axis. Keys are {@link DeviceClass} values. */
export interface DeviceSeriesPoint {
  day: string;
  /** Sessions per form factor, zero-filled. */
  sessions: Record<string, number>;
}

/**
 * One row of a device-dimension breakdown (form factor, OS, browser, …).
 *
 * `sessions` counts visits and `users` counts people, and the difference
 * matters: a phone that gets picked up eight times a day and a desktop that
 * gets one long sitting are the same person's two devices, not eight-to-one
 * evidence for phones. Conversion is therefore measured per USER, never per
 * session, or a chatty device looks like a failing one.
 */
export interface DeviceSegmentRow {
  /** Stable map key, e.g. `mobile`, `ios`, `safari:17`. */
  key: string;
  label: string;
  /**
   * Sessions attributed to this row.
   *
   * Exact for form factors — the per-user rollup counts sessions per form
   * factor, so a person who uses both contributes to both. For OS and browser
   * rows it's the sessions of accounts CURRENTLY on that OS/browser, since the
   * rollup keeps only the latest of each (a per-session breakdown would need the
   * event log this design deliberately doesn't keep). Close enough to rank a
   * support tail; not a number to reconcile against `sessions` totals.
   */
  sessions: number;
  /** Distinct accounts attributed to this row (by entry device / latest OS). */
  users: number;
  /** Accounts created on this dimension value, per the signup event. */
  signups: number;
  /** Completed purchases attributed to this dimension value. */
  purchases: number;
  revenueUsd: number;
  /** `purchases / users`, in %. Null when there's no denominator. */
  conversionPct: number | null;
  /** Refunds as a share of this row's gross revenue — the "broken on X" signal. */
  refundRatePct: number | null;
}

/** Sessions-only breakdown, for dimensions with no revenue attribution. */
export interface DeviceCountRow {
  key: string;
  label: string;
  sessions: number;
  /** Share of all sessions in the window, in %. */
  sharePct: number;
}

/**
 * One signup cohort's cross-device behaviour — the "started on mobile, bought on
 * desktop" question.
 *
 * Cohorts are keyed by the device the ACCOUNT WAS CREATED on and then followed
 * forwards, which is the only framing that survives the fact that people move
 * between devices: filtering events to one form factor would keep a mobile
 * signup and drop that person's desktop purchase, making mobile look like it
 * never converts.
 */
export interface CrossDeviceCohort {
  /** Form factor the account was created on. */
  signupDevice: string;
  users: number;
  /** How many were later seen on a different form factor. */
  switched: number;
  switchedPct: number | null;
  /** Median lag from signup to that first session elsewhere, in ms. */
  medianSwitchLagMs: number | null;
  /** Purchasers who switched device first, and those who never did. */
  paidAfterSwitch: number;
  paidSameDevice: number;
  /**
   * Conversion within each half of the cohort. The pair is the whole point: if
   * switchers convert far better, a low mobile conversion rate is a HANDOFF
   * problem (build "email me my draft"), not a mobile-checkout problem.
   */
  conversionSwitchedPct: number | null;
  conversionSameDevicePct: number | null;
  /** Where the money actually landed, best first. */
  purchaseDevices: { device: string; purchases: number }[];
}

export interface CrossDeviceReport {
  cohorts: CrossDeviceCohort[];
  /**
   * How long each cohort was observed after signing up, in days. Cross-device
   * behaviour plays out over weeks, so this deliberately reaches PAST the
   * dashboard's window — the only card here that does.
   */
  observationDays: number;
  /**
   * False when a scan was capped. A truncated scan biases a RATE in an unknown
   * direction (unlike a count, which is merely a lower bound), so the UI must
   * withhold these percentages rather than caveat them.
   */
  reliable: boolean;
}

/** The full payload behind the Analysis → Devices tab. */
export interface DeviceReport {
  range: AnalyticsRange;
  timezone: string;
  country: string | null;
  generatedAt: number;
  totals: {
    sessions: number;
    /** Accounts with any device observation at all (lifetime, in-market). */
    users: number;
    /** Share of those users seen on more than one form factor, in %. */
    multiDevicePct: number | null;
  };
  series: DeviceSeriesPoint[];
  byDevice: DeviceSegmentRow[];
  byOs: DeviceSegmentRow[];
  byBrowser: DeviceSegmentRow[];
  byViewport: DeviceCountRow[];
  crossDevice: CrossDeviceReport;
  /**
   * True when {@link series} and {@link byViewport} cover ALL markets while a
   * market filter is active.
   *
   * The daily session counters are global aggregates with no market dimension
   * (adding one would multiply the document count by the number of countries for
   * a breakdown that's already available per user). Everything else in this
   * report honours the filter, so the UI has to say which is which rather than
   * letting an admin read a global curve as a local one.
   */
  seriesAllMarkets: boolean;
  /**
   * False until the session beacon has recorded anything. The tab renders an
   * explanation instead of a page of zeroes, the same way the funnel explains
   * itself before the blocking functions have run.
   */
  hasSessionData: boolean;
  capped: boolean;
}

/**
 * The dashboard-wide entry-device filter.
 *
 * Deliberately ENTRY-scoped rather than event-scoped: it selects people by the
 * device they arrived on and then reports everything they did, wherever they did
 * it. An event-scoped filter would silently drop the cross-device half of every
 * funnel — see {@link CrossDeviceCohort}.
 */
export type DeviceFilter = "all" | "mobile" | "tablet" | "desktop";

export const DEVICE_FILTERS: DeviceFilter[] = ["all", "mobile", "tablet", "desktop"];

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
  /** Masked (`j***@example.com`) unless the caller holds `analysis.users.pii`. */
  email: string | null;
  /** Masked (`J. ***`) unless the caller holds `analysis.users.pii`. */
  displayName: string | null;
  /**
   * True when {@link email}/{@link displayName} above are masked. A owner (or an
   * admin granted `analysis.users.pii`) can call `POST
   * /admin/analytics/users/:uid/reveal` to fetch the real values for one row —
   * that call is itself audit-logged (see `functions/src/permissions.ts`).
   */
  piiMasked: boolean;
  /** Resolved market (ISO-2), or null when no signal was ever captured. */
  country: string | null;
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
  /**
   * Who the surveys say this person buys for, or null when they've never answered.
   *
   * The one place the profiling answers become actionable per account rather than
   * in aggregate: a segment chart tells you grandparents are worth targeting, and
   * this tells you which accounts they are.
   */
  buyer: BuyerFacts | null;
  /**
   * Form factor this account first arrived on, or null when no session has been
   * recorded for them. What the dashboard's device filter selects on.
   */
  entryDevice: string | null;
  /** Form factor of their most recent session. */
  currentDevice: string | null;
  /** True when they've been seen on more than one form factor. */
  multiDevice: boolean;
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

/**
 * The window immediately preceding `range`, of identical length — the baseline
 * every KPI delta is measured against.
 */
export function previousRange(range: AnalyticsRange): AnalyticsRange {
  const span = Math.max(1, range.to - range.from);
  return { from: range.from - span, to: range.from - 1 };
}

/** Percentage change from `before` to `after`; null when there's no baseline. */
export function deltaPct(after: number, before: number): number | null {
  if (!Number.isFinite(before) || before <= 0) return after > 0 ? null : 0;
  return Math.round(((after - before) / before) * 1000) / 10;
}
