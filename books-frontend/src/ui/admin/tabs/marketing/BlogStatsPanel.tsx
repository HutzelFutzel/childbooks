"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Eye, Users, MousePointerClick, TrendingUp, RefreshCw } from "lucide-react";
import { Button } from "../../../components/Button";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import {
  createDefaultBlogStats,
  dailySeries,
  topEntries,
  type BlogStats,
} from "../../../../core/config/blogStats";

const DEVICE_LABELS: Record<string, string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};

const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct",
  organic: "Organic search",
  social: "Social",
  referral: "Referral",
  paid: "Paid",
  email: "Email",
};

let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  if (code === "ZZ" || !code) return "Unknown";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function flag(code: string): string {
  if (code === "ZZ" || !/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** A short label date, e.g. "Jul 23" from "2026-07-23". */
function shortDate(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Per-post analytics panel shown inside the article editor. Renders the
 * cookieless first-party aggregates: traffic, unique visitors, CTA conversion,
 * a daily views chart and coarse breakdowns (country, channel, device, referrer,
 * scroll-depth funnel). Read-only.
 */
export function BlogStatsPanel({ slug }: { slug: string }) {
  const loadBlogStats = useAppConfigStore((s) => s.loadBlogStats);
  const [stats, setStats] = useState<BlogStats>(() => createDefaultBlogStats(slug));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await loadBlogStats(slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load stats.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const series = useMemo(() => {
    const all = dailySeries(stats);
    return all.slice(-30).map((p) => ({ ...p, label: shortDate(p.date) }));
  }, [stats]);

  const ctaRate = stats.views > 0 ? (stats.ctaClicks / stats.views) * 100 : 0;
  const hasData = stats.views > 0 || stats.updatedAt > 0;

  if (loading) {
    return <p className="py-8 text-center text-sm text-ink-400">Loading analytics…</p>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 py-8 text-center">
        <p className="text-sm text-ink-500">{error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 py-10 text-center">
        <p className="text-sm text-ink-500">No traffic recorded yet.</p>
        <p className="mt-1 text-xs text-ink-400">
          Views, unique visitors and CTA clicks appear here once the published article gets visitors.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] leading-relaxed text-ink-400">
          Cookieless, first-party analytics — no personal data stored. Unique visitors are counted
          per day via a rotating anonymous hash.
        </p>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="size-3.5" />}
          onClick={refresh}
        >
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={<Eye className="size-4" />} label="Views" value={stats.views} />
        <Metric icon={<Users className="size-4" />} label="Unique visitors" value={stats.uniques} />
        <Metric
          icon={<MousePointerClick className="size-4" />}
          label="CTA clicks"
          value={stats.ctaClicks}
        />
        <Metric
          icon={<TrendingUp className="size-4" />}
          label="CTA rate"
          value={`${ctaRate.toFixed(1)}%`}
        />
      </div>

      {series.length > 0 && (
        <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
          <p className="mb-3 text-xs font-semibold text-ink-600">Views over time</p>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#9aa1ac" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
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
                  formatter={(value, name) => [value as number, name === "u" ? "Unique" : "Views"]}
                  labelFormatter={(l) => String(l)}
                />
                <Bar dataKey="v" name="Views" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="u" name="Unique" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Breakdown
          title="Top countries"
          rows={topEntries(stats.byCountry).map(([code, n]) => ({
            label: `${flag(code)} ${countryName(code)}`,
            value: n,
          }))}
        />
        <Breakdown
          title="Traffic channels"
          rows={topEntries(stats.byChannel).map(([key, n]) => ({
            label: CHANNEL_LABELS[key] ?? key,
            value: n,
          }))}
        />
        <Breakdown
          title="Devices"
          rows={topEntries(stats.byDevice).map(([key, n]) => ({
            label: DEVICE_LABELS[key] ?? key,
            value: n,
          }))}
        />
        <Breakdown
          title="Top referrers"
          rows={topEntries(stats.byReferrerHost).map(([host, n]) => ({ label: host, value: n }))}
          emptyLabel="No referral traffic yet."
        />
      </div>

      <ReadFunnel stats={stats} />

      {Object.keys(stats.ctaByCountry).length > 0 && (
        <Breakdown
          title="CTA clicks by country"
          hint="Where your converting readers are."
          rows={topEntries(stats.ctaByCountry).map(([code, n]) => ({
            label: `${flag(code)} ${countryName(code)}`,
            value: n,
          }))}
        />
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-inset ring-ink-100">
      <div className="flex items-center gap-1.5 text-ink-400">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-2xl font-bold text-ink-900">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function Breakdown({
  title,
  hint,
  rows,
  emptyLabel = "No data yet.",
}: {
  title: string;
  hint?: string;
  rows: { label: string; value: number }[];
  emptyLabel?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <p className="text-xs font-semibold text-ink-600">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-ink-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-center justify-between text-xs text-ink-700">
                <span className="truncate pr-2">{r.label}</span>
                <span className="font-medium tabular-nums text-ink-500">
                  {r.value.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-400"
                  style={{ width: `${max > 0 ? Math.max(4, (r.value / max) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Scroll-depth funnel: how far readers get through the article. */
function ReadFunnel({ stats }: { stats: BlogStats }) {
  const buckets = ["25", "50", "75", "100"];
  const values = buckets.map((b) => stats.readBuckets[b] ?? 0);
  const max = Math.max(...values, 0);
  if (max === 0) {
    return (
      <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
        <p className="text-xs font-semibold text-ink-600">Read depth</p>
        <p className="mt-3 text-xs text-ink-400">No read-depth data yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <p className="text-xs font-semibold text-ink-600">Read depth</p>
      <p className="mt-0.5 text-[11px] text-ink-400">
        How many sessions scrolled to each point of the article.
      </p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {buckets.map((b, i) => (
          <div key={b} className="text-center">
            <div className="flex h-24 items-end justify-center">
              <div
                className="w-8 rounded-t-md bg-brand-400"
                style={{ height: `${max > 0 ? Math.max(6, (values[i] / max) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm font-semibold tabular-nums text-ink-800">{values[i]}</p>
            <p className="text-[11px] text-ink-400">{b}%</p>
          </div>
        ))}
      </div>
    </div>
  );
}
