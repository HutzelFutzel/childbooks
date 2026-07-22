"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import type { PricingSettings } from "../../../core/config/products";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { Grid, ImpactNote, NumberField, Section, TabIntro } from "./products/parts";

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
      </Section>

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
