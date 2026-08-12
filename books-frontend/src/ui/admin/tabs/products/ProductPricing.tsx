"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Layers, Plus, RefreshCw, Ruler, Trash2, Wand2 } from "lucide-react";
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
  generateSteppedTiers,
  suggestTierPrice,
  type MarginBreakdown,
  type RangeBand,
} from "../../../../core/config/productMath";
import {
  cheapestVariant,
  costVariantKey,
  enumerateVariants,
  parseVariantKey,
  sameVariant,
  variantAllowed,
  variantKey,
  variantOptionLabel,
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
import { Disclosure, Grid, NumberField, Section, TabIntro, fmtMoney } from "./parts";

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
      <TabIntro>
        Printing costs you <span className="font-medium">two things per copy</span>: a{" "}
        <span className="font-medium">base amount</span> for the cover and the binding, which is the
        same whether the book is 24 pages or 240, and an{" "}
        <span className="font-medium">amount per page</span> for ink and paper. The per-page amount is
        the one that moves — premium colour on coated stock costs many times more per page than
        standard black &amp; white, so on a long book the interior, not the cover, is what you&apos;re
        paying for. That&apos;s why each paper and print quality gets measured separately below.
      </TabIntro>

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

      <Section
        title="Cost estimate"
        hint="Per book: a base cost plus a per-page cost. These are the base variant's numbers — the one this product's own SKU encodes."
      >
        <Grid cols={2}>
          <NumberField
            label="Base cost per book"
            hint="Cover, binding and handling. Doesn't change with length."
            value={cost.table.basePerUnit}
            step="0.01"
            onChange={(n) => setTable({ basePerUnit: n })}
            suffix={cost.currency}
          />
          <NumberField
            label="Cost per page"
            hint="Ink and paper, per interior page. Kept to more decimals than money normally is, because it's multiplied by up to several hundred pages."
            value={cost.table.perPage}
            step="0.001"
            onChange={(n) => setTable({ perPage: n })}
            suffix={cost.currency}
          />
        </Grid>
        <WorkedExample product={product} />
      </Section>

      <VariantCostTable product={product} />

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
 * The cost table, spelled out as the arithmetic it is.
 *
 * A base of `2.16` and a per-page of `0.2148` are two abstract numbers until
 * you multiply them out; "a 40-page book costs you $10.75" is checkable against
 * the printer's own calculator in ten seconds. It also makes the extra decimals
 * on the per-page rate read as precision rather than as a bug.
 */
function WorkedExample({ product }: { product: ProductDefinition }) {
  const { basePerUnit, perPage } = product.cost.table;
  if (basePerUnit === 0 && perPage === 0) {
    return (
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
        No cost measured yet, so every margin on this product is currently meaningless — with a cost
        of zero, the whole price looks like profit. Measure it above.
      </p>
    );
  }
  const pages = Math.min(
    Math.max(product.pricing.displayPages ?? product.conditions.pages.min, product.conditions.pages.min),
    product.conditions.pages.max,
  );
  const total = basePerUnit + perPage * pages;
  return (
    <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-600">
      A <span className="font-medium">{pages}-page</span> book costs you{" "}
      <span className="tabular-nums">{fmtMoney(basePerUnit, product.cost.currency)}</span> +{" "}
      <span className="tabular-nums">
        {pages} × {perPage.toFixed(4)}
      </span>{" "}
      = <span className="font-medium tabular-nums">{fmtMoney(total, product.cost.currency)}</span> per
      copy, before shipping and payment fees.
    </p>
  );
}

/**
 * What each variant costs to print, and how the ones you haven't measured are
 * being treated.
 *
 * The gap matters: an unmeasured variant falls back to the base rate, which is
 * the costliest one we sell. That's the safe direction — it never understates —
 * but it makes a cheap variant look unprofitable and misprices its delta, so
 * the fallback has to be visible rather than silently assumed.
 */
function VariantCostTable({ product }: { product: ProductDefinition }) {
  const measured = product.cost.variantPerPage ?? {};
  const rows = useMemo(() => {
    const seen = new Map<string, { key: string; label: string }>();
    for (const variant of enumerateVariants(product.variants)) {
      const key = costVariantKey(variant);
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          label: [
            variantOptionLabel("print", variant.print),
            variantOptionLabel("paper", variant.paper),
          ].join(" · "),
        });
      }
    }
    return [...seen.values()];
  }, [product.variants]);

  if (rows.length <= 1) return null;
  const base = variantFromSku(product.provider.sku);
  const baseKey = base ? costVariantKey(base) : null;
  const pages = Math.min(
    Math.max(product.pricing.displayPages ?? product.conditions.pages.min, product.conditions.pages.min),
    product.conditions.pages.max,
  );

  return (
    <Section
      title="Cost per variant"
      hint={`What each combination of print quality and paper costs to make. Cover finish is left out — gloss and matte cost the same. Totals shown for a ${pages}-page book.`}
    >
      <div className="overflow-x-auto">
        <table className="min-w-[420px] text-[11px]">
          <thead className="text-[10px] uppercase tracking-wide text-ink-400">
            <tr>
              <th className="pb-1 pr-4 text-left font-medium">Print &amp; paper</th>
              <th className="pb-1 pr-4 text-right font-medium">Per page</th>
              <th className="pb-1 pr-4 text-right font-medium">{pages} pages</th>
              <th className="pb-1 text-left font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rate = measured[row.key];
              const effective = rate ?? product.cost.table.perPage;
              const total = product.cost.table.basePerUnit + effective * pages;
              return (
                <tr key={row.key} className="border-t border-ink-100">
                  <td className="py-1 pr-4 text-ink-700">
                    {row.label}
                    {row.key === baseKey && (
                      <span className="ml-1.5 rounded bg-brand-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-700">
                        base
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums text-ink-600">{effective.toFixed(4)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums text-ink-800">
                    {fmtMoney(total, product.cost.currency)}
                  </td>
                  <td className="py-1 text-ink-400">
                    {rate != null ? "measured" : <span className="text-amber-600">base rate (not measured)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
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
        toast.success(
          `Measured ${outcome.result.variants.length} variant${outcome.result.variants.length === 1 ? "" : "s"} from live provider quotes.`,
        );
        if (outcome.result.message) toast.warning(outcome.result.message);
        // A cost fit that worked while shipping didn't still leaves a
        // passthrough product unsellable, so it can't pass as a plain success.
        if (outcome.result.shippingMessage) toast.warning(outcome.result.shippingMessage);
      } else if (outcome.result.throttled) {
        // Not an error: the provider asked us to slow down. Nothing to fix, and
        // showing this in red sends the admin hunting for a broken SKU.
        toast.warning(outcome.result.message ?? "The provider rate-limited us. Try again in a minute.");
      } else {
        toast.error(outcome.result.message ?? "Calibration failed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Calibration failed.");
    } finally {
      setBusy(false);
    }
  };

  const measurement = product.cost.measurement;

  return (
    <Section
      title="Measure cost from the provider"
      hint={
        "Asks the printer what this book actually costs, instead of you guessing. It prices the book at " +
        "both ends of its page range to work out the fixed cost per copy and the cost per page, repeats " +
        "the per-page part for every paper and print quality you offer, checks for volume discounts, and " +
        "measures shipping to five countries. Dozens of price checks, so give it up to a minute — nothing " +
        "is ordered and nothing is charged. Anything you typed in by hand is replaced."
      }
      action={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Ruler className="size-3.5" />}
          loading={busy}
          disabled={dirty || !product.provider.sku.trim()}
          title={
            dirty
              ? "Save your changes first — this runs against the saved product."
              : `Price this book against the ${runtime?.env ?? "active"} print catalogue and fill in the costs below`
          }
          onClick={run}
        >
          Measure against {runtime?.env ?? "provider"}
        </Button>
      }
    >
      {measurement && !result && (
        <p className="text-[11px] text-ink-500">
          Last measured {new Date(measurement.at).toLocaleDateString()} against{" "}
          <span className="font-medium">{measurement.env}</span>, shipping to {measurement.destination} —{" "}
          {measurement.variantsMeasured} of {measurement.variantsOffered} variants priced.
        </p>
      )}
      {result && (
        <div className="space-y-1.5 text-xs">
          {result.variants.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-[320px] text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="pr-4 text-left font-medium">Variant</th>
                    <th className="pr-4 text-right font-medium">Cost / page</th>
                    <th className="text-right font-medium">Fit</th>
                  </tr>
                </thead>
                <tbody className="text-ink-600">
                  {result.variants.map((v) => (
                    <tr key={v.key}>
                      <td className="pr-4">{v.label}</td>
                      <td className="pr-4 text-right tabular-nums">{v.perPage.toFixed(4)}</td>
                      <td className="text-right tabular-nums text-ink-400">±{v.residual.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.samples.length > 0 && (
            <details className="text-[11px] text-ink-500">
              <summary className="cursor-pointer select-none">
                {result.samples.length} price checks taken
              </summary>
              <div className="overflow-x-auto">
              <table className="mt-1 min-w-[280px] text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="pr-4 text-left font-medium">Pages</th>
                    <th className="pr-4 text-left font-medium">Copies</th>
                    <th className="pr-4 text-left font-medium">Variant</th>
                    <th className="text-left font-medium">Cost / book</th>
                  </tr>
                </thead>
                <tbody className="text-ink-600">
                  {result.samples.map((s, i) => (
                    <tr key={i}>
                      <td className="pr-4">{s.pages}</td>
                      <td className="pr-4">{s.copies}</td>
                      <td className="pr-4">{s.variant ?? "base"}</td>
                      <td>{fmtMoney(s.unitCost, result.currency ?? "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </details>
          )}
          {result.fitResidual != null && (
            <p className="text-ink-500">
              Straight-line check: the measured prices sit within{" "}
              {fmtMoney(result.fitResidual, result.currency ?? "USD")} of the fitted cost.
            </p>
          )}
          {result.discoveredPages && (
            <p className="text-ink-500">
              Provider allows {result.discoveredPages.min}–{result.discoveredPages.max} pages.
            </p>
          )}
          {result.message && (
            <p className={result.ok || result.throttled ? "text-amber-700" : "text-red-600"}>
              {result.message}
            </p>
          )}
          {result.shippingMessage && <p className="text-amber-700">{result.shippingMessage}</p>}
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
      <RangeLadderBuilder
        tiers={tiers}
        setTiers={setTiers}
        currencies={currencies}
        defaultStart={product.conditions.pages.min}
      />
    </div>
  );
}

// ---- Page-range ladder generator -------------------------------------------

/**
 * Draws the row table without asking the admin to type each one by hand:
 * a ladder of "up to page N, every S pages" steps, fine near the short end and
 * coarser further out (e.g. every 10 pages to 100, then every 100 to 1000).
 *
 * Only generates the ROWS. Prices land at 0 (or copied forward, on append) —
 * pairing this with "Apply to price rows" below fills every price in one move,
 * which is the combination that makes this useful: draw the ladder, then price
 * the whole ladder from a target margin.
 */
function RangeLadderBuilder({
  tiers,
  setTiers,
  currencies,
  defaultStart,
}: {
  tiers: PageTier[];
  setTiers: (next: PageTier[]) => void;
  currencies: CurrencyCode[];
  defaultStart: number;
}) {
  const [mode, setMode] = useState<"append" | "replace">(tiers.length > 0 ? "append" : "replace");
  const [startPage, setStartPage] = useState(defaultStart || 1);
  const [bands, setBands] = useState<RangeBand[]>([
    { upTo: 100, step: 10 },
    { upTo: 1000, step: 100 },
  ]);

  const appendStart = tiers.length > 0 ? tiers[tiers.length - 1].maxPages + 1 : startPage;
  const effectiveStart = mode === "append" ? appendStart : startPage;

  const preview = useMemo(
    () => generateSteppedTiers(effectiveStart, bands, currencies),
    [effectiveStart, bands, currencies],
  );

  const patchBand = (i: number, patch: Partial<RangeBand>) =>
    setBands(bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const addBand = () => {
    const last = bands[bands.length - 1];
    setBands([...bands, last ? { upTo: last.upTo * 10, step: last.step * 10 } : { upTo: 100, step: 10 }]);
  };
  const removeBand = (i: number) => setBands(bands.filter((_, idx) => idx !== i));

  const apply = () => {
    if (preview.length === 0) {
      toast.warning("No rows to generate — check the steps below.");
      return;
    }
    const seedFrom = mode === "append" ? tiers[tiers.length - 1]?.prices : undefined;
    const seedPrices: Record<string, number> = {};
    for (const c of currencies) seedPrices[c] = seedFrom?.[c] ?? 0;
    const generated = generateSteppedTiers(effectiveStart, bands, currencies, seedPrices);
    setTiers(mode === "append" ? [...tiers, ...generated] : generated);
    toast.success(
      `Generated ${generated.length} page range${generated.length === 1 ? "" : "s"}${
        seedFrom ? "" : " — set their prices, or use \"Apply to price rows\" below"
      }.`,
    );
  };

  return (
    <Disclosure label="Generate page ranges">
      <p className="text-[11px] leading-relaxed text-ink-400">
        Draw a ladder of rows instead of adding them one at a time: fine steps near the short end, coarser steps
        further out. Prices land at zero (or carried over, when appending) — use "Apply to price rows" below to fill
        them all at once from a target margin.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mode" className="w-44" hint={mode === "append" ? `Starts at page ${appendStart}` : undefined}>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as "append" | "replace")}
            options={[
              { value: "append", label: "Append after last row" },
              { value: "replace", label: "Replace all rows" },
            ]}
          />
        </Field>
        {mode === "replace" && (
          <NumberField label="Start at page" value={startPage} min={1} onChange={setStartPage} className="w-32" />
        )}
      </div>
      <div className="space-y-2">
        {bands.map((b, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <NumberField
              label={i === 0 ? "Up to page" : "then up to"}
              value={b.upTo}
              min={1}
              onChange={(n) => patchBand(i, { upTo: n })}
              className="w-32"
            />
            <NumberField
              label="every"
              value={b.step}
              min={1}
              onChange={(n) => patchBand(i, { step: n })}
              className="w-28"
              suffix="pages"
            />
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="size-3.5" />}
              onClick={() => removeBand(i)}
              aria-label="Remove step"
              disabled={bands.length === 1}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" leftIcon={<Plus className="size-4" />} onClick={addBand}>
          Add step
        </Button>
        <p className="text-[11px] text-ink-500">
          {preview.length > 0
            ? `Generates ${preview.length} row${preview.length === 1 ? "" : "s"}, pages ${preview[0].minPages}–${
                preview[preview.length - 1].maxPages
              }.`
            : "Add at least one step that advances past the start page."}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<Layers className="size-4" />}
        onClick={apply}
        disabled={preview.length === 0}
      >
        {mode === "replace" ? `Replace with ${preview.length} rows` : `Append ${preview.length} rows`}
      </Button>
    </Disclosure>
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

  // Named only when it isn't the base variant — otherwise it's noise. Judged at
  // the display length, since a per-page delta can make a different variant the
  // cheapest one on a long book than on a short one.
  const cheapest = cheapestVariant(
    product.variants,
    settings.baseCurrency,
    product.pricing.displayPages ?? product.conditions.pages.min,
  );
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
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Wand2 className="size-4" />}
          onClick={apply}
          title="Overwrite the price rows above with these suggestions. Nothing is saved until you save the product, so you can still edit or discard them."
        >
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
    return cheapestVariant(product.variants, cur, pages);
  }, [variantKeyChoice, product.variants, cur, pages]);

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
            options={orderable.map((v) => {
              const delta = variantPriceDelta(product.variants, v, cur, pages);
              return {
                value: variantKey(v),
                label: `${variantSummary(v)}${
                  Math.abs(delta) >= 0.005 ? ` (${delta > 0 ? "+" : ""}${fmtMoney(delta, cur)})` : ""
                }`,
              };
            })}
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
