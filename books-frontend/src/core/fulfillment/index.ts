/**
 * Public surface of the fulfillment layer. Import provider-agnostic types and
 * helpers from here; never reach into provider-specific subfolders from UI code.
 */
export * from "./types";
export { FulfillmentError, fulfillmentKindFromStatus } from "./errors";
export type { FulfillmentErrorKind } from "./errors";
export { buildOrderDraft, type BuildOrderDraftInput } from "./draft";
/**
 * Provider-neutral catalog surface. The active provider (Lulu) supplies the
 * concrete products; UI/domain code imports `BOOK_PRODUCTS` from here and never
 * reaches into a provider subfolder, so swapping providers is a one-file change.
 */
export {
  LULU_BOOK_PRODUCTS as BOOK_PRODUCTS,
  findBookProduct,
  normalizePageCount,
} from "./lulu/products";
