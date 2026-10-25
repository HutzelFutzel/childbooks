"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { backendFetch } from "../../../platform/backend";
import {
  DEFAULT_BOOK_COST_QUERY,
  MAX_BOOK_COST_COUNT,
  type BookCostCohort,
  type BookCostFunding,
  type BookCostOrder,
  type BookCostQuery,
  type BookCostReport,
} from "../../../core/analytics/bookCost";
import type { StatSummary } from "../../../core/analytics/types";
import { downloadCsv } from "./csv";
import { fmtDateTime, fmtNumber, fmtPct, fmtUsd, toDateInput } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shortcuts only. The count is a free number (any value from 1 to 1000); these are
 * just the quick picks people reach for, not the set of things you can ask.
 */
const QUICK_COUNTS = [10, 25, 50, 100, 250, 500, 1000];

type Mode = "count" | "range";

/** Slider position (0–100) ↔ count, squared so the low end — where most questions live — has room. */
const countToSlider = (n: number) => Math.round(100 * Math.sqrt(Math.max(0, n - 1) / (MAX_BOOK_COST_COUNT - 1)));
const sliderToCount = (p: number) => Math.round(1 + (MAX_BOOK_COST_COUNT - 1) * (p / 100) ** 2);

const sparks = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j?.error?.message ?? "Couldn't load the book costs.";
  } catch {
    return "Couldn't load the book costs.";
  }
}

/**
 * "What does a book cost?" — the one number to size a free-Spark grant against.
 *
 * Everything is in USD of real provider spend, because that is the only unit that
 * does not depend on who paid (a Spark is worth something different on every
 * plan and pack). Sparks are shown as a conversion of the dollar cost at today's
 * price list, never as the measurement itself. See `functions/src/bookCostReport.ts`
 * for exactly what is counted.
 */
export function BookCostsCard() {
  const [mode, setMode] = useState<Mode>("count");
  const [count, setCount] = useState(DEFAULT_BOOK_COST_QUERY.count);
  const [countDraft, setCountDraft] = useState(String(DEFAULT_BOOK_COST_QUERY.count));
  const [from, setFrom] = useState(() => toDateInput(Date.now() - 30 * DAY_MS));
  const [to, setTo] = useState(() => toDateInput(Date.now()));
  const [cohort, setCohort] = useState<BookCostCohort>(DEFAULT_BOOK_COST_QUERY.cohort);
  const [order, setOrder] = useState<BookCostOrder>(DEFAULT_BOOK_COST_QUERY.order);
  const [funding, setFunding] = useState<BookCostFunding>(DEFAULT_BOOK_COST_QUERY.funding);
  const [firstBookOnly, setFirstBookOnly] = useState(false);
  const [excludeStaff, setExcludeStaff] = useState(true);
  const [settledDays, setSettledDays] = useState(0);

  const [report, setReport] = useState<BookCostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const params = useMemo(() => {
    const qs = new URLSearchParams({
      count: String(count),
      order,
      cohort,
      funding,
      firstBookOnly: String(firstBookOnly),
      excludeStaff: String(excludeStaff),
      settledDays: String(settledDays),
    });
    if (mode === "range") {
      const start = new Date(`${from}T00:00:00`).getTime();
      const end = new Date(`${to}T23:59:59.999`).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        qs.set("from", String(start));
        qs.set("to", String(end));
      }
    }
    return qs.toString();
  }, [mode, count, order, cohort, funding, firstBookOnly, excludeStaff, settledDays, from, to]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await backendFetch(`/admin/analytics/book-costs?${params}`);
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as BookCostReport;
      if (mine === seq.current) setReport(json);
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? "Couldn't load the book costs.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [params]);

  // Debounced so dragging the slider or typing a number doesn't fire a request per step.
  useEffect(() => {
    const t = setTimeout(() => void load(), 350);
    return () => clearTimeout(t);
  }, [load]);

  const applyCount = (n: number) => {
    const clamped = Math.min(MAX_BOOK_COST_COUNT, Math.max(1, Math.round(n)));
    setCount(clamped);
    setCountDraft(String(clamped));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-900">What does a book cost?</h2>
            <p className="mt-0.5 max-w-3xl text-xs text-ink-500">
              Real provider spend per book, all in: the whole guide chat, the story, every picture, quality repairs,
              retries and failed attempts. Dollars are the measure; Sparks are shown as the same cost at today&apos;s
              price list.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        {/* Which books */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-ink-50 p-0.5 text-xs">
            {(
              [
                ["count", "Last N books"],
                ["range", "Date range"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  mode === id ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 hover:text-ink-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "range" && (
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
              <span>to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
              <span>, newest</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <span className="text-xs text-ink-500">{mode === "count" ? "Books" : "At most"}</span>
            <Input
              type="number"
              min={1}
              max={MAX_BOOK_COST_COUNT}
              value={countDraft}
              onChange={(e) => {
                setCountDraft(e.target.value);
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) setCount(Math.min(MAX_BOOK_COST_COUNT, Math.round(n)));
              }}
              onBlur={() => applyCount(Number(countDraft) || DEFAULT_BOOK_COST_QUERY.count)}
              className="h-9 w-24 tabular-nums"
              aria-label="Number of books"
            />
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={countToSlider(count)}
            onChange={(e) => applyCount(sliderToCount(Number(e.target.value)))}
            className="w-56"
            aria-label="Number of books (slider)"
          />
          <div className="flex flex-wrap gap-1">
            {QUICK_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => applyCount(n)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums ring-1 transition ${
                  count === n ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-500 ring-ink-200 hover:text-ink-800"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Which kind of book */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            aria-label="Which books count"
            value={cohort}
            onChange={(e) => setCohort(e.target.value as BookCostCohort)}
            className="h-9 w-56"
            options={[
              { value: "started", label: "Books that used AI" },
              { value: "finished", label: "Finished books only" },
              { value: "all", label: "Every book (incl. untouched)" },
            ]}
          />
          <Select
            aria-label="Order"
            value={order}
            onChange={(e) => setOrder(e.target.value as BookCostOrder)}
            className="h-9 w-48"
            options={[
              { value: "created", label: "Newest by creation" },
              { value: "active", label: "Newest by last activity" },
            ]}
          />
          <Select
            aria-label="Funded by"
            value={funding}
            onChange={(e) => setFunding(e.target.value as BookCostFunding)}
            className="h-9 w-48"
            options={[
              { value: "any", label: "Any funding" },
              { value: "free", label: "Free Sparks only" },
              { value: "paid", label: "Used paid Sparks" },
            ]}
          />
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            <input type="checkbox" checked={firstBookOnly} onChange={(e) => setFirstBookOnly(e.target.checked)} />
            First book of each account
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            <input type="checkbox" checked={excludeStaff} onChange={(e) => setExcludeStaff(e.target.checked)} />
            Exclude staff &amp; tests
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            Idle for
            <Input
              type="number"
              min={0}
              max={365}
              value={settledDays}
              onChange={(e) => setSettledDays(Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))))}
              className="h-8 w-16 tabular-nums"
              aria-label="Minimum idle days"
            />
            days+
          </label>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!report && loading && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {report && <ReportView report={report} loading={loading} />}
    </div>
  );
}

// ---- Result -----------------------------------------------------------------

function ReportView({ report: r, loading }: { report: BookCostReport; loading: boolean }) {
  const empty = r.books === 0;
  return (
    <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <SampleLine r={r} />

      {empty ? (
        <div className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-ink-400 ring-1 ring-ink-100">
          No books match these settings.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Big
              label="Cost per book"
              value={fmtUsd(r.headline.perBookUsd)}
              sub={`≈ ${sparks(r.headline.perBookSparks)} ✦ at list price`}
              hint="Total spend ÷ number of books. Includes everything: text, pictures, the whole chat, repairs, retries and failed attempts."
              tone
            />
            <Big
              label="Cost per page"
              value={fmtUsd(r.headline.perPageUsd)}
              sub={`≈ ${sparks(r.headline.perPageSparks)} ✦ at list price`}
              hint="Total spend ÷ total pages, over every book. A long book counts for more, as it should. 'Pages' are illustrated units: story pages plus covers."
              tone
            />
            <Big
              label="Typical book (median)"
              value={fmtUsd(r.perBook.median)}
              sub={`≈ ${sparks(r.perBookSparks.median)} ✦`}
              hint="Half the books cost less than this. Less distorted by a few expensive ones than the average."
            />
            <Big
              label="Expensive book (p90)"
              value={fmtUsd(r.perBook.p90)}
              sub={`≈ ${sparks(r.perBookSparks.p90)} ✦ · 1 in 10 costs more`}
              hint="One book in ten costs more than this."
            />
            <Big
              label="Book size"
              value={`${r.headline.avgPages.toFixed(1)} pages`}
              sub={`median ${r.pages.median.toFixed(0)} · max ${r.pages.max.toFixed(0)}`}
              hint="Average illustrated units per book (pages and covers)."
            />
          </div>

          <Distribution r={r} />
          <Breakdown r={r} />
          <GrantPanel r={r} />
          <Notes r={r} />
        </>
      )}
    </div>
  );
}

function SampleLine({ r }: { r: BookCostReport }) {
  const q: BookCostQuery = r.query;
  const short = r.quality.matched < r.quality.requested;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-ink-50 px-4 py-2.5 text-xs text-ink-600">
      <span>
        <strong className="tabular-nums text-ink-900">{fmtNumber(r.books)}</strong> book{r.books === 1 ? "" : "s"} counted
        {short && (
          <span className="text-amber-700">
            {" "}
            (you asked for {fmtNumber(r.quality.requested)}; that is all there is{q.range ? " in this window" : ""})
          </span>
        )}
      </span>
      {r.quality.oldestAt && r.quality.newestAt && (
        <span>
          created {fmtDateTime(r.quality.oldestAt)} → {fmtDateTime(r.quality.newestAt)}
        </span>
      )}
      <span>
        total spend <strong className="tabular-nums text-ink-900">{fmtUsd(r.headline.totalUsd)}</strong> over{" "}
        {fmtNumber(r.headline.totalPages)} pages
      </span>
      {r.quality.noSpendExcluded > 0 && q.cohort !== "all" && (
        <span>{fmtNumber(r.quality.noSpendExcluded)} untouched books skipped</span>
      )}
      {r.quality.itemizedNow > 0 && <span>{fmtNumber(r.quality.itemizedNow)} older books itemized just now</span>}
    </div>
  );
}

function Big({
  label,
  value,
  sub,
  hint,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  tone?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft" {...(hint ? { title: hint } : {})}>
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ? "text-red-600" : "text-ink-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-500">{sub}</div>}
    </div>
  );
}

function Distribution({ r }: { r: BookCostReport }) {
  const rows: { label: string; hint: string; stat: StatSummary; fmt: (n: number) => string }[] = [
    {
      label: "Cost per book",
      hint: "Each book's all-in spend.",
      stat: r.perBook,
      fmt: (n) => fmtUsd(n),
    },
    {
      label: "Cost per book (✦ at list price)",
      hint: "The same books in Sparks: cost × markup ÷ Spark price. Not what was charged — what the price list would charge.",
      stat: r.perBookSparks,
      fmt: (n) => `${sparks(n)} ✦`,
    },
    {
      label: "Sparks actually charged",
      hint: "What these books were charged in Sparks (free and paid). Includes charges made under older price lists.",
      stat: r.chargedSparks,
      fmt: (n) => `${sparks(n)} ✦`,
    },
    {
      label: "Cost per page (per book)",
      hint: "Each book's cost ÷ its pages, then summarized: every book weighs the same. Short test books with an expensive cover read high here, which is why the headline per-page figure is pooled instead.",
      stat: r.perPage,
      fmt: (n) => fmtUsd(n),
    },
    {
      label: "Pages per book",
      hint: "Illustrated units: story pages plus covers.",
      stat: r.pages,
      fmt: (n) => n.toFixed(1),
    },
  ];
  const cols: { key: keyof StatSummary; label: string }[] = [
    { key: "avg", label: "Average" },
    { key: "min", label: "Min" },
    { key: "p25", label: "p25" },
    { key: "median", label: "Median" },
    { key: "p75", label: "p75" },
    { key: "p90", label: "p90" },
    { key: "p95", label: "p95" },
    { key: "max", label: "Max" },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-900">How much books vary</h3>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Download className="size-4" />}
          onClick={() =>
            downloadCsv("book-costs", [
              ...rows.map((row) => ({
                section: "distribution",
                metric: row.label,
                books: row.stat.count,
                ...Object.fromEntries(cols.map((c) => [c.key, row.stat[c.key]])),
              })),
              ...r.components.map((c) => ({
                section: "component",
                metric: c.label,
                books: c.booksWith,
                total_usd: c.totalUsd,
                per_book_usd: c.perBookUsd,
                per_page_usd: c.perPageUsd,
                share: c.share,
              })),
            ])
          }
        >
          Export CSV
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-ink-100 text-right text-xs font-medium text-ink-500">
            <th className="px-4 py-2 text-left">&nbsp;</th>
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-ink-50 last:border-0">
              <td className="px-4 py-2.5 font-medium text-ink-800" title={row.hint}>
                {row.label}
                <span className="ml-1.5 text-[10px] font-normal text-ink-400">n={fmtNumber(row.stat.count)}</span>
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2.5 text-right tabular-nums ${
                    c.key === "avg" || c.key === "median" ? "font-semibold text-ink-900" : "text-ink-600"
                  }`}
                >
                  {row.stat.count ? row.fmt(row.stat[c.key] as number) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2.5 text-[11px] text-ink-400">
        Cost per page uses a pooled average (total ÷ total pages) in the headline; the per-book row above shows how the rate
        varies between books.
      </p>
    </div>
  );
}

function Breakdown({ r }: { r: BookCostReport }) {
  const max = Math.max(...r.components.map((c) => c.share), 0.0001);
  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-900">Where the money goes</h3>
        <p className="text-[11px] text-ink-400">
          Averages over all {fmtNumber(r.books)} books, books without a given part counting as zero, so the rows add up to
          the headline.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-ink-100 text-right text-xs font-medium text-ink-500">
            <th className="px-4 py-2 text-left">Part of making a book</th>
            <th className="px-3 py-2">Per book</th>
            <th className="px-3 py-2">Per page</th>
            <th className="px-3 py-2">Share</th>
            <th className="w-40 px-3 py-2 text-left">&nbsp;</th>
            <th className="px-3 py-2">Books with it</th>
          </tr>
        </thead>
        <tbody>
          {r.components.map((c) => (
            <tr key={c.id} className="border-b border-ink-50 last:border-0">
              <td className="px-4 py-2.5 font-medium text-ink-800" title={c.hint}>
                {c.label}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-800">{fmtUsd(c.perBookUsd)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-600">{fmtUsd(c.perPageUsd)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-600">{fmtPct(c.share, 1)}</td>
              <td className="px-3 py-2.5">
                <div className="h-2 rounded-full bg-ink-100">
                  <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (c.share / max) * 100)}%` }} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">
                {fmtNumber(c.booksWith)} <span className="text-ink-300">/ {fmtNumber(r.books)}</span>
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink-200 bg-ink-50/50 font-semibold">
            <td className="px-4 py-2.5 text-ink-900">Everything, all in</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-ink-900">{fmtUsd(r.headline.perBookUsd)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-ink-900">{fmtUsd(r.headline.perPageUsd)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-ink-900">100%</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
        <span>
          Pictures <strong className="tabular-nums text-ink-800">{fmtUsd(r.split.imageUsd / r.books)}</strong> · Text{" "}
          <strong className="tabular-nums text-ink-800">{fmtUsd(r.split.textUsd / r.books)}</strong>
          {r.split.unsplitUsd > 0 && (
            <>
              {" "}
              · not split <strong className="tabular-nums text-ink-800">{fmtUsd(r.split.unsplitUsd / r.books)}</strong>
            </>
          )}{" "}
          per book
        </span>
        <span title="Spend on attempts that produced nothing (failures, timeouts). Already inside the total above, not extra.">
          of which failed attempts{" "}
          <strong className="tabular-nums text-ink-800">
            {fmtUsd(r.within.failedUsd / r.books)} ({fmtPct(r.within.failedShare, 1)})
          </strong>
        </span>
        <span title="Quality-control repairs and duplicate renders we paid for but did not charge the reader. Already inside the total above, and can overlap with failed attempts.">
          of which absorbed by us{" "}
          <strong className="tabular-nums text-ink-800">
            {fmtUsd(r.within.absorbedUsd / r.books)} ({fmtPct(r.within.absorbedShare, 1)})
          </strong>
        </span>
      </div>
    </div>
  );
}

function GrantPanel({ r }: { r: BookCostReport }) {
  const g = r.grant;
  const s = r.sparks;
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft">
      <h3 className="text-sm font-semibold text-ink-900">Sizing the free Sparks</h3>
      {!s.enabled && (
        <p className="mt-1 text-xs text-amber-700">The Sparks economy is switched off right now; these figures are hypothetical.</p>
      )}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-ink-50 p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Today&apos;s signup grant</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-ink-900">{fmtNumber(g.grantSparks)} ✦</div>
          <div className="text-[11px] text-ink-500">
            costs us up to {fmtUsd(g.grantCostUsd)} if fully spent (at {fmtUsd(s.costPerFreeSparkUsd)} per free Spark)
          </div>
        </div>
        <div className="rounded-xl bg-ink-50 p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">What it covers</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-ink-900">{fmtPct(g.booksCoveredShare, 0)} of books</div>
          <div className="text-[11px] text-ink-500">
            = {g.averageBooksCovered.toFixed(2)} average books, {g.medianBooksCovered.toFixed(2)} typical (median) books
          </div>
        </div>
        <div className="rounded-xl bg-ink-50 p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Free Sparks to cover a book</div>
          <div className="mt-1 text-sm tabular-nums text-ink-800">
            typical <strong>{fmtNumber(g.sparksToCover.p50)} ✦</strong> · 3 in 4 <strong>{fmtNumber(g.sparksToCover.p75)} ✦</strong> ·
            9 in 10 <strong>{fmtNumber(g.sparksToCover.p90)} ✦</strong>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">at today&apos;s prices, for a book of this mix</div>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs text-sky-900 ring-1 ring-sky-100">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <div className="space-y-1">
          <p>
            <strong>Which Spark value to use?</strong> For free Sparks, use what a free Spark costs us:{" "}
            <strong>{fmtUsd(s.costPerFreeSparkUsd)}</strong> (Spark price {fmtUsd(s.pegUsd)} ÷ markup {s.markup}). It doesn&apos;t
            depend on who buys what, because every price is set as cost × markup ÷ Spark price. The dollar figures above are
            the ground truth; Sparks are only that cost converted at this rate.
          </p>
          <p>
            Check against reality:{" "}
            {s.realizedCostPerChargedSparkUsd != null ? (
              <>
                these books cost us <strong>{fmtUsd(s.realizedCostPerChargedSparkUsd)}</strong> per Spark actually charged
                {Math.abs(s.realizedCostPerChargedSparkUsd - s.costPerFreeSparkUsd) / Math.max(s.costPerFreeSparkUsd, 1e-9) > 0.2
                  ? " — noticeably off the list rate, so prices and real costs have drifted apart."
                  : " — in line with the list rate."}
              </>
            ) : (
              "no Sparks were charged on these books."
            )}{" "}
            {s.packRevenuePerSpark && (
              <>
                A bought Spark brings in {fmtUsd(s.packRevenuePerSpark.min)}–{fmtUsd(s.packRevenuePerSpark.max)} depending on the
                pack: that is revenue, a different question from what a free one costs.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function Notes({ r }: { r: BookCostReport }) {
  const q = r.quality;
  return (
    <div className="space-y-2">
      <div
        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs ring-1 ${
          q.componentsReconcile ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-amber-50 text-amber-800 ring-amber-100"
        }`}
      >
        {q.componentsReconcile ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
        {q.componentsReconcile
          ? "The parts add up to the total."
          : "The parts do not add up to the total — treat the breakdown as approximate."}
      </div>
      {q.notes.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-white px-4 py-3 text-xs text-ink-600 ring-1 ring-ink-100">
          {q.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
