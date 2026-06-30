"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Sparkles, Settings, Loader2 } from "lucide-react";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { startSubscriptionCheckout, openBillingPortal } from "../../platform/payments";
import { findPublicPlanByPriceId, type BillingInterval, type PublicPlan } from "../../core/config/plans";
import { fmtMoney } from "../admin/tabs/products/parts";

/** Selling-point bullets derived from a plan's entitlements + grant. */
function planPerks(plan: PublicPlan, interval: BillingInterval): string[] {
  const out: string[] = [];
  const g = plan.grant;
  if (g.monthlySparks > 0) out.push(`${g.monthlySparks.toLocaleString()} Sparks every month`);
  if (interval === "year" && g.annualBonusSparks > 0)
    out.push(`+${g.annualBonusSparks.toLocaleString()} bonus Sparks up front`);
  const e = plan.entitlements;
  if (e.printDiscountPct > 0) out.push(`${e.printDiscountPct}% off printed books`);
  if (e.formats.length > 0) out.push(`${e.formats.length} premium format${e.formats.length === 1 ? "" : "s"}`);
  if (e.layouts.length > 0) out.push(`${e.layouts.length} premium layout${e.layouts.length === 1 ? "" : "s"}`);
  if (e.fonts.length > 0) out.push(`${e.fonts.length} extra font${e.fonts.length === 1 ? "" : "s"}`);
  if (e.removeWatermark) out.push("No watermark on shared books");
  for (const f of e.features) out.push(f);
  return out;
}

/**
 * The plans / upgrade screen. Renders the public plan catalog with a monthly /
 * annual toggle, marks the user's current plan, and starts Stripe Checkout for a
 * chosen plan (or opens the Customer Portal to manage an existing subscription).
 */
export function PlansDialog() {
  const open = useBillingUiStore((s) => s.plansOpen);
  const close = useBillingUiStore((s) => s.closePlans);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  const [interval, setInterval] = useState<BillingInterval>("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const active = subscriptions.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? null;
  const currentPlan = useMemo(
    () => findPublicPlanByPriceId(plans, active?.priceId ?? null),
    [plans, active?.priceId],
  );

  // Storefront plans, sorted; free first.
  const visible = plans
    .filter((p) => p.status === "active")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const hasAnnual = visible.some((p) => p.prices[baseCurrency]?.year);

  const subscribe = async (plan: PublicPlan) => {
    setBusy(plan.id);
    try {
      const { url } = await startSubscriptionCheckout({ planId: plan.id, interval, currency: baseCurrency });
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(null);
    }
  };

  const manage = async () => {
    setPortalBusy(true);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing.");
      setPortalBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Plans" size="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs leading-relaxed text-ink-500">
            Pick the plan that fits how much you create. Every plan includes a monthly bundle of Sparks
            (cheaper than buying packs) plus perks. Cancel anytime.
          </p>
          {hasAnnual && (
            <div className="inline-flex items-center rounded-full bg-ink-100 p-0.5 text-xs font-medium">
              {(["month", "year"] as BillingInterval[]).map((iv) => (
                <button
                  key={iv}
                  onClick={() => setInterval(iv)}
                  className={`rounded-full px-3 py-1 transition ${
                    interval === iv ? "bg-white text-ink-800 shadow-soft" : "text-ink-500 hover:text-ink-700"
                  }`}
                >
                  {iv === "month" ? "Monthly" : "Yearly"}
                  {iv === "year" && <span className="ml-1 text-emerald-600">save</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
              <Sparkles className="size-6" />
            </span>
            <p className="text-sm font-medium text-ink-700">No plans available yet</p>
            <p className="max-w-sm text-sm text-ink-500">Subscription plans haven&apos;t been published yet.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((plan) => {
              const price = plan.prices[baseCurrency]?.[interval];
              const isCurrent = currentPlan?.id === plan.id || (plan.isFree && !currentPlan);
              const perks = planPerks(plan, interval);
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col rounded-2xl border p-4 ${
                    isCurrent ? "border-brand-300 ring-1 ring-brand-200" : "border-ink-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-ink-900">{plan.name}</h3>
                      {plan.tagline && <p className="text-[11px] text-ink-400">{plan.tagline}</p>}
                    </div>
                    {plan.badges[0] && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
                        {plan.badges[0]}
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    {plan.isFree ? (
                      <span className="text-2xl font-bold text-ink-900">Free</span>
                    ) : price ? (
                      <span className="text-2xl font-bold text-ink-900">
                        {fmtMoney(price.amount, baseCurrency)}
                        <span className="text-xs font-normal text-ink-400">/{interval === "month" ? "mo" : "yr"}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-ink-400">Not available in {baseCurrency}</span>
                    )}
                  </div>

                  {plan.description && <p className="mt-2 text-xs leading-relaxed text-ink-500">{plan.description}</p>}

                  <ul className="mt-3 flex-1 space-y-1.5">
                    {perks.map((perk, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-ink-600">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                        {perk}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4">
                    {isCurrent ? (
                      <Button variant="secondary" size="sm" className="w-full" disabled>
                        Current plan
                      </Button>
                    ) : plan.isFree ? (
                      <Button variant="ghost" size="sm" className="w-full" disabled>
                        Included
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full"
                        loading={busy === plan.id}
                        disabled={!price?.priceId}
                        onClick={() => subscribe(plan)}
                      >
                        {currentPlan && !currentPlan.isFree ? "Switch" : "Choose"} {plan.name}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {active && currentPlan && !currentPlan.isFree && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-4 py-3">
            <p className="text-xs text-ink-600">
              You&apos;re on <span className="font-semibold text-ink-800">{currentPlan.name}</span>
              {active.cancelAtPeriodEnd && <span className="text-amber-600"> · cancels at period end</span>}.
            </p>
            <Button variant="secondary" size="sm" leftIcon={portalBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Settings className="size-3.5" />} onClick={manage} disabled={portalBusy}>
              Manage subscription
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Top-bar trigger for the plans dialog. Shows the current plan name when
 * subscribed, otherwise an "Upgrade" affordance. Hidden when no purchasable plan
 * is configured.
 */
export function PlansButton() {
  const open = useBillingUiStore((s) => s.openPlans);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  const hasPaidPlans = plans.some(
    (p) => p.status === "active" && !p.isFree && Object.keys(p.prices).length > 0,
  );
  if (!hasPaidPlans) return null;

  const active = subscriptions.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? null;
  const currentPlan = findPublicPlanByPriceId(plans, active?.priceId ?? null);

  return (
    <Button variant="ghost" size="sm" leftIcon={<Sparkles className="size-4" />} onClick={open}>
      {currentPlan && !currentPlan.isFree ? currentPlan.name : "Upgrade"}
    </Button>
  );
}
