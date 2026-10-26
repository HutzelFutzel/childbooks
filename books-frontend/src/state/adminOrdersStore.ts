/**
 * Client store for the admin "Orders" analysis view.
 *
 * Everything comes from the admin-gated `/admin/orders*` routes — the order
 * records themselves are not readable from the browser (rules deny them). The
 * store keeps the overview report, the filtered list, the printer-link health and
 * the open order's detail, and exposes the actions an operator can take.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import { marketParam } from "./adminMarketStore";
import type { OrderAnalytics } from "../core/orders/analytics";
import type { PrintOrderRecord, PrintOrderState, PrintPrepStatus } from "../core/orders/lifecycle";
import type { PrintPrepSettings } from "../core/print/printPrep";

export interface OrderEventView {
  id: string;
  at: number;
  type: string;
  source: string;
  message: string | null;
  fromState: PrintOrderState | null;
  toState: PrintOrderState | null;
  luluStatus: string | null;
  data: Record<string, unknown> | null;
}

export interface OrderPaymentView {
  id: string;
  status: string;
  amount: number;
  currency: string;
  feeAmount: number | null;
  refundedAmount: number;
  stripePaymentIntentId: string | null;
  fulfillmentState: string | null;
  attempts: number;
  lastError: string | null;
  rejectedOrderIds: string[];
  /** The checkout's files came from a server render, so they can be prepared at print resolution. */
  printPrepEligible?: boolean;
  checkoutFiles?: { interior?: string; cover?: string } | null;
  placedFiles?: { interior?: string; cover?: string } | null;
  /** Who and where the order ships to, as it will be sent to the printer. */
  recipient?: OrderRecipientView | null;
}

export interface OrderRecipientView {
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  address: {
    line1: string;
    line2?: string | null;
    townOrCity: string;
    stateOrCounty?: string | null;
    postalOrZipCode: string;
    countryCode: string;
    taxId?: string | null;
  };
}

export interface PrintPrepImageView {
  blobId: string;
  naturalWidth: number;
  naturalHeight: number;
  demand: number;
  target: { ratio: number; width: number; height: number; modelScale: number };
  status: "pending" | "done" | "failed";
  attempts: number;
  tier: string | null;
  cached: boolean;
  costUsd: number;
  durationMs: number;
  fallbacks: string[];
  error: string | null;
}

export interface PrintPrepRunView {
  paymentId: string;
  status: PrintPrepStatus;
  active: boolean;
  startedAt: number;
  deadlineAt: number;
  finishedAt: number | null;
  reason: string | null;
  probeAttempts: number;
  renderAttempts: number;
  images: { total: number; done: number; failed: number };
  tiers: Record<string, number>;
  costUsd: number;
  files: { interior: string; cover: string } | null;
  timeline: { at: number; message: string }[];
}

export interface OrderDetail {
  record: PrintOrderRecord;
  events: OrderEventView[];
  payment: OrderPaymentView | null;
  printPrep: { run: PrintPrepRunView; images: PrintPrepImageView[] } | null;
}

export interface PrintPrepDay {
  day: string;
  costUsd: number;
  images: number;
  tiers: Record<string, number>;
  sparks: number;
  collectedUsd: number;
  slots: number;
}

/** The print-files dashboard: settings, upscaler health, active runs, money. */
export interface PrintPrepOverview {
  settings: PrintPrepSettings;
  upscaler: {
    configured: boolean;
    consecutiveFailures?: number;
    lastFailureAt?: number;
    lastSuccessAt?: number;
    firstFailureAt?: number | null;
    lastError?: string;
  };
  sweep: { lastRunAt: number | null; ok: boolean | null; summary: string | null; stale: boolean };
  active: {
    paymentId: string;
    status: PrintPrepStatus;
    startedAt: number;
    deadlineAt: number;
    images: { total: number; done: number; failed: number };
    note: string | null;
  }[];
  last24h: {
    finished: number;
    ready: number;
    fallback: number;
    skipped: number;
    fallbacks: { paymentId: string; reason: string | null; finishedAt: number | null }[];
  };
  money: {
    days: PrintPrepDay[];
    spend7dUsd: number;
    spend30dUsd: number;
    collected7dUsd: number;
    collected30dUsd: number;
    images30d: number;
    slots30d: number;
  };
}

export interface UpscalerTestResult {
  tier: string;
  width: number;
  height: number;
  ms: number;
  aiMs: number;
  costUsd: number;
  fallbacks: string[];
}

export interface PrinterConnection {
  env: "sandbox" | "live";
  credentialsPresent: boolean;
  health: {
    lastWebhookAt: number | null;
    signatureFailures: number;
    lastSignatureFailureAt: number | null;
    authFailures: number;
    lastAuthOkAt: number | null;
    lastAuthError: string | null;
    webhookUrl: string | null;
    webhookStatus: string | null;
    webhookCheckedAt: number | null;
    checkedAt: number | null;
  };
  jobs: {
    job: string;
    label: string;
    lastRunAt: number | null;
    ok: boolean | null;
    summary: string | null;
    maxSilenceMs: number;
    stale: boolean;
  }[];
}

export type OrderAction =
  | "retry"
  | "replace"
  | "cancel"
  | "cancel-and-refund"
  | "recipient"
  | "sync"
  | "ack"
  | "resend-email"
  | "rerun-print-prep"
  | "use-standard-files";

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await backendFetch(path);
  if (!res.ok) throw new Error(await messageOf(res, "Request failed."));
  return (await res.json()) as T;
}

/**
 * How long loaded data counts as current. Within this window re-opening the
 * dashboard or switching tabs reuses what's in memory instead of re-running the
 * server-side order scan; "Refresh" always bypasses it.
 */
const FRESH_FOR_MS = 30_000;

/** Calls sharing one in-flight request instead of racing each other. */
let analyticsInFlight: { key: string; promise: Promise<void>; token: object } | null = null;
let fullInFlight: { key: string; promise: Promise<void>; token: object } | null = null;

interface RefreshOpts {
  /** Skip the freshness window (an explicit "Refresh", or after a write that changes the numbers). */
  force?: boolean;
}

/** What a loaded report is "for": the window and the market filter. */
function windowKey(days: number): string {
  return `${days}|${marketParam()}`;
}

/** `loading` stays true until EVERY overlapping load has finished. */
let activeLoads = 0;
function beginLoad(): void {
  activeLoads += 1;
  useAdminOrders.setState({ loading: true });
}
function endLoad(): void {
  activeLoads = Math.max(0, activeLoads - 1);
  if (activeLoads === 0) useAdminOrders.setState({ loading: false });
}

/**
 * Make sure the headline report is loaded and current. Reuses a fresh copy,
 * joins one already in flight, otherwise fetches. Throws on failure.
 */
function ensureAnalytics(force: boolean): Promise<void> {
  const { days, analytics, analyticsKey, analyticsAt } = useAdminOrders.getState();
  const key = windowKey(days);
  if (!force && analytics && analyticsKey === key && analyticsAt && Date.now() - analyticsAt < FRESH_FOR_MS) {
    return Promise.resolve();
  }
  if (!force && analyticsInFlight?.key === key) return analyticsInFlight.promise;

  const token = {};
  const promise: Promise<void> = (async () => {
    try {
      const data = await getJson<OrderAnalytics>(
        `/admin/orders/analytics?days=${days}${marketParam()}${force ? "&fresh=1" : ""}`,
      );
      // The admin changed the window while this was in flight — don't show the wrong one.
      if (useAdminOrders.getState().days !== days) return;
      const now = Date.now();
      useAdminOrders.setState({ analytics: data, analyticsKey: key, analyticsAt: now, lastUpdated: now });
    } finally {
      if (analyticsInFlight?.token === token) analyticsInFlight = null;
    }
  })();
  analyticsInFlight = { key, promise, token };
  return promise;
}

interface AdminOrdersState {
  days: number;
  stateFilter: PrintOrderState | "all";
  attentionOnly: boolean;
  query: string;

  analytics: OrderAnalytics | null;
  orders: PrintOrderRecord[];
  total: number;
  connection: PrinterConnection | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  /** What `analytics` was loaded for (window + market) and when. */
  analyticsKey: string | null;
  analyticsAt: number | null;
  /** When the FULL view (analytics + connection + list + print prep) was last loaded, and for what. */
  fullKey: string | null;
  fullAt: number | null;

  selectedKey: string | null;
  detail: OrderDetail | null;
  detailLoading: boolean;
  busyAction: string | null;
  actionError: string | null;
  notice: string | null;

  printPrep: PrintPrepOverview | null;
  printPrepError: string | null;
  upscalerTest: UpscalerTestResult | null;

  setDays: (days: number) => void;
  setStateFilter: (state: PrintOrderState | "all") => void;
  setAttentionOnly: (on: boolean) => void;
  setQuery: (q: string) => void;
  /** The whole Orders view: report, printer link, list, print files. */
  refresh: (opts?: RefreshOpts) => Promise<void>;
  /** Just the headline report — all the dashboard overview needs, in one request. */
  loadOverview: (opts?: RefreshOpts) => Promise<void>;
  refreshList: (opts?: { fresh?: boolean }) => Promise<void>;
  checkConnection: () => Promise<void>;
  open: (key: string | null) => Promise<void>;
  act: (key: string, action: OrderAction, body?: Record<string, unknown>) => Promise<boolean>;
  loadPrintPrep: () => Promise<void>;
  savePrintPrepSettings: (settings: PrintPrepSettings) => Promise<boolean>;
  testUpscaler: () => Promise<void>;
}

export const useAdminOrders = create<AdminOrdersState>((set, get) => ({
  days: 30,
  stateFilter: "all",
  attentionOnly: false,
  query: "",

  analytics: null,
  orders: [],
  total: 0,
  connection: null,
  loading: false,
  error: null,
  lastUpdated: null,
  analyticsKey: null,
  analyticsAt: null,
  fullKey: null,
  fullAt: null,

  selectedKey: null,
  detail: null,
  detailLoading: false,
  busyAction: null,
  actionError: null,
  notice: null,

  printPrep: null,
  printPrepError: null,
  upscalerTest: null,

  setDays(days) {
    set({ days });
    void get().refresh();
  },
  setStateFilter(stateFilter) {
    set({ stateFilter });
    void get().refreshList();
  },
  setAttentionOnly(attentionOnly) {
    set({ attentionOnly });
    void get().refreshList();
  },
  setQuery(query) {
    set({ query });
  },

  /**
   * Stale-while-revalidate: what's already loaded stays on screen while the new
   * data is fetched. Skipped when the same window + market were fully loaded
   * within {@link FRESH_FOR_MS}; concurrent identical calls share one request.
   */
  refresh(opts) {
    const force = opts?.force === true;
    const key = windowKey(get().days);
    const { fullKey, fullAt } = get();
    if (!force && fullKey === key && fullAt && Date.now() - fullAt < FRESH_FOR_MS) return Promise.resolve();
    if (!force && fullInFlight?.key === key) return fullInFlight.promise;

    beginLoad();
    set({ error: null });
    const token = {};
    const promise: Promise<void> = (async () => {
      try {
        // The report (shared with the overview, so it may already be fresh) and
        // the printer link are independent — fetch them together.
        const [, connection] = await Promise.all([
          ensureAnalytics(force),
          getJson<PrinterConnection>("/admin/orders/connection"),
        ]);
        set({ connection });
        await Promise.all([get().refreshList({ fresh: force }), get().loadPrintPrep()]);
        set({ fullKey: key, fullAt: Date.now() });
      } catch (err) {
        set({ error: (err as Error)?.message ?? "Failed to load orders." });
      } finally {
        if (fullInFlight?.token === token) fullInFlight = null;
        endLoad();
      }
    })();
    fullInFlight = { key, promise, token };
    return promise;
  },

  async loadOverview(opts) {
    beginLoad();
    try {
      await ensureAnalytics(opts?.force === true);
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load orders." });
    } finally {
      endLoad();
    }
  },

  async refreshList(opts) {
    try {
      const { stateFilter, attentionOnly, query } = get();
      const params = new URLSearchParams();
      if (stateFilter !== "all") params.set("state", stateFilter);
      if (attentionOnly) params.set("attention", "1");
      if (query.trim()) params.set("q", query.trim());
      if (opts?.fresh) params.set("fresh", "1");
      const market = marketParam();
      const list = await getJson<{ total: number; orders: PrintOrderRecord[] }>(
        `/admin/orders?${params.toString()}${market}`,
      );
      set({ orders: list.orders, total: list.total });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load orders." });
    }
  },

  async checkConnection() {
    set({ busyAction: "connection", actionError: null });
    try {
      const res = await backendFetch("/admin/orders/connection/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await messageOf(res, "The check failed."));
      const connection = await getJson<PrinterConnection>("/admin/orders/connection");
      set({ connection });
    } catch (err) {
      set({ actionError: (err as Error)?.message ?? "The check failed." });
    } finally {
      set({ busyAction: null });
    }
  },

  async open(key) {
    if (!key) {
      set({ selectedKey: null, detail: null, actionError: null, notice: null });
      return;
    }
    set({ selectedKey: key, detailLoading: true, actionError: null, notice: null });
    try {
      const detail = await getJson<OrderDetail>(`/admin/orders/${encodeURIComponent(key)}`);
      // Ignore a late answer for an order that's no longer the open one.
      if (get().selectedKey === key) set({ detail });
    } catch (err) {
      set({ actionError: (err as Error)?.message ?? "Could not load the order." });
    } finally {
      set({ detailLoading: false });
    }
  },

  async act(key, action, body) {
    set({ busyAction: action, actionError: null, notice: null });
    try {
      const res = await backendFetch(`/admin/orders/${encodeURIComponent(key)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) throw new Error(await messageOf(res, "That didn't work."));
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { skipped?: string } };
      // Reload first: opening an order clears the notice, and the notice is the point.
      // The action changed what the report and list say — the next visit must refetch.
      set({ analyticsAt: null, fullAt: null });
      await Promise.all([get().open(key), get().refreshList({ fresh: true })]);
      set({
        notice:
          action === "resend-email" && json.ok === false
            ? `Not sent${json.result?.skipped ? ` (${json.result.skipped})` : ""}.`
            : "Done.",
      });
      return true;
    } catch (err) {
      set({ actionError: (err as Error)?.message ?? "That didn't work." });
      return false;
    } finally {
      set({ busyAction: null });
    }
  },

  async loadPrintPrep() {
    try {
      const printPrep = await getJson<PrintPrepOverview>("/admin/orders/print-prep/status");
      set({ printPrep, printPrepError: null });
    } catch (err) {
      set({ printPrepError: (err as Error)?.message ?? "Could not load print preparation." });
    }
  },

  async savePrintPrepSettings(settings) {
    set({ busyAction: "print-prep-settings", printPrepError: null });
    try {
      const res = await backendFetch("/admin/orders/print-prep/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(await messageOf(res, "Couldn't save."));
      await get().loadPrintPrep();
      return true;
    } catch (err) {
      set({ printPrepError: (err as Error)?.message ?? "Couldn't save." });
      return false;
    } finally {
      set({ busyAction: null });
    }
  },

  async testUpscaler() {
    set({ busyAction: "print-prep-test", printPrepError: null, upscalerTest: null });
    try {
      const res = await backendFetch("/admin/orders/print-prep/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await messageOf(res, "The test failed."));
      set({ upscalerTest: (await res.json()) as UpscalerTestResult });
      await get().loadPrintPrep();
    } catch (err) {
      set({ printPrepError: (err as Error)?.message ?? "The test failed." });
    } finally {
      set({ busyAction: null });
    }
  },
}));
