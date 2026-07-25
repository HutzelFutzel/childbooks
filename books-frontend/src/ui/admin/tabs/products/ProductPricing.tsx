"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, RefreshCw, Ruler, Trash2, Wand2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Select } from "../../../components/Select";
import type {
  CurrencyCode,
  PageTier,
  PricingSettings,
  ProductDefinition,
  ProductsConfig,
} from "../../../../core/config/products";
import {
  computeMargin,
  feeFor,
  feePercent,
  suggestTierPrice,
  type MarginBreakdown,
} from "../../../../core/config/productMath";
import {
  cheapestVariant,
  enumerateVariants,
  parseVariantKey,
  sameVariant,
  variantAllowed,
  variantKey,
  variantPriceDelta,
  variantSummary,
} from "../../../../core/config/variants";
import { variantFromSku } from "../../../../core/fulfillment/lulu/skuAxes";
import { useAdminHealth } from "../../../../state/adminHealthStore";
import type { CalibrationOutcome } from "../../../../state/appConfigStore";
import { Slider } from "../../../components/Slider";
import {
  buyerContextsFromPublicPlans,
  eligibleBuyers,
  printImpactFromBreakdown,
  printWorstCaseImpact,
} from "../../../../core/config/discountImpact";
import { useAppConfigStore, type MarginPreview } from "../../../../state/appConfigStore";
import { Grid, NumberField, Section, fmtMoney } from "./parts";

type Update = (fn: (p: ProductDefinition) => ProductDefinition) => void;

// ---- Cost (its own tab) ----------------------------------------------------

export function CostSection({
  product,
  update,
  dirty,
  onCalibrated,
}: {
  product: ProductDefinition;
  update: Update;
  dirty: boolean;
  onCalibrated: (config: ProductsConfig) => void;
}) {
  const cost = product.cost;
  const setCost = (patch: Partial<ProductDefinition["cost"]>) =>
    update((p) => ({ ...p, cost: { ...p.cost, ...patch } }));
  const setTable = (patch: Partial<ProductDefinition["cost"]["table"]>) =>
    update((p) => ({ ...p, cost: { ...p.cost, table: { ...p.cost.table, ...patch } } }));

  return (
    <div className="space-y-3">
      <CalibrateCard product={product} dirty={dirty} onCalibrated={onCalibrated} />
      <Section
        title="What it costs you"
        hint="With a live quote, the margin info uses the provider's real per-book + shipping cost. The estimate below is the offline fallback used until you fetch one."
      >
        <Grid cols={2}>
          <Field label="Cost basis">
            <Select
              value={cost.source}
              options={[
                { value: "providerLive", label: "Live quote from provider" },
                { value: "table", label: "Manual estimate (below)" },
              ]}
              onChange={(e) => setCost({ source: e.target.value as typeof cost.source })}
            />
          </Field>
          <Field label="Cost currency">
            <Input value={cost.currency} onChange={(e) => setCost({ currency: e.target.value.toUpperCase() })} />
          </Field>
        </Grid>
      </Section>

      <Section title="Cost estimate" hint="Per book: a base cost plus a per-page cost.">
        <Grid cols={2}>
          <NumberField label="Base cost per book" value={cost.table.basePerUnit} step="0.01" onChange={(n) => setTable({ basePerUnit: n })} suffix={cost.currency} />
          <NumberField label="Cost per page" value={cost.table.perPage} step="0.001" onChange={(n) => setTable({ perPage: n })} suffix={cost.currency} />
        </Grid>
      </Section>

      <Section
        title="Volume cost discounts"
        hint="Provider discounts on the per-book cost at higher quantities."
        action={
          <Button variant="ghost" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={() => setTable({ quantityBreaks: [...cost.table.quantityBreaks, { minQty: 2, unitDiscountPct: 0 }] })}>
            Add
          </Button>
        }
      >
        {cost.table.quantityBreaks.length === 0 ? (
          <p className="text-[11px] text-ink-400">None.</p>
        ) : (
          cost.table.quantityBreaks.map((b, i) => (
            <Grid key={i} cols={3}>
              <NumberField label="From this quantity" value={b.minQty} onChange={(n) => setTable({ quantityBreaks: cost.table.quantityBreaks.map((x, idx) => (idx === i ? { ...x, minQty: n } : x)) })} />
              <NumberField label="Cost discount" value={b.unitDiscountPct} step="0.1" suffix="%" onChange={(n) => setTable({ quantityBreaks: cost.table.quantityBreaks.map((x, idx) => (idx === i ? { ...x, unitDiscountPct: n } : x)) })} />
              <div className="flex items-end">
                <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setTable({ quantityBreaks: cost.table.quantityBreaks.filter((_, idx) => idx !== i) })}>
                  Remove
                </Button>
              </div>
            </Grid>
          ))
        )}
      </Section>

      <Section
        title="Extra costs"
        hint="Costs the provider quote doesn't include (packaging, handling, inserts)."
        action={
          <Button variant="ghost" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={() => setCost({ surcharges: [...cost.surcharges, { label: "Packaging", kind: "perOrder", amount: 0, currency: cost.currency }] })}>
            Add
          </Button>
        }
      >
        {cost.surcharges.length === 0 ? (
          <p className="text-[11px] text-ink-400">None.</p>
        ) : (
          cost.surcharges.map((s, i) => {
            const patch = (p: Partial<typeof s>) => setCost({ surcharges: cost.surcharges.map((x, idx) => (idx === i ? { ...x, ...p } : x)) });
            return (
              <Grid key={i} cols={4}>
                <Field label="Label">
                  <Input value={s.label} onChange={(e) => patch({ label: e.target.value })} />
                </Field>
                <Field label="Applies">
                  <Select value={s.kind} options={[{ value: "perOrder", label: "Per order" }, { value: "perUnit", label: "Per book" }]} onChange={(e) => patch({ kind: e.target.value as typeof s.kind })} />
                </Field>
                <NumberField label="Amount" value={s.amount} step="0.01" suffix={s.currency} onChange={(n) => patch({ amount: n })} />
                <div className="flex items-end">
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setCost({ surcharges: cost.surcharges.filter((_, idx) => idx !== i) })}>
                    Remove
                  </Button>
                </div>
              </Grid>
            );
          })
        )}
      </Section>
    </div>
  );
}

/**
 * Derive the cost table from the provider rather than typing it in. Runs
 * against the SAVED product (the backend probes and writes), so unsaved edits
 * have to be committed first.
 */
function CalibrateCard({
  product,
  dirty,
  onCalibrated,
}: {
  product: ProductDefinition;
  dirty: boolean;
  onCalibrated: (config: ProductsConfig) => void;
}) {
  const calibrateProductCost = useAppConfigStore((s) => s.calibrateProductCost);
  const runtime = useAdminHealth((s) => s.runtime);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CalibrationOutcome["result"] | null>(null);

  if (product.provider.id !== "lulu") return null;

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await calibrateProductCost(product.id, runtime?.env);
      setResult(outcome.result);
      if (outcome.result.ok) {
        onCalibrated(outcome.config);
        toast.success("Cost derived from live provider quotes.");
        if (outcome.result.message) toast.warning(outcome.result.message);
      } else {
        toast.error(outcome.result.message ?? "Calibration failed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Calibration failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Measure cost from the provider"
      hint="Prices this SKU at both ends of its page range and fits the line, then checks the midpoint to be sure the fit holds. Fills in the base + per-page cost and the fallback shipping rate."
      action={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Ruler className="size-3.5" />}
          loading={busy}
          disabled={dirty || !product.provider.sku.trim()}
          title={dirty ? "Save your changes first — this runs against the saved product." : undefined}
          onClick={run}
        >
          Measure against {runtime?.env ?? "provider"}
        </Button>
      }
    >
      {result && (
        <div className="space-y-1.5 text-xs">
          {result.samples.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-[280px] text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="pr-4 text-left font-medium">Pages</th>
                    <th className="pr-4 text-left font-medium">Copies</th>
                    <th className="text-left font-medium">Cost / book</th>
                  </tr>
                </thead>
                <tbody className="text-ink-600">
                  {result.samples.map((s, i) => (
                    <tr key={i}>
                      <td className="pr-4">{s.pages}</td>
                      <td className="pr-4">{s.copies}</td>
                      <td>{fmtMoney(s.unitCost, result.currency ?? "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.fitResidual != null && (
            <p className="text-ink-500">
              Midpoint check: off by {fmtMoney(result.fitResidual, result.currency ?? "USD")}.
            </p>
          )}
          {result.discoveredPages && (
            <p className="text-ink-500">
              Provider allows {result.discoveredPages.min}–{result.discoveredPages.max} pages.
            </p>
          )}
          {result.message && (
            <p className={result.ok ? "text-amber-700" : "text-red-600"}>{result.message}</p>
          )}
        </div>
      )}
    </Section>
  );
}

// ---- Page-tier price table (the only pricing input) ------------------------

function TierTable({
  product,
  update,
  settings,
}: {
  product: ProductDefinition;
  update: Update;
  settings: PricingSettings;
}) {
  const tiers = product.pricing.tiers;
  const currencies = settings.currencies;

  const setTiers = (next: PageTier[]) => update((p) => ({ ...p, pricing: { ...p.pricing, tiers: next } }));
  const patchTier = (i: number, patch: Partial<PageTier>) => setTiers(tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const setPrice = (i: number, c: CurrencyCode, v: number) =>
    setTiers(tiers.map((t, idx) => (idx === i ? { ...t, prices: { ...t.prices, [c]: v } } : t)));

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const start = last ? last.maxPages + 1 : product.conditions.pages.min;
    const prices: Record<string, number> = {};
    for (const c of currencies) prices[c] = last?.prices[c] ?? 0;
    setTiers([...tiers, { minPages: start, maxPages: start + 40, prices }]);
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-separate border-spacing-y-1.5 text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-ink-400">
              <th className="w-20 font-medium">Pages from</th>
              <th className="w-20 font-medium">to</th>
              {currencies.map((c) => (
                <th key={c} className="font-medium">
                  {c} price
                  <span className="ml-1 font-normal normal-case text-ink-300">
                    {settings.tax.perCurrency[c]?.behavior === "inclusive" ? "(incl. tax)" : "(+ tax)"}
                  </span>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i}>
                <td className="pr-2">
                  <Input type="number" min={0} value={String(t.minPages)} onChange={(e) => patchTier(i, { minPages: Number(e.target.value) || 0 })} className="h-9" />
                </td>
                <td className="pr-2">
                  <Input type="number" min={0} value={String(t.maxPages)} onChange={(e) => patchTier(i, { maxPages: Number(e.target.value) || 0 })} className="h-9" />
                </td>
                {currencies.map((c) => (
                  <td key={c} className="pr-2">
                    <div className="relative">
                      <Input type="number" min={0} step="0.01" value={String(t.prices[c] ?? 0)} onChange={(e) => setPrice(i, c, Number(e.target.value) || 0)} className="h-9 pr-9" />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-400">{c}</span>
                    </div>
                  </td>
                ))}
                <td>
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setTiers(tiers.filter((_, idx) => idx !== i))} aria-label="Remove row" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" size="sm" leftIcon={<Plus className="size-4" />} onClick={addTier}>
          Add page range
        </Button>
      </div>
    </div>
  );
}

// ---- Margin planner --------------------------------------------------------

/**
 * The highest margin this fee and tax structure can ever produce, whatever the
 * price. Margin tops out at `1 − (1 + taxRate)·feePercent` as the price grows,
 * so targets above that have no answer — the slider stops short of the tightest
 * currency's ceiling instead of letting the admin drag into a dead zone.
 */
function maxTargetMargin(settings: PricingSettings): number {
  let cap = 95;
  for (const currency of settings.currencies) {
    const rate = Math.max(0, settings.tax.perCurrency[currency]?.assumedRatePct ?? 0) / 100;
    const ceiling = (1 - (1 + rate) * feePercent(feeFor(settings, currency))) * 100;
    cap = Math.min(cap, Math.floor(ceiling) - 1);
  }
  return Math.max(1, cap);
}

/**
 * Every tier repriced for a target margin.
 *
 * Each tier is priced at the MIDPOINT of its page range: a tier charges one
 * price across the whole range, so pricing at the cheap end would underprice
 * every thicker book in it.
 */
function tiersForMargin(
  product: ProductDefinition,
  settings: PricingSettings,
  tiers: PageTier[],
  target: number,
): { tiers: PageTier[]; unreachable: string[] } {
  const unreachable = new Set<string>();
  const next = tiers.map((t) => {
    const lo = Math.max(t.minPages, product.conditions.pages.min);
    const hi = Math.min(t.maxPages, product.conditions.pages.max);
    const pages = Math.max(1, Math.round((lo + Math.max(lo, hi)) / 2));
    const prices = { ...t.prices };
    for (const currency of settings.currencies) {
      const price = suggestTierPrice(product, { currency, pages, copies: 1 }, settings, target);
      if (price == null) unreachable.add(currency);
      else prices[currency] = price;
    }
    return { ...t, prices };
  });
  return { tiers: next, unreachable: [...unreachable] };
}

/**
 * Set the whole table from one number — the margin you want to earn — and see
 * what that leaves for a sale before committing to it.
 *
 * The two headroom figures come from the same engine as the Discount planner,
 * run against the SUGGESTED prices rather than the saved ones, so dragging the
 * slider answers the question the admin actually has: "if I price for 45%, how
 * deep can I go on Black Friday?". They're worst-case by construction — the
 * cheapest variant on offer, bought by the plan with the deepest print discount
 * — because a headline that only holds for full-price buyers isn't a limit.
 *
 * Suggestions are a starting point, which is why Apply writes them to the inputs
 * for review rather than saving.
 */
function MarginPlanner({
  product,
  settings,
  tiers,
  setTiers,
}: {
  product: ProductDefinition;
  settings: PricingSettings;
  tiers: PageTier[];
  setTiers: (next: PageTier[]) => void;
}) {
  const plans = useAppConfigStore((s) => s.plans.plans);
  const cap = useMemo(() => maxTargetMargin(settings), [settings]);
  const [target, setTarget] = useState(() => Math.min(45, cap));

  const suggestion = useMemo(
    () => tiersForMargin(product, settings, tiers, Math.min(target, cap)),
    [product, settings, tiers, target, cap],
  );

  const headroom = useMemo(() => {
    if (suggestion.tiers.length === 0) return null;
    const pages = product.pricing.displayPages ?? product.conditions.pages.min;
    return printWorstCaseImpact(
      { ...product, pricing: { ...product.pricing, tiers: suggestion.tiers } },
      { currency: settings.baseCurrency, pages, copies: 1 },
      settings,
      buyerContextsFromPublicPlans(plans, settings),
    );
  }, [product, suggestion.tiers, settings, plans]);

  // Named only when it isn't the base variant — otherwise it's noise.
  const cheapest = cheapestVariant(product.variants, settings.baseCurrency);
  const base = variantFromSku(product.provider.sku);
  const targetsCheaperVariant = cheapest && base && !sameVariant(cheapest, base);

  const apply = () => {
    setTiers(suggestion.tiers);
    if (suggestion.unreachable.length > 0) {
      toast.warning(`${suggestion.unreachable.join(", ")}: ${target}% isn't reachable after fees and tax.`);
    } else {
      toast.success(`Prices set for a ${target}% margin. Review before saving.`);
    }
  };

  if (tiers.length === 0) return null;

  return (
    <Section
      title="Price from a target margin"
      hint={`Drag to the margin you want to earn and see what it costs — and what it leaves for a sale. Nothing changes until you apply.${
        targetsCheaperVariant
          ? ` Prices target ${variantSummary(cheapest!)}, the cheapest variant you offer; the rest land above target.`
          : ""
      }`}
      action={
        <Button variant="secondary" size="sm" leftIcon={<Wand2 className="size-4" />} onClick={apply}>
          Apply to price rows
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <Slider value={Math.min(target, cap)} min={0} max={cap} step={1} onValueChange={setTarget} />
        <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-800">
          {Math.min(target, cap)}%
        </span>
      </div>

      {headroom && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Pill
            label="Max sale without a loss"
            value={`${headroom.breakEvenDiscountPct}%`}
            tone={headroom.underwaterAtList ? "bad" : "neutral"}
          />
          <Pill
            label={`Keeps the ${settings.minMarginPct}% floor to`}
            value={`${headroom.safeMaxDiscountPct}%`}
            tone={settings.maxDiscountPct > headroom.safeMaxDiscountPct ? "warn" : "good"}
          />
          <span className="self-center text-ink-400">
            worst case: {headroom.buyerLabel}
            {headroom.costIsEstimate ? ", on the cost estimate" : ""}
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-80 text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-ink-400">
            <tr>
              <th className="pr-4 text-left font-medium">Pages</th>
              {settings.currencies.map((c) => (
                <th key={c} className="pr-4 text-left font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-ink-600">
            {suggestion.tiers.map((t, i) => (
              <tr key={i}>
                <td className="pr-4 py-0.5">
                  {t.minPages}–{t.maxPages}
                </td>
                {settings.currencies.map((c) => {
                  const now = tiers[i]?.prices[c] ?? 0;
                  const next = t.prices[c] ?? 0;
                  return (
                    <td key={c} className="pr-4 py-0.5 tabular-nums">
                      <span className="text-ink-400 line-through">{fmtMoney(now, c)}</span>{" "}
                      <span className="font-semibold text-ink-800">{fmtMoney(next, c)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {suggestion.unreachable.length > 0 && (
        <p className="text-[11px] text-amber-700">
          {suggestion.unreachable.join(", ")}: fees and tax leave less than {Math.min(target, cap)}% — those rows are
          unchanged.
        </p>
      )}
    </Section>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "warn" | "neutral" }) {
  const color =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "bad"
        ? "bg-red-50 text-red-700 ring-red-200"
        : tone === "warn"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-ink-100 text-ink-600 ring-ink-200";
  return (
    <span className={`rounded px-2 py-1 ring-1 ring-inset ${color}`}>
      {label} <strong className="font-semibold tabular-nums">{value}</strong>
    </span>
  );
}

// ---- Pricing section -------------------------------------------------------

export function PricingSection({
  product,
  update,
  settings,
}: {
  product: ProductDefinition;
  update: Update;
  settings: PricingSettings;
}) {
  return (
    <div className="space-y-3">
      <Section
        title="Price by page count"
        hint="The only thing to set: the price customers pay for each page range. A 100-page book can cost more than a 20-page one. Currencies, fees and tax are managed once in Pricing settings."
      >
        <TierTable product={product} update={update} settings={settings} />
      </Section>

      <MarginPlanner
        product={product}
        settings={settings}
        tiers={product.pricing.tiers}
        setTiers={(next) => update((p) => ({ ...p, pricing: { ...p.pricing, tiers: next } }))}
      />

      <MarginInfo product={product} settings={settings} />
    </div>
  );
}

// ---- Margin / tax — read-only "additional info" ----------------------------

function MarginInfo({ product, settings }: { product: ProductDefinition; settings: PricingSettings }) {
  const previewMargin = useAppConfigStore((s) => s.previewMargin);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const [currency, setCurrency] = useState(settings.baseCurrency);
  const [pages, setPages] = useState(product.conditions.pages.min);
  const [copies, setCopies] = useState(Math.max(1, product.conditions.copies.min));
  const [country, setCountry] = useState("US");
  const [variantKeyChoice, setVariantKeyChoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<MarginPreview | null>(null);

  const cur = settings.currencies.includes(currency) ? currency : settings.baseCurrency;

  // Default to the cheapest variant on offer, not the base one: it's the order
  // that earns least on the same production cost, so it's the number that has to
  // hold. With no discounted options the two are the same variant.
  const orderable = useMemo(() => enumerateVariants(product.variants), [product.variants]);
  const variant = useMemo(() => {
    const chosen = variantKeyChoice ? parseVariantKey(variantKeyChoice) : null;
    if (chosen && variantAllowed(product.variants, chosen)) return chosen;
    return cheapestVariant(product.variants, cur);
  }, [variantKeyChoice, product.variants, cur]);

  const offline = useMemo<MarginBreakdown>(
    () => computeMargin(product, { currency: cur, pages, copies, variant }, settings),
    [product, cur, pages, copies, variant, settings],
  );
  const shown = live?.breakdown ?? offline;
  const costIsEstimate = product.cost.source === "providerLive" && !live?.live;
  // Same engine as the Discount planner, fed with the (possibly live) breakdown.
  const impact = printImpactFromBreakdown(
    { id: product.id, label: product.presentation.name },
    shown,
    settings,
    costIsEstimate,
  );
  // The most expensive buyer this product can have: the eligible plan with the
  // deepest print discount. Members of that plan pay less, so their margin —
  // not the sticker margin — is the number a sale must survive.
  const worstBuyer = useMemo(() => {
    const eligible = eligibleBuyers(
      product.conditions.access,
      buyerContextsFromPublicPlans(plans, settings),
    ).filter((b) => b.printDiscountPct > 0);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (b.printDiscountPct > a.printDiscountPct ? b : a));
  }, [product.conditions.access, plans, settings]);
  const worstImpact = worstBuyer
    ? printImpactFromBreakdown(
        { id: product.id, label: product.presentation.name },
        shown,
        settings,
        costIsEstimate,
        worstBuyer,
      )
    : null;
  const worstWf = worstImpact?.atDiscount(0);

  const fetchLive = async () => {
    setLoading(true);
    try {
      const res = await previewMargin(product, { currency: cur, pages, copies, country, variant });
      setLive(res);
      if (res.quoteError) toast.warning(res.quoteError);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setLive(null);

  return (
    <Section
      title="Additional info (read-only)"
      hint="Derived from your price minus cost, payment fee and tax. Pick a scenario, then fetch a live quote for the provider's true cost. Stripe Tax collects the real tax at checkout."
      action={
        <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="size-3.5" />} loading={loading} onClick={fetchLive}>
          Check live cost
        </Button>
      }
    >
      <Grid cols={4}>
        <Field label="Currency">
          <Select value={cur} options={settings.currencies.map((c) => ({ value: c, label: c }))} onChange={(e) => { setCurrency(e.target.value); reset(); }} />
        </Field>
        <NumberField label="Pages" value={pages} onChange={(n) => { setPages(n); reset(); }} />
        <NumberField label="Copies" value={copies} onChange={(n) => { setCopies(n); reset(); }} />
        <Field label="Ship to (country)">
          <Input value={country} onChange={(e) => { setCountry(e.target.value.toUpperCase()); reset(); }} />
        </Field>
      </Grid>

      {orderable.length > 1 && variant && (
        <Field label="Variant" hint="Defaults to the cheapest you offer — the order that earns least. A live quote prices this exact variant.">
          <Select
            value={variantKey(variant)}
            options={orderable.map((v) => ({
              value: variantKey(v),
              label: `${variantSummary(v)}${
                variantPriceDelta(product.variants, v, cur) !== 0
                  ? ` (${variantPriceDelta(product.variants, v, cur) > 0 ? "+" : ""}${fmtMoney(
                      variantPriceDelta(product.variants, v, cur),
                      cur,
                    )})`
                  : ""
              }`,
            }))}
            onChange={(e) => { setVariantKeyChoice(e.target.value); reset(); }}
          />
        </Field>
      )}

      <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
        <div className="mb-2 flex items-center gap-2 text-[11px]">
          <span className={live?.live ? "rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700" : "rounded bg-ink-100 px-1.5 py-0.5 text-ink-500"}>
            {live?.live ? "Live quote" : "Estimate"}
          </span>
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-500">
            {shown.taxBehavior === "inclusive" ? `Price incl. tax (~${shown.taxRatePct}%)` : "Tax added at checkout"}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricGroup title="Customer pays">
            <Metric label="Price / book" value={fmtMoney(shown.pricePerUnit, cur)} />
            <Metric label="Shipping" value={fmtMoney(shown.shippingCharged, cur)} />
            <Metric label="Tax" value={fmtMoney(shown.taxAmount, cur)} muted />
            <Metric label="Total charged" value={fmtMoney(shown.grossCustomerPays, cur)} />
          </MetricGroup>
          <MetricGroup title="Your costs">
            <Metric label="Production" value={fmtMoney(shown.productionCost, cur)} muted />
            <Metric label="Shipping" value={fmtMoney(shown.shippingCost, cur)} muted />
            <Metric label="Payment fee" value={fmtMoney(shown.paymentFee, cur)} muted />
            <Metric label="Tax remitted" value={fmtMoney(shown.taxAmount, cur)} muted />
          </MetricGroup>
          <MetricGroup title="You keep">
            <Metric label="Net profit" value={fmtMoney(shown.netProfit, cur)} accent={shown.netProfit > 0 ? "good" : "bad"} />
            <Metric label="Margin" value={`${shown.marginPct}%`} accent={shown.marginPct >= settings.minMarginPct ? "good" : "warn"} />
            <Metric
              label="Safe sale discount"
              value={`${impact.safeMaxDiscountPct}%`}
              accent={settings.maxDiscountPct > impact.safeMaxDiscountPct ? "warn" : "good"}
            />
            <Metric label="Break-even discount" value={`${shown.breakEvenDiscountPct}%`} accent={shown.underwaterAtMaxDiscount ? "bad" : undefined} />
            {worstBuyer && worstImpact && worstWf && (
              <Metric
                label={`${worstBuyer.planName} buyer (−${worstBuyer.printDiscountPct}%)`}
                value={`${worstWf.marginPct}% · sale to ${worstImpact.safeMaxDiscountPct}%`}
                accent={worstWf.netProfit < 0 ? "bad" : worstWf.marginPct < settings.minMarginPct ? "warn" : "good"}
              />
            )}
          </MetricGroup>
        </div>
        {shown.underwaterAtMaxDiscount && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
            <AlertTriangle className="size-3.5" />
            The max discount ({shown.maxDiscountPct}%) exceeds break-even ({shown.breakEvenDiscountPct}%) — would sell at a loss in {cur}.
          </div>
        )}
      </div>
    </Section>
  );
}

function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md bg-ink-50/50 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{title}</div>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function Metric({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: "good" | "bad" | "warn" }) {
  const color =
    accent === "good" ? "text-emerald-600" : accent === "bad" ? "text-red-600" : accent === "warn" ? "text-amber-600" : muted ? "text-ink-500" : "text-ink-800";
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={`text-sm font-semibold ${color}`}>{value}</dd>
    </div>
  );
}
