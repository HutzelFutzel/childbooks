/**
 * Client store for the admin Projects + Runs views.
 *
 * Backed by `/admin/projects` (the server-owned project mirrors joined with
 * per-project P&L derived from the finance stream) and `/admin/runs` (one row
 * per user-initiated action, with what it cost us and what we charged).
 *
 * These are the two views that answer "did this book make or lose money, and
 * why" — the aggregate cost tables can only ever tell you the average.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import { resolveRange, type Timeframe } from "../core/analytics/types";

export interface ProjectDerived {
  title?: string;
  ageRangeId?: string;
  readingModeId?: string;
  artStyleKey?: string;
  productSku?: string;
  pageCount: number;
  illustratedCount: number;
  illustrationVersions: number;
  screenplayVersions: number;
  anchors: { total: number; character: number; place: number; object: number };
}

export interface ProjectCounters {
  runs: number;
  fresh: number;
  edits: number;
  variations: number;
  restyles: number;
  failures: number;
  imagesGenerated: number;
  qcCalls: number;
  byAction: Record<string, number>;
  byTier: Record<string, number>;
  imagesByModel: Record<string, number>;
  imagesByAction: Record<string, number>;
}

export interface ProjectPnl {
  recognizedUsd: number;
  directUsd: number;
  refundUsd: number;
  feesUsd: number;
  providerUsd: number;
  subsidyUsd: number;
  freeSparks: number;
  paidSparks: number;
  freeBySource: Record<string, number>;
  subscriptionAllocUsd: number;
  netUsd: number;
}

export type ProjectMilestone =
  | "created"
  | "storyDrafted"
  | "castStarted"
  | "pagesStarted"
  | "coverDone"
  | "ordered";

export interface ProjectRow {
  key: string;
  projectId: string;
  uid: string;
  seq: number;
  createdAt: number;
  firstActionAt: number;
  lastActionAt: number;
  derived: ProjectDerived;
  reported?: { stage: string; updatedAt: number };
  milestones: Partial<Record<ProjectMilestone, number>>;
  counters: ProjectCounters;
  models: { imageModels: string[] };
  cost: { providerUsd: number; billedUsd: number; unbilledUsd: number };
  sparks: { charged: number; paid: number; free: number; byLotSource: Record<string, number> };
  timing: { timeToFirstImageMs?: number; timeToOrderMs?: number };
  pnl: ProjectPnl | null;
}

export interface ActionRunRow {
  runId: string;
  at: number;
  uid: string;
  projectId?: string;
  projectSeq?: number;
  action: string;
  tier?: "quick" | "premium";
  kind: "fresh" | "edit" | "variation" | "restyle";
  targetId?: string;
  jobId?: string;
  source: "sync" | "worker";
  models: Record<string, string>;
  calls: { total: number; failures: number; byStep: Record<string, number> };
  costUsd: { total: number; billable: number; unbilled: number; byStep: Record<string, number> };
  sparks: {
    quoted: number | null;
    charged: number;
    paid: number;
    free: number;
    unfunded: number;
    paidUsd: number;
    byLotSource: Record<string, number>;
  };
  marginUsd: number;
  durationMs: number;
  outcome: "ok" | "failed" | "aborted";
  errorCode?: string;
  tokens: number;
}

/** One metric's shape across the loaded set of books. */
export interface StatSummary {
  count: number;
  total: number;
  avg: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

export interface ProjectBehaviourStats {
  projects: number;
  users: number;
  pages: StatSummary;
  cast: StatSummary;
  illustratedPages: StatSummary;
  illustrationVersions: StatSummary;
  screenplayVersions: StatSummary;
  runs: StatSummary;
  images: StatSummary;
  fresh: StatSummary;
  edits: StatSummary;
  variations: StatSummary;
  restyles: StatSummary;
  failures: StatSummary;
  qcCalls: StatSummary;
  attemptsPerPage: StatSummary;
  costUsd: StatSummary;
  sparksCharged: StatSummary;
  netUsd: StatSummary;
  timeToFirstImageMs: StatSummary;
  timeToOrderMs: StatSummary;
  rates: {
    editRate: number;
    variationRate: number;
    restyleRate: number;
    failureRate: number;
    qcPerImage: number;
  };
  imagesByModel: Record<string, number>;
  imagesByAction: Record<string, number>;
  runsByAction: Record<string, number>;
  runsByTier: Record<string, number>;
  artStyles: Record<string, number>;
  milestones: Record<string, number>;
}

/** One row of the per-user behaviour table. */
export interface UserBehaviourRow {
  uid: string;
  projects: number;
  firstSeenAt: number;
  lastActionAt: number;
  ordered: number;
  stalled: number;
  pages: number;
  cast: number;
  images: number;
  runs: number;
  edits: number;
  variations: number;
  restyles: number;
  failures: number;
  qcCalls: number;
  costUsd: number;
  netUsd: number;
  sparksCharged: number;
  sparksPaid: number;
  sparksFree: number;
  avgPagesPerBook: number;
  avgCastPerBook: number;
  avgImagesPerBook: number;
  editRate: number;
  variationRate: number;
  failureRate: number;
  medianTimeToFirstImageMs: number;
  topModel: string | null;
  topTier: string | null;
  topArtStyle: string | null;
}

/** One provider call behind a run. */
export interface RunCallRow {
  id: string;
  action: string;
  provider: string;
  model: string;
  modality: string;
  step?: string;
  billable: boolean;
  costUsd: number | null;
  durationMs?: number;
  at: number;
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

export type ProjectSort = "recent" | "cost" | "net" | "runs" | "seq" | "images" | "rework";

/**
 * Server-side slicers for the books report. Empty string means "any" so the
 * whole set can be driven straight from <select> values.
 */
export interface ProjectFilters {
  milestoneReached: string;
  milestoneMissing: string;
  imageModel: string;
  tier: string;
  artStyleKey: string;
  productSku: string;
  ageRangeId: string;
  minPages: string;
  maxPages: string;
  minCast: string;
  maxCast: string;
  minImages: string;
  maxImages: string;
}

export const EMPTY_PROJECT_FILTERS: ProjectFilters = {
  milestoneReached: "",
  milestoneMissing: "",
  imageModel: "",
  tier: "",
  artStyleKey: "",
  productSku: "",
  ageRangeId: "",
  minPages: "",
  maxPages: "",
  minCast: "",
  maxCast: "",
  minImages: "",
  maxImages: "",
};

/** One project's full history, from `/admin/projects/:key`. */
export interface ProjectDetail {
  project: ProjectRow;
  pnl: ProjectPnl | null;
  runs: ActionRunRow[];
}

interface AdminProjectsState {
  timeframe: Timeframe;
  customFrom: number;
  customTo: number;
  uid: string;
  sort: ProjectSort;
  filters: ProjectFilters;
  /**
   * Model subscription revenue into per-project P&L. Off by default: the split
   * is an allocation, not an observed fact, and it shouldn't quietly turn a
   * loss-making book into a profitable one.
   */
  allocateSubscriptions: boolean;

  projects: ProjectRow[];
  stats: ProjectBehaviourStats | null;
  users: UserBehaviourRow[];
  /** More books matched than were loaded — the stats describe the page only. */
  truncated: boolean;
  unallocatedSubscriptionUsd: number;
  capped: boolean;
  loading: boolean;
  error: string | null;

  runs: ActionRunRow[];
  runsLoading: boolean;
  runAction: string;
  runProjectId: string;
  runKind: string;
  runOutcome: string;
  runTier: string;

  /** Expanded run → its provider calls. */
  runCalls: Record<string, RunCallRow[]>;

  /** The project opened in the history drawer. */
  detail: ProjectDetail | null;
  detailKey: string | null;
  detailLoading: boolean;

  setTimeframe: (tf: Timeframe) => void;
  setCustomRange: (from: number, to: number) => void;
  setQuery: (patch: {
    uid?: string;
    sort?: ProjectSort;
    allocateSubscriptions?: boolean;
  }) => void;
  setFilters: (patch: Partial<ProjectFilters>) => void;
  clearFilters: () => void;
  refresh: () => Promise<void>;
  setRunQuery: (patch: {
    action?: string;
    projectId?: string;
    uid?: string;
    kind?: string;
    outcome?: string;
    tier?: string;
  }) => void;
  refreshRuns: () => Promise<void>;
  loadRunCalls: (runId: string) => Promise<void>;
  openDetail: (key: string) => Promise<void>;
  closeDetail: () => void;
}

export const useAdminProjects = create<AdminProjectsState>((set, get) => ({
  timeframe: "30d",
  customFrom: Date.now() - 30 * 24 * 60 * 60 * 1000,
  customTo: Date.now(),
  uid: "",
  sort: "recent",
  filters: EMPTY_PROJECT_FILTERS,
  allocateSubscriptions: false,

  projects: [],
  stats: null,
  users: [],
  truncated: false,
  unallocatedSubscriptionUsd: 0,
  capped: false,
  loading: false,
  error: null,

  runs: [],
  runsLoading: false,
  runAction: "",
  runProjectId: "",
  runKind: "",
  runOutcome: "",
  runTier: "",
  runCalls: {},

  detail: null,
  detailKey: null,
  detailLoading: false,

  setTimeframe(tf) {
    set({ timeframe: tf });
    void get().refresh();
    void get().refreshRuns();
  },

  setCustomRange(from, to) {
    set({ timeframe: "custom", customFrom: from, customTo: to });
    void get().refresh();
    void get().refreshRuns();
  },

  setQuery(patch) {
    set(patch);
    void get().refresh();
  },

  setFilters(patch) {
    set((s) => ({ filters: { ...s.filters, ...patch } }));
    void get().refresh();
  },

  clearFilters() {
    set({ filters: EMPTY_PROJECT_FILTERS });
    void get().refresh();
  },

  async refresh() {
    const { timeframe, customFrom, customTo, uid, allocateSubscriptions, filters } = get();
    const range = resolveRange(timeframe, { from: customFrom, to: customTo });
    set({ loading: true, error: null });
    try {
      const qs = new URLSearchParams({
        from: String(range.from),
        to: String(range.to),
        limit: "300",
        ...(uid ? { uid } : {}),
        ...(allocateSubscriptions ? { allocateSubscriptions: "true" } : {}),
        // Only send filters that are actually set, so the URL stays readable in
        // the network tab when something looks wrong.
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "")),
      });
      const res = await backendFetch(`/admin/projects?${qs.toString()}`);
      if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load projects.");
      const json = (await res.json()) as {
        projects?: ProjectRow[];
        stats?: ProjectBehaviourStats;
        users?: UserBehaviourRow[];
        truncated?: boolean;
        unallocatedSubscriptionUsd?: number;
        capped?: boolean;
      };
      set({
        projects: json.projects ?? [],
        stats: json.stats ?? null,
        users: json.users ?? [],
        truncated: Boolean(json.truncated),
        unallocatedSubscriptionUsd: json.unallocatedSubscriptionUsd ?? 0,
        capped: Boolean(json.capped),
      });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load projects." });
    } finally {
      set({ loading: false });
    }
  },

  setRunQuery(patch) {
    set({
      ...(patch.action !== undefined ? { runAction: patch.action } : {}),
      ...(patch.projectId !== undefined ? { runProjectId: patch.projectId } : {}),
      ...(patch.uid !== undefined ? { uid: patch.uid } : {}),
      ...(patch.kind !== undefined ? { runKind: patch.kind } : {}),
      ...(patch.outcome !== undefined ? { runOutcome: patch.outcome } : {}),
      ...(patch.tier !== undefined ? { runTier: patch.tier } : {}),
    });
    void get().refreshRuns();
  },

  async refreshRuns() {
    const {
      timeframe,
      customFrom,
      customTo,
      uid,
      runAction,
      runProjectId,
      runKind,
      runOutcome,
      runTier,
    } = get();
    const range = resolveRange(timeframe, { from: customFrom, to: customTo });
    set({ runsLoading: true });
    try {
      const qs =
        `from=${range.from}&to=${range.to}&limit=300` +
        (uid ? `&uid=${encodeURIComponent(uid)}` : "") +
        (runAction ? `&action=${encodeURIComponent(runAction)}` : "") +
        (runProjectId ? `&projectId=${encodeURIComponent(runProjectId)}` : "") +
        (runKind ? `&kind=${encodeURIComponent(runKind)}` : "") +
        (runOutcome ? `&outcome=${encodeURIComponent(runOutcome)}` : "") +
        (runTier ? `&tier=${encodeURIComponent(runTier)}` : "");
      const res = await backendFetch(`/admin/runs?${qs}`);
      if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load runs.");
      const json = (await res.json()) as { runs?: ActionRunRow[] };
      set({ runs: json.runs ?? [] });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load runs." });
    } finally {
      set({ runsLoading: false });
    }
  },

  async loadRunCalls(runId) {
    if (get().runCalls[runId]) return;
    const res = await backendFetch(`/admin/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return;
    const json = (await res.json()) as { calls?: RunCallRow[] };
    set((s) => ({ runCalls: { ...s.runCalls, [runId]: json.calls ?? [] } }));
  },

  /**
   * Load one book's whole history. The server scopes this to the book's own
   * lifetime rather than the dashboard timeframe — when you open a book you want
   * everything that ever happened to it, not the slice the table was filtered to.
   */
  async openDetail(key) {
    set({ detailKey: key, detailLoading: true, detail: null });
    try {
      const { allocateSubscriptions } = get();
      const qs = new URLSearchParams(
        allocateSubscriptions ? { allocateSubscriptions: "true" } : {},
      );
      const res = await backendFetch(
        `/admin/projects/${encodeURIComponent(key)}?${qs.toString()}`,
      );
      if (!res.ok) throw new Error((await safeError(res)) ?? "Failed to load project.");
      const json = (await res.json()) as {
        project?: ProjectRow;
        pnl?: ProjectPnl | null;
        runs?: ActionRunRow[];
      };
      if (!json.project) throw new Error("Project not found.");
      if (get().detailKey !== key) return; // a later open won the race
      set({
        detail: {
          project: { ...json.project, key },
          pnl: json.pnl ?? null,
          runs: json.runs ?? [],
        },
      });
    } catch (err) {
      set({ error: (err as Error)?.message ?? "Failed to load project." });
    } finally {
      if (get().detailKey === key) set({ detailLoading: false });
    }
  },

  closeDetail() {
    set({ detail: null, detailKey: null, detailLoading: false });
  },
}));
