/**
 * Client store for the admin Analysis dashboard.
 *
 * All data is fetched from the admin-gated `/admin/analytics/*` + `/admin/settings`
 * backend routes (the browser can't read other users' data directly). This store
 * owns the selected time-frame, the fetched overview + user table, and the
 * persisted admin settings (exclusion list, timezone, auto-refresh).
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import {
  DEFAULT_ADMIN_SETTINGS,
  resolveRange,
  type AdminSettings,
  type AnalyticsOverview,
  type AnalyticsUserRow,
  type CadenceFilter,
  type PlanFilter,
  type SortDir,
  type SparksAdjustResult,
  type Timeframe,
  type UserSort,
} from "../core/analytics/types";

async function getJson<T>(path: string): Promise<T> {
  const res = await backendFetch(path);
  if (!res.ok) throw new Error((await safeError(res)) ?? "Request failed.");
  return (await res.json()) as T;
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

interface AdminAnalyticsState {
  timeframe: Timeframe;
  customFrom: number;
  customTo: number;

  overview: AnalyticsOverview | null;
  users: AnalyticsUserRow[];
  usersTotal: number;
  settings: AdminSettings;

  sort: UserSort;
  dir: SortDir;
  search: string;
  limit: number;
  includeGuests: boolean;
  planFilter: PlanFilter;
  cadenceFilter: CadenceFilter;

  loading: boolean;
  usersLoading: boolean;
  savingSettings: boolean;
  error: string | null;
  lastUpdated: number | null;
  initialized: boolean;

  init: () => Promise<void>;
  setTimeframe: (tf: Timeframe) => void;
  setCustomRange: (from: number, to: number) => void;
  refresh: () => Promise<void>;
  setUserQuery: (
    patch: Partial<
      Pick<
        AdminAnalyticsState,
        "sort" | "dir" | "search" | "limit" | "includeGuests" | "planFilter" | "cadenceFilter"
      >
    >,
  ) => void;
  saveSettings: (patch: Partial<AdminSettings>) => Promise<void>;
  excludeEmail: (email: string) => Promise<void>;
  adjustSparks: (uid: string, delta: number, reason: string) => Promise<SparksAdjustResult>;
}

function rangeParams(get: () => AdminAnalyticsState): string {
  const { timeframe, customFrom, customTo } = get();
  const range = resolveRange(timeframe, { from: customFrom, to: customTo });
  return `from=${range.from}&to=${range.to}`;
}

export const useAdminAnalytics = create<AdminAnalyticsState>((set, get) => ({
  timeframe: "7d",
  customFrom: Date.now() - 30 * 24 * 60 * 60 * 1000,
  customTo: Date.now(),

  overview: null,
  users: [],
  usersTotal: 0,
  settings: { ...DEFAULT_ADMIN_SETTINGS },

  sort: "lastActive",
  dir: "desc",
  search: "",
  limit: 50,
  includeGuests: false,
  planFilter: "all",
  cadenceFilter: "all",

  loading: false,
  usersLoading: false,
  savingSettings: false,
  error: null,
  lastUpdated: null,
  initialized: false,

  async init() {
    if (get().initialized) {
      await get().refresh();
      return;
    }
    set({ initialized: true });
    try {
      const settings = await getJson<AdminSettings>("/admin/settings");
      set({ settings });
    } catch {
      // Fall back to defaults; the dashboard still works.
    }
    await get().refresh();
  },

  setTimeframe(tf) {
    set({ timeframe: tf });
    void get().refresh();
  },

  setCustomRange(from, to) {
    set({ timeframe: "custom", customFrom: from, customTo: to });
    void get().refresh();
  },

  async refresh() {
    const params = rangeParams(get);
    const { sort, dir, search, limit, includeGuests, planFilter, cadenceFilter } = get();
    set({ loading: true, usersLoading: true, error: null });
    try {
      const usersQs =
        `${params}&sort=${sort}&dir=${dir}&limit=${limit}` +
        `&includeGuests=${includeGuests}` +
        `&plan=${planFilter}&cadence=${cadenceFilter}` +
        (search ? `&search=${encodeURIComponent(search)}` : "");
      const [overview, usersRes] = await Promise.all([
        getJson<AnalyticsOverview>(`/admin/analytics/overview?${params}`),
        getJson<{ rows: AnalyticsUserRow[]; total: number }>(`/admin/analytics/users?${usersQs}`),
      ]);
      set({
        overview,
        users: usersRes.rows,
        usersTotal: usersRes.total,
        lastUpdated: Date.now(),
      });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load analytics." });
    } finally {
      set({ loading: false, usersLoading: false });
    }
  },

  setUserQuery(patch) {
    set(patch);
    void get().refresh();
  },

  async saveSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ savingSettings: true, settings: next });
    try {
      const res = await backendFetch("/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error((await safeError(res)) ?? "Save failed.");
      const saved = (await res.json()) as AdminSettings;
      set({ settings: saved });
      await get().refresh();
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to save settings." });
    } finally {
      set({ savingSettings: false });
    }
  },

  async excludeEmail(email) {
    const e = email.trim().toLowerCase();
    if (!e) return;
    const current = get().settings.excludedEmails;
    if (current.includes(e)) return;
    await get().saveSettings({ excludedEmails: [...current, e] });
  },

  async adjustSparks(uid, delta, reason) {
    const res = await backendFetch(`/admin/users/${encodeURIComponent(uid)}/sparks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta, reason }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to adjust Sparks.");
    const result = (await res.json()) as SparksAdjustResult;
    // Reflect the new balance locally without a full re-scan.
    set((s) => ({
      users: s.users.map((u) => (u.uid === uid ? { ...u, sparkBalance: result.balance } : u)),
    }));
    return result;
  },
}));
