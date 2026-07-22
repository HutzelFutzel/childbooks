"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Field } from "../../components/Input";
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
import { costForUsage, costKey } from "../../../core/config/modelCosts";
import { resolveImageModel } from "../../../core/config/modelConfig";
import { grantLiabilityUsd, sparkUnitEconomics } from "../../../core/config/economics";
import { TEXT_ACTIONS, IMAGE_ACTIONS, type ImageActionId } from "../../../core/ai/actions";
import { Grid, NumberField, Section, TabIntro, fmtMoney } from "./products/parts";

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
    // A nominal single-image usage to illustrate the price.
    const usd = costForUsage(cost, { images: 1 });
    if (usd == null) return null;
    return sparksForCostUsd(draft, usd);
  };

  const allActions = [
    ...TEXT_ACTIONS.map((a) => ({ ...a, isImage: false })),
    ...IMAGE_ACTIONS.map((a) => ({ ...a, isImage: true })),
  ];

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            The <span className="font-medium">packs</span> customers buy to top up live in the
            Catalog. Per-plan Spark grants and discounts live under Memberships.
          </>
        }
        links={[{ label: "Spark packs (Catalog)", onClick: () => openCatalog("packs") }]}
      >
        Sparks meter the variable backend cost of AI generation. The honest principle: the book is
        the product, Sparks just pay for the kitchen — so text/thinking steps stay free and image
        generation is priced from its real cost. While <span className="font-medium">disabled</span>,
        everything is free and the app behaves exactly as before.
      </TabIntro>

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => { setDraft(stored); setDirty(false); }}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
          Save Sparks config
        </Button>
      </div>

      <Section
        title="Economy"
        hint="The master switch and the peg. One Spark is worth the value below; derived prices are the measured provider cost × the markup, divided by that value."
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

      <Section
        title="Referral rewards"
        hint="Both sides get Sparks when the referred user makes their FIRST payment (any pack, order or subscription). Payment-gated so codes can't be farmed with throwaway accounts."
        action={
          <Toggle
            checked={draft.referral.enabled}
            onChange={(v) => set({ referral: { ...draft.referral, enabled: v } })}
            label="Enable referrals"
          />
        }
      >
        <Grid cols={2}>
          <NumberField
            label="Referrer reward"
            value={draft.referral.referrerSparks}
            step="10"
            suffix="✦"
            onChange={(n) => set({ referral: { ...draft.referral, referrerSparks: n } })}
          />
          <NumberField
            label="Referred-user reward"
            value={draft.referral.referredSparks}
            step="10"
            suffix="✦"
            onChange={(n) => set({ referral: { ...draft.referral, referredSparks: n } })}
          />
        </Grid>
        <p className="text-[11px] text-ink-400">
          Worst-case cost per successful referral:{" "}
          {fmtMoney(
            grantLiabilityUsd(draft, draft.referral.referrerSparks + draft.referral.referredSparks),
            baseCurrency,
          )}{" "}
          in provider spend — paid only after the referred user has already paid you money.
        </p>
      </Section>

      <Section title="Action pricing" hint="What each AI action costs in Sparks. Text steps are free by default; image actions are cost-derived. Use Fixed to pin a flat price. The estimate is what's reserved before a render whose exact cost isn't known yet.">
        <div className="space-y-2">
          {allActions.map((a) => {
            const rule = draft.actions[a.id] ?? { mode: "free" as const, fixedSparks: 0, estimatedSparks: 0 };
            const preview = rule.mode === "derived" ? derivedPreview(a.id, a.isImage) : null;
            return (
              <div key={a.id} className="space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-inset ring-ink-100">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-ink-800">{a.label}</span>
                    <p className="text-[11px] text-ink-400">{a.help}</p>
                  </div>
                  {preview != null && (
                    <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                      ≈ {preview} ✦
                    </span>
                  )}
                </div>
                <Grid cols={3}>
                  <Field label="Mode">
                    <Select
                      value={rule.mode}
                      options={MODES}
                      onChange={(e) => setAction(a.id, { mode: e.target.value as ActionPricingMode })}
                    />
                  </Field>
                  {rule.mode === "fixed" && (
                    <NumberField label="Fixed price" value={rule.fixedSparks} step="1" suffix="✦" onChange={(n) => setAction(a.id, { fixedSparks: n })} />
                  )}
                  {rule.mode !== "free" && (
                    <NumberField label="Reserve estimate" value={rule.estimatedSparks} step="1" suffix="✦" onChange={(n) => setAction(a.id, { estimatedSparks: n })} />
                  )}
                </Grid>
              </div>
            );
          })}
        </div>
      </Section>

      {/* A tiny live sanity check that the peg + markup produce sane prices. */}
      <p className="text-[11px] text-ink-400">
        Sanity check: a {fmtMoney(0.04, baseCurrency)} image would cost{" "}
        <span className="font-medium text-ink-600">{priceForAction({ ...draft, enabled: true }, "pageIllustration", 0.04)} ✦</span>{" "}
        at the current peg + markup.
      </p>
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
    <div className="mt-2 overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100">
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
