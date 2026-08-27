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
  /**
   * The RECIPIENT's tax identification number, where the destination's customs
   * regime demands one (Brazil CPF/CNPJ, Chile RUT, Mexico RFC). Customer data
   * for the carrier's paperwork, not a registration of ours — and required at
   * order time, not at quote time, so checkout must collect it before payment.
   */
  taxId?: string;
}

export interface Recipient {
  name: string;
  email?: string;
  phoneNumber?: string;
  address: Address;
}

/** One thing a provider's address validation flagged about a submitted address. */
export interface AddressWarning {
  /** The provider's code for what it did, e.g. "REPLACED". */
  code: string;
  /** Human-readable description, usually naming the field and the change. */
  message: string;
  /** The address field the warning is about, when the provider names one. */
  field?: string;
}

/**
 * A corrected address the carrier database recommends. Partial because a
 * provider only returns the fields it can normalize.
 */
export type SuggestedAddress = Partial<Address>;

/**
 * What a provider's address validation said about a destination.
 *
 * Carriers normalize addresses against their own database ("Road" → "Rd",
 * ZIP+4, unit prefixes) and a mismatch can park a print job awaiting manual
 * confirmation — after the customer has paid. So this travels with the price
 * quote, where the customer is still typing and can still fix it.
 */
export interface AddressValidation {
  warnings: AddressWarning[];
  /** The corrected address, when it differs from what was submitted. */
  suggested: SuggestedAddress | null;
  /**
   * `"error"` when the provider could not validate the address at all. That is
   * not a style note: providers refuse to create a print job for an address
   * their validation service rejects, so checkout must not proceed — there is no
   * suggestion to accept, only an address to fix.
   *
   * `"warning"` means it has a correction to offer and would accept either.
   */
  severity: "warning" | "error";
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
  /**
   * Apartment/suite line. Not price-affecting, but it IS part of what the
   * carrier validates — quoting without it validates a different address than
   * the one the order will ship to, which is how a "clean" quote turns into a
   * held print job.
   */
  destinationLine2?: string;
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
  /**
   * What the provider's address validation said about the destination it was
   * asked to price. Present because pricing already sends the full address —
   * so the correction is free, and arrives while the customer can still act.
   */
  addressValidation?: AddressValidation;
}

/**
 * What happened when one shipping tier was priced.
 *
 * A plain `Quote[]` can only say which tiers came back, and the tiers that
 * DIDN'T are the interesting ones — they're what a customer would be refused at
 * checkout. But "the provider doesn't run this speed here" and "we never got an
 * answer" both look like absence, and recording the second as the first writes
 * a permanent claim about a country's coverage from a momentary network blip.
 * So each tier reports its own outcome.
 */
export interface TierOutcome {
  method: ShippingMethod;
  /** Present when the provider priced this tier. */
  quote?: Quote;
  /**
   * The provider looked at this tier for this destination and said no. Real
   * evidence about coverage, safe to record.
   */
  refused?: boolean;
  /**
   * We failed to ask — throttled, network, provider outage. Says NOTHING about
   * coverage; callers must leave any prior verdict alone rather than writing
   * this down as unavailable.
   */
  failed?: boolean;
  /** The failure was a rate limit — worth distinguishing, since re-running fixes it. */
  throttled?: boolean;
  /** The provider's explanation, when it gave one. */
  message?: string;
}

/**
 * A shipping service the provider offers to one destination.
 *
 * Distinct from {@link TierOutcome}, which is the result of PRICING a specific
 * order: this describes what exists to a country at all, with the delivery
 * window attached, and is cheap enough to ask for every country on earth. It's
 * what a coverage sweep records.
 *
 * `level` is the provider's own string rather than a {@link ShippingMethod}
 * because a provider can run services we haven't given a domain tier to (Lulu's
 * GROUND_HD / GROUND_BUS). Discarding those at the adapter boundary would hide
 * real coverage; `method` is left undefined instead.
 */
export interface ShippingOption {
  level: string;
  method?: ShippingMethod;
  /** Business days from start of production to delivery, when reported. */
  transitDaysMin?: number;
  transitDaysMax?: number;
  /** Whether the service produces a tracking link. */
  traceable: boolean;
  postboxOk: boolean;
  /** Delivers on working days only. */
  businessOnly: boolean;
  /**
   * Cost for the exact configuration that was asked about. Indicative only for
   * a coverage sweep, which probes one reference product — real shipping cost
   * scales with the book's weight.
   */
  cost?: Money;
}

/** What to ask about when enumerating a destination's shipping services. */
export interface ShippingOptionsRequest {
  productSku: string;
  pageCount: number;
  copies: number;
  destinationCountry: string;
  /** ISO-3166-2 subdivision. Required by some countries for an accurate answer. */
  destinationState?: string;
  destinationPostalCode?: string;
  destinationCity?: string;
  currency?: string;
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
  /**
   * The tax portion of `charges`, when the provider breaks it out — lets
   * bookkeeping deduct reclaimable VAT from the booked cost.
   */
  taxCharged?: Money;
  /** Human-readable issues reported by the provider, if any. */
  issues: string[];
  /**
   * What the provider's address validation said about the address this order was
   * placed with. A correction here means the job may be held for confirmation,
   * so it has to reach the customer rather than only the provider's dashboard.
   */
  addressValidation?: AddressValidation;
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
  /**
   * The provider's verdict on the shipping address at placement time, when it
   * flagged anything. Drives the "we're confirming your address" callout.
   */
  addressValidation: AddressValidation | null;
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
export const BINDINGS = [
  "saddle-stitch",
  "perfect-bound",
  "coil-bound",
  "casewrap",
  "linen-wrap",
] as const;
export const FINISHES = ["matte", "gloss"] as const;

export type Binding = (typeof BINDINGS)[number];
export type Finish = (typeof FINISHES)[number];

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
  /**
   * Maximum interior page count the binding supports. Enforced up front so a
   * book that is too thick for its format never reaches payment — the provider
   * would otherwise reject the print job *after* the customer is charged.
   */
  maxPages: number;
  /** Provider print-area names for each asset (confirm per SKU via product details). */
  printAreas: { interior: string; cover?: string; spine?: string };
}

/** An uploaded asset that a provider can fetch by URL. */
export interface UploadedAsset {
  url: string;
  /**
   * Where the object lives in the store, when the host can say.
   *
   * A path is safe to persist somewhere the owner can read (it isn't fetchable
   * without the token) and lets the backend re-derive a fresh public URL later
   * — which is how a cached render is reused without ever writing a directly
   * downloadable link into client-readable storage.
   */
  path?: string;
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
  /**
   * Like {@link quote}, but reporting every tier's outcome rather than only the
   * ones that priced. Used where the ABSENCE of a tier is the finding — the
   * shipping sweep records which speeds reach which countries — and where
   * mistaking a failed request for an unavailable speed would be persisted.
   *
   * Optional because it's a direct-to-provider capability: the browser-side
   * adapter speaks to our own `/print/*` API, which returns priced quotes and
   * has no way to report why a tier is missing. Only backend callers need it.
   */
  quoteTiers?(req: QuoteRequest): Promise<TierOutcome[]>;
  /**
   * Every shipping service the provider runs to a destination, in ONE call.
   *
   * Separate from {@link quoteTiers} because it answers a different question at
   * a different cost: "what reaches this country" rather than "what does this
   * order cost", needing only a country rather than a validated address. That's
   * what makes sweeping every country in the world affordable — `quoteTiers`
   * would be one request per speed per country.
   *
   * Optional for the same reason as {@link quoteTiers}: the browser adapter
   * talks to our own API, and coverage discovery is a backend concern.
   */
  shippingOptions?(req: ShippingOptionsRequest): Promise<ShippingOption[]>;
  /** Upload assets and submit an order for fulfillment. */
  createOrder(draft: OrderDraft): Promise<FulfillmentOrder>;
  /**
   * Recover an order after an ambiguous create response using the stable key
   * supplied on the original draft. Backend providers should implement this
   * when their create endpoint lacks native idempotency.
   */
  findOrderByIdempotencyKey?(key: string): Promise<FulfillmentOrder | null>;
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
