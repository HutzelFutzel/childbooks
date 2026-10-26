"use client";

import { useState } from "react";
import { LayoutGroup } from "framer-motion";
import { resolvedPhotosFor, type CatalogMediaConfig, type CatalogPhoto } from "../../core/config/catalogMedia";
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
import { formatMoneyDelta } from "../../core/i18n/format";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";
import { MediaLightboxModal } from "./MediaLightboxModal";
import { OptionDetail, OptionTile, type SwatchKind } from "./OptionTile";

/**
 * Customer-facing print / paper / finish / linen / foil picker. Driven entirely by the
 * product's public variant policy — disabled options are ones that can't form
 * an orderable combination with the current selection (e.g. cream + colour).
 */
export function VariantPicker({
  policy,
  value,
  onChange,
  currency = "USD",
  locale = "en",
  pages = 0,
  media: mediaOverride,
  visibleAxes = VARIANT_AXES,
  className,
}: {
  policy: ProductVariantPolicy;
  value: VariantSelection;
  onChange: (next: VariantSelection) => void;
  currency?: string;
  /** The reader's locale, for how the price differences are written. */
  locale?: string;
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
  // Kept after closing so the lightbox can play its exit with the photos still in it.
  const [gallery, setGallery] = useState<{
    open: boolean;
    title: string;
    subtitle: string;
    photos: readonly CatalogPhoto[];
  }>({ open: false, title: "", subtitle: "", photos: [] });

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
    <div className={cn("space-y-6", className)}>
      {axes.map((axis) => {
        const def = VARIANT_AXIS_DEFS[axis];
        const values = offeredValues(policy, axis);
        const options = values.map((v) => {
          const opt = variantOptionDef(axis, v);
          return {
            v,
            opt,
            photos: resolvedPhotosFor(media, variantMediaKey(axis, v)),
            kind: swatchKindFor(axis, v, Boolean(opt?.swatch)),
          };
        });
        // A picture area only where there is something to put in it — an upload,
        // a swatch, or a drawn stand-in. An axis with none stays plain text, which
        // is what the print/paper rows on the pricing page want.
        const showVisual = options.some((o) => o.photos.length > 0 || o.opt?.swatch || o.kind !== "plain");
        // Long rows of materials (six cloths, three foils) read as a palette: small
        // square chips, with the selected one described underneath.
        const chip = showVisual && (axis === "linen" || axis === "foil" || values.length > 4);
        const current = options.find((o) => o.v === value[axis]);
        const open = (o: (typeof options)[number]) =>
          setGallery({ open: true, title: o.opt?.label ?? o.v, subtitle: def.label, photos: o.photos });

        return (
          <fieldset key={axis} className="space-y-3">
            <legend className="text-[13px] font-semibold text-ink-800">{def.label}</legend>
            <p className="-mt-2 text-[11px] text-ink-500">{def.hint}</p>
            <LayoutGroup id={`variant-${axis}`}>
              <div className={cn("grid gap-2.5", chip ? CHIP_GRID : "sm:grid-cols-2")}>
                {options.map((o) => {
                  const selected = value[axis] === o.v;
                  const ok = optionSelectable(policy, axis, o.v, value);
                  // Delta of switching ONLY this axis — clearer while shopping
                  // than the absolute surcharge of the whole selection.
                  const switchDelta =
                    axisDelta(policy, axis, o.v, currency, pages) -
                    axisDelta(policy, axis, value[axis], currency, pages);
                  return (
                    <OptionTile
                      key={o.v}
                      label={o.opt?.label ?? o.v}
                      description={o.opt?.hint}
                      delta={
                        Math.abs(switchDelta) >= 0.005 && ok
                          ? formatMoneyDelta(locale, switchDelta, currency)
                          : null
                      }
                      selected={selected}
                      disabled={!ok}
                      onSelect={() => pick(axis, o.v)}
                      photos={o.photos}
                      swatch={o.opt?.swatch}
                      kind={o.kind}
                      showVisual={showVisual}
                      layout={chip ? "chip" : "card"}
                      onOpenPhotos={() => open(o)}
                    />
                  );
                })}
              </div>
            </LayoutGroup>
            {chip && current && (
              <OptionDetail
                id={`${axis}:${current.v}`}
                label={current.opt?.label ?? current.v}
                description={current.opt?.hint}
                photos={current.photos}
                swatch={current.opt?.swatch}
                kind={current.kind}
                onOpenPhotos={() => open(current)}
              />
            )}
          </fieldset>
        );
      })}
      <MediaLightboxModal
        isOpen={gallery.open}
        onClose={() => setGallery((g) => ({ ...g, open: false }))}
        title={gallery.title}
        subtitle={gallery.subtitle}
        photos={gallery.photos}
      />
    </div>
  );
}

/** What to draw for an option nobody has photographed. */
function swatchKindFor(axis: VariantAxisId, value: string, hasSwatch: boolean): SwatchKind {
  if (axis === "linen") return hasSwatch ? "cloth" : "plain";
  if (axis === "foil") return hasSwatch ? "foil" : "plain";
  if (axis === "finish") return value === "gloss" ? "gloss" : value === "matte" ? "matte" : "plain";
  return "plain";
}

// The same chip size whether there are three options or six, so a short row
// doesn't stretch into giant tiles next to a long one above it.
const CHIP_GRID = "grid-cols-3 sm:grid-cols-6";

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
