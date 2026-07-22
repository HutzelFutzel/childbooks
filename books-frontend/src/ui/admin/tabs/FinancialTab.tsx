"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Select } from "../../components/Select";
import type { CurrencyCode, PricingSettings } from "../../../core/config/products";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Grid, NumberField, Section, TabIntro } from "./products/parts";

/**
 * Financial settings — the money plumbing shared by EVERY product and plan:
 * which currencies you charge in, the exchange rates and processor fees behind
 * the margin math, price rounding/floors, and how tax is handled. These are
 * set-once-and-rarely-touch settings; changing them never alters a product's
 * entered prices, only how margins are computed and how tax is applied.
 */
export function FinancialTab() {
  const stored = useAppConfigStore((s) => s.pricingSettings);
  const save = useAppConfigStore((s) => s.savePricingSettings);

  const [draft, setDraft] = useState<PricingSettings>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCurrency, setNewCurrency] = useState("");

  // Resync from the live doc when there are no local edits.
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const set = (patch: Partial<PricingSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const addCurrency = () => {
    const c = newCurrency.trim().toUpperCase();
    if (!c) return;
    if (draft.currencies.includes(c)) {
      toast.error(`${c} is already configured.`);
      return;
    }
    set({
      currencies: [...draft.currencies, c],
      fx: { ...draft.fx, rates: { ...draft.fx.rates, [c]: draft.fx.rates[c] ?? 1 } },
      fees: { ...draft.fees, [c]: draft.fees[c] ?? { percentPct: 2.9, fixed: 0.3 } },
      rounding: { ...draft.rounding, [c]: draft.rounding[c] ?? { mode: "charm", to: 0.99 } },
      floorPrice: { ...draft.floorPrice, [c]: draft.floorPrice[c] ?? 0 },
      tax: {
        ...draft.tax,
        perCurrency: { ...draft.tax.perCurrency, [c]: draft.tax.perCurrency[c] ?? { behavior: "exclusive", assumedRatePct: 0 } },
      },
    });
    setNewCurrency("");
  };

  const removeCurrency = (c: CurrencyCode) => {
    if (c === draft.baseCurrency) {
      toast.error("Can't remove the base currency.");
      return;
    }
    set({ currencies: draft.currencies.filter((x) => x !== c) });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Financial settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            Actual prices for what you sell are set on their own tabs —{" "}
            <span className="font-medium">Catalog</span> (print, ebook, packs) and{" "}
            <span className="font-medium">Memberships</span> (plans). This tab only defines the
            economics those prices are measured against.
          </>
        }
      >
        These settings apply to <span className="font-medium">every</span> product and plan and power
        the margin read-outs across the dashboard. Changing them never edits an entered price — they
        control how cost, fees and tax are calculated. Most stores set these once at launch.
      </TabIntro>

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => { setDraft(stored); setDirty(false); }}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
          Save settings
        </Button>
      </div>

      <Section
        title="Currencies"
        hint="The price columns shown on every product and plan. The base currency is the one all margin math runs in; other currencies convert to it using the rates below. The exchange-rate buffer pads conversions so FX drift doesn't quietly erode your margin."
      >
        <Grid cols={2}>
          <Field label="Base currency">
            <Select
              value={draft.baseCurrency}
              options={draft.currencies.map((c) => ({ value: c, label: c }))}
              onChange={(e) => set({ baseCurrency: e.target.value })}
            />
          </Field>
          <NumberField label="Exchange-rate buffer" value={draft.fx.bufferPct} step="0.5" suffix="%" onChange={(n) => set({ fx: { ...draft.fx, bufferPct: n } })} />
        </Grid>
        <div className="flex items-end gap-1.5">
          <Field label="Add a currency" className="w-40">
            <Input value={newCurrency} placeholder="ISO e.g. CAD" onChange={(e) => setNewCurrency(e.target.value)} />
          </Field>
          <Button variant="secondary" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={addCurrency}>
            Add
          </Button>
        </div>
      </Section>

      <Section
        title="Maximum discount"
        hint="The largest discount you'd ever run (promo codes, subscriber perks). The margin read-outs use it as a stress test: any price that would sell at a loss once this discount is applied gets flagged, so you never advertise a discount you can't honour profitably."
      >
        <NumberField label="Maximum discount" value={draft.maxDiscountPct} step="1" className="w-44" suffix="%" onChange={(n) => set({ maxDiscountPct: n })} />
      </Section>

      <Section
        title="Tax"
        hint="Stripe Tax computes and collects the real amount per destination at checkout (physical books are often zero- or reduced-rated). The product tax code tells Stripe which rules to apply; the assumed rate below is used only for the margin estimate, not what customers are charged."
      >
        <Field label="Stripe product tax code (physical books)" className="w-full sm:w-80">
          <Input
            value={draft.tax.bookTaxCode ?? ""}
            placeholder="txcd_35010000"
            onChange={(e) => set({ tax: { ...draft.tax, bookTaxCode: e.target.value || undefined } })}
          />
        </Field>
      </Section>

      <Section
        title="Per-currency settings"
        hint="Fine-tune each currency: the payment-processor fee (subtracted from every sale before profit), price rounding, a hard floor you'll never sell below, and whether displayed prices include or add tax at checkout."
      >
        <div className="space-y-2">
          {draft.currencies.map((c) => {
            const isBase = c === draft.baseCurrency;
            const fee = draft.fees[c] ?? { percentPct: 0, fixed: 0 };
            const rounding = draft.rounding[c] ?? { mode: "charm" as const, to: 0.99 };
            const tax = draft.tax.perCurrency[c] ?? { behavior: "exclusive" as const, assumedRatePct: 0 };
            return (
              <div key={c} className="space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-inset ring-ink-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-800">
                    {c} {isBase && <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700">BASE</span>}
                  </span>
                  {!isBase && <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => removeCurrency(c)} />}
                </div>
                <Grid cols={4}>
                  {!isBase && (
                    <NumberField label="Exchange rate (per base)" value={draft.fx.rates[c] ?? 1} step="0.0001" onChange={(n) => set({ fx: { ...draft.fx, rates: { ...draft.fx.rates, [c]: n } } })} />
                  )}
                  <NumberField label="Processor fee" value={fee.percentPct} step="0.1" suffix="%" onChange={(n) => set({ fees: { ...draft.fees, [c]: { ...fee, percentPct: n } } })} />
                  <NumberField label="Fixed fee" value={fee.fixed} step="0.01" suffix={c} onChange={(n) => set({ fees: { ...draft.fees, [c]: { ...fee, fixed: n } } })} />
                  <NumberField label="Never sell below" value={draft.floorPrice[c] ?? 0} step="0.01" suffix={c} onChange={(n) => set({ floorPrice: { ...draft.floorPrice, [c]: n } })} />
                  <Field label="Rounding">
                    <Select value={rounding.mode} options={[{ value: "charm", label: "End in .99" }, { value: "none", label: "None" }]} onChange={(e) => set({ rounding: { ...draft.rounding, [c]: { ...rounding, mode: e.target.value as "charm" | "none" } } })} />
                  </Field>
                  <Field label="Tax behavior">
                    <Select
                      value={tax.behavior}
                      options={[
                        { value: "exclusive", label: "Added at checkout" },
                        { value: "inclusive", label: "Included in price" },
                      ]}
                      onChange={(e) => set({ tax: { ...draft.tax, perCurrency: { ...draft.tax.perCurrency, [c]: { ...tax, behavior: e.target.value as "inclusive" | "exclusive" } } } })}
                    />
                  </Field>
                  <NumberField label="Assumed tax rate" value={tax.assumedRatePct} step="0.5" suffix="%" onChange={(n) => set({ tax: { ...draft.tax, perCurrency: { ...draft.tax.perCurrency, [c]: { ...tax, assumedRatePct: n } } } })} />
                </Grid>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
