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

interface AdminFinanceState {
  timeframe: Timeframe;
  customFrom: number;
  customTo: number;
  category: FinanceCategoryFilter;
  /** Optional drill-down filters (empty = everyone / all projects). */
  uid: string;
  projectId: string;

  summary: FinanceSummaryData | null;
  alerts: AdminAlertRow[];
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
  refresh: () => Promise<void>;
  loadAlerts: () => Promise<void>;
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
  alerts: [],
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

  async refresh() {
    const { timeframe, customFrom, customTo, category, uid, projectId } = get();
    const range = resolveRange(timeframe, { from: customFrom, to: customTo });
    set({ loading: true, error: null });
    try {
      const qs =
        `from=${range.from}&to=${range.to}` +
        (category !== "all" ? `&category=${category}` : "") +
        (uid ? `&uid=${encodeURIComponent(uid)}` : "") +
        (projectId ? `&projectId=${encodeURIComponent(projectId)}` : "");
      const res = await backendFetch(`/admin/finance/summary?${qs}`);
      if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load finance summary.");
      set({ summary: (await res.json()) as FinanceSummaryData, lastUpdated: Date.now() });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load finance summary." });
    } finally {
      set({ loading: false });
    }
  },

  async loadAlerts() {
    set({ alertsLoading: true });
    try {
      const res = await backendFetch("/admin/alerts?limit=100");
      if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load alerts.");
      const json = (await res.json()) as { alerts?: AdminAlertRow[] };
      set({ alerts: json.alerts ?? [] });
    } catch {
      // Alerts are supplementary — leave whatever we had.
    } finally {
      set({ alertsLoading: false });
    }
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
      await get().loadAlerts();
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
    await get().refresh();
  },

  async deleteCustomCost(id) {
    const res = await backendFetch(`/admin/finance/custom-costs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to delete the cost.");
    set((s) => ({ customCosts: s.customCosts.filter((c) => c.id !== id) }));
  },
}));
