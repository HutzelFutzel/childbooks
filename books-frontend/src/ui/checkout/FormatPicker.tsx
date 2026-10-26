"use client";

import { useState } from "react";
import { LayoutGroup } from "framer-motion";
import { optionMediaKey, resolvedPhotosFor, type CatalogPhoto } from "../../core/config/catalogMedia";
import { pickTier } from "../../core/config/productMath";
import type { PublicProduct } from "../../core/config/products";
import { bindingBlurb, bindingNoun, type BookProduct } from "../../core/fulfillment";
import { formatMoneyDelta } from "../../core/i18n/format";
import { limitsOf, planPageCount, type PageCountPlan } from "../../core/print/pageCountPlan";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";
import { MediaLightboxModal } from "./MediaLightboxModal";
import { OptionTile } from "./OptionTile";

/**
 * Customer-facing binding picker: hardcover, softcover, stapled, coil.
 *
 * This lives at checkout rather than in the design flow because binding changes
 * nothing about the pages — only the cover geometry and the page count the
 * bindery will accept. Asking it here means the page count is finally known, so
 * a length a binding can't take is shown as an unavailable option with its
 * reason, instead of the design flow letting someone choose stapled and only
 * finding out at the end that their book is too thick for it.
 *
 * All the formats passed in share the book's trim, so switching between them
 * never invalidates a single illustration.
 */
export function FormatPicker({
  formats,
  catalog,
  value,
  onChange,
  contentPages,
  currency = "USD",
  locale = "en",
  className,
}: {
  /** The sellable formats printed at this book's size. */
  formats: readonly BookProduct[];
  /** Admin catalog entries by base SKU — authoritative for page limits and price. */
  catalog: Map<string, PublicProduct>;
  /** Base SKU of the selected format. */
  value: string;
  onChange: (sku: string) => void;
  /** Interior pages the book actually has, before rounding to a binding's step. */
  contentPages: number;
  currency?: string;
  /** The reader's locale, for how the price differences are written. */
  locale?: string;
  className?: string;
}) {
  const media = useAppConfigStore((s) => s.catalogMedia);
  // Kept after closing so the lightbox can play its exit with the photos still in it.
  const [gallery, setGallery] = useState<{ open: boolean; title: string; photos: readonly CatalogPhoto[] }>({
    open: false,
    title: "",
    photos: [],
  });
  const rows = formats
    .map((format) => ({
      ...describe(format, catalog.get(format.sku), contentPages, currency),
      photos: resolvedPhotosFor(media, optionMediaKey("binding", format.binding)),
    }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.sortOrder - b.sortOrder);

  // Nothing to choose between — the product summary already names the format.
  if (rows.length <= 1) return null;

  const selected = rows.find((r) => r.sku === value);
  const basePrice = selected?.price ?? null;
  // A picture area only when somebody has uploaded one. All-text cards are the
  // honest answer to "no photos yet"; one lone photo among blanks is not.
  const showVisual = rows.some((r) => r.photos.length > 0);

  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-[13px] font-semibold text-ink-800">Binding</legend>
      <p className="-mt-2 text-[11px] text-ink-500">
        How the book is held together. Every option prints the same pages at the same size.
      </p>
      <LayoutGroup id="binding-picker">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {rows.map((row) => {
            const isSelected = row.sku === value;
            // Price difference from the current choice, at each binding's own page
            // count: a stapled book rounds its length differently to a hardcover,
            // and the charge follows that rounding.
            const delta = basePrice != null && row.price != null ? row.price - basePrice : null;
            return (
              <OptionTile
                key={row.sku}
                label={row.label}
                description={row.fits ? row.blurb : undefined}
                delta={
                  row.fits && delta != null && Math.abs(delta) >= 0.005
                    ? formatMoneyDelta(locale, delta, currency)
                    : null
                }
                selected={isSelected}
                disabled={!row.fits}
                disabledReason={row.reason}
                onSelect={() => onChange(row.sku)}
                photos={row.photos}
                kind="plain"
                showVisual={showVisual}
                onOpenPhotos={() => setGallery({ open: true, title: row.label, photos: row.photos })}
                note={
                  // The arithmetic lives in the order summary. It's repeated on a card
                  // only where the padding is large enough to be a reason to pick
                  // another binding — on every card it read as noise.
                  row.fits && row.plan.status === "padded-heavy" ? (
                    <span className="text-[10px] text-ink-500">
                      {row.plan.story} + {row.plan.blank} blank = {row.pageCount} printed pages
                    </span>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      </LayoutGroup>
      <MediaLightboxModal
        isOpen={gallery.open}
        onClose={() => setGallery((g) => ({ ...g, open: false }))}
        title={gallery.title}
        subtitle="Binding"
        photos={gallery.photos}
      />
    </fieldset>
  );
}

interface FormatRow {
  sku: string;
  label: string;
  blurb: string;
  sortOrder: number;
  /** Whether this binding accepts the book's length. */
  fits: boolean;
  /** Why it doesn't, when it doesn't — phrased for the person reading it. */
  reason: string;
  /** The length this binding would actually be printed at. */
  pageCount: number;
  plan: PageCountPlan;
  /** Tier price at that length, or null when the format isn't priced. */
  price: number | null;
}

function describe(
  format: BookProduct,
  entry: PublicProduct | undefined,
  contentPages: number,
  currency: string,
): FormatRow {
  // The admin catalog wins over the provider catalog's own limits: an admin can
  // narrow what we're willing to sell, and the backend enforces their number.
  //
  // Only a book LONGER than the binding holds is unavailable. A short one is
  // padded with blank pages (and says so), so no binding is ever greyed out for
  // being the wrong length in the other direction.
  const limits = limitsOf(format, entry);
  const plan = planPageCount(contentPages, limits);
  const pageCount = plan.printed;
  const tier = entry?.priceTiers ? pickTier(entry.priceTiers, pageCount) : undefined;
  const price = tier?.prices[currency] ?? null;

  const short =
    plan.status === "too-long"
      ? `Takes up to ${limits.max} pages — your book has ${contentPages}.`
      : "";

  return {
    sku: format.sku,
    // Deliberately not the catalog's product name: that's the whole format
    // ("Square hardcover · 8.5 × 8.5″"), and repeating a size the customer
    // already chose is what made the old picker read as a second size question.
    label: bindingNoun(format.binding),
    blurb: bindingBlurb(format.binding),
    sortOrder: entry?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    fits: short === "",
    reason: short,
    pageCount,
    plan,
    price,
  };
}
