"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import {
  priceForAction,
  sparksForCostUsd,
  totalGrantSparks,
  type ActionPricing,
  type ActionPricingMode,
  type SparksConfig,
} from "../../../core/config/sparks";
import {
  costForUsage,
  costKey,
  PUBLIC_IMAGE_ESTIMATE_USAGE,
} from "../../../core/config/modelCosts";
import { resolveImageModel } from "../../../core/config/modelConfig";
import { grantLiabilityUsd, sparkUnitEconomics } from "../../../core/config/economics";
import { TEXT_ACTIONS, IMAGE_ACTIONS, type ImageActionId } from "../../../core/ai/actions";
import { Grid, NumberField, Section, TabIntro, fmtMoney } from "./products/parts";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { AdminSaveBar } from "../AdminPageHeader";
import { PriceEstimationSection } from "./sparks/PriceEstimationSection";

const MODES: { value: ActionPricingMode; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "derived", label: "Cost-derived" },
  { value: "fixed", label: "Fixed price" },
];

/**
 * Editor for the **Sparks economy** (`appConfig/sparks`). Master switch, the peg
 * + markup, the starter grant + negative buffer, per-action pricing, and the
 * buyable top-up packs. Reads live from the public config doc; saves via the
 * backend admin route. The economy stays free until `enabled` is turned on.
 */
export function SparksTab() {
  const readOnly = useReadOnly();
  const stored = useAppConfigStore((s) => s.sparks);
  const modelCosts = useAppConfigStore((s) => s.adminModelCosts);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  const baseCurrency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const save = useAppConfigStore((s) => s.saveSparksConfig);
  const openCatalog = useAdminTab((s) => s.openCatalog);

  const [draft, setDraft] = useState<SparksConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const set = (patch: Partial<SparksConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const setAction = (id: string, patch: Partial<ActionPricing>) => {
    set({ actions: { ...draft.actions, [id]: { ...draft.actions[id], ...patch } } });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Sparks config saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  /** A representative derived Spark price for an image action, from its bound model. */
  const derivedPreview = (actionId: string, isImage: boolean): number | null => {
    if (!isImage) return null;
    const sel = resolveImageModel(modelConfig, actionId as ImageActionId, "premium");
    if (!sel) return null;
    const cost = modelCosts.models[costKey(sel.provider, sel.id)];
    // The same reference image the storefront quotes, so this preview can't
    // disagree with the price a customer is shown. It carries a nominal output
    // token count, without which every token-billed model previews at 0 ✦.
    const usd = costForUsage(cost, PUBLIC_IMAGE_ESTIMATE_USAGE);
    if (usd == null) return null;
    return sparksForCostUsd(draft, usd);
  };

  const allActions = [
    ...TEXT_ACTIONS.map((a) => ({ ...a, isImage: false })),
    ...IMAGE_ACTIONS.map((a) => ({ ...a, isImage: true })),
  ];

  return (
    <div className="space-y-8">
      <TabIntro
        links={[{ label: "Spark packs", onClick: () => openCatalog("packs") }]}
      />

      <Section
        title="Economy"
        hint="One Spark is worth the value below. Derived prices are provider cost × markup, divided by that value."
        action={<Toggle checked={draft.enabled} onChange={(v) => set({ enabled: v })} label="Enable Sparks" />}
      >
        <Grid cols={3}>
          <NumberField label="Spark value" value={draft.sparkValueUsd} step="0.005" suffix={baseCurrency} onChange={(n) => set({ sparkValueUsd: n })} />
          <NumberField label="Markup" value={draft.markupMultiplier} step="0.1" suffix="×" onChange={(n) => set({ markupMultiplier: n })} />
          <NumberField label="Negative buffer" value={draft.maxNegativeSparks} step="1" suffix="✦" onChange={(n) => set({ maxNegativeSparks: n })} />
        </Grid>
        <p className="text-[11px] text-ink-400">
          The negative buffer lets an in-flight render finish even if its real cost lands above the
          estimate — never fail a book mid-generation. The user tops up before the next action.
        </p>
        <Grid cols={3}>
          <NumberField
            label="Guest grant"
            value={draft.grants.guestSparks}
            step="10"
            suffix="✦"
            onChange={(n) => set({ grants: { ...draft.grants, guestSparks: n } })}
          />
          <NumberField
            label="Signup bonus"
            value={draft.grants.signupBonusSparks}
            step="10"
            suffix="✦"
            onChange={(n) => set({ grants: { ...draft.grants, signupBonusSparks: n } })}
          />
          <NumberField
            label="Verify bonus"
            value={draft.grants.verifyBonusSparks}
            step="10"
            suffix="✦"
            onChange={(n) => set({ grants: { ...draft.grants, verifyBonusSparks: n } })}
          />
        </Grid>
        <p className="text-[11px] text-ink-400">
          Free Sparks are granted as a ladder: guests get a taste before signing up, creating an
          account adds the signup bonus, and verifying the email unlocks the rest. Each rung is
          one-time per user; guest grants are additionally rate-limited per IP.
        </p>
        <EconomyImpact draft={draft} baseCurrency={baseCurrency} />
      </Section>

      <Section title="Action pricing" hint="Text steps are free by default; image actions are priced from measured costs (see Price estimation). The fallback is used only before any cost is known.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-400">
                <th className="pb-2 font-medium">Action</th>
                <th className="pb-2 font-medium">Mode</th>
                <th className="pb-2 font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {allActions.map((a) => {
                const rule = draft.actions[a.id] ?? { mode: "free" as const, fixedSparks: 0, estimatedSparks: 0 };
                const preview = rule.mode === "derived" ? derivedPreview(a.id, a.isImage) : null;
                return (
                  <tr key={a.id} className="border-t border-ink-100 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-ink-800">{a.label}</div>
                      <p className="text-xs text-ink-400">{a.help}</p>
                    </td>
                    <td className="py-2 pr-3 w-40">
                      <Select
                        value={rule.mode}
                        options={MODES}
                        onChange={(e) => setAction(a.id, { mode: e.target.value as ActionPricingMode })}
                      />
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-end gap-2">
                        {rule.mode === "fixed" && (
                          <NumberField label="Fixed" value={rule.fixedSparks} step="1" suffix="✦" className="w-28" onChange={(n) => setAction(a.id, { fixedSparks: n })} />
                        )}
                        {rule.mode === "derived" && (
                          <NumberField label="Fallback" value={rule.estimatedSparks} step="1" suffix="✦" className="w-28" onChange={(n) => setAction(a.id, { estimatedSparks: n })} />
                        )}
                        {preview != null && (
                          <span className="pb-2 text-xs text-ink-500">≈ {preview} ✦</span>
                        )}
                        {rule.mode === "free" && <span className="pb-2 text-xs text-ink-400">Free</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <PriceEstimationSection draft={draft} onChange={set} baseCurrency={baseCurrency} />

      <Section
        title="Print-resolution surcharge"
        hint="Upscaling a picture to 300 DPI happens only if the book is ordered, but it is paid for up front: once, on the first render of each page and cover. Redraws and edits of a slot that already has art are not charged again, and nothing is charged at checkout."
        action={
          <Toggle
            checked={draft.printPrep.enabled}
            onChange={(v) => set({ printPrep: { ...draft.printPrep, enabled: v } })}
            label="Charge surcharge"
          />
        }
      >
        <Grid cols={3}>
          <NumberField
            label="Upscale cost per picture"
            value={draft.printPrep.usdPerImage}
            step="0.001"
            suffix={baseCurrency}
            onChange={(n) => set({ printPrep: { ...draft.printPrep, usdPerImage: n } })}
          />
        </Grid>
        <p className="text-[11px] text-ink-400">
          Goes through the same markup as provider cost: ≈{" "}
          {draft.sparkValueUsd > 0
            ? `${((draft.printPrep.usdPerImage * draft.markupMultiplier) / draft.sparkValueUsd).toFixed(2)} ✦`
            : "—"}{" "}
          per first render. Compare with the actual spend per picture in Analysis → Orders → Print files, and adjust.
        </p>
      </Section>

      <p className="text-xs text-ink-400">
        Sanity check: a {fmtMoney(0.04, baseCurrency)} image would cost{" "}
        <span className="font-medium text-ink-600">{priceForAction({ ...draft, enabled: true }, "pageIllustration", 0.04)} ✦</span>{" "}
        at the current peg + markup.
      </p>
      {!readOnly && (
        <AdminSaveBar
          dirty={dirty}
          saving={saving}
          onSave={() => void onSave()}
          onDiscard={() => {
            setDraft(stored);
            setDirty(false);
          }}
          saveLabel="Save Sparks config"
        />
      )}
    </div>
  );
}

/**
 * "What this means for the business" — a live helper table under the economy
 * knobs so the peg/markup/starter-grant numbers are never abstract.
 */
function EconomyImpact({ draft, baseCurrency }: { draft: SparksConfig; baseCurrency: string }) {
  const unit = sparkUnitEconomics(draft);
  const ladderTotal = totalGrantSparks(draft);
  const starterCost = grantLiabilityUsd(draft, ladderTotal);
  const guestCost = grantLiabilityUsd(draft, draft.grants.guestSparks);
  const rows: { label: string; value: string; note: string }[] = [
    {
      label: "One Spark buys (provider cost)",
      value: fmtMoney(unit.providerUsdPerSpark, baseCurrency),
      note: `Peg ${fmtMoney(unit.sparkValueUsd, baseCurrency)} ÷ markup ${draft.markupMultiplier}×.`,
    },
    {
      label: "Gross margin on metered work",
      value: `${unit.grossMarginPct}%`,
      note: "Share of every derived Spark price that isn't provider cost (before Stripe/infra).",
    },
    {
      label: "Grant ladder worst-case cost",
      value: fmtMoney(starterCost, baseCurrency),
      note: `${ladderTotal} ✦ per fully-verified account if fully spent — your customer-acquisition cost ceiling.`,
    },
    {
      label: "Guest rung worst-case cost",
      value: fmtMoney(guestCost, baseCurrency),
      note: `${draft.grants.guestSparks} ✦ per anonymous visitor who generates — capped per IP per day.`,
    },
  ];
  return (
    <div className="mt-2 overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-ink-50 last:border-0">
              <td className="bg-ink-50/50 px-3 py-2 font-medium text-ink-700">{r.label}</td>
              <td className="px-3 py-2 font-semibold text-ink-800">{r.value}</td>
              <td className="px-3 py-2 text-ink-400">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
