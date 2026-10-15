"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, XCircle } from "lucide-react";
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import type { OrderAnalytics, TimingBucket } from "../../../core/orders/analytics";
import {
  ATTENTION_REASON_ACTION,
  ATTENTION_REASON_LABEL,
  PRINT_ORDER_STATES,
  PRINT_ORDER_STATE_LABEL,
  providerJobIsLive,
  type PrintOrderRecord,
  type PrintOrderState,
} from "../../../core/orders/lifecycle";
import { useAdminMarket } from "../../../state/adminMarketStore";
import {
  useAdminOrders,
  type OrderAction,
  type OrderDetail,
  type PrinterConnection,
} from "../../../state/adminOrdersStore";
import { Button } from "../../components/Button";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Drawer } from "../../components/Drawer";
import { Tabs } from "../../components/Tabs";
import { fmtDateTime, fmtDuration, fmtMoney, fmtNumber, fmtPct, fmtRelative, fmtUsd } from "./format";

const WINDOWS = [
  { id: "7", label: "Last 7d" },
  { id: "30", label: "Last 30d" },
  { id: "90", label: "Last 90d" },
  { id: "365", label: "Last 12mo" },
];

const STATE_TONE: Record<PrintOrderState, string> = {
  paid: "bg-amber-100 text-amber-700",
  placing: "bg-amber-100 text-amber-700",
  retrying: "bg-amber-100 text-amber-700",
  placed: "bg-sky-100 text-sky-700",
  in_production: "bg-sky-100 text-sky-700",
  on_hold: "bg-orange-100 text-orange-700",
  shipped: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-ink-100 text-ink-600",
  refunded: "bg-ink-100 text-ink-600",
};

function StateBadge({ state }: { state: PrintOrderState }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[state]}`}>
      {PRINT_ORDER_STATE_LABEL[state]}
    </span>
  );
}

/** Orders in the live environment only; a rehearsal order is labelled so it is never mistaken for one. */
function SandboxTag({ env }: { env: string | null }) {
  if (env !== "sandbox") return null;
  return <span className="ml-1.5 rounded bg-ink-100 px-1 text-[10px] font-medium uppercase text-ink-500">test</span>;
}

export function OrdersAnalysis() {
  const days = useAdminOrders((s) => s.days);
  const setDays = useAdminOrders((s) => s.setDays);
  const analytics = useAdminOrders((s) => s.analytics);
  const loading = useAdminOrders((s) => s.loading);
  const error = useAdminOrders((s) => s.error);
  const lastUpdated = useAdminOrders((s) => s.lastUpdated);
  const refresh = useAdminOrders((s) => s.refresh);
  const open = useAdminOrders((s) => s.open);
  const country = useAdminMarket((s) => s.country);

  // Re-fetch when the market filter changes (the Analysis shell only handles the
  // sections it knows about).
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  // Deep link from an alert: ?order=<key>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = new URLSearchParams(window.location.search).get("order");
    if (key) void open(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <NeedsAttention analytics={analytics} />
          <ConnectionCard />
          <Pipeline analytics={analytics} />
          <Throughput analytics={analytics} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Reliability analytics={analytics} />
            <Emails analytics={analytics} />
          </div>
          <Timing analytics={analytics} />
          <Money analytics={analytics} />
          <OrdersList />
        </>
      )}

      <OrderDrawer />
    </div>
  );
}

// ---- Needs attention -------------------------------------------------------------

function NeedsAttention({ analytics }: { analytics: OrderAnalytics }) {
  const orders = useAdminOrders((s) => s.orders);
  const open = useAdminOrders((s) => s.open);
  const { count, byReason, oldestMs } = analytics.attention;
  const queue = useMemo(
    () =>
      // The analytics counts everything in scope; the list below is the same
      // scope, so the queue is simply its flagged rows.
      orders.filter((o) => o.needsAttention).slice(0, 12),
    [orders],
  );

  if (count === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
        <div>
          <p className="text-sm font-semibold text-emerald-800">Nothing needs you.</p>
          <p className="text-xs text-emerald-700">
            Every open order is moving. {fmtNumber(analytics.open)} open right now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-rose-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rose-100 bg-rose-50 px-4 py-3">
        <AlertTriangle className="size-5 shrink-0 text-rose-600" />
        <p className="text-sm font-semibold text-rose-800">
          {count} {count === 1 ? "order needs" : "orders need"} you
        </p>
        <p className="text-xs text-rose-700">
          {byReason.map((r) => `${r.count} × ${r.label.toLowerCase()}`).join(" · ")}
          {oldestMs ? ` · oldest ${fmtDuration(oldestMs)}` : ""}
        </p>
      </div>
      <ul className="divide-y divide-ink-100">
        {queue.map((o) => (
          <li key={o.key}>
            <button
              type="button"
              onClick={() => void open(o.key)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-ink-50"
            >
              <span className="w-24 shrink-0 text-xs font-medium text-rose-600">
                {o.attention ? fmtDuration(Date.now() - o.attention.since) : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-800">
                  {o.attention ? ATTENTION_REASON_LABEL[o.attention.reason] : ""}
                  <SandboxTag env={o.env} />
                </span>
                <span className="block truncate text-xs text-ink-500">
                  {o.recipientEmail ?? o.uid ?? o.key}
                  {o.destinationCountry ? ` · ${countryFlag(o.destinationCountry)} ${countryLabel(o.destinationCountry)}` : ""}
                  {o.amountPaid != null ? ` · ${fmtMoney(o.amountPaid, o.currency)}` : ""}
                </span>
              </span>
              <span className="text-xs font-medium text-brand-600">Open →</span>
            </button>
          </li>
        ))}
      </ul>
      {count > queue.length && (
        <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">
          …and {count - queue.length} more — filter the list below to “Needs attention”.
        </p>
      )}
    </div>
  );
}

// ---- Printer link --------------------------------------------------------------------

function ConnectionCard() {
  const connection = useAdminOrders((s) => s.connection);
  const busy = useAdminOrders((s) => s.busyAction === "connection");
  const check = useAdminOrders((s) => s.checkConnection);
  const actionError = useAdminOrders((s) => s.actionError);
  if (!connection) return null;
  const rows = connectionRows(connection);
  const bad = rows.some((r) => r.tone === "bad");
  const warn = rows.some((r) => r.tone === "warn");

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-800">
            Printer connection{" "}
            <span className="text-xs font-normal text-ink-400">({connection.env})</span>
          </h3>
          <p className={`text-xs ${bad ? "text-rose-600" : warn ? "text-amber-600" : "text-emerald-600"}`}>
            {bad ? "Something is broken — orders may not be moving." : warn ? "Needs a look." : "Healthy."}
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void check()}>
          Check now
        </Button>
      </div>
      {actionError && <p className="mb-2 text-xs text-rose-600">{actionError}</p>}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-2">
            {r.tone === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : r.tone === "warn" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
            )}
            <div className="min-w-0">
              <dt className="text-xs font-medium text-ink-500">{r.label}</dt>
              <dd className="truncate text-sm text-ink-800" title={r.detail}>
                {r.detail}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

function connectionRows(c: PrinterConnection): { label: string; detail: string; tone: "ok" | "warn" | "bad" }[] {
  const h = c.health;
  const rows: { label: string; detail: string; tone: "ok" | "warn" | "bad" }[] = [];
  rows.push(
    !c.credentialsPresent
      ? { label: "Credentials", detail: "Not configured", tone: "bad" }
      : h.authFailures >= 3
        ? { label: "Credentials", detail: `Failing (${h.authFailures}×): ${h.lastAuthError ?? "unknown"}`, tone: "bad" }
        : h.lastAuthOkAt
          ? { label: "Credentials", detail: `OK · checked ${fmtRelative(h.lastAuthOkAt)}`, tone: h.authFailures > 0 ? "warn" : "ok" }
          : { label: "Credentials", detail: "Not checked yet", tone: "warn" },
  );
  rows.push(
    h.webhookStatus === "active"
      ? { label: "Status webhook", detail: "Active", tone: "ok" }
      : h.webhookStatus
        ? { label: "Status webhook", detail: `${h.webhookStatus[0].toUpperCase()}${h.webhookStatus.slice(1)}`, tone: "bad" }
        : { label: "Status webhook", detail: "Not checked yet", tone: "warn" },
  );
  rows.push({
    label: "Last webhook received",
    detail: h.lastWebhookAt ? fmtRelative(h.lastWebhookAt) : "Never",
    tone: h.lastWebhookAt ? "ok" : "warn",
  });
  if (h.signatureFailures > 0) {
    rows.push({
      label: "Rejected deliveries",
      detail: `${h.signatureFailures} bad signature${h.signatureFailures === 1 ? "" : "s"} in a row`,
      tone: h.signatureFailures >= 5 ? "bad" : "warn",
    });
  }
  for (const j of c.jobs) {
    rows.push({
      label: j.label,
      detail: j.lastRunAt
        ? `${fmtRelative(j.lastRunAt)}${j.ok === false ? " · last run FAILED" : ""}${j.summary ? ` · ${j.summary}` : ""}`
        : "Hasn't run yet",
      tone: j.stale || j.ok === false ? "bad" : j.lastRunAt ? "ok" : "warn",
    });
  }
  return rows;
}

// ---- Pipeline & throughput --------------------------------------------------------------

function Pipeline({ analytics }: { analytics: OrderAnalytics }) {
  const stateFilter = useAdminOrders((s) => s.stateFilter);
  const setStateFilter = useAdminOrders((s) => s.setStateFilter);
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink-800">Where orders are</h3>
        <span className="text-xs text-ink-400">
          {fmtNumber(analytics.orders)} paid in this window · {fmtNumber(analytics.open)} open now
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {PRINT_ORDER_STATES.map((s) => {
          const n = analytics.pipeline[s];
          const active = stateFilter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStateFilter(active ? "all" : s)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                active ? "border-brand-400 bg-brand-50" : "border-ink-100 bg-white hover:bg-ink-50"
              } ${n === 0 ? "opacity-60" : ""}`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{PRINT_ORDER_STATE_LABEL[s]}</p>
              <p className="text-lg font-semibold tabular-nums text-ink-800">{fmtNumber(n)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Throughput({ analytics }: { analytics: OrderAnalytics }) {
  const rows = analytics.throughput;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.paid, r.placed, r.shipped)));
  const total = (k: "paid" | "placed" | "shipped" | "failed") => rows.reduce((n, r) => n + r[k], 0);
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-800">Volume per day</h3>
        <p className="text-xs text-ink-500">
          <Dot className="bg-amber-400" /> paid {total("paid")} · <Dot className="bg-sky-400" /> sent to printer {total("placed")} ·{" "}
          <Dot className="bg-emerald-500" /> shipped {total("shipped")}
          {total("failed") > 0 && (
            <>
              {" "}
              · <Dot className="bg-rose-500" /> failed {total("failed")}
            </>
          )}
        </p>
      </div>
      <div className="flex h-28 items-end gap-px" role="img" aria-label="Orders paid, placed and shipped per day">
        {rows.map((r) => (
          <div key={r.day} className="group relative flex h-full flex-1 items-end justify-center gap-px" title={`${r.day}: ${r.paid} paid, ${r.placed} placed, ${r.shipped} shipped`}>
            <span className="w-full max-w-1.5 rounded-t bg-amber-400" style={{ height: `${(r.paid / max) * 100}%` }} />
            <span className="w-full max-w-1.5 rounded-t bg-sky-400" style={{ height: `${(r.placed / max) * 100}%` }} />
            <span className="w-full max-w-1.5 rounded-t bg-emerald-500" style={{ height: `${(r.shipped / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400">
        <span>{rows[0]?.day}</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`mr-0.5 inline-block size-2 rounded-full align-middle ${className}`} />;
}

// ---- Reliability, emails -------------------------------------------------------------

function Reliability({ analytics }: { analytics: OrderAnalytics }) {
  const r = analytics.reliability;
  const s = analytics.sync;
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-800">Reliability</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Placed first try" value={fmtPct(r.firstTryRate)} good={(r.firstTryRate ?? 1) >= 0.95} />
        <Stat label="Printer rejected" value={fmtPct(r.rejectionRate, 1)} bad={(r.rejectionRate ?? 0) > 0.03} />
        <Stat label="Needed a retry" value={fmtNumber(r.needed.retries)} />
        <Stat label="Address corrected" value={fmtPct(r.addressCorrectionRate, 1)} />
        <Stat label="Updates via webhook" value={fmtPct(s.webhookShare)} bad={s.webhookShare !== null && s.webhookShare < 0.5 && s.viaPoll > 5} />
        <Stat label="Webhook was late" value={fmtNumber(s.drifts)} bad={s.drifts > 3} />
      </div>
      {r.topErrors.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">Top errors</p>
          <ul className="space-y-1">
            {r.topErrors.map((e) => (
              <li key={e.message} className="flex items-start gap-2 text-xs text-ink-600">
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-ink-800">{e.count}</span>
                <span className="min-w-0 break-words">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Emails({ analytics }: { analytics: OrderAnalytics }) {
  const e = analytics.emails;
  const row = (label: string, v: { sent: number; expected: number }) => (
    <div className="flex items-center justify-between border-b border-ink-50 py-2 last:border-0">
      <span className="text-sm text-ink-700">{label}</span>
      <span className={`text-sm tabular-nums ${v.sent < v.expected ? "font-semibold text-rose-600" : "text-ink-600"}`}>
        {v.sent} / {v.expected}
      </span>
    </div>
  );
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink-800">Customer emails</h3>
      <p className="mb-2 text-xs text-ink-500">Sent / expected. A gap means a customer wasn&apos;t told.</p>
      {row("Order confirmed", e.confirmation)}
      {row("Shipped", e.shipped)}
      {row("Problem with order", e.failed)}
      {e.failures > 0 && (
        <p className="mt-2 text-xs font-medium text-rose-600">{e.failures} order(s) have an email that failed to send.</p>
      )}
    </div>
  );
}

// ---- Timing, money --------------------------------------------------------------------

function Timing({ analytics }: { analytics: OrderAnalytics }) {
  const t = analytics.timing;
  const rows: TimingBucket[] = [t.overall, ...t.byMarket];
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
      <div className="border-b border-ink-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-800">How long it takes</h3>
        <p className="text-xs text-ink-500">
          Typical (median) and slowest-tenth (p90), for orders that reached each step. The p90 is what your slowest customers feel.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2.5 font-medium">Market</th>
              <th className="px-4 py-2.5 text-right font-medium">Orders</th>
              <th className="px-4 py-2.5 text-right font-medium">Paid → printer</th>
              <th className="px-4 py-2.5 text-right font-medium">Printer → shipped</th>
              <th className="px-4 py-2.5 text-right font-medium">Paid → shipped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-ink-50 last:border-0">
                <td className="px-4 py-2.5 text-ink-700">
                  {r.key === "all" ? <strong>All markets</strong> : `${countryFlag(r.key)} ${r.label}`}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">{fmtNumber(r.orders)}</td>
                <Pair p={r.paidToPlaced} />
                <Pair p={r.placedToShipped} />
                <Pair p={r.paidToShipped} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pair({ p }: { p: { n: number; p50: number | null; p90: number | null } }) {
  if (p.n === 0) return <td className="px-4 py-2.5 text-right text-ink-300">—</td>;
  return (
    <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
      {fmtDuration(p.p50)} <span className="text-ink-400">/ {fmtDuration(p.p90)}</span>
    </td>
  );
}

function Money({ analytics }: { analytics: OrderAnalytics }) {
  const m = analytics.money;
  const basis = m.costBasis;
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
      <div className="border-b border-ink-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-800">Money per order</h3>
        <p className="text-xs text-ink-500">
          In USD. Revenue is what customers paid (after refunds, including tax and shipping); cost is what the printer charged
          {basis.estimated + basis.missing > 0
            ? ` — ${basis.estimated} order(s) still use our estimate and ${basis.missing} have no cost yet`
            : ""}
          .
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Stat label="Revenue" value={fmtUsd(m.revenue)} />
        <Stat label="Printer cost" value={fmtUsd(m.printCost)} />
        <Stat label="Margin" value={fmtUsd(m.margin)} good={m.margin > 0} bad={m.margin < 0} />
        <Stat label="Margin rate" value={fmtPct(m.marginRate, 1)} bad={(m.marginRate ?? 1) < 0.15} />
      </div>
      {m.byMarket.length > 0 && (
        <div className="overflow-x-auto border-t border-ink-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2.5 font-medium">Market</th>
                <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                <th className="px-4 py-2.5 text-right font-medium">Printer cost</th>
                <th className="px-4 py-2.5 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {m.byMarket.map((r) => (
                <tr key={r.country} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-2.5 text-ink-700">
                    {r.country === "??" ? "Unknown" : `${countryFlag(r.country)} ${countryLabel(r.country)}`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">{fmtNumber(r.orders)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-800">{fmtUsd(r.revenue)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">{fmtUsd(r.printCost)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.margin < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fmtUsd(r.margin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${bad ? "text-rose-600" : good ? "text-emerald-600" : "text-ink-800"}`}>{value}</p>
    </div>
  );
}

// ---- The list ------------------------------------------------------------------------

function OrdersList() {
  const orders = useAdminOrders((s) => s.orders);
  const total = useAdminOrders((s) => s.total);
  const stateFilter = useAdminOrders((s) => s.stateFilter);
  const setStateFilter = useAdminOrders((s) => s.setStateFilter);
  const attentionOnly = useAdminOrders((s) => s.attentionOnly);
  const setAttentionOnly = useAdminOrders((s) => s.setAttentionOnly);
  const query = useAdminOrders((s) => s.query);
  const setQuery = useAdminOrders((s) => s.setQuery);
  const refreshList = useAdminOrders((s) => s.refreshList);
  const open = useAdminOrders((s) => s.open);

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-3">
        <h3 className="mr-auto text-sm font-semibold text-ink-800">
          All orders <span className="font-normal text-ink-400">({fmtNumber(total)})</span>
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(e) => setAttentionOnly(e.target.checked)}
            className="size-4 rounded border-ink-300 text-brand-500"
          />
          Needs attention
        </label>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as PrintOrderState | "all")}
          className="h-9 rounded-lg bg-white px-2 text-sm ring-1 ring-inset ring-ink-200"
          aria-label="Filter by state"
        >
          <option value="all">All states</option>
          {PRINT_ORDER_STATES.map((s) => (
            <option key={s} value={s}>
              {PRINT_ORDER_STATE_LABEL[s]}
            </option>
          ))}
        </select>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            void refreshList();
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Email, order or job id…"
            className="h-9 w-56 rounded-lg bg-white pl-8 pr-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </form>
      </div>
      {orders.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-ink-500">No orders match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2.5 font-medium">Paid</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">To</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium">Printer</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.key}
                  onClick={() => void open(o.key)}
                  className="cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-500">{fmtRelative(o.paidAt ?? o.createdAt)}</td>
                  <td className="max-w-56 truncate px-4 py-2.5 text-ink-800">
                    {o.recipientEmail ?? o.uid ?? o.key}
                    <SandboxTag env={o.env} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">
                    {o.destinationCountry ? `${countryFlag(o.destinationCountry)} ${o.destinationCountry}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink-800">
                    {fmtMoney(o.amountPaid, o.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <StateBadge state={o.state} />
                    {o.needsAttention && <AlertTriangle className="ml-1.5 inline size-4 text-rose-500" aria-label="Needs attention" />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">{o.luluStatus ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Detail --------------------------------------------------------------------------

function OrderDrawer() {
  const selectedKey = useAdminOrders((s) => s.selectedKey);
  const detail = useAdminOrders((s) => s.detail);
  const detailLoading = useAdminOrders((s) => s.detailLoading);
  const close = useAdminOrders((s) => s.open);

  return (
    <Drawer open={Boolean(selectedKey)} onClose={() => void close(null)} side="right" title="Order" widthClass="max-w-2xl">
      {detailLoading && !detail && (
        <div className="flex items-center justify-center py-16 text-ink-400">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {detail && detail.record.key === selectedKey && <OrderDetailView detail={detail} />}
    </Drawer>
  );
}

function OrderDetailView({ detail }: { detail: OrderDetail }) {
  const { record: r, events, payment } = detail;
  const act = useAdminOrders((s) => s.act);
  const busy = useAdminOrders((s) => s.busyAction);
  const actionError = useAdminOrders((s) => s.actionError);
  const notice = useAdminOrders((s) => s.notice);
  const [confirm, setConfirm] = useState<"cancel" | "replace" | null>(null);
  const [ackNote, setAckNote] = useState("");

  const live = Boolean(r.currentJobId) && providerJobIsLive(r.luluStatus);
  const canRetry = !r.currentJobId && payment?.status !== "refunded" && (r.state === "paid" || r.state === "retrying" || r.state === "failed" || r.state === "placing");
  const canReplace = Boolean(r.currentJobId) && !live && payment?.status !== "refunded";
  const run = (a: OrderAction, body?: Record<string, unknown>) => void act(r.key, a, body);

  return (
    <div className="space-y-5 pb-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={r.state} />
          <SandboxTag env={r.env} />
          {r.luluStatus && <span className="text-xs text-ink-500">Printer: {r.luluStatus}</span>}
        </div>
        <p className="mt-2 text-sm font-medium text-ink-800">
          {r.recipientName ?? "Unknown recipient"} · {r.recipientEmail ?? r.uid ?? "no email"}
        </p>
        <p className="text-xs text-ink-500">
          {r.destinationCountry ? `${countryFlag(r.destinationCountry)} ${countryLabel(r.destinationCountry)} · ` : ""}
          {r.sku ?? "—"} · {r.copies ?? "?"} copy · {r.pages ?? "?"} pages · {r.shippingMethod ?? "—"}
        </p>
      </div>

      {r.attention && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-100">
          <p className="text-sm font-semibold text-rose-800">{ATTENTION_REASON_LABEL[r.attention.reason]}</p>
          <p className="mt-0.5 text-xs text-rose-700">{r.attention.detail}</p>
          <p className="mt-1.5 text-xs text-rose-800">
            <strong>Do:</strong> {ATTENTION_REASON_ACTION[r.attention.reason]}
          </p>
        </div>
      )}
      {r.ack && (
        <p className="rounded-xl bg-ink-50 px-4 py-2.5 text-xs text-ink-600">
          Marked as handled by {r.ack.by} {fmtRelative(r.ack.at)}: “{r.ack.note}”
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button size="sm" loading={busy === "retry"} onClick={() => run("retry")}>
            Retry placement
          </Button>
        )}
        {canReplace && (
          <Button size="sm" variant="secondary" loading={busy === "replace"} onClick={() => setConfirm("replace")}>
            Place a new job
          </Button>
        )}
        {r.currentJobId && (
          <Button size="sm" variant="secondary" loading={busy === "sync"} onClick={() => run("sync")}>
            Sync with printer
          </Button>
        )}
        {live && (
          <Button size="sm" variant="danger" loading={busy === "cancel"} onClick={() => setConfirm("cancel")}>
            Cancel at printer
          </Button>
        )}
        {(["confirmation", "shipped", "failed"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="ghost"
            loading={busy === "resend-email"}
            onClick={() => run("resend-email", { kind })}
          >
            Resend {kind} email
          </Button>
        ))}
      </div>
      {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}

      {r.attention && (
        <div className="flex gap-2">
          <input
            value={ackNote}
            onChange={(e) => setAckNote(e.target.value)}
            placeholder="What did you do? (marks it handled)"
            className="h-9 flex-1 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!ackNote.trim()}
            loading={busy === "ack"}
            onClick={() => {
              run("ack", { note: ackNote });
              setAckNote("");
            }}
          >
            Mark handled
          </Button>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field label="Payment" value={payment ? `${payment.status} · ${fmtMoney(payment.amount, payment.currency)}` : "—"} />
        <Field label="Refunded" value={payment ? fmtMoney(payment.refundedAmount, payment.currency) : "—"} />
        <Field label="Printer cost" value={r.actualCost ? fmtMoney(r.actualCost.amount, r.actualCost.currency) : r.estimatedCost ? `~${fmtMoney(r.estimatedCost.amount, r.estimatedCost.currency)} (estimate)` : "—"} />
        <Field label="Placement attempts" value={String(r.attempts)} />
        <Field label="Paid" value={fmtDateTime(r.paidAt)} />
        <Field label="Sent to printer" value={fmtDateTime(r.placedAt)} />
        <Field label="In production" value={fmtDateTime(r.inProductionAt)} />
        <Field label="Shipped" value={fmtDateTime(r.shippedAt)} />
        <Field label="Job ids" value={r.jobIds.length ? r.jobIds.join(", ") : "—"} />
        <Field label="Payment id" value={r.paymentId ?? "—"} />
        <Field label="Address corrected" value={r.addressCorrected ? "Yes — check the job" : "No"} />
        <Field label="Last printer contact" value={fmtRelative(Math.max(r.lastWebhookAt ?? 0, r.lastSyncAt ?? 0) || null)} />
      </dl>

      {r.shipments.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-400">Tracking</p>
          {r.shipments.map((s, i) => (
            <p key={i} className="text-sm text-ink-700">
              {s.carrier ?? "Carrier"} ·{" "}
              {s.trackingUrl ? (
                <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                  {s.trackingNumber ?? "track"}
                </a>
              ) : (
                (s.trackingNumber ?? "no number yet")
              )}
            </p>
          ))}
        </div>
      )}

      {r.lastError && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-400">Last error</p>
          <p className="break-words rounded-lg bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700">{r.lastError}</p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Timeline</p>
        <ol className="space-y-2.5 border-l border-ink-100 pl-4">
          {events.length === 0 && <li className="text-xs text-ink-400">Nothing recorded yet.</li>}
          {[...events].reverse().map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-ink-300" />
              <p className="text-sm text-ink-800">{e.message ?? e.type}</p>
              <p className="text-xs text-ink-400">
                {fmtDateTime(e.at)} · {e.source}
                {e.toState && e.fromState !== e.toState ? ` · ${e.fromState ? `${PRINT_ORDER_STATE_LABEL[e.fromState]} → ` : ""}${PRINT_ORDER_STATE_LABEL[e.toState]}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <ConfirmModal
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run("cancel");
        }}
        title="Cancel at the printer?"
        confirmLabel="Cancel the job"
        danger
      >
        The printer will stop this job if production hasn&apos;t started. It can&apos;t be undone — to print the book again you&apos;ll
        place a new job. This does not refund the customer.
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "replace"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run("replace");
        }}
        title="Place a new print job?"
        confirmLabel="Place new job"
      >
        The current job is dead ({r.luluStatus ?? "no status"}), so a fresh one will be sent with the same files and address. The
        customer is not charged again.
      </ConfirmModal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="break-words text-ink-800">{value}</dd>
    </div>
  );
}
