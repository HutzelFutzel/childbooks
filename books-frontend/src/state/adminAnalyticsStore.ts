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
import { marketParam, useAdminMarket } from "./adminMarketStore";
import {
  DEFAULT_ADMIN_SETTINGS,
  resolveRange,
  type ActivityMetric,
  type AdminSettings,
  type AnalyticsOverview,
  type AnalyticsUserRow,
  type CadenceFilter,
  type DeviceFilter,
  type DeviceReport,
  type FunnelReport,
  type PlanFilter,
  type ProductsReport,
  type SortDir,
  type SparksAdjustResult,
  type Timeframe,
  type TimezoneMode,
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
  products: ProductsReport | null;
  funnel: FunnelReport | null;
  devices: DeviceReport | null;
  settings: AdminSettings;

  sort: UserSort;
  dir: SortDir;
  search: string;
  limit: number;
  includeGuests: boolean;
  planFilter: PlanFilter;
  cadenceFilter: CadenceFilter;

  /**
   * The entry-device filter, shared by the overview, funnel and users table.
   *
   * Entry-scoped by design: it selects PEOPLE who arrived on a form factor and
   * then shows everything they did, on any device. See `DeviceFilter` — an
   * event-scoped filter would drop the cross-device half of the funnel and make
   * mobile look like it never converts.
   */
  device: DeviceFilter;
  /** Which clock the activity grids are bucketed in (server-side). */
  tzMode: TimezoneMode;
  /** Which activity the heatmap / hour chart shows (client-side selection). */
  metric: ActivityMetric;
  /** Count distinct people rather than raw events (client-side selection). */
  countUniqueUsers: boolean;

  loading: boolean;
  usersLoading: boolean;
  productsLoading: boolean;
  devicesLoading: boolean;
  savingSettings: boolean;
  error: string | null;
  lastUpdated: number | null;
  initialized: boolean;

  init: () => Promise<void>;
  setTimeframe: (tf: Timeframe) => void;
  setCustomRange: (from: number, to: number) => void;
  setCountry: (country: string | null) => void;
  setDevice: (device: DeviceFilter) => void;
  setTzMode: (mode: TimezoneMode) => void;
  setMetric: (metric: ActivityMetric) => void;
  setCountUniqueUsers: (unique: boolean) => void;
  refresh: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshProducts: () => Promise<void>;
  refreshDevices: () => Promise<void>;
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
  /**
   * Fetch a row's real email/name (server logs the reveal). Requires
   * `analysis.users.pii` — the backend 403s otherwise, and this rejects.
   */
  revealUserPii: (uid: string) => Promise<void>;
}

function rangeParams(get: () => AdminAnalyticsState): string {
  const { timeframe, customFrom, customTo } = get();
  const range = resolveRange(timeframe, { from: customFrom, to: customTo });
  return `from=${range.from}&to=${range.to}${marketParam()}`;
}

/**
 * `&device=mobile` for the active entry-device filter, or "" when unfiltered.
 * Appended only to the routes that honour it (overview, funnel, users) — the
 * Devices report is the filter's own subject and must never be scoped by it.
 */
function deviceParam(get: () => AdminAnalyticsState): string {
  const { device } = get();
  return device === "all" ? "" : `&device=${device}`;
}

export const useAdminAnalytics = create<AdminAnalyticsState>((set, get) => ({
  timeframe: "7d",
  customFrom: Date.now() - 30 * 24 * 60 * 60 * 1000,
  customTo: Date.now(),

  overview: null,
  users: [],
  usersTotal: 0,
  products: null,
  funnel: null,
  devices: null,
  settings: { ...DEFAULT_ADMIN_SETTINGS },

  sort: "lastActive",
  dir: "desc",
  search: "",
  limit: 50,
  includeGuests: false,
  planFilter: "all",
  cadenceFilter: "all",

  // Market-local by default: for a global audience, the hour a person acted in
  // their OWN timezone is the only reading that describes real behaviour.
  tzMode: "market",
  metric: "all",
  countUniqueUsers: false,
  device: "all",

  loading: false,
  usersLoading: false,
  productsLoading: false,
  devicesLoading: false,
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
    void get().refreshAll();
  },

  setCustomRange(from, to) {
    set({ timeframe: "custom", customFrom: from, customTo: to });
    void get().refreshAll();
  },

  setCountry(country) {
    // Only records the choice — the Analysis tab decides which section to
    // re-fetch, so switching markets doesn't re-scan sections nobody is looking
    // at (the overview alone is a full Auth scan).
    useAdminMarket.getState().setCountry(country);
  },

  setDevice(device) {
    set({ device });
    // Filtered server-side (it selects on data the browser can't read), so
    // changing it is a re-fetch of the overview + funnel + users table. The
    // Devices report is deliberately left alone: it's what the filter is FOR.
    void get().refresh();
  },

  setTzMode(tzMode) {
    set({ tzMode });
    // The grids are bucketed server-side, so switching clocks is a re-fetch.
    void get().refresh();
  },

  setMetric(metric) {
    set({ metric });
  },

  setCountUniqueUsers(countUniqueUsers) {
    set({ countUniqueUsers });
  },

  async refresh() {
    const params = rangeParams(get);
    const seg = params + deviceParam(get);
    const { sort, dir, search, limit, includeGuests, planFilter, cadenceFilter, tzMode } = get();
    set({ loading: true, usersLoading: true, error: null });
    try {
      const usersQs =
        `${seg}&sort=${sort}&dir=${dir}&limit=${limit}` +
        `&includeGuests=${includeGuests}` +
        `&plan=${planFilter}&cadence=${cadenceFilter}` +
        (search ? `&search=${encodeURIComponent(search)}` : "");
      const [overview, usersRes, funnel] = await Promise.all([
        getJson<AnalyticsOverview>(`/admin/analytics/overview?${seg}&tzMode=${tzMode}`),
        getJson<{ rows: AnalyticsUserRow[]; total: number }>(`/admin/analytics/users?${usersQs}`),
        // Supplementary: a funnel failure shouldn't blank the whole dashboard.
        getJson<FunnelReport>(`/admin/analytics/funnel?${seg}`).catch(() => null),
      ]);
      set({
        overview,
        users: usersRes.rows,
        usersTotal: usersRes.total,
        funnel,
        lastUpdated: Date.now(),
      });
      // Keep the market picker's options in sync with what the data contains,
      // but only from the unfiltered view — a filtered one knows just one market.
      if (!useAdminMarket.getState().country) {
        useAdminMarket.getState().setKnown(overview.countries);
      }
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load analytics." });
    } finally {
      set({ loading: false, usersLoading: false });
    }
  },

  /**
   * Re-fetch everything this store owns that has already been loaded. The
   * timeframe applies to every section, so changing it from the Products view
   * has to move the Products numbers too — but there's no point fetching a
   * report nobody has opened yet.
   */
  async refreshAll() {
    const tasks = [get().refresh()];
    if (get().products) tasks.push(get().refreshProducts());
    if (get().devices) tasks.push(get().refreshDevices());
    await Promise.all(tasks);
  },

  async refreshDevices() {
    set({ devicesLoading: true, error: null });
    try {
      const devices = await getJson<DeviceReport>(
        `/admin/analytics/devices?${rangeParams(get)}`,
      );
      set({ devices, lastUpdated: Date.now() });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load device analytics." });
    } finally {
      set({ devicesLoading: false });
    }
  },

  async refreshProducts() {
    set({ productsLoading: true, error: null });
    try {
      const products = await getJson<ProductsReport>(
        `/admin/analytics/products?${rangeParams(get)}`,
      );
      set({ products, lastUpdated: Date.now() });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load products." });
    } finally {
      set({ productsLoading: false });
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

  async revealUserPii(uid) {
    const revealed = await getJson<{ uid: string; email: string | null; displayName: string | null }>(
      `/admin/analytics/users/${encodeURIComponent(uid)}/reveal`,
    );
    set((s) => ({
      users: s.users.map((u) =>
        u.uid === uid
          ? { ...u, email: revealed.email, displayName: revealed.displayName, piiMasked: false }
          : u,
      ),
    }));
  },
}));
