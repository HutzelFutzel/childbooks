/**
 * What the storefront may actually sell, grouped the way a customer decides.
 *
 * A SIZE is a trim; a FORMAT is that trim bound one particular way. The design
 * flow picks the size (it sets the aspect every illustration is generated at) and
 * checkout picks the format among the siblings printed at that size. Both read
 * this hook, so neither can offer something the other — or the backend — refuses.
 */
import { useMemo } from "react";
import { bookProductForConfig } from "../../core/book";
import { offerablePublicProducts, type PublicProduct } from "../../core/config/products";
import { BOOK_PRODUCTS, type BookProduct } from "../../core/fulfillment";
import type { BookConfig } from "../../core/types";
import { useAppConfigStore } from "../../state/appConfigStore";

/** Stable key grouping products that share a physical trim (a "size"). */
export function trimKey(p: BookProduct): string {
  return `${p.trim.widthIn}x${p.trim.heightIn}`;
}

/** One size on sale: the trim, and the sellable formats printed at it. */
export interface SizeOption {
  key: string;
  /** Representative product for the trim — geometry only; any sibling would do. */
  rep: BookProduct;
  formats: BookProduct[];
  /** Entry price across those formats, or null when none is priced. */
  cheapest: number | null;
}

export interface OfferableFormats {
  /**
   * The sizes to offer as a choice. Only the sellable ones whenever any size is
   * sellable — picking a size we can't print is a trap, and it's one the reader
   * can't undo later without re-generating every illustration.
   *
   * When NOTHING is sellable (a catalog nobody has activated yet, or one whose
   * products all fail validation) this is every physical trim instead, with
   * `purchasable` false. There's no trap left to protect anyone from at that
   * point, and refusing to let someone choose a page shape wouldn't reopen the
   * shop — it would just stop them making their book.
   */
  sizes: SizeOption[];
  /** Whether `sizes` can actually be ordered, as opposed to only designed in. */
  purchasable: boolean;
  /** Every sellable format, across all sizes. */
  formats: BookProduct[];
  /** The admin catalog entry for each sellable format, by base SKU. */
  offerable: Map<string, PublicProduct>;
  currency: string;
  /** Whether the catalog has arrived, so "nothing on sale" can be told from "not yet known". */
  catalogLoaded: boolean;
}

export function useOfferableFormats(): OfferableFormats {
  const publicProducts = useAppConfigStore((s) => s.products.products);
  const loaded = useAppConfigStore((s) => s.loaded);
  const currency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);

  return useMemo(() => {
    const offerable = new Map(
      offerablePublicProducts(publicProducts).map((p) => [p.sku, p] as const),
    );
    const formats = BOOK_PRODUCTS.filter((p) => offerable.has(p.sku));
    const priceOf = (p: BookProduct) => offerable.get(p.sku)?.prices[currency];
    const group = (list: readonly BookProduct[]): SizeOption[] => {
      const byTrim = new Map<string, BookProduct[]>();
      for (const p of list) {
        const siblings = byTrim.get(trimKey(p));
        if (siblings) siblings.push(p);
        else byTrim.set(trimKey(p), [p]);
      }
      return [...byTrim.entries()].map(([key, siblings]) => {
        const prices = siblings
          .map(priceOf)
          .filter((v): v is number => typeof v === "number" && v > 0);
        return {
          key,
          rep: siblings[0],
          formats: siblings,
          cheapest: prices.length > 0 ? Math.min(...prices) : null,
        };
      });
    };
    const purchasable = formats.length > 0;
    return {
      sizes: group(purchasable ? formats : BOOK_PRODUCTS),
      purchasable,
      formats,
      offerable,
      currency,
      catalogLoaded: loaded && publicProducts.length > 0,
    };
  }, [publicProducts, loaded, currency]);
}

/** The sellable formats printed at a config's chosen size. */
export function useFormatsForConfigSize(config: BookConfig): {
  formats: BookProduct[];
  offerable: Map<string, PublicProduct>;
  currency: string;
} {
  const { sizes, offerable, currency } = useOfferableFormats();
  const current = bookProductForConfig(config);
  const formats = useMemo(
    () => sizes.find((s) => s.key === trimKey(current))?.formats ?? [],
    [sizes, current],
  );
  return { formats, offerable, currency };
}
