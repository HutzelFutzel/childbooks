"use client";

/**
 * Tracked QR performance: anonymous scan traffic through to identified accounts
 * and coupon revenue events.
 *
 * The labels intentionally preserve the denominator:
 *   - scans are events (one phone may scan twice),
 *   - identified arrivals are unique accounts, lifetime,
 *   - first-touch accounts are immutable acquisition attribution,
 *   - grants/redemptions belong to coupons whose grant source was this QR.
 *
 * Calling all four "conversions" would make a clean-looking but false funnel.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  QrAnalysisCode,
  QrAnalysisReport,
  QrAnalysisWindowTotals,
} from "../../../core/config/qrCodes";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import { downloadCsv } from "./csv";
import { fmtDayKey, fmtMoney, fmtNumber, fmtRelative } from "./format";

const DAY_MS = 86_400_000;
const WINDOWS = [
  { id: "7", label: "Last 7d" },
  { id: "30", label: "Last 30d" },
  { id: "90", label: "Last 90d" },
];

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #eef0f3",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  fontSize: 12,
};

function pct(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";
}

function change(current: number, previous: number): string | null {
  if (previous <= 0) return current > 0 ? "new in this window" : null;
  const delta = ((current - previous) / previous) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% vs prior window`;
}

function destinationLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function moneyList(values: Record<string, number>): string {
  const entries = Object.entries(values).filter(([, amount]) => amount !== 0);
  if (entries.length === 0) return "—";
  return entries.map(([currency, amount]) => fmtMoney(amount, currency)).join(" · ");
}

function StatCard({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string | null;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-3.5 py-3 ring-1 ring-inset",
        tone === "good"
          ? "bg-emerald-50 ring-emerald-100"
          : tone === "warn"
            ? "bg-amber-50 ring-amber-100"
            : "bg-white ring-ink-100",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "good" ? "text-emerald-800" : tone === "warn" ? "text-amber-800" : "text-ink-800",
        )}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{note}</p>}
    </div>
  );
}

export function QrCodesAnalysis() {
  const load = useAppConfigStore((s) => s.loadQrAnalysis);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);
  const [days, setDays] = useState(30);
  const [nonce, setNonce] = useState(0);
  const [report, setReport] = useState<QrAnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const to = Date.now();
    const from = to - days * DAY_MS;
    setLoading(true);
    setError(null);
    void load(from, to)
      .then((next) => {
        if (live) setReport(next);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load QR analysis.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [days, nonce, load]);

  const chart = useMemo(
    () =>
      (report?.series ?? []).map((row) => ({
        ...row,
        label: fmtDayKey(row.day),
      })),
    [report],
  );

  const risks = useMemo(() => {
    if (!report) return { noCoupon: 0, dark: 0 };
    return {
      noCoupon: report.codes.filter((code) => code.linkedCoupons.length === 0).length,
      dark: report.codes.filter(
        (code) => code.totals.scans > 0 && code.lifetime.identifiedAccounts === 0,
      ).length,
    };
  }, [report]);

  const exportRows = () => {
    if (!report) return;
    downloadCsv(
      "tracked-qr-performance",
      report.codes.map((code) => ({
        qrId: code.qrId,
        name: code.name,
        destination: code.destination,
        scans: code.totals.scans,
        lifetimeScans: code.lifetime.scans,
        identifiedAccountsLifetime: code.lifetime.identifiedAccounts,
        firstTouchAccounts: code.totals.firstTouchAccounts,
        couponGrants: code.totals.couponGrants,
        couponRedemptions: code.totals.couponRedemptions,
        scanToGrantPct: code.rates.scanToGrantPct,
        grantToRedemptionPct: code.rates.grantToRedemptionPct,
        orderValueByCurrency: JSON.stringify(code.totals.orderValueByCurrency),
        discountByCurrency: JSON.stringify(code.totals.discountByCurrency),
        linkedCoupons: code.linkedCoupons.map((coupon) => coupon.name).join(" | "),
        lastScanAt: code.lastScanAt ? new Date(code.lastScanAt).toISOString() : "",
      })),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={WINDOWS} value={String(days)} onChange={(id) => setDays(Number(id))} />
        <div className="flex items-center gap-2">
          {report && (
            <span className="hidden text-xs text-ink-400 sm:inline">
              Updated {fmtRelative(report.generatedAt)}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="size-3.5" />}
            onClick={exportRows}
            disabled={!report || report.codes.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />}
            onClick={() => setNonce((value) => value + 1)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {report && Object.values(report.capped).some(Boolean) && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          One or more attribution collections reached the defensive read cap. Scan totals remain exact; identified
          accounts, grants, or redemptions are lower bounds. Narrowing the date window only reduces the redemption
          scan—account and grant totals are lifetime joins.
        </div>
      )}

      {!report && loading && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {report && report.trackedCodes === 0 && (
        <div className="rounded-2xl bg-white px-5 py-6 ring-1 ring-ink-100 shadow-soft">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <QrCode className="size-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink-800">No tracked QR codes yet</p>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
            An untracked image points straight at its destination, so no server ever sees the scan. Turn tracking on
            before downloading the version you print.
          </p>
          <button
            type="button"
            onClick={() => openMarketingTab("qrCodes")}
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            Configure QR codes <ArrowRight className="size-3.5" />
          </button>
        </div>
      )}

      {report && report.trackedCodes > 0 && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Scan events"
              value={fmtNumber(report.totals.scans)}
              note={change(report.totals.scans, report.previousTotals.scans)}
            />
            <StatCard
              label="First-touch accounts"
              value={fmtNumber(report.totals.firstTouchAccounts)}
              note={`${pct(report.totals.firstTouchAccounts, report.totals.scans)} of scan events became a first recorded arrival`}
            />
            <StatCard
              label="Coupon grants"
              value={fmtNumber(report.totals.couponGrants)}
              note={`${pct(report.totals.couponGrants, report.totals.scans)} of scan events`}
              tone={report.totals.couponGrants > 0 ? "good" : "plain"}
            />
            <StatCard
              label="Paid coupon uses"
              value={fmtNumber(report.totals.couponRedemptions)}
              note={`${pct(report.totals.couponRedemptions, report.totals.couponGrants)} of grants`}
              tone={report.totals.couponRedemptions > 0 ? "good" : "plain"}
            />
            <StatCard
              label="Identified lifetime"
              value={fmtNumber(report.lifetime.identifiedAccounts)}
              note={`${report.rates.scanToIdentifiedPct ?? 0}% of ${fmtNumber(report.lifetime.scans)} lifetime scan events`}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <StatCard
              label="QR-attributed order value"
              value={moneyList(report.totals.orderValueByCurrency)}
              note="eligible subtotal on orders using a QR-granted coupon; currencies stay separate"
            />
            <StatCard
              label="Discount given"
              value={moneyList(report.totals.discountByCurrency)}
              note="actual coupon discount on those paid uses, excluding restored or voided redemptions"
            />
          </div>

          <FunnelCard totals={report.totals} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
              <CardHeader className="py-3.5">
                <CardTitle className="text-sm">Daily acquisition funnel</CardTitle>
                <p className="mt-0.5 text-xs text-ink-400">
                  Scans use the left axis; account and coupon outcomes use the right.
                </p>
              </CardHeader>
              <CardBody className="pt-2">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="qrScanFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "#9aa1ac" }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={20}
                      />
                      <YAxis
                        yAxisId="scans"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#9aa1ac" }}
                        tickLine={false}
                        axisLine={false}
                        width={36}
                      />
                      <YAxis
                        yAxisId="outcomes"
                        orientation="right"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#9aa1ac" }}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        yAxisId="scans"
                        type="monotone"
                        dataKey="scans"
                        name="Scans"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#qrScanFill)"
                      />
                      <Line
                        yAxisId="outcomes"
                        type="monotone"
                        dataKey="firstTouchAccounts"
                        name="First touch"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        yAxisId="outcomes"
                        type="monotone"
                        dataKey="couponGrants"
                        name="Grants"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        yAxisId="outcomes"
                        type="monotone"
                        dataKey="couponRedemptions"
                        name="Paid uses"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </div>

            <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
              <CardHeader className="py-3.5">
                <CardTitle className="text-sm">Attribution health</CardTitle>
                <p className="mt-0.5 text-xs text-ink-400">Configuration gaps that make scan traffic go dark.</p>
              </CardHeader>
              <CardBody className="space-y-3 pt-3">
                <HealthRow
                  label="Tracked codes"
                  value={report.trackedCodes}
                  note={`${report.untrackedCodes} untracked`}
                  ok={report.trackedCodes > 0}
                />
                <HealthRow
                  label="Without a linked coupon"
                  value={risks.noCoupon}
                  note="still tracked, but cannot auto-grant"
                  ok={risks.noCoupon === 0}
                />
                <HealthRow
                  label="Scanned but never identified"
                  value={risks.dark}
                  note="check destination and arrival capture"
                  ok={risks.dark === 0}
                />
                <button
                  type="button"
                  onClick={() => openMarketingTab("qrCodes")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  Open QR configuration <ArrowRight className="size-3.5" />
                </button>
              </CardBody>
            </div>
          </div>

          <CodeTable codes={report.codes} onConfigure={() => openMarketingTab("qrCodes")} />

          <div className="rounded-xl bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500 ring-1 ring-ink-100">
            <span className="font-semibold text-ink-700">How to read this:</span> scans are redirect events, not unique
            people. “Identified” means an account eventually returned the QR token; “first touch” means this QR was
            that account’s first recorded arrival. Coupon outcomes are attributed only when the grant itself records
            this QR as its source. This is directional attribution, not proof that the QR caused the purchase.
          </div>
        </>
      )}
    </div>
  );
}

function FunnelCard({ totals }: { totals: QrAnalysisWindowTotals }) {
  const stages = [
    { label: "Scan events", value: totals.scans, rate: null },
    {
      label: "First-touch accounts",
      value: totals.firstTouchAccounts,
      rate: pct(totals.firstTouchAccounts, totals.scans),
    },
    {
      label: "Coupon grants",
      value: totals.couponGrants,
      rate: pct(totals.couponGrants, totals.scans),
    },
    {
      label: "Paid coupon uses",
      value: totals.couponRedemptions,
      rate: pct(totals.couponRedemptions, totals.couponGrants),
    },
  ];
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Scan-to-purchase funnel</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          The grant rate uses scans; paid-use rate uses grants. Labels retain those different denominators.
        </p>
      </CardHeader>
      <CardBody className="grid gap-2 pt-3 sm:grid-cols-4">
        {stages.map((stage, index) => (
          <div key={stage.label} className="relative rounded-xl bg-ink-50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              {index + 1}. {stage.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-800">{fmtNumber(stage.value)}</p>
            {stage.rate && <p className="text-[11px] text-ink-400">{stage.rate}</p>}
            {index < stages.length - 1 && (
              <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-ink-300 sm:block" />
            )}
          </div>
        ))}
      </CardBody>
    </div>
  );
}

function HealthRow({
  label,
  value,
  note,
  ok,
}: {
  label: string;
  value: number;
  note: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-ink-700">{label}</p>
        <p className="text-[11px] text-ink-400">{note}</p>
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
          ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
        )}
      >
        {fmtNumber(value)}
      </span>
    </div>
  );
}

function CodeTable({
  codes,
  onConfigure,
}: {
  codes: QrAnalysisCode[];
  onConfigure: () => void;
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Performance by code</CardTitle>
            <p className="mt-0.5 text-xs text-ink-400">Ranked by scans in the selected window.</p>
          </div>
          <button
            type="button"
            onClick={onConfigure}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            Configure
          </button>
        </div>
      </CardHeader>
      <CardBody className="pt-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-245 text-xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-2 pr-4 font-medium">QR code</th>
                <th className="py-2 pr-4 text-right font-medium">Scans</th>
                <th className="py-2 pr-4 text-right font-medium">Identified</th>
                <th className="py-2 pr-4 text-right font-medium">First touch</th>
                <th className="py-2 pr-4 text-right font-medium">Grants</th>
                <th className="py-2 pr-4 text-right font-medium">Paid uses</th>
                <th className="py-2 pr-4 font-medium">Order value / discount</th>
                <th className="py-2 font-medium">Linked coupons</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.qrId} className="border-t border-ink-100 align-top">
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-ink-800">{code.name || code.qrId}</p>
                    <p className="max-w-60 truncate font-mono text-[10px] text-ink-400">{code.qrId}</p>
                    <a
                      href={code.destination}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 flex max-w-60 items-center gap-1 truncate text-[10px] text-brand-600 hover:underline"
                    >
                      <span className="truncate">{destinationLabel(code.destination)}</span>
                      <ExternalLink className="size-2.5 shrink-0" />
                    </a>
                    <p className="mt-0.5 text-[10px] text-ink-400">
                      Last scan {code.lastScanAt ? fmtRelative(code.lastScanAt) : "never"}
                    </p>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-700">
                    <p className="font-semibold">{fmtNumber(code.totals.scans)}</p>
                    <p className="text-[10px] text-ink-400">{fmtNumber(code.lifetime.scans)} lifetime</p>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-700">
                    <p>{fmtNumber(code.lifetime.identifiedAccounts)}</p>
                    <p className="text-[10px] text-ink-400">{code.rates.scanToIdentifiedPct ?? 0}% lifetime</p>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-700">
                    {fmtNumber(code.totals.firstTouchAccounts)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-700">
                    <p>{fmtNumber(code.totals.couponGrants)}</p>
                    <p className="text-[10px] text-ink-400">{code.rates.scanToGrantPct ?? 0}% of scans</p>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-700">
                    <p className="font-semibold">{fmtNumber(code.totals.couponRedemptions)}</p>
                    <p className="text-[10px] text-ink-400">{code.rates.grantToRedemptionPct ?? 0}% of grants</p>
                  </td>
                  <td className="py-3 pr-4 text-ink-600">
                    <p>{moneyList(code.totals.orderValueByCurrency)}</p>
                    <p className="text-[10px] text-ink-400">
                      {moneyList(code.totals.discountByCurrency)} discount
                    </p>
                  </td>
                  <td className="py-3">
                    {code.linkedCoupons.length > 0 ? (
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {code.linkedCoupons.map((coupon) => (
                          <span
                            key={coupon.id}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              coupon.status === "active"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-ink-100 text-ink-500",
                            )}
                          >
                            {coupon.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        None
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </div>
  );
}
