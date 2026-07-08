"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import { Field } from "../../components/Input";
import { useAppConfigStore } from "../../../state/appConfigStore";
import type {
  ActionCostReport,
  ActionCostSeriesPoint,
  CostGranularity,
} from "../../../core/analytics/types";
import { TEXT_ACTIONS, IMAGE_ACTIONS } from "../../../core/ai/actions";
import { DEFAULT_IMAGE_TIER_LABELS, type ImageTier } from "../../../core/config/modelConfig";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  [...TEXT_ACTIONS, ...IMAGE_ACTIONS].map((a) => [a.id, a.label]),
);

const GRANULARITIES = [
  { value: "day", label: "Daily" },
  { value: "hour", label: "Hourly" },
];

/** Slider bounds per granularity: max buckets the backend will honor. */
const SLIDER = {
  day: { min: 1, max: 90, default: 30, unit: "day", stepMs: DAY_MS },
  hour: { min: 1, max: 336, default: 48, unit: "hour", stepMs: HOUR_MS },
} as const;

function usd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 5 : 4)}`;
}

/** Human label for the slider value (e.g. "48 hours (2 days)"). */
function windowLabel(units: number, g: CostGranularity): string {
  if (g === "hour") {
    const days = Math.round((units / 24) * 10) / 10;
    return `${units} hour${units === 1 ? "" : "s"}${units >= 24 ? ` (${days} day${days === 1 ? "" : "s"})` : ""}`;
  }
  return `${units} day${units === 1 ? "" : "s"}`;
}

/** Short axis label from a bucket key ("YYYY-MM-DD" or "YYYY-MM-DD HH"). */
function bucketAxisLabel(p: ActionCostSeriesPoint, g: CostGranularity): string {
  const [date, hour] = p.bucket.split(" ");
  const md = date.slice(5);
  return g === "hour" ? `${md} ${hour}:00` : md;
}

/**
 * The admin "Cost intelligence" view. A window slider + hourly/daily granularity
 * drive a live (debounced) re-query; charts plot spend & call volume over time,
 * and the table breaks down measured backend cost per AI action (avg/p90 + how
 * often it runs), the derived Spark price, and the realized margin — flagging
 * any action whose price doesn't cover its p90 cost.
 */
export function CostIntelligenceTab() {
  const load = useAppConfigStore((s) => s.loadActionCosts);
  const tierLabels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  const tierLabel = (t: ImageTier) => tierLabels?.[t]?.trim() || DEFAULT_IMAGE_TIER_LABELS[t];
  const [granularity, setGranularity] = useState<CostGranularity>("day");
  const [units, setUnits] = useState<number>(SLIDER.day.default);
  const [report, setReport] = useState<ActionCostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const conf = SLIDER[granularity];

  // Debounced fetch: dragging the slider or flipping granularity re-queries the
  // backend ~250ms after the last change so the numbers track "in real time"
  // without a request per pixel. A monotonic token drops stale responses.
  useEffect(() => {
    const handle = setTimeout(() => {
      const token = ++reqRef.current;
      const to = Date.now();
      const from = to - units * conf.stepMs;
      setLoading(true);
      load({ from, to, granularity })
        .then((r) => {
          if (token === reqRef.current) setReport(r);
        })
        .catch((err) => {
          if (token === reqRef.current) {
            toast.error(err instanceof Error ? err.message : "Could not load report.");
          }
        })
        .finally(() => {
          if (token === reqRef.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [load, granularity, units, conf.stepMs]);

  const onGranularity = (next: CostGranularity) => {
    setGranularity(next);
    setUnits(SLIDER[next].default);
  };

  const refreshNow = () => {
    // Bump the token to force a fresh fetch immediately (skip the debounce wait).
    const token = ++reqRef.current;
    const to = Date.now();
    const from = to - units * conf.stepMs;
    setLoading(true);
    load({ from, to, granularity })
      .then((r) => token === reqRef.current && setReport(r))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load report."))
      .finally(() => token === reqRef.current && setLoading(false));
  };

  const series = useMemo(
    () => (report?.series ?? []).map((p) => ({ ...p, label: bucketAxisLabel(p, granularity) })),
    [report, granularity],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Measured backend cost per action over the window, with the current Spark price and the
          realized margin. Use this to set the peg, markup and per-action prices on the Sparks tab so
          prices stay fair <span className="font-medium">and</span> sustainable.
        </p>
        <div className="flex items-end gap-2">
          <Field label="Granularity" className="w-32">
            <Select
              value={granularity}
              options={GRANULARITIES}
              onChange={(e) => onGranularity(e.target.value as CostGranularity)}
            />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="size-3.5" />}
            onClick={refreshNow}
            loading={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Window slider */}
      <div className="rounded-lg ring-1 ring-inset ring-ink-100 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-600">Window</span>
          <span className="text-xs font-semibold tabular-nums text-ink-800">
            {windowLabel(units, granularity)}
          </span>
        </div>
        <input
          type="range"
          min={conf.min}
          max={conf.max}
          step={1}
          value={units}
          onChange={(e) => setUnits(Number(e.target.value))}
          className="mt-2 w-full"
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-400">
          <span>
            {conf.min} {conf.unit}
          </span>
          <span>
            {conf.max} {conf.unit}s
          </span>
        </div>
      </div>

      {report && (
        <>
          {/* Headline values (update as the slider moves) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total cost" value={usd(report.totalCostUsd)} />
            <Stat label="Calls" value={report.totalEvents.toLocaleString()} />
            <Stat
              label="Avg / call"
              value={report.totalEvents > 0 ? usd(report.totalCostUsd / report.totalEvents) : "—"}
            />
            <Stat label="Actions priced" value={`${report.actions.length}`} />
          </div>

          {report.capped && (
            <Banner>Scan hit its safety cap — figures are a lower bound. Narrow the window for exact numbers.</Banner>
          )}
          {report.hasUnpriced && (
            <Banner>
              Some calls used a model with no configured cost, so totals are understated. Fill in the
              Model costs tab for complete numbers.
            </Banner>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title="Spend over time">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [usd(Number(v)), "Cost"]} />
                  <Area type="monotone" dataKey="costUsd" name="Cost" stroke="#6366f1" strokeWidth={2} fill="url(#gradCost)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Calls over time">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} width={36} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [Number(v).toLocaleString(), "Calls"]} />
                  <Bar dataKey="count" name="Calls" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 text-right font-semibold">Calls</th>
                  <th className="px-3 py-2 text-right font-semibold">Avg</th>
                  <th className="px-3 py-2 text-right font-semibold">Median</th>
                  <th className="px-3 py-2 text-right font-semibold">p90</th>
                  <th className="px-3 py-2 text-right font-semibold">Max</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-right font-semibold">Spark price</th>
                  <th className="px-3 py-2 text-right font-semibold">Margin/call</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {report.actions.map((a) => (
                  <tr key={`${a.action}:${a.tier ?? ""}`} className={a.underwaterAtP90 ? "bg-amber-50/60" : "bg-white"}>
                    <td className="px-3 py-2 font-medium text-ink-800">
                      <span className="flex items-center gap-1.5">
                        {a.underwaterAtP90 && <AlertTriangle className="size-3.5 text-amber-500" />}
                        {ACTION_LABELS[a.action] ?? a.action}
                        {a.tier && (
                          <span
                            className={
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset " +
                              (a.tier === "premium"
                                ? "bg-brand-50 text-brand-700 ring-brand-100"
                                : "bg-amber-50 text-amber-700 ring-amber-200")
                            }
                          >
                            {tierLabel(a.tier)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-600">{a.count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-600">{usd(a.avgUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-500">{usd(a.medianUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-500">{usd(a.p90Usd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-500">{usd(a.maxUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-600">{usd(a.totalUsd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-brand-700">
                      {a.sparkPrice != null ? `${a.sparkPrice} ✦` : "free"}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${a.marginUsd != null && a.marginUsd < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {a.marginUsd != null ? usd(a.marginUsd) : "—"}
                    </td>
                  </tr>
                ))}
                {report.actions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-ink-400">
                      No usage recorded in this window yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-ink-400">
            {report.totalEvents.toLocaleString()} calls scanned • {report.granularity} buckets •{" "}
            Sparks{" "}
            {report.sparksEnabled ? `enabled (1 ✦ = $${report.sparkValueUsd})` : "disabled (prices shown as if enabled)"} •
            generated {new Date(report.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-50/60 p-3 ring-1 ring-inset ring-ink-100">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="mb-1 text-xs font-medium text-ink-600">{title}</div>
      <div className="h-56 w-full">{children}</div>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #eef0f3",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  fontSize: 12,
};
