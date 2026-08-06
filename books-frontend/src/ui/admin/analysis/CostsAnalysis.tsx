"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { Tabs } from "../../components/Tabs";
import { CardHeader, CardTitle } from "../../components/Card";
import { CostIntelligenceTab } from "../tabs/CostIntelligenceTab";
import { useAdminProjects, type ActionRunRow } from "../../../state/adminProjectsStore";
import { IMAGE_ACTIONS, TEXT_ACTIONS } from "../../../core/ai/actions";
import { downloadCsv } from "./csv";
import { fmtDateTime, fmtNumber, fmtSparks, fmtUsd } from "./format";
import { RangePicker } from "./RangePicker";

type View = "runs" | "actions";

const VIEWS: { id: View; label: string }[] = [
  { id: "runs", label: "User calls" },
  { id: "actions", label: "Per action" },
];

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  [...TEXT_ACTIONS, ...IMAGE_ACTIONS].map((a) => [a.id, a.label]),
);

/**
 * Everything cost-related, at both levels that matter:
 *
 *  - **User calls** — one row per thing someone clicked, which is what they
 *    were actually charged for. A render can fan out into several provider
 *    calls, so this is the only place the charge and the cost behind it line up.
 *  - **Per action** — the aggregate view that drives pricing decisions.
 *
 * The two disagreeing used to be the whole problem: a per-CALL average of 13✦
 * sat next to real 29✦ charges, because a single anchor render is more than one
 * call. Both are shown here, labelled, so the difference is legible instead of
 * confusing.
 */
export function CostsAnalysis() {
  const [view, setView] = useState<View>("runs");
  return (
    <div className="space-y-5">
      <Tabs items={VIEWS} value={view} onChange={(id) => setView(id as View)} />
      {view === "runs" ? <RunLog /> : <CostIntelligenceTab />}
    </div>
  );
}

function RunLog() {
  const runs = useAdminProjects((s) => s.runs);
  const loading = useAdminProjects((s) => s.runsLoading);
  const error = useAdminProjects((s) => s.error);
  const timeframe = useAdminProjects((s) => s.timeframe);
  const customFrom = useAdminProjects((s) => s.customFrom);
  const customTo = useAdminProjects((s) => s.customTo);
  const setTimeframe = useAdminProjects((s) => s.setTimeframe);
  const setCustomRange = useAdminProjects((s) => s.setCustomRange);
  const runAction = useAdminProjects((s) => s.runAction);
  const runKind = useAdminProjects((s) => s.runKind);
  const runOutcome = useAdminProjects((s) => s.runOutcome);
  const runTier = useAdminProjects((s) => s.runTier);
  const runProjectId = useAdminProjects((s) => s.runProjectId);
  const uid = useAdminProjects((s) => s.uid);
  const setRunQuery = useAdminProjects((s) => s.setRunQuery);
  const refreshRuns = useAdminProjects((s) => s.refreshRuns);

  const [uidDraft, setUidDraft] = useState(uid);
  const [projectDraft, setProjectDraft] = useState(runProjectId);
  const [openRun, setOpenRun] = useState<string | null>(null);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const totals = useMemo(
    () =>
      runs.reduce(
        (acc, r) => ({
          cost: acc.cost + r.costUsd.total,
          unbilled: acc.unbilled + r.costUsd.unbilled,
          sparks: acc.sparks + r.sparks.charged,
          margin: acc.margin + r.marginUsd,
          calls: acc.calls + r.calls.total,
        }),
        { cost: 0, unbilled: 0, sparks: 0, margin: 0, calls: 0 },
      ),
    [runs],
  );

  const actionOptions = useMemo(
    () => [
      { value: "", label: "All actions" },
      ...[...TEXT_ACTIONS, ...IMAGE_ACTIONS].map((a) => ({ value: a.id, label: a.label })),
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker
          timeframe={timeframe}
          from={customFrom}
          to={customTo}
          onPreset={setTimeframe}
          onRange={setCustomRange}
        />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
          onClick={() => void refreshRuns()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {/* Slicers for the run log. `kind` and `outcome` are the two that turn this
          from a log into an answer: "show me every failed premium render" and
          "show me what people regenerate" are both one selection here. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 ring-1 ring-ink-100 shadow-soft">
        <Select
          aria-label="Action filter"
          value={runAction}
          onChange={(e) => setRunQuery({ action: e.target.value })}
          className="h-9 w-48"
          options={actionOptions}
        />
        <Select
          aria-label="Kind filter"
          value={runKind}
          onChange={(e) => setRunQuery({ kind: e.target.value })}
          className="h-9 w-40"
          options={[
            { value: "", label: "Any intent" },
            { value: "fresh", label: "First render" },
            { value: "edit", label: "Edit" },
            { value: "variation", label: "Regenerate" },
            { value: "restyle", label: "Restyle" },
          ]}
        />
        <Select
          aria-label="Outcome filter"
          value={runOutcome}
          onChange={(e) => setRunQuery({ outcome: e.target.value })}
          className="h-9 w-36"
          options={[
            { value: "", label: "Any outcome" },
            { value: "ok", label: "Succeeded" },
            { value: "failed", label: "Failed" },
            { value: "aborted", label: "Aborted" },
          ]}
        />
        <Select
          aria-label="Tier filter"
          value={runTier}
          onChange={(e) => setRunQuery({ tier: e.target.value })}
          className="h-9 w-32"
          options={[
            { value: "", label: "Any tier" },
            { value: "quick", label: "Quick" },
            { value: "premium", label: "Premium" },
          ]}
        />
        <Input
          value={uidDraft}
          onChange={(e) => setUidDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setRunQuery({ uid: uidDraft.trim() })}
          onBlur={() => uidDraft.trim() !== uid && setRunQuery({ uid: uidDraft.trim() })}
          placeholder="Filter by UID"
          className="h-9 w-52 font-mono text-xs"
        />
        <Input
          value={projectDraft}
          onChange={(e) => setProjectDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setRunQuery({ projectId: projectDraft.trim() })}
          onBlur={() =>
            projectDraft.trim() !== runProjectId && setRunQuery({ projectId: projectDraft.trim() })
          }
          placeholder="Filter by project id"
          className="h-9 w-52 font-mono text-xs"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="User calls" value={fmtNumber(runs.length)} />
        <Stat
          label="Provider calls"
          value={fmtNumber(totals.calls)}
          hint="One user call can fan out into several provider calls — this is why a per-call average understates what a render costs."
        />
        <Stat label="Provider cost" value={fmtUsd(totals.cost)} tone="cost" />
        <Stat
          label="Absorbed"
          value={fmtUsd(totals.unbilled)}
          tone="cost"
          hint="Repair passes the user wasn't charged for."
        />
        <Stat
          label="Margin"
          value={fmtUsd(totals.margin)}
          tone={totals.margin >= 0 ? "revenue" : "cost"}
          hint="Spark value charged minus what the calls cost us."
        />
      </div>

      <ByActionRollup runs={runs} />

      <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <CardTitle className="text-sm">
            User calls <span className="font-normal text-ink-400">({fmtNumber(runs.length)})</span>
          </CardTitle>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="size-4" />}
            onClick={() =>
              downloadCsv(
                "action-runs",
                runs.map((r) => ({
                  at: new Date(r.at).toISOString(),
                  runId: r.runId,
                  uid: r.uid,
                  projectId: r.projectId ?? "",
                  projectSeq: r.projectSeq ?? "",
                  action: r.action,
                  tier: r.tier ?? "",
                  kind: r.kind,
                  providerCalls: r.calls.total,
                  costUsd: r.costUsd.total,
                  billableUsd: r.costUsd.billable,
                  unbilledUsd: r.costUsd.unbilled,
                  sparksQuoted: r.sparks.quoted ?? "",
                  sparksCharged: r.sparks.charged,
                  sparksPaid: r.sparks.paid,
                  sparksFree: r.sparks.free,
                  marginUsd: r.marginUsd,
                  durationMs: r.durationMs,
                  outcome: r.outcome,
                })),
              )
            }
          >
            Export CSV
          </Button>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs font-medium text-ink-500">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">User / book</th>
                <th className="px-4 py-2.5 text-right">Calls</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Absorbed</th>
                <th className="px-4 py-2.5 text-right">Charged</th>
                <th className="px-4 py-2.5 text-right">Margin</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50" : ""}>
              {runs.map((r) => (
                <RunRow
                  key={r.runId}
                  run={r}
                  open={openRun === r.runId}
                  onToggle={() => setOpenRun(openRun === r.runId ? null : r.runId)}
                />
              ))}
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-400">
                    No calls in this window yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && runs.length === 0 && (
          <div className="flex items-center justify-center py-16 text-ink-400">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What one render of each kind actually costs and charges, averaged per USER
 * call rather than per provider call. This is the number to price against: the
 * per-provider-call average is smaller by however many calls a render fans out
 * into, which is how an 8-cent average sat under a 21-cent render.
 */
function ByActionRollup({ runs }: { runs: ActionRunRow[] }) {
  const rows = useMemo(() => {
    const acc = new Map<
      string,
      {
        action: string;
        tier?: string;
        runs: number;
        calls: number;
        cost: number;
        unbilled: number;
        sparks: number;
        margin: number;
        overQuoted: number;
      }
    >();
    for (const r of runs) {
      const key = `${r.action}:${r.tier ?? ""}`;
      const hit = acc.get(key) ?? {
        action: r.action,
        tier: r.tier,
        runs: 0,
        calls: 0,
        cost: 0,
        unbilled: 0,
        sparks: 0,
        margin: 0,
        overQuoted: 0,
      };
      hit.runs += 1;
      hit.calls += r.calls.total;
      hit.cost += r.costUsd.total;
      hit.unbilled += r.costUsd.unbilled;
      hit.sparks += r.sparks.charged;
      hit.margin += r.marginUsd;
      if (r.sparks.quoted != null && r.sparks.charged > r.sparks.quoted) hit.overQuoted += 1;
      acc.set(key, hit);
    }
    return [...acc.values()].sort((a, b) => b.cost - a.cost);
  }, [runs]);

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Per render</CardTitle>
      </CardHeader>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-left text-xs font-medium text-ink-500">
            <th className="px-4 py-2.5">Action</th>
            <th className="px-4 py-2.5 text-right">Renders</th>
            <th className="px-4 py-2.5 text-right">Calls each</th>
            <th className="px-4 py-2.5 text-right">Cost each</th>
            <th className="px-4 py-2.5 text-right">Absorbed each</th>
            <th className="px-4 py-2.5 text-right">Charged each</th>
            <th className="px-4 py-2.5 text-right">Margin each</th>
            <th className="px-4 py-2.5 text-right">Over quote</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.action}:${r.tier ?? ""}`}
              className="border-b border-ink-50 last:border-0"
            >
              <td className="px-4 py-2.5 font-medium text-ink-800">
                {ACTION_LABELS[r.action] ?? r.action}
                {r.tier && (
                  <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase text-ink-500">
                    {r.tier}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
                {fmtNumber(r.runs)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
                {(r.calls / r.runs).toFixed(1)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                {fmtUsd(r.cost / r.runs)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-500">
                {r.unbilled > 0 ? fmtUsd(r.unbilled / r.runs) : "—"}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-medium text-brand-700">
                {(r.sparks / r.runs).toFixed(1)} ✦
              </td>
              <td
                className={`px-4 py-2.5 text-right tabular-nums ${r.margin >= 0 ? "text-emerald-600" : "text-red-600"}`}
              >
                {fmtUsd(r.margin / r.runs)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {r.overQuoted > 0 ? (
                  <span className="text-amber-600">
                    {Math.round((r.overQuoted / r.runs) * 100)}%
                  </span>
                ) : (
                  <span className="text-ink-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({
  run: r,
  open,
  onToggle,
}: {
  run: ActionRunRow;
  open: boolean;
  onToggle: () => void;
}) {
  const calls = useAdminProjects((s) => s.runCalls[r.runId]);
  const loadRunCalls = useAdminProjects((s) => s.loadRunCalls);

  useEffect(() => {
    if (open) void loadRunCalls(r.runId);
  }, [open, r.runId, loadRunCalls]);

  // A charge that overshoots what the user was quoted is the single most
  // damaging thing this table can surface, so it gets called out in place.
  const overQuote = r.sparks.quoted != null && r.sparks.charged > r.sparks.quoted;

  return (
    <>
      <tr
        className="cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/40"
        onClick={onToggle}
      >
        <td className="px-4 py-2.5 whitespace-nowrap text-xs text-ink-500">{fmtDateTime(r.at)}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5 font-medium text-ink-800">
            {ACTION_LABELS[r.action] ?? r.action}
            {r.tier && (
              <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase text-ink-500">
                {r.tier}
              </span>
            )}
            {r.kind !== "fresh" && (
              <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">
                {r.kind}
              </span>
            )}
            {r.outcome !== "ok" && (
              <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">
                {r.outcome}
              </span>
            )}
          </div>
          <div className="text-[10px] text-ink-400">
            {r.source} · {(r.durationMs / 1000).toFixed(1)}s
          </div>
        </td>
        <td className="px-4 py-2.5">
          <div className="font-mono text-[10px] text-ink-400">{r.uid}</div>
          {r.projectSeq != null && (
            <div className="text-[10px] text-ink-400">book #{r.projectSeq}</div>
          )}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
          {fmtNumber(r.calls.total)}
          {r.calls.failures > 0 && (
            <span className="ml-1 text-[10px] text-red-500">{r.calls.failures}✕</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{fmtUsd(r.costUsd.total)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-500">
          {r.costUsd.unbilled > 0 ? fmtUsd(r.costUsd.unbilled) : "—"}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-800">
          {fmtSparks(r.sparks.charged)}
          {overQuote && (
            <div className="text-[10px] text-amber-600" title="Charged more than the pre-flight quote">
              quoted {r.sparks.quoted}
            </div>
          )}
        </td>
        <td
          className={`px-4 py-2.5 text-right tabular-nums ${r.marginUsd >= 0 ? "text-emerald-600" : "text-red-600"}`}
        >
          {fmtUsd(r.marginUsd)}
        </td>
        <td className="px-4 py-2.5 text-right">
          <ChevronRight
            className={`size-4 text-ink-300 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-ink-50 bg-ink-50/30">
          <td colSpan={9} className="px-4 py-3">
            {!calls ? (
              <div className="flex items-center gap-2 text-xs text-ink-400">
                <Loader2 className="size-3.5 animate-spin" /> Loading calls…
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-ink-400">
                    <th className="py-1 pr-3">Step</th>
                    <th className="py-1 pr-3">Model</th>
                    <th className="py-1 pr-3 text-right">Duration</th>
                    <th className="py-1 pr-3 text-right">Cost</th>
                    <th className="py-1">Charged?</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={c.id} className="text-ink-600">
                      <td className="py-1 pr-3 font-medium text-ink-700">{c.step ?? "—"}</td>
                      <td className="py-1 pr-3 font-mono text-[10px]">
                        {c.provider}:{c.model}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {c.durationMs != null ? `${(c.durationMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {c.costUsd != null ? fmtUsd(c.costUsd) : "unpriced"}
                      </td>
                      <td className="py-1">
                        {c.billable ? (
                          <span className="text-ink-500">billed</span>
                        ) : (
                          <span className="text-amber-600">absorbed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {calls.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-2 text-ink-400">
                        The per-call records for this run have aged out.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
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
