"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Check, AlertCircle } from "lucide-react";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { useAppConfigStore } from "../../../state/appConfigStore";
import {
  BILLING_INTERVALS,
  createDefaultPlan,
  type PlanDefinition,
  type PlanStatus,
} from "../../../core/config/plans";
import type { SparksConfig } from "../../../core/config/sparks";
import {
  effectiveMarkup,
  grantLiabilityUsd,
  planSparkEconomics,
} from "../../../core/config/economics";
import { computeMargin } from "../../../core/config/productMath";
import type {
  CurrencyCode,
  PricingSettings,
  ProductDefinition,
} from "../../../core/config/products";
import { IMAGE_ACTIONS } from "../../../core/ai/actions";
import { FEATURES, featureGated } from "../../../core/config/features";
import { QUOTAS } from "../../../core/config/quotas";
import { useAdminTab } from "../adminTabStore";
import { Grid, ImpactNote, NumberField, Section, TabIntro, TextField, fmtMoney } from "./products/parts";

const STATUSES: { value: PlanStatus; label: string }[] = [
  { value: "draft", label: "Draft (hidden)" },
  { value: "active", label: "Active (live)" },
  { value: "retired", label: "Retired (hidden, subs kept)" },
];

const toList = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);
const fromList = (v: string[]): string => v.join(", ");

/**
 * Editor for **subscription plans**, synced to Stripe. The admin owns the
 * presentation, entitlements and the monthly Spark grant; saving a plan creates
 * or updates its Stripe Product + Prices. Editing an amount mints a new Stripe
 * Price and archives the old one (existing subscribers keep theirs).
 */
export function PlansTab() {
  const loadAdminPlans = useAppConfigStore((s) => s.loadAdminPlans);
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);
  const savePlan = useAppConfigStore((s) => s.savePlan);
  const deletePlanById = useAppConfigStore((s) => s.deletePlanById);
  const syncPlans = useAppConfigStore((s) => s.syncPlans);
  const currencies = useAppConfigStore((s) => s.pricingSettings.currencies);
  const pricingSettings = useAppConfigStore((s) => s.pricingSettings);
  const savePricingSettings = useAppConfigStore((s) => s.savePricingSettings);
  const sparksConfig = useAppConfigStore((s) => s.sparks);

  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [products, setProducts] = useState<ProductDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const config = await loadAdminPlans();
        setPlans(config.plans);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load plans.");
      } finally {
        setLoading(false);
      }
    })();
    // Full product definitions (incl. cost) for the break-even discount check.
    void loadAdminProducts()
      .then((config) => setProducts(config.products))
      .catch(() => {
        /* the impact panel just skips the discount check */
      });
  }, [loadAdminPlans, loadAdminProducts]);

  const update = (id: string, patch: Partial<PlanDefinition>) => {
    setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addPlan = () => {
    const p = createDefaultPlan({ sortOrder: plans.length });
    setPlans((ps) => [...ps, p]);
  };

  const onSave = async (
    plan: PlanDefinition,
    memberEbook: Record<string, number> | null,
    memberChanged: boolean,
  ) => {
    setSavingId(plan.id);
    try {
      const synced = await savePlan(plan);
      setPlans((ps) => ps.map((p) => (p.id === synced.id ? synced : p)));
      // The plan's member ebook price lives on the shared pricingSettings doc
      // (so the storefront + server quote read one source). Persist it here so
      // the plan editor is the single place to define everything a plan gives.
      if (memberChanged) {
        const cur = pricingSettings;
        const planPrices = { ...cur.ebook.planPrices };
        if (memberEbook) planPrices[plan.id] = memberEbook;
        else delete planPrices[plan.id];
        await savePricingSettings({ ...cur, ebook: { ...cur.ebook, planPrices } });
      }
      toast.success("Plan saved & synced to Stripe.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save plan.");
    } finally {
      setSavingId(null);
    }
  };

  const onDelete = async (id: string) => {
    try {
      const config = await deletePlanById(id);
      setPlans(config.plans);
      toast.success("Plan removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove plan.");
    }
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const config = await syncPlans();
      setPlans(config.plans);
      toast.success("All plans re-synced to Stripe.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sync.");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <p className="text-sm text-ink-400">Loading plans…</p>;

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            The digital-edition and Spark-pack products themselves are set up in the{" "}
            <span className="font-medium">Catalog</span>; here you only decide what each plan gives
            its members.
          </>
        }
      >
        <span className="font-medium">Memberships</span> are recurring subscriptions. Each plan
        bundles a monthly Spark grant, print discounts, unlocked features and a member price for the
        digital edition — everything a subscriber gets is defined on the plan below. You own the
        perks; Stripe owns the billing, and saving syncs the plan&apos;s Stripe product + prices.
      </TabIntro>

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="size-3.5" />} loading={syncing} onClick={onSync}>
          Sync all to Stripe
        </Button>
        <Button size="sm" leftIcon={<Plus className="size-3.5" />} onClick={addPlan}>
          New plan
        </Button>
      </div>

      <div className="space-y-3">
        {plans
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              allPlans={plans}
              currencies={currencies}
              saving={savingId === plan.id}
              sparksConfig={sparksConfig}
              pricingSettings={pricingSettings}
              products={products}
              onChange={(patch) => update(plan.id, patch)}
              onSave={(memberEbook, memberChanged) => onSave(plan, memberEbook, memberChanged)}
              onDelete={() => onDelete(plan.id)}
            />
          ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  allPlans,
  currencies,
  saving,
  sparksConfig,
  pricingSettings,
  products,
  onChange,
  onSave,
  onDelete,
}: {
  plan: PlanDefinition;
  allPlans: PlanDefinition[];
  currencies: string[];
  saving: boolean;
  sparksConfig: SparksConfig;
  pricingSettings: PricingSettings;
  products: ProductDefinition[];
  onChange: (patch: Partial<PlanDefinition>) => void;
  onSave: (memberEbook: Record<string, number> | null, memberChanged: boolean) => Promise<void>;
  onDelete: () => void;
}) {
  const ent = plan.entitlements;
  const grant = plan.grant;
  const openCatalog = useAdminTab((s) => s.openCatalog);

  // Member ebook price for THIS plan. `null` ⇒ no override (members pay the
  // regular ebook price). It lives on the shared pricingSettings doc, so it's
  // edited here as local state and persisted alongside the plan on Save.
  const ebook = pricingSettings.ebook;
  const [memberEbook, setMemberEbook] = useState<Record<string, number> | null>(
    () => ebook.planPrices[plan.id] ?? null,
  );
  const [memberDirty, setMemberDirty] = useState(false);
  // Re-sync from the live doc when it changes and we have no local edits.
  useEffect(() => {
    if (!memberDirty) setMemberEbook(ebook.planPrices[plan.id] ?? null);
  }, [ebook, plan.id, memberDirty]);

  const editMember = (next: Record<string, number> | null) => {
    setMemberEbook(next);
    setMemberDirty(true);
  };

  const handleSave = async () => {
    await onSave(memberEbook, memberDirty);
    setMemberDirty(false);
  };

  const setPrice = (currency: string, interval: "month" | "year", amount: number) => {
    const prices = { ...plan.billing.prices };
    const byInterval = { ...(prices[currency] ?? {}) };
    byInterval[interval] = { ...byInterval[interval], amount, stripePriceId: byInterval[interval]?.stripePriceId ?? null, active: true };
    prices[currency] = byInterval;
    onChange({ billing: { ...plan.billing, prices } });
  };

  return (
    <div className="space-y-3 rounded-xl bg-white p-3.5 ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={plan.presentation.name}
            onChange={(e) => onChange({ presentation: { ...plan.presentation, name: e.target.value } })}
            className="w-48 font-semibold"
          />
          {plan.isFree && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">FREE</span>}
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-400">
            {plan.billing.stripeProductId ? (
              <><Check className="size-3 text-emerald-500" /> Synced</>
            ) : plan.isFree ? (
              "No billing"
            ) : (
              <><AlertCircle className="size-3 text-amber-500" /> Not synced</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={plan.status}
            options={STATUSES}
            className="w-44"
            onChange={(e) => onChange({ status: e.target.value as PlanStatus })}
          />
          {!plan.isFree && (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={onDelete} />
          )}
          <Button size="sm" loading={saving} onClick={handleSave}>Save</Button>
        </div>
      </div>

      <Grid cols={2}>
        <TextField label="Tagline" value={plan.presentation.tagline ?? ""} onChange={(v) => onChange({ presentation: { ...plan.presentation, tagline: v } })} />
        <NumberField label="Sort order" value={plan.sortOrder} step="1" onChange={(n) => onChange({ sortOrder: n })} />
      </Grid>
      <Field label="Description">
        <Textarea
          rows={2}
          value={plan.presentation.description}
          onChange={(e) => onChange({ presentation: { ...plan.presentation, description: e.target.value } })}
        />
      </Field>

      <Section title="Sparks granted" hint="Sparks delivered on each paid invoice (every renewal). The annual bonus is a one-time reward added on a yearly invoice. Rollover caps carried balance at this multiple of the monthly grant (0 = unlimited).">
        <Grid cols={3}>
          <NumberField label="Monthly Sparks" value={grant.monthlySparks} step="10" suffix="✦" onChange={(n) => onChange({ grant: { ...grant, monthlySparks: n } })} />
          <NumberField label="Annual bonus" value={grant.annualBonusSparks} step="10" suffix="✦" onChange={(n) => onChange({ grant: { ...grant, annualBonusSparks: n } })} />
          <NumberField label="Rollover ×" value={grant.rolloverMultiple} step="1" suffix="×" onChange={(n) => onChange({ grant: { ...grant, rolloverMultiple: n } })} />
        </Grid>
      </Section>

      <Section title="Perks" hint="What this plan unlocks. Print discount is capped by each product's break-even at checkout. Lists are comma-separated ids.">
        <Grid cols={2}>
          <NumberField label="Print discount" value={ent.printDiscountPct} step="1" suffix="%" onChange={(n) => onChange({ entitlements: { ...ent, printDiscountPct: n } })} />
          <div className="flex items-center gap-2 pt-6">
            <Toggle checked={ent.removeWatermark} onChange={(v) => onChange({ entitlements: { ...ent, removeWatermark: v } })} label="Remove watermark" />
            <span className="text-sm text-ink-600">Remove shared-page watermark</span>
          </div>
        </Grid>
        <Grid cols={2}>
          <TextField label="Formats (product ids)" value={fromList(ent.formats)} onChange={(v) => onChange({ entitlements: { ...ent, formats: toList(v) } })} />
          <TextField label="Layouts" value={fromList(ent.layouts)} onChange={(v) => onChange({ entitlements: { ...ent, layouts: toList(v) } })} />
          <TextField label="Fonts" value={fromList(ent.fonts)} onChange={(v) => onChange({ entitlements: { ...ent, fonts: toList(v) } })} />
        </Grid>
      </Section>

      <Section
        title="Gated features"
        hint="A feature checked on ANY active plan becomes subscriber-gated: only plans that include it may use it (check it on the free plan to give it to everyone). Unchecked everywhere = free for all users."
      >
        <div className="space-y-1.5">
          {FEATURES.map((f) => {
            const on = ent.features.includes(f.id);
            const gatedSomewhere = featureGated(allPlans, f.id);
            return (
              <div key={f.id} className="flex items-start gap-2.5 rounded-lg bg-ink-50/50 p-2.5 ring-1 ring-inset ring-ink-100">
                <Toggle
                  checked={on}
                  onChange={(v) =>
                    onChange({
                      entitlements: {
                        ...ent,
                        features: v ? [...ent.features, f.id] : ent.features.filter((x) => x !== f.id),
                      },
                    })
                  }
                  label={f.label}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
                    {f.label}
                    <span
                      className={
                        gatedSomewhere
                          ? "rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                          : "rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                      }
                    >
                      {gatedSomewhere ? "gated — only checked plans" : "free for everyone"}
                    </span>
                  </div>
                  <p className="text-xs text-ink-500">{f.description}</p>
                </div>
              </div>
            );
          })}
          {ent.features.filter((id) => !FEATURES.some((f) => f.id === id)).length > 0 && (
            <TextField
              label="Custom feature keys"
              value={fromList(ent.features.filter((id) => !FEATURES.some((f) => f.id === id)))}
              onChange={(v) =>
                onChange({
                  entitlements: {
                    ...ent,
                    features: [...ent.features.filter((id) => FEATURES.some((f) => f.id === id)), ...toList(v)],
                  },
                })
              }
            />
          )}
        </div>
      </Section>

      <Section title="Usage limits" hint="Caps the backend enforces for this plan. Set -1 (or leave at -1) for unlimited. Example: set “AI edits per book” to 2 on the free plan.">
        <Grid cols={2}>
          {QUOTAS.map((q) => (
            <NumberField
              key={q.id}
              label={q.label}
              value={typeof ent.limits[q.id] === "number" ? ent.limits[q.id] : -1}
              step="1"
              min={-1}
              onChange={(n) =>
                onChange({ entitlements: { ...ent, limits: { ...ent.limits, [q.id]: Math.trunc(n) } } })
              }
            />
          ))}
        </Grid>
      </Section>

      {!plan.isFree && (
        <Section title="Pricing" hint="Per-currency monthly & annual price. Tip: price annual at ~10 months so the year is cheaper than monthly. Editing an amount mints a new Stripe price on save.">
          <div className="space-y-2">
            {currencies.map((c) => {
              const byInterval = plan.billing.prices[c] ?? {};
              return (
                <div key={c} className="rounded-lg bg-ink-50/50 p-2.5 ring-1 ring-inset ring-ink-100">
                  <div className="mb-1.5 text-xs font-semibold text-ink-700">{c}</div>
                  <Grid cols={2}>
                    {BILLING_INTERVALS.map((interval) => (
                      <NumberField
                        key={interval}
                        label={interval === "month" ? "Per month" : "Per year"}
                        value={byInterval[interval]?.amount ?? 0}
                        step="0.5"
                        suffix={c}
                        onChange={(n) => setPrice(c, interval, n)}
                      />
                    ))}
                  </Grid>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {!plan.isFree && (
      <Section
        title="Digital edition for members"
        hint="What members of this plan pay for the ebook — a headline perk. Set it below the regular price, or make it free, to drive subscriptions."
      >
        {!ebook.enabled ? (
          <ImpactNote>
            The digital edition isn&apos;t on sale yet, so member pricing has no effect. Turn it on
            under Catalog → Digital edition first.{" "}
            <button
              type="button"
              onClick={() => openCatalog("ebook")}
              className="font-semibold underline"
            >
              Open the digital edition
            </button>
            .
          </ImpactNote>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Toggle
                checked={memberEbook != null}
                onChange={(v) =>
                  editMember(v ? Object.fromEntries(currencies.map((c) => [c, 0])) : null)
                }
                label="Special ebook price for this plan"
              />
              <span className="text-sm text-ink-600">
                {memberEbook != null ? "Members get a special price" : "Members pay the regular price"}
              </span>
            </div>
            {memberEbook == null ? (
              <p className="text-[11px] text-ink-400">
                Members on this plan buy the digital edition at the regular price
                {currencies.length > 0
                  ? ` (${currencies
                      .map((c) => fmtMoney(ebook.prices[c] ?? 0, c))
                      .join(" · ")})`
                  : ""}
                .
              </p>
            ) : (
              <>
                <Grid cols={4}>
                  {currencies.map((c) => (
                    <NumberField
                      key={c}
                      label={`Member price (${c})`}
                      value={memberEbook[c] ?? 0}
                      step="0.5"
                      suffix={c}
                      onChange={(n) => editMember({ ...memberEbook, [c]: n })}
                    />
                  ))}
                </Grid>
                <ImpactNote>
                  Set a currency to <span className="font-semibold">0</span> to include the digital
                  edition <span className="font-semibold">free</span> with this plan — it&apos;s
                  granted instantly with no checkout. Any amount above 0 is what members pay instead
                  of the regular price ({currencies.map((c) => fmtMoney(ebook.prices[c] ?? 0, c)).join(" · ")}).
                </ImpactNote>
              </>
            )}
          </>
        )}
      </Section>
      )}

      <Section title="Spark discounts" hint="Optional per-action Spark multiplier for subscribers on this plan (e.g. 0.5 = half-price re-rolls). Leave at 1 for no discount.">
        <Grid cols={3}>
          {IMAGE_ACTIONS.map((a) => (
            <NumberField
              key={a.id}
              label={a.label}
              value={plan.actionMultipliers[a.id] ?? 1}
              step="0.1"
              suffix="×"
              onChange={(n) => onChange({ actionMultipliers: { ...plan.actionMultipliers, [a.id]: n } })}
            />
          ))}
        </Grid>
      </Section>

      <PlanImpact
        plan={plan}
        sparksConfig={sparksConfig}
        pricingSettings={pricingSettings}
        products={products}
      />
    </div>
  );
}

/**
 * "What this plan means for the business" — a live impact table + warnings
 * under each plan editor, recomputed as the admin types. Advisory only;
 * enforcement (e.g. the break-even clamp on print discounts) lives at checkout.
 */
function PlanImpact({
  plan,
  sparksConfig,
  pricingSettings,
  products,
}: {
  plan: PlanDefinition;
  sparksConfig: SparksConfig;
  pricingSettings: PricingSettings;
  products: ProductDefinition[];
}) {
  const currency = pricingSettings.baseCurrency;
  const monthlyPrice = plan.billing.prices[currency]?.month?.amount ?? 0;
  const yearlyPrice = plan.billing.prices[currency]?.year?.amount ?? 0;
  const grant = plan.grant;

  const monthly = planSparkEconomics(sparksConfig, monthlyPrice, grant.monthlySparks);
  const annualSparks = grant.monthlySparks * 12 + grant.annualBonusSparks;
  const annualLiability = grantLiabilityUsd(sparksConfig, annualSparks);

  // Products whose thinnest-margin configuration can't afford this plan's
  // print discount (checkout clamps to break-even, so subscribers would see a
  // smaller discount than advertised — better to fix the price or the promise).
  const overDiscounted = plan.entitlements.printDiscountPct > 0
    ? products
        .filter((p) => p.status === "active")
        .map((p) => {
          try {
            const be = Math.min(
              ...[p.conditions.pages.min, p.conditions.pages.max].map(
                (pages) =>
                  computeMargin(p, { currency: currency as CurrencyCode, pages, copies: 1 }, pricingSettings)
                    .breakEvenDiscountPct,
              ),
            );
            return { name: p.presentation.name, breakEven: Math.round(be * 10) / 10 };
          } catch {
            return null;
          }
        })
        .filter((x): x is { name: string; breakEven: number } => x !== null)
        .filter((x) => plan.entitlements.printDiscountPct > x.breakEven)
    : [];

  // Multipliers that push the effective markup below cost (or razor-thin).
  const riskyMultipliers = IMAGE_ACTIONS.map((a) => ({
    label: a.label,
    m: plan.actionMultipliers[a.id] ?? 1,
    eff: effectiveMarkup(sparksConfig, plan.actionMultipliers[a.id] ?? 1),
  })).filter((x) => x.m !== 1 && x.eff < 1.2);

  const liabilityTone =
    !plan.isFree && monthlyPrice > 0 && monthly.liabilityPctOfPrice > 50
      ? "text-rose-600"
      : "text-ink-800";

  return (
    <Section
      title="Business impact"
      hint="Live read-out of what this configuration means for your margin, assuming the subscriber spends every granted Spark (the worst case — real usage is lower)."
    >
      <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100">
        <table className="w-full text-xs">
          <tbody>
            {!plan.isFree && (
              <tr className="border-b border-ink-50">
                <td className="bg-ink-50/50 px-3 py-2 font-medium text-ink-700">Monthly grant liability</td>
                <td className={`px-3 py-2 font-semibold ${liabilityTone}`}>
                  {fmtMoney(monthly.monthlyLiabilityUsd, currency)}
                  {monthlyPrice > 0 && ` (${monthly.liabilityPctOfPrice}% of ${fmtMoney(monthlyPrice, currency)})`}
                </td>
                <td className="px-3 py-2 text-ink-400">
                  {monthlyPrice > 0
                    ? monthly.liabilityPctOfPrice > 50
                      ? "Over 50% — a heavy spender leaves little for fees, discounts and profit."
                      : `Leaves ${fmtMoney(monthly.monthlyHeadroomUsd, currency)}/mo headroom before Stripe fees & print-discount subsidies.`
                    : "Set a monthly price to see the ratio."}
                </td>
              </tr>
            )}
            {!plan.isFree && (
              <tr className="border-b border-ink-50">
                <td className="bg-ink-50/50 px-3 py-2 font-medium text-ink-700">Annual grant liability</td>
                <td className="px-3 py-2 font-semibold text-ink-800">
                  {fmtMoney(annualLiability, currency)}
                  {yearlyPrice > 0 &&
                    ` (${Math.round((annualLiability / yearlyPrice) * 1000) / 10}% of ${fmtMoney(yearlyPrice, currency)})`}
                </td>
                <td className="px-3 py-2 text-ink-400">
                  {annualSparks.toLocaleString()} ✦/yr — annual invoices grant 12× the monthly Sparks
                  {grant.annualBonusSparks > 0 ? " plus the bonus" : ""}.
                </td>
              </tr>
            )}
            <tr className="border-b border-ink-50 last:border-0">
              <td className="bg-ink-50/50 px-3 py-2 font-medium text-ink-700">Effective Spark price</td>
              <td className="px-3 py-2 font-semibold text-ink-800">
                {plan.isFree || grant.monthlySparks <= 0 || monthlyPrice <= 0
                  ? "—"
                  : `${fmtMoney(monthly.effectivePricePerSpark, currency)}/✦`}
              </td>
              <td className="px-3 py-2 text-ink-400">
                {plan.isFree || grant.monthlySparks <= 0 || monthlyPrice <= 0
                  ? "Free plan / no grant — nothing to compare."
                  : `vs the ${fmtMoney(sparksConfig.sparkValueUsd, currency)} peg — subscribers should get Sparks a bit cheaper than packs, but not below your provider backing of ${fmtMoney(sparksConfig.sparkValueUsd / Math.max(sparksConfig.markupMultiplier, 1), currency)}/✦.`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {overDiscounted.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Print discount exceeds break-even:</span>{" "}
          {overDiscounted.map((p) => `${p.name} (break-even ${p.breakEven}%)`).join(", ")}. Checkout
          clamps the discount so you never sell at a loss, but subscribers will get less than the
          advertised {plan.entitlements.printDiscountPct}% — raise the retail price or lower the
          discount.
        </div>
      )}

      {riskyMultipliers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Spark discounts near/below cost:</span>{" "}
          {riskyMultipliers
            .map((x) => `${x.label} (${x.m}× ⇒ effective markup ${x.eff}×)`)
            .join(", ")}
          . Below 1× every render loses money; below ~1.2× it barely covers overhead.
        </div>
      )}
    </Section>
  );
}
