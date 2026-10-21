/**
 * Client store for the admin Finance dashboard ("total win").
 *
 * Backed by the admin-gated `/admin/finance/summary` route, which aggregates
 * the server-side finance events stream (every revenue/cost fact: pack &
 * subscription & print revenue, provider costs, print costs, Stripe fees,
 * refunds, Spark grants/spends, failures). Supports a custom window, a
 * category filter ("sparks-total", "books-total", …) and per-user/per-project
 * drill-down. Also owns the operational alerts feed + the manual fulfillment
 * retry trigger.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import { marketParam } from "./adminMarketStore";
import { resolveRange, type Timeframe } from "../core/analytics/types";

export type FinanceCategoryFilter =
  | "all"
  | "sparks"
  | "books"
  | "subscriptions"
  | "waste"
  | "infra"
  | "ops";

export type CustomCostCadence = "once" | "monthly" | "yearly";

/** Admin-entered operating cost (email service, tooling, …). */
export interface CustomCostRow {
  id: string;
  title: string;
  description: string;
  slug: string;
  /** GROSS amount per period in `currency`. */
  amount: number;
  currency: string;
  taxRatePct: number;
  cadence: CustomCostCadence;
  firstChargeAt: number;
  endAt: number | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CustomCostInput {
  id?: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  taxRatePct?: number;
  cadence: CustomCostCadence;
  firstChargeAt: number;
  endAt?: number | null;
  active?: boolean;
}

export interface FinanceKindRow {
  category: string;
  kind: string;
  revenueUsd: number;
  costUsd: number;
  netUsd: number;
  count: number;
  sparks: number;
}

export interface FinanceGroupRow {
  key: string;
  revenueUsd: number;
  costUsd: number;
  netUsd: number;
  count: number;
}

/** One market's contribution over the window. */
export interface FinanceCountryRow extends FinanceGroupRow {
  units: number;
  refundUsd: number;
  buyers: number;
}

/** One product's contribution over the window. */
export interface FinanceProductRow extends FinanceGroupRow {
  sku: string | null;
  units: number;
  refundUsd: number;
  netPerUnitUsd: number | null;
  countries: number;
}

export interface FinanceSeriesPoint {
  day: string;
  revenueUsd: number;
  costUsd: number;
  netUsd: number;
  units: number;
}

export interface FinanceSummaryData {
  fromMs: number;
  toMs: number;
  capped: boolean;
  eventCount: number;
  totalRevenueUsd: number;
  totalCostUsd: number;
  netUsd: number;
  byCategory: Record<string, { revenueUsd: number; costUsd: number; netUsd: number; count: number }>;
  byKind: FinanceKindRow[];
  byUser: FinanceGroupRow[];
  byProject: FinanceGroupRow[];
  byCountry: FinanceCountryRow[];
  byProduct: FinanceProductRow[];
  series: FinanceSeriesPoint[];
}

export interface AdminAlertRow {
  id: string;
  at: number;
  severity: "info" | "warning" | "critical";
  kind: string;
  message: string;
  resolvedAt: number | null;
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

/**
 * How long a loaded summary / alerts list counts as current. Within this window
 * re-opening the dashboard or switching tabs reuses what's in memory instead of
 * re-running the server-side aggregation; "Refresh" always bypasses it.
 */
const FRESH_FOR_MS = 30_000;

/** Calls sharing one in-flight request instead of racing each other. */
let summaryInFlight: { key: string; promise: Promise<void>; token: object } | null = null;
let alertsInFlight: Promise<void> | null = null;
/** Bumped per request so a slow older response can never overwrite a newer one. */
let summarySeq = 0;

interface RefreshOpts {
  /** Skip the freshness window (an explicit "Refresh", or after a write that changes the numbers). */
  force?: boolean;
}

interface AdminFinanceState {
  timeframe: Timeframe;
  customFrom: number;
  customTo: number;
  category: FinanceCategoryFilter;
  /** Optional drill-down filters (empty = everyone / all projects). */
  uid: string;
  projectId: string;

  summary: FinanceSummaryData | null;
  /** What the loaded `summary` was computed for (window + filters + market). */
  summaryKey: string | null;
  alerts: AdminAlertRow[];
  alertsAt: number | null;
  customCosts: CustomCostRow[];
  customCostsLoading: boolean;
  loading: boolean;
  alertsLoading: boolean;
  retrying: boolean;
  error: string | null;
  lastUpdated: number | null;

  setTimeframe: (tf: Timeframe) => void;
  setCustomRange: (from: number, to: number) => void;
  setCategory: (category: FinanceCategoryFilter) => void;
  setDrilldown: (patch: { uid?: string; projectId?: string }) => void;
  refresh: (opts?: RefreshOpts) => Promise<void>;
  loadAlerts: (opts?: RefreshOpts) => Promise<void>;
  resolveAlert: (id: string) => Promise<void>;
  retryFulfillments: () => Promise<number>;
  loadCustomCosts: () => Promise<void>;
  saveCustomCost: (input: CustomCostInput) => Promise<void>;
  deleteCustomCost: (id: string) => Promise<void>;
}

export const useAdminFinance = create<AdminFinanceState>((set, get) => ({
  timeframe: "30d",
  customFrom: Date.now() - 30 * 24 * 60 * 60 * 1000,
  customTo: Date.now(),
  category: "all",
  uid: "",
  projectId: "",

  summary: null,
  summaryKey: null,
  alerts: [],
  alertsAt: null,
  customCosts: [],
  customCostsLoading: false,
  loading: false,
  alertsLoading: false,
  retrying: false,
  error: null,
  lastUpdated: null,

  setTimeframe(tf) {
    set({ timeframe: tf });
    void get().refresh();
  },

  setCustomRange(from, to) {
    set({ timeframe: "custom", customFrom: from, customTo: to });
    void get().refresh();
  },

  setCategory(category) {
    set({ category });
    void get().refresh();
  },

  setDrilldown(patch) {
    set({
      ...(patch.uid !== undefined ? { uid: patch.uid } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    });
    void get().refresh();
  },

  /**
   * Stale-while-revalidate: whatever summary is already loaded stays on screen
   * while a new one is fetched. A request is skipped when the same window +
   * filters were loaded within {@link FRESH_FOR_MS}, and concurrent identical
   * calls share one request.
   */
  refresh(opts) {
    const { timeframe, customFrom, customTo, category, uid, projectId, summary, summaryKey, lastUpdated } = get();
    const market = marketParam();
    // The window is identified by its timeframe, not by "now" — a rolling "30d"
    // is the same request a minute later, so it must hash the same.
    const key = [
      timeframe,
      timeframe === "custom" ? `${customFrom}-${customTo}` : "",
      category,
      uid,
      projectId,
      market,
    ].join("|");
    const force = opts?.force === true;

    if (!force && summary && summaryKey === key && lastUpdated && Date.now() - lastUpdated < FRESH_FOR_MS) {
      return Promise.resolve();
    }
    if (!force && summaryInFlight?.key === key) return summaryInFlight.promise;

    const seq = ++summarySeq;
    const range = resolveRange(timeframe, { from: customFrom, to: customTo });
    set({ loading: true, error: null });
    const token = {};
    const promise: Promise<void> = (async () => {
      try {
        const qs =
          `from=${range.from}&to=${range.to}` +
          market +
          (category !== "all" ? `&category=${category}` : "") +
          (uid ? `&uid=${encodeURIComponent(uid)}` : "") +
          (projectId ? `&projectId=${encodeURIComponent(projectId)}` : "") +
          (force ? "&fresh=1" : "");
        const res = await backendFetch(`/admin/finance/summary?${qs}`);
        if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load finance summary.");
        const data = (await res.json()) as FinanceSummaryData;
        // A newer request (other window / filters) owns the screen now.
        if (seq === summarySeq) set({ summary: data, summaryKey: key, lastUpdated: Date.now() });
      } catch (err) {
        if (seq === summarySeq) {
          set({ error: (err as Error)?.message ?? "Failed to load finance summary." });
        }
      } finally {
        if (seq === summarySeq) set({ loading: false });
        if (summaryInFlight?.token === token) summaryInFlight = null;
      }
    })();
    summaryInFlight = { key, promise, token };
    return promise;
  },

  loadAlerts(opts) {
    const { alertsAt } = get();
    if (!opts?.force && alertsAt && Date.now() - alertsAt < FRESH_FOR_MS) return Promise.resolve();
    if (alertsInFlight) return alertsInFlight;
    set({ alertsLoading: true });
    const promise = (async () => {
      try {
        const res = await backendFetch("/admin/alerts?limit=100");
        if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load alerts.");
        const json = (await res.json()) as { alerts?: AdminAlertRow[] };
        set({ alerts: json.alerts ?? [], alertsAt: Date.now() });
      } catch {
        // Alerts are supplementary — leave whatever we had.
      } finally {
        alertsInFlight = null;
        set({ alertsLoading: false });
      }
    })();
    alertsInFlight = promise;
    return promise;
  },

  async resolveAlert(id) {
    const res = await backendFetch(`/admin/alerts/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to resolve alert.");
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, resolvedAt: Date.now() } : a)),
    }));
  },

  async retryFulfillments() {
    set({ retrying: true });
    try {
      const res = await backendFetch("/admin/fulfillment/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error((await safeError(res)) ?? "Retry sweep failed.");
      const json = (await res.json()) as { placed?: number };
      await get().loadAlerts({ force: true });
      return json.placed ?? 0;
    } finally {
      set({ retrying: false });
    }
  },

  async loadCustomCosts() {
    set({ customCostsLoading: true });
    try {
      const res = await backendFetch("/admin/finance/custom-costs");
      if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load custom costs.");
      const json = (await res.json()) as { costs?: CustomCostRow[] };
      set({ customCosts: json.costs ?? [] });
    } catch {
      // Supplementary — keep whatever we had.
    } finally {
      set({ customCostsLoading: false });
    }
  },

  async saveCustomCost(input) {
    const res = await backendFetch("/admin/finance/custom-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to save the cost.");
    await get().loadCustomCosts();
    // Saving books any due periods server-side — refresh the totals too.
    await get().refresh({ force: true });
  },

  async deleteCustomCost(id) {
    const res = await backendFetch(`/admin/finance/custom-costs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to delete the cost.");
    set((s) => ({ customCosts: s.customCosts.filter((c) => c.id !== id) }));
  },
}));
