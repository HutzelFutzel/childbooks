/**
 * A membership nudge that names a real, configured saving.
 *
 * Two rules keep this from being noise. It never appears for someone who
 * already subscribes, and it never appears unless the catalog actually gives
 * members a better price in the context being shown — the numbers come from
 * `planPrintDiscountPct` and `ebook.planPrices`, so a plan configured with no
 * perk simply doesn't get advertised.
 *
 * Placement is the other half. Inline (`variant="inline"`) it's one quiet line
 * that never adds a step to a purchase in progress; on a confirmation screen
 * (`variant="card"`) it's the standard post-purchase offer, which can't
 * cannibalise a sale that already closed.
 */
import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { findPublicPlanByPriceId, type PublicPlan } from "../../core/config/plans";
import { ebookPlanPrice, type CurrencyCode } from "../../core/config/products";
import { activeSubscription } from "../../platform/subscriptions";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { Button } from "../components/Button";
import { cn } from "../lib/cn";

export type UpsellContext = "print" | "ebook" | "sparks";

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** The cheapest monthly price a plan publishes in this currency, if any. */
function monthlyPrice(plan: PublicPlan, currency: string): number | null {
  const amount = plan.prices[currency]?.month?.amount;
  return typeof amount === "number" && amount > 0 ? amount : null;
}

interface Offer {
  plan: PublicPlan;
  monthly: number;
  /** The saving, phrased for the context it's shown in. */
  benefit: string;
}

/**
 * The best offer to make in this context, or null when there's nothing honest
 * to say. "Best" is the biggest saving; ties go to the cheaper plan.
 */
function useOffer(context: UpsellContext, currency: CurrencyCode): Offer | null {
  const publicPlans = useAppConfigStore((s) => s.plans.plans);
  const publicProducts = useAppConfigStore((s) => s.products.products);
  const ebookSettings = useAppConfigStore((s) => s.pricingSettings.ebook);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  return useMemo(() => {
    // Already a member: there is no upgrade to sell them here.
    const sub = activeSubscription(subscriptions);
    const current = sub ? findPublicPlanByPriceId(publicPlans, sub.priceId) : null;
    if (current && !current.isFree) return null;

    const candidates = publicPlans.filter((p) => !p.isFree && p.status === "active");
    const offers: (Offer & { weight: number })[] = [];

    for (const plan of candidates) {
      const monthly = monthlyPrice(plan, currency);
      if (monthly == null) continue;

      if (context === "ebook") {
        const list = ebookSettings.prices[currency] ?? 0;
        const planPrice = ebookPlanPrice(ebookSettings, plan.id, currency);
        if (list <= 0 || planPrice == null || planPrice >= list) continue;
        offers.push({
          plan,
          monthly,
          weight: list - planPrice,
          benefit:
            planPrice === 0
              ? "digital editions included"
              : `digital editions at ${money(planPrice, currency)} instead of ${money(list, currency)}`,
        });
        continue;
      }

      if (context === "print") {
        // The deepest discount this plan gets on anything we actually sell.
        // These are already clamped to break-even in the catalog projection, so
        // the number can only under-promise.
        const pct = Math.max(
          0,
          ...publicProducts.map((p) => p.planPrintDiscountPct[plan.id] ?? 0),
        );
        if (pct <= 0) continue;
        offers.push({ plan, monthly, weight: pct, benefit: `${pct}% off every printed book` });
        continue;
      }

      const sparks = plan.grant.monthlySparks;
      if (sparks <= 0) continue;
      offers.push({
        plan,
        monthly,
        weight: sparks,
        benefit: `${sparks.toLocaleString()} Sparks every month`,
      });
    }

    if (offers.length === 0) return null;
    offers.sort((a, b) => b.weight - a.weight || a.monthly - b.monthly);
    const { plan, monthly, benefit } = offers[0];
    return { plan, monthly, benefit };
  }, [context, currency, publicPlans, publicProducts, ebookSettings, subscriptions]);
}

export function PlanUpsell({
  context,
  variant = "card",
  className,
}: {
  context: UpsellContext;
  variant?: "card" | "inline";
  className?: string;
}) {
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const offer = useOffer(context, baseCurrency);
  if (!offer) return null;

  const { plan, monthly, benefit } = offer;

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={openPlans}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-xs text-ink-500 transition hover:text-brand-600",
          className,
        )}
      >
        <Sparkles className="size-3.5 shrink-0 text-brand-400" />
        <span>
          {plan.name} members get {benefit} — from {money(monthly, baseCurrency)}/mo.{" "}
          <span className="font-medium underline decoration-ink-300 underline-offset-2">
            See plans
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-brand-100 bg-brand-50/60 px-4 py-3",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-(--color-brand-foreground)">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-800">Making more books?</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
          {plan.name} members get {benefit}, from {money(monthly, baseCurrency)} a month. Cancel
          whenever you like.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={openPlans}>
        See plans
      </Button>
    </div>
  );
}
