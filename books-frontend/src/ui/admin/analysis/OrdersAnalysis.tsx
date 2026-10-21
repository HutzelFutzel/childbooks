"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, XCircle } from "lucide-react";
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import type { OrderAnalytics, TimingBucket } from "../../../core/orders/analytics";
import {
  ATTENTION_REASON_ACTION,
  ATTENTION_REASON_LABEL,
  PRINT_ORDER_STATES,
  PRINT_ORDER_STATE_LABEL,
  PRINT_PREP_STATUS_LABEL,
  providerJobIsLive,
  type PrintOrderRecord,
  type PrintOrderState,
} from "../../../core/orders/lifecycle";
import type { PrintPrepSettings } from "../../../core/print/printPrep";
import { useAdminMarket } from "../../../state/adminMarketStore";
import {
  useAdminOrders,
  type OrderAction,
  type OrderDetail,
  type PrinterConnection,
  type PrintPrepOverview,
} from "../../../state/adminOrdersStore";
import { Button } from "../../components/Button";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Drawer } from "../../components/Drawer";
import { Tabs } from "../../components/Tabs";
import { useAdminBusy } from "../LoadingState";
import { fmtDateTime, fmtDuration, fmtMoney, fmtNumber, fmtPct, fmtRelative, fmtUsd } from "./format";

const WINDOWS = [
  { id: "7", label: "Last 7d" },
  { id: "30", label: "Last 30d" },
  { id: "90", label: "Last 90d" },
  { id: "365", label: "Last 12mo" },
];

const STATE_TONE: Record<PrintOrderState, string> = {
  paid: "bg-amber-100 text-amber-700",
  preparing_files: "bg-violet-100 text-violet-700",
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
  useAdminBusy(loading);

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
            onClick={() => void refresh({ force: true })}
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
          <PrintFilesCard analytics={analytics} />
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

// ---- Print files ------------------------------------------------------------------------

/** Upscaling costs fractions of a cent per picture; two decimals would show $0.00 everywhere. */
function fmtSmallUsd(n: number): string {
  if (n === 0) return "$0";
  return n < 1 ? `$${n.toFixed(4)}` : fmtUsd(n);
}

const TIER_LABEL: Record<string, string> = {
  esrgan: "AI",
  lanczos: "Lanczos",
  "esrgan:cached": "AI (reused)",
  "lanczos:cached": "Lanczos (reused)",
};

function tierLine(tiers: Record<string, number>): string {
  const parts = Object.entries(tiers)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${TIER_LABEL[t] ?? t} ${fmtNumber(n)}`);
  return parts.length ? parts.join(" · ") : "—";
}

function upscalerRow(p: PrintPrepOverview): { detail: string; tone: "ok" | "warn" | "bad" } {
  const u = p.upscaler;
  if (!u.configured) return { detail: "No AI service set — pictures are enlarged with Lanczos only", tone: "warn" };
  const fails = u.consecutiveFailures ?? 0;
  if (fails >= 5) {
    return {
      detail: `Failing (${fails}× in a row${u.firstFailureAt ? ` since ${fmtRelative(u.firstFailureAt)}` : ""}): ${u.lastError ?? "unknown"}`,
      tone: "bad",
    };
  }
  if (fails > 0) return { detail: `${fails} recent failure(s): ${u.lastError ?? "unknown"}`, tone: "warn" };
  return { detail: u.lastSuccessAt ? `Answering · last success ${fmtRelative(u.lastSuccessAt)}` : "Not used yet", tone: u.lastSuccessAt ? "ok" : "warn" };
}

function PrintFilesCard({ analytics }: { analytics: OrderAnalytics }) {
  const p = useAdminOrders((s) => s.printPrep);
  const error = useAdminOrders((s) => s.printPrepError);
  const busy = useAdminOrders((s) => s.busyAction);
  const test = useAdminOrders((s) => s.testUpscaler);
  const result = useAdminOrders((s) => s.upscalerTest);
  const open = useAdminOrders((s) => s.open);
  const [editing, setEditing] = useState(false);
  const f = analytics.printFiles;

  if (!p) {
    return error ? (
      <div className="rounded-2xl border border-ink-100 bg-white p-4 text-xs text-rose-600">Print files: {error}</div>
    ) : null;
  }
  const upscaler = upscalerRow(p);
  const net = p.money.collected30dUsd - p.money.spend30dUsd;
  const rows: { label: string; detail: string; tone: "ok" | "warn" | "bad" }[] = [
    {
      label: "Preparation",
      detail: p.settings.enabled ? `On · placed with standard files after ${p.settings.deadlineMinutes} min at the latest` : "Off — every order is placed with the standard files",
      tone: p.settings.enabled ? "ok" : "warn",
    },
    { label: "AI upscaler", ...upscaler },
    {
      label: "Sweep",
      detail: p.sweep.lastRunAt
        ? `${fmtRelative(p.sweep.lastRunAt)}${p.sweep.ok === false ? " · last run FAILED" : ""}${p.sweep.summary ? ` · ${p.sweep.summary}` : ""}`
        : "Hasn't run yet",
      tone: p.sweep.stale || p.sweep.ok === false ? (p.settings.enabled ? "bad" : "warn") : "ok",
    },
  ];
  const bad = p.settings.enabled && rows.some((r) => r.tone === "bad");

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-800">Print files</h3>
          <p className={`text-xs ${bad ? "text-rose-600" : "text-ink-500"}`}>
            {bad
              ? "Something is broken — orders still go out, but with standard-resolution files."
              : "Pictures are upscaled to 300 DPI after payment. A failure never blocks an order: it is placed with the files checked at checkout."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" loading={busy === "print-prep-test"} onClick={() => void test()}>
            Test upscaler
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close settings" : "Settings"}
          </Button>
        </div>
      </div>
      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}
      {result && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-xs ${result.tier === "esrgan" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
          Test: {result.tier === "esrgan" ? "AI service" : "Lanczos fallback"} produced {result.width}×{result.height} in{" "}
          {fmtDuration(result.ms)} ({fmtSmallUsd(result.costUsd)})
          {result.fallbacks.length > 0 ? ` — ${result.fallbacks.join("; ")}` : ""}
        </p>
      )}

      <dl className="mb-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Print resolution" value={fmtPct(f.hiresRate)} good={(f.hiresRate ?? 1) >= 0.95} bad={f.finished > 3 && (f.hiresRate ?? 1) < 0.8} />
        <Stat label="Fell back" value={`${fmtNumber(f.fallback)} (${fmtPct(f.fallbackRate)})`} bad={(f.fallbackRate ?? 0) > 0.1} />
        <Stat label="Paid → files ready" value={f.duration.n ? `${fmtDuration(f.duration.p50)} / ${fmtDuration(f.duration.p90)}` : "—"} />
        <Stat label="Preparing now" value={fmtNumber(p.active.length)} />
        <Stat label="Upscale spend (30d)" value={fmtSmallUsd(p.money.spend30dUsd)} />
        <Stat label="Surcharge collected (30d)" value={fmtSmallUsd(p.money.collected30dUsd)} />
        <Stat label="Net (30d)" value={fmtSmallUsd(Math.abs(net)).replace("$", net < 0 ? "−$" : "$")} good={net >= 0} bad={net < 0} />
        <Stat label="Pictures (30d)" value={`${fmtNumber(p.money.images30d)} · ${fmtNumber(p.money.slots30d)} paid slots`} />
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Upscaled with (this period): {tierLine(f.tiers)}
        {f.images.failed > 0 ? ` · ${fmtNumber(f.images.failed)} picture(s) kept their original resolution` : ""}
      </p>

      {f.fallbackReasons.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">Why orders fell back</p>
          <ul className="space-y-1">
            {f.fallbackReasons.map((e) => (
              <li key={e.reason} className="flex items-start gap-2 text-xs text-ink-600">
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-ink-800">{e.count}</span>
                <span className="min-w-0 break-words">{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.active.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">Preparing now</p>
          <ul className="divide-y divide-ink-50">
            {p.active.map((a) => (
              <li key={a.paymentId}>
                <button
                  type="button"
                  onClick={() => void open(a.paymentId)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-left text-xs hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-800">{PRINT_PREP_STATUS_LABEL[a.status]}</span>
                  <span className="text-ink-500">
                    {a.images.done}/{a.images.total} pictures · started {fmtRelative(a.startedAt)} · falls back in{" "}
                    {fmtDuration(Math.max(0, a.deadlineAt - Date.now()))}
                  </span>
                  <span className="ml-auto text-brand-600">Open →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && <PrintPrepSettingsForm initial={p.settings} onSaved={() => setEditing(false)} />}
    </div>
  );
}

function PrintPrepSettingsForm({ initial, onSaved }: { initial: PrintPrepSettings; onSaved: () => void }) {
  const save = useAdminOrders((s) => s.savePrintPrepSettings);
  const busy = useAdminOrders((s) => s.busyAction === "print-prep-settings");
  const [s, setS] = useState<PrintPrepSettings>(initial);
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const input = "h-9 w-full rounded-lg bg-white px-2.5 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400";
  const field = (label: string, hint: string, el: ReactNode) => (
    <label className="block">
      <span className="text-xs font-medium text-ink-600">{label}</span>
      {el}
      <span className="mt-0.5 block text-[11px] text-ink-400">{hint}</span>
    </label>
  );

  return (
    <form
      className="mt-4 space-y-4 border-t border-ink-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(s).then((ok) => ok && onSaved());
      }}
    >
      <label className="flex items-center gap-2 text-sm text-ink-800">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => setS({ ...s, enabled: e.target.checked })}
          className="size-4 rounded border-ink-300 text-brand-500"
        />
        Prepare print-resolution files for paid orders
      </label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {field("Deadline (minutes)", "After this, the order is placed with the standard files.",
          <input type="number" min={5} max={1440} value={s.deadlineMinutes} onChange={(e) => setS({ ...s, deadlineMinutes: num(e.target.value) })} className={input} />)}
        {field("Upscale from", "A picture enlarged less than this is left alone.",
          <input type="number" step={0.05} min={1} max={3} value={s.minUpscaleRatio} onChange={(e) => setS({ ...s, minUpscaleRatio: num(e.target.value) })} className={input} />)}
        {field("Upscale at most", "Past this factor upscaling invents detail.",
          <input type="number" step={0.5} min={1} max={8} value={s.maxUpscaleRatio} onChange={(e) => setS({ ...s, maxUpscaleRatio: num(e.target.value) })} className={input} />)}
        {field("Largest picture (MP)", "Memory ceiling for one upscaled picture.",
          <input type="number" min={4} max={48} value={s.maxOutputMegapixels} onChange={(e) => setS({ ...s, maxOutputMegapixels: num(e.target.value) })} className={input} />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          {field("AI upscaler URL", "Cloud Run service with POST /upscale?scale=2|4. Empty = Lanczos only.",
            <input value={s.upscaler.url} placeholder="https://upscaler-….run.app" onChange={(e) => setS({ ...s, upscaler: { ...s.upscaler, url: e.target.value } })} className={input} />)}
        </div>
        {field("Auth", "IAM: this project's service account must be allowed to invoke it.",
          <select value={s.upscaler.auth} onChange={(e) => setS({ ...s, upscaler: { ...s.upscaler, auth: e.target.value === "none" ? "none" : "iam" } })} className={input}>
            <option value="iam">IAM identity token</option>
            <option value="none">None</option>
          </select>)}
        {field("Timeout (s)", "One call, cold start included.",
          <input type="number" min={10} max={540} value={s.upscaler.timeoutSeconds} onChange={(e) => setS({ ...s, upscaler: { ...s.upscaler, timeoutSeconds: num(e.target.value) } })} className={input} />)}
        {field("Service cost per second ($)", "GPU price ÷ 3600, for cost tracking.",
          <input type="number" step={0.00001} min={0} max={1} value={s.upscaler.costPerSecondUsd} onChange={(e) => setS({ ...s, upscaler: { ...s.upscaler, costPerSecondUsd: num(e.target.value) } })} className={input} />)}
        {field("Base cost per picture ($)", "Resampling, storage and re-render share.",
          <input type="number" step={0.0001} min={0} max={1} value={s.baseCostPerImageUsd} onChange={(e) => setS({ ...s, baseCostPerImageUsd: num(e.target.value) })} className={input} />)}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Slack alerts (#ops)</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("Upscaler down for (min)", "Every AI call failing this long pages.",
            <input type="number" min={5} max={1440} value={s.alerts.outageMinutes} onChange={(e) => setS({ ...s, alerts: { ...s.alerts, outageMinutes: num(e.target.value) } })} className={input} />)}
          {field("Fallbacks per hour", "This many orders on standard files within an hour pages.",
            <input type="number" min={1} max={1000} value={s.alerts.fallbacksPerHour} onChange={(e) => setS({ ...s, alerts: { ...s.alerts, fallbacksPerHour: num(e.target.value) } })} className={input} />)}
          {field("Daily spend above ($)", "0 turns the cost alert off.",
            <input type="number" min={0} value={s.alerts.dailyCostUsd} onChange={(e) => setS({ ...s, alerts: { ...s.alerts, dailyCostUsd: num(e.target.value) } })} className={input} />)}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

function PrintFilesPanel({ detail }: { detail: OrderDetail }) {
  const { record: r, payment, printPrep } = detail;
  const act = useAdminOrders((s) => s.act);
  const busy = useAdminOrders((s) => s.busyAction);
  if (!printPrep && !payment?.printPrepEligible) return null;
  const run = printPrep?.run ?? null;
  const unplaced = !r.currentJobId && payment?.status === "paid";
  const canPlaceStandard = unplaced && Boolean(run?.active);
  const canRerun = unplaced && Boolean(payment?.printPrepEligible) && !run?.active && run?.status !== "ready";
  const files = payment?.placedFiles ?? payment?.checkoutFiles ?? null;

  return (
    <div className="rounded-xl border border-ink-100 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Print files</p>
        <div className="flex gap-2">
          {canPlaceStandard && (
            <Button size="sm" variant="secondary" loading={busy === "use-standard-files"} onClick={() => void act(r.key, "use-standard-files")}>
              Place with standard files
            </Button>
          )}
          {canRerun && (
            <Button size="sm" variant="ghost" loading={busy === "rerun-print-prep"} onClick={() => void act(r.key, "rerun-print-prep")}>
              Prepare again
            </Button>
          )}
        </div>
      </div>
      {!run ? (
        <p className="mt-1 text-sm text-ink-600">Not prepared — placed with the files checked at checkout.</p>
      ) : (
        <>
          <p className={`mt-1 text-sm font-medium ${run.status === "fallback" ? "text-amber-700" : run.status === "ready" ? "text-emerald-700" : "text-ink-800"}`}>
            {PRINT_PREP_STATUS_LABEL[run.status]}
            {run.active ? ` · falls back in ${fmtDuration(Math.max(0, run.deadlineAt - Date.now()))}` : ""}
          </p>
          {run.reason && <p className="text-xs text-ink-600">{run.reason}</p>}
          <p className="mt-1 text-xs text-ink-500">
            {run.images.done}/{run.images.total} pictures upscaled
            {run.images.failed ? ` · ${run.images.failed} kept original` : ""} · {tierLine(run.tiers)} · {fmtSmallUsd(run.costUsd)} ·{" "}
            {run.finishedAt ? `took ${fmtDuration(run.finishedAt - run.startedAt)}` : `started ${fmtRelative(run.startedAt)}`}
          </p>
          {printPrep && printPrep.images.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-brand-600">Pictures ({printPrep.images.length})</summary>
              <table className="mt-1.5 w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-400">
                    <th className="py-1 font-medium">Enlarged</th>
                    <th className="py-1 font-medium">Size</th>
                    <th className="py-1 font-medium">With</th>
                    <th className="py-1 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {printPrep.images.map((img) => (
                    <tr key={img.blobId} className="border-t border-ink-50 align-top">
                      <td className="py-1 tabular-nums text-ink-700">{img.demand.toFixed(2)}×</td>
                      <td className="py-1 tabular-nums text-ink-600">
                        {img.naturalWidth}×{img.naturalHeight} → {img.target.width}×{img.target.height}
                      </td>
                      <td className="py-1 text-ink-600">{img.tier ? `${TIER_LABEL[img.tier] ?? img.tier}${img.cached ? " (reused)" : ""}` : "—"}</td>
                      <td className={`py-1 ${img.status === "failed" ? "text-rose-600" : "text-ink-600"}`} title={[img.error, ...img.fallbacks].filter(Boolean).join("\n")}>
                        {img.status === "done" ? `${fmtDuration(img.durationMs)}` : img.status}
                        {img.error ? ` · ${img.error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {run.timeline.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-brand-600">Steps</summary>
              <ul className="mt-1 space-y-0.5">
                {run.timeline.map((t, i) => (
                  <li key={i} className="text-xs text-ink-600">
                    <span className="text-ink-400">{fmtDateTime(t.at)}</span> · {t.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {files?.interior && (
        <p className="mt-2 text-xs text-ink-500">
          {payment?.placedFiles ? "Sent to printer" : "Checkout files"}:{" "}
          <a href={files.interior} target="_blank" rel="noreferrer" className="text-brand-600 underline">
            interior
          </a>
          {files.cover && (
            <>
              {" · "}
              <a href={files.cover} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                cover
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
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

      <PrintFilesPanel detail={detail} />

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
