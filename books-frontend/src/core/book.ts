/**
 * Bridge between a project's saved config and the physical book product.
 *
 * `BookConfig.productSku` is the source of truth for real trim size + format.
 * The coarse `bookSize` shape (square/landscape/portrait) is kept for image
 * generation and prompts and is derived from the product. Older projects saved
 * before products existed fall back to a product matching their `bookSize`.
 */
import { bookSizeFromAspect, type BookSize } from "./config/options";
import {
  BOOK_PRODUCTS,
  findBookProduct,
  type BookProduct,
} from "./fulfillment";

type ConfigLike = { productSku?: string; bookSize?: BookSize };

/** Resolve the physical book product for a config, with legacy fallbacks. */
export function bookProductForConfig(config: ConfigLike): BookProduct {
  if (config.productSku) {
    const exact = findBookProduct(config.productSku);
    if (exact) return exact;
  }
  if (config.bookSize) {
    const byShape = BOOK_PRODUCTS.find(
      (p) => bookSizeFromAspect(p.aspect) === config.bookSize,
    );
    if (byShape) return byShape;
  }
  return BOOK_PRODUCTS[0];
}

/** Single-page trim (inches) for a config's chosen product. */
export function pageTrimForConfig(config: ConfigLike): { widthIn: number; heightIn: number } {
  return bookProductForConfig(config).trim;
}
