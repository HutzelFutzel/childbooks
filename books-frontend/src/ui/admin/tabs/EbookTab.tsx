"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
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
import { Grid, ImpactNote, NumberField, Section, TabIntro, fmtMoney } from "./products/parts";

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
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            Special pricing for subscribers (cheaper, or included free) is set per plan under{" "}
            <span className="font-medium">Memberships</span>. Currencies, the Stripe fee and tax
            behaviour that drive the margin come from <span className="font-medium">Financial settings</span>.
          </>
        }
        links={[
          { label: "Member pricing (Memberships)", onClick: () => setConfigTab("memberships") },
          { label: "Financial settings", onClick: () => setConfigTab("financial") },
        ]}
      >
        The <span className="font-medium">digital edition</span> is your customer&apos;s finished book
        sold as a downloadable PDF. It has almost no marginal cost, so nearly the whole price (minus
        the Stripe fee) is profit — a high-margin add-on to every print sale.
      </TabIntro>

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => { setDraft(stored); setDirty(false); }}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
          Save digital edition
        </Button>
      </div>

      <Section
        title="Availability"
        hint="The master switch. When off, the ebook option disappears everywhere — the storefront, the order step and checkout — with no other change to the app."
        action={
          <Toggle
            checked={ebook.enabled}
            onChange={(v) => setEbook({ enabled: v })}
            label="Sell the digital edition"
          />
        }
      >
        <p className="text-[11px] text-ink-500">
          {ebook.enabled
            ? "Customers can buy the digital edition of any finished book."
            : "The digital edition is hidden from customers."}
        </p>
      </Section>

      <Section
        title="Price"
        hint="The regular (non-subscriber) sticker price per currency. This is what a customer with no membership pays."
      >
        <Grid cols={4}>
          {draft.currencies.map((c) => (
            <NumberField
              key={c}
              label={`Price (${c})`}
              value={ebook.prices[c] ?? 0}
              step="0.5"
              suffix={c}
              onChange={(n) => setEbook({ prices: { ...ebook.prices, [c]: n } })}
            />
          ))}
        </Grid>
        <ImpactNote>
          A price of <span className="font-semibold">0</span> in a currency disables the ebook for
          everyone paying in that currency — including subscribers, no matter their member price.
          Set a real price in every currency you want to sell in.
        </ImpactNote>
      </Section>

      <Section
        title="Bundle discount"
        hint="An automatic discount when the buyer already ordered a printed copy of the same book — a gentle nudge to add the digital edition after a print purchase."
      >
        <NumberField
          label="Discount for print owners"
          value={ebook.printBundleDiscountPct}
          step="5"
          suffix="%"
          className="w-56"
          onChange={(n) => setEbook({ printBundleDiscountPct: n })}
        />
        <p className="text-[11px] text-ink-400">
          Applied automatically at checkout when the buyer has a paid print order for this book.
          {ebook.printBundleDiscountPct > 0
            ? ` Print owners pay ${ebook.printBundleDiscountPct}% less.`
            : " Set above 0 to offer it."}
        </p>
        <BundleDiscountWarning settings={draft} plans={plans} />
      </Section>

      <EbookImpact settings={draft} plans={plans} />

      <Section
        title="Tax"
        hint="Stripe Tax computes and collects the real amount per destination. Downloadable books are taxed differently from physical ones in many regions, so they get their own product tax code."
      >
        <Field label="Stripe product tax code (digital books)" className="w-full sm:w-80">
          <Input
            value={ebook.taxCode ?? ""}
            placeholder="txcd_10302000"
            onChange={(e) => setEbook({ taxCode: e.target.value || undefined })}
          />
        </Field>
      </Section>
    </div>
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
 * "What this means for the business" — the ebook's fee-aware economics per
 * currency, twice: at the sticker price, and for the WORST-CASE buyer (the
 * lowest member price of any active plan, with the print-bundle discount
 * stacked on top — exactly the price checkout can produce).
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
  // Only show the worst-case columns when some buyer actually pays less than sticker.
  const hasWorse = rows.some(
    (x) => x.worst != null && x.sticker != null && x.worst.listPrice < x.sticker.listPrice,
  );
  return (
    <Section
      title="Business impact"
      hint={`Per currency: what one ebook sale earns after the Stripe fee and (where prices are tax-inclusive) tax — plus the deepest discount that keeps your margin floor, and the break-even.${
        hasWorse
          ? " The worst-case columns price the cheapest reachable sale: the lowest member price with the print-bundle discount stacked on top."
          : ""
      }`}
    >
      <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-ink-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-ink-50/70 text-left text-[11px] uppercase tracking-wide text-ink-400">
              <th className="px-3 py-2 font-semibold">Currency</th>
              <th className="px-3 py-2 font-semibold">Price</th>
              <th className="px-3 py-2 font-semibold">Payment fee</th>
              <th className="px-3 py-2 font-semibold">You keep</th>
              <th className="px-3 py-2 font-semibold">Margin</th>
              <th className="px-3 py-2 font-semibold">Safe max discount</th>
              <th className="px-3 py-2 font-semibold">Break-even</th>
              {hasWorse && <th className="px-3 py-2 font-semibold">Worst-case buyer</th>}
              {hasWorse && <th className="px-3 py-2 font-semibold">They pay → you keep</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, sticker, worst }) => {
              const impact = sticker ?? worst!;
              const wf = impact.atDiscount(0);
              const worstWf = worst?.atDiscount(0);
              const worstDiffers =
                worst != null && sticker != null && worst.listPrice < sticker.listPrice;
              return (
                <tr key={c} className="border-t border-ink-50">
                  <td className="px-3 py-2 font-medium text-ink-800">{c}</td>
                  <td className="px-3 py-2 text-ink-600">{fmtMoney(impact.listPrice, c)}</td>
                  <td className="px-3 py-2 text-ink-600">{fmtMoney(wf.paymentFee, c)}</td>
                  <td className={`px-3 py-2 font-semibold ${wf.netProfit < 0 ? "text-rose-600" : "text-ink-800"}`}>
                    {fmtMoney(wf.netProfit, c)}
                  </td>
                  <td className="px-3 py-2 text-ink-600">{wf.marginPct}%</td>
                  <td className="px-3 py-2 font-semibold text-ink-800">{impact.safeMaxDiscountPct}%</td>
                  <td className="px-3 py-2 text-ink-600">{impact.breakEvenDiscountPct}%</td>
                  {hasWorse && (
                    <td className="px-3 py-2 text-ink-600">
                      {worstDiffers ? worst.buyerLabel : "—"}
                    </td>
                  )}
                  {hasWorse && (
                    <td
                      className={`px-3 py-2 font-semibold ${
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
    </Section>
  );
}
