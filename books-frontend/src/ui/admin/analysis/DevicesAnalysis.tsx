"use client";

/**
 * Analysis → Devices.
 *
 * Four questions, in the order an admin actually asks them:
 *   1. What is the mix, and is it moving? (the stacked series)
 *   2. Does each form factor earn its share? (per-device economics)
 *   3. Do people move between devices, and does moving decide whether they buy?
 *      (the cross-device cohorts — the card this tab exists for)
 *   4. What do we have to keep working? (OS / browser / viewport tails)
 *
 * The cohort card is the one worth reading first. Every other number here can be
 * had from a generic analytics tool; "our mobile visitors convert 3× better once
 * they reach a laptop" is a product decision (build a hand-off), and it can only
 * be computed because the per-user rollup remembers both devices.
 */
import { useEffect } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Info,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { deviceLabel } from "../../../core/analytics/device";
import type {
  CrossDeviceCohort,
  DeviceCountRow,
  DeviceReport,
  DeviceSegmentRow,
} from "../../../core/analytics/types";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { useAdminMarket } from "../../../state/adminMarketStore";
import { Button } from "../../components/Button";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { cn } from "../../lib/cn";
import { downloadCsv } from "./csv";
import { fmtDayKey, fmtDuration, fmtNumber, fmtUsd } from "./format";

/** One colour per form factor, reused by the chart and the tables. */
const DEVICE_COLORS: Record<string, string> = {
  mobile: "#6366f1",
  tablet: "#f59e0b",
  desktop: "#10b981",
  unknown: "#cbd5e1",
};

const STACK_ORDER = ["mobile", "tablet", "desktop"] as const;

export function DevicesAnalysis() {
  const report = useAdminAnalytics((s) => s.devices);
  const loading = useAdminAnalytics((s) => s.devicesLoading);
  const refresh = useAdminAnalytics((s) => s.refreshDevices);
  const country = useAdminMarket((s) => s.country);

  // Mount-time fetch; the Analysis tab re-fetches on a market change.
  useEffect(() => {
    if (!report) void refresh();
  }, [report, refresh]);

  if (!report && loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-400">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  if (!report) {
    return (
      <p className="py-16 text-center text-sm text-ink-400">
        Device analytics couldn&apos;t be loaded.
      </p>
    );
  }

  if (!report.hasSessionData) {
    return <NoDataYet />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Stat label="Sessions" value={fmtNumber(report.totals.sessions)} />
          <Stat label="Accounts measured" value={fmtNumber(report.totals.users)} />
          <Stat
            label="Use more than one device"
            value={report.totals.multiDevicePct == null ? "—" : `${report.totals.multiDevicePct}%`}
            emphasis
          />
        </div>
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

      {report.capped && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-100">
          Showing a partial scan (project exceeds the per-request user cap) — counts are a lower
          bound, and the cross-device rates below are withheld rather than estimated from a
          truncated sample.
        </div>
      )}

      <MixChart report={report} />

      <CrossDeviceCard report={report} />

      <SegmentTable
        title="Form factors"
        subtitle="Sessions are exact per device; conversion is per PERSON, so a phone that gets picked up ten times a day doesn't look ten times worse at selling."
        rows={report.byDevice}
        colorKey
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SegmentTable
          title="Operating systems"
          subtitle="Where your audience lives. Session counts follow each account's latest OS."
          rows={report.byOs}
          compact
        />
        <SegmentTable
          title="Browsers"
          subtitle="Major versions only — the support tail you have to keep testing against."
          rows={report.byBrowser}
          compact
        />
      </div>

      <ViewportCard rows={report.byViewport} allMarkets={report.seriesAllMarkets} />

      {country && report.seriesAllMarkets && (
        <div className="flex items-start gap-2 rounded-xl bg-ink-50 px-3.5 py-2.5 text-xs text-ink-500">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            The session curve and viewport split above cover <strong>all markets</strong> — the daily
            session counters have no market dimension. Every other number on this tab is scoped to
            the market you selected.
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            downloadCsv(
              "devices",
              report.byDevice.map((r) => ({
                device: r.key,
                label: r.label,
                sessions: r.sessions,
                users: r.users,
                signups: r.signups,
                purchases: r.purchases,
                revenueUsd: r.revenueUsd,
                conversionPct: r.conversionPct ?? "",
                refundRatePct: r.refundRatePct ?? "",
              })),
            )
          }
        >
          Export devices CSV
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-ink-400">{label}</div>
      <div
        className={cn(
          "tabular-nums",
          emphasis ? "text-lg font-semibold text-brand-700" : "text-lg font-semibold text-ink-800",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function NoDataYet() {
  return (
    <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-ink-100 shadow-soft">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Smartphone className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-ink-800">No device data yet</h3>
      <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-ink-500">
        Device facts are recorded forward-only, from the moment the session beacon and the auth
        triggers ship — there&apos;s no history to backfill, because the browser signals they read
        only exist while the request is happening. Numbers will start appearing here as people use
        the studio.
      </p>
    </div>
  );
}

/** Stacked daily session mix. The trend matters more than today's split. */
function MixChart({ report }: { report: DeviceReport }) {
  const data = report.series.map((p) => ({
    label: fmtDayKey(p.day),
    ...Object.fromEntries(STACK_ORDER.map((k) => [k, p.sessions[k] ?? 0])),
  }));
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Sessions by device over time</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          A session is a visit with no more than a 30-minute gap in it, derived server-side — no
          cookie is set to measure this.
        </p>
      </CardHeader>
      <CardBody className="pt-2">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#9aa1ac" }}
                tickLine={false}
                axisLine={false}
                minTickGap={20}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#9aa1ac" }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #eef0f3",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  fontSize: 12,
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              {STACK_ORDER.map((key) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={deviceLabel(key)}
                  stackId="1"
                  stroke={DEVICE_COLORS[key]}
                  fill={DEVICE_COLORS[key]}
                  fillOpacity={0.28}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </div>
  );
}

/**
 * The cross-device story, per signup cohort.
 *
 * Reads as a sentence per row on purpose: "of the 412 people who signed up on a
 * phone, 38% later came back on something bigger, typically after 2.1 days — and
 * those who did bought at 9.4% against 2.1% for those who never left the phone."
 * A table of six percentages says the same thing and gets skimmed.
 */
function CrossDeviceCard({ report }: { report: DeviceReport }) {
  const { cohorts, observationDays, reliable } = report.crossDevice;
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowRightLeft className="size-4 text-brand-500" />
          Do they switch device — and does it change whether they buy?
        </CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          Accounts created in the last {observationDays} days, grouped by the device they signed up
          on and followed forwards. This card deliberately ignores the timeframe above: switching
          devices takes days, so a one-day window would always say nobody does.
        </p>
      </CardHeader>
      <CardBody className="pt-2">
        {!reliable ? (
          <p className="py-6 text-center text-sm text-ink-400">
            Withheld while the user scan is capped — a truncated sample skews a rate in an unknown
            direction, so there&apos;s nothing honest to show.
          </p>
        ) : cohorts.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">
            No signups with a recorded device in the last {observationDays} days yet.
          </p>
        ) : (
          <div className="space-y-3">
            {cohorts.map((c) => (
              <CohortRow key={c.signupDevice} cohort={c} />
            ))}
          </div>
        )}
      </CardBody>
    </div>
  );
}

function CohortRow({ cohort: c }: { cohort: CrossDeviceCohort }) {
  const lift =
    c.conversionSwitchedPct != null && c.conversionSameDevicePct != null && c.conversionSameDevicePct > 0
      ? c.conversionSwitchedPct / c.conversionSameDevicePct
      : null;
  return (
    <div className="rounded-xl bg-ink-50/60 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-700">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: DEVICE_COLORS[c.signupDevice] ?? "#64748b" }}
        >
          {c.signupDevice === "desktop" ? (
            <Monitor className="size-3" />
          ) : (
            <Smartphone className="size-3" />
          )}
          Signed up on {deviceLabel(c.signupDevice).toLowerCase()}
        </span>
        <span className="tabular-nums font-semibold text-ink-800">{fmtNumber(c.users)}</span>
        <span className="text-ink-500">accounts, of which</span>
        <span className="tabular-nums font-semibold text-ink-800">
          {c.switchedPct == null ? "—" : `${c.switchedPct}%`}
        </span>
        <span className="text-ink-500">
          later showed up on a different device
          {c.medianSwitchLagMs != null && (
            <> (typically after {fmtDuration(c.medianSwitchLagMs)})</>
          )}
          .
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <ConversionBit
          label="Switched, then bought"
          pct={c.conversionSwitchedPct}
          count={c.paidAfterSwitch}
        />
        <ConversionBit
          label="Never switched, bought"
          pct={c.conversionSameDevicePct}
          count={c.paidSameDevice}
        />
        {lift != null && lift >= 1.5 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-100">
            {lift.toFixed(1)}× better after switching — worth making the hand-off easy
          </span>
        )}
        {lift != null && lift <= 0.67 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-100">
            Converts better without switching — this device finishes the job
          </span>
        )}
      </div>

      {c.purchaseDevices.length > 0 && (
        <div className="mt-2 text-xs text-ink-500">
          Bought on:{" "}
          {c.purchaseDevices.map((p, i) => (
            <span key={p.device}>
              {i > 0 && ", "}
              <span className="font-medium text-ink-700">{deviceLabel(p.device)}</span>{" "}
              <span className="tabular-nums">({fmtNumber(p.purchases)})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversionBit({
  label,
  pct,
  count,
}: {
  label: string;
  pct: number | null;
  count: number;
}) {
  return (
    <span className="text-ink-500">
      {label}:{" "}
      <span className="tabular-nums font-semibold text-ink-800">
        {pct == null ? "—" : `${pct}%`}
      </span>
      <span className="ml-1 text-ink-400">({fmtNumber(count)})</span>
    </span>
  );
}

function SegmentTable({
  title,
  subtitle,
  rows,
  colorKey,
  compact,
}: {
  title: string;
  subtitle: string;
  rows: DeviceSegmentRow[];
  colorKey?: boolean;
  compact?: boolean;
}) {
  const maxSessions = Math.max(1, ...rows.map((r) => r.sessions));
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>
      </CardHeader>
      <CardBody className="pt-1">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">Nothing recorded yet.</p>
        ) : (
          <div className={cn("overflow-x-auto", compact && "max-h-72 overflow-y-auto")}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs text-ink-400">
                  <th className="py-2 font-medium">{title.replace(/s$/, "")}</th>
                  <th className="py-2 text-right font-medium">Sessions</th>
                  <th className="py-2 text-right font-medium">People</th>
                  {!compact && <th className="py-2 text-right font-medium">Signups</th>}
                  <th className="py-2 text-right font-medium">Bought</th>
                  {!compact && <th className="py-2 text-right font-medium">Revenue</th>}
                  <th className="py-2 text-right font-medium">Conv.</th>
                  {!compact && <th className="py-2 text-right font-medium">Refunds</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-ink-50">
                    <td className="py-2 text-ink-700">
                      {colorKey && (
                        <span
                          className="mr-2 inline-block size-2 rounded-full align-middle"
                          style={{ backgroundColor: DEVICE_COLORS[r.key] ?? "#94a3b8" }}
                        />
                      )}
                      {r.label}
                      <span className="ml-2 inline-block h-1 w-16 overflow-hidden rounded-full bg-ink-100 align-middle">
                        <span
                          className="block h-full rounded-full bg-brand-400"
                          style={{ width: `${Math.round((r.sessions / maxSessions) * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-800">
                      {fmtNumber(r.sessions)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-600">
                      {r.users > 0 ? fmtNumber(r.users) : "—"}
                    </td>
                    {!compact && (
                      <td className="py-2 text-right tabular-nums text-emerald-600">
                        {r.signups > 0 ? fmtNumber(r.signups) : "—"}
                      </td>
                    )}
                    <td className="py-2 text-right tabular-nums text-ink-600">
                      {r.purchases > 0 ? fmtNumber(r.purchases) : "—"}
                    </td>
                    {!compact && (
                      <td className="py-2 text-right tabular-nums text-ink-800">
                        {r.revenueUsd > 0 ? fmtUsd(r.revenueUsd) : "—"}
                      </td>
                    )}
                    <td className="py-2 text-right tabular-nums font-semibold text-ink-800">
                      {r.conversionPct == null ? "—" : `${r.conversionPct}%`}
                    </td>
                    {!compact && (
                      <td className="py-2 text-right tabular-nums text-rose-600">
                        {r.refundRatePct == null || r.refundRatePct === 0
                          ? "—"
                          : `${r.refundRatePct}%`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </div>
  );
}

/**
 * Viewport widths, against the app's own breakpoints.
 *
 * Sparse by design: this is the one dimension read from the DOM rather than from
 * a header the browser already sent, so it's only collected with analytics
 * consent. A share that looks small is a consent rate, not a screen size.
 */
function ViewportCard({
  rows,
  allMarkets,
}: {
  rows: DeviceCountRow[];
  allMarkets: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Viewport widths</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          Bucketed against the breakpoints the app is built on, so you can tell whether the layout
          matches the screens it&apos;s actually on{allMarkets ? " (all markets)" : ""}.
        </p>
      </CardHeader>
      <CardBody className="pt-1">
        {rows.length === 0 ? (
          <div className="flex items-start gap-2 py-4 text-xs text-ink-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <span>
              Nothing recorded yet. Screen size is only measured for visitors who accepted analytics
              cookies — everything else on this tab comes from request headers and needs no consent.
            </span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-xs text-ink-500">{r.label}</span>
                <span className="h-5 flex-1 overflow-hidden rounded-md bg-ink-50">
                  <span
                    className="block h-full rounded-md bg-brand-300"
                    style={{ width: `${Math.max(1, r.sharePct)}%` }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-600">
                  {r.sharePct}% · {fmtNumber(r.sessions)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </div>
  );
}
