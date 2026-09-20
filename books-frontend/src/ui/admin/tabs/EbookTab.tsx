"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, Input } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import type { PricingSettings } from "../../../core/config/products";
import type { PublicPlan } from "../../../core/config/plans";
import {
  buyerContextsFromPublicPlans,
  ebookDiscountImpact,
  ebookWorstCaseImpact,
  minViableEbookPrice,
} from "../../../core/config/discountImpact";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { Disclosure, Grid, ImpactNote, NumberField, TabIntro, fmtMoney } from "./products/parts";
import { EbookPicturesSection } from "./products/PicturesSection";
import { AdminSaveBar } from "../AdminPageHeader";

/**
 * Digital-edition (ebook) product editor. The ebook is a real product — a
 * downloadable PDF of the customer's finished book — so it lives in the Catalog
 * next to print books and Spark packs. Under the hood it's persisted on the
 * shared `pricingSettings` doc, so this editor loads the full settings, edits
 * only the `ebook` slice, and saves the whole doc back (preserving everything
 * else, including per-plan member pricing set on the Memberships tab).
 */
export function EbookTab() {
  const stored = useAppConfigStore((s) => s.pricingSettings);
  const save = useAppConfigStore((s) => s.savePricingSettings);
  const plans = useAppConfigStore((s) => s.plans.plans);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  const [draft, setDraft] = useState<PricingSettings>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const setEbook = (patch: Partial<PricingSettings["ebook"]>) => {
    setDraft((d) => ({ ...d, ebook: { ...d.ebook, ...patch } }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Digital edition saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const ebook = draft.ebook;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabIntro
          links={[
            { label: "Member pricing", onClick: () => setConfigTab("memberships") },
            { label: "Currencies & tax", onClick: () => setConfigTab("financial") },
          ]}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-500">{ebook.enabled ? "On sale" : "Hidden"}</span>
          <Toggle
            checked={ebook.enabled}
            onChange={(v) => setEbook({ enabled: v })}
            label="Sell the digital edition"
          />
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-900">Price</h2>
        <Grid cols={4}>
          {draft.currencies.map((c) => (
            <NumberField
              key={c}
              label={c}
              value={ebook.prices[c] ?? 0}
              step="0.5"
              suffix={c}
              onChange={(n) => setEbook({ prices: { ...ebook.prices, [c]: n } })}
            />
          ))}
        </Grid>
        <p className="text-sm text-ink-500">A price of 0 hides the ebook in that currency.</p>
        <NumberField
          label="Print owners get"
          value={ebook.printBundleDiscountPct}
          step="5"
          suffix="%"
          className="w-56"
          hint="Automatic at checkout when they already bought a print copy of this book."
          onChange={(n) => setEbook({ printBundleDiscountPct: n })}
        />
        <MemberPriceLine
          settings={draft}
          plans={plans}
          onEdit={() => setConfigTab("memberships")}
        />
        <BundleDiscountWarning settings={draft} plans={plans} />
      </section>

      <EbookPicturesSection />

      <EbookImpact settings={draft} plans={plans} />

      <Disclosure label="Advanced">
        <Field
          label="Stripe product tax code"
          hint="Downloadable books are taxed differently from print in many regions."
          className="w-full sm:w-80"
        >
          <Input
            value={ebook.taxCode ?? ""}
            placeholder="txcd_10302000"
            onChange={(e) => setEbook({ taxCode: e.target.value || undefined })}
          />
        </Field>
      </Disclosure>

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void onSave()}
        onDiscard={() => {
          setDraft(stored);
          setDirty(false);
        }}
        saveLabel="Save digital edition"
      />
    </div>
  );
}

function MemberPriceLine({
  settings,
  plans,
  onEdit,
}: {
  settings: PricingSettings;
  plans: PublicPlan[];
  onEdit: () => void;
}) {
  const active = plans
    .filter((p) => p.status === "active")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (active.length === 0) return null;
  const currency = settings.currencies[0];
  return (
    <p className="text-sm text-ink-500">
      {active.map((p, i) => {
        const prices = settings.ebook.planPrices[p.id];
        const amount = prices?.[currency] ?? 0;
        const value =
          prices == null ? "regular price" : amount === 0 ? "included" : fmtMoney(amount, currency);
        return (
          <span key={p.id}>
            {i > 0 ? " · " : null}
            {p.name}: {value}
          </span>
        );
      })}
      {" · "}
      <button type="button" onClick={onEdit} className="hover:text-ink-800 hover:underline">
        Edit on Memberships
      </button>
    </p>
  );
}

/**
 * The bundle discount is a REAL, always-on discount, and it STACKS on top of
 * member prices — so evaluate the worst reachable price (lowest member price
 * of any active plan, with the bundle discount on top) per currency. Checkout
 * clamps the automatic bundle discount so it can never push a viable price
 * below covering the fixed Stripe fee, but a clamped promise is still worth
 * fixing — and member prices themselves are honored as configured.
 */
function BundleDiscountWarning({
  settings,
  plans,
}: {
  settings: PricingSettings;
  plans: PublicPlan[];
}) {
  const d = settings.ebook.printBundleDiscountPct;
  if (d <= 0) return null;
  const buyers = buyerContextsFromPublicPlans(plans, settings);
  const losing = settings.currencies
    .map((c) => ({ c, impact: ebookWorstCaseImpact(settings, c, buyers) }))
    .filter((x) => x.impact != null && x.impact.underwaterAtList);
  if (losing.length === 0) return null;
  return (
    <ImpactNote>
      <span className="font-semibold">The cheapest reachable ebook price sells at a loss</span> in{" "}
      {losing
        .map(
          (x) =>
            `${x.c} (${x.impact!.buyerLabel} pays ${fmtMoney(x.impact!.listPrice, x.c)}, floor ${fmtMoney(minViableEbookPrice(settings, x.c), x.c)})`,
        )
        .join(", ")}
      : the fixed Stripe fee exceeds what&apos;s left of the price. Checkout clamps the automatic
      bundle discount so it can&apos;t cause this by itself, but member prices are honored as
      configured — raise the price, the member price, or lower the discount.
    </ImpactNote>
  );
}

/**
 * Fee-aware economics per currency at list, plus the cheapest reachable sale
 * when that sale actually differs from sticker.
 */
function EbookImpact({ settings, plans }: { settings: PricingSettings; plans: PublicPlan[] }) {
  const buyers = buyerContextsFromPublicPlans(plans, settings);
  const rows = settings.currencies
    .map((c) => ({
      c,
      sticker: ebookDiscountImpact(settings, c),
      worst: ebookWorstCaseImpact(settings, c, buyers),
    }))
    .filter((x) => x.sticker != null || x.worst != null);
  if (rows.length === 0) return null;
  const hasWorse = rows.some(
    (x) => x.worst != null && x.sticker != null && x.worst.listPrice < x.sticker.listPrice,
  );
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">Margin at list</h2>
        {hasWorse ? (
          <p className="mt-0.5 text-sm text-ink-500">
            Worst-case columns are the lowest member price with the print-owner discount stacked on
            top.
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-400">
              <th className="pb-2 font-medium">Currency</th>
              <th className="pb-2 font-medium">Price</th>
              <th className="pb-2 font-medium">Fee</th>
              <th className="pb-2 font-medium">You keep</th>
              <th className="pb-2 font-medium">Margin</th>
              <th className="pb-2 font-medium">Safe max off</th>
              <th className="pb-2 font-medium">Break-even</th>
              {hasWorse && <th className="pb-2 font-medium">Worst-case buyer</th>}
              {hasWorse && <th className="pb-2 font-medium">They pay → you keep</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, sticker, worst }) => {
              const impact = sticker ?? worst!;
              const wf = impact.atDiscount(0);
              const worstWf = worst?.atDiscount(0);
              const worstDiffers =
                worst != null && sticker != null && worst.listPrice < sticker.listPrice;
              const underwater = wf.netProfit < 0;
              return (
                <tr key={c} className="border-t border-ink-100">
                  <td className="py-2 pr-3 font-medium text-ink-800">{c}</td>
                  <td className="py-2 pr-3 text-ink-600">{fmtMoney(impact.listPrice, c)}</td>
                  <td className="py-2 pr-3 text-ink-600">{fmtMoney(wf.paymentFee, c)}</td>
                  <td className={`py-2 pr-3 font-medium ${underwater ? "text-rose-600" : "text-ink-800"}`}>
                    {fmtMoney(wf.netProfit, c)}
                  </td>
                  <td className="py-2 pr-3 text-ink-600">{wf.marginPct}%</td>
                  <td className="py-2 pr-3 font-medium text-ink-800">{impact.safeMaxDiscountPct}%</td>
                  <td className="py-2 pr-3 text-ink-600">{impact.breakEvenDiscountPct}%</td>
                  {hasWorse && (
                    <td className="py-2 pr-3 text-ink-600">{worstDiffers ? worst.buyerLabel : "—"}</td>
                  )}
                  {hasWorse && (
                    <td
                      className={`py-2 font-medium ${
                        worstDiffers && worstWf && worstWf.netProfit < 0
                          ? "text-rose-600"
                          : "text-ink-800"
                      }`}
                    >
                      {worstDiffers && worstWf
                        ? `${fmtMoney(worst.listPrice, c)} → ${fmtMoney(worstWf.netProfit, c)}`
                        : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
