import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import type { Timeframe } from "../core/analytics/types";
import type {
  LogAnalysisResult,
  LogDomain,
  LogEntry,
  LogSeverity,
  LogSource,
} from "../core/logging/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeForTimeframe(
  tf: Timeframe,
  customFrom: number,
  customTo: number,
): { from: number; to: number } {
  const now = Date.now();
  if (tf === "today") {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return { from: startOfToday.getTime(), to: now };
  }
  if (tf === "7d") return { from: now - 7 * DAY_MS, to: now };
  if (tf === "30d") return { from: now - 30 * DAY_MS, to: now };
  return { from: customFrom, to: customTo };
}

export interface LogAnalysisResponse {
  analysis: LogAnalysisResult;
  model: { provider: string; id: string };
  analyzedCount: number;
  durationMs: number;
}

export interface AdminLogsState {
  timeframe: Timeframe;
  customFrom: number;
  customTo: number;

  severities: LogSeverity[];
  sources: LogSource[];
  domains: LogDomain[];
  uid: string;
  projectId: string;
  sessionId: string;
  requestId: string;
  jobId: string;
  orderId: string;
  paymentId: string;
  event: string;
  search: string;
  unresolvedOnly: boolean;

  entries: LogEntry[];
  counts: {
    total: number;
    info: number;
    warn: number;
    error: number;
    fatal: number;
    unresolvedFatal: number;
  };
  facets: {
    byDomain: Record<string, number>;
    bySource: Record<string, number>;
    topEvents: Array<{ event: string; count: number; severity: LogSeverity }>;
  };
  capped: boolean;
  scanned: number;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;

  // AI root-cause analyzer state
  analyzing: boolean;
  analysisError: string | null;
  analysisResult: LogAnalysisResponse | null;
  analysisQuestion: string;

  refresh: () => Promise<void>;
  setTimeframe: (tf: Timeframe) => void;
  setCustomRange: (from: number, to: number) => void;
  toggleSeverity: (sev: LogSeverity) => void;
  setSeverities: (sevs: LogSeverity[]) => void;
  toggleSource: (src: LogSource) => void;
  toggleDomain: (dom: LogDomain) => void;
  setFilters: (
    patch: Partial<{
      uid: string;
      projectId: string;
      sessionId: string;
      requestId: string;
      jobId: string;
      orderId: string;
      paymentId: string;
      event: string;
      search: string;
      unresolvedOnly: boolean;
    }>,
  ) => void;
  clearFilters: () => void;
  focusEntity: (opts: {
    uid?: string;
    projectId?: string;
    sessionId?: string;
    orderId?: string;
    paymentId?: string;
    jobId?: string;
  }) => void;
  resolveEntry: (id: string, resolved?: boolean) => Promise<void>;
  setAnalysisQuestion: (q: string) => void;
  analyzeCurrentLogs: (opts?: { question?: string; logIds?: string[] }) => Promise<void>;
  clearAnalysis: () => void;
}

export const useAdminLogs = create<AdminLogsState>((set, get) => ({
  timeframe: "7d",
  customFrom: Date.now() - 7 * DAY_MS,
  customTo: Date.now(),

  severities: [],
  sources: [],
  domains: [],
  uid: "",
  projectId: "",
  sessionId: "",
  requestId: "",
  jobId: "",
  orderId: "",
  paymentId: "",
  event: "",
  search: "",
  unresolvedOnly: false,

  entries: [],
  counts: {
    total: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0,
    unresolvedFatal: 0,
  },
  facets: {
    byDomain: {},
    bySource: {},
    topEvents: [],
  },
  capped: false,
  scanned: 0,
  loading: false,
  error: null,
  lastUpdated: null,

  analyzing: false,
  analysisError: null,
  analysisResult: null,
  analysisQuestion: "",

  refresh: async () => {
    const s = get();
    set({ loading: true, error: null });
    try {
      const { from, to } = rangeForTimeframe(s.timeframe, s.customFrom, s.customTo);
      const params = new URLSearchParams();
      params.set("from", String(from));
      params.set("to", String(to));
      params.set("limit", "300");
      if (s.severities.length > 0) params.set("severities", s.severities.join(","));
      if (s.sources.length > 0) params.set("sources", s.sources.join(","));
      if (s.domains.length > 0) params.set("domains", s.domains.join(","));
      if (s.uid) params.set("uid", s.uid);
      if (s.projectId) params.set("projectId", s.projectId);
      if (s.sessionId) params.set("sessionId", s.sessionId);
      if (s.requestId) params.set("requestId", s.requestId);
      if (s.jobId) params.set("jobId", s.jobId);
      if (s.orderId) params.set("orderId", s.orderId);
      if (s.paymentId) params.set("paymentId", s.paymentId);
      if (s.event) params.set("event", s.event);
      if (s.search) params.set("search", s.search);
      if (s.unresolvedOnly) params.set("unresolvedOnly", "1");

      const res = await backendFetch(`/admin/logs?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Could not load diagnostic logs.");
      }
      const data = (await res.json()) as {
        entries: LogEntry[];
        counts: AdminLogsState["counts"];
        facets: AdminLogsState["facets"];
        capped: boolean;
        scanned: number;
      };
      set({
        entries: data.entries,
        counts: data.counts,
        facets: data.facets,
        capped: data.capped,
        scanned: data.scanned,
        loading: false,
        lastUpdated: Date.now(),
      });
    } catch (err) {
      set({
        loading: false,
        error: (err as Error)?.message ?? "Could not load diagnostic logs.",
      });
    }
  },

  setTimeframe: (timeframe) => {
    set({ timeframe });
    void get().refresh();
  },

  setCustomRange: (customFrom, customTo) => {
    set({ timeframe: "custom", customFrom, customTo });
    void get().refresh();
  },

  toggleSeverity: (sev) => {
    const cur = get().severities;
    const next = cur.includes(sev) ? cur.filter((x) => x !== sev) : [...cur, sev];
    set({ severities: next });
    void get().refresh();
  },

  setSeverities: (severities) => {
    set({ severities });
    void get().refresh();
  },

  toggleSource: (src) => {
    const cur = get().sources;
    const next = cur.includes(src) ? cur.filter((x) => x !== src) : [...cur, src];
    set({ sources: next });
    void get().refresh();
  },

  toggleDomain: (dom) => {
    const cur = get().domains;
    const next = cur.includes(dom) ? cur.filter((x) => x !== dom) : [...cur, dom];
    set({ domains: next });
    void get().refresh();
  },

  setFilters: (patch) => {
    set(patch);
    void get().refresh();
  },

  clearFilters: () => {
    set({
      severities: [],
      sources: [],
      domains: [],
      uid: "",
      projectId: "",
      sessionId: "",
      requestId: "",
      jobId: "",
      orderId: "",
      paymentId: "",
      event: "",
      search: "",
      unresolvedOnly: false,
      analysisResult: null,
      analysisError: null,
    });
    void get().refresh();
  },

  focusEntity: (opts) => {
    set({
      timeframe: "30d",
      severities: [],
      sources: [],
      domains: [],
      uid: opts.uid ?? "",
      projectId: opts.projectId ?? "",
      sessionId: opts.sessionId ?? "",
      requestId: "",
      jobId: opts.jobId ?? "",
      orderId: opts.orderId ?? "",
      paymentId: opts.paymentId ?? "",
      event: "",
      search: "",
      unresolvedOnly: false,
      analysisResult: null,
      analysisError: null,
    });
    void get().refresh();
  },

  resolveEntry: async (id, resolved = true) => {
    const res = await backendFetch(`/admin/logs/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? "Could not update log status.");
    }
    const payload = (await res.json()) as {
      resolvedAt: number | null;
      resolvedBy: string | null;
    };
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id
          ? { ...e, resolvedAt: payload.resolvedAt, resolvedBy: payload.resolvedBy }
          : e,
      ),
    }));
  },

  setAnalysisQuestion: (analysisQuestion) => set({ analysisQuestion }),

  analyzeCurrentLogs: async (opts) => {
    const s = get();
    set({ analyzing: true, analysisError: null });
    try {
      const { from, to } = rangeForTimeframe(s.timeframe, s.customFrom, s.customTo);
      const question = (opts?.question ?? s.analysisQuestion).trim();
      const res = await backendFetch("/admin/logs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(opts?.logIds?.length ? { logIds: opts.logIds } : {}),
          filters: {
            fromMs: from,
            toMs: to,
            ...(s.severities.length ? { severities: s.severities } : {}),
            ...(s.sources.length ? { sources: s.sources } : {}),
            ...(s.domains.length ? { domains: s.domains } : {}),
            ...(s.uid ? { uid: s.uid } : {}),
            ...(s.projectId ? { projectId: s.projectId } : {}),
            ...(s.sessionId ? { sessionId: s.sessionId } : {}),
            ...(s.requestId ? { requestId: s.requestId } : {}),
            ...(s.jobId ? { jobId: s.jobId } : {}),
            ...(s.orderId ? { orderId: s.orderId } : {}),
            ...(s.paymentId ? { paymentId: s.paymentId } : {}),
            ...(s.event ? { event: s.event } : {}),
            ...(s.search ? { search: s.search } : {}),
          },
          ...(question ? { question } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "AI log analysis failed.");
      }
      const data = (await res.json()) as LogAnalysisResponse;
      set({ analyzing: false, analysisResult: data });
    } catch (err) {
      set({
        analyzing: false,
        analysisError: (err as Error)?.message ?? "AI log analysis failed.",
      });
    }
  },

  clearAnalysis: () => set({ analysisResult: null, analysisError: null }),
}));
