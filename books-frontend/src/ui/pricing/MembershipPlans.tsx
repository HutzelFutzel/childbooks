"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import type { BillingInterval, PublicPlan } from "../../core/config/plans";
import { formatMoney } from "./format";

function currencyFor(plan: PublicPlan, preferredCurrency?: string): string {
  if (preferredCurrency && plan.prices[preferredCurrency]) return preferredCurrency;
  if (plan.prices.USD) return "USD";
  return Object.keys(plan.prices)[0] ?? "USD";
}

function bulletsForPlan(plan: PublicPlan): string[] {
  const out: string[] = [];
  if (plan.grant.monthlySparks > 0) {
    out.push(`${plan.grant.monthlySparks.toLocaleString()} Sparks to create with every month`);
  }
  if (plan.grant.annualBonusSparks > 0) {
    out.push(`+${plan.grant.annualBonusSparks.toLocaleString()} bonus Sparks on annual plan`);
  }
  if (plan.entitlements.printDiscountPct > 0) {
    out.push(`${plan.entitlements.printDiscountPct}% discount on every printed book order`);
  }
  if (plan.entitlements.removeWatermark) {
    out.push("No watermark on shared stories");
  }
  if (plan.isFree) {
    out.push("Make a complete book for free");
    out.push("Full story & illustration preview online");
    out.push("Order high-quality print anytime at standard price");
  }
  return out;
}

export function MembershipPlans({
  plans,
  currency = "USD",
  initialInterval = "month",
  className,
}: {
  plans: PublicPlan[];
  currency?: string;
  initialInterval?: BillingInterval;
  className?: string;
}) {
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);

  const sortedPlans = useMemo(
    () =>
      [...plans]
        .filter((p) => p.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [plans],
  );

  const hasAnnual = sortedPlans.some((p) => Boolean(p.prices[currency]?.year || p.prices.USD?.year));

  if (sortedPlans.length === 0) return null;

  return (
    <div className={cn("space-y-10", className)}>
      {/* Interval toggle */}
      {hasAnnual && (
        <div className="flex justify-center">
          <div className="inline-flex items-center rounded-2xl bg-ink-100 p-1.5 shadow-inner">
            <button
              type="button"
              onClick={() => setInterval("month")}
              className={cn(
                "rounded-xl px-5 py-2 text-sm font-semibold transition-all",
                interval === "month"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-600 hover:text-ink-900",
              )}
            >
              Monthly billing
            </button>
            <button
              type="button"
              onClick={() => setInterval("year")}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition-all",
                interval === "year"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-600 hover:text-ink-900",
              )}
            >
              <span>Annual billing</span>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">
                Save ~20%
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Plan cards grid */}
      <div
        className={cn(
          "grid items-stretch gap-8",
          sortedPlans.length >= 3
            ? "lg:grid-cols-3"
            : sortedPlans.length === 2
              ? "mx-auto max-w-4xl md:grid-cols-2"
              : "mx-auto max-w-md",
        )}
      >
        {sortedPlans.map((plan) => {
          const curr = currencyFor(plan, currency);
          const pricePoint = plan.prices[curr]?.[interval];
          const isFeatured = plan.badges.length > 0 && !plan.isFree;
          const bullets = bulletsForPlan(plan);

          return (
            <article
              key={plan.id}
              className={cn(
                "relative flex h-full flex-col justify-between rounded-3xl border bg-white p-8 transition-all shadow-soft",
                isFeatured
                  ? "border-brand-400 ring-2 ring-brand-300/60 shadow-lifted"
                  : "border-ink-200 hover:border-ink-300",
              )}
            >
              {plan.badges[0] && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-soft">
                  {plan.badges[0]}
                </span>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                  {plan.isFree ? "Free Account" : "Membership"}
                </p>
                <h3 className="mt-1 font-display text-2xl font-bold text-ink-900">{plan.name}</h3>
                {plan.tagline && <p className="mt-1 text-sm text-ink-500">{plan.tagline}</p>}

                {/* Price display */}
                <div className="mt-6 flex items-baseline gap-1.5 border-b border-ink-100 pb-6">
                  {plan.isFree || !pricePoint ? (
                    <span className="text-4xl font-extrabold text-ink-900">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-extrabold tabular-nums text-ink-900">
                        {formatMoney(pricePoint.amount, curr)}
                      </span>
                      <span className="text-sm font-medium text-ink-500">
                        /{interval === "month" ? "month" : "year"}
                      </span>
                    </>
                  )}
                </div>

                {/* Selling points */}
                <ul className="mt-6 space-y-3">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm text-ink-700">
                      <Check className="mt-0.5 size-4.5 shrink-0 text-brand-600" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Call to action */}
              <div className="mt-8">
                <Link
                  href={
                    plan.isFree
                      ? "/studio"
                      : `/studio?plan=${encodeURIComponent(plan.id)}&interval=${interval}`
                  }
                  className={cn(
                    "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-center text-sm font-semibold transition-all",
                    isFeatured
                      ? "bg-brand-600 text-white shadow-soft hover:bg-brand-700 hover:shadow-md"
                      : "border border-ink-200 bg-ink-50 text-ink-800 hover:border-ink-300 hover:bg-ink-100",
                  )}
                >
                  {plan.isFree ? "Start creating for free" : `Join ${plan.name}`}
                  {isFeatured && <Sparkles className="size-4" />}
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {/* Assurance note */}
      <div className="mx-auto max-w-2xl text-center text-sm text-ink-500">
        <p>
          Memberships are flexible with no commitment — cancel or switch plans anytime in your account.
          Sparks roll over monthly. Membership never automatically orders or ships physical books.
        </p>
      </div>
    </div>
  );
}
