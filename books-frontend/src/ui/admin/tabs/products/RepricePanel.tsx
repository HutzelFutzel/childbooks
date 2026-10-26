"use client";

import { Button } from "../../../components/Button";
import { bindingNoun } from "../../../../core/fulfillment/lulu/products";
import { planChangesPrices, type RepricePlan } from "../../../../core/config/targetMargin";
import { fmtMoney } from "./parts";

/**
 * What "Reprice to target margins" would store, product by product, before
 * anything is saved. Prices are what customers pay, so a catalog-wide change
 * is shown in full and applied only on confirmation.
 */
export function RepricePanel({
  plans,
  baseCurrency,
  applying,
  onApply,
  onDismiss,
}: {
  plans: RepricePlan[];
  baseCurrency: string;
  applying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const ready = plans.filter(planChangesPrices);
  return (
    <div className="space-y-2 rounded-lg p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-500">
          Reprice to target margins — {ready.length} of {plans.length} product{plans.length === 1 ? "" : "s"} would change
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDismiss} className="text-xs text-ink-400 hover:text-ink-600">
            Cancel
          </button>
          <Button size="sm" disabled={ready.length === 0 || applying} onClick={onApply}>
            {applying ? "Saving…" : `Apply to ${ready.length}`}
          </Button>
        </div>
      </div>
      {plans.map((plan) => {
        const inBase = plan.changes.filter((c) => c.currency === baseCurrency);
        const list = inBase.length > 0 ? inBase : plan.changes;
        const shown = list.slice(0, 4);
        const more = list.length - shown.length;
        return (
          <div key={plan.productId} className="space-y-0.5 border-t border-ink-100 pt-1.5 first:border-t-0">
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-ink-700">{plan.productName}</span>
              <span className="shrink-0 text-ink-500">
                {plan.target.pct}% {plan.target.source === "binding" ? `(${bindingNoun(plan.target.binding)})` : "(default)"}
              </span>
            </div>
            {plan.status === "needs-cost" ? (
              <p className="text-[10px] text-amber-700">No measured cost yet — run Measure costs first. Left as it is.</p>
            ) : plan.status === "unreachable" ? (
              <p className="text-[10px] text-red-600">
                {plan.target.pct}% can&apos;t be reached in {plan.unreachable.join(", ")} after fees and tax. Lower the
                target. Left as it is.
              </p>
            ) : !planChangesPrices(plan) ? (
              <p className="text-[10px] text-emerald-700">Already on target.</p>
            ) : (
              <p className="text-[10px] tabular-nums text-ink-500">
                {shown
                  .map(
                    (c) =>
                      `${c.minPages}–${c.maxPages} p: ${c.from == null ? "new" : fmtMoney(c.from, c.currency)} → ${fmtMoney(c.to, c.currency)}`,
                  )
                  .join(" · ")}
                {more > 0 && ` · +${more} more`}
                {plan.variantsChange && " · variant surcharges updated"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
