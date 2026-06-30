"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Select } from "../../../components/Select";
import type { CurrencyCode, PageTier, PricingSettings, ProductDefinition } from "../../../../core/config/products";
import { computeMargin, type MarginBreakdown } from "../../../../core/config/productMath";
import { useAppConfigStore, type MarginPreview } from "../../../../state/appConfigStore";
import { Grid, NumberField, Section, fmtMoney } from "./parts";

type Update = (fn: (p: ProductDefinition) => ProductDefinition) => void;

// ---- Cost (its own tab) ----------------------------------------------------

export function CostSection({ product, update }: { product: ProductDefinition; update: Update }) {
  const cost = product.cost;
  const setCost = (patch: Partial<ProductDefinition["cost"]>) =>
    update((p) => ({ ...p, cost: { ...p.cost, ...patch } }));
  const setTable = (patch: Partial<ProductDefinition["cost"]["table"]>) =>
    update((p) => ({ ...p, cost: { ...p.cost, table: { ...p.cost.table, ...patch } } }));

  return (
    <div className="space-y-3">
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
      <Button variant="secondary" size="sm" leftIcon={<Plus className="size-4" />} onClick={addTier}>
        Add page range
      </Button>
    </div>
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

      <MarginInfo product={product} settings={settings} />
    </div>
  );
}

// ---- Margin / tax — read-only "additional info" ----------------------------

function MarginInfo({ product, settings }: { product: ProductDefinition; settings: PricingSettings }) {
  const previewMargin = useAppConfigStore((s) => s.previewMargin);
  const [currency, setCurrency] = useState(settings.baseCurrency);
  const [pages, setPages] = useState(product.conditions.pages.min);
  const [copies, setCopies] = useState(Math.max(1, product.conditions.copies.min));
  const [country, setCountry] = useState("US");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<MarginPreview | null>(null);

  const cur = settings.currencies.includes(currency) ? currency : settings.baseCurrency;

  const offline = useMemo<MarginBreakdown>(
    () => computeMargin(product, { currency: cur, pages, copies }, settings),
    [product, cur, pages, copies, settings],
  );
  const shown = live?.breakdown ?? offline;

  const fetchLive = async () => {
    setLoading(true);
    try {
      const res = await previewMargin(product, { currency: cur, pages, copies, country });
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
            <Metric label="Margin" value={`${shown.marginPct}%`} accent={shown.marginPct >= 10 ? "good" : "warn"} />
            <Metric label="Break-even discount" value={`${shown.breakEvenDiscountPct}%`} accent={shown.underwaterAtMaxDiscount ? "bad" : undefined} />
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
