"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import type { BillingInterval, PublicPlan, PublicPlansConfig } from "../../core/config/plans";
import { Reveal } from "./Reveal";

function fmtPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Pick the currency to show — prefer USD, else the first the plan offers. */
function currencyFor(plan: PublicPlan): string {
  if (plan.prices.USD) return "USD";
  return Object.keys(plan.prices)[0] ?? "USD";
}

/** Turn a plan's entitlements + grant into human-readable selling points. */
function bullets(plan: PublicPlan): string[] {
  const out: string[] = [];
  if (plan.grant.monthlySparks > 0) {
    out.push(`${plan.grant.monthlySparks.toLocaleString()} Sparks every month`);
  }
  if (plan.grant.annualBonusSparks > 0) {
    out.push(`+${plan.grant.annualBonusSparks.toLocaleString()} bonus Sparks on annual`);
  }
  if (plan.entitlements.printDiscountPct > 0) {
    out.push(`${plan.entitlements.printDiscountPct}% off every print order`);
  }
  if (plan.entitlements.removeWatermark) out.push("No watermark on shared books");
  if (plan.isFree) {
    out.push("Make a complete book for free");
    out.push("Print anytime at standard price");
  }
  return out;
}

export function Pricing({ initial }: { initial: PublicPlansConfig }) {
  const [interval, setInterval] = useState<BillingInterval>("month");

  const plans = useMemo(
    () =>
      [...initial.plans]
        .filter((p) => p.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [initial.plans],
  );

  if (plans.length === 0) return null;

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="pricing-title" className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            Simple plans that grow with your stories
          </h2>
          <p className="mt-4 text-lg text-ink-600">
            Start free. Upgrade for more Sparks, cheaper prints, and premium extras.
          </p>

          {/* Billing interval toggle */}
          <div className="mt-8 inline-flex rounded-xl bg-ink-100 p-1">
            {(["month", "year"] as BillingInterval[]).map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                  interval === iv ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 hover:text-ink-700",
                )}
              >
                {iv === "month" ? "Monthly" : "Yearly"}
                {iv === "year" && <span className="ml-1.5 text-xs font-semibold text-brand-600">Save more</span>}
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const currency = currencyFor(plan);
            const price = plan.prices[currency]?.[interval];
            const featured = plan.badges.length > 0 && !plan.isFree;
            return (
              <Reveal key={plan.id} delay={i * 0.05}>
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-3xl border bg-white p-7 shadow-soft",
                    featured ? "border-brand-300 ring-2 ring-brand-200" : "border-ink-200",
                  )}
                >
                  {plan.badges[0] && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white shadow-soft">
                      {plan.badges[0]}
                    </span>
                  )}
                  <h3 className="text-lg font-bold text-ink-900">{plan.name}</h3>
                  {plan.tagline && <p className="mt-1 text-sm text-ink-500">{plan.tagline}</p>}

                  <div className="mt-5 flex items-baseline gap-1">
                    {plan.isFree || !price ? (
                      <span className="text-4xl font-extrabold text-ink-900">Free</span>
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold text-ink-900">
                          {fmtPrice(price.amount, currency)}
                        </span>
                        <span className="text-sm text-ink-500">/{interval === "month" ? "mo" : "yr"}</span>
                      </>
                    )}
                  </div>

                  <p className="mt-3 text-sm text-ink-600">{plan.description}</p>

                  <ul className="mt-6 space-y-2.5">
                    {bullets(plan).map((b) => (
                      <li key={b} className="flex items-start gap-2 text-sm text-ink-700">
                        <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                        {b}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/studio"
                    className={cn(
                      "mt-7 inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold transition",
                      featured
                        ? "bg-brand-600 text-white shadow-soft hover:bg-brand-700"
                        : "border border-ink-200 text-ink-700 hover:border-ink-300",
                    )}
                  >
                    {plan.isFree ? "Start for free" : "Choose plan"}
                    {featured && <Sparkles className="size-4" />}
                  </Link>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="mt-8 text-center text-sm text-ink-500">
          Prices shown for reference. Manage your subscription anytime in the studio.
        </p>
      </div>
    </section>
  );
}
