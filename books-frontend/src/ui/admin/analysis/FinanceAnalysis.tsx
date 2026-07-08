"use client";

/**
 * The admin Finance dashboard — the "total win" over a custom window, built on
 * the server-side finance events stream. Shows revenue − every cost (provider
 * spend, print costs, Stripe fees, refunds, waste), drillable per category,
 * per user and per project, with a ranked cost-point table (the leak finder)
 * and the operational alerts inbox (fulfillment failures, grant abuse, …).
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Scale,
  X,
} from "lucide-react";
import type { Timeframe } from "../../../core/analytics/types";
import {
  useAdminFinance,
  type AdminAlertRow,
  type FinanceCategoryFilter,
  type FinanceGroupRow,
} from "../../../state/adminFinanceStore";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import { notify } from "../../lib/notify";
import { fmtDateTime, fmtNumber, fmtRelative, fmtUsd } from "./format";
import { CustomCostsCard } from "./CustomCostsCard";

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "custom", label: "Custom" },
];

const CATEGORIES: { id: FinanceCategoryFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "sparks", label: "Sparks-total" },
  { id: "books", label: "Books-total" },
  { id: "subscriptions", label: "Subscriptions-total" },
  { id: "waste", label: "Waste" },
  { id: "infra", label: "Infrastructure" },
  { id: "ops", label: "Operating costs" },
];

/** Human labels for the well-known finance event kinds. */
const KIND_LABELS: Record<string, string> = {
  packRevenue: "Spark pack sales",
  providerCost: "AI provider spend",
  sparkGrant: "Sparks granted",
  sparkSpend: "Sparks spent",
  printRevenue: "Print order sales",
  printCost: "Print production (Lulu)",
  refund: "Refunds",
  subscriptionRevenue: "Subscription invoices",
  stripeFee: "Stripe processing fees",
  ebookRevenue: "Ebook sales",
  failedCalls: "Failed provider calls",
  fulfillmentFailed: "Failed fulfillments",
  settleFailed: "Uncharged actions (settle failed)",
  cloudCost: "Google Cloud / Firebase spend",
  infraBudget: "Infra budget (prorated)",
};

/** Custom operating costs use kind `custom:{slug}` — prettify the slug. */
function kindLabel(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  if (kind.startsWith("custom:")) {
    const words = kind.slice("custom:".length).replace(/-/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : kind;
  }
  return kind;
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function signed(n: number): string {
  const abs = fmtUsd(Math.abs(n));
  return n < 0 ? `−${abs}` : abs;
}

export function FinanceAnalysis() {
  const s = useAdminFinance();

  useEffect(() => {
    void s.refresh();
    void s.loadAlerts();
    // Only on mount — subsequent loads are driven by the filter setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sum = s.summary;
  const openAlerts = s.alerts.filter((a) => !a.resolvedAt);

  return (
    <div className="space-y-5">
      {/* Window + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={TIMEFRAMES} value={s.timeframe} onChange={(id) => s.setTimeframe(id as Timeframe)} />
        <div className="flex items-center gap-3">
          {s.lastUpdated && (
            <span className="text-xs text-ink-400">Updated {fmtRelative(s.lastUpdated)}</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${s.loading ? "animate-spin" : ""}`} />}
            onClick={() => void s.refresh()}
            disabled={s.loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {s.timeframe === "custom" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-500">From</span>
          <input
            type="date"
            value={toDateInput(s.customFrom)}
            onChange={(e) => s.setCustomRange(new Date(e.target.value).getTime(), s.customTo)}
            className="h-9 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <span className="text-ink-500">to</span>
          <input
            type="date"
            value={toDateInput(s.customTo)}
            onChange={(e) =>
              s.setCustomRange(s.customFrom, new Date(e.target.value).getTime() + 24 * 60 * 60 * 1000 - 1)
            }
            className="h-9 rounded-lg bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      )}

      {/* Category filter + drill-down */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          items={CATEGORIES}
          value={s.category}
          onChange={(id) => s.setCategory(id as FinanceCategoryFilter)}
        />
        <DrilldownChip label="User" value={s.uid} onClear={() => s.setDrilldown({ uid: "" })} />
        <DrilldownChip
          label="Project"
          value={s.projectId}
          onClear={() => s.setDrilldown({ projectId: "" })}
        />
      </div>

      {s.error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          <AlertTriangle className="size-4 shrink-0" /> {s.error}
        </div>
      )}

      {!sum && s.loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-ink-500">
          <Loader2 className="size-5 animate-spin" /> Crunching the numbers…
        </div>
      ) : sum ? (
        <>
          {/* Total win */}
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard
              label="Revenue"
              value={fmtUsd(sum.totalRevenueUsd)}
              icon={<ArrowUpRight className="size-4" />}
              tone="good"
            />
            <KpiCard
              label="Costs"
              value={fmtUsd(sum.totalCostUsd)}
              icon={<ArrowDownRight className="size-4" />}
              tone="bad"
            />
            <KpiCard
              label="Total win (net)"
              value={signed(sum.netUsd)}
              icon={<Scale className="size-4" />}
              tone={sum.netUsd >= 0 ? "good" : "bad"}
              highlight
            />
          </div>
          {sum.capped && (
            <p className="text-xs text-amber-600">
              The window contains more events than one scan covers — totals are a lower bound.
              Narrow the window for exact numbers.
            </p>
          )}

          {/* Category totals */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {(["sparks", "books", "subscriptions", "waste", "infra", "ops"] as const).map((cat) => {
              const c = sum.byCategory[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => s.setCategory(s.category === cat ? "all" : cat)}
                  className={cn(
                    "rounded-2xl border bg-white p-4 text-left transition",
                    s.category === cat ? "border-brand-300 ring-2 ring-brand-100" : "border-ink-100 hover:border-ink-200",
                  )}
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                    {cat}-total
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-lg font-bold",
                      (c?.netUsd ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600",
                    )}
                  >
                    {signed(c?.netUsd ?? 0)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {fmtUsd(c?.revenueUsd ?? 0)} in · {fmtUsd(c?.costUsd ?? 0)} out ·{" "}
                    {fmtNumber(c?.count ?? 0)} events
                  </p>
                </button>
              );
            })}
          </div>

          {/* Cost points — the leak finder */}
          <section className="rounded-2xl border border-ink-100 bg-white">
            <header className="border-b border-ink-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-ink-800">Cost & revenue points</h3>
              <p className="text-xs text-ink-500">
                Every money line in the window, ranked by cost — the first place to look for leaks
                and optimization targets.
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-400">
                    <th className="px-4 py-2 font-medium">Line</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 text-right font-medium">Revenue</th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                    <th className="px-4 py-2 text-right font-medium">Net</th>
                    <th className="px-4 py-2 text-right font-medium">Sparks</th>
                    <th className="px-4 py-2 text-right font-medium">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.byKind.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-ink-400">
                        No finance events in this window yet.
                      </td>
                    </tr>
                  )}
                  {sum.byKind.map((k) => (
                    <tr key={`${k.category}|${k.kind}`} className="border-t border-ink-50">
                      <td className="px-4 py-2 font-medium text-ink-700">
                        {kindLabel(k.kind)}
                      </td>
                      <td className="px-4 py-2 text-ink-500">{k.category}</td>
                      <td className="px-4 py-2 text-right text-emerald-600">
                        {k.revenueUsd > 0 ? fmtUsd(k.revenueUsd) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-rose-600">
                        {k.costUsd > 0 ? fmtUsd(k.costUsd) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2 text-right font-semibold",
                          k.netUsd >= 0 ? "text-emerald-700" : "text-rose-700",
                        )}
                      >
                        {signed(k.netUsd)}
                      </td>
                      <td className="px-4 py-2 text-right text-ink-600">
                        {k.sparks !== 0 ? fmtNumber(k.sparks) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-ink-500">{fmtNumber(k.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-user / per-project drill-down */}
          <div className="grid gap-4 lg:grid-cols-2">
            <GroupTable
              title="Per user"
              hint="Net win per user — click to filter the whole dashboard."
              rows={sum.byUser}
              activeKey={s.uid}
              onPick={(key) => s.setDrilldown({ uid: s.uid === key ? "" : key })}
              manualLabel="Filter by user id…"
              onManual={(v) => s.setDrilldown({ uid: v })}
            />
            <GroupTable
              title="Per project"
              hint="Net win per project — the true P&L of a single book."
              rows={sum.byProject}
              activeKey={s.projectId}
              onPick={(key) => s.setDrilldown({ projectId: s.projectId === key ? "" : key })}
              manualLabel="Filter by project id…"
              onManual={(v) => s.setDrilldown({ projectId: v })}
            />
          </div>
        </>
      ) : null}

      {/* Custom operating costs (email service, tooling, …) */}
      <CustomCostsCard />

      {/* Alerts inbox */}
      <section className="rounded-2xl border border-ink-100 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
              <BellRing className="size-4" /> Alerts
              {openAlerts.length > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                  {openAlerts.length} open
                </span>
              )}
            </h3>
            <p className="text-xs text-ink-500">
              Fulfillment failures, grant-abuse velocity and other events that need a human.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={s.retrying}
            onClick={() =>
              void s
                .retryFulfillments()
                .then((placed) =>
                  notify.success(
                    placed > 0
                      ? `Placed ${placed} order(s) on retry.`
                      : "No failed fulfillments were placeable right now.",
                  ),
                )
                .catch((err) => notify.error(err))
            }
          >
            Retry failed fulfillments
          </Button>
        </header>
        {s.alertsLoading && s.alerts.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-500">
            <Loader2 className="size-4 animate-spin" /> Loading alerts…
          </div>
        ) : s.alerts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">No alerts — all quiet.</p>
        ) : (
          <ul className="divide-y divide-ink-50">
            {s.alerts.map((a) => (
              <AlertRow key={a.id} alert={a} onResolve={() => void s.resolveAlert(a.id).catch((e) => notify.error(e))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "good" | "bad";
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-4",
        highlight ? "border-brand-200 ring-2 ring-brand-50" : "border-ink-100",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "good" ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function DrilldownChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
      {label}: <span className="font-mono">{value.slice(0, 16)}{value.length > 16 ? "…" : ""}</span>
      <button type="button" onClick={onClear} className="text-brand-500 hover:text-brand-800">
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function GroupTable({
  title,
  hint,
  rows,
  activeKey,
  onPick,
  manualLabel,
  onManual,
}: {
  title: string;
  hint: string;
  rows: FinanceGroupRow[];
  activeKey: string;
  onPick: (key: string) => void;
  manualLabel: string;
  onManual: (value: string) => void;
}) {
  const [manual, setManual] = useState("");
  return (
    <section className="rounded-2xl border border-ink-100 bg-white">
      <header className="border-b border-ink-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
        <p className="text-xs text-ink-500">{hint}</p>
      </header>
      <div className="border-b border-ink-50 px-4 py-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onManual(manual.trim());
          }}
        >
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={manualLabel}
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left text-xs text-ink-400">
              <th className="px-4 py-2 font-medium">Id</th>
              <th className="px-4 py-2 text-right font-medium">Revenue</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-5 text-center text-ink-400">
                  Nothing in this window.
                </td>
              </tr>
            )}
            {rows.map((g) => (
              <tr
                key={g.key}
                onClick={() => onPick(g.key)}
                className={cn(
                  "cursor-pointer border-t border-ink-50 transition hover:bg-brand-50/40",
                  activeKey === g.key && "bg-brand-50/70",
                )}
              >
                <td className="max-w-[160px] truncate px-4 py-2 font-mono text-xs text-ink-600">
                  {g.key}
                </td>
                <td className="px-4 py-2 text-right text-emerald-600">
                  {g.revenueUsd > 0 ? fmtUsd(g.revenueUsd) : "—"}
                </td>
                <td className="px-4 py-2 text-right text-rose-600">
                  {g.costUsd > 0 ? fmtUsd(g.costUsd) : "—"}
                </td>
                <td
                  className={cn(
                    "px-4 py-2 text-right font-semibold",
                    g.netUsd >= 0 ? "text-emerald-700" : "text-rose-700",
                  )}
                >
                  {signed(g.netUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SEVERITY_BADGE: Record<AdminAlertRow["severity"], string> = {
  info: "bg-sky-100 text-sky-700",
  warning: "bg-amber-100 text-amber-700",
  critical: "bg-rose-100 text-rose-700",
};

function AlertRow({ alert, onResolve }: { alert: AdminAlertRow; onResolve: () => void }) {
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", alert.resolvedAt && "opacity-50")}>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          SEVERITY_BADGE[alert.severity],
        )}
      >
        {alert.severity}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-700">{alert.message}</p>
        <p className="mt-0.5 text-xs text-ink-400">
          {alert.kind} · {fmtDateTime(alert.at)}
        </p>
      </div>
      {!alert.resolvedAt ? (
        <Button variant="ghost" size="sm" onClick={onResolve} leftIcon={<CheckCircle2 className="size-4" />}>
          Resolve
        </Button>
      ) : (
        <span className="text-xs text-ink-400">resolved</span>
      )}
    </li>
  );
}
