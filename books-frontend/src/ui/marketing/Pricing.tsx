"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import type { BillingInterval, PublicPlan, PublicPlansConfig } from "../../core/config/plans";
import { formatMoney } from "../pricing/format";
import { Reveal } from "./Reveal";
import type { LandingPrintOffer, LandingPrintPricing } from "./printOffers";

const EMPTY_PRINT: LandingPrintPricing = {
  currency: "USD",
  taxInclusive: false,
  print: [],
  memberPlanName: null,
  ebook: null,
};

function currencyFor(plan: PublicPlan): string {
  if (plan.prices.USD) return "USD";
  return Object.keys(plan.prices)[0] ?? "USD";
}

/** Turn a plan's entitlements + grant into human-readable selling points. */
function bullets(plan: PublicPlan): string[] {
  const out: string[] = [];
  if (plan.grant.monthlySparks > 0) {
    out.push(`${plan.grant.monthlySparks.toLocaleString()} Sparks to create with every month`);
  }
  if (plan.grant.annualBonusSparks > 0) {
    out.push(`+${plan.grant.annualBonusSparks.toLocaleString()} bonus Sparks on annual`);
  }
  if (plan.entitlements.printDiscountPct > 0) {
    out.push(`${plan.entitlements.printDiscountPct}% off every print order`);
  }
  if (plan.isFree) {
    out.push("Make a complete book for free");
    out.push("Print anytime at standard price");
  }
  return out;
}

export function Pricing({
  initial,
  print = EMPTY_PRINT,
}: {
  initial: PublicPlansConfig;
  print?: LandingPrintPricing;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");

  const plans = useMemo(
    () =>
      [...initial.plans]
        .filter((p) => p.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [initial.plans],
  );

  const hasPrint = print.print.length > 0;
  const hasPlans = plans.length > 0;
  if (!hasPrint && !hasPlans) return null;

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="pricing-title" className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            {hasPrint ? "A real book, when you're ready" : "Flexible plans for bedtime storytellers"}
          </h2>
          <p className="mt-4 text-lg text-ink-600">
            {hasPrint
              ? "Create and preview for free. Order a paperback or hardcover anytime — membership is optional, and it never ships a book on its own."
              : "Start completely free. Create and order individual books anytime, or choose a membership for monthly story sparks and exclusive print discounts."}
          </p>
        </Reveal>

        {hasPrint && (
          <div
            className={cn(
              "mt-14 grid items-stretch gap-6",
              print.print.length > 1 ? "md:grid-cols-2" : "mx-auto max-w-lg",
            )}
          >
            {print.print.map((offer, i) => (
              <Reveal key={offer.id} delay={i * 0.05}>
                <PrintOfferCard offer={offer} print={print} />
              </Reveal>
            ))}
          </div>
        )}

        {hasPrint && (
          <div className="mt-6 space-y-2 text-center text-sm text-ink-500">
            <p>
              {print.taxInclusive
                ? "Print prices are per book, plus shipping, including VAT where it applies. Membership is billed separately."
                : "Print prices are per book, plus shipping. Membership is billed separately."}
            </p>
            <p>
              <Link
                href="/print-pricing"
                className="font-medium text-brand-700 underline-offset-4 hover:underline"
              >
                See exact price by pages and destination
              </Link>
            </p>
            {print.ebook && (
              <p>
                {print.ebook.printBundleDiscountPct > 0
                  ? `Also as a PDF from ${formatMoney(print.ebook.price, print.currency)}, or ${print.ebook.printBundleDiscountPct}% off when you order print.`
                  : `Also as a PDF from ${formatMoney(print.ebook.price, print.currency)}.`}
              </p>
            )}
          </div>
        )}

        {hasPlans && (
          <div className={cn(hasPrint ? "mt-16" : "mt-14")}>
            {hasPrint && (
              <Reveal className="mx-auto max-w-2xl text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Optional membership
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink-900">
                  Monthly story credits, and the member prices above
                </h3>
                <p className="mt-3 text-base text-ink-600">
                  For bedtime makers who want a fresh bundle of Sparks every month. Cancel anytime.
                </p>
                <div className="mt-6 flex justify-center">
                  <IntervalToggle interval={interval} onChange={setInterval} />
                </div>
              </Reveal>
            )}

            {!hasPrint && (
              <div className="mt-8 flex justify-center">
                <IntervalToggle interval={interval} onChange={setInterval} />
              </div>
            )}

            <div
              className={cn(
                "grid items-start gap-6",
                hasPrint ? "mt-10" : "mt-14",
                plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2" : "mx-auto max-w-md",
              )}
            >
              {plans.map((plan, i) => (
                <Reveal key={plan.id} delay={i * 0.05}>
                  <PlanCard plan={plan} interval={interval} compact={hasPrint} />
                </Reveal>
              ))}
            </div>

            <p className="mt-8 text-center text-sm text-ink-500">
              Membership renews monthly or yearly and can be cancelled anytime. It never sends books
              automatically.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PrintOfferCard({
  offer,
  print,
}: {
  offer: LandingPrintOffer;
  print: LandingPrintPricing;
}) {
  return (
    <article
      className={cn(
        "relative flex h-full flex-col rounded-3xl border bg-white p-7 shadow-soft",
        offer.featured ? "border-brand-300 ring-2 ring-brand-200" : "border-ink-200",
      )}
    >
      {offer.featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-(--color-brand-foreground) shadow-soft">
          Keepsake
        </span>
      )}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Printed book</p>
      <h3 className="text-lg font-bold text-ink-900">{offer.label}</h3>
      <p className="mt-1 text-sm text-ink-500">{offer.blurb}</p>

      <p className="mt-5 flex items-baseline gap-2">
        <span className="text-sm text-ink-500">From</span>
        <span className="text-4xl font-extrabold tabular-nums text-ink-900">
          {formatMoney(offer.fromPrice, print.currency)}
        </span>
      </p>
      {offer.memberFromPrice != null && print.memberPlanName && (
        <p className="mt-1.5 text-sm text-brand-700">
          From {formatMoney(offer.memberFromPrice, print.currency)} with {print.memberPlanName}
          {offer.memberDiscountPct > 0 ? ` · ${offer.memberDiscountPct}% off` : ""}
        </p>
      )}

      <p className="mt-4 text-sm text-ink-600">
        {offer.trim}
        <span className="text-ink-400"> · </span>
        from {offer.minPages} pages
      </p>

      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/studio"
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold transition",
            offer.featured
              ? "bg-brand-600 text-(--color-brand-foreground) shadow-soft hover:bg-brand-700"
              : "border border-ink-200 text-ink-700 hover:border-ink-300",
          )}
        >
          Start a {offer.label.toLowerCase()}
          {offer.featured && <Sparkles className="size-4" />}
        </Link>
        <Link
          href={offer.href}
          className="inline-flex items-center justify-center gap-1 rounded-2xl px-4 py-3 text-sm font-medium text-ink-500 transition hover:text-ink-800"
        >
          Details
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}

function PlanCard({
  plan,
  interval,
  compact,
}: {
  plan: PublicPlan;
  interval: BillingInterval;
  compact: boolean;
}) {
  const currency = currencyFor(plan);
  const price = plan.prices[currency]?.[interval];
  const featured = plan.badges.length > 0 && !plan.isFree;
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-3xl border bg-white shadow-soft",
        compact ? "p-6" : "p-7",
        featured ? "border-brand-300 ring-2 ring-brand-200" : "border-ink-200",
      )}
    >
      {plan.badges[0] && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-(--color-brand-foreground) shadow-soft">
          {plan.badges[0]}
        </span>
      )}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
        {plan.isFree ? "Free account" : "Membership"}
      </p>
      <h3 className="text-lg font-bold text-ink-900">{plan.name}</h3>
      {plan.tagline && <p className="mt-1 text-sm text-ink-500">{plan.tagline}</p>}

      <div className="mt-5 flex items-baseline gap-1">
        {plan.isFree || !price ? (
          <span className={cn("font-extrabold text-ink-900", compact ? "text-3xl" : "text-4xl")}>Free</span>
        ) : (
          <>
            <span className={cn("font-extrabold tabular-nums text-ink-900", compact ? "text-3xl" : "text-4xl")}>
              {formatMoney(price.amount, currency)}
            </span>
            <span className="text-sm text-ink-500">/{interval === "month" ? "mo" : "yr"}</span>
          </>
        )}
      </div>

      {!compact && plan.description && <p className="mt-3 text-sm text-ink-600">{plan.description}</p>}

      <ul className={cn("space-y-2.5", compact ? "mt-5" : "mt-6")}>
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
            ? "bg-brand-600 text-(--color-brand-foreground) shadow-soft hover:bg-brand-700"
            : "border border-ink-200 text-ink-700 hover:border-ink-300",
        )}
      >
        {plan.isFree ? "Start for free" : `Choose ${plan.name}`}
        {featured && <Sparkles className="size-4" />}
      </Link>
    </div>
  );
}

function IntervalToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (iv: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-ink-100 p-1">
      {(["month", "year"] as BillingInterval[]).map((iv) => (
        <button
          key={iv}
          type="button"
          onClick={() => onChange(iv)}
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
  );
}
