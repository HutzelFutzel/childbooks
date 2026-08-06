"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  History,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { Tabs } from "../../components/Tabs";
import { CardHeader, CardTitle } from "../../components/Card";
import {
  useAdminProjects,
  type ProjectRow,
  type ProjectSort,
} from "../../../state/adminProjectsStore";
import type { Timeframe } from "../../../core/analytics/types";
import { downloadCsv } from "./csv";
import { fmtDuration, fmtNumber, fmtPct, fmtRelative, fmtSparks, fmtUsd } from "./format";
import { MILESTONES } from "./milestones";
import { ProjectBehaviour } from "./ProjectBehaviour";
import { ProjectFilterBar } from "./ProjectFilterBar";
import { ProjectHistoryModal } from "./ProjectHistoryModal";
import { ProjectUsers } from "./ProjectUsers";
import { RangePicker } from "./RangePicker";

type View = "books" | "users" | "behaviour";

const VIEWS: { id: View; label: string }[] = [
  { id: "books", label: "Books" },
  { id: "users", label: "By user" },
  { id: "behaviour", label: "Behaviour" },
];

const SORTS: { value: ProjectSort; label: string }[] = [
  { value: "recent", label: "Most recent" },
  { value: "cost", label: "Costliest" },
  { value: "net", label: "Worst net" },
  { value: "runs", label: "Most activity" },
  { value: "images", label: "Most images" },
  { value: "rework", label: "Most rework" },
  { value: "seq", label: "First books" },
];

function net(p: ProjectRow): number {
  return p.pnl?.netUsd ?? -p.cost.providerUsd;
}

/** Share of a book's actions that re-did something instead of making it. */
function rework(p: ProjectRow): number {
  const c = p.counters;
  return c.runs > 0 ? (c.edits + c.variations + c.restyles) / c.runs : 0;
}

function sortProjects(rows: ProjectRow[], sort: ProjectSort): ProjectRow[] {
  const copy = [...rows];
  switch (sort) {
    case "cost":
      return copy.sort((a, b) => b.cost.providerUsd - a.cost.providerUsd);
    case "net":
      return copy.sort((a, b) => net(a) - net(b));
    case "runs":
      return copy.sort((a, b) => b.counters.runs - a.counters.runs);
    case "images":
      return copy.sort((a, b) => b.counters.imagesGenerated - a.counters.imagesGenerated);
    case "rework":
      return copy.sort((a, b) => rework(b) - rework(a));
    case "seq":
      return copy.sort((a, b) => a.seq - b.seq);
    default:
      return copy.sort((a, b) => b.lastActionAt - a.lastActionAt);
  }
}

/**
 * Per-project analysis: what each book cost us, what it earned back, and how the
 * user got there.
 *
 * This is the level the economics actually live at — a per-call average can look
 * healthy while individual books lose money, and only here is the free-Spark
 * subsidy visible as its own number. Three views over ONE filtered selection:
 * the books themselves, the same set grouped by person, and the distributions
 * that say what a normal book looks like.
 */
export function ProjectsAnalysis() {
  const timeframe = useAdminProjects((s) => s.timeframe);
  const customFrom = useAdminProjects((s) => s.customFrom);
  const customTo = useAdminProjects((s) => s.customTo);
  const setTimeframe = useAdminProjects((s) => s.setTimeframe);
  const setCustomRange = useAdminProjects((s) => s.setCustomRange);
  const loading = useAdminProjects((s) => s.loading);
  const error = useAdminProjects((s) => s.error);
  const capped = useAdminProjects((s) => s.capped);
  const truncated = useAdminProjects((s) => s.truncated);
  const unallocated = useAdminProjects((s) => s.unallocatedSubscriptionUsd);
  const allocate = useAdminProjects((s) => s.allocateSubscriptions);
  const uid = useAdminProjects((s) => s.uid);
  const setQuery = useAdminProjects((s) => s.setQuery);
  const refresh = useAdminProjects((s) => s.refresh);

  const [view, setView] = useState<View>("books");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker
          timeframe={timeframe}
          from={customFrom}
          to={customTo}
          onPreset={setTimeframe}
          onRange={setCustomRange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="flex items-center gap-2 text-xs text-ink-500"
            title="Split each subscriber's monthly invoice across the books they generated with that month, pro-rata by Sparks spent. An estimate, not an observed fact."
          >
            <Toggle checked={allocate} onChange={(v) => setQuery({ allocateSubscriptions: v })} />
            Allocate subscriptions
          </label>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      <ProjectFilterBar />

      {/* A pinned user applies to every view, so it's called out above the tabs
          rather than hidden inside whichever table set it. */}
      {uid && (
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700 ring-1 ring-brand-100">
          Showing one user only:
          <span className="font-mono">{uid}</span>
          <button
            onClick={() => setQuery({ uid: "" })}
            className="ml-auto flex items-center gap-1 rounded-lg px-1.5 py-0.5 transition hover:bg-brand-100"
          >
            <X className="size-3" /> Show everyone
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}
      {capped && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
          The finance scan hit its safety cap — per-project revenue is a lower bound. Narrow the
          window for exact numbers.
        </div>
      )}
      {truncated && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
          More books matched than fit in one page — everything below describes the {fmtNumber(300)}{" "}
          most recently active of them. Narrow the window or add a filter to describe the whole set.
        </div>
      )}

      <Tabs items={VIEWS} value={view} onChange={(id) => setView(id as View)} />

      {view === "books" && <BooksView />}
      {view === "users" && <ProjectUsers />}
      {view === "behaviour" && <ProjectBehaviour />}

      {allocate && unallocated > 0 && (
        <p className="text-[11px] text-ink-400">
          {fmtUsd(unallocated)} of subscription revenue stayed unallocated — those subscribers
          generated nothing in the month they paid for, so there was no book to credit it to.
        </p>
      )}

      <ProjectHistoryModal />
    </div>
  );
}

function BooksView() {
  const projects = useAdminProjects((s) => s.projects);
  const stats = useAdminProjects((s) => s.stats);
  const loading = useAdminProjects((s) => s.loading);
  const sort = useAdminProjects((s) => s.sort);
  const setQuery = useAdminProjects((s) => s.setQuery);
  const openDetail = useAdminProjects((s) => s.openDetail);

  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? projects.filter(
          (p) =>
            p.uid.toLowerCase().includes(term) ||
            p.projectId.toLowerCase().includes(term) ||
            (p.derived.title ?? "").toLowerCase().includes(term),
        )
      : projects;
    return sortProjects(filtered, sort);
  }, [projects, search, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, p) => ({
          cost: acc.cost + p.cost.providerUsd,
          qc: acc.qc + p.cost.unbilledUsd,
          subsidy: acc.subsidy + (p.pnl?.subsidyUsd ?? 0),
          revenue: acc.revenue + (p.pnl?.recognizedUsd ?? 0) + (p.pnl?.directUsd ?? 0),
          net: acc.net + net(p),
        }),
        { cost: 0, qc: 0, subsidy: 0, revenue: 0, net: 0 },
      ),
    [rows],
  );

  const funnel = useMemo(
    () =>
      MILESTONES.map((m) => ({
        ...m,
        count: stats?.milestones?.[m.key] ?? projects.filter((p) => p.milestones?.[m.key]).length,
      })),
    [stats, projects],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Books" value={fmtNumber(rows.length)} />
        <Stat label="Provider cost" value={fmtUsd(totals.cost)} tone="cost" />
        <Stat
          label="Quality-control tax"
          value={fmtUsd(totals.qc)}
          tone="cost"
          hint="Repair passes (grid re-renders, duplicate erases) we absorbed rather than charged."
        />
        <Stat
          label="Free-Spark subsidy"
          value={fmtUsd(totals.subsidy)}
          tone="cost"
          hint="Provider cost of work funded by granted Sparks — your acquisition spend."
        />
        <Stat label="Revenue" value={fmtUsd(totals.revenue)} tone="revenue" />
        <Stat label="Net" value={fmtUsd(totals.net)} tone={totals.net >= 0 ? "revenue" : "cost"} />
      </div>

      {/* Where books die. Each bar is the share of books that ever reached that
          stage, so the biggest drop is the step worth fixing. */}
      <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft">
        <div className="mb-3 text-sm font-semibold text-ink-800">Lifecycle</div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {funnel.map((m, i) => {
            const pct = funnel[0].count > 0 ? (m.count / funnel[0].count) * 100 : 0;
            const prev = i > 0 ? funnel[i - 1].count : m.count;
            const drop = prev > 0 ? ((prev - m.count) / prev) * 100 : 0;
            return (
              <div key={m.key} className="rounded-xl bg-ink-50/60 p-3 ring-1 ring-inset ring-ink-100">
                <div className="text-[11px] uppercase tracking-wide text-ink-400">{m.label}</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">
                  {fmtNumber(m.count)}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                {i > 0 && drop > 0 && (
                  <div className="mt-1 text-[10px] text-ink-400">−{drop.toFixed(0)}%</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <CardTitle className="text-sm">
            Books <span className="font-normal text-ink-400">({fmtNumber(rows.length)})</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-300" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Title, project id or UID"
                className="h-9 w-56 pl-8 text-sm"
              />
            </div>
            <Select
              aria-label="Sort books"
              value={sort}
              onChange={(e) => setQuery({ sort: e.target.value as ProjectSort })}
              className="h-9 w-40"
              options={SORTS}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="size-4" />}
              onClick={() =>
                downloadCsv(
                  "books",
                  rows.map((p) => ({
                    uid: p.uid,
                    projectId: p.projectId,
                    seq: p.seq,
                    title: p.derived.title ?? "",
                    ageRangeId: p.derived.ageRangeId ?? "",
                    artStyle: p.derived.artStyleKey ?? "",
                    productSku: p.derived.productSku ?? "",
                    pages: p.derived.pageCount,
                    illustratedPages: p.derived.illustratedCount,
                    illustrationVersions: p.derived.illustrationVersions,
                    storyRevisions: p.derived.screenplayVersions,
                    cast: p.derived.anchors.total,
                    runs: p.counters.runs,
                    fresh: p.counters.fresh,
                    edits: p.counters.edits,
                    regenerates: p.counters.variations,
                    restyles: p.counters.restyles,
                    failures: p.counters.failures,
                    images: p.counters.imagesGenerated,
                    qcCalls: p.counters.qcCalls,
                    reworkRate: rework(p),
                    imageModels: Object.keys(p.counters.imagesByModel).join(" "),
                    providerUsd: p.cost.providerUsd,
                    unbilledUsd: p.cost.unbilledUsd,
                    sparksCharged: p.sparks.charged,
                    sparksPaid: p.sparks.paid,
                    sparksFree: p.sparks.free,
                    recognizedUsd: p.pnl?.recognizedUsd ?? 0,
                    directUsd: p.pnl?.directUsd ?? 0,
                    subsidyUsd: p.pnl?.subsidyUsd ?? 0,
                    netUsd: net(p),
                    timeToFirstImageMs: p.timing.timeToFirstImageMs ?? "",
                    timeToOrderMs: p.timing.timeToOrderMs ?? "",
                  })),
                )
              }
            >
              Export CSV
            </Button>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs font-medium text-ink-500">
                <th className="px-4 py-2.5">Book</th>
                <th className="px-4 py-2.5">Structure</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
                <th
                  className="px-4 py-2.5 text-right"
                  title="Share of this book's actions that re-did something (edits, regenerates, restyles)."
                >
                  Rework
                </th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Charged</th>
                <th className="px-4 py-2.5 text-right">Net</th>
                <th className="px-4 py-2.5">Last active</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50" : ""}>
              {rows.map((p) => {
                const n = net(p);
                const open = openKey === p.key;
                const rw = rework(p);
                return (
                  <Fragment key={p.key}>
                    <tr
                      className="cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/40"
                      onClick={() => setOpenKey(open ? null : p.key)}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 font-medium text-ink-800">
                          <span
                            className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500"
                            title={`This user's book #${p.seq}`}
                          >
                            #{p.seq}
                          </span>
                          {p.derived.title ?? "Untitled"}
                        </div>
                        <div className="font-mono text-[10px] text-ink-300">{p.uid}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-500">
                        {p.derived.anchors.total} cast · {p.derived.pageCount} pages
                        {p.derived.illustratedCount > 0 && (
                          <> · {p.derived.illustratedCount} illustrated</>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                        {fmtNumber(p.counters.runs)}
                        {p.counters.failures > 0 && (
                          <span className="ml-1 text-[10px] text-red-500">
                            {p.counters.failures} failed
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${
                          rw > 0.5 ? "text-amber-600" : "text-ink-600"
                        }`}
                      >
                        {p.counters.runs > 0 ? fmtPct(rw) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                        {fmtUsd(p.cost.providerUsd)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                        {fmtSparks(p.sparks.charged)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums font-medium ${n >= 0 ? "text-emerald-600" : "text-red-600"}`}
                      >
                        {fmtUsd(n)}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600">{fmtRelative(p.lastActionAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <ChevronRight
                          className={`size-4 text-ink-300 transition-transform ${open ? "rotate-90" : ""}`}
                        />
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-ink-50 bg-ink-50/30">
                        <td colSpan={9} className="px-4 py-4">
                          <BookDetail project={p} onOpenHistory={() => void openDetail(p.key)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-400">
                    No books match this selection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && rows.length === 0 && (
          <div className="flex items-center justify-center py-16 text-ink-400">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

function BookDetail({
  project: p,
  onOpenHistory,
}: {
  project: ProjectRow;
  onOpenHistory: () => void;
}) {
  const pnl = p.pnl;
  const actions = Object.entries(p.counters.byAction).sort((a, b) => b[1] - a[1]);
  const models = Object.entries(p.counters.imagesByModel).sort((a, b) => b[1] - a[1]);
  const lots = Object.entries(p.sparks.byLotSource).sort((a, b) => b[1] - a[1]);
  const perPage =
    p.derived.illustratedCount > 0
      ? (p.counters.imagesByAction.pageIllustration ?? 0) / p.derived.illustratedCount
      : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <DetailTitle>Money</DetailTitle>
          <DetailRow label="Provider cost" value={fmtUsd(p.cost.providerUsd)} />
          <DetailRow label="…of which absorbed" value={fmtUsd(p.cost.unbilledUsd)} />
          <DetailRow label="Recognized (packs)" value={fmtUsd(pnl?.recognizedUsd ?? 0)} />
          <DetailRow label="Print / ebook" value={fmtUsd(pnl?.directUsd ?? 0)} />
          {pnl && pnl.subscriptionAllocUsd > 0 && (
            <DetailRow label="Subscription share" value={fmtUsd(pnl.subscriptionAllocUsd)} />
          )}
          <DetailRow label="Free-Spark subsidy" value={fmtUsd(pnl?.subsidyUsd ?? 0)} />
          {pnl && pnl.feesUsd > 0 && (
            <DetailRow label="Fees & print cost" value={fmtUsd(pnl.feesUsd)} />
          )}
        </div>
        <div>
          <DetailTitle>Behaviour</DetailTitle>
          <DetailRow label="Images generated" value={fmtNumber(p.counters.imagesGenerated)} />
          <DetailRow label="First renders" value={fmtNumber(p.counters.fresh)} />
          <DetailRow label="Edits" value={fmtNumber(p.counters.edits)} />
          <DetailRow label="Regenerates" value={fmtNumber(p.counters.variations)} />
          <DetailRow label="Restyles" value={fmtNumber(p.counters.restyles)} />
          <DetailRow label="Repair passes absorbed" value={fmtNumber(p.counters.qcCalls)} />
          <DetailRow label="Failures" value={fmtNumber(p.counters.failures)} />
          {perPage != null && (
            <DetailRow label="Renders per kept page" value={perPage.toFixed(2)} />
          )}
          <DetailRow label="Story revisions" value={fmtNumber(p.derived.screenplayVersions)} />
          <DetailRow
            label="Illustration versions kept"
            value={fmtNumber(p.derived.illustrationVersions)}
          />
          {p.timing.timeToFirstImageMs != null && (
            <DetailRow
              label="Time to first image"
              value={fmtDuration(p.timing.timeToFirstImageMs)}
            />
          )}
          {p.timing.timeToOrderMs != null && (
            <DetailRow label="Time to order" value={fmtDuration(p.timing.timeToOrderMs)} />
          )}
        </div>
        <div>
          <DetailTitle>Mix</DetailTitle>
          {actions.map(([action, count]) => (
            <DetailRow key={action} label={action} value={fmtNumber(count)} />
          ))}
          {models.length > 0 ? (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-wide text-ink-400">
                Images by model
              </div>
              {models.map(([model, count]) => (
                <DetailRow key={model} label={model} value={fmtNumber(count)} />
              ))}
            </>
          ) : (
            // Books rendered before per-model counting only know which models
            // were touched, not how much each drew.
            p.models.imageModels.length > 0 && (
              <div className="mt-2 text-[10px] text-ink-400">
                {p.models.imageModels.join(", ")}
              </div>
            )
          )}
          {lots.length > 0 && (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-wide text-ink-400">
                Sparks by source
              </div>
              {lots.map(([source, amount]) => (
                <DetailRow key={source} label={source} value={fmtSparks(amount)} />
              ))}
            </>
          )}
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<History className="size-4" />}
        onClick={onOpenHistory}
      >
        Full history
      </Button>
    </div>
  );
}

function DetailTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold text-ink-700">{children}</div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="truncate text-ink-500" title={label}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-ink-800">{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "cost" | "revenue";
  hint?: string;
}) {
  return (
    <div
      className="rounded-xl bg-white p-3 ring-1 ring-ink-100 shadow-soft"
      {...(hint ? { title: hint } : {})}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "cost" ? "text-red-600" : tone === "revenue" ? "text-emerald-600" : "text-ink-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
