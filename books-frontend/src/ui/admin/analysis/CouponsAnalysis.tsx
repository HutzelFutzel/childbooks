"use client";

/**
 * Coupon results: what each coupon gave away, what came back, and — the question
 * a coupon report usually dodges — **why codes are being refused**.
 *
 * Three things are deliberately on this page:
 *
 *   1. **Rejections are a first-class panel, not a footnote.** A coupon that
 *      looks quiet is either unused or broken, and those are indistinguishable
 *      from redemption counts alone. A printed poster whose codes all bounce on
 *      "needs a confirmed email" is a support fire that shows up here as a
 *      rejection pile and nowhere else.
 *   2. **Return on discount is shown with its denominator.** Revenue per unit
 *      given away is only meaningful next to the discount total, so both are on
 *      screen; a 12× return on €4 of discount is noise, not a result.
 *   3. **New-customer share is called out.** A discount redeemed entirely by
 *      people who already buy is a price cut, whatever it was meant to be. This
 *      report can't prove causation — coupons have no holdout, unlike campaigns
 *      — so it says so rather than implying it.
 *
 * Configuration (mechanics, caps, codes) lives in Marketing → Coupons.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminAccess } from "../../../state/adminAccessStore";
import { useAdminTab } from "../adminTabStore";
import {
  COUPON_ISSUANCE_LABELS,
  COUPON_STATUS_LABELS,
  couponSummary,
  formatCouponCode,
  type CouponRedemptionRow,
  type CouponReport,
  type CouponRow,
} from "../../../core/config/coupons";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import { fmtDateTime, fmtMoney, fmtNumber, fmtRelative } from "./format";

const WINDOWS = [
  { id: "7", label: "Last 7d" },
  { id: "30", label: "Last 30d" },
  { id: "90", label: "Last 90d" },
];

function StatCard({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "good" | "bad" | "unknown";
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 ring-1 ring-inset",
        tone === "good"
          ? "bg-emerald-50 ring-emerald-100"
          : tone === "bad"
            ? "bg-rose-50 ring-rose-100"
            : tone === "unknown"
              ? "bg-amber-50 ring-amber-100"
              : "bg-white ring-ink-100",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={cn(
          "text-base font-semibold",
          tone === "good"
            ? "text-emerald-800"
            : tone === "bad"
              ? "text-rose-800"
              : tone === "unknown"
                ? "text-amber-800"
                : "text-ink-800",
        )}
      >
        {value}
      </div>
      {note && <div className="text-[11px] leading-relaxed text-ink-400">{note}</div>}
    </div>
  );
}

export function CouponsAnalysis() {
  const loadRows = useAppConfigStore((s) => s.loadCouponRows);
  const loadReport = useAppConfigStore((s) => s.loadCouponReport);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);

  const [days, setDays] = useState(30);
  const [nonce, setNonce] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState<CouponRow[]>([]);
  const [reports, setReports] = useState<Record<string, CouponReport>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const to = Date.now();
    const from = to - days * 86_400_000;
    void loadRows()
      .then(async (result) => {
        if (!live) return;
        setEnabled(result.enabled);
        setRows(result.coupons);
        // Drafts have no history worth fetching; everything else does, including
        // ended coupons — their numbers are the whole point of running one.
        const worth = result.coupons.filter((r) => r.coupon.status !== "draft");
        const entries = await Promise.all(
          worth.map(async (r) => [r.coupon.id, await loadReport(r.coupon.id, from, to)] as const),
        );
        if (!live) return;
        setReports(Object.fromEntries(entries));
        setLastUpdated(Date.now());
      })
      .catch(
        (err) => live && setError(err instanceof Error ? err.message : "Could not load coupon results."),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [days, nonce, loadRows, loadReport]);

  const reported = useMemo(() => rows.filter((r) => reports[r.coupon.id]), [rows, reports]);

  const overall = useMemo(() => {
    let discount = 0;
    let revenue = 0;
    let redemptions = 0;
    let rejected = 0;
    for (const row of reported) {
      const t = reports[row.coupon.id]!.totals;
      discount += t.discount;
      revenue += t.revenue;
      redemptions += t.redemptions;
      rejected += t.rejected;
    }
    return { discount, revenue, redemptions, rejected };
  }, [reported, reports]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={WINDOWS} value={String(days)} onChange={(id) => setDays(Number(id))} />
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-ink-400">Updated {fmtRelative(lastUpdated)}</span>}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={() => setNonce((n) => n + 1)}
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

      {!enabled && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100">
          The coupon engine is switched off, so nothing below is running. Numbers are history.
        </div>
      )}

      {reported.length > 1 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Redemptions" value={fmtNumber(overall.redemptions)} note="across every coupon" />
          <StatCard
            label="Discount given"
            value={fmtMoney(overall.discount, baseCurrency)}
            note={`against ${fmtMoney(overall.revenue, baseCurrency)} of revenue`}
          />
          <StatCard
            label="Return on discount"
            tone={overall.discount === 0 ? "plain" : overall.revenue / overall.discount >= 5 ? "good" : "plain"}
            value={overall.discount > 0 ? `${(overall.revenue / overall.discount).toFixed(1)}×` : "—"}
            note="revenue per unit given away, not proof it caused anything"
          />
          <StatCard
            label="Refused attempts"
            tone={overall.rejected > overall.redemptions ? "unknown" : "plain"}
            value={fmtNumber(overall.rejected)}
            note={
              overall.rejected > overall.redemptions
                ? "more codes bounce than land — see the reasons below"
                : "codes entered that didn't apply"
            }
          />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl bg-white px-4 py-5 ring-1 ring-ink-100 shadow-soft">
          <p className="text-sm text-ink-500">No coupons configured.</p>
          <button
            type="button"
            onClick={() => openMarketingTab("coupons")}
            className="mt-1 flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            Set one up in Marketing → Coupons <ArrowRight className="size-3.5" />
          </button>
        </div>
      )}

      {loading && reported.length === 0 && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {reported.map((row) => (
        <CouponCard
          key={row.coupon.id}
          row={row}
          report={reports[row.coupon.id]!}
          currency={baseCurrency}
          onOpenConfig={() => openMarketingTab("coupons")}
        />
      ))}

      {rows.some((r) => r.coupon.status === "draft") && (
        <p className="text-xs text-ink-400">
          {rows.filter((r) => r.coupon.status === "draft").length} draft coupon
          {rows.filter((r) => r.coupon.status === "draft").length === 1 ? "" : "s"} not shown — a draft never
          validates, so it has no results.
        </p>
      )}

      <RedemptionsPanel currency={baseCurrency} nonce={nonce} />
    </div>
  );
}

function CouponCard({
  row,
  report,
  currency,
  onOpenConfig,
}: {
  row: CouponRow;
  report: CouponReport;
  currency: string;
  onOpenConfig: () => void;
}) {
  const { coupon } = row;
  const { totals, rates, rejections } = report;
  const attempts = totals.accepted + totals.rejected;
  const worstRejection = rejections[0];

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">{coupon.name}</CardTitle>
          <div className="flex items-center gap-1.5">
            {row.sharedCode && (
              <span className="rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-ink-600">
                {formatCouponCode(row.sharedCode)}
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                coupon.status === "active"
                  ? "bg-emerald-100 text-emerald-800"
                  : coupon.status === "paused"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-ink-100 text-ink-600",
              )}
            >
              {COUPON_STATUS_LABELS[coupon.status]}
            </span>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-ink-400">
          {couponSummary(coupon)} · {COUPON_ISSUANCE_LABELS[coupon.issuance]}
        </p>
      </CardHeader>
      <CardBody className="space-y-3 pt-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Redeemed"
            value={fmtNumber(totals.redemptions)}
            note={
              totals.released > 0
                ? `${fmtNumber(totals.released)} abandoned (${rates.abandonRatePct}%)`
                : undefined
            }
          />
          <StatCard
            label="Discount given"
            value={fmtMoney(totals.discount, currency)}
            note={
              totals.redemptions > 0
                ? `${fmtMoney(rates.discountPerRedemption, currency)} per redemption`
                : undefined
            }
          />
          <StatCard
            label="Return on discount"
            tone={rates.returnOnDiscount === null ? "plain" : rates.returnOnDiscount >= 5 ? "good" : "plain"}
            value={rates.returnOnDiscount === null ? "—" : `${rates.returnOnDiscount}×`}
            note={
              rates.returnOnDiscount === null
                ? "nothing given away yet"
                : `${fmtMoney(totals.revenue, currency)} revenue on these orders`
            }
          />
          <StatCard
            label="New customers"
            tone={totals.orders > 0 && rates.newCustomerPct < 20 ? "unknown" : "plain"}
            value={totals.orders > 0 ? `${rates.newCustomerPct}%` : "—"}
            note={
              totals.orders > 0
                ? `${fmtNumber(totals.newCustomers)} of ${fmtNumber(totals.orders)} orders were someone's first`
                : undefined
            }
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Codes entered"
            value={fmtNumber(attempts)}
            note={attempts > 0 ? `${rates.acceptRatePct}% accepted` : "nobody has tried it"}
          />
          <StatCard
            label="Average order"
            value={totals.orders > 0 ? fmtMoney(rates.averageOrderValue, currency) : "—"}
          />
          <StatCard
            label="Uses left"
            tone={
              report.remainingRedemptions !== null && report.remainingRedemptions <= 0 ? "bad" : "plain"
            }
            value={report.remainingRedemptions === null ? "Uncapped" : fmtNumber(report.remainingRedemptions)}
            note={
              report.remainingRedemptions !== null && report.remainingRedemptions <= 0
                ? "exhausted — every further attempt is refused"
                : undefined
            }
          />
          <StatCard
            label="Budget left"
            tone={report.remainingBudget !== null && report.remainingBudget <= 0 ? "bad" : "plain"}
            value={report.remainingBudget === null ? "Uncapped" : fmtMoney(report.remainingBudget, currency)}
            note={
              report.remainingBudget !== null && report.remainingBudget <= 0
                ? "spent out — the coupon has stopped applying"
                : undefined
            }
          />
        </div>

        {totals.restored > 0 && (
          <p className="text-[11px] text-ink-400">
            {fmtNumber(totals.restored)} use{totals.restored === 1 ? "" : "s"} handed back after a refund.
          </p>
        )}

        {rejections.length > 0 && (
          <div className="space-y-1.5 rounded-lg bg-ink-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Why codes were refused
            </div>
            <div className="space-y-1">
              {rejections.slice(0, 6).map((r) => (
                <div key={r.reason} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-ink-600">{r.label}</span>
                  <span className="font-mono text-ink-500">{fmtNumber(r.count)}</span>
                </div>
              ))}
            </div>
            {worstRejection && totals.rejected > totals.accepted && (
              <p className="text-[11px] leading-relaxed text-amber-800">
                Most attempts are failing, and mostly on one thing: {worstRejection.label.toLowerCase()}. If this code
                is printed somewhere, that&apos;s a support queue rather than a metric —{" "}
                <button type="button" onClick={onOpenConfig} className="font-semibold underline">
                  check the restrictions
                </button>
                .
              </p>
            )}
          </div>
        )}

        {row.codeCount > 0 && (
          <p className="text-[11px] text-ink-400">
            {fmtNumber(row.liveCodeCount)} of {fmtNumber(row.codeCount)} codes still live.
          </p>
        )}
      </CardBody>
    </div>
  );
}

/**
 * Recent redemptions across every coupon.
 *
 * This is the support view: "a customer says their code did nothing" is
 * answered here, and nowhere else. Voiding is offered only to someone who can
 * also write coupons — a read-only analyst has no business handing a use back —
 * and the server enforces the same rule regardless of what this renders.
 */
function RedemptionsPanel({ currency, nonce }: { currency: string; nonce: number }) {
  const load = useAppConfigStore((s) => s.loadCouponRedemptions);
  const voidOne = useAppConfigStore((s) => s.voidCouponRedemption);
  const canWrite = useAdminAccess((s) => s.canWrite);
  const mayVoid = canWrite("marketing.coupons");

  const [rows, setRows] = useState<CouponRedemptionRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void load()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [load, nonce]);

  if (!rows || rows.length === 0) return null;

  const onVoid = async (row: CouponRedemptionRow) => {
    if (
      !window.confirm(
        `Void this redemption? ${row.uid} gets the use back and the ${fmtMoney(
          row.discountAmount,
          row.currency,
        )} already taken off their order is NOT recovered — this only affects the coupon's counters.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await voidOne(row.id);
      setRows(await load());
      toast.success("Redemption voided.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not void it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Recent redemptions</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          The support view. Reserved rows are checkouts in flight — they settle or release themselves.
        </p>
      </CardHeader>
      <CardBody className="pt-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Coupon</th>
                <th className="py-1 pr-3 font-medium">Code</th>
                <th className="py-1 pr-3 font-medium">Account</th>
                <th className="py-1 pr-3 font-medium">Off</th>
                <th className="py-1 pr-3 font-medium">Order</th>
                <th className="py-1 pr-3 font-medium">State</th>
                {mayVoid && <th className="py-1 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-ink-100">
                  <td className="whitespace-nowrap py-1 pr-3 text-ink-500">{fmtDateTime(row.createdAt)}</td>
                  <td className="py-1 pr-3 text-ink-700">{row.couponName}</td>
                  <td className="py-1 pr-3 font-mono text-ink-500">{row.code ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono text-[10px] text-ink-400">{row.uid.slice(0, 10)}…</td>
                  <td className="py-1 pr-3 text-ink-700">
                    {fmtMoney(row.discountAmount, row.currency)}
                    <span className="text-ink-400"> ({row.percentOff}%)</span>
                  </td>
                  <td className="py-1 pr-3 text-ink-500">{fmtMoney(row.originalSubtotal, row.currency)}</td>
                  <td className="py-1 pr-3">
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        row.status === "redeemed"
                          ? "bg-emerald-100 text-emerald-800"
                          : row.status === "reserved"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-ink-100 text-ink-600",
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  {mayVoid && (
                    <td className="py-1 text-right">
                      {row.status === "redeemed" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void onVoid(row)}
                        >
                          <Undo2 className="size-3.5" /> Void
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
          Voiding hands the use back to the account and corrects the counters. It does not move money — a discount
          already applied to a paid order is refunded through the payment, not here. Currency shown is what the
          customer was charged; totals above are converted to {currency}.
        </p>
      </CardBody>
    </div>
  );
}
