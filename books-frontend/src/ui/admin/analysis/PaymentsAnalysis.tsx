"use client";

import { useEffect } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useAdminPayments, type PaymentListItem } from "../../../state/adminPaymentsStore";
import { Button } from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import { fmtDateTime, fmtNumber, fmtRelative } from "./format";
import { StripeHealthCard } from "./StripeHealthCard";

const WINDOWS = [
  { id: "7", label: "Last 7d" },
  { id: "30", label: "Last 30d" },
  { id: "90", label: "Last 90d" },
  { id: "365", label: "Last 12mo" },
];

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function PaymentsAnalysis() {
  const days = useAdminPayments((s) => s.days);
  const setDays = useAdminPayments((s) => s.setDays);
  const analytics = useAdminPayments((s) => s.analytics);
  const payments = useAdminPayments((s) => s.payments);
  const loading = useAdminPayments((s) => s.loading);
  const error = useAdminPayments((s) => s.error);
  const lastUpdated = useAdminPayments((s) => s.lastUpdated);
  const refresh = useAdminPayments((s) => s.refresh);

  useEffect(() => {
    if (!analytics) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <StripeHealthCard />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={WINDOWS} value={String(days)} onChange={(id) => setDays(Number(id))} />
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-ink-400">Updated {fmtRelative(lastUpdated)}</span>}
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
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!analytics && loading && (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {analytics && (
        <>
          {analytics.byCurrency.length === 0 ? (
            <div className="rounded-xl border border-ink-100 bg-white px-4 py-10 text-center text-sm text-ink-500">
              No payments captured in this window yet.
            </div>
          ) : (
            <div className="space-y-4">
              {analytics.byCurrency.map((c) => (
                <div key={c.currency} className="rounded-2xl border border-ink-100 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink-800">{c.currency}</h3>
                    <span className="text-xs text-ink-400">
                      {fmtNumber(c.paidCount)} paid · {fmtNumber(c.refundCount)} refunded
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <Stat label="Gross volume" value={money(c.grossVolume, c.currency)} />
                    <Stat label="Net volume" value={money(c.netVolume, c.currency)} accent />
                    <Stat label="Fees" value={money(c.fees, c.currency)} />
                    <Stat label="Refunds" value={money(c.refunds, c.currency)} />
                    <Stat label="Avg order" value={money(c.averageOrderValue, c.currency)} />
                    <Stat label="Orders" value={fmtNumber(c.orderCount)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total payments" value={fmtNumber(analytics.totalPayments)} />
            <Stat label="Pending" value={fmtNumber(analytics.pendingCount)} />
            <Stat label="Failed" value={fmtNumber(analytics.failedCount)} />
          </div>

          <PaymentsTable payments={payments} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ? "text-emerald-600" : "text-ink-800"}`}>
        {value}
      </p>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  refunded: "bg-ink-100 text-ink-600",
  partially_refunded: "bg-sky-100 text-sky-700",
};

function PaymentsTable({ payments }: { payments: PaymentListItem[] }) {
  const refund = useAdminPayments((s) => s.refund);
  const refundingId = useAdminPayments((s) => s.refundingId);

  if (payments.length === 0) return null;

  function onRefund(p: PaymentListItem) {
    const max = p.amount - p.refundedAmount;
    const input = window.prompt(
      `Refund amount in ${p.currency} (blank = full ${max.toFixed(2)}). This cannot be undone.`,
      "",
    );
    if (input === null) return; // cancelled
    const amount = input.trim() === "" ? undefined : Number(input);
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      window.alert("Enter a valid amount.");
      return;
    }
    void refund(p.id, amount);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Description</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Amount</th>
            <th className="px-4 py-2.5 text-right font-medium">Fee</th>
            <th className="px-4 py-2.5 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const canRefund =
              (p.status === "paid" || p.status === "partially_refunded") &&
              p.amount - p.refundedAmount > 0 &&
              Boolean(p.stripePaymentIntentId);
            return (
              <tr key={p.id} className="border-b border-ink-50 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-500">{fmtDateTime(p.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <span className="text-ink-800">{p.description || p.kind}</span>
                  {p.receiptUrl && (
                    <a
                      href={p.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-xs text-brand-600 hover:underline"
                    >
                      receipt
                    </a>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[p.status] ?? "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {p.status.replace("_", " ")}
                  </span>
                  {p.refundedAmount > 0 && (
                    <span className="ml-2 text-xs text-ink-400">
                      −{money(p.refundedAmount, p.currency)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-ink-900">
                  {money(p.amount, p.currency)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-ink-500">
                  {p.feeAmount != null ? money(p.feeAmount, p.currency) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {canRefund && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRefund(p)}
                      loading={refundingId === p.id}
                    >
                      Refund
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
