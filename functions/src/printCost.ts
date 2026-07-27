/**
 * Live provider cost → {@link computeMargin} inputs.
 *
 * ONE place turns a provider quote into the `liveUnitCost` / `liveShippingCost`
 * that `computeMargin` consumes, because the admin margin preview and the
 * checkout pricing path must agree. They previously did not: the preview read
 * the live per-unit print cost while checkout fetched the very same quote,
 * used only its shipping figure, and silently priced production from the static
 * cost table — so the economics an admin reviewed were not the economics
 * customers were charged against.
 *
 * Currency: `computeMargin` reads both figures as being in the product's
 * `cost.currency`, but a provider quotes in ITS own currency (Lulu uses the
 * account currency and ignores the requested one). We convert through the
 * catalog FX table here, and refuse a quote whose currency the catalog cannot
 * convert — {@link canConvertCurrency} exists because a silent 1:1 fallback
 * would understate cost and sell books below it.
 */
import {
  canConvertCurrency,
  convertCostAmount,
} from "../../books-frontend/src/core/config/productMath";
import { FulfillmentError } from "../../books-frontend/src/core/fulfillment/errors";
import type {
  PricingSettings,
  ProductDefinition,
} from "../../books-frontend/src/core/config/products";
import type {
  AddressValidation,
  Quote,
  ShippingMethod,
} from "../../books-frontend/src/core/fulfillment/types";
import { fulfillmentProvider } from "./lulu";

export interface LiveCost {
  /** Per-unit production cost, in the product's `cost.currency`. */
  unitCost?: number;
  /** Total shipping cost for the whole order, in the product's `cost.currency`. */
  shippingCost?: number;
  /** The currency the provider quoted in, before conversion (diagnostics only). */
  quotedCurrency?: string;
  /**
   * The provider's verdict on the destination address, when it had one. Pricing
   * has to send the full address anyway, so the carrier's normalization comes
   * back for free — and it's the only chance to fix an address before payment.
   */
  addressValidation?: AddressValidation;
  /**
   * Why no usable live figures are available. Callers fall back to the static
   * cost table — and must refuse to sell when that table is empty too (see
   * `hasUsableUnitCost`).
   */
  error?: string;
  /**
   * Whether the provider REFUSED this order (4xx) or we simply couldn't reach
   * it. The difference decides the fallback: an unreachable provider is a
   * transient outage the cost table can cover, but a refusal means the order as
   * requested cannot be fulfilled at all — most often because the chosen
   * shipping tier isn't offered at that quantity or destination. Falling back
   * there would charge for a service the provider will later decline, stranding
   * a paid order.
   */
  errorKind?: "refused" | "unreachable";
}

export interface LiveCostRequest {
  product: ProductDefinition;
  settings: PricingSettings;
  pages: number;
  copies: number;
  destinationCountry: string;
  destinationState?: string;
  destinationLine1?: string;
  /** Not price-affecting, but part of what the carrier validates. */
  destinationLine2?: string;
  destinationCity?: string;
  destinationPostalCode?: string;
  /**
   * Pin one shipping tier (checkout charges a tier the customer picked). Omit to
   * take the cheapest available tier, which is what an admin preview wants.
   */
  shippingMethod?: ShippingMethod;
  /**
   * SKU to quote when it differs from the product's base (a customer-chosen
   * variant). The product still supplies cost currency and FX; only the package
   * id sent to the provider changes.
   */
  sku?: string;
}

function amount(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pick the quote to price from. Item cost does not vary by shipping tier, so
 * when no tier is pinned the cheapest-shipping quote is fully representative.
 */
function pickQuote(quotes: Quote[], pinned: boolean): Quote | undefined {
  if (pinned) return quotes[0];
  return [...quotes].sort((a, b) => amount(a.shipping.amount) - amount(b.shipping.amount))[0];
}

/** Fetch and normalize the provider's cost for one concrete order scenario. */
export async function fetchLiveCost(req: LiveCostRequest): Promise<LiveCost> {
  const { product, settings, pages, copies } = req;
  const sku = (req.sku ?? product.provider.sku)?.trim();
  if (product.provider.id !== "lulu" || !sku) {
    return { error: "Product has no print-provider SKU, so no live cost is available." };
  }

  let quotes: Quote[];
  try {
    quotes = await fulfillmentProvider().quote({
      productSku: sku,
      copies: Math.max(1, copies),
      pageCount: pages,
      destinationCountry: req.destinationCountry,
      destinationState: req.destinationState,
      destinationLine1: req.destinationLine1,
      destinationLine2: req.destinationLine2,
      destinationCity: req.destinationCity,
      destinationPostalCode: req.destinationPostalCode,
      shippingMethod: req.shippingMethod,
    });
  } catch (err) {
    // "Refused" means the provider looked at this order and said no, which is
    // a fact worth surfacing. Everything else — including a rate limit, which
    // is a 4xx but not a judgement — is just us failing to ask, and falls back
    // to the measured cost table rather than blaming the order.
    const refused = err instanceof FulfillmentError && err.kind === "validation";
    const throttled = err instanceof FulfillmentError && err.kind === "rate_limit";
    return {
      error: throttled
        ? "The print provider is rate-limiting us, so this quote used measured costs instead."
        : err instanceof Error
          ? err.message
          : "Live provider quote failed.",
      errorKind: refused ? "refused" : "unreachable",
    };
  }

  const quote = pickQuote(quotes, req.shippingMethod != null);
  if (!quote) {
    return { error: "Provider returned no quote for this destination.", errorKind: "refused" };
  }

  // The address verdict is independent of the money, so it rides along even
  // when the cost side of this quote turns out to be unusable below.
  const addressValidation = quote.addressValidation;

  // Refuse rather than convert at a silent 1:1 (see the module note).
  const target = product.cost.currency;
  const quoted = [quote.items.currency, quote.shipping.currency];
  const unconvertible = quoted.find((c) => !canConvertCurrency(settings, c));
  if (unconvertible) {
    return {
      quotedCurrency: quote.items.currency,
      addressValidation,
      error: `Provider quoted in ${unconvertible}, which has no FX rate in the catalog's pricing settings.`,
    };
  }

  return {
    quotedCurrency: quote.items.currency,
    addressValidation,
    unitCost:
      convertCostAmount(settings, amount(quote.items.amount), quote.items.currency, target) /
      Math.max(1, copies),
    shippingCost: convertCostAmount(
      settings,
      amount(quote.shipping.amount),
      quote.shipping.currency,
      target,
    ),
  };
}

/**
 * Which source {@link resolveUnitCost} will actually draw production cost from,
 * mirroring its condition exactly so the value stamped onto an order can't lie
 * about where the estimate came from.
 */
export function productionCostSource(
  product: ProductDefinition,
  live: LiveCost,
): "live" | "table" {
  return product.cost.source === "providerLive" && typeof live.unitCost === "number"
    ? "live"
    : "table";
}
