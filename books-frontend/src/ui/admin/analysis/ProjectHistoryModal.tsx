"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "../../components/Modal";
import {
  useAdminProjects,
  type ActionRunRow,
  type ProjectPnl,
} from "../../../state/adminProjectsStore";
import { IMAGE_ACTIONS, TEXT_ACTIONS } from "../../../core/ai/actions";
import { MILESTONES } from "./milestones";
import { describeFlowArm, flowArm, type FlowArm } from "../../../core/guide/flow";
import { fmtDateTime, fmtDuration, fmtNumber, fmtSparks, fmtUsd } from "./format";

const NO_PNL: ProjectPnl = {
  recognizedUsd: 0,
  printRevenueUsd: 0,
  ebookRevenueUsd: 0,
  directUsd: 0,
  subscriptionAllocUsd: 0,
  revenueUsd: 0,
  imageUsd: 0,
  textUsd: 0,
  providerUsd: 0,
  absorbedUsd: 0,
  printCostUsd: 0,
  stripeFeeUsd: 0,
  taxUsd: 0,
  feesUsd: 0,
  refundUsd: 0,
  subsidyUsd: 0,
  freeSparks: 0,
  paidSparks: 0,
  freeBySource: {},
  netUsd: 0,
};

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
  // The book's whole life, so these are lifetime figures (unlike the books table).
  const pnl = detail?.pnl ?? NO_PNL;

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Actions" value={fmtNumber(p.counters.runs)} />
            <Tile label="Images" value={fmtNumber(p.counters.imagesGenerated)} />
            <Tile label="Image cost" value={fmtUsd(pnl.imageUsd)} tone="cost" />
            <Tile label="Text cost" value={fmtUsd(pnl.textUsd)} tone="cost" />
            <Tile label="Order cost" value={fmtUsd(pnl.feesUsd)} tone="cost" />
            <Tile label="Net" value={fmtUsd(pnl.netUsd)} tone={pnl.netUsd >= 0 ? "revenue" : "cost"} />
          </div>

          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className="rounded-full bg-ink-50 px-2 py-0.5 font-medium text-ink-700 ring-1 ring-inset ring-ink-100">
              {describeFlowArm(flowArm(p.authoring))}
            </span>
            <span>
              {flowArm(p.authoring) === "mixed"
                ? "Worked on in both studios, so it counts toward neither side of the comparison."
                : flowArm(p.authoring) === "unknown"
                  ? "No studio recorded for this book."
                  : "The studio this book was made in."}
            </span>
          </div>

          <Timeline milestones={p.milestones} arm={flowArm(p.authoring)} />

          <div className="grid gap-4 sm:grid-cols-4">
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
                ["Absorbed repairs", fmtUsd(pnl.absorbedUsd)],
                ["Grant subsidy", fmtUsd(pnl.subsidyUsd)],
                ["Pack revenue", fmtUsd(pnl.recognizedUsd)],
                ["Print sales", fmtUsd(pnl.printRevenueUsd)],
                ["Ebook sales", fmtUsd(pnl.ebookRevenueUsd)],
                ["Refunded", fmtUsd(pnl.refundUsd)],
              ]}
            />
            <Facts
              title="Order cost"
              rows={[
                ["Print provider", fmtUsd(pnl.printCostUsd)],
                ["Stripe fee", fmtUsd(pnl.stripeFeeUsd)],
                ["Tax on the sale", fmtUsd(pnl.taxUsd)],
                ["Total", fmtUsd(pnl.feesUsd)],
              ]}
            />
          </div>

          <RunTimeline runs={detail.runs} />
        </div>
      )}
    </Modal>
  );
}

function Timeline({ milestones, arm }: { milestones: Record<string, number | undefined>; arm: FlowArm }) {
  return (
    <div className="flex flex-wrap gap-2">
      {/* A wizard book can never carry a guided-studio stage; showing it as "not reached" would read as a failure. */}
      {MILESTONES.filter((m) => !(m.guideOnly && arm === "legacy" && !milestones?.[m.key])).map((m) => {
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
                <td
                  className="px-3 py-1.5 text-right tabular-nums text-ink-600"
                  title={
                    r.costUsd.imageCalls != null && r.costUsd.textCalls != null
                      ? `Image calls ${fmtUsd(r.costUsd.imageCalls)} · text calls ${fmtUsd(r.costUsd.textCalls)}`
                      : undefined
                  }
                >
                  {fmtUsd(r.costUsd.total)}
                  {r.group && (
                    <span className="ml-1.5 text-[10px] uppercase text-ink-300">{r.group}</span>
                  )}
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
