"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import { useAppConfigStore } from "../../../state/appConfigStore";
import type { SparkPack, SparksConfig } from "../../../core/config/sparks";
import { buyerContextsFromPublicPlans, packWorstCaseImpact } from "../../../core/config/discountImpact";
import { Grid, ImpactNote, NumberField, Section, TabIntro, fmtMoney } from "./products/parts";

/**
 * Spark-pack editor. Packs are a one-time purchasable — the power-user overflow
 * valve when someone runs out of Sparks between subscription renewals — so they
 * live in the Catalog next to the print book and the ebook. Persisted on the
 * shared `sparks` doc: this editor loads the full config, edits only the
 * `packs` slice, and saves the whole doc back (the peg/markup/grants it reads
 * for the margin check are owned by the Sparks economy tab).
 */
export function PacksTab() {
  const stored = useAppConfigStore((s) => s.sparks);
  const save = useAppConfigStore((s) => s.saveSparksConfig);
  const pricingSettings = useAppConfigStore((s) => s.pricingSettings);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const baseCurrency = pricingSettings.baseCurrency;
  // Pack Sparks are spent at the BUYER's plan multipliers (Sparks are
  // fungible), so the badge shows the worst case across all active plans.
  const buyers = useMemo(
    () => buyerContextsFromPublicPlans(plans, pricingSettings),
    [plans, pricingSettings],
  );

  const [draft, setDraft] = useState<SparksConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const setPacks = (packs: SparkPack[]) => {
    setDraft((d) => ({ ...d, packs }));
    setDirty(true);
  };
  const setPack = (idx: number, patch: Partial<SparkPack>) => {
    setPacks(draft.packs.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const addPack = () => {
    setPacks([
      ...draft.packs,
      {
        id: `pack-${Date.now().toString(36)}`,
        label: "New pack",
        sparks: 100,
        bonusSparks: 0,
        prices: { [baseCurrency]: 0 },
        active: true,
        sortOrder: draft.packs.length,
      },
    ]);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Spark packs saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <TabIntro>
        <span className="font-medium">Spark packs</span> are one-time top-ups a customer can buy when
        they run low between renewals. Price each pack in your base currency; the margin badge warns
        you if a fully-spent pack would cost more in provider fees than it earns.
      </TabIntro>

      {!draft.enabled && (
        <ImpactNote>
          The Sparks economy is currently <span className="font-semibold">disabled</span>, so packs
          aren&apos;t sold and everything is free. Turn it on under the{" "}
          <span className="font-semibold">Sparks economy</span> tab to sell packs.
        </ImpactNote>
      )}

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => { setDraft(stored); setDirty(false); }}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
          Save packs
        </Button>
      </div>

      <Section
        title="Packs"
        hint="Each pack grants its Sparks plus any bonus. The per-Spark price should stay above your provider backing so a spent pack is always profitable."
        action={
          <Button variant="secondary" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={addPack}>
            Add pack
          </Button>
        }
      >
        <div className="space-y-2">
          {draft.packs.map((pack, idx) => {
            const total = pack.sparks + pack.bonusSparks;
            const price = pack.prices[baseCurrency] ?? 0;
            const perSpark = total > 0 && price > 0 ? price / total : null;
            const impact = packWorstCaseImpact(draft, pack, pricingSettings, baseCurrency, buyers);
            const atList = impact?.atDiscount(0);
            const worstBuyer = impact?.buyerPlanId ? ` (worst buyer: ${impact.buyerLabel})` : "";
            return (
              <div key={pack.id} className="space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-inset ring-ink-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Toggle checked={pack.active} onChange={(v) => setPack(idx, { active: v })} label="Active" />
                    <span className="text-sm font-semibold text-ink-800">
                      {total.toLocaleString()} ✦
                      {perSpark != null && (
                        <span className="ml-2 text-[11px] font-normal text-ink-400">{fmtMoney(perSpark, baseCurrency)}/✦</span>
                      )}
                    </span>
                    {impact && atList && (
                      <span
                        className={
                          atList.netProfit < 0
                            ? "rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                            : "rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                        }
                        title={`${impact.costLabel}: ~${fmtMoney(atList.directCost, baseCurrency)}. Payment fee ${fmtMoney(atList.paymentFee, baseCurrency)}. Net profit ${fmtMoney(atList.netProfit, baseCurrency)}. Break-even discount ${impact.breakEvenDiscountPct}%${worstBuyer}.`}
                      >
                        {atList.netProfit < 0
                          ? `BELOW COST — a used-up pack loses money after fees${worstBuyer}`
                          : `${atList.marginPct}% margin after fees · sale-safe to ${impact.safeMaxDiscountPct}% off${worstBuyer}`}
                      </span>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setPacks(draft.packs.filter((_, i) => i !== idx))} />
                </div>
                <Grid cols={4}>
                  <Field label="Label"><Input value={pack.label} onChange={(e) => setPack(idx, { label: e.target.value })} /></Field>
                  <NumberField label="Sparks" value={pack.sparks} step="10" onChange={(n) => setPack(idx, { sparks: n })} />
                  <NumberField label="Bonus" value={pack.bonusSparks} step="5" onChange={(n) => setPack(idx, { bonusSparks: n })} />
                  <NumberField label={`Price (${baseCurrency})`} value={price} step="0.5" suffix={baseCurrency} onChange={(n) => setPack(idx, { prices: { ...pack.prices, [baseCurrency]: n } })} />
                </Grid>
              </div>
            );
          })}
          {draft.packs.length === 0 && <p className="text-xs text-ink-400">No packs yet. Add one to offer top-ups.</p>}
        </div>
      </Section>
    </div>
  );
}
