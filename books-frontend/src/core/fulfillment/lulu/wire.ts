/**
 * Lulu Print API wire shapes (only the fields we use) and pure mappers between
 * those shapes and our provider-agnostic domain types. Keeping this isolated
 * means no Lulu-specific JSON ever leaks past the adapter.
 *
 * Reference: https://api.lulu.com/docs/ (OpenAPI: /api-docs/openapi-specs/openapi_public.yml)
 */
import type {
  AddressValidation,
  AddressWarning,
  FulfillmentOrder,
  Money,
  OrderStage,
  Quote,
  ShipmentInfo,
  StatusWebhook,
  SuggestedAddress,
} from "../types";

// ---- Shared sub-shapes ----------------------------------------------------

/** A reference to a print-ready file Lulu downloads from a public URL. */
export interface LuluSourceFile {
  source_url: string;
}

export interface LuluShippingAddress {
  name?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state_code?: string;
  country_code: string;
  postcode?: string;
  phone_number?: string;
  email?: string;
}

// ---- Outbound (request) shapes -------------------------------------------

/** Line item for a print job (page count is inferred from the interior PDF). */
export interface LuluPrintJobLineItem {
  external_id?: string;
  title: string;
  quantity: number;
  printable_normalization: {
    pod_package_id: string;
    interior: LuluSourceFile;
    cover: LuluSourceFile;
  };
}

export interface LuluPrintJobRequest {
  contact_email?: string;
  external_id?: string;
  line_items: LuluPrintJobLineItem[];
  shipping_address: LuluShippingAddress;
  /** Shipping speed: MAIL | PRIORITY_MAIL | GROUND | EXPEDITED | EXPRESS. */
  shipping_level: string;
}

/** Line item for a cost calculation (no files; page count supplied explicitly). */
export interface LuluCostLineItem {
  page_count: number;
  pod_package_id: string;
  quantity: number;
}

export interface LuluCostRequest {
  line_items: LuluCostLineItem[];
  shipping_address: LuluShippingAddress;
  shipping_level: string;
}

// ---- Inbound (response) shapes -------------------------------------------

/**
 * The shipping address as Lulu echoes it back, with its validation verdict
 * attached. Returned by BOTH the cost calculation and the print job, so the
 * correction is available while the customer is still typing.
 */
export interface LuluValidatedAddress {
  street1?: string;
  street2?: string;
  city?: string;
  state_code?: string;
  postcode?: string;
  country_code?: string;
  /**
   * Documented as an array, but Lulu's own examples show a bare object — hence
   * the union. {@link normalizeWarnings} accepts either.
   */
  warnings?: LuluAddressWarning[] | LuluAddressWarning;
  /**
   * Typed loosely on purpose. The spec says every field is a string, but Lulu's
   * own documented example returns `postcode: 23552` (a number) and
   * `state_code: null`, so {@link text} coerces rather than trusting the schema —
   * a `.trim()` on a number here would throw inside the pricing path.
   */
  suggested_address?: Record<string, unknown>;
}

interface LuluAddressWarning {
  type?: string;
  code?: string;
  /** Where the warning came from (e.g. "external" for the carrier database). */
  path?: string;
  /** Typically "field: submitted -> suggested". */
  message?: string;
}

interface LuluCostBlock {
  total_cost_excl_tax?: string;
  total_cost_incl_tax?: string;
  currency?: string;
}

interface LuluCostResponse {
  line_item_costs?: LuluCostBlock[];
  shipping_cost?: LuluCostBlock;
  total_cost_excl_tax?: string;
  total_cost_incl_tax?: string;
  total_tax?: string;
  currency?: string;
  /** The address we asked it to price, with the carrier's verdict on it. */
  shipping_address?: LuluValidatedAddress;
}

interface LuluPrintJobStatus {
  name?: string;
  message?: string;
}

interface LuluPrintJobLineItemResponse {
  tracking_id?: string;
  tracking_urls?: string[];
  carrier_name?: string;
  status?: LuluPrintJobStatus;
}

export interface LuluPrintJobResponse {
  id?: number | string;
  external_id?: string;
  status?: LuluPrintJobStatus;
  line_items?: LuluPrintJobLineItemResponse[];
  /** The address the job was placed with, plus the carrier's verdict on it. */
  shipping_address?: LuluValidatedAddress;
  /**
   * What Lulu charges US. `total_cost_incl_tax` is the headline; the excl-tax
   * total + tax split lets bookkeeping deduct reclaimable VAT. Costs may be
   * absent on creation (Lulu finalizes them after file validation) and arrive
   * later via status webhooks.
   */
  costs?: {
    total_cost_incl_tax?: string;
    total_cost_excl_tax?: string;
    total_tax?: string;
    currency?: string;
  };
}

/** Webhook configuration returned by `/webhooks/`. */
export interface LuluWebhook {
  id?: string;
  url?: string;
  is_active?: boolean;
  topics?: string[];
}

/** The envelope Lulu POSTs to a webhook URL: `{ topic, data }`. */
export interface LuluWebhookEnvelope {
  topic?: string;
  data?: LuluPrintJobResponse;
}

interface LuluCoverDimensionsResponse {
  // Lulu returns these as decimal strings (e.g. "920.000"), in points by default.
  width?: number | string;
  height?: number | string;
  unit?: string;
}

// ---- Mappers --------------------------------------------------------------

const DEFAULT_CURRENCY = "USD";

function money(amount: string | undefined, currency: string | undefined): Money {
  return { amount: amount ?? "0", currency: currency ?? DEFAULT_CURRENCY };
}

/** A trimmed string from an untyped field, or undefined for anything empty. */
function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Lulu documents `warnings` as an array but exemplifies a bare object. */
function normalizeWarnings(
  raw: LuluAddressWarning[] | LuluAddressWarning | undefined,
): AddressWarning[] {
  const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return list.flatMap((w) => {
    const message = text(w.message);
    if (!message) return [];
    // Messages read "street1: Holstenstr. 40 -> Holstenstraße 40", so the part
    // before the colon names the field the carrier changed.
    const field = message.includes(":") ? message.slice(0, message.indexOf(":")).trim() : undefined;
    return [{ code: (text(w.code) ?? "WARNING").toUpperCase(), message, ...(field ? { field } : {}) }];
  });
}

/** The code Lulu uses when validation rewrote a field and can suggest the fix. */
const CORRECTABLE_CODE = "REPLACED";

/** Loose equality for address parts: case, spacing and punctuation don't count. */
function samePart(a: string | undefined, b: string | undefined): boolean {
  const norm = (v: string | undefined) =>
    (v ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  return norm(a) === norm(b);
}

/**
 * The suggested address, reduced to the fields that actually DIFFER from what
 * was submitted — and `null` when nothing does.
 *
 * Lulu returns a `suggested_address` even when it matches, so mapping it
 * verbatim would put a "did you mean…?" prompt in front of customers whose
 * address was already perfect. `echo` is Lulu's copy of what we sent, which
 * makes the comparison exact rather than a guess at the original input.
 */
function mapSuggested(
  suggested: Record<string, unknown> | undefined,
  echo: LuluValidatedAddress,
): SuggestedAddress | null {
  if (!suggested) return null;
  const out: SuggestedAddress = {};
  const consider = (
    key: keyof SuggestedAddress,
    wireKey: string,
    submitted: string | undefined,
  ) => {
    const next = text(suggested[wireKey]);
    // An absent, blank or null suggestion is "no opinion", not "delete this".
    if (!next) return;
    if (samePart(next, submitted)) return;
    out[key] = next;
  };
  consider("line1", "street1", echo.street1);
  consider("line2", "street2", echo.street2);
  consider("townOrCity", "city", echo.city);
  consider("stateOrCounty", "state_code", echo.state_code);
  consider("postalOrZipCode", "postcode", echo.postcode);
  consider("countryCode", "country_code", echo.country_code);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The carrier's verdict on a shipping address, or `undefined` when it had none.
 * Returned alongside prices so checkout can offer the correction BEFORE payment
 * — a mismatch discovered afterwards parks the print job awaiting manual
 * confirmation, with the customer already charged.
 */
export function mapAddressValidation(
  address: LuluValidatedAddress | undefined,
): AddressValidation | undefined {
  if (!address) return undefined;
  const warnings = normalizeWarnings(address.warnings);
  const suggested = mapSuggested(address.suggested_address, address);
  if (warnings.length === 0 && !suggested) return undefined;
  // Lulu routes addresses through Google's validation service and REFUSES to
  // create a print job for one it can't validate. `REPLACED` always arrives with
  // a correction to offer; a warning that brings no suggestion is the other case
  // — "we couldn't make sense of this" — which is fatal, not cosmetic. Reading it
  // structurally beats matching on message text we don't control.
  const correctable = suggested != null || warnings.some((w) => w.code === CORRECTABLE_CODE);
  return { warnings, suggested, severity: correctable ? "warning" : "error" };
}

/**
 * Map a cost-calculation response (for one shipping level) into a single Quote.
 * Lulu returns item + shipping costs together for the requested level.
 */
export function mapCostToQuote(json: LuluCostResponse, shippingLevel: string): Quote {
  const currency = json.currency ?? DEFAULT_CURRENCY;
  const itemsExcl = (json.line_item_costs ?? []).reduce(
    (sum, c) => sum + Number(c.total_cost_excl_tax ?? 0),
    0,
  );
  const addressValidation = mapAddressValidation(json.shipping_address);
  return {
    shippingMethod: shippingLevel,
    items: money(itemsExcl.toFixed(2), currency),
    shipping: money(json.shipping_cost?.total_cost_excl_tax, json.shipping_cost?.currency ?? currency),
    shipments: [{ cost: money(json.shipping_cost?.total_cost_excl_tax, currency) }],
    ...(addressValidation ? { addressValidation } : {}),
  };
}

function mapStage(name?: string): OrderStage {
  switch ((name ?? "").toUpperCase()) {
    case "CREATED":
      return "draft";
    case "UNPAID":
    case "PAYMENT_IN_PROGRESS":
    case "PRODUCTION_DELAYED":
      return "onHold";
    case "PRODUCTION_READY":
    case "IN_PRODUCTION":
      return "inProgress";
    case "SHIPPED":
      return "complete";
    case "CANCELED":
      return "cancelled";
    case "REJECTED":
    case "ERROR":
      return "error";
    default:
      return "inProgress";
  }
}

export function mapOrder(json: LuluPrintJobResponse): FulfillmentOrder {
  if (json.id === undefined || json.id === null) {
    return {
      id: "",
      providerId: "print",
      stage: "error",
      shipments: [],
      charges: [],
      issues: ["Provider returned no print job."],
      raw: json,
    };
  }

  const shipments: ShipmentInfo[] = (json.line_items ?? [])
    .filter((li) => li.tracking_id || (li.tracking_urls && li.tracking_urls.length))
    .map((li) => ({
      carrier: li.carrier_name,
      status: li.status?.name,
      trackingUrl: li.tracking_urls?.[0],
      trackingNumber: li.tracking_id,
    }));

  const charges: Money[] = json.costs?.total_cost_incl_tax
    ? [money(json.costs.total_cost_incl_tax, json.costs.currency)]
    : [];
  // The tax portion of the charge, when Lulu breaks it out — lets bookkeeping
  // book the net (excl-tax) cost where VAT is reclaimed.
  const taxCharged: Money | undefined =
    json.costs?.total_tax && Number(json.costs.total_tax) > 0
      ? money(json.costs.total_tax, json.costs.currency)
      : undefined;

  const addressValidation = mapAddressValidation(json.shipping_address);
  // Address warnings ride in `issues` too, so they reach the order's status note
  // and history — a correction the provider makes silently is exactly the kind
  // of thing that strands a paid order in "awaiting confirmation".
  const issues = [
    ...(json.status?.message ? [json.status.message] : []),
    ...(addressValidation?.warnings.map((w) => w.message) ?? []),
  ];

  return {
    id: String(json.id),
    providerId: "print",
    stage: mapStage(json.status?.name),
    merchantReference: json.external_id,
    shipments,
    charges,
    taxCharged,
    issues,
    ...(addressValidation ? { addressValidation } : {}),
    raw: json,
  };
}

/** Map a Lulu webhook configuration to the neutral {@link StatusWebhook}. */
export function mapWebhook(json: LuluWebhook): StatusWebhook {
  return {
    id: String(json.id ?? ""),
    url: json.url ?? "",
    isActive: json.is_active ?? false,
    topics: json.topics,
  };
}

/** Conversion to millimetres for each unit Lulu may report (defaults to points). */
const COVER_UNIT_TO_MM: Record<string, number> = {
  pt: 25.4 / 72, // print points — Lulu's default
  in: 25.4,
  mm: 1,
};

export function mapCoverDimensionsMm(
  json: LuluCoverDimensionsResponse,
): { widthMm: number; heightMm: number } {
  const width = Number(json.width);
  const height = Number(json.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Cover dimensions unavailable for this product.");
  }
  const factor = COVER_UNIT_TO_MM[(json.unit ?? "pt").toLowerCase()] ?? COVER_UNIT_TO_MM.pt;
  return { widthMm: width * factor, heightMm: height * factor };
}
