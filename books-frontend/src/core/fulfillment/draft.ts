/**
 * Pure assembly of an {@link OrderDraft}.
 *
 * Deliberately I/O-free, so it runs identically wherever the print files came
 * from. Since assembly moved to the backend the usual case is that the files
 * are ALREADY hosted and the draft carries no blobs at all — the order is
 * placed against a render the server holds, addressed by fingerprint. Blobs
 * remain supported for any caller that still has them in hand.
 */
import { normalizePageCount } from "./lulu/products";
import type { BookProduct, OrderDraft, PrintAsset, Recipient, ShippingMethod } from "./types";

export interface BuildOrderDraftInput {
  product: BookProduct;
  copies: number;
  recipient: Recipient;
  shippingMethod: ShippingMethod;
  /**
   * Multi-page interior PDF (one printed leaf per page, not spreads). Omitted
   * when the file is already hosted server-side.
   */
  interior?: Blob;
  /** Number of interior pages (will be normalized to the product's constraints). */
  pageCount: number;
  /** Cover PDF (back + spine + front). Lulu takes a single wraparound cover. */
  cover?: Blob;
  /** Two-letter ISO destination country code. */
  destinationCountry: string;
  /** Three-letter ISO currency code. */
  currency: string;
  merchantReference?: string;
  /** Public callback URL (backend only). */
  callbackUrl?: string;
}

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildOrderDraft(input: BuildOrderDraftInput): OrderDraft {
  const pages = normalizePageCount(input.product, input.pageCount);
  const areas = input.product.printAreas;

  const assets: PrintAsset[] = [];
  if (input.interior) {
    assets.push({ printArea: areas.interior, blob: input.interior, pageCount: pages });
  }
  if (input.cover && areas.cover) {
    assets.push({ printArea: areas.cover, blob: input.cover });
  }

  return {
    productSku: input.product.sku,
    copies: input.copies,
    recipient: input.recipient,
    shippingMethod: input.shippingMethod,
    assets,
    destinationCountry: input.destinationCountry,
    currency: input.currency,
    merchantReference: input.merchantReference,
    idempotencyKey: newIdempotencyKey(),
    callbackUrl: input.callbackUrl,
  };
}
