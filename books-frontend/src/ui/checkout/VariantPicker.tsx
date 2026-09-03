"use client";

import { primaryPhotoFor, type CatalogMediaConfig } from "../../core/config/catalogMedia";
import {
  VARIANT_AXES,
  VARIANT_AXIS_DEFS,
  firstAllowedVariant,
  offeredValues,
  optionSelectable,
  variantMediaKey,
  variantOptionDef,
  type ProductVariantPolicy,
  type VariantAxisId,
  type VariantSelection,
} from "../../core/config/variants";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";

/**
 * Customer-facing print / paper / finish picker. Driven entirely by the
 * product's public variant policy — disabled options are ones that can't form
 * an orderable combination with the current selection (e.g. cream + colour).
 */
export function VariantPicker({
  policy,
  value,
  onChange,
  currency = "USD",
  pages = 0,
  media: mediaOverride,
  visibleAxes = VARIANT_AXES,
  className,
}: {
  policy: ProductVariantPolicy;
  value: VariantSelection;
  onChange: (next: VariantSelection) => void;
  currency?: string;
  /**
   * The book's length. Paper and print upgrades are priced per page, so the
   * surcharge shown next to each option is only right for the book actually
   * being ordered — a shared "+$4" would be a lie on anything but one length.
   */
  pages?: number;
  /**
   * Option photographs, for callers that already have them. The studio leaves
   * this unset and reads the live config store; the marketing pages pass a
   * server-fetched copy so a public page doesn't open twenty Firestore
   * subscriptions to show a handful of thumbnails.
   */
  media?: CatalogMediaConfig;
  /** Product attributes this surface intentionally lets a customer choose. */
  visibleAxes?: readonly VariantAxisId[];
  className?: string;
}) {
  const storeMedia = useAppConfigStore((s) => s.catalogMedia);
  const media = mediaOverride ?? storeMedia;

  // Hide axes with only one offered value — there's nothing to choose.
  const axes = visibleAxes.filter((axis) => offeredValues(policy, axis).length > 1);
  if (axes.length === 0) return null;

  const pick = (axis: VariantAxisId, nextValue: string) => {
    const next = { ...value, [axis]: nextValue };
    if (optionSelectable(policy, axis, nextValue, value)) {
      onChange(next);
      return;
    }
    // Picking an incompatible option (cream while on colour) snaps to the
    // nearest orderable variant that keeps the new choice.
    const fallback = firstAllowedVariant(policy, next);
    if (fallback) onChange(fallback);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {axes.map((axis) => {
        const def = VARIANT_AXIS_DEFS[axis];
        const values = offeredValues(policy, axis);
        return (
          <fieldset key={axis} className="space-y-2">
            <legend className="text-[12px] font-semibold text-ink-800">{def.label}</legend>
            <p className="text-[11px] text-ink-500">{def.hint}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {values.map((v) => {
                const opt = variantOptionDef(axis, v);
                const selected = value[axis] === v;
                const ok = optionSelectable(policy, axis, v, value);
                const photo = primaryPhotoFor(media, variantMediaKey(axis, v));
                // Delta of switching ONLY this axis — clearer while shopping
                // than the absolute surcharge of the whole selection.
                const switchDelta =
                  axisDelta(policy, axis, v, currency, pages) -
                  axisDelta(policy, axis, value[axis], currency, pages);
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={!ok && !selected}
                    onClick={() => pick(axis, v)}
                    aria-pressed={selected}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ring-1 ring-inset transition",
                      selected
                        ? "bg-brand-50 ring-brand-300"
                        : ok
                          ? "bg-white ring-ink-200 hover:ring-ink-300"
                          : "cursor-not-allowed bg-ink-50 ring-ink-100 opacity-50",
                    )}
                  >
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-ink-100 ring-1 ring-inset ring-ink-200">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.imageUrl} alt={photo.alt || opt?.label || v} className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[9px] font-medium uppercase tracking-wide text-ink-400">
                          {axis}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-medium text-ink-800">{opt?.label ?? v}</span>
                        {Math.abs(switchDelta) >= 0.005 && ok && (
                          <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                            {switchDelta > 0 ? "+" : ""}
                            {switchDelta.toFixed(2)}
                          </span>
                        )}
                      </span>
                      {opt?.hint && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{opt.hint}</span>
                      )}
                      {!ok && !selected && (
                        <span className="mt-0.5 block text-[10px] text-ink-400">
                          Not available with the current selection
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** One option's surcharge at this length, in this currency. */
function axisDelta(
  policy: ProductVariantPolicy,
  axis: VariantAxisId,
  value: string,
  currency: string,
  pages: number,
): number {
  const delta = policy.options[axis].find((o) => o.value === value)?.priceDelta?.[currency];
  return delta ? delta.perCopy + delta.perPage * Math.max(0, pages) : 0;
}
