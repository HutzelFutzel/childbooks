"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import type {
  CurrencyCode,
  PricingSettings,
  ProductDefinition,
} from "../../../../core/config/products";
import { suggestVariantDeltas } from "../../../../core/config/productMath";
import { Button } from "../../../components/Button";
import {
  VARIANT_AXES,
  VARIANT_AXIS_DEFS,
  VARIANT_COST_AXES,
  emptyVariantDelta,
  offeredValues,
  variantDeltaIsZero,
  variantMediaKey,
  variantOptionDef,
  variantOptionsFor,
  variantSummary,
  type ProductVariantPolicy,
  type VariantAxisId,
  type VariantChoice,
  type VariantDelta,
  type VariantMatch,
  type VariantSelection,
} from "../../../../core/config/variants";
import { variantFromSku } from "../../../../core/fulfillment/lulu/skuAxes";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Field } from "../../../components/Input";
import { cn } from "../../../lib/cn";
import { PictureButton } from "./Pictures";
import { Section, TabIntro } from "./parts";

type Update = (fn: (d: ProductDefinition) => ProductDefinition) => void;

/**
 * Which print / paper / finish options this format offers, and what each adds
 * to the page-tier price. The product's own SKU is the base variant — its
 * options stay locked on with a zero delta; everything else is an upgrade (or
 * a cheaper alternative with a negative delta).
 */
export function VariantsSection({ product, update }: { product: ProductDefinition; update: Update }) {
  const settings = useAppConfigStore((s) => s.pricingSettings);
  const currencies = settings.currencies;
  const base = variantFromSku(product.provider.sku);
  const policy = product.variants;

  const setPolicy = (next: ProductVariantPolicy) =>
    update((d) => ({ ...d, variants: next }));

  const toggle = (axis: VariantAxisId, value: string) => {
    if (base?.[axis] === value) return; // base stays offered
    const current = offeredValues(policy, axis);
    const on = current.includes(value);
    const options: VariantChoice[] = on
      ? policy.options[axis].filter((o) => o.value !== value)
      : [...policy.options[axis], { value }];
    setPolicy({ ...policy, options: { ...policy.options, [axis]: options } });
  };

  const setDelta = (
    axis: VariantAxisId,
    value: string,
    currency: CurrencyCode,
    part: keyof VariantDelta,
    amount: number,
  ) => {
    if (base?.[axis] === value) return;
    const options = policy.options[axis].map((o) => {
      if (o.value !== value) return o;
      const priceDelta = { ...(o.priceDelta ?? {}) };
      const next: VariantDelta = {
        ...emptyVariantDelta(),
        ...priceDelta[currency],
        [part]: Number.isFinite(amount) ? amount : 0,
      };
      if (variantDeltaIsZero(next)) delete priceDelta[currency];
      else priceDelta[currency] = next;
      return Object.keys(priceDelta).length > 0 ? { ...o, priceDelta } : { value: o.value };
    });
    setPolicy({ ...policy, options: { ...policy.options, [axis]: options } });
  };

  const removeExclusion = (idx: number) => {
    setPolicy({ ...policy, exclusions: policy.exclusions.filter((_, i) => i !== idx) });
  };

  return (
    <>
      <TabIntro>
        Variants are choices about the <span className="font-medium">same book</span> — print quality,
        paper, cover finish. Each one composes a different SKU at the printer, so you don&apos;t need a
        separate product for each. The <span className="font-medium">base</span> variant is the one this
        product&apos;s SKU already encodes and the one your page prices are quoted for; everything else
        is priced as a difference from it. Paper and print quality change what a{" "}
        <span className="font-medium">page</span> costs, so price those per page — measure costs first
        and let <span className="font-medium">Suggest</span> work them out.
      </TabIntro>

      <SuggestDeltas product={product} settings={settings} setPolicy={setPolicy} />

      <Section
        title="Variants"
        hint="Turn on the options you want to sell, then price each one against the base. An option you enable must be one the printer actually offers for this format — measuring costs will tell you if it isn't."
      >
        {base ? (
          <p className="rounded-md bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
            Base variant: <span className="font-medium text-ink-800">{variantSummary(base)}</span>
            {" — "}page-tier prices apply to this one; its options can&apos;t be turned off.
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            Set a recognised provider SKU first — until then there is no base variant to offer.
          </p>
        )}

        {VARIANT_AXES.map((axis) => (
          <AxisEditor
            key={axis}
            axis={axis}
            base={base}
            policy={policy}
            currencies={currencies}
            onToggle={(value) => toggle(axis, value)}
            onDelta={(value, currency, part, amount) => setDelta(axis, value, currency, part, amount)}
          />
        ))}

        {policy.exclusions.length > 0 && (
          <Field label="Exclusions" hint="Combinations the provider doesn't sell. Measured, not guessed.">
            <ul className="space-y-1">
              {policy.exclusions.map((rule, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md bg-ink-50 px-2 py-1.5 text-[12px] text-ink-700"
                >
                  <span>{exclusionLabel(rule)}</span>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-ink-500 hover:text-ink-800"
                    onClick={() => removeExclusion(i)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </Field>
        )}
      </Section>
    </>
  );
}

/**
 * Price every option from what it was measured to cost.
 *
 * The alternative is typing a per-page rate to four decimals for each option in
 * each currency, which nobody will do accurately and which has to be redone
 * whenever fees, tax or the target margin move. Deriving it means an upgrade
 * earns the same margin as the base book at every length, by construction.
 */
function SuggestDeltas({
  product,
  settings,
  setPolicy,
}: {
  product: ProductDefinition;
  settings: PricingSettings;
  setPolicy: (next: ProductVariantPolicy) => void;
}) {
  const [target, setTarget] = useState(() => settings.minMarginPct + 15);
  const measured = Object.keys(product.cost.variantPerPage ?? {}).length;

  const apply = () => {
    const next = suggestVariantDeltas(product, settings, target);
    if (!next) {
      toast.error("Measure costs first — there's nothing to derive these from yet.");
      return;
    }
    setPolicy(next);
    toast.success(`Variant prices set to earn ${target}% on the upgrade. Review before saving.`);
  };

  return (
    <Section
      title="Price variants from their cost"
      hint="Works out what to charge for each option so the upgrade earns the same margin as the book it's on — at any page count. Only touches paper and print quality, since cover finish costs the same either way. Replaces the numbers below."
      action={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Wand2 className="size-4" />}
          disabled={measured === 0}
          title={
            measured === 0
              ? "Measure costs on the Costs tab first — there's nothing to derive prices from."
              : "Fill in every option's per-page price from what it was measured to cost"
          }
          onClick={apply}
        >
          Suggest
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-ink-600">
          Margin to earn on the upgrade
          <input
            type="number"
            min={0}
            max={90}
            step="1"
            className="w-20 rounded border border-ink-200 px-1.5 py-0.5 text-[12px] text-ink-800"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value) || 0)}
          />
          <span className="text-ink-400">%</span>
        </label>
      </div>
      {measured === 0 ? (
        <p className="text-[11px] text-amber-700">
          No variant costs measured yet. Run <span className="font-medium">Measure cost from the provider</span>{" "}
          on the Costs tab, then come back.
        </p>
      ) : (
        <p className="text-[11px] text-ink-500">
          {measured} variant{measured === 1 ? " has" : "s have"} a measured cost to price from.
        </p>
      )}
    </Section>
  );
}

function AxisEditor({
  axis,
  base,
  policy,
  currencies,
  onToggle,
  onDelta,
}: {
  axis: VariantAxisId;
  base: VariantSelection | null;
  policy: ProductVariantPolicy;
  currencies: CurrencyCode[];
  onToggle: (value: string) => void;
  onDelta: (value: string, currency: CurrencyCode, part: keyof VariantDelta, amount: number) => void;
}) {
  const def = VARIANT_AXIS_DEFS[axis];
  const offered = new Set(offeredValues(policy, axis));
  // Only ink, quality and paper change what a page costs to make; a cover
  // finish costs the same at any length, so a per-page field there is noise.
  const costly = (VARIANT_COST_AXES as readonly VariantAxisId[]).includes(axis);
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[12px] font-semibold text-ink-800">{def.label}</p>
        <p className="text-[11px] text-ink-500">{def.hint}</p>
      </div>
      <div className="space-y-2">
        {variantOptionsFor(axis).map((opt) => {
          const isBase = base?.[axis] === opt.value;
          const on = offered.has(opt.value) || isBase;
          const choice = policy.options[axis].find((o) => o.value === opt.value);
          return (
            <div
              key={opt.value}
              className={cn(
                "flex items-start gap-3 rounded-lg px-2.5 py-2 ring-1 ring-inset",
                on ? "bg-white ring-ink-200" : "bg-ink-50/60 ring-ink-100 opacity-70",
              )}
            >
              <PictureButton
                mediaKey={variantMediaKey(axis, opt.value)}
                label={opt.label}
                hint={opt.hint}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={on}
                    disabled={isBase}
                    onChange={() => onToggle(opt.value)}
                  />
                  <span>
                    <span className="text-[12px] font-medium text-ink-800">
                      {opt.label}
                      {isBase && (
                        <span className="ml-1.5 rounded bg-brand-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                          base
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-ink-500">{opt.hint}</span>
                  </span>
                </label>
                {on && !isBase && (
                  <div className="space-y-1 pl-6">
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                      {currencies.map((currency) => (
                        <span key={currency} className="flex items-center gap-1 text-[11px] text-ink-500">
                          <span className="w-8 font-medium text-ink-600">{currency}</span>
                          <input
                            type="number"
                            step="0.01"
                            title={`Flat amount added per copy, whatever the length (${currency})`}
                            className="w-20 rounded border border-ink-200 px-1.5 py-0.5 text-[12px] text-ink-800"
                            value={choice?.priceDelta?.[currency]?.perCopy || ""}
                            placeholder="0"
                            onChange={(e) => {
                              const raw = e.target.value;
                              onDelta(opt.value, currency, "perCopy", raw === "" ? 0 : Number(raw));
                            }}
                          />
                          <span className="text-[10px] text-ink-400">/copy</span>
                          {costly && (
                            <>
                              <input
                                type="number"
                                step="0.001"
                                title={`Added per interior page (${currency}) — this is the one that matters for print upgrades`}
                                className="w-20 rounded border border-ink-200 px-1.5 py-0.5 text-[12px] text-ink-800"
                                value={choice?.priceDelta?.[currency]?.perPage || ""}
                                placeholder="0"
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  onDelta(opt.value, currency, "perPage", raw === "" ? 0 : Number(raw));
                                }}
                              />
                              <span className="text-[10px] text-ink-400">/page</span>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] leading-snug text-ink-400">
                      {costly
                        ? "Added to the page-tier price versus the base variant. This option changes what a page costs to print, so price it per page — a flat amount would earn on a short book and lose on a long one. Measure costs, then use Suggest to fill these in."
                        : "Added to the page-tier price versus the base variant. This option costs the same to produce at any length, so any charge here is positioning, not cost recovery."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function exclusionLabel(rule: VariantMatch): string {
  return VARIANT_AXES.filter((axis) => rule[axis])
    .map((axis) => variantOptionDef(axis, rule[axis]!)?.label ?? rule[axis])
    .join(" + ");
}
