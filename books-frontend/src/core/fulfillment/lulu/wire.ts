/**
 * Lulu Print API wire shapes (only the fields we use) and pure mappers between
 * those shapes and our provider-agnostic domain types. Keeping this isolated
 * means no Lulu-specific JSON ever leaks past the adapter.
 *
 * Reference: https://api.lulu.com/docs/ (OpenAPI: /api-docs/openapi-specs/openapi_public.yml)
 */
import type {
  FulfillmentOrder,
  Money,
  OrderStage,
  Quote,
  ShipmentInfo,
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

interface LuluPrintJobResponse {
  id?: number | string;
  external_id?: string;
  status?: LuluPrintJobStatus;
  line_items?: LuluPrintJobLineItemResponse[];
  costs?: { total_cost_incl_tax?: string; currency?: string };
}

interface LuluCoverDimensionsResponse {
  width?: number;
  height?: number;
  unit?: string;
}

// ---- Mappers --------------------------------------------------------------

const DEFAULT_CURRENCY = "USD";

function money(amount: string | undefined, currency: string | undefined): Money {
  return { amount: amount ?? "0", currency: currency ?? DEFAULT_CURRENCY };
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
  return {
    shippingMethod: shippingLevel,
    items: money(itemsExcl.toFixed(2), currency),
    shipping: money(json.shipping_cost?.total_cost_excl_tax, json.shipping_cost?.currency ?? currency),
    shipments: [{ cost: money(json.shipping_cost?.total_cost_excl_tax, currency) }],
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
      providerId: "lulu",
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

  const issues = json.status?.message ? [json.status.message] : [];

  return {
    id: String(json.id),
    providerId: "lulu",
    stage: mapStage(json.status?.name),
    merchantReference: json.external_id,
    shipments,
    charges,
    issues,
    raw: json,
  };
}

export function mapCoverDimensionsMm(
  json: LuluCoverDimensionsResponse,
): { widthMm: number; heightMm: number } {
  if (typeof json.width !== "number" || typeof json.height !== "number") {
    throw new Error("Cover dimensions unavailable for this product.");
  }
  const factor = json.unit === "in" ? 25.4 : 1; // request asks for mm, but guard anyway
  return { widthMm: json.width * factor, heightMm: json.height * factor };
}
