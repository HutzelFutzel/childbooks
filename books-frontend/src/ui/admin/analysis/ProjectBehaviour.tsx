"use client";

import { Fragment, useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "../../components/Button";
import { CardHeader, CardTitle } from "../../components/Card";
import {
  useAdminProjects,
  type ProjectBehaviourStats,
  type StatSummary,
} from "../../../state/adminProjectsStore";
import { IMAGE_ACTIONS, TEXT_ACTIONS } from "../../../core/ai/actions";
import { downloadCsv } from "./csv";
import { fmtDuration, fmtNumber, fmtPct, fmtUsd } from "./format";

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  [...TEXT_ACTIONS, ...IMAGE_ACTIONS].map((a) => [a.id, a.label]),
);

type Format = "count" | "usd" | "duration";

interface MetricSpec {
  key: keyof ProjectBehaviourStats;
  label: string;
  group: string;
  format: Format;
  hint?: string;
}

/**
 * What gets a distribution, and why each one is worth a row.
 *
 * Averages alone are actively misleading here: book sizes and rework rates are
 * long-tailed, so the median tells you what a normal book looks like and p90
 * tells you what to survive.
 */
const METRICS: MetricSpec[] = [
  { key: "pages", label: "Pages", group: "Structure", format: "count" },
  { key: "cast", label: "Cast members", group: "Structure", format: "count" },
  {
    key: "illustratedPages",
    label: "Illustrated pages",
    group: "Structure",
    format: "count",
    hint: "Pages that ended up with artwork.",
  },
  {
    key: "illustrationVersions",
    label: "Illustration versions kept",
    group: "Structure",
    format: "count",
    hint: "Total versions across every page's history — the gap to illustrated pages is how much users re-rolled.",
  },
  {
    key: "screenplayVersions",
    label: "Story revisions",
    group: "Structure",
    format: "count",
    hint: "Screenplay versions — how much the text itself got rewritten.",
  },
  { key: "runs", label: "Actions", group: "Effort", format: "count" },
  { key: "images", label: "Images generated", group: "Effort", format: "count" },
  { key: "fresh", label: "First renders", group: "Effort", format: "count" },
  {
    key: "edits",
    label: "Edits",
    group: "Effort",
    format: "count",
    hint: "Re-renders carrying an instruction (\"make her smile\").",
  },
  {
    key: "variations",
    label: "Regenerates",
    group: "Effort",
    format: "count",
    hint: "Re-rolls with no instruction — the user just wanted a different result.",
  },
  { key: "restyles", label: "Restyles", group: "Effort", format: "count" },
  { key: "failures", label: "Failed actions", group: "Effort", format: "count" },
  {
    key: "qcCalls",
    label: "Repair passes absorbed",
    group: "Effort",
    format: "count",
    hint: "Grid re-renders and duplicate erases we paid for and didn't charge.",
  },
  {
    key: "attemptsPerPage",
    label: "Renders per kept page",
    group: "Effort",
    format: "count",
    hint: "Page renders divided by pages that ended up illustrated. 1.0 means nobody re-rolled.",
  },
  { key: "costUsd", label: "Provider cost", group: "Money", format: "usd" },
  { key: "sparksCharged", label: "Sparks charged", group: "Money", format: "count" },
  { key: "netUsd", label: "Net", group: "Money", format: "usd" },
  {
    key: "timeToFirstImageMs",
    label: "Time to first image",
    group: "Timing",
    format: "duration",
    hint: "From book creation to the first image that landed — our clearest activation signal.",
  },
  { key: "timeToOrderMs", label: "Time to order", group: "Timing", format: "duration" },
];

function fmt(value: number, format: Format): string {
  if (format === "usd") return fmtUsd(value);
  if (format === "duration") return fmtDuration(value);
  return fmtNumber(Math.round(value * 100) / 100);
}

/**
 * How the loaded books were actually made — the distribution view.
 *
 * Deliberately a table rather than charts: an admin comparing "median pages" to
 * "p90 pages" is reading two numbers, and a table puts them side by side without
 * anyone having to hover a bar.
 */
export function ProjectBehaviour() {
  const stats = useAdminProjects((s) => s.stats);

  const groups = useMemo(() => {
    if (!stats) return [];
    const out: { group: string; rows: (MetricSpec & { stat: StatSummary })[] }[] = [];
    for (const m of METRICS) {
      const stat = stats[m.key] as StatSummary;
      if (!stat) continue;
      const hit = out.find((g) => g.group === m.group);
      if (hit) hit.rows.push({ ...m, stat });
      else out.push({ group: m.group, rows: [{ ...m, stat }] });
    }
    return out;
  }, [stats]);

  if (!stats || stats.projects === 0) {
    return (
      <div className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-ink-400 ring-1 ring-ink-100">
        No books match this selection.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Rate
          label="Rework"
          value={fmtPct(stats.rates.editRate + stats.rates.variationRate)}
          hint="Share of all actions that re-did something rather than making it for the first time."
        />
        <Rate label="Edits" value={fmtPct(stats.rates.editRate)} />
        <Rate label="Regenerates" value={fmtPct(stats.rates.variationRate)} />
        <Rate
          label="Failures"
          value={fmtPct(stats.rates.failureRate)}
          tone={stats.rates.failureRate > 0.05 ? "bad" : undefined}
        />
        <Rate
          label="Repairs per image"
          value={stats.rates.qcPerImage.toFixed(2)}
          hint="Absorbed repair calls per image kept — the quality-control tax per output."
          tone={stats.rates.qcPerImage > 0.5 ? "bad" : undefined}
        />
      </div>

      <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
        <CardHeader className="flex items-center justify-between py-3.5">
          <CardTitle className="text-sm">
            Distributions{" "}
            <span className="font-normal text-ink-400">
              ({fmtNumber(stats.projects)} books · {fmtNumber(stats.users)} users)
            </span>
          </CardTitle>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="size-4" />}
            onClick={() =>
              downloadCsv(
                "book-distributions",
                METRICS.filter((m) => stats[m.key]).map((m) => {
                  const s = stats[m.key] as StatSummary;
                  return {
                    metric: m.label,
                    group: m.group,
                    books: s.count,
                    total: s.total,
                    avg: s.avg,
                    median: s.median,
                    p90: s.p90,
                    max: s.max,
                  };
                }),
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
                <th className="px-4 py-2.5">Metric</th>
                <th className="px-4 py-2.5 text-right">Avg</th>
                <th className="px-4 py-2.5 text-right">Median</th>
                <th className="px-4 py-2.5 text-right">p90</th>
                <th className="px-4 py-2.5 text-right">Max</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-right">Books</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.group}>
                  <tr className="bg-ink-50/50">
                    <td
                      colSpan={7}
                      className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400"
                    >
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.key} className="border-b border-ink-50 last:border-0">
                      <td className="px-4 py-2 text-ink-700" {...(r.hint ? { title: r.hint } : {})}>
                        {r.label}
                        {r.hint && <span className="ml-1 text-ink-300">ⓘ</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-ink-800">
                        {fmt(r.stat.avg, r.format)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-700">
                        {fmt(r.stat.median, r.format)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-600">
                        {fmt(r.stat.p90, r.format)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-600">
                        {fmt(r.stat.max, r.format)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-500">
                        {r.format === "duration" ? "—" : fmt(r.stat.total, r.format)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-400">
                        {fmtNumber(r.stat.count)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-400">
          &ldquo;Books&rdquo; is how many contributed to the row — timing metrics only count books
          that reached the event, so a low number there is itself the finding.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Mix
          title="Images by model"
          hint="Which model actually drew the artwork, weighted by images — not just which was touched."
          tally={stats.imagesByModel}
        />
        <Mix title="Images by action" tally={stats.imagesByAction} labels={ACTION_LABELS} />
        <Mix title="Actions by type" tally={stats.runsByAction} labels={ACTION_LABELS} />
        <Mix title="Art styles" tally={stats.artStyles} suffix="books" />
      </div>
    </div>
  );
}

function Rate({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "bad";
}) {
  return (
    <div
      className="rounded-xl bg-white p-3 ring-1 ring-ink-100 shadow-soft"
      {...(hint ? { title: hint } : {})}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "bad" ? "text-amber-600" : "text-ink-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** A tally as a share-of-total bar list. */
function Mix({
  title,
  tally,
  labels,
  hint,
  suffix,
}: {
  title: string;
  tally: Record<string, number>;
  labels?: Record<string, string>;
  hint?: string;
  suffix?: string;
}) {
  const rows = useMemo(
    () => Object.entries(tally).sort((a, b) => b[1] - a[1]),
    [tally],
  );
  const total = rows.reduce((a, [, v]) => a + v, 0);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft">
      <div className="mb-2 text-sm font-semibold text-ink-800" {...(hint ? { title: hint } : {})}>
        {title}
      </div>
      <div className="space-y-1.5">
        {rows.map(([key, value]) => (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-ink-600" title={key}>
                {labels?.[key] ?? key}
              </span>
              <span className="shrink-0 tabular-nums text-ink-800">
                {fmtNumber(value)}
                {suffix ? ` ${suffix}` : ""}
                <span className="ml-1.5 text-ink-400">
                  {total > 0 ? fmtPct(value / total) : ""}
                </span>
              </span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-400"
                style={{ width: `${total > 0 ? (value / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
