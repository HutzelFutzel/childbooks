"use client";

/**
 * Analysis → Studio flows. The wizard against the guide, on real books.
 *
 * This page exists to inform one decision — keep ramping the guided studio, or fix
 * something first — and that shapes it more than any other Analysis tab. The
 * numbers here will be used to argue for a change that is hard to reverse, so the
 * layout is built to stop the two mistakes a comparison dashboard invites rather
 * than to show as much as possible.
 *
 * **Caveats come first, above the data.** The failure mode of an internal
 * comparison is not a wrong number, it is a right number read as though it
 * settled something. While the rollout is admin-only the guided arm is staff and
 * the wizard arm is customers, which is a difference in *who*, not in which studio
 * is better — and nothing about the chart says so. The backend derives those
 * warnings from the data actually loaded, so they cannot claim a healthy sample
 * when there isn't one.
 *
 * **Completion is shown before speed.** "Time to first draft" over only the books
 * that reached a draft rewards a flow that loses people early: the survivors are
 * faster because the strugglers are gone. So the funnel — how many books of each
 * arm got how far — is the first card, and every duration is rendered beside the
 * count of books that produced it.
 *
 * The two excluded arms are shown rather than hidden. A book worked on in both
 * flows belongs to neither, and seeing that there are forty of them is the
 * difference between trusting this page and being misled by it.
 *
 * Retired with the comparison (see docs/LEGACY-GUIDE.md).
 */
import { useEffect } from "react";
import { AlertTriangle, GitCompare, Info, Loader2, MessagesSquare, RefreshCw } from "lucide-react";
import { describeFlowArm, type FlowArm } from "../../../core/guide/flow";
import type {
  FlowArmReport,
  FlowComparison,
  StatSummary,
} from "../../../core/analytics/types";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { Button } from "../../components/Button";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { cn } from "../../lib/cn";
import { fmtDuration, fmtNumber, fmtPct, fmtUsd } from "./format";

/**
 * The funnel, in the order a book passes it. Mirrors the backend's milestone
 * order; `pagesPlanned` sits after the draft because a page plan is made from a
 * story, even though a reader who brought their own text reaches it first.
 */
const FUNNEL: { key: string; label: string }[] = [
  { key: "created", label: "Started" },
  { key: "storyDrafted", label: "Story written" },
  { key: "pagesPlanned", label: "Pages planned" },
  { key: "castStarted", label: "Cast drawn" },
  { key: "pagesStarted", label: "Pages drawn" },
  { key: "coverDone", label: "Cover done" },
  { key: "previewed", label: "Reached preview" },
  { key: "ordered", label: "Ordered" },
];

const ARM_TONE: Record<FlowArm, string> = {
  guide: "text-brand-600",
  legacy: "text-ink-700",
  mixed: "text-amber-600",
  unknown: "text-ink-400",
};

export function FlowsAnalysis() {
  const report = useAdminAnalytics((s) => s.flows);
  const loading = useAdminAnalytics((s) => s.flowsLoading);
  const error = useAdminAnalytics((s) => s.error);
  const refresh = useAdminAnalytics((s) => s.refreshFlows);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error && !report) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="flex-1">{error}</span>
        <Button variant="secondary" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-400" />
      </div>
    );
  }

  const compared = report.arms.filter((arm) => arm.comparable);
  const excluded = report.arms.filter((arm) => !arm.comparable && arm.books > 0);
  const nothingYet = compared.every((arm) => arm.books === 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <GitCompare className="mt-0.5 size-5 text-brand-500" />
          <div>
            <h2 className="text-base font-semibold text-ink-900">Studio flows</h2>
            <p className="max-w-2xl text-sm text-ink-500">
              How books made in the guided studio compare with books made in the step wizard.
              Only books worked on in the selected window, and only books that stayed in one
              flow.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {/*
        Above the data, deliberately. Every one of these changes what the numbers
        below are allowed to conclude, and a reader who scrolls past the charts to
        find them has already formed a view.
      */}
      {report.caveats.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
            <Info className="size-4" />
            Read this before the numbers
          </div>
          <ul className="space-y-1.5 text-sm text-amber-800">
            {report.caveats.map((caveat) => (
              <li key={caveat} className="flex gap-2">
                <span aria-hidden className="select-none">
                  ·
                </span>
                <span>{caveat}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {nothingYet ? (
        <div className="rounded-lg border border-line bg-canvas p-6 text-sm text-ink-500">
          No books in this window have a flow recorded yet. Attribution starts when a reader
          opens a book, so this fills in as books are worked on — it cannot be backfilled for
          books made before it shipped.
        </div>
      ) : (
        <>
          <ArmSummary arms={compared} />
          <FunnelCompare arms={compared} />
          <SpeedCompare arms={compared} />
          <EffortCompare arms={compared} />
          <Conversation turns={report.turns} />
        </>
      )}

      {excluded.length > 0 && <Excluded arms={excluded} excluded={report.excluded} />}
    </div>
  );
}

/** Headline counts per arm. */
function ArmSummary({ arms }: { arms: FlowArmReport[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {arms.map((arm) => (
        <div key={arm.arm} className="rounded-lg border border-line bg-surface p-4">
          <div className={cn("text-sm font-medium", ARM_TONE[arm.arm])}>
            {describeFlowArm(arm.arm)}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold text-ink-900">{fmtNumber(arm.books)}</span>
            <span className="text-sm text-ink-500">
              book{arm.books === 1 ? "" : "s"} · {fmtNumber(arm.stats.users)} account
              {arm.stats.users === 1 ? "" : "s"}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-ink-500">Reached preview</dt>
              <dd className="font-medium text-ink-900">{fmtPct(arm.previewRate, 1)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Ordered</dt>
              <dd className="font-medium text-ink-900">{fmtPct(arm.orderRate, 1)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * How far books of each arm got.
 *
 * First card on the page, because it is the only one that measures whether a flow
 * works. Everything else measures how it behaves for the people it worked for.
 */
function FunnelCompare({ arms }: { arms: FlowArmReport[] }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <CardHeader>
        <CardTitle>How far books got</CardTitle>
      </CardHeader>
      <CardBody>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-400">
              <th className="pb-2 font-medium">Stage</th>
              {arms.map((arm) => (
                <th key={arm.arm} className="pb-2 text-right font-medium">
                  {describeFlowArm(arm.arm)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FUNNEL.map(({ key, label }) => (
              <tr key={key} className="border-b border-line/60 last:border-0">
                <td className="py-2 text-ink-700">{label}</td>
                {arms.map((arm) => {
                  const n = arm.stats.milestones[key] ?? 0;
                  const share = arm.books > 0 ? n / arm.books : 0;
                  return (
                    <td key={arm.arm} className="py-2 text-right tabular-nums">
                      <span className="font-medium text-ink-900">{fmtNumber(n)}</span>
                      <span className="ml-2 text-ink-400">{fmtPct(share, 0)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </section>
  );
}

/**
 * Durations, each shown with how many books produced it.
 *
 * The count is not decoration. A median time to draft of four minutes over six
 * books says something very different from the same figure over six hundred, and
 * without the count the two are indistinguishable.
 */
function SpeedCompare({ arms }: { arms: FlowArmReport[] }) {
  const ROWS: { label: string; pick: (a: FlowArmReport) => StatSummary }[] = [
    { label: "Start → story written", pick: (a) => a.stats.timeToFirstDraftMs },
    { label: "Start → first picture", pick: (a) => a.stats.timeToFirstImageMs },
    { label: "Start → reached preview", pick: (a) => a.stats.timeToPreviewMs },
    { label: "Start → ordered", pick: (a) => a.stats.timeToOrderMs },
  ];
  return (
    <section className="rounded-lg border border-line bg-surface">
      <CardHeader>
        <CardTitle>How long it took</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-xs text-ink-500">
          Median, with the number of books that got that far. A flow can look faster simply by
          losing the people who would have been slow, so read these against the funnel above.
        </p>
        <StatTable arms={arms} rows={ROWS} render={(s) => fmtDuration(s.median)} />
      </CardBody>
    </section>
  );
}

/** What each flow cost, in renders and in money. */
function EffortCompare({ arms }: { arms: FlowArmReport[] }) {
  const ROWS: { label: string; pick: (a: FlowArmReport) => StatSummary }[] = [
    { label: "Sparks per book", pick: (a) => a.stats.sparksCharged },
    { label: "Provider cost per book", pick: (a) => a.stats.costUsd },
    { label: "Images per book", pick: (a) => a.stats.images },
    { label: "Renders per kept page", pick: (a) => a.stats.attemptsPerPage },
    { label: "Re-rolls per book", pick: (a) => a.stats.variations },
    { label: "Edits per book", pick: (a) => a.stats.edits },
  ];
  return (
    <section className="rounded-lg border border-line bg-surface">
      <CardHeader>
        <CardTitle>What it cost</CardTitle>
      </CardHeader>
      <CardBody>
        <StatTable
          arms={arms}
          rows={ROWS}
          render={(s, label) => (label.includes("cost") ? fmtUsd(s.median) : fmtNumber(s.median))}
        />
      </CardBody>
    </section>
  );
}

/** Median-per-arm table with the contributing count beside each figure. */
function StatTable({
  arms,
  rows,
  render,
}: {
  arms: FlowArmReport[];
  rows: { label: string; pick: (a: FlowArmReport) => StatSummary }[];
  render: (stat: StatSummary, label: string) => string;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-400">
          <th className="pb-2 font-medium">Measure</th>
          {arms.map((arm) => (
            <th key={arm.arm} className="pb-2 text-right font-medium">
              {describeFlowArm(arm.arm)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, pick }) => (
          <tr key={label} className="border-b border-line/60 last:border-0">
            <td className="py-2 text-ink-700">{label}</td>
            {arms.map((arm) => {
              const stat = pick(arm);
              return (
                <td key={arm.arm} className="py-2 text-right tabular-nums">
                  {stat.count === 0 ? (
                    <span className="text-ink-300">—</span>
                  ) : (
                    <>
                      <span className="font-medium text-ink-900">{render(stat, label)}</span>
                      <span className="ml-2 text-ink-400">n={fmtNumber(stat.count)}</span>
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The conversation, which only the guide has.
 *
 * Shown as its own card rather than a third column, because there is nothing to
 * compare it against — the wizard has no turns. The two numbers worth watching are
 * the ambiguity rate, which is where the prompt needs work, and where conversations
 * were last heard from, which is where readers give up.
 */
function Conversation({ turns }: { turns: FlowComparison["turns"] }) {
  const stops = Object.entries(turns.lastComponent).sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-lg border border-line bg-surface">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <MessagesSquare className="size-4 text-brand-500" />
            The conversation
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody>
        {turns.turns === 0 ? (
          <p className="text-sm text-ink-500">
            No guided turns in this window. Free-text answers are what produce these — a book
            answered entirely by tapping options records none.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Turns" value={fmtNumber(turns.turns)} />
              <Metric label="Median per book" value={fmtNumber(turns.perBook.median)} />
              <Metric
                label="Unsure"
                value={fmtPct(turns.ambiguityRate, 1)}
                hint="Turns the interpreter had low confidence in — the sentences the prompt can't read yet."
              />
              <Metric
                label="Median latency"
                value={fmtDuration(turns.latencyMs.median)}
                hint="Felt directly as the guide pausing before it replies."
              />
            </dl>

            {stops.length > 0 && (
              <div className="mt-5">
                <h4 className="mb-1 text-sm font-medium text-ink-800">
                  Where conversations were last heard from
                </h4>
                <p className="mb-2 text-xs text-ink-500">
                  Counted once per book, on the last question it answered. The final question is
                  expected to top this list; anything else near the top is where readers stop.
                </p>
                <ul className="space-y-1 text-sm">
                  {stops.map(([component, n]) => (
                    <li key={component} className="flex items-center justify-between gap-3">
                      <span className="text-ink-700">{component}</span>
                      <span className="tabular-nums text-ink-500">{fmtNumber(n)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardBody>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-400" title={hint}>
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
      {hint && <p className="mt-0.5 text-xs leading-snug text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * Books counted in neither arm.
 *
 * Shown, not hidden. The exclusions are the honest part of the comparison, and an
 * admin who cannot see how many books were dropped has no way to judge how much
 * the two arms above are worth.
 */
function Excluded({
  arms,
  excluded,
}: {
  arms: FlowArmReport[];
  excluded: FlowComparison["excluded"];
}) {
  return (
    <section className="rounded-lg border border-line bg-canvas">
      <CardHeader>
        <CardTitle>Not counted</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="space-y-3 text-sm">
          {arms.map((arm) => (
            <div key={arm.arm} className="flex items-start justify-between gap-4">
              <div>
                <div className={cn("font-medium", ARM_TONE[arm.arm])}>
                  {describeFlowArm(arm.arm)}
                </div>
                <p className="text-ink-500">
                  {arm.arm === "mixed"
                    ? "Worked on in both studios, so each carries one flow's writing and the other's pictures. Crediting either arm with them would count the other flow's work as evidence for it."
                    : "No flow recorded — made before this measurement, or the reader never settled on one flow long enough to be counted."}
                </p>
              </div>
              <span className="shrink-0 tabular-nums font-medium text-ink-900">
                {fmtNumber(arm.books)}
              </span>
            </div>
          ))}
          <p className="border-t border-line pt-3 text-xs text-ink-400">
            {fmtNumber(excluded.mixed + excluded.unknown)} book
            {excluded.mixed + excluded.unknown === 1 ? "" : "s"} excluded in total.
          </p>
        </div>
      </CardBody>
    </section>
  );
}
