"use client";

import type { CurrencyCode, ProductDefinition } from "../../../../core/config/products";
import {
  VARIANT_AXES,
  VARIANT_AXIS_DEFS,
  offeredValues,
  variantMediaKey,
  variantOptionDef,
  variantOptionsFor,
  variantSummary,
  type ProductVariantPolicy,
  type VariantAxisId,
  type VariantChoice,
  type VariantMatch,
  type VariantSelection,
} from "../../../../core/config/variants";
import { variantFromSku } from "../../../../core/fulfillment/lulu/skuAxes";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Field } from "../../../components/Input";
import { cn } from "../../../lib/cn";
import { PictureButton } from "./Pictures";
import { Section } from "./parts";

type Update = (fn: (d: ProductDefinition) => ProductDefinition) => void;

/**
 * Which print / paper / finish options this format offers, and what each adds
 * to the page-tier price. The product's own SKU is the base variant — its
 * options stay locked on with a zero delta; everything else is an upgrade (or
 * a cheaper alternative with a negative delta).
 */
export function VariantsSection({ product, update }: { product: ProductDefinition; update: Update }) {
  const currencies = useAppConfigStore((s) => s.pricingSettings.currencies);
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

  const setDelta = (axis: VariantAxisId, value: string, currency: CurrencyCode, amount: number) => {
    if (base?.[axis] === value) return;
    const options = policy.options[axis].map((o) => {
      if (o.value !== value) return o;
      const priceDelta = { ...(o.priceDelta ?? {}) };
      if (!Number.isFinite(amount) || amount === 0) delete priceDelta[currency];
      else priceDelta[currency] = amount;
      return Object.keys(priceDelta).length > 0 ? { ...o, priceDelta } : { value: o.value };
    });
    setPolicy({ ...policy, options: { ...policy.options, [axis]: options } });
  };

  const removeExclusion = (idx: number) => {
    setPolicy({ ...policy, exclusions: policy.exclusions.filter((_, i) => i !== idx) });
  };

  return (
    <Section
      title="Variants"
      hint="Choices a customer makes about this same book — print quality, paper, cover finish. They compose a different provider SKU at checkout; you don't need a product record for each. The base SKU above is the priced default; other options add (or subtract) a per-copy delta."
    >
      {base ? (
        <p className="rounded-md bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
          Base variant: <span className="font-medium text-ink-800">{variantSummary(base)}</span>
          {" — "}page-tier prices apply to this one; its options can't be turned off.
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
          onDelta={(value, currency, amount) => setDelta(axis, value, currency, amount)}
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
  onDelta: (value: string, currency: CurrencyCode, amount: number) => void;
}) {
  const def = VARIANT_AXIS_DEFS[axis];
  const offered = new Set(offeredValues(policy, axis));
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
                  <div className="flex flex-wrap gap-2 pl-6">
                    {currencies.map((currency) => (
                      <label key={currency} className="flex items-center gap-1 text-[11px] text-ink-500">
                        <span className="w-8">{currency}</span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 rounded border border-ink-200 px-1.5 py-0.5 text-[12px] text-ink-800"
                          value={choice?.priceDelta?.[currency] ?? ""}
                          placeholder="0"
                          onChange={(e) => {
                            const raw = e.target.value;
                            onDelta(opt.value, currency, raw === "" ? 0 : Number(raw));
                          }}
                        />
                      </label>
                    ))}
                    <span className="self-center text-[10px] text-ink-400">per copy vs base</span>
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
