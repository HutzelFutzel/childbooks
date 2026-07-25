/**
 * The one way we ask the print provider "is this SKU real, and what does it
 * cost?" — the primitive behind SKU verification, cost calibration and the SKU
 * builder's live validation.
 *
 * Probing means asking for a cost calculation. The provider has no catalog
 * endpoint to list valid `pod_package_id`s, so the cost endpoint IS the
 * authority: it prices real combinations and rejects everything else. That's how
 * we discovered landscape saddle-stitch doesn't exist despite the
 * cover-dimensions endpoint happily accepting it.
 *
 * THE CRITICAL DISTINCTION is `outcome`. A provider rejection (4xx) is real
 * evidence the SKU or page count is unavailable. An auth failure, a network
 * blip or a 5xx is NOT — recording either as "unverified" would let an outage
 * quietly disable the catalog. Callers must treat `inconclusive` as "learned
 * nothing" and leave any prior verdict untouched.
 */
import { FulfillmentError } from "../../books-frontend/src/core/fulfillment/errors";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { fulfillmentProviderFor, luluCredentialsPresent } from "./lulu";

export type ProbeOutcome =
  /** The provider priced it: the SKU + page count are real. */
  | "ok"
  /** The provider refused it: the SKU or page count is not available. */
  | "rejected"
  /** We couldn't reach a verdict (auth, network, outage) — decide nothing. */
  | "inconclusive";

export interface SkuProbe {
  outcome: ProbeOutcome;
  /** Per-unit item cost, ex tax, in `currency` (present when ok). */
  unitCost?: number;
  /** Shipping cost for the probed quantity, ex tax, in `currency`. */
  shippingCost?: number;
  /** The currency the provider quoted in. */
  currency?: string;
  /** The provider's own explanation, when it gave one. */
  message?: string;
}

export interface ProbeDestination {
  country: string;
  state?: string;
  city?: string;
  postalCode?: string;
  line1?: string;
}

/**
 * Where cost probes are quoted to. Print cost can vary with the fulfillment
 * region, so a derived cost table is only meaningful relative to a FIXED
 * reference — every calibration and verification uses this one so their numbers
 * are comparable. Live per-order quotes still override it at checkout.
 */
export const REFERENCE_DESTINATION: ProbeDestination = {
  country: "US",
  state: "NY",
  city: "New York",
  postalCode: "10001",
  line1: "1 Main St",
};

export interface ProbeRequest {
  env: FulfillmentEnv;
  sku: string;
  pages: number;
  /** Defaults to 1 — the quantity the returned per-unit cost is derived from. */
  copies?: number;
  destination?: ProbeDestination;
}

/**
 * Ask the provider to price one SKU/page/quantity combination.
 *
 * Quotes the Budget tier (provider MAIL) first because it's one call and is
 * available in every destination we sell to. But availability is not universal
 * across ORDER SIZES — MAIL drops out somewhere above 20 copies — so a Budget
 * rejection triggers a retry across all tiers before we blame the SKU. Without
 * that retry, a large-quantity probe would report a perfectly good SKU as
 * nonexistent.
 */
export async function probeSku(req: ProbeRequest): Promise<SkuProbe> {
  const sku = req.sku?.trim();
  if (!sku) return { outcome: "rejected", message: "No SKU given." };
  if (!luluCredentialsPresent(req.env)) {
    return { outcome: "inconclusive", message: `No print-provider credentials for ${req.env}.` };
  }

  const first = await quoteOnce(req, sku, "Budget");
  if (first.outcome !== "rejected" || isAboutTheProduct(first.message)) return first;

  // Budget said no for a reason that wasn't about the product itself. Re-ask
  // across every tier: if any of them prices the order, the SKU is fine and only
  // that one shipping level was unavailable.
  const anyTier = await quoteOnce(req, sku, undefined);
  return anyTier.outcome === "ok" ? anyTier : first;
}

/**
 * Whether the provider's complaint is about the package or page count rather
 * than about shipping. When it is, the answer is already definitive and the
 * multi-tier retry would just burn four more round trips on the same verdict.
 */
function isAboutTheProduct(message: string | undefined): boolean {
  if (!message) return false;
  return /pod.?package|page_count/i.test(message);
}

async function quoteOnce(
  req: ProbeRequest,
  sku: string,
  shippingMethod: "Budget" | undefined,
): Promise<SkuProbe> {
  const copies = Math.max(1, Math.round(req.copies ?? 1));
  const dest = req.destination ?? REFERENCE_DESTINATION;
  try {
    const quotes = await fulfillmentProviderFor(req.env).quote({
      productSku: sku,
      copies,
      pageCount: Math.max(1, Math.round(req.pages)),
      shippingMethod,
      destinationCountry: dest.country,
      destinationState: dest.state,
      destinationCity: dest.city,
      destinationPostalCode: dest.postalCode,
      destinationLine1: dest.line1,
    });
    // Unpinned quotes come back one per tier; the cheapest is representative
    // since item cost doesn't vary by shipping level.
    const quote = [...quotes].sort(
      (a, b) => (Number(a.shipping.amount) || 0) - (Number(b.shipping.amount) || 0),
    )[0];
    if (!quote) {
      return { outcome: "inconclusive", message: "Provider returned no quote." };
    }
    const items = Number(quote.items.amount);
    if (!Number.isFinite(items) || items <= 0) {
      // Accepted but priced at nothing: not a rejection, but not a cost we'd
      // trust either.
      return { outcome: "inconclusive", message: "Provider quoted a zero item cost.", currency: quote.items.currency };
    }
    return {
      outcome: "ok",
      unitCost: items / copies,
      shippingCost: Number(quote.shipping.amount) || 0,
      currency: quote.items.currency,
    };
  } catch (err) {
    return classify(err);
  }
}

/** Turn a provider error into a verdict, erring towards "learned nothing". */
function classify(err: unknown): SkuProbe {
  if (err instanceof FulfillmentError) {
    // Only a 4xx we caused is evidence about the SKU itself. `not_found` comes
    // from a missing resource path rather than an invalid package id, so it
    // doesn't condemn the SKU either.
    const outcome: ProbeOutcome = err.kind === "validation" ? "rejected" : "inconclusive";
    return { outcome, message: providerReason(err) };
  }
  return { outcome: "inconclusive", message: err instanceof Error ? err.message : "Probe failed." };
}

/**
 * The provider's human-readable complaint, dug out of the raw error body when
 * present — "Pod Package does not exist" is far more actionable than
 * "request failed with status 400".
 */
function providerReason(err: FulfillmentError): string {
  const details = err.details?.trim();
  if (!details) return err.message;
  try {
    const parsed = JSON.parse(details) as unknown;
    const found = firstString(parsed, 0);
    if (found) return found;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return details.length > 300 ? `${details.slice(0, 300)}…` : details;
}

/** Depth-first search for the first non-empty string in a nested error body. */
function firstString(value: unknown, depth: number): string | undefined {
  if (depth > 6) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v, depth + 1);
      if (s) return s;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const s = firstString(v, depth + 1);
      if (s) return s;
    }
  }
  return undefined;
}
