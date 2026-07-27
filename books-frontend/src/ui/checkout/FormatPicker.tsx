"use client";

import { pickTier } from "../../core/config/productMath";
import type { PublicProduct } from "../../core/config/products";
import { bindingBlurb, bindingNoun, normalizePageCount, type BookProduct } from "../../core/fulfillment";
import { cn } from "../lib/cn";

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
  className?: string;
}) {
  const rows = formats
    .map((format) => describe(format, catalog.get(format.sku), contentPages, currency))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.sortOrder - b.sortOrder);

  // Nothing to choose between — the product summary already names the format.
  if (rows.length <= 1) return null;

  const selected = rows.find((r) => r.sku === value);
  const basePrice = selected?.price ?? null;

  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="text-[12px] font-semibold text-ink-800">Binding</legend>
      <p className="text-[11px] text-ink-500">
        How the book is held together. Every option prints the same pages at the same size.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const isSelected = row.sku === value;
          // Price difference from the current choice, at each binding's own page
          // count: a stapled book rounds its length differently to a hardcover,
          // and the charge follows that rounding.
          const delta =
            basePrice != null && row.price != null ? row.price - basePrice : null;
          return (
            <button
              key={row.sku}
              type="button"
              disabled={!row.fits && !isSelected}
              onClick={() => onChange(row.sku)}
              aria-pressed={isSelected}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left ring-1 ring-inset transition",
                isSelected
                  ? "bg-brand-50 ring-brand-300"
                  : row.fits
                    ? "bg-white ring-ink-200 hover:ring-ink-300"
                    : "cursor-not-allowed bg-ink-50 opacity-60 ring-ink-100",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium capitalize text-ink-800">{row.label}</span>
                {row.fits && delta != null && Math.abs(delta) >= 0.005 && (
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                    {delta > 0 ? "+" : "−"}
                    {Math.abs(delta).toFixed(2)}
                  </span>
                )}
              </span>
              <span className="text-[11px] leading-snug text-ink-500">
                {row.fits ? row.blurb : row.reason}
              </span>
              {row.fits && row.pageCount !== contentPages && (
                <span className="text-[10px] text-ink-400">
                  Printed as {row.pageCount} pages (this binding works in {row.pageStep}s)
                </span>
              )}
            </button>
          );
        })}
      </div>
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
  pageStep: number;
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
  const min = entry?.conditions.pages.min ?? format.minPages;
  const max = entry?.conditions.pages.max ?? format.maxPages;
  const pageCount = normalizePageCount(format, contentPages);
  const tier = entry?.priceTiers ? pickTier(entry.priceTiers, pageCount) : undefined;
  const price = tier?.prices[currency] ?? null;

  const short =
    contentPages < min
      ? `Needs at least ${min} pages — your book has ${contentPages}.`
      : contentPages > max
        ? `Takes up to ${max} pages — your book has ${contentPages}.`
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
    pageStep: format.pageStep,
    price,
  };
}
