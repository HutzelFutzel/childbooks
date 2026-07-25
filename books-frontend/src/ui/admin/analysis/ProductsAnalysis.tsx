"use client";

/**
 * Top products.
 *
 * One ranking across print books, ebooks, Spark packs and subscription plans,
 * because "what should we sell more of" doesn't respect those boundaries. Every
 * row is a NET figure: the print COGS, Stripe fee, refund and remitted tax that
 * belong to a sale carry the same product key as the revenue, so a high-volume
 * product with thin margin can't masquerade as a winner.
 *
 * Selecting a row expands its daily series and the markets it sells into.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
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
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import type { ProductFamily, ProductRow, Timeframe } from "../../../core/analytics/types";
import { useAdminAnalytics } from "../../../state/adminAnalyticsStore";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import { downloadCsv } from "./csv";
import { fmtDayKey, fmtNumber, fmtRelative, fmtUsd } from "./format";

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "custom", label: "Custom" },
];

const FAMILY_BADGE: Record<ProductFamily, string> = {
  print: "bg-brand-50 text-brand-700",
  ebook: "bg-sky-50 text-sky-700",
  pack: "bg-amber-50 text-amber-700",
  plan: "bg-violet-50 text-violet-700",
  other: "bg-ink-100 text-ink-600",
};

const FAMILY_LABEL: Record<ProductFamily, string> = {
  print: "Print",
  ebook: "Ebook",
  pack: "Sparks",
  plan: "Plan",
  other: "Other",
};

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #eef0f3",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  fontSize: 12,
};

export function ProductsAnalysis() {
  const report = useAdminAnalytics((s) => s.products);
  const loading = useAdminAnalytics((s) => s.productsLoading);
  const error = useAdminAnalytics((s) => s.error);
  const lastUpdated = useAdminAnalytics((s) => s.lastUpdated);
  const timeframe = useAdminAnalytics((s) => s.timeframe);
  const setTimeframe = useAdminAnalytics((s) => s.setTimeframe);
  const refreshProducts = useAdminAnalytics((s) => s.refreshProducts);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!report) void refreshProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = report?.products ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={TIMEFRAMES} value={timeframe} onChange={(id) => setTimeframe(id as Timeframe)} />
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-ink-400">Updated {fmtRelative(lastUpdated)}</span>}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="size-4" />}
            disabled={products.length === 0}
            onClick={() => downloadCsv("products", products.map(toCsvRow))}
          >
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={() => void refreshProducts()}
            disabled={loading}
          >
            Refresh
          </Button>
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

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Revenue" value={fmtUsd(report.totals.revenueUsd)} tone="good" />
            <Stat label="Cost" value={fmtUsd(report.totals.costUsd)} tone="bad" />
            <Stat
              label="Net"
              value={fmtUsd(report.totals.netUsd)}
              tone={report.totals.netUsd >= 0 ? "good" : "bad"}
            />
            <Stat label="Units" value={fmtNumber(report.totals.units)} />
            <Stat label="Sales" value={fmtNumber(report.totals.orders)} />
          </div>

          {report.capped && (
            <p className="text-xs text-amber-600">
              The window contains more events than one scan covers — totals are a lower bound.
            </p>
          )}

          {products.length === 0 ? (
            <div className="rounded-2xl border border-ink-100 bg-white px-4 py-12 text-center text-sm text-ink-500">
              No product sales in this window yet. Revenue recorded before product tagging shipped
              has no product attached and won&apos;t appear here.
            </div>
          ) : (
            <>
              <RevenueByProductChart products={products.slice(0, 8)} />

              <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
                      <th className="px-4 py-2.5 font-medium">Product</th>
                      <th className="px-4 py-2.5 text-right font-medium">Units</th>
                      <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                      <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                      <th className="px-4 py-2.5 text-right font-medium">Net</th>
                      <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                      <th className="px-4 py-2.5 text-right font-medium">Net / unit</th>
                      <th className="px-4 py-2.5 text-right font-medium">Refunds</th>
                      <th className="px-4 py-2.5 text-right font-medium">Markets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <ProductRowView
                        key={p.productId}
                        product={p}
                        expanded={expanded === p.productId}
                        onToggle={() =>
                          setExpanded(expanded === p.productId ? null : p.productId)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ProductRowView({
  product: p,
  expanded,
  onToggle,
}: {
  product: ProductRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-ink-50 transition last:border-0 hover:bg-brand-50/40"
      >
        <td className="px-4 py-2.5">
          <span className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="size-3.5 text-ink-400" />
            ) : (
              <ChevronRight className="size-3.5 text-ink-400" />
            )}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                FAMILY_BADGE[p.family],
              )}
            >
              {FAMILY_LABEL[p.family]}
            </span>
            <span className="font-medium text-ink-800">{p.label}</span>
          </span>
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{fmtNumber(p.units)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{fmtUsd(p.revenueUsd)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-rose-600">
          {p.costUsd > 0 ? fmtUsd(p.costUsd) : "—"}
        </td>
        <td
          className={cn(
            "px-4 py-2.5 text-right font-semibold tabular-nums",
            p.netUsd >= 0 ? "text-emerald-700" : "text-rose-700",
          )}
        >
          {fmtUsd(p.netUsd)}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
          {p.marginPct === null ? "—" : `${p.marginPct}%`}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
          {p.netPerUnitUsd === null ? "—" : fmtUsd(p.netPerUnitUsd)}
        </td>
        <td
          className={cn(
            "px-4 py-2.5 text-right tabular-nums",
            (p.refundRatePct ?? 0) > 5 ? "font-semibold text-rose-600" : "text-ink-500",
          )}
        >
          {p.refundRatePct === null || p.refundRatePct === 0 ? "—" : `${p.refundRatePct}%`}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-ink-500">{p.countries || "—"}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-ink-50 bg-ink-50/40">
          <td colSpan={9} className="px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
                  Revenue &amp; units over time
                </p>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={p.series.map((s) => ({ ...s, label: fmtDayKey(s.day) }))}
                      margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id={`grad-${p.productId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v, name) =>
                          name === "Units" ? [fmtNumber(Number(v)), name] : [fmtUsd(Number(v)), name]
                        }
                      />
                      <Area type="monotone" dataKey="revenueUsd" name="Revenue" stroke="#10b981" strokeWidth={2} fill={`url(#grad-${p.productId})`} />
                      <Area type="monotone" dataKey="netUsd" name="Net" stroke="#6366f1" strokeWidth={2} fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
                  Top markets
                </p>
                {p.topCountries.length === 0 ? (
                  <p className="text-sm text-ink-400">No market attribution yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {p.topCountries.map((c) => (
                      <li key={c.country} className="flex items-center justify-between text-sm">
                        <span className="text-ink-600">
                          {countryFlag(c.country)} {countryLabel(c.country)}
                        </span>
                        <span className="tabular-nums text-ink-800">{fmtUsd(c.revenueUsd)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {p.sku && (
                  <p className="mt-3 text-[11px] text-ink-400">
                    Provider SKU <span className="font-mono">{p.sku}</span>
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Side-by-side revenue vs net for the leading products. */
function RevenueByProductChart({ products }: { products: ProductRow[] }) {
  const data = products.map((p) => ({
    name: p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label,
    Revenue: p.revenueUsd,
    Net: p.netUsd,
  }));
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 shadow-soft">
      <p className="mb-2 text-sm font-semibold text-ink-800">Revenue vs net by product</p>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9aa1ac" }} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={48} />
            <YAxis tick={{ fontSize: 11, fill: "#9aa1ac" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtUsd(Number(v))} />
            <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Net" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold",
          tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-ink-800",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function toCsvRow(p: ProductRow): Record<string, string | number | null> {
  return {
    product: p.label,
    productId: p.productId,
    family: p.family,
    sku: p.sku,
    units: p.units,
    sales: p.orders,
    revenueUsd: p.revenueUsd,
    costUsd: p.costUsd,
    netUsd: p.netUsd,
    marginPct: p.marginPct,
    netPerUnitUsd: p.netPerUnitUsd,
    refundUsd: p.refundUsd,
    refundRatePct: p.refundRatePct,
    markets: p.countries,
  };
}
