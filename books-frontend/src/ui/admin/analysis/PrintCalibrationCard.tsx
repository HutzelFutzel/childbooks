"use client";

/**
 * Configured-vs-actual print cost calibration.
 *
 * Every placed order stores the CONFIGURED cost estimate from checkout (the
 * product cost table + live shipping quote) and, via Lulu's status webhooks,
 * the ACTUAL charge the provider ended up billing. This card compares the two
 * per SKU over a trailing window. Drift here is the early-warning signal that
 * the product cost table has fallen out of date — and since that table drives
 * `computeMargin` and every break-even / safe-discount number in the Discount
 * planner, stale costs quietly make those numbers wrong.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Printer, RefreshCw } from "lucide-react";
import { backendFetch } from "../../../platform/backend";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import { cn } from "../../lib/cn";
import { fmtNumber, fmtUsd } from "./format";

interface CalibrationRow {
  sku: string;
  orders: number;
  estimatedUsd: number;
  actualUsd: number;
  driftPct: number | null;
  missingEstimate: number;
  pendingActual: number;
}

interface CalibrationSummary {
  fromMs: number;
  scanned: number;
  rows: CalibrationRow[];
}

const WINDOWS = [
  { value: "30", label: "Last 30d" },
  { value: "90", label: "Last 90d" },
  { value: "365", label: "Last year" },
];

/** |drift| ≥ this ⇒ the cost table needs attention. */
const DRIFT_WARN_PCT = 10;

export function PrintCalibrationCard() {
  const [days, setDays] = useState("90");
  const [data, setData] = useState<CalibrationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendFetch(`/admin/finance/print-calibration?days=${days}`);
      if (!res.ok) throw new Error("Failed to load print calibration.");
      setData((await res.json()) as CalibrationSummary);
    } catch (err) {
      setError((err as Error)?.message ?? "Failed to load print calibration.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const worst = rows.reduce<number>(
    (max, r) => (r.driftPct != null ? Math.max(max, Math.abs(r.driftPct)) : max),
    0,
  );

  return (
    <section className="rounded-2xl border border-ink-100 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
            <Printer className="size-4" /> Print cost calibration
            {worst >= DRIFT_WARN_PCT && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                drift {Math.round(worst)}%
              </span>
            )}
          </h3>
          <p className="text-xs text-ink-500">
            Your configured cost table vs what the print provider actually charged, per product.
            Drift means the Catalog cost table — and every margin and safe-discount number derived
            from it — is out of date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={days}
            options={WINDOWS}
            onChange={(e) => setDays(e.target.value)}
            className="h-8 w-32 text-xs"
          />
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </header>

      {error && <p className="px-4 py-3 text-sm text-rose-600">{error}</p>}
      {!data && loading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-500">
          <Loader2 className="size-4 animate-spin" /> Comparing estimates against provider charges…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-400">
          No print orders in this window yet. Once orders flow, each one records the configured
          estimate at checkout and the provider&apos;s actual charge for comparison.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-400">
                <th className="px-4 py-2 font-medium">Product SKU</th>
                <th className="px-4 py-2 text-right font-medium">Orders compared</th>
                <th className="px-4 py-2 text-right font-medium">Configured</th>
                <th className="px-4 py-2 text-right font-medium">Actually paid</th>
                <th className="px-4 py-2 text-right font-medium">Drift</th>
                <th className="px-4 py-2 text-right font-medium">No estimate / pending</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const drift = r.driftPct;
                const driftCls =
                  drift == null
                    ? "text-ink-400"
                    : drift >= DRIFT_WARN_PCT
                      ? "text-rose-600"
                      : drift <= -DRIFT_WARN_PCT
                        ? "text-emerald-600"
                        : "text-ink-600";
                return (
                  <tr key={r.sku} className="border-t border-ink-50">
                    <td className="max-w-[220px] truncate px-4 py-2 font-mono text-xs text-ink-700">
                      {r.sku}
                    </td>
                    <td className="px-4 py-2 text-right text-ink-600">{fmtNumber(r.orders)}</td>
                    <td className="px-4 py-2 text-right text-ink-600">
                      {r.orders > 0 ? fmtUsd(r.estimatedUsd) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-ink-600">
                      {r.orders > 0 ? fmtUsd(r.actualUsd) : "—"}
                    </td>
                    <td className={cn("px-4 py-2 text-right font-semibold", driftCls)}>
                      {drift == null ? "—" : `${drift > 0 ? "+" : ""}${drift}%`}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-ink-400">
                      {r.missingEstimate > 0 || r.pendingActual > 0
                        ? `${r.missingEstimate} / ${r.pendingActual}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-ink-50 px-4 py-2 text-[11px] text-ink-400">
            Positive drift = the provider charges MORE than your cost table assumes (margins and
            safe-discount numbers in the Discount planner are optimistic — update the product&apos;s
            cost table). &ldquo;No estimate&rdquo; counts orders placed before estimates were
            recorded; &ldquo;pending&rdquo; counts orders whose provider costs haven&apos;t arrived
            yet.
          </p>
        </div>
      )}
    </section>
  );
}
