/**
 * Pure assembly of an {@link OrderDraft} from already-rendered print assets.
 *
 * This is deliberately I/O-free: callers produce the print-ready blobs (via the
 * export pipeline) and pass them in. Keeping it pure means it runs identically
 * in the desktop client today and on a backend later.
 */
import { normalizePageCount } from "./lulu/products";
import type { BookProduct, OrderDraft, PrintAsset, Recipient, ShippingMethod } from "./types";

export interface BuildOrderDraftInput {
  product: BookProduct;
  copies: number;
  recipient: Recipient;
  shippingMethod: ShippingMethod;
  /** Multi-page interior PDF (single-page layout, not spreads). */
  interior: Blob;
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

  const assets: PrintAsset[] = [
    { printArea: areas.interior, blob: input.interior, pageCount: pages },
  ];
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
