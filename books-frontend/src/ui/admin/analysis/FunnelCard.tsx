"use client";

/**
 * Acquisition → checkout → paid → fulfilled.
 *
 * The stage that earns this card its place is "Checkout started → Paid": the
 * `payments` collection has always distinguished a started session from a
 * completed one, so abandoned-checkout value was computable all along and never
 * surfaced. It's usually the largest single recoverable number on the whole
 * dashboard.
 */
import { AlertTriangle } from "lucide-react";
import type { FunnelReport } from "../../../core/analytics/types";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { cn } from "../../lib/cn";
import { fmtNumber, fmtUsd } from "./format";

const KIND_LABELS: Record<string, string> = {
  order: "Print orders",
  ebook: "Ebooks",
  sparkPack: "Spark packs",
  sparkGift: "Spark gifts",
  subscription: "Subscriptions",
};

export function FunnelCard({ funnel }: { funnel: FunnelReport }) {
  const first = funnel.stages[0]?.value ?? 0;

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="py-3.5">
        <CardTitle className="text-sm">Conversion funnel</CardTitle>
        <p className="mt-0.5 text-xs text-ink-400">
          Where people drop out on the way to a paid, fulfilled order.
        </p>
      </CardHeader>
      <CardBody className="space-y-4 pt-2">
        <div className="space-y-1.5">
          {funnel.stages.map((stage, i) => {
            const width = first > 0 ? Math.max(2, (stage.value / first) * 100) : 0;
            return (
              <div key={stage.key} title={stage.hint} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-xs text-ink-500">{stage.label}</div>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-ink-50">
                  <div
                    className={cn(
                      "h-full rounded-lg transition-all",
                      i === funnel.stages.length - 1 ? "bg-emerald-400/70" : "bg-brand-400/70",
                    )}
                    style={{ width: `${width}%` }}
                  />
                  <span className="absolute inset-y-0 left-2.5 flex items-center text-xs font-semibold tabular-nums text-ink-800">
                    {fmtNumber(stage.value)}
                  </span>
                </div>
                <div className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {stage.stepPct === null ? (
                    <span className="text-ink-300">—</span>
                  ) : (
                    <span
                      className={cn(
                        "font-semibold",
                        stage.stepPct >= 50
                          ? "text-emerald-600"
                          : stage.stepPct >= 20
                            ? "text-amber-600"
                            : "text-rose-600",
                      )}
                    >
                      {stage.stepPct}%
                    </span>
                  )}
                  <span className="ml-1 text-ink-400">
                    {stage.overallPct !== null && i > 0 ? `(${stage.overallPct}%)` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {funnel.abandonedCheckouts > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>{fmtNumber(funnel.abandonedCheckouts)} abandoned checkouts</strong> worth{" "}
              <strong>{fmtUsd(funnel.abandonedUsd)}</strong> — sessions that were started and never
              paid. Sessions from the last hour are excluded, since they may still complete.
            </span>
          </div>
        )}

        {funnel.byKind.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-400">
                <th className="py-2 font-medium">Checkout type</th>
                <th className="py-2 text-right font-medium">Started</th>
                <th className="py-2 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Conversion</th>
                <th className="py-2 text-right font-medium">Left on the table</th>
              </tr>
            </thead>
            <tbody>
              {funnel.byKind.map((k) => (
                <tr key={k.kind} className="border-t border-ink-50">
                  <td className="py-2 text-ink-700">{KIND_LABELS[k.kind] ?? k.kind}</td>
                  <td className="py-2 text-right tabular-nums text-ink-600">{fmtNumber(k.started)}</td>
                  <td className="py-2 text-right tabular-nums text-emerald-600">{fmtNumber(k.paid)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-ink-800">
                    {k.conversionPct === null ? "—" : `${k.conversionPct}%`}
                  </td>
                  <td className="py-2 text-right tabular-nums text-rose-600">
                    {k.abandonedUsd > 0 ? fmtUsd(k.abandonedUsd) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </CardBody>
    </div>
  );
}
