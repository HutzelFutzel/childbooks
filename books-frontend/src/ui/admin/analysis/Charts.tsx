"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActivityGrid,
  AnalyticsOverview,
  TimezoneMode,
} from "../../../core/analytics/types";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { fmtDayKey, fmtNumber } from "./format";

const SIGNUP_COLOR = "#10b981";
const LOGIN_COLOR = "#0ea5e9";
const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#a855f7"];

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
      </CardHeader>
      <CardBody className="pt-2">{children}</CardBody>
    </div>
  );
}

/** Signups + logins per day across the selected window. */
export function ActivityChart({ overview }: { overview: AnalyticsOverview }) {
  const data = overview.series.map((p) => ({ ...p, label: fmtDayKey(p.day) }));
  return (
    <ChartCard title="Signups & logins over time">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="gradSignups" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={SIGNUP_COLOR} stopOpacity={0.35} />
                <stop offset="95%" stopColor={SIGNUP_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradLogins" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={LOGIN_COLOR} stopOpacity={0.35} />
                <stop offset="95%" stopColor={LOGIN_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9aa1ac" }} tickLine={false} axisLine={false} minTickGap={20} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9aa1ac" }} tickLine={false} axisLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="signups" name="Signups" stroke={SIGNUP_COLOR} strokeWidth={2} fill="url(#gradSignups)" />
            <Area type="monotone" dataKey="logins" name="Logins" stroke={LOGIN_COLOR} strokeWidth={2} fill="url(#gradLogins)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/**
 * Signup source split (Email / Google / Guest …) for the window, with the
 * form-factor split of the same signups underneath.
 *
 * The two belong together: "where did they come from" and "what were they
 * holding" are one question when you're deciding which sign-up flow to polish.
 * The device row is absent for windows that predate device capture rather than
 * showing zeroes — the auth event log is forward-only.
 */
export function SourcesChart({ overview }: { overview: AnalyticsOverview }) {
  const data = overview.signupSources;
  const hasData = data.some((d) => d.value > 0);
  const devices = overview.signupDevices.filter((d) => d.value > 0);
  const deviceTotal = devices.reduce((sum, d) => sum + d.value, 0);
  return (
    <ChartCard title="Signup sources">
      <div className="h-64 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} outerRadius={84} paddingAngle={2}>
                {data.map((entry, i) => (
                  <Cell key={entry.key} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart label="No signups in this window" />
        )}
      </div>
      {devices.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-50 pt-2.5 text-xs text-ink-500">
          <span className="text-ink-400">On:</span>
          {devices.map((d) => (
            <span key={d.key}>
              <span className="font-medium text-ink-700">{d.label}</span>{" "}
              <span className="tabular-nums">
                {deviceTotal > 0 ? `${Math.round((d.value / deviceTotal) * 100)}%` : ""}
              </span>
            </span>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Activity distribution by hour of day, in the same clock the heatmap uses.
 * Plots events and distinct people together: when the two curves diverge, a few
 * heavy users are driving the hour rather than a broad audience.
 */
export function HourChart({
  grid,
  tzMode,
  timezone,
  metricLabel,
}: {
  grid: ActivityGrid;
  tzMode: TimezoneMode;
  timezone: string;
  metricLabel: string;
}) {
  const data = grid.byHour.map((events, hour) => ({
    hour: `${hour}`,
    events,
    users: grid.usersByHour[hour] ?? 0,
  }));
  return (
    <ChartCard
      title={`${metricLabel} by hour of day`}
      subtitle={
        tzMode === "market"
          ? "Each event in its own market's local time."
          : `All events in ${timezone}.`
      }
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} interval={1} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9aa1ac" }} tickLine={false} axisLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [fmtNumber(Number(v)), n]} labelFormatter={(h) => `${h}:00`} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="events" name="Events" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="users" name="People" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-ink-400">{label}</div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #eef0f3",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  fontSize: 12,
};
