"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "../../components/Modal";
import { useAdminProjects, type ActionRunRow } from "../../../state/adminProjectsStore";
import { IMAGE_ACTIONS, TEXT_ACTIONS } from "../../../core/ai/actions";
import { MILESTONES } from "./milestones";
import { fmtDateTime, fmtDuration, fmtNumber, fmtSparks, fmtUsd } from "./format";

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  [...TEXT_ACTIONS, ...IMAGE_ACTIONS].map((a) => [a.id, a.label]),
);

/**
 * One book, end to end: every action ever run against it in order, with what it
 * cost and what it charged.
 *
 * The table view answers "which books lose money"; this answers "what did this
 * person actually do", which is the only way to tell a 40-render book apart from
 * a 40-render book that failed 30 times.
 */
export function ProjectHistoryModal() {
  const detail = useAdminProjects((s) => s.detail);
  const detailKey = useAdminProjects((s) => s.detailKey);
  const loading = useAdminProjects((s) => s.detailLoading);
  const close = useAdminProjects((s) => s.closeDetail);

  const p = detail?.project;

  return (
    <Modal
      open={Boolean(detailKey)}
      onClose={close}
      size="max-w-5xl"
      title={p ? `${p.derived.title ?? "Untitled"} · book #${p.seq}` : "Loading book…"}
    >
      {loading && !detail ? (
        <div className="flex items-center justify-center py-16 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : !detail || !p ? (
        <p className="py-10 text-center text-sm text-ink-400">Nothing to show for this book.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Actions" value={fmtNumber(p.counters.runs)} />
            <Tile label="Images" value={fmtNumber(p.counters.imagesGenerated)} />
            <Tile label="Provider cost" value={fmtUsd(p.cost.providerUsd)} tone="cost" />
            <Tile
              label="Net"
              value={fmtUsd(detail.pnl?.netUsd ?? -p.cost.providerUsd)}
              tone={(detail.pnl?.netUsd ?? -p.cost.providerUsd) >= 0 ? "revenue" : "cost"}
            />
          </div>

          <Timeline milestones={p.milestones} />

          <div className="grid gap-4 sm:grid-cols-3">
            <Facts
              title="Structure"
              rows={[
                ["Pages", fmtNumber(p.derived.pageCount)],
                ["Illustrated", fmtNumber(p.derived.illustratedCount)],
                ["Versions kept", fmtNumber(p.derived.illustrationVersions)],
                ["Story revisions", fmtNumber(p.derived.screenplayVersions)],
                ["Cast", fmtNumber(p.derived.anchors.total)],
                ...(p.derived.artStyleKey ? [["Art style", p.derived.artStyleKey] as const] : []),
                ...(p.derived.ageRangeId ? [["Age band", p.derived.ageRangeId] as const] : []),
              ]}
            />
            <Facts
              title="Effort"
              rows={[
                ["First renders", fmtNumber(p.counters.fresh)],
                ["Edits", fmtNumber(p.counters.edits)],
                ["Regenerates", fmtNumber(p.counters.variations)],
                ["Restyles", fmtNumber(p.counters.restyles)],
                ["Failures", fmtNumber(p.counters.failures)],
                ["Repairs absorbed", fmtNumber(p.counters.qcCalls)],
                ["Time to first image", fmtDuration(p.timing.timeToFirstImageMs ?? null)],
              ]}
            />
            <Facts
              title="Money"
              rows={[
                ["Sparks charged", fmtSparks(p.sparks.charged)],
                ["…from purchases", fmtSparks(p.sparks.paid)],
                ["…from grants", fmtSparks(p.sparks.free)],
                ["Absorbed cost", fmtUsd(p.cost.unbilledUsd)],
                ["Pack revenue", fmtUsd(detail.pnl?.recognizedUsd ?? 0)],
                ["Print / ebook", fmtUsd(detail.pnl?.directUsd ?? 0)],
                ["Grant subsidy", fmtUsd(detail.pnl?.subsidyUsd ?? 0)],
              ]}
            />
          </div>

          <RunTimeline runs={detail.runs} />
        </div>
      )}
    </Modal>
  );
}

function Timeline({ milestones }: { milestones: Record<string, number | undefined> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {MILESTONES.map((m) => {
        const at = milestones?.[m.key];
        return (
          <div
            key={m.key}
            className={`rounded-xl px-3 py-2 text-xs ring-1 ring-inset ${
              at ? "bg-brand-50 text-brand-700 ring-brand-100" : "bg-ink-50 text-ink-400 ring-ink-100"
            }`}
          >
            <div className="font-medium">{m.label}</div>
            <div className="tabular-nums">{at ? fmtDateTime(at) : "not reached"}</div>
          </div>
        );
      })}
    </div>
  );
}

function RunTimeline({ runs }: { runs: ActionRunRow[] }) {
  // Oldest first: this is a story, and stories read forwards.
  const ordered = useMemo(() => [...runs].sort((a, b) => a.at - b.at), [runs]);
  if (ordered.length === 0) {
    return (
      <p className="text-xs text-ink-400">
        No action runs recorded for this book — it predates run-level tracking, or nothing was ever
        rendered.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-ink-100">
      <div className="border-b border-ink-100 bg-ink-50/60 px-3 py-2 text-xs font-semibold text-ink-700">
        Every action, in order ({fmtNumber(ordered.length)})
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <tbody>
            {ordered.map((r) => (
              <tr key={r.runId} className="border-b border-ink-50 last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-400">{fmtDateTime(r.at)}</td>
                <td className="px-3 py-1.5">
                  <span className="font-medium text-ink-700">
                    {ACTION_LABELS[r.action] ?? r.action}
                  </span>
                  {r.tier && <span className="ml-1.5 uppercase text-ink-400">{r.tier}</span>}
                  {r.kind !== "fresh" && (
                    <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 text-[10px] text-sky-600">
                      {r.kind}
                    </span>
                  )}
                  {r.outcome !== "ok" && (
                    <span className="ml-1.5 rounded-full bg-red-50 px-1.5 text-[10px] text-red-600">
                      {r.outcome}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-500">
                  {fmtNumber(r.calls.total)} calls
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-600">
                  {fmtUsd(r.costUsd.total)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-800">
                  {fmtSparks(r.sparks.charged)} ✦
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-400">
                  {fmtDuration(r.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "cost" | "revenue";
}) {
  return (
    <div className="rounded-xl bg-ink-50/60 p-3 ring-1 ring-inset ring-ink-100">
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

function Facts({ title, rows }: { title: string; rows: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-ink-700">{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
          <span className="text-ink-500">{label}</span>
          <span className="truncate tabular-nums text-ink-800" title={value}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
