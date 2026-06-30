/**
 * Fulfillment layer — provider-agnostic domain types and ports.
 *
 * The rest of the app (wizard, studio, export, checkout UI) depends ONLY on the
 * interfaces in this file. Concrete print providers (Lulu today, or a backend
 * proxy tomorrow) are adapters that implement {@link FulfillmentProvider},
 * and asset hosting is abstracted behind {@link AssetHost}. Swapping "direct from
 * the desktop client" for "calls to our backend" later is a wiring change in
 * `platform/fulfillment.ts`, not a change to any of these types or their callers.
 *
 * Keep this file pure data + interfaces (no I/O, no provider-specific shapes) so
 * it can move into a shared package once a backend exists.
 */

/** A monetary amount as returned by providers (decimal string + ISO currency). */
export interface Money {
  amount: string;
  currency: string;
}

/** Shipping speed tiers (mapped to each provider's own service names). */
export type ShippingMethod =
  | "Budget"
  | "Standard"
  | "StandardPlus"
  | "Express"
  | "Overnight";

export interface Address {
  line1: string;
  line2?: string;
  townOrCity: string;
  stateOrCounty?: string;
  postalOrZipCode: string;
  /** Two-letter ISO country code. */
  countryCode: string;
}

export interface Recipient {
  name: string;
  email?: string;
  phoneNumber?: string;
  address: Address;
}

/**
 * One print-ready file for an order item, bound to a named print area
 * (e.g. "default" for interior pages, "cover", "spine"). The blob is uploaded
 * via the {@link AssetHost} to a URL the provider can fetch.
 */
export interface PrintAsset {
  printArea: string;
  blob: Blob;
  /** Required for paginated products (books): the interior page count. */
  pageCount?: number;
}

/**
 * Everything needed to place an order, expressed in domain terms. Built by
 * {@link buildOrderDraft} and consumed by a {@link FulfillmentProvider}.
 */
export interface OrderDraft {
  /** Provider SKU of the chosen book product. */
  productSku: string;
  copies: number;
  recipient: Recipient;
  shippingMethod: ShippingMethod;
  /** Interior / cover print-ready files. */
  assets: PrintAsset[];
  /**
   * Already-hosted print files (public URLs). When present these are used
   * instead of uploading `assets` — set by payment-gated checkout, where the
   * files are uploaded up front and the order is placed later from a webhook
   * (which has no access to the original blobs).
   */
  sourceFileUrls?: { interior?: string; cover?: string };
  /** Two-letter ISO destination country code. */
  destinationCountry: string;
  /** Three-letter ISO currency code for quoting / customs. */
  currency: string;
  /** Price charged to the recipient — aids customs on international orders. */
  recipientCost?: Money;
  /** Your own reference for this order (e.g. the local project id). */
  merchantReference?: string;
  /** Stable key to guard against duplicate submissions. */
  idempotencyKey?: string;
  /** Public URL the provider posts status callbacks to (backend only). */
  callbackUrl?: string;
}

/** A lightweight request for a price/shipping quote (no print files needed). */
export interface QuoteRequest {
  productSku: string;
  copies: number;
  destinationCountry: string;
  currency?: string;
  shippingMethod?: ShippingMethod;
  /**
   * Interior page count to price. When omitted the provider falls back to the
   * product's minimum (a coarse estimate). Pass the book's real (normalized)
   * page count for an accurate quote.
   */
  pageCount?: number;
  /**
   * Destination address beyond the country. Some providers require a full
   * address (street/city/state/postcode) to price shipping accurately. These are
   * optional; the provider fills any non-price-affecting required fields with
   * placeholders so a quote can be produced before checkout.
   */
  destinationLine1?: string;
  destinationCity?: string;
  destinationState?: string;
  destinationPostalCode?: string;
}

export interface QuoteShipment {
  carrierName?: string;
  carrierService?: string;
  /** ISO country code of the lab fulfilling this shipment. */
  fulfillmentCountry?: string;
  cost: Money;
}

/** A price quote for one shipping method. */
export interface Quote {
  shippingMethod: string;
  /** Total cost of the items. */
  items: Money;
  /** Total cost of shipping. */
  shipping: Money;
  shipments: QuoteShipment[];
}

/** Normalized lifecycle stage of an order across providers. */
export type OrderStage =
  | "draft"
  | "onHold"
  | "inProgress"
  | "complete"
  | "cancelled"
  | "error";

export interface ShipmentInfo {
  carrier?: string;
  service?: string;
  status?: string;
  trackingUrl?: string;
  trackingNumber?: string;
}

/** A placed order in domain terms (provider-agnostic view of status). */
export interface FulfillmentOrder {
  /** Provider's order id. */
  id: string;
  /** Opaque fulfillment identity (provider-neutral; e.g. "print"). */
  providerId: string;
  stage: OrderStage;
  merchantReference?: string;
  shipments: ShipmentInfo[];
  charges: Money[];
  /** Human-readable issues reported by the provider, if any. */
  issues: string[];
  /**
   * Print-ready files that were submitted for this order (public URLs), if
   * known. Lets the order be re-previewed later without re-rendering.
   */
  printFiles?: { interior?: string; cover?: string };
  /** The raw provider payload, for debugging / forward-compat. */
  raw?: unknown;
}

/** One recorded step in an order's lifecycle (for the in-app status timeline). */
export interface OrderStatusEntry {
  /** Epoch ms when this status was recorded. */
  at: number;
  stage: OrderStage;
  /** A human-readable note for this step (e.g. a provider issue), if any. */
  message: string | null;
}

/**
 * The persisted, user-facing view of a placed order — the neutral
 * `users/{uid}/orders/{id}` document written by the backend. Provider-agnostic
 * by construction (no provider identity, no raw payloads); powers the in-app
 * order history. Timestamps are normalized to epoch ms for the client.
 */
export interface OrderRecord {
  id: string;
  /** The local project this order was placed for, if known. */
  projectId: string | null;
  productSku: string;
  copies: number;
  shippingMethod: ShippingMethod;
  recipient: {
    name: string;
    email: string | null;
    phone: string | null;
    address: Address;
  };
  stage: OrderStage;
  /** The latest human-readable status note, if any. */
  statusMessage: string | null;
  charges: Money[];
  shipments: ShipmentInfo[];
  /** Public URLs of the print-ready files submitted for this order. */
  fileUrls: { interior?: string; cover?: string };
  statusHistory: OrderStatusEntry[];
  /** Epoch ms; null while a server timestamp is still resolving. */
  createdAt: number | null;
  updatedAt: number | null;
}

/**
 * A provider status-callback (webhook) registration. Used by the backend to push
 * order-status updates without polling. Provider-neutral shape.
 */
export interface StatusWebhook {
  id: string;
  url: string;
  isActive: boolean;
  topics?: string[];
}

/**
 * A book product offered for printing, derived from a provider's catalog.
 * This is the bridge between physical size/format selection and fulfillment.
 */
/**
 * Binding families, mapped from Lulu's `pod_package_id` binding codes:
 *   - "saddle-stitch"  (SS) — stapled softcover, 4–48 pages. Best for thin
 *                              books for very young children.
 *   - "perfect-bound"  (PB) — glued softcover paperback, 32+ pages.
 *   - "coil-bound"     (CO) — spiral/coil softcover, 2+ pages (lies flat).
 *   - "casewrap"       (CW) — hardcover with image printed on the case, 24+ pages.
 *   - "linen-wrap"     (LW) — hardcover wrapped in linen, 24+ pages.
 */
export type Binding =
  | "saddle-stitch"
  | "perfect-bound"
  | "coil-bound"
  | "casewrap"
  | "linen-wrap";
export type Finish = "matte" | "gloss";

export interface BookProduct {
  /** Provider SKU used when quoting / ordering. */
  sku: string;
  label: string;
  description: string;
  binding: Binding;
  finish: Finish;
  /** Physical trim size of a single page, in inches. */
  trim: { widthIn: number; heightIn: number };
  /** Aspect ratio width / height of a single page. */
  aspect: number;
  /** Bleed required on every edge, in inches. */
  bleedIn: number;
  /** Minimum interior page count and the step the count must align to. */
  minPages: number;
  pageStep: number;
  /** Provider print-area names for each asset (confirm per SKU via product details). */
  printAreas: { interior: string; cover?: string; spine?: string };
  /**
   * Whether these specs were confirmed against the live provider catalog. When
   * false, treat trim/SKU as a best-effort default pending verification.
   */
  verified: boolean;
}

/** An uploaded asset that a provider can fetch by URL. */
export interface UploadedAsset {
  url: string;
  /** Epoch ms after which the URL may stop working (best-effort). */
  expiresAt?: number;
}

/**
 * Port: somewhere print-ready files can be uploaded so a provider can download
 * them. Implementations: direct object-store upload (no backend), manual paste,
 * or a backend-signed uploader later.
 */
export interface AssetHost {
  readonly id: string;
  upload(blob: Blob, name: string): Promise<UploadedAsset>;
}

/**
 * Port: a print-on-demand fulfillment provider. UI/domain code depends only on
 * this interface — never on a concrete provider's request/response shapes.
 */
export interface FulfillmentProvider {
  readonly id: string;
  /** Book products this provider offers (from the local catalog). */
  listProducts(): BookProduct[];
  /**
   * Full wraparound cover size (mm) for a book of `pages` pages — front + spine
   * + back including bleed. The export pipeline lays the cover PDF out on this
   * canvas. (Lulu: the cover-dimensions endpoint; spine width is absorbed here.)
   */
  getCoverDimensionsMm(sku: string, pages: number): Promise<{ widthMm: number; heightMm: number }>;
  /** Price + shipping options for a set of items, without creating an order. */
  quote(req: QuoteRequest): Promise<Quote[]>;
  /** Upload assets and submit an order for fulfillment. */
  createOrder(draft: OrderDraft): Promise<FulfillmentOrder>;
  /** Fetch current order status. */
  getOrder(id: string): Promise<FulfillmentOrder>;
  /** Attempt to cancel an order before it enters production. */
  cancelOrder(id: string): Promise<FulfillmentOrder>;

  /**
   * Optional: provider status-callback (webhook) management. Implemented only by
   * providers that push order-status updates, and called only from the backend
   * (the callback `url` must be publicly reachable by the provider). The neutral
   * UI/domain layer never touches these.
   */
  registerStatusWebhook?(url: string): Promise<StatusWebhook>;
  listStatusWebhooks?(): Promise<StatusWebhook[]>;
  deleteStatusWebhook?(id: string): Promise<void>;
  testStatusWebhook?(id: string): Promise<void>;
}
