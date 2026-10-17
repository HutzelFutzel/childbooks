"use client";

import { useEffect, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  FileCode,
  Filter,
  Info,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Terminal,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatLogsAsMarkdown,
  LOG_DOMAINS,
  LOG_SEVERITIES,
  LOG_SOURCES,
  type ClientBreadcrumb,
  type LogDomain,
  type LogEntry,
  type LogSeverity,
  type LogSource,
} from "../../../core/logging/types";
import type { Timeframe } from "../../../core/analytics/types";
import { useAdminLogs } from "../../../state/adminLogsStore";
import { useAdminProjects } from "../../../state/adminProjectsStore";
import { useAdminAccess } from "../../../state/adminAccessStore";
import { useAdminTab } from "../adminTabStore";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Tabs } from "../../components/Tabs";
import { Toggle } from "../../components/Toggle";
import { cn } from "../../lib/cn";
import { downloadCsv } from "./csv";
import { fmtDateTime, fmtNumber, fmtRelative, toDateInput } from "./format";
import { UserStudioModal } from "./UserStudioModal";
import { ProjectHistoryModal } from "./ProjectHistoryModal";

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "custom", label: "Custom" },
];

const SEVERITY_META: Record<
  LogSeverity,
  {
    label: string;
    shortDesc: string;
    badgeClass: string;
    activeClass: string;
    icon: React.ReactNode;
  }
> = {
  fatal: {
    label: "Fatal (Slack #ops)",
    shortDesc: "Immediate action required — pages #ops",
    badgeClass: "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200",
    activeClass: "border-rose-300 bg-rose-50/70 ring-2 ring-rose-100",
    icon: <AlertOctagon className="size-4 text-rose-600" />,
  },
  error: {
    label: "Error",
    shortDesc: "Failed operation or unhandled exception",
    badgeClass: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
    activeClass: "border-red-300 bg-red-50/50 ring-2 ring-red-100",
    icon: <AlertTriangle className="size-4 text-red-600" />,
  },
  warn: {
    label: "Warning",
    shortDesc: "Degraded, retried, or auto-repaired",
    badgeClass: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
    activeClass: "border-amber-300 bg-amber-50/50 ring-2 ring-amber-100",
    icon: <AlertTriangle className="size-4 text-amber-500" />,
  },
  info: {
    label: "Info",
    shortDesc: "High-signal milestones & state transitions",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
    activeClass: "border-sky-300 bg-sky-50/50 ring-2 ring-sky-100",
    icon: <Info className="size-4 text-sky-500" />,
  },
};

const SOURCE_LABELS: Record<LogSource, string> = {
  frontend: "Frontend (Browser)",
  backend: "Backend (API)",
  worker: "Worker (Jobs)",
  webhook: "Webhook",
  cron: "Scheduled (Cron)",
};

const DOMAIN_LABELS: Record<LogDomain, string> = {
  studio: "Studio & Render",
  ai: "AI Pipeline",
  print: "Print (Lulu)",
  stripe: "Payments (Stripe)",
  auth: "Auth & Account",
  email: "Email",
  system: "System",
};

export function LogsAnalysis() {
  const s = useAdminLogs();
  const canWrite = useAdminAccess((st) => st.canWrite("analysis.logs"));
  const canConfigureModels = useAdminAccess((st) => st.canRead("configuration.models"));
  const canConfigurePrompts = useAdminAccess((st) => st.canRead("configuration.prompts"));
  const openConfigTab = useAdminTab((st) => st.openConfigTab);
  const openProjectDetail = useAdminProjects((st) => st.openDetail);

  const [searchDraft, setSearchDraft] = useState(s.search);
  const [uidDraft, setUidDraft] = useState(s.uid);
  const [projectDraft, setProjectDraft] = useState(s.projectId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [studioModalUid, setStudioModalUid] = useState<string | null>(null);
  const [copiedMode, setCopiedMode] = useState<"md" | "json" | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    void s.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSearchDraft(s.search);
    setUidDraft(s.uid);
    setProjectDraft(s.projectId);
  }, [s.search, s.uid, s.projectId]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasActiveFilters =
    s.severities.length > 0 ||
    s.sources.length > 0 ||
    s.domains.length > 0 ||
    Boolean(s.uid) ||
    Boolean(s.projectId) ||
    Boolean(s.sessionId) ||
    Boolean(s.requestId) ||
    Boolean(s.jobId) ||
    Boolean(s.orderId) ||
    Boolean(s.paymentId) ||
    Boolean(s.event) ||
    Boolean(s.search) ||
    s.unresolvedOnly;

  const copyMarkdownBundle = async () => {
    if (s.entries.length === 0) {
      toast.error("No log entries in the current view to copy.");
      return;
    }
    const md = formatLogsAsMarkdown(s.entries, {
      filters: {
        severities: s.severities.length ? s.severities : undefined,
        sources: s.sources.length ? s.sources : undefined,
        domains: s.domains.length ? s.domains : undefined,
        uid: s.uid || undefined,
        projectId: s.projectId || undefined,
        sessionId: s.sessionId || undefined,
        search: s.search || undefined,
      },
      aiAnalysis: s.analysisResult?.analysis ?? null,
    });
    await navigator.clipboard.writeText(md);
    setCopiedMode("md");
    toast.success(`Copied ${s.entries.length} log entries as structured Markdown.`);
    setTimeout(() => setCopiedMode(null), 2000);
  };

  const copyRawJson = async () => {
    if (s.entries.length === 0) {
      toast.error("No log entries in the current view to copy.");
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(s.entries, null, 2));
    setCopiedMode("json");
    toast.success(`Copied ${s.entries.length} log entries as JSON.`);
    setTimeout(() => setCopiedMode(null), 2000);
  };

  const exportCsv = () => {
    if (s.entries.length === 0) {
      toast.error("No log entries to export.");
      return;
    }
    downloadCsv(
      "diagnostic-logs",
      s.entries.map((e) => ({
        timestamp: new Date(e.at).toISOString(),
        severity: e.severity,
        source: e.source,
        domain: e.domain,
        event: e.event,
        message: e.message,
        env: e.env,
        uid: e.uid ?? "",
        projectId: e.projectId ?? "",
        sessionId: e.sessionId ?? "",
        requestId: e.requestId ?? "",
        jobId: e.jobId ?? "",
        orderId: e.orderId ?? "",
        paymentId: e.paymentId ?? "",
        errorName: e.error?.name ?? "",
        errorCode: e.error?.code ?? "",
        errorMessage: e.error?.message ?? "",
        resolvedAt: e.resolvedAt ? new Date(e.resolvedAt).toISOString() : "",
      })),
    );
  };

  const handleResolve = async (entry: LogEntry, resolved: boolean) => {
    setResolvingId(entry.id);
    try {
      await s.resolveEntry(entry.id, resolved);
      toast.success(resolved ? "Marked as resolved." : "Reopened log entry.");
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not update status.");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Window + Copy/Export Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            items={TIMEFRAMES}
            value={s.timeframe}
            onChange={(id) => s.setTimeframe(id as Timeframe)}
          />
          {s.lastUpdated && (
            <span className="text-xs text-ink-400">
              Updated {fmtRelative(s.lastUpdated)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={
              copiedMode === "md" ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <Copy className="size-3.5" />
              )
            }
            onClick={() => void copyMarkdownBundle()}
            disabled={s.entries.length === 0}
            title="Copy filtered logs (and AI diagnosis) as structured Markdown for Cursor or Claude"
          >
            Copy Markdown for AI
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={
              copiedMode === "json" ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <FileCode className="size-3.5" />
              )
            }
            onClick={() => void copyRawJson()}
            disabled={s.entries.length === 0}
            title="Copy filtered logs as raw JSON"
          >
            Copy JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Download className="size-3.5" />}
            onClick={exportCsv}
            disabled={s.entries.length === 0}
          >
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={cn("size-3.5", s.loading && "animate-spin")} />}
            onClick={() => void s.refresh()}
            disabled={s.loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {s.timeframe === "custom" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-500">From</span>
          <input
            type="date"
            value={toDateInput(s.customFrom)}
            onChange={(e) =>
              s.setCustomRange(new Date(e.target.value).getTime(), s.customTo)
            }
            className="h-9 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <span className="text-ink-500">to</span>
          <input
            type="date"
            value={toDateInput(s.customTo)}
            onChange={(e) =>
              s.setCustomRange(
                s.customFrom,
                new Date(e.target.value).getTime() + 24 * 60 * 60 * 1000 - 1,
              )
            }
            className="h-9 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      )}

      {/* Unresolved Fatal Banner */}
      {s.counts.unresolvedFatal > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-900">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="size-5 shrink-0 text-rose-600" />
            <div>
              <span className="font-semibold">
                {s.counts.unresolvedFatal} unresolved fatal incident
                {s.counts.unresolvedFatal === 1 ? "" : "s"}
              </span>{" "}
              in this window — these also page Slack <code>#ops</code>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                s.setSeverities(["fatal"]);
                s.setFilters({ unresolvedOnly: true });
              }}
            >
              Show unresolved fatals
            </Button>
          </div>
        </div>
      )}

      {/* 4 Severity Cards (Click to toggle severity filter) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["fatal", "error", "warn", "info"] as const).map((sev) => {
          const meta = SEVERITY_META[sev];
          const active = s.severities.includes(sev);
          const count = s.counts[sev];
          return (
            <button
              key={sev}
              type="button"
              onClick={() => s.toggleSeverity(sev)}
              className={cn(
                "flex flex-col justify-between rounded-2xl border bg-white p-4 text-left transition",
                active
                  ? meta.activeClass
                  : "border-ink-100 hover:border-ink-200",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                  {meta.icon}
                  {meta.label}
                </span>
                {active && (
                  <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Filtered
                  </span>
                )}
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-ink-900">
                {fmtNumber(count)}
              </div>
              <p className="mt-1 text-[11px] text-ink-500">{meta.shortDesc}</p>
            </button>
          );
        })}
      </div>

      {/* Multi-Dimensional Filter Panel */}
      <section className="space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-700">
            <Filter className="size-3.5 text-ink-400" />
            <span>Filter &amp; Correlate</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600">
              <Toggle
                checked={s.unresolvedOnly}
                onChange={(v) => s.setFilters({ unresolvedOnly: v })}
              />
              Unresolved only
            </label>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<RotateCcw className="size-3.5" />}
                onClick={() => s.clearFilters()}
              >
                Reset filters
              </Button>
            )}
          </div>
        </div>

        {/* Search, User ID, Project ID inputs */}
        <form
          className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            s.setFilters({
              search: searchDraft.trim(),
              uid: uidDraft.trim(),
              projectId: projectDraft.trim(),
            });
          }}
        >
          <div className="relative sm:col-span-3 lg:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search message, event, error code, stack trace…"
              className="h-9 pl-8 text-xs"
            />
          </div>
          <Input
            value={uidDraft}
            onChange={(e) => setUidDraft(e.target.value)}
            placeholder="User ID (uid)…"
            className="h-9 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Input
              value={projectDraft}
              onChange={(e) => setProjectDraft(e.target.value)}
              placeholder="Book / Project ID…"
              className="h-9 flex-1 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="secondary">
              Apply
            </Button>
          </div>
        </form>

        {/* Source & Domain Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-1 text-[11px] font-medium text-ink-400">Source:</span>
          {LOG_SOURCES.map((src) => {
            const active = s.sources.includes(src);
            const count = s.facets.bySource[src] ?? 0;
            return (
              <button
                key={src}
                type="button"
                onClick={() => s.toggleSource(src)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition",
                  active
                    ? "bg-ink-900 text-white ring-ink-900"
                    : "bg-ink-50/70 text-ink-600 ring-ink-200 hover:bg-ink-100",
                )}
              >
                {SOURCE_LABELS[src]}
                {count > 0 && (
                  <span className={cn("ml-1 tabular-nums", active ? "text-ink-300" : "text-ink-400")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-ink-400">Domain:</span>
          {LOG_DOMAINS.map((dom) => {
            const active = s.domains.includes(dom);
            const count = s.facets.byDomain[dom] ?? 0;
            return (
              <button
                key={dom}
                type="button"
                onClick={() => s.toggleDomain(dom)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition",
                  active
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
                )}
              >
                {DOMAIN_LABELS[dom]}
                {count > 0 && (
                  <span className={cn("ml-1 tabular-nums", active ? "text-brand-100" : "text-ink-400")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active Anchor Chips */}
        {(s.uid ||
          s.projectId ||
          s.sessionId ||
          s.requestId ||
          s.jobId ||
          s.orderId ||
          s.paymentId ||
          s.event) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2.5">
            <span className="text-[11px] font-medium text-ink-400">Active anchors:</span>
            {s.uid && (
              <AnchorChip
                label="User"
                value={s.uid}
                onClear={() => s.setFilters({ uid: "" })}
                onAction={() => setStudioModalUid(s.uid)}
                actionLabel="Open Studio History"
              />
            )}
            {s.projectId && (
              <AnchorChip
                label="Book"
                value={s.projectId}
                onClear={() => s.setFilters({ projectId: "" })}
                onAction={
                  s.uid
                    ? () => void openProjectDetail(`${s.uid}_${s.projectId}`)
                    : undefined
                }
                actionLabel={s.uid ? "Open Book P&L" : undefined}
              />
            )}
            {s.sessionId && (
              <AnchorChip
                label="Session"
                value={s.sessionId}
                onClear={() => s.setFilters({ sessionId: "" })}
              />
            )}
            {s.requestId && (
              <AnchorChip
                label="Request"
                value={s.requestId}
                onClear={() => s.setFilters({ requestId: "" })}
              />
            )}
            {s.jobId && (
              <AnchorChip
                label="Job"
                value={s.jobId}
                onClear={() => s.setFilters({ jobId: "" })}
              />
            )}
            {s.orderId && (
              <AnchorChip
                label="Order"
                value={s.orderId}
                onClear={() => s.setFilters({ orderId: "" })}
              />
            )}
            {s.paymentId && (
              <AnchorChip
                label="Payment"
                value={s.paymentId}
                onClear={() => s.setFilters({ paymentId: "" })}
              />
            )}
            {s.event && (
              <AnchorChip
                label="Event"
                value={s.event}
                onClear={() => s.setFilters({ event: "" })}
              />
            )}
          </div>
        )}

        {/* Top Recurring Events */}
        {s.facets.topEvents.length > 0 && !s.event && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2.5">
            <span className="text-[11px] font-medium text-ink-400">Top events:</span>
            {s.facets.topEvents.slice(0, 8).map((ev) => (
              <button
                key={ev.event}
                type="button"
                onClick={() => s.setFilters({ event: ev.event })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-2 py-0.5 font-mono text-[11px] text-ink-700 ring-1 ring-inset ring-ink-200/80 transition hover:bg-ink-100"
              >
                <span>{ev.event}</span>
                <span className="rounded bg-white px-1 text-[10px] font-sans font-semibold text-ink-500">
                  {ev.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* AI Log Analyzer Card */}
      <section className="rounded-2xl border border-brand-200/80 bg-linear-to-br from-brand-50/40 via-white to-white p-4 shadow-2xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
              <Bot className="size-4.5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink-900">
                  AI Root-Cause &amp; Session Analyzer
                </h3>
                {s.analysisResult && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 font-mono text-[10px] font-medium text-brand-800">
                    {s.analysisResult.model.provider}:{s.analysisResult.model.id} ·{" "}
                    {s.analysisResult.analyzedCount} logs ·{" "}
                    {(s.analysisResult.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-500">
                Analyzes the currently filtered logs in chronological order to identify root
                causes, user impact, suspected files, and concrete next steps.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {canConfigureModels && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Cpu className="size-3.5" />}
                onClick={() => openConfigTab("models")}
                title="Configure which LLM model runs `logAnalysis`"
              >
                Configure model
              </Button>
            )}
            {canConfigurePrompts && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<MessageSquareText className="size-3.5" />}
                onClick={() => openConfigTab("prompts")}
                title="Edit the system & user prompt template for `logAnalysis`"
              >
                Edit prompt
              </Button>
            )}
          </div>
        </div>

        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void s.analyzeCurrentLogs();
          }}
        >
          <Input
            value={s.analysisQuestion}
            onChange={(e) => s.setAnalysisQuestion(e.target.value)}
            placeholder="Optional focus question (e.g., Why did this user's cover fail to render? What did they do before the error?)"
            className="h-9 flex-1 bg-white text-xs"
          />
          <Button
            type="submit"
            size="sm"
            loading={s.analyzing}
            disabled={s.entries.length === 0 || s.analyzing}
            leftIcon={!s.analyzing ? <Sparkles className="size-3.5" /> : undefined}
          >
            Analyze {s.entries.length > 0 ? `${Math.min(s.entries.length, 120)} logs` : "logs"}
          </Button>
          {s.analysisResult && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => s.clearAnalysis()}
            >
              Clear
            </Button>
          )}
        </form>

        {s.analysisError && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{s.analysisError}</span>
          </div>
        )}

        {s.analysisResult && (
          <div className="mt-4 space-y-3 border-t border-brand-100 pt-4 text-xs">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  Summary
                </div>
                <p className="mt-1 leading-relaxed text-ink-800">
                  {s.analysisResult.analysis.summary}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                    Root Cause
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      s.analysisResult.analysis.confidence === "high"
                        ? "bg-emerald-50 text-emerald-700"
                        : s.analysisResult.analysis.confidence === "medium"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-ink-100 text-ink-600",
                    )}
                  >
                    {s.analysisResult.analysis.confidence} confidence
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-ink-800">
                  {s.analysisResult.analysis.rootCause}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  User Impact
                </div>
                <p className="mt-1 leading-relaxed text-ink-800">
                  {s.analysisResult.analysis.userImpact}
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {s.analysisResult.analysis.suspectedFiles.length > 0 && (
                <div className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                    Suspected Files &amp; Modules
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {s.analysisResult.analysis.suspectedFiles.map((file, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <code className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-800">
                          {file.path}
                        </code>
                        <span className="text-ink-600">{file.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {s.analysisResult.analysis.recommendedActions.length > 0 && (
                <div className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                    Recommended Next Steps
                  </div>
                  <ul className="mt-1.5 list-inside list-disc space-y-1 text-ink-700">
                    {s.analysisResult.analysis.recommendedActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {s.analysisResult.analysis.reproductionSteps.length > 0 && (
              <div className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  Reconstructed Sequence of Events
                </div>
                <ol className="mt-1.5 list-inside list-decimal space-y-1 text-ink-700">
                  {s.analysisResult.analysis.reproductionSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Error Banner */}
      {s.error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{s.error}</span>
        </div>
      )}

      {s.capped && (
        <div className="rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Showing the newest {fmtNumber(s.entries.length)} matching entries (scanned{" "}
          {fmtNumber(s.scanned)} docs). Narrow the time window or filter by User/Book ID for
          deeper history.
        </div>
      )}

      {/* Main Log Stream */}
      <section className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-ink-50/50 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-700">
            <Terminal className="size-4 text-ink-400" />
            <span>
              Diagnostic Stream ({fmtNumber(s.entries.length)}{" "}
              {s.entries.length === 1 ? "entry" : "entries"})
            </span>
          </div>
          {s.entries.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() =>
                  setExpandedIds(
                    expandedIds.size === s.entries.length
                      ? new Set()
                      : new Set(s.entries.map((e) => e.id)),
                  )
                }
                className="font-medium text-ink-500 hover:text-ink-900"
              >
                {expandedIds.size === s.entries.length ? "Collapse all" : "Expand all"}
              </button>
            </div>
          )}
        </header>

        {s.loading && s.entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-400">
            <Loader2 className="size-5 animate-spin text-brand-500" />
            <span>Loading diagnostic logs…</span>
          </div>
        ) : s.entries.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-ink-600">No diagnostic logs match this filter.</p>
            <p className="mt-1 text-xs text-ink-400">
              Only high-signal milestones, warnings, errors, and fatals are recorded.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {s.entries.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpand(entry.id)}
                canWrite={canWrite}
                resolving={resolvingId === entry.id}
                onResolve={(resolved) => void handleResolve(entry, resolved)}
                onFilterUid={(uid) => s.setFilters({ uid })}
                onOpenStudio={(uid) => setStudioModalUid(uid)}
                onFilterProject={(projectId) => s.setFilters({ projectId })}
                onOpenBook={(uid, projectId) => void openProjectDetail(`${uid}_${projectId}`)}
                onFilterSession={(sessionId) => s.setFilters({ sessionId })}
                onFilterEvent={(event) => s.setFilters({ event })}
                onFilterOrder={(orderId) => s.setFilters({ orderId })}
                onFilterJob={(jobId) => s.setFilters({ jobId })}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Cross-Linked Modals for Deep User & Book Inspection */}
      <UserStudioModal uid={studioModalUid} onClose={() => setStudioModalUid(null)} />
      <ProjectHistoryModal />
    </div>
  );
}

function AnchorChip({
  label,
  value,
  onClear,
  onAction,
  actionLabel,
}: {
  label: string;
  value: string;
  onClear: () => void;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200/80">
      <span className="text-brand-600">{label}:</span>
      <span className="font-mono">{value.length > 22 ? `${value.slice(0, 22)}…` : value}</span>
      {onAction && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="ml-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-700"
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        className="text-brand-500 hover:text-brand-900"
        aria-label={`Clear ${label} filter`}
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
  canWrite,
  resolving,
  onResolve,
  onFilterUid,
  onOpenStudio,
  onFilterProject,
  onOpenBook,
  onFilterSession,
  onFilterEvent,
  onFilterOrder,
  onFilterJob,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
  canWrite: boolean;
  resolving: boolean;
  onResolve: (resolved: boolean) => void;
  onFilterUid: (uid: string) => void;
  onOpenStudio: (uid: string) => void;
  onFilterProject: (projectId: string) => void;
  onOpenBook: (uid: string, projectId: string) => void;
  onFilterSession: (sessionId: string) => void;
  onFilterEvent: (event: string) => void;
  onFilterOrder: (orderId: string) => void;
  onFilterJob: (jobId: string) => void;
}) {
  const sevMeta = SEVERITY_META[entry.severity];
  const breadcrumbs = Array.isArray(entry.context?.breadcrumbs)
    ? (entry.context.breadcrumbs as ClientBreadcrumb[])
    : null;

  const copySingleEntry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const md = formatLogsAsMarkdown([entry]);
    await navigator.clipboard.writeText(md);
    toast.success("Copied log entry to clipboard.");
  };

  return (
    <li className={cn("transition", entry.resolvedAt && "bg-ink-50/40 opacity-65")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-ink-50/60"
      >
        <span className="mt-1 text-ink-400">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>

        <span
          className="mt-0.5 w-32 shrink-0 tabular-nums text-xs text-ink-400"
          title={new Date(entry.at).toISOString()}
        >
          {fmtDateTime(entry.at)}
        </span>

        <span
          className={cn(
            "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            sevMeta.badgeClass,
          )}
        >
          {entry.severity}
        </span>

        <span className="mt-0.5 shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
          {entry.source}/{entry.domain}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFilterEvent(entry.event);
              }}
              className="font-mono text-xs font-semibold text-ink-900 hover:text-brand-600 hover:underline"
              title="Filter to this event"
            >
              {entry.event}
            </button>
            <span className="text-xs text-ink-700">{entry.message}</span>
          </div>

          {/* Correlation Anchor Pills */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {entry.uid && (
              <span className="inline-flex items-center overflow-hidden rounded-md bg-ink-50 text-[11px] text-ink-600 ring-1 ring-inset ring-ink-200/80">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterUid(entry.uid!);
                  }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono hover:bg-ink-100 hover:text-ink-900"
                  title="Filter logs to this user"
                >
                  <User className="size-3 text-ink-400" />
                  {entry.uid.slice(0, 12)}…
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenStudio(entry.uid!);
                  }}
                  className="border-l border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-brand-50"
                  title="Open full Studio Timeline for this user"
                >
                  Timeline
                </button>
              </span>
            )}

            {entry.projectId && (
              <span className="inline-flex items-center overflow-hidden rounded-md bg-ink-50 text-[11px] text-ink-600 ring-1 ring-inset ring-ink-200/80">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterProject(entry.projectId!);
                  }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono hover:bg-ink-100 hover:text-ink-900"
                  title="Filter logs to this book"
                >
                  <BookOpen className="size-3 text-ink-400" />
                  {entry.projectId.slice(0, 12)}…
                </button>
                {entry.uid && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBook(entry.uid!, entry.projectId!);
                    }}
                    className="border-l border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-brand-50"
                    title="Inspect book runs & P&L"
                  >
                    Book
                  </button>
                )}
              </span>
            )}

            {entry.sessionId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilterSession(entry.sessionId!);
                }}
                className="rounded-md bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 ring-1 ring-inset ring-ink-200/70 hover:bg-ink-100 hover:text-ink-800"
                title="Filter to this browser session"
              >
                session:{entry.sessionId.slice(0, 10)}
              </button>
            )}

            {entry.jobId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilterJob(entry.jobId!);
                }}
                className="rounded-md bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 ring-1 ring-inset ring-ink-200/70 hover:bg-ink-100 hover:text-ink-800"
                title="Filter to this background job"
              >
                job:{entry.jobId.slice(0, 10)}
              </button>
            )}

            {entry.orderId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilterOrder(entry.orderId!);
                }}
                className="rounded-md bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 ring-1 ring-inset ring-ink-200/70 hover:bg-ink-100 hover:text-ink-800"
                title="Filter to this order"
              >
                order:{entry.orderId.slice(0, 12)}
              </button>
            )}

            {entry.error?.code && (
              <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-red-700">
                code:{entry.error.code}
              </span>
            )}

            {entry.resolvedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                <CheckCircle2 className="size-3" />
                Resolved {entry.resolvedBy ? `by ${entry.resolvedBy}` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => void copySingleEntry(e)}
            title="Copy this log entry as Markdown"
          >
            <Copy className="size-3.5" />
          </Button>
          {canWrite && (entry.severity === "fatal" || entry.severity === "error" || entry.resolvedAt) && (
            <Button
              variant="ghost"
              size="sm"
              loading={resolving}
              onClick={(e) => {
                e.stopPropagation();
                onResolve(!entry.resolvedAt);
              }}
              leftIcon={<CheckCircle2 className="size-3.5" />}
            >
              {entry.resolvedAt ? "Reopen" : "Resolve"}
            </Button>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="space-y-3 border-t border-ink-100 bg-ink-50/50 px-4 py-3 pl-11 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-ink-500">
            <span>
              <strong>Log ID:</strong> <code className="font-mono">{entry.id}</code>
            </span>
            <span>
              <strong>ISO Time:</strong>{" "}
              <code className="font-mono">{new Date(entry.at).toISOString()}</code>
            </span>
            <span>
              <strong>Environment:</strong> <code className="font-mono">{entry.env}</code>
            </span>
            {entry.requestId && (
              <span>
                <strong>Request ID:</strong> <code className="font-mono">{entry.requestId}</code>
              </span>
            )}
            {entry.paymentId && (
              <span>
                <strong>Payment ID:</strong> <code className="font-mono">{entry.paymentId}</code>
              </span>
            )}
            {entry.ref && (
              <span>
                <strong>Dedupe ref:</strong> <code className="font-mono">{entry.ref}</code>
              </span>
            )}
          </div>

          {entry.error && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
              <div className="font-mono text-xs font-semibold text-red-800">
                {entry.error.name}
                {entry.error.code ? ` (${entry.error.code})` : ""}
                {entry.error.status ? ` [HTTP ${entry.error.status}]` : ""}
                {entry.error.provider ? ` · provider: ${entry.error.provider}` : ""}:{" "}
                {entry.error.message}
              </div>
              {entry.error.stack && (
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white/90 p-2.5 font-mono text-[11px] leading-relaxed text-red-900 ring-1 ring-red-100">
                  {entry.error.stack}
                </pre>
              )}
            </div>
          )}

          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className="rounded-xl border border-ink-200/80 bg-white p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                Client Breadcrumbs Leading Up To This Event ({breadcrumbs.length})
              </div>
              <ol className="max-h-48 space-y-1 overflow-auto font-mono text-[11px] text-ink-700">
                {breadcrumbs.map((b, idx) => (
                  <li key={idx} className="flex items-baseline gap-2">
                    <span className="shrink-0 text-ink-400">
                      {new Date(b.at).toISOString().slice(11, 23)}
                    </span>
                    <span className="w-14 shrink-0 rounded bg-ink-100 px-1 text-center text-[10px] uppercase text-ink-600">
                      {b.category}
                    </span>
                    <span className="font-medium text-ink-800">{b.action}</span>
                    {b.detail && <span className="truncate text-ink-500">· {b.detail}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {entry.context && Object.keys(entry.context).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                Structured Context Payload
              </div>
              <pre className="max-h-72 overflow-auto rounded-xl bg-white p-3 font-mono text-[11px] leading-relaxed text-ink-800 ring-1 ring-ink-200/80">
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(entry.context).filter(([k]) => k !== "breadcrumbs"),
                  ),
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
