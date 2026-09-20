"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import { useAppConfigStore } from "../../../state/appConfigStore";
import type { SparkPack, SparksConfig } from "../../../core/config/sparks";
import { buyerContextsFromPublicPlans, packWorstCaseImpact } from "../../../core/config/discountImpact";
import { ImpactNote, NumberField, Section } from "./products/parts";
import { PackPicturesSection } from "./products/PicturesSection";
import { AdminSaveBar } from "../AdminPageHeader";

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
    <div className="space-y-8">
      {!draft.enabled && (
        <ImpactNote>
          The Sparks economy is currently disabled, so packs aren&apos;t sold. Turn it on under Sparks.
        </ImpactNote>
      )}

      <Section
        title="Packs"
        hint="Each pack grants its Sparks plus any bonus."
        action={
          <Button variant="secondary" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={addPack}>
            Add pack
          </Button>
        }
      >
        {draft.packs.length === 0 ? (
          <p className="text-sm text-ink-400">No packs yet. Add one to offer top-ups.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400">
                  <th className="pb-2 font-medium">Label</th>
                  <th className="pb-2 font-medium">Sparks</th>
                  <th className="pb-2 font-medium">Bonus</th>
                  <th className="pb-2 font-medium">Price</th>
                  <th className="pb-2 font-medium">Margin</th>
                  <th className="pb-2 font-medium">Active</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {draft.packs.map((pack, idx) => {
                  const total = pack.sparks + pack.bonusSparks;
                  const price = pack.prices[baseCurrency] ?? 0;
                  const impact = packWorstCaseImpact(draft, pack, pricingSettings, baseCurrency, buyers);
                  const atList = impact?.atDiscount(0);
                  return (
                    <tr key={pack.id} className="border-t border-ink-100 align-top">
                      <td className="py-2 pr-3">
                        <Input value={pack.label} onChange={(e) => setPack(idx, { label: e.target.value })} />
                      </td>
                      <td className="py-2 pr-3 w-28">
                        <NumberField label="" value={pack.sparks} step="10" onChange={(n) => setPack(idx, { sparks: n })} />
                      </td>
                      <td className="py-2 pr-3 w-24">
                        <NumberField label="" value={pack.bonusSparks} step="5" onChange={(n) => setPack(idx, { bonusSparks: n })} />
                      </td>
                      <td className="py-2 pr-3 w-32">
                        <NumberField
                          label=""
                          value={price}
                          step="0.5"
                          suffix={baseCurrency}
                          onChange={(n) => setPack(idx, { prices: { ...pack.prices, [baseCurrency]: n } })}
                        />
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-500">
                        {impact && atList
                          ? atList.netProfit < 0
                            ? `Below cost${impact.buyerPlanId ? ` (${impact.buyerLabel})` : ""}`
                            : `${atList.marginPct}% · safe to ${impact.safeMaxDiscountPct}% off`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <Toggle checked={pack.active} onChange={(v) => setPack(idx, { active: v })} label="Active" />
                      </td>
                      <td className="py-2">
                        <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setPacks(draft.packs.filter((_, i) => i !== idx))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <PackPicturesSection packs={stored.packs} />
      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void onSave()}
        onDiscard={() => {
          setDraft(stored);
          setDirty(false);
        }}
        saveLabel="Save packs"
      />
    </div>
  );
}
