/**
 * Stripe payments — checkout, customer portal, webhook, and admin endpoints.
 *
 * Flow (one-time print orders):
 *   1. POST /checkout — the client sends the same draft it used to send to
 *      /print/order (recipient, sku, copies, page count + base64 print files).
 *      We upload the files NOW (so they're hosted before payment), compute the
 *      server-authoritative price from the admin catalog + pricing settings,
 *      create a `pending` payment record holding the fulfillment plan, and open a
 *      Stripe Checkout Session. We return its URL; the browser redirects to it.
 *   2. POST /stripe-webhook — on `checkout.session.completed` (paid) we mark the
 *      payment paid and ONLY THEN place the print order from the stored plan.
 *      Funds → fulfillment is gated entirely on Stripe, never the client.
 *
 * Subscriptions reuse Checkout in `subscription` mode + the Customer Portal.
 */
import express, { type Express, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { serverConfig } from "./config";
import { isAnonymousToken, isVerifiedToken, requireAuth, type AuthedRequest } from "./auth";
import { createAdminAssetHost, printFileUnreachableReason } from "./assets";
import { cachedDocumentPath, cachedDocumentUrl, documentKey } from "./renders";
import { fulfillmentProvider } from "./lulu";
import { persistCreatedOrder } from "./orders";
import { getProductsConfig } from "./products";
import { getPricingSettings } from "./appConfig";
import {
  computeMargin,
  defaultShippingMethod,
  hasUsableShippingCost,
  hasUsableUnitCost,
  isDestinationAllowed,
  resolveShippingCharged,
} from "../../books-frontend/src/core/config/productMath";
import { fetchLiveCost, productionCostSource } from "./printCost";
import type {
  CurrencyCode,
  PricingSettings,
  ProductDefinition,
} from "../../books-frontend/src/core/config/products";
import type { DiscountItemType } from "../../books-frontend/src/core/config/discountImpact";
import {
  findProductForSku,
  planMeetsAccess,
  productAccessOf,
  resolvePrintOrder,
  verificationCoversPages,
  verificationFor,
} from "../../books-frontend/src/core/config/products";
import type { VariantSelection } from "../../books-frontend/src/core/config/variants";
import {
  effectivePrintDiscountPct,
  planEntitlements,
} from "../../books-frontend/src/core/config/entitlements";
import type {
  AddressValidation,
  OrderDraft,
  ShippingMethod,
} from "../../books-frontend/src/core/fulfillment/types";
import {
  appBaseUrl,
  getStripe,
  isSandbox,
  keyMode,
  maskKey,
  stripeConfigured,
} from "./stripeClient";
import {
  claimFulfillment,
  createPendingPayment,
  findPaymentIdByStripeId,
  findUidByCustomerId,
  getAdminPayment,
  getStripeCustomerId,
  listFailedFulfillments,
  listPayments,
  markFulfillmentFailed,
  paymentsAnalytics,
  saveStripeCustomerId,
  updatePayment,
  upsertSubscription,
  type AdminPaymentRecord,
  type EbookFulfillment,
  type FulfillmentPlan,
  type PaymentKind,
} from "./payments";
import {
  deliverPaidEbook,
  logDownloadAndResolveUrl,
  markDownloadsSeen,
  priceEbook,
  revokeRefundedEbook,
} from "./ebooks";
import { getPlansConfig, hasActiveSubscription, resolveActivePlan } from "./plans";
import { getSparksConfig } from "./appConfig";
import { grantSparks } from "./sparks";
import {
  productKey,
  recordChargeRevenue,
  recordFinanceEvent,
  recordTaxRemitted,
  toUsd,
} from "./finance";
import { stampMilestone } from "./projects";
import {
  normalizeCountry,
  UNKNOWN_COUNTRY,
} from "../../books-frontend/src/core/analytics/markets";
import { affiliateChargeMetadata, stampCustomerAttribution } from "./affiliates";
import { raiseAlert } from "./alerts";
import { notifySlack, money } from "./notify";
import {
  clawbackForRef,
  discountedAmount,
  effectivePercentOff,
  finalizeDiscountsForPayment,
  findRedeemableDiscount,
  onReferralEvent,
  onSubscriptionInvoicePaid,
  planDiscountCoupon,
  reserveDiscount,
} from "./referrals";
import { claimGift, createPaidGift, listGiftsBought, newGiftCode } from "./gifts";
import {
  intervalForPriceId,
  priceIdForEnv,
  resolvePlanByPriceId,
  type BillingInterval,
} from "../../books-frontend/src/core/config/plans";
import { packTotalSparks } from "../../books-frontend/src/core/config/sparks";
import {
  sendGiftPurchasedEmail,
  sendGiftReceivedEmail,
  sendOrderConfirmationEmail,
  sendOrderFailedEmail,
  sendSparksPurchasedEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionStartedEmail,
} from "./email/triggers";

// ---- Money helpers ---------------------------------------------------------

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

/** Convert a major-unit amount to Stripe's minor units for the currency. */
function toMinor(amount: number, currency: string): number {
  const factor = ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round(amount * factor);
}

/** Convert Stripe minor units back to a major-unit number. */
function toMajor(amount: number, currency: string): number {
  const factor = ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round((amount / factor) * 100) / 100;
}

/** Print asset as it arrives over the wire (Blob serialized as base64). */
interface WireAsset {
  printArea: string;
  base64: string;
  contentType?: string;
  pageCount?: number;
}

interface CheckoutBody {
  /** Format base SKU (or any same-format composed SKU). */
  productSku: string;
  /** Customer-chosen print/paper/finish. Omitted ⇒ the product's base variant. */
  variant?: VariantSelection;
  copies: number;
  pageCount: number;
  currency: string;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  merchantReference?: string;
  recipient: OrderDraft["recipient"];
  assets?: WireAsset[];
  /**
   * Content fingerprint of the render (see `core/print/fingerprint`). When the
   * book has already been rendered, the cached files are used and `assets` is
   * absent — a reorder of an unchanged book uploads nothing at all.
   */
  fingerprint?: string;
}

function clientError(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: { message } });
}

/**
 * An earned referral discount to apply to this purchase, already reserved for
 * `paymentId` — or null when the buyer has none, or none that can be honored.
 *
 * Two clamps make it safe to hand a percentage to a customer months after the
 * program was configured: the catalog-wide `maxDiscountPct`, and whatever
 * headroom is left below break-even after the buyer's plan discount. If those
 * leave nothing, no reward is consumed — a discount that would have to be
 * silently reduced to 0 is better saved for a purchase that can carry it.
 */
async function earnedReferralDiscount(args: {
  uid: string;
  itemType: DiscountItemType;
  paymentId: string;
  settings: PricingSettings;
  /** Amount the discount would come off (for the cost bookkeeping). */
  amount: number;
  /** Discount % the buyer's plan already applied. */
  appliedPct?: number;
  /** Deepest TOTAL discount that still breaks even (default: unbounded). */
  breakEvenPct?: number;
}): Promise<{ percentOff: number; summary: string } | null> {
  try {
    const earned = await findRedeemableDiscount(args.uid, args.itemType);
    if (!earned) return null;
    const headroom = Math.max(0, (args.breakEvenPct ?? 100) - (args.appliedPct ?? 0));
    const percentOff = Math.min(effectivePercentOff(earned.percentOff, args.settings), headroom);
    if (percentOff <= 0) return null;
    const discount = args.amount - discountedAmount(args.amount, percentOff);
    if (!(await reserveDiscount(earned.rewardId, args.paymentId, discount))) return null;
    return { percentOff, summary: earned.summary };
  } catch (err) {
    // A referral perk must never be the reason a purchase can't be started.
    console.warn("[stripe] referral discount lookup failed", err);
    return null;
  }
}

/**
 * Create the Checkout Session, retrying without automatic tax if the account
 * hasn't activated Stripe Tax (so checkout still works before tax is set up).
 */
async function createCheckoutSession(
  params: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  try {
    return await stripe.checkout.sessions.create(params);
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (params.automatic_tax?.enabled && /tax/i.test(msg)) {
      console.warn("[stripe] automatic_tax failed, retrying without tax:", msg);
      const retry: Stripe.Checkout.SessionCreateParams = {
        ...params,
        automatic_tax: { enabled: false },
      };
      // Drop per-line tax_behavior so Stripe doesn't reject it without tax.
      retry.line_items = (params.line_items ?? []).map((li) => {
        if (li.price_data?.tax_behavior) {
          const { tax_behavior: _drop, ...priceData } = li.price_data;
          return { ...li, price_data: priceData };
        }
        return li;
      });
      return stripe.checkout.sessions.create(retry);
    }
    throw err;
  }
}

/**
 * Get (or lazily create) the Stripe customer for a user.
 *
 * Also the single choke point where affiliate attribution reaches Stripe: every
 * checkout path resolves its customer here, so stamping the referral once at
 * this point covers all of them — including a customer that already existed
 * before the person followed an affiliate link.
 */
async function ensureCustomer(uid: string, email?: string | null): Promise<string> {
  const existing = await getStripeCustomerId(uid);
  if (existing) {
    await stampCustomerAttribution(uid, existing);
    return existing;
  }
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { uid },
  });
  await saveStripeCustomerId(uid, customer.id);
  await stampCustomerAttribution(uid, customer.id);
  return customer.id;
}

// ---- Print-order checkout core ----------------------------------------------

interface PrintCheckoutArgs {
  uid: string;
  email: string | null;
  product: ProductDefinition;
  /** Variant being sold; drives retail deltas and the composed print SKU. */
  variant: VariantSelection;
  /** Provider package id that actually prints (base SKU ⊕ variant). */
  printSku: string;
  settings: PricingSettings;
  activePlan: Awaited<ReturnType<typeof resolveActivePlan>>;
  copies: number;
  pages: number;
  currency: CurrencyCode;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  recipient: OrderDraft["recipient"];
  sourceFileUrls: { interior?: string; cover?: string };
  merchantReference: string | null;
}

type PrintCheckoutResult =
  | { ok: true; url: string | null; paymentId: string }
  | { ok: false; error: string };

/**
 * Price a print order server-side (live shipping quote → retail tiers → plan
 * discount clamped to break-even), create the pending payment holding the
 * fulfillment plan, and open the Stripe Checkout Session. Shared by first-time
 * checkout and reorders.
 */
interface RetailPriceArgs {
  product: ProductDefinition;
  variant: VariantSelection;
  printSku: string;
  settings: PricingSettings;
  activePlan: Awaited<ReturnType<typeof resolveActivePlan>>;
  copies: number;
  pages: number;
  currency: CurrencyCode;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  address: {
    line1?: string;
    line2?: string | null;
    townOrCity: string;
    stateOrCounty?: string | null;
    postalOrZipCode: string;
  };
}

interface RetailPriceResult {
  /** Per-unit retail price AFTER any plan discount, rounded to cents. */
  unitPrice: number;
  /** Per-unit sticker price before the discount. */
  listUnitPrice: number;
  /** Applied plan discount (already clamped to break-even). */
  discountPct: number;
  /**
   * The deepest TOTAL discount on the book price that still breaks even. An
   * earned referral discount stacks on top of the plan discount only as far as
   * this allows.
   */
  breakEvenDiscountPct: number;
  shippingCharged: number;
  /**
   * What the print provider's address validation said about the destination.
   * Undefined when it said nothing (or we never got to ask).
   */
  addressValidation?: AddressValidation;
  /** The configured cost view of this scenario (calibration baseline). */
  estimatedCost: {
    amount: number;
    production: number;
    shipping: number;
    currency: string;
    shippingSource: "live" | "table";
    productionSource: "live" | "table";
  };
}

/**
 * The order can't be priced honestly — no production-cost baseline, an
 * unverified SKU, or a provider refusal. Retrying won't help. The Error message
 * is the operator's diagnosis (logged, never sent); `clientMessage` is what the
 * customer sees, which stays neutral about the provider.
 */
class PricingUnavailableError extends Error {
  readonly clientMessage: string;

  constructor(message: string, clientMessage = "This book format can't be ordered right now.") {
    super(message);
    this.clientMessage = clientMessage;
  }
}

/**
 * The single retail pricing path: live shipping quote → retail tiers → plan
 * discount clamped to break-even. Used by checkout, reorders and the client's
 * price preview so all three always agree.
 */
async function priceRetailOrder(args: RetailPriceArgs): Promise<RetailPriceResult> {
  const { product, variant, printSku, settings, copies, pages, currency } = args;

  // The FORMAT must be proven printable in the environment we're serving.
  // Page bounds are a property of trim+binding (verified on the base SKU); the
  // concrete variant is gated by the live quote below — a package the provider
  // doesn't sell is refused there, before anything is charged.
  const env = serverConfig().fulfillment.lulu.env;
  if (product.provider.id === "lulu") {
    const record = verificationFor(product.provider, env);
    if (!record?.ok) {
      throw new PricingUnavailableError(
        `SKU ${product.provider.sku} is not verified against the ${env} print catalog` +
          `${record?.error ? `: ${record.error}` : " (never probed)"}.`,
      );
    }
    if (!verificationCoversPages(record, { min: pages, max: pages })) {
      throw new PricingUnavailableError(
        `SKU ${product.provider.sku} is verified for ${record.pages.min}–${record.pages.max} pages in ${env}, but this order is ${pages}.`,
      );
    }
  }

  // Live provider cost for this exact scenario — BOTH the per-unit production
  // cost and shipping. Quoted against the COMPOSED variant SKU so a cheaper
  // paper or finish moves the number the margin math uses.
  const live = await fetchLiveCost({
    product,
    sku: printSku,
    settings,
    pages,
    copies,
    destinationCountry: args.destinationCountry,
    destinationLine1: args.address.line1,
    destinationLine2: args.address.line2 ?? undefined,
    destinationCity: args.address.townOrCity,
    destinationState: args.address.stateOrCounty ?? undefined,
    destinationPostalCode: args.address.postalOrZipCode,
    shippingMethod: args.shippingMethod,
  });
  // A REFUSAL is not something the cost table can paper over: the provider has
  // said it won't fulfil this order as requested (most often the chosen shipping
  // tier isn't offered at this quantity — Budget/MAIL drops out above ~20
  // copies). Charging a fallback rate here would strand a paid order.
  if (live.errorKind === "refused") {
    throw new PricingUnavailableError(
      `Provider refused to quote ${printSku} (${copies} copies, ${args.shippingMethod} to ${args.destinationCountry}): ${live.error}`,
      `We can't ship ${copies} ${copies === 1 ? "copy" : "copies"} to your address at the selected delivery speed. Please choose a different shipping option.`,
    );
  }
  if (live.error) {
    console.warn("[stripe] live cost unavailable; falling back to the cost table:", live.error);
  }

  const scenario = {
    currency,
    pages,
    copies,
    variant,
    liveUnitCost: live.unitCost,
    liveShippingCost: live.shippingCost,
    // Named so that, if the live quote failed, the fallback used is the one
    // measured for THIS route and tier rather than the catch-all scalar.
    destinationCountry: args.destinationCountry,
    shippingMethod: args.shippingMethod,
  };

  // Refuse to price an order with no production-cost baseline. Without one,
  // computeMargin reports the whole price as profit and breakEvenDiscountPct
  // resolves near 100%, so the plan discount below would clamp to nothing and
  // the book could ship at a loss. Fail loudly instead of selling blind.
  if (!hasUsableUnitCost(product.cost, scenario)) {
    throw new PricingUnavailableError(
      `No production cost for SKU ${printSku}: ` +
        `live quote ${live.error ?? "returned no unit cost"} and the cost table is empty.`,
    );
  }
  // Same rule for shipping: passthrough with no quote and no configured fallback
  // would charge the customer nothing while we still pay the provider.
  if (!hasUsableShippingCost(product.shipping, live.shippingCost, scenario)) {
    throw new PricingUnavailableError(
      `No shipping cost for SKU ${printSku}: ` +
        `live quote ${live.error ?? "returned no shipping cost"} and shipping is passthrough ` +
        `with no measured rate for ${args.shippingMethod} to ${args.destinationCountry} ` +
        `and no fallback cost configured.`,
    );
  }

  const margin = computeMargin(product, scenario, settings);
  // Active subscribers get their plan's print discount, clamped to break-even
  // so the order can never be sold at a loss.
  const discountPct = effectivePrintDiscountPct(
    planEntitlements(args.activePlan),
    margin.breakEvenDiscountPct,
  );
  const unitPrice =
    discountPct > 0
      ? Math.round(margin.pricePerUnit * (1 - discountPct / 100) * 100) / 100
      : margin.pricePerUnit;
  const shippingCharged =
    margin.shippingCharged || resolveShippingCharged(product.shipping, live.shippingCost ?? 0);
  // The cost view of this exact scenario — stamped onto the fulfillment plan so
  // the finance stream can later compare it against what the provider actually
  // charges. The per-part sources make that drift readable: a "live" estimate
  // should track the real charge closely, a "table" one only as well as the
  // table is maintained.
  const estimatedCost = {
    amount: Math.round((margin.productionCost + margin.shippingCost) * 100) / 100,
    production: margin.productionCost,
    shipping: margin.shippingCost,
    currency,
    shippingSource: (live.shippingCost != null ? "live" : "table") as "live" | "table",
    productionSource: productionCostSource(product, live),
  };
  return {
    unitPrice,
    listUnitPrice: margin.pricePerUnit,
    discountPct,
    breakEvenDiscountPct: margin.breakEvenDiscountPct,
    shippingCharged,
    addressValidation: live.addressValidation,
    estimatedCost,
  };
}

/**
 * Why this order can't ship, or `null` if it can.
 *
 * One implementation, two call sites: {@link createPrintCheckout} enforces it so
 * no path can skip it, and `/checkout` calls it before uploading print files so
 * a doomed order doesn't cost a Storage round trip first. Sharing the function
 * means the fast path can't drift from the binding one.
 */
function shippingRefusal(
  product: ProductDefinition,
  dest: { country?: string | null; region?: string; method: ShippingMethod },
): string | null {
  const country = (dest.country ?? "").trim();
  if (!isDestinationAllowed(product.shipping.destinations, { country, region: dest.region })) {
    return "We can't ship this product to that destination yet.";
  }
  if (!product.shipping.methods.some((m) => m.enabled && m.method === dest.method)) {
    return "That shipping method isn't available for this product.";
  }
  return null;
}

async function createPrintCheckout(args: PrintCheckoutArgs): Promise<PrintCheckoutResult> {
  const { uid, product, variant, printSku, settings, copies, pages, currency, recipient } = args;

  // Checked HERE, at the chokepoint both physical-order paths funnel through.
  // Only one of them used to validate: a reorder replayed a stored address, so
  // an order placed before a market was withdrawn stayed repeatable forever.
  const refusal = shippingRefusal(product, {
    country: args.destinationCountry || recipient.address.countryCode,
    region: recipient.address.stateOrCounty ?? undefined,
    method: args.shippingMethod,
  });
  if (refusal) return { ok: false, error: refusal };

  const {
    unitPrice: planPrice,
    shippingCharged,
    estimatedCost,
    addressValidation,
    discountPct,
    breakEvenDiscountPct,
  } = await priceRetailOrder({
    product,
    variant,
    printSku,
    settings,
    activePlan: args.activePlan,
    copies,
    pages,
    currency,
    shippingMethod: args.shippingMethod,
    destinationCountry: args.destinationCountry,
    address: recipient.address,
  });

  if (planPrice <= 0) {
    return { ok: false, error: "This product isn't priced for ordering yet." };
  }

  // The payment id is minted here (rather than just before the session) because
  // an earned discount is RESERVED against it — the reservation is what makes the
  // reward single-use across an abandoned checkout.
  const paymentId = randomUUID();
  const referral = await earnedReferralDiscount({
    uid,
    itemType: "print",
    paymentId,
    settings,
    amount: planPrice * copies,
    appliedPct: discountPct,
    breakEvenPct: breakEvenDiscountPct,
  });
  const unitPrice = referral ? discountedAmount(planPrice, referral.percentOff) : planPrice;

  // The provider downloads the print files LATER, on its own schedule, so a URL
  // it can't fetch comes back as a rejected job with the customer already
  // charged. Both callers funnel through here — a fresh checkout and a reorder
  // reusing files from months ago — and both are still pre-payment at this
  // point, so an unreachable file is a retryable error instead of a refund.
  const unreachable = (
    await Promise.all(
      (["interior", "cover"] as const).map(async (part) => {
        const url = args.sourceFileUrls[part];
        if (!url) return `${part} file is missing`;
        const reason = await printFileUnreachableReason(url);
        return reason ? `${part} file is not downloadable (${reason})` : null;
      }),
    )
  ).filter((v): v is string => v != null);
  if (unreachable.length > 0) {
    console.error(
      `[stripe] checkout blocked — print files unreachable for ${printSku}: ${unreachable.join("; ")}`,
    );
    return {
      ok: false,
      error:
        "We couldn't confirm your print files are ready. Please try again — " +
        "if it keeps happening, contact us and we'll sort it out.",
    };
  }

  // The print provider refuses jobs whose address its validation service can't
  // confirm, so charging for one would strand a paid order. The dialog blocks
  // this too, but the money is decided here — a client is not a gate.
  if (addressValidation?.severity === "error") {
    console.warn(
      "[stripe] checkout blocked — unverifiable shipping address:",
      addressValidation.warnings.map((w) => w.message).join("; "),
    );
    return {
      ok: false,
      error:
        "We couldn't verify this shipping address with our delivery partner. " +
        "Please check the street, city and postal code and try again.",
    };
  }

  const customerId = await ensureCustomer(uid, args.email);

  const taxBehavior = settings.tax.perCurrency[currency]?.behavior ?? "exclusive";
  const taxCode = settings.tax.bookTaxCode;
  const hasTax = Boolean(taxCode);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: copies,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: toMinor(unitPrice, currency),
        tax_behavior: hasTax ? taxBehavior : undefined,
        product_data: {
          name: product.presentation.name,
          // The reward is spelled out on the line item, because a price that's
          // quietly lower than the storefront's reads as a bug to the buyer.
          description:
            [product.presentation.tagline || null, referral ? `Invite reward applied: ${referral.summary}` : null]
              .filter(Boolean)
              .join(" · ") || undefined,
          tax_code: taxCode,
          metadata: { sku: printSku },
        },
      },
    },
  ];
  if (shippingCharged > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: toMinor(shippingCharged, currency),
        tax_behavior: hasTax ? taxBehavior : undefined,
        product_data: { name: "Shipping & handling" },
      },
    });
  }

  const fulfillment: FulfillmentPlan = {
    productSku: printSku,
    variant,
    copies,
    shippingMethod: args.shippingMethod,
    destinationCountry: args.destinationCountry,
    currency,
    pageCount: pages,
    merchantReference: args.merchantReference,
    recipient: {
      name: recipient.name,
      email: recipient.email ?? null,
      phoneNumber: recipient.phoneNumber ?? null,
      address: {
        line1: recipient.address.line1,
        line2: recipient.address.line2 ?? null,
        townOrCity: recipient.address.townOrCity,
        stateOrCounty: recipient.address.stateOrCounty ?? null,
        postalOrZipCode: recipient.address.postalOrZipCode,
        countryCode: recipient.address.countryCode,
      },
    },
    sourceFileUrls: args.sourceFileUrls,
    estimatedCost,
  };

  const estimatedTotal = unitPrice * copies + shippingCharged;
  // `rewardful: "false"` when a print order is outside the referring campaign's
  // scope — Rewardful reads it off the charge and creates no commission.
  const affiliateMeta = await affiliateChargeMetadata(uid, "order");
  const session = await createCheckoutSession({
    mode: "payment",
    customer: customerId,
    customer_update: { address: "auto", name: "auto" },
    billing_address_collection: hasTax ? "required" : "auto",
    automatic_tax: { enabled: hasTax },
    line_items: lineItems,
    client_reference_id: paymentId,
    metadata: { paymentId, uid, kind: "order" },
    payment_intent_data: { metadata: { paymentId, uid, kind: "order", ...affiliateMeta } },
    // `payment` is what the confirmation screen keys on: it opens on our own
    // payment id (not the Stripe session) so it can follow the record live —
    // including the fulfillment leg, which happens after this redirect.
    success_url: `${appBaseUrl()}/studio?checkout=success&payment=${paymentId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl()}/studio?checkout=cancel`,
  });

  await createPendingPayment({
    paymentId,
    uid,
    kind: "order",
    amount: Math.round(estimatedTotal * 100) / 100,
    currency,
    description: `${product.presentation.name} ×${copies}`,
    stripeSessionId: session.id,
    stripeCustomerId: customerId,
    fulfillment,
    items: [
      { label: product.presentation.name, amount: unitPrice, quantity: copies },
      ...(shippingCharged > 0
        ? [{ label: "Shipping & handling", amount: shippingCharged, quantity: 1 }]
        : []),
    ],
  });

  return { ok: true, url: session.url, paymentId };
}

// ---- Authenticated user routes ---------------------------------------------

export function registerStripeUserRoutes(app: Express): void {
  const json = express.json({ limit: "60mb" });

  // Create a Checkout Session for a print order (server-authoritative pricing).
  app.post("/checkout", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable. Please try again later.", 503);
        return;
      }
      const uid = req.uid!;
      const body = req.body as CheckoutBody;
      if (!body?.productSku || !body.recipient?.name) {
        clientError(res, "Missing order details.");
        return;
      }

      const [config, settings] = await Promise.all([getProductsConfig(), getPricingSettings()]);
      const resolved = resolvePrintOrder({
        products: config.products,
        productSku: body.productSku,
        variant: body.variant,
        activeOnly: true,
      });
      if (!resolved) {
        clientError(res, "This product isn't available for ordering.");
        return;
      }
      const { product, variant, printSku } = resolved;

      // Resolve the buyer's plan once — it drives both the access gate and the
      // subscriber print discount below.
      const activePlan = await resolveActivePlan(uid);

      // Subscription gate: some products are only orderable on certain plans.
      // Enforced here on the server (the client UI hint is advisory only).
      const access = productAccessOf(product.conditions);
      if (access.mode !== "public") {
        const ctx = { planId: activePlan?.id ?? null, isSubscribed: Boolean(activePlan && !activePlan.isFree) };
        if (!planMeetsAccess(access, ctx)) {
          clientError(
            res,
            "This product is only available with a subscription. Upgrade your plan to order it.",
            403,
          );
          return;
        }
      }

      const currency = (body.currency || settings.baseCurrency).toUpperCase() as CurrencyCode;
      if (!settings.currencies.includes(currency)) {
        clientError(res, `Currency ${currency} isn't supported.`);
        return;
      }
      const copies = Math.max(1, Math.floor(body.copies || 1));
      const pages = Math.max(1, Math.floor(body.pageCount || product.conditions.pages.min));

      // Server-authoritative order limits — the client UI mirrors these, but
      // only this check is binding.
      const cond = product.conditions;
      if (pages < cond.pages.min || pages > cond.pages.max) {
        clientError(res, `This product supports ${cond.pages.min}–${cond.pages.max} pages.`);
        return;
      }
      if (copies < cond.copies.min || copies > cond.copies.max) {
        clientError(res, `You can order between ${cond.copies.min} and ${cond.copies.max} copies.`);
        return;
      }
      // Checked before the uploads below purely to save the round trip;
      // `createPrintCheckout` re-checks and is the binding one.
      const refusal = shippingRefusal(product, {
        country: body.destinationCountry || body.recipient.address.countryCode,
        region: body.recipient.address.stateOrCounty ?? undefined,
        method: body.shippingMethod,
      });
      if (refusal) {
        clientError(res, refusal);
        return;
      }

      // Print files must be hosted BEFORE payment; the webhook places the order
      // from these URLs (it has no access to the blobs).
      //
      // A cached render is preferred over anything the client sent: it was
      // assembled server-side from the same rasters the digital edition uses,
      // so reusing it is both cheaper and the only way the two editions stay
      // identical for a book that hasn't changed.
      const sourceFileUrls: { interior?: string; cover?: string } = {};
      if (body.fingerprint) {
        const [interior, cover] = await Promise.all([
          cachedDocumentUrl(uid, body.fingerprint, documentKey("interior")),
          cachedDocumentUrl(uid, body.fingerprint, documentKey("cover", { sku: printSku, pages })),
        ]);
        if (interior) sourceFileUrls.interior = interior;
        if (cover) sourceFileUrls.cover = cover;
      }

      const host = createAdminAssetHost();
      for (const a of body.assets ?? []) {
        const buf = Buffer.from(a.base64, "base64");
        const ext = (a.contentType ?? "").includes("pdf") ? "pdf" : "png";
        const blob = new Blob([buf], { type: a.contentType || "application/octet-stream" });
        const { url } = await host.upload(blob, `${a.printArea}.${ext}`);
        if (a.printArea === "cover") sourceFileUrls.cover = url;
        else sourceFileUrls.interior = url;
      }
      if (!sourceFileUrls.interior || !sourceFileUrls.cover) {
        // Reached when a cached render was expected but has since been evicted
        // (or never finished assembling). Say so: the fix is to render again,
        // which is what re-opening the order dialog does.
        clientError(
          res,
          "Your book needs to be prepared for printing again. Please close this and try ordering once more.",
        );
        return;
      }

      const result = await createPrintCheckout({
        uid,
        email: body.recipient.email ?? req.authToken?.email ?? null,
        product,
        variant,
        printSku,
        settings,
        activePlan,
        copies,
        pages,
        currency,
        shippingMethod: body.shippingMethod,
        destinationCountry: body.destinationCountry,
        recipient: body.recipient,
        sourceFileUrls,
        merchantReference: body.merchantReference ?? null,
      });
      if (!result.ok) {
        clientError(res, result.error);
        return;
      }
      res.json({ url: result.url, paymentId: result.paymentId });
    } catch (err) {
      if (err instanceof PricingUnavailableError) {
        console.error("[stripe] checkout blocked — order is unpriceable:", err.message);
        clientError(res, err.clientMessage, 409);
        return;
      }
      console.error("[stripe] checkout failed", err);
      clientError(res, "We couldn't start checkout. Please try again.", 500);
    }
  });

  // Retail price preview for the order dialog. Runs the SAME pricing path as
  // checkout (live shipping → retail tiers → plan discount), so what the user
  // sees before "Continue to payment" is exactly what Stripe will charge
  // (before tax). Never exposes wholesale/production costs to the client.
  app.post("/checkout/price", json, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const body = (req.body ?? {}) as {
        productSku?: string;
        variant?: VariantSelection;
        copies?: number;
        pageCount?: number;
        currency?: string;
        shippingMethod?: ShippingMethod;
        destinationCountry?: string;
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
      };
      if (!body.productSku || !body.city || !body.postalCode || !body.destinationCountry) {
        clientError(res, "A destination (city, postal code, country) is required.");
        return;
      }
      const [config, settings] = await Promise.all([getProductsConfig(), getPricingSettings()]);
      const resolved = resolvePrintOrder({
        products: config.products,
        productSku: body.productSku,
        variant: body.variant,
        activeOnly: true,
      });
      if (!resolved) {
        clientError(res, "This product isn't available.", 404);
        return;
      }
      const { product, variant, printSku } = resolved;
      const currency = (body.currency || settings.baseCurrency).toUpperCase() as CurrencyCode;
      if (!settings.currencies.includes(currency)) {
        clientError(res, `Currency ${currency} isn't supported.`);
        return;
      }
      const activePlan = await resolveActivePlan(uid);
      const copies = Math.max(1, Math.floor(body.copies || 1));
      const pages = Math.max(1, Math.floor(body.pageCount || product.conditions.pages.min));
      const priced = await priceRetailOrder({
        product,
        variant,
        printSku,
        settings,
        activePlan,
        copies,
        pages,
        currency,
        // The client always sends a method; when it doesn't, preview a tier this
        // product actually offers. Defaulting to a fixed one previewed a price
        // for a speed the customer would then be unable to select — and if that
        // tier isn't sold to their country, the preview fails on a product that
        // would have quoted perfectly well.
        shippingMethod: body.shippingMethod ?? defaultShippingMethod(product),
        destinationCountry: body.destinationCountry,
        address: {
          line1: body.line1,
          line2: body.line2 ?? null,
          townOrCity: body.city,
          stateOrCounty: body.state ?? null,
          postalOrZipCode: body.postalCode,
        },
      });
      res.json({
        currency,
        copies,
        unitPrice: priced.unitPrice,
        listUnitPrice: priced.listUnitPrice,
        discountPct: priced.discountPct,
        items: Math.round(priced.unitPrice * copies * 100) / 100,
        shipping: priced.shippingCharged,
        total: Math.round((priced.unitPrice * copies + priced.shippingCharged) * 100) / 100,
        // The carrier's normalization of this address, so checkout can offer the
        // correction while it's still free to make.
        addressValidation: priced.addressValidation ?? null,
      });
    } catch (err) {
      if (err instanceof PricingUnavailableError) {
        console.error("[stripe] price preview blocked — order is unpriceable:", err.message);
        clientError(res, err.clientMessage, 409);
        return;
      }
      console.error("[stripe] price preview failed", err);
      clientError(res, "We couldn't price this destination.", 500);
    }
  });

  // Ebook quote: price (with any print-bundle discount) + ownership, so the
  // order screen can show "Buy the ebook" vs "Download your ebook". Pricing is
  // fully admin-configured (PricingSettings.ebook).
  app.get("/checkout/ebook/quote", async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const projectId = String(req.query.projectId ?? "").trim();
      if (!projectId) {
        clientError(res, "A project is required.");
        return;
      }
      const settings = await getPricingSettings();
      const currency = String(req.query.currency ?? settings.baseCurrency).toUpperCase();
      const activePlan = await resolveActivePlan(uid);
      const quote = await priceEbook(uid, projectId, currency, settings, activePlan);
      // The download link is never handed out here — owned ebooks are fetched
      // through the gated, logged `/account/downloads/:id/link` endpoint.
      res.json({ ...quote, downloadUrl: null });
    } catch (err) {
      console.error("[stripe] ebook quote failed", err);
      clientError(res, "We couldn't price the ebook.", 500);
    }
  });

  // Buy the digital edition: the client uploads the rendered PDF NOW (hosted
  // before payment, like print files); the webhook grants the download only
  // after Stripe confirms payment. Price is server-authoritative. Also
  // doubles as the free "update my ebook" path for an owner whose design has
  // changed since their copy was rendered (see `ownedSameVersion` below).
  app.post("/checkout/ebook", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable.", 503);
        return;
      }
      const uid = req.uid!;
      const body = (req.body ?? {}) as {
        projectId?: string;
        title?: string;
        currency?: string;
        pdfBase64?: string;
        contentType?: string;
        /** Content fingerprint of an already-assembled render, if there is one. */
        fingerprint?: string;
      };
      if (!body.projectId || !(body.pdfBase64 || body.fingerprint)) {
        clientError(res, "Missing ebook details.");
        return;
      }
      const settings = await getPricingSettings();
      const currency = (body.currency || settings.baseCurrency).toUpperCase() as CurrencyCode;
      if (!settings.currencies.includes(currency)) {
        clientError(res, `Currency ${currency} isn't supported.`);
        return;
      }
      const activePlan = await resolveActivePlan(uid);
      const quote = await priceEbook(uid, body.projectId, currency, settings, activePlan);
      if (!quote.enabled) {
        clientError(res, "Ebooks aren't available right now.");
        return;
      }
      // Owning the ebook only blocks a re-buy when nothing has changed since
      // the copy on file was rendered — the buyer paid for the ebook, not for
      // one specific render of it, so a design edit gets a free refresh below
      // instead of leaving them stuck re-downloading the original forever.
      const ownedSameVersion =
        quote.owned &&
        body.fingerprint != null &&
        quote.ownedFingerprint != null &&
        body.fingerprint === quote.ownedFingerprint;
      if (ownedSameVersion) {
        clientError(res, "This is already the latest version — download it from the order screen.");
        return;
      }

      const title = (body.title ?? "").trim() || "Your book";

      // Prefer the cached render. A second purchase of an unchanged book (a
      // gift, a re-download after a plan change) then costs nothing to prepare
      // and is byte-identical to the first.
      //
      // The PATH is what gets persisted, not a URL: the entitlement outlives any
      // particular hostname, and every download re-derives the link (see
      // `logDownloadAndResolveUrl`).
      let filePath = body.fingerprint
        ? await cachedDocumentPath(uid, body.fingerprint, documentKey("ebook"))
        : null;
      if (!filePath) {
        if (!body.pdfBase64) {
          clientError(res, "The book hasn't finished rendering yet. Please try again.");
          return;
        }
        const buf = Buffer.from(body.pdfBase64, "base64");
        const blob = new Blob([buf], { type: body.contentType || "application/pdf" });
        const uploaded = await createAdminAssetHost().upload(blob, `ebook-${body.projectId}.pdf`);
        // `AssetHost.path` is optional in general; the admin host always reports
        // it, and without one there'd be nothing for a download to resolve.
        if (!uploaded.path) {
          console.error("[stripe] ebook upload returned no object path");
          clientError(res, "We couldn't prepare your download. Please try again.", 500);
          return;
        }
        filePath = uploaded.path;
      }

      const paymentId = randomUUID();

      // Included with the buyer's plan (price 0), or a free refresh of an
      // ebook the buyer already owns: no Stripe session — record a
      // zero-amount paid payment and (re-)grant the download entitlement
      // directly, stamped with the fingerprint that produced this file so the
      // NEXT quote can tell whether it's still current.
      if (quote.included || quote.price <= 0 || quote.owned) {
        const ebook: EbookFulfillment = {
          projectId: body.projectId,
          title,
          filePath,
          fingerprint: body.fingerprint ?? null,
        };
        await createPendingPayment({
          paymentId,
          uid,
          kind: "ebook",
          amount: 0,
          currency,
          description: quote.owned
            ? `${title} — digital edition (updated)`
            : `${title} — digital edition (included with ${quote.planName ?? "plan"})`,
          stripeSessionId: null,
          ebook,
          items: [{ label: `${title} — digital edition (PDF)`, amount: 0, quantity: 1 }],
        });
        await updatePayment({
          paymentId,
          uid,
          status: "paid",
          event: quote.owned ? "ebook.updated" : "ebook.plan_grant",
        });
        await deliverPaidEbook(paymentId);
        res.json({ granted: true, paymentId });
        return;
      }
      const customerId = await ensureCustomer(uid, req.authToken?.email ?? null);
      const taxBehavior = settings.tax.perCurrency[currency]?.behavior ?? "exclusive";
      const taxCode = settings.ebook.taxCode;
      const hasTax = Boolean(taxCode);

      // The digital edition has no unit cost to protect, so the only clamp that
      // matters is the catalog-wide maximum discount.
      const referral = await earnedReferralDiscount({
        uid,
        itemType: "ebook",
        paymentId,
        settings,
        amount: quote.price,
      });
      const price = referral ? discountedAmount(quote.price, referral.percentOff) : quote.price;

      const session = await createCheckoutSession({
        mode: "payment",
        customer: customerId,
        customer_update: { address: "auto", name: "auto" },
        billing_address_collection: hasTax ? "required" : "auto",
        automatic_tax: { enabled: hasTax },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: toMinor(price, currency),
              tax_behavior: hasTax ? taxBehavior : undefined,
              product_data: {
                name: `${title} — digital edition (PDF)`,
                description:
                  [
                    quote.planName ? `${quote.planName} member price.` : null,
                    quote.discountPct > 0
                      ? `Includes your ${quote.discountPct}% print-owner discount.`
                      : null,
                    referral ? `Invite reward applied: ${referral.summary}.` : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
                tax_code: taxCode,
              },
            },
          },
        ],
        client_reference_id: paymentId,
        metadata: { paymentId, uid, kind: "ebook" },
        payment_intent_data: {
          metadata: { paymentId, uid, kind: "ebook", ...(await affiliateChargeMetadata(uid, "ebook")) },
        },
        success_url: `${appBaseUrl()}/studio?ebook=success&payment=${paymentId}&project=${encodeURIComponent(body.projectId)}`,
        cancel_url: `${appBaseUrl()}/studio?ebook=cancel`,
      });

      const ebook: EbookFulfillment = {
        projectId: body.projectId,
        title,
        filePath,
        fingerprint: body.fingerprint ?? null,
      };
      await createPendingPayment({
        paymentId,
        uid,
        kind: "ebook",
        amount: price,
        currency,
        description: `${title} — digital edition`,
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
        ebook,
        items: [{ label: `${title} — digital edition (PDF)`, amount: price, quantity: 1 }],
      });

      res.json({ url: session.url, paymentId });
    } catch (err) {
      console.error("[stripe] ebook checkout failed", err);
      clientError(res, "We couldn't start the ebook checkout. Please try again.", 500);
    }
  });

  // Reorder a previously PAID print order: reuses the already-hosted print
  // files from the original payment's fulfillment plan, reprices at today's
  // catalog price (+ the buyer's current plan discount), and opens a fresh
  // Checkout Session. No re-rendering, no re-upload.
  app.post("/checkout/reorder", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable.", 503);
        return;
      }
      const uid = req.uid!;
      const { paymentId, copies: rawCopies } = (req.body ?? {}) as {
        paymentId?: string;
        copies?: number;
      };
      if (!paymentId) {
        clientError(res, "A previous order is required.");
        return;
      }
      const previous = await getAdminPayment(paymentId);
      if (!previous || previous.ownerUid !== uid) {
        clientError(res, "Order not found.", 404);
        return;
      }
      const plan = previous.fulfillment;
      if (
        previous.kind !== "order" ||
        previous.status !== "paid" ||
        !plan?.sourceFileUrls?.interior ||
        !plan.sourceFileUrls.cover
      ) {
        clientError(res, "This order can't be reordered. Please place it again from the studio.");
        return;
      }
      const [config, settings] = await Promise.all([getProductsConfig(), getPricingSettings()]);
      // plan.productSku is the composed print SKU; resolve back to the format
      // product and keep the original variant so the reorder reprints the same book.
      const resolved = resolvePrintOrder({
        products: config.products,
        productSku: plan.productSku,
        variant: (plan.variant as VariantSelection | null | undefined) ?? undefined,
        activeOnly: true,
      });
      if (!resolved) {
        clientError(res, "This product isn't available for ordering anymore.");
        return;
      }
      const { product, variant, printSku } = resolved;
      const activePlan = await resolveActivePlan(uid);
      const copies = Math.max(
        product.conditions.copies.min,
        Math.min(product.conditions.copies.max, Math.floor(rawCopies || plan.copies || 1)),
      );
      const result = await createPrintCheckout({
        uid,
        email: plan.recipient.email ?? req.authToken?.email ?? null,
        product,
        variant,
        printSku,
        settings,
        activePlan,
        copies,
        pages: plan.pageCount,
        currency: plan.currency.toUpperCase() as CurrencyCode,
        shippingMethod: plan.shippingMethod as ShippingMethod,
        destinationCountry: plan.destinationCountry,
        recipient: {
          name: plan.recipient.name,
          email: plan.recipient.email ?? undefined,
          phoneNumber: plan.recipient.phoneNumber ?? undefined,
          address: {
            line1: plan.recipient.address.line1,
            line2: plan.recipient.address.line2 ?? undefined,
            townOrCity: plan.recipient.address.townOrCity,
            stateOrCounty: plan.recipient.address.stateOrCounty ?? undefined,
            postalOrZipCode: plan.recipient.address.postalOrZipCode,
            countryCode: plan.recipient.address.countryCode,
          },
        },
        sourceFileUrls: plan.sourceFileUrls,
        merchantReference: plan.merchantReference ?? null,
      });
      if (!result.ok) {
        clientError(res, result.error);
        return;
      }
      res.json({ url: result.url, paymentId: result.paymentId });
    } catch (err) {
      console.error("[stripe] reorder failed", err);
      clientError(res, "We couldn't start checkout. Please try again.", 500);
    }
  });

  // Subscribe to a configured plan. The client sends a planId + interval (+
  // currency); the server resolves the active Stripe price from the plans config
  // (a raw priceId is still accepted for back-compat / tooling).
  app.post("/checkout/subscription", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable.", 503);
        return;
      }
      const uid = req.uid!;
      const body = (req.body ?? {}) as {
        priceId?: string;
        planId?: string;
        interval?: BillingInterval;
        currency?: string;
      };

      // One live subscription per account: plan CHANGES go through the Customer
      // Portal (which upgrades/downgrades the existing subscription with
      // proration) instead of opening a second Checkout subscription.
      if (await hasActiveSubscription(uid)) {
        const customerId = await getStripeCustomerId(uid);
        if (customerId) {
          const portal = await getStripe().billingPortal.sessions.create({
            customer: customerId,
            return_url: `${appBaseUrl()}/studio`,
          });
          res.json({ url: portal.url, portal: true });
          return;
        }
        clientError(res, "You already have an active subscription. Manage it from your account menu.");
        return;
      }

      let priceId = body.priceId?.trim() || "";
      if (!priceId && body.planId) {
        const config = await getPlansConfig();
        const plan = config.plans.find((p) => p.id === body.planId);
        if (!plan || plan.isFree) {
          clientError(res, "That plan isn't available.");
          return;
        }
        const interval: BillingInterval = body.interval === "year" ? "year" : "month";
        const currency = (body.currency || "USD").toUpperCase();
        const pp =
          plan.billing.prices[currency]?.[interval] ??
          plan.billing.prices[Object.keys(plan.billing.prices)[0] ?? ""]?.[interval];
        const envPriceId = priceIdForEnv(pp, isSandbox() ? "sandbox" : "live");
        priceId = pp?.active && envPriceId ? envPriceId : "";
      }
      if (!priceId) {
        clientError(res, "A plan price is required.");
        return;
      }

      const customerId = await ensureCustomer(uid, req.authToken?.email);
      // Membership is the one place a referral discount has to be a real Stripe
      // coupon: Stripe generates the invoice, so we can't just quote less.
      const subscriptionRef = randomUUID();
      const referral = await planDiscountCoupon(uid, subscriptionRef);
      // `createCheckoutSession` retries without automatic tax if Stripe Tax
      // isn't activated, so subscriptions collect tax when possible but never
      // hard-fail because of tax configuration.
      const session = await createCheckoutSession({
        mode: "subscription",
        customer: customerId,
        customer_update: { address: "auto", name: "auto" },
        automatic_tax: { enabled: true },
        line_items: [{ price: priceId, quantity: 1 }],
        ...(referral ? { discounts: [{ coupon: referral.couponId }] } : {}),
        metadata: {
          uid,
          kind: "subscription",
          // The reservation ref, so the invoice webhook can settle the reward.
          ...(referral ? { referralRef: subscriptionRef } : {}),
        },
        // Stamp uid on the subscription so invoice grants can attribute Sparks.
        // The affiliate flag rides on the SUBSCRIPTION rather than a charge so it
        // applies to every renewal invoice, not just the first one.
        subscription_data: {
          metadata: {
            uid,
            ...(referral ? { referralRef: subscriptionRef } : {}),
            ...(await affiliateChargeMetadata(uid, "subscription")),
          },
        },
        success_url: `${appBaseUrl()}/studio?subscription=success`,
        cancel_url: `${appBaseUrl()}/studio?subscription=cancel`,
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("[stripe] subscription checkout failed", err);
      clientError(res, "We couldn't start checkout. Please try again.", 500);
    }
  });

  // Buy a one-time Spark top-up pack. Server prices it from the Sparks config so
  // the client can't choose the amount; Sparks are granted from the webhook.
  app.post("/checkout/sparks-pack", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable.", 503);
        return;
      }
      const uid = req.uid!;
      const { packId, currency: rawCurrency } = (req.body ?? {}) as { packId?: string; currency?: string };
      const config = await getSparksConfig();
      if (!config.enabled) {
        clientError(res, "Spark purchases aren't available right now.", 503);
        return;
      }
      const pack = config.packs.find((p) => p.id === packId && p.active);
      if (!pack) {
        clientError(res, "That Spark pack isn't available.");
        return;
      }
      const currency = (rawCurrency || "USD").toUpperCase();
      const price = pack.prices[currency];
      if (typeof price !== "number" || price <= 0) {
        clientError(res, `This pack isn't priced in ${currency}.`);
        return;
      }
      const totalSparks = packTotalSparks(pack);
      const paymentId = randomUUID();
      const customerId = await ensureCustomer(uid, req.authToken?.email);
      const referral = await earnedReferralDiscount({
        uid,
        itemType: "pack",
        paymentId,
        settings: await getPricingSettings(),
        amount: price,
      });
      const chargedPrice = referral ? discountedAmount(price, referral.percentOff) : price;
      const session = await createCheckoutSession({
        mode: "payment",
        customer: customerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: toMinor(chargedPrice, currency),
              product_data: {
                name: `${totalSparks} Sparks (${pack.label})`,
                description: referral ? `Invite reward applied: ${referral.summary}.` : undefined,
              },
            },
          },
        ],
        client_reference_id: paymentId,
        metadata: { paymentId, uid, kind: "sparkPack", packId: pack.id, sparks: String(totalSparks) },
        payment_intent_data: {
          metadata: {
            paymentId,
            uid,
            kind: "sparkPack",
            packId: pack.id,
            sparks: String(totalSparks),
            ...(await affiliateChargeMetadata(uid, "sparkPack")),
          },
        },
        success_url: `${appBaseUrl()}/studio?sparks=success&payment=${paymentId}`,
        cancel_url: `${appBaseUrl()}/studio?sparks=cancel`,
      });
      await createPendingPayment({
        paymentId,
        uid,
        kind: "sparkPack",
        amount: chargedPrice,
        currency,
        description: `${totalSparks} Sparks`,
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
        items: [{ label: `${totalSparks} Sparks`, amount: chargedPrice, quantity: 1 }],
      });
      res.json({ url: session.url, paymentId });
    } catch (err) {
      console.error("[stripe] sparks-pack checkout failed", err);
      clientError(res, "We couldn't start checkout. Please try again.", 500);
    }
  });

  // Buy a Spark pack AS A GIFT: the buyer pays now; the Sparks are granted to
  // whoever redeems the claim code (created by the webhook after payment).
  app.post("/checkout/sparks-gift", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable.", 503);
        return;
      }
      const uid = req.uid!;
      const body = (req.body ?? {}) as {
        packId?: string;
        currency?: string;
        recipientEmail?: string;
        message?: string;
      };
      const config = await getSparksConfig();
      if (!config.enabled) {
        clientError(res, "Spark purchases aren't available right now.", 503);
        return;
      }
      const pack = config.packs.find((p) => p.id === body.packId && p.active);
      if (!pack) {
        clientError(res, "That Spark pack isn't available.");
        return;
      }
      const currency = (body.currency || "USD").toUpperCase();
      const price = pack.prices[currency];
      if (typeof price !== "number" || price <= 0) {
        clientError(res, `This pack isn't priced in ${currency}.`);
        return;
      }
      const totalSparks = packTotalSparks(pack);
      const paymentId = randomUUID();
      const giftCode = newGiftCode();
      const customerId = await ensureCustomer(uid, req.authToken?.email);
      const meta = {
        paymentId,
        uid,
        kind: "sparkGift",
        packId: pack.id,
        sparks: String(totalSparks),
        giftCode,
        recipientEmail: (body.recipientEmail ?? "").slice(0, 200),
        giftMessage: (body.message ?? "").slice(0, 300),
      };
      const session = await createCheckoutSession({
        mode: "payment",
        customer: customerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: toMinor(price, currency),
              product_data: { name: `Gift: ${totalSparks} Sparks (${pack.label})` },
            },
          },
        ],
        client_reference_id: paymentId,
        metadata: meta,
        payment_intent_data: {
          metadata: { ...meta, ...(await affiliateChargeMetadata(uid, "sparkGift")) },
        },
        success_url: `${appBaseUrl()}/studio?gift=success&payment=${paymentId}`,
        cancel_url: `${appBaseUrl()}/studio?gift=cancel`,
      });
      await createPendingPayment({
        paymentId,
        uid,
        kind: "sparkGift",
        amount: price,
        currency,
        description: `Gift: ${totalSparks} Sparks`,
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
        items: [{ label: `Gift: ${totalSparks} Sparks`, amount: price, quantity: 1 }],
      });
      res.json({ url: session.url, paymentId, giftCode });
    } catch (err) {
      console.error("[stripe] sparks-gift checkout failed", err);
      clientError(res, "We couldn't start checkout. Please try again.", 500);
    }
  });

  // The gifts the caller has bought (claim codes + status) — the buyer needs
  // the code after checkout, and this also shows whether it was redeemed.
  app.get("/account/gifts", async (req: AuthedRequest, res: Response) => {
    try {
      res.json({ gifts: await listGiftsBought(req.uid!) });
    } catch (err) {
      clientError(res, (err as Error)?.message ?? "Could not load your gifts.", 500);
    }
  });

  // Redeem a gift code (grants the Sparks to the CALLER).
  app.post("/account/sparks/claim-gift", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { code } = (req.body ?? {}) as { code?: string };
      const sparks = await claimGift(req.uid!, code ?? "");
      res.json({ ok: true, sparks });
    } catch (err) {
      clientError(res, (err as Error)?.message ?? "Could not claim this gift.");
    }
  });

  // The referral program's own routes live in `referrals/routes.ts` (invite,
  // accept, decline, overview) — they're a feature surface of their own, not a
  // payments concern.

  // Claim every starter-grant ladder rung the caller qualifies for (guest →
  // signup → verify; each rung idempotent). Deliberately OUTSIDE the /account
  // requireVerified guard: guests and unverified users claim their rungs too.
  // The studio calls this whenever the sparks watch (re)starts.
  app.post("/sparks/claim", requireAuth, json, async (req: AuthedRequest, res: Response) => {
    try {
      const { ensureGrantLadder } = await import("./sparks");
      const verified = isVerifiedToken(req.authToken);
      await ensureGrantLadder({
        uid: req.uid!,
        anonymous: isAnonymousToken(req.authToken),
        verified,
        ip: req.ip,
      });
      // The same "did they verify yet?" question the grant ladder asks, so this
      // is where the referral program learns it too. Idempotent downstream.
      if (verified) await onReferralEvent(req.uid!, "email_verified");
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  // Open the Stripe Customer Portal (manage subscription, payment methods).
  app.post("/account/portal", json, async (req: AuthedRequest, res: Response) => {
    try {
      if (!stripeConfigured()) {
        clientError(res, "Payments are temporarily unavailable.", 503);
        return;
      }
      const customerId = await getStripeCustomerId(req.uid!);
      if (!customerId) {
        clientError(res, "No billing account yet.", 404);
        return;
      }
      const portal = await getStripe().billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appBaseUrl()}/studio`,
      });
      res.json({ url: portal.url });
    } catch (err) {
      console.error("[stripe] portal failed", err);
      clientError(res, "We couldn't open billing. Please try again.", 500);
    }
  });

  // Digital-download link. Authorizes the owner, records an audit event (time,
  // IP, device) + bumps the download counter, then returns a fresh URL to fetch
  // the file. The raw storage URL is never exposed directly, so every download
  // is authenticated and logged.
  app.post("/account/downloads/:id/link", async (req: AuthedRequest, res: Response) => {
    try {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        clientError(res, "A download id is required.");
        return;
      }
      const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
      const url = await logDownloadAndResolveUrl(req.uid!, id, { ip: req.ip ?? null, userAgent });
      if (!url) {
        clientError(res, "We couldn't find that download.", 404);
        return;
      }
      res.json({ url });
    } catch (err) {
      console.error("[stripe] download link failed", err);
      clientError(res, "We couldn't prepare your download. Please try again.", 500);
    }
  });

  // Clear the "new downloads" badge by marking every entitlement seen.
  app.post("/account/downloads/seen", async (req: AuthedRequest, res: Response) => {
    try {
      await markDownloadsSeen(req.uid!);
      res.json({ ok: true });
    } catch (err) {
      console.error("[stripe] mark downloads seen failed", err);
      clientError(res, "We couldn't update your downloads.", 500);
    }
  });
}

// ---- Fulfillment after payment ---------------------------------------------

/**
 * Place the print order for a PAID payment, exactly once. Builds the order from
 * the stored fulfillment plan (with already-hosted file URLs) and persists the
 * neutral + admin order records, then links the order id onto the payment.
 */
async function fulfillPaidOrder(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  if (!payment || !payment.fulfillment) return;
  if (payment.orderId) return;

  const claimed = await claimFulfillment(paymentId);
  if (!claimed) return; // a concurrent/retry webhook already took it

  const plan = payment.fulfillment;
  const draft: OrderDraft = {
    productSku: plan.productSku,
    copies: plan.copies,
    recipient: {
      name: plan.recipient.name,
      email: plan.recipient.email ?? undefined,
      phoneNumber: plan.recipient.phoneNumber ?? undefined,
      address: {
        line1: plan.recipient.address.line1,
        line2: plan.recipient.address.line2 ?? undefined,
        townOrCity: plan.recipient.address.townOrCity,
        stateOrCounty: plan.recipient.address.stateOrCounty ?? undefined,
        postalOrZipCode: plan.recipient.address.postalOrZipCode,
        countryCode: plan.recipient.address.countryCode,
      },
    },
    shippingMethod: plan.shippingMethod as ShippingMethod,
    assets: [],
    sourceFileUrls: plan.sourceFileUrls,
    destinationCountry: plan.destinationCountry,
    currency: plan.currency,
    merchantReference: plan.merchantReference ?? undefined,
    idempotencyKey: paymentId,
  };

  try {
    const order = await fulfillmentProvider().createOrder(draft);
    const cfg = serverConfig();
    // Persisting also books the provider's charge as `printCost` COGS via the
    // cumulative-delta pattern (and status webhooks book any later revisions),
    // so the finance stream tracks what Lulu ACTUALLY charges — with the
    // checkout-time configured estimate alongside for calibration.
    await persistCreatedOrder({
      uid: payment.ownerUid,
      provider: "lulu",
      env: cfg.fulfillment.lulu.env,
      paymentId,
      estimatedCost: plan.estimatedCost ?? null,
      draft,
      order,
    });
    await updatePayment({
      paymentId,
      uid: payment.ownerUid,
      orderId: order.id,
      event: "order.placed",
      fulfillmentState: "placed",
    });
    // The address cleared validation at checkout, so a correction appearing HERE
    // means something slipped through — and the provider may hold the job for
    // manual confirmation while the customer is already charged. The customer
    // sees it on their order; this is so a human does too.
    const warnings = order.addressValidation?.warnings ?? [];
    if (warnings.length > 0 || order.addressValidation?.suggested) {
      await raiseAlert({
        severity: "warning",
        kind: "fulfillment.addressCorrected",
        message:
          `Print order ${order.id} (payment ${paymentId}) was accepted with an address correction: ` +
          (warnings.map((w) => w.message).join("; ") || "a different address was suggested."),
        meta: { paymentId, orderId: order.id, uid: payment.ownerUid },
        ref: `${paymentId}_address`,
      });
    }
  } catch (err) {
    // The customer has paid; surface the failure for admin follow-up but don't
    // throw (a 500 makes Stripe retry, which won't fix a fulfillment error).
    // The failure is persisted with retry state — a scheduled sweep retries it
    // with backoff, and an admin alert is raised so a human sees it too.
    const message = (err as Error)?.message ?? "Unknown fulfillment error";
    console.error("[stripe] fulfillment after payment failed", paymentId, err);
    const attempt = payment.fulfillmentAttempts + 1;
    await markFulfillmentFailed({
      paymentId,
      uid: payment.ownerUid,
      error: message,
      exhausted: attempt >= MAX_FULFILLMENT_ATTEMPTS,
    });
    await raiseAlert({
      severity: attempt >= MAX_FULFILLMENT_ATTEMPTS ? "critical" : "warning",
      kind: "fulfillment.failed",
      message: `Print order for paid payment ${paymentId} failed (attempt ${attempt}): ${message}`,
      meta: { paymentId, uid: payment.ownerUid, attempt },
      ref: `${paymentId}_${attempt}`,
    });
    await recordFinanceEvent({
      category: "waste",
      kind: "fulfillmentFailed",
      amountUsd: 0,
      uid: payment.ownerUid,
      projectId: plan.merchantReference ?? undefined,
      ref: `${paymentId}_${attempt}`,
      meta: { paymentId, attempt, error: message.slice(0, 500) },
    });
    // Once retries are exhausted, tell the customer we hit a snag (deduped on
    // the payment id so it goes out at most once). Best-effort.
    if (attempt >= MAX_FULFILLMENT_ATTEMPTS) {
      try {
        await sendOrderFailedEmail({
          uid: payment.ownerUid,
          orderRef: payment.orderId ?? paymentId,
          paymentId,
        });
      } catch (mailErr) {
        console.warn("[stripe] order_failed email failed", paymentId, mailErr);
      }
    }
  }
}

const MAX_FULFILLMENT_ATTEMPTS = 5;

/**
 * Retry paid orders whose print placement failed, with linear backoff (30min ×
 * attempts). Called by the scheduled sweep; also usable from the admin route.
 * Returns how many orders were successfully placed this pass.
 */
export async function retryFailedFulfillments(): Promise<number> {
  const pending = await listFailedFulfillments(MAX_FULFILLMENT_ATTEMPTS);
  let placed = 0;
  for (const p of pending) {
    const backoffMs = 30 * 60_000 * Math.max(1, p.fulfillmentAttempts);
    if (p.fulfillmentFailedAt && Date.now() - p.fulfillmentFailedAt < backoffMs) continue;
    await fulfillPaidOrder(p.id);
    const after = await getAdminPayment(p.id);
    if (after?.orderId) {
      placed += 1;
      await raiseAlert({
        severity: "info",
        kind: "fulfillment.recovered",
        message: `Print order for payment ${p.id} was placed on retry.`,
        meta: { paymentId: p.id },
        ref: p.id,
      });
    }
  }
  return placed;
}

// ---- Webhook ---------------------------------------------------------------

/**
 * The total tax on an invoice, in minor units. Older API versions expose
 * `invoice.tax`; 2025+ versions replace it with a `total_taxes` array — read
 * both defensively (webhook shapes follow the ACCOUNT's API version).
 */
function invoiceTaxMinor(invoice: Stripe.Invoice): number {
  const inv = invoice as unknown as {
    tax?: number | null;
    total_taxes?: { amount?: number }[] | null;
  };
  if (typeof inv.tax === "number") return inv.tax;
  if (Array.isArray(inv.total_taxes)) {
    return inv.total_taxes.reduce((sum, t) => sum + (Number(t?.amount) || 0), 0);
  }
  return 0;
}

/**
 * The BILLING market of a charge — who paid, which is what revenue, tax and
 * pricing questions are really about. Prefers the address the customer entered
 * over the card's issuing country, since a card issued abroad is common for
 * expats and says little about the market.
 */
function billingCountryOf(charge: Stripe.Charge): string | undefined {
  const address = charge.billing_details?.address?.country;
  const card = (charge.payment_method_details as { card?: { country?: string | null } } | null)
    ?.card?.country;
  return normalizeCountry(address) ?? normalizeCountry(card) ?? undefined;
}

/** Pull fee + net + receipt + billing market off a PaymentIntent's charge (expanded). */
async function chargeFinancials(paymentIntentId: string): Promise<{
  chargeId?: string;
  receiptUrl?: string;
  fee?: number;
  net?: number;
  currency?: string;
  country?: string;
}> {
  try {
    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = pi.latest_charge as Stripe.Charge | null;
    if (!charge) return {};
    const bt = charge.balance_transaction as Stripe.BalanceTransaction | null;
    const currency = (charge.currency ?? "usd").toUpperCase();
    return {
      chargeId: charge.id,
      receiptUrl: charge.receipt_url ?? undefined,
      fee: bt ? toMajor(bt.fee, bt.currency) : undefined,
      net: bt ? toMajor(bt.net, bt.currency) : undefined,
      currency,
      country: billingCountryOf(charge),
    };
  } catch (err) {
    console.warn("[stripe] could not load charge financials", err);
    return {};
  }
}

/**
 * Resolve the analysis dimensions of a paid payment: which product was sold,
 * how many units, and — for print — the provider SKU and shipping destination.
 *
 * The catalog lookup maps the provider SKU stored on the fulfillment plan back
 * to the catalog's internal product id, so the finance stream records a key
 * that survives re-pointing a product at a different SKU.
 */
async function paymentDimensions(
  kind: PaymentKind,
  payment: AdminPaymentRecord | null,
  metadata: Stripe.Metadata | null | undefined,
): Promise<{ productId: string; sku?: string; units: number; destinationCountry?: string }> {
  if (kind === "order") {
    const plan = payment?.fulfillment ?? null;
    const sku = plan?.productSku ?? undefined;
    let internalId: string | null = null;
    if (sku) {
      try {
        const config = await getProductsConfig();
        internalId = findProductForSku(config.products, sku)?.id ?? null;
      } catch {
        // Catalog unavailable — fall back to the SKU so the line is still grouped.
      }
    }
    return {
      productId: productKey("print", internalId ?? sku ?? null),
      sku,
      units: plan?.copies ?? 1,
      destinationCountry: normalizeCountry(plan?.destinationCountry) ?? undefined,
    };
  }
  if (kind === "ebook") {
    return { productId: productKey("ebook", null), units: 1 };
  }
  if (kind === "sparkPack" || kind === "sparkGift") {
    return { productId: productKey("pack", (metadata?.packId as string) || null), units: 1 };
  }
  return { productId: productKey("plan", (metadata?.planId as string) || null), units: 1 };
}

function subStatusToUpsert(sub: Stripe.Subscription, uid: string | null) {
  const item = sub.items.data[0];
  const price = item?.price;
  // In recent API versions the period bounds live on the subscription item.
  const periodEnd = item?.current_period_end ?? null;
  return {
    id: sub.id,
    uid: uid ?? "",
    status: sub.status,
    priceId: price?.id ?? null,
    productId: typeof price?.product === "string" ? price.product : (price?.product?.id ?? null),
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    amount: price?.unit_amount != null ? toMajor(price.unit_amount, price.currency ?? "usd") : null,
    currency: price?.currency ?? null,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
  };
}

/**
 * Grant a subscription's Sparks for one paid invoice. Resolves the plan from
 * the invoice line's price id and grants idempotently on the invoice id:
 *   - monthly invoice → `monthlySparks` (capped by the rollover policy)
 *   - yearly invoice  → `monthlySparks × 12` up front (annual subscribers pay
 *     for the full year, so they get the full year's Sparks — no rollover cap
 *     on the lump) plus the one-time annual bonus.
 * Also records the invoice as subscription revenue. Best-effort: never throws
 * back into the webhook.
 */
async function grantSubscriptionSparks(invoice: Stripe.Invoice): Promise<void> {
  try {
    const line = invoice.lines?.data?.find((l) => (l as { price?: Stripe.Price }).price) ?? invoice.lines?.data?.[0];
    const price = (line as { price?: Stripe.Price } | undefined)?.price;
    const priceId = price?.id ?? null;
    if (!priceId) return;

    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    // `subscription_details.metadata` carries the uid we stamped at checkout, but
    // it isn't in the SDK's Invoice type across versions — read it defensively.
    const subMeta = (invoice as unknown as { subscription_details?: { metadata?: Record<string, unknown> } })
      .subscription_details?.metadata;
    const uid =
      (typeof subMeta?.uid === "string" ? subMeta.uid : null) ??
      (customerId ? await findUidByCustomerId(customerId) : null);
    if (!uid) return;

    const config = await getPlansConfig();
    const plan = resolvePlanByPriceId(config, priceId);
    if (!plan || plan.isFree) return;

    const interval = intervalForPriceId(plan, priceId);
    const monthly = plan.grant.monthlySparks;
    if (monthly > 0) {
      const isAnnual = interval === "year";
      const amount = isAnnual ? monthly * 12 : monthly;
      const rolloverCap =
        !isAnnual && plan.grant.rolloverMultiple > 0
          ? monthly * plan.grant.rolloverMultiple
          : undefined;
      await grantSparks({
        uid,
        amount,
        type: "grant",
        reason: `subscription:${plan.id}`,
        source: "subscription",
        ref: invoice.id,
        rolloverCap,
      });
    }

    if (interval === "year" && plan.grant.annualBonusSparks > 0) {
      await grantSparks({
        uid,
        amount: plan.grant.annualBonusSparks,
        type: "grant",
        reason: `subscription-bonus:${plan.id}`,
        source: "subscription",
        ref: `${invoice.id}_bonus`,
      });
    }

    // Revenue recognition + referral trigger for the paid invoice.
    const currency = (invoice.currency ?? "usd").toUpperCase();
    const gross = toMajor(invoice.amount_paid ?? 0, currency);
    if (gross > 0 && invoice.id) {
      // The Stripe fee lives on the charge's balance transaction, reachable
      // through the invoice's payment intent (field name varies across API
      // versions, so read it defensively). Without it, subscription profit is
      // overstated by ~2–3% + the fixed fee on every invoice.
      const piRef = (invoice as unknown as { payment_intent?: string | { id?: string } | null })
        .payment_intent;
      const piId = typeof piRef === "string" ? piRef : (piRef?.id ?? undefined);
      const charge = piId ? await chargeFinancials(piId) : {};
      const country =
        charge.country ??
        normalizeCountry(invoice.customer_address?.country) ??
        undefined;
      const productId = productKey("plan", plan.id);
      await recordChargeRevenue({
        category: "subscriptions",
        kind: "subscriptionRevenue",
        uid,
        gross,
        fee: charge.fee,
        currency,
        country,
        productId,
        units: 1,
        ref: invoice.id,
        meta: { planId: plan.id, interval },
      });
      // `amount_paid` includes the tax Stripe Tax collected — owed to the tax
      // authority, not revenue.
      await recordTaxRemitted({
        category: "subscriptions",
        uid,
        tax: toMajor(invoiceTaxMinor(invoice), currency),
        currency,
        country,
        productId,
        ref: invoice.id,
      });
      // Referral triggers for membership. The hook counts paid invoices to tell
      // "became a member" from "renewed" (and which renewal), and settles any
      // referral coupon that rode along on the checkout. Both ids are read
      // defensively for the same reason `subMeta` is: the field's shape moves
      // between API versions.
      const subRef = (invoice as unknown as { subscription?: string | { id?: string } | null }).subscription;
      const subscriptionId = typeof subRef === "string" ? subRef : (subRef?.id ?? null);
      if (subscriptionId) {
        await onSubscriptionInvoicePaid({ uid, subscriptionId, invoiceId: invoice.id, amount: gross });
      }
      // `subtotal` is the invoice BEFORE the coupon, so it's what the referral
      // discount actually cost us — `amount_paid` is what's left after it.
      if (typeof subMeta?.referralRef === "string") {
        await finalizeDiscountsForPayment(subMeta.referralRef, toMajor(invoice.subtotal ?? 0, currency));
      }
    }
  } catch (err) {
    console.warn("[stripe] subscription Spark grant failed", err);
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentId = (session.metadata?.paymentId as string) || session.client_reference_id || "";
      const uid = (session.metadata?.uid as string) || "";
      const kind = session.metadata?.kind;

      if (session.customer && uid) {
        const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
        await saveStripeCustomerId(uid, customerId).catch(() => {});
      }

      if (kind === "subscription") {
        // Subscription details arrive via customer.subscription.* events; the
        // recurring Spark grant happens on invoice.paid.
        return;
      }
      if (!paymentId || !uid) return;

      if (session.payment_status === "paid") {
        const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        const gross =
          session.amount_total != null ? toMajor(session.amount_total, session.currency ?? "usd") : undefined;
        await updatePayment({
          paymentId,
          uid,
          status: "paid",
          amount: gross,
          currency: session.currency ?? undefined,
          stripePaymentIntentId: piId,
          event: "checkout.session.completed",
        });
        // The session's `amount_total` (and the PI gross recorded as revenue on
        // payment_intent.succeeded) includes the tax Stripe Tax collected —
        // owed to the authority, not revenue. Book it as a cost line here, the
        // one event that carries the tax split. Idempotent on the paymentId.
        const taxMinor = session.total_details?.amount_tax ?? 0;
        if (taxMinor > 0) {
          const cur = (session.currency ?? "usd").toUpperCase();
          await recordTaxRemitted({
            category: kind === "order" || kind === "ebook" ? "books" : "sparks",
            uid,
            tax: toMajor(taxMinor, cur),
            currency: cur,
            // The session is where Stripe Tax resolved the customer's location,
            // so this is the most authoritative billing market we ever see.
            country: normalizeCountry(session.customer_details?.address?.country) ?? undefined,
            ref: paymentId,
          });
        }
        if (kind === "sparkPack") {
          // Grant the purchased Sparks, idempotent on the paymentId. The lot
          // carries the real revenue per Spark for paid/free spend attribution.
          const sparks = Number(session.metadata?.sparks ?? 0);
          if (sparks > 0) {
            const paidUsd = gross ? await toUsd(gross, session.currency ?? "usd") : 0;
            await grantSparks({
              uid,
              amount: sparks,
              type: "purchase",
              reason: `pack:${session.metadata?.packId ?? ""}`,
              source: "pack",
              usdPerSpark: paidUsd > 0 ? paidUsd / sparks : null,
              ref: paymentId,
            });
            await sendSparksPurchasedEmail({ uid, sparks, paymentId });
          }
        } else if (kind === "sparkGift") {
          const sparks = Number(session.metadata?.sparks ?? 0);
          const giftCode = (session.metadata?.giftCode as string) || "";
          if (sparks > 0 && giftCode) {
            const paidUsd = gross ? await toUsd(gross, session.currency ?? "usd") : 0;
            const recipientEmail = (session.metadata?.recipientEmail as string) || null;
            const giftMessage = (session.metadata?.giftMessage as string) || null;
            await createPaidGift({
              code: giftCode,
              sparks,
              usdPerSpark: paidUsd > 0 ? paidUsd / sparks : null,
              buyerUid: uid,
              recipientEmail,
              message: giftMessage,
              paymentId,
            });
            // Confirm to the buyer, and notify the recipient if we have their email.
            await sendGiftPurchasedEmail({ uid, sparks, code: giftCode, recipientEmail, paymentId });
            if (recipientEmail) {
              await sendGiftReceivedEmail({
                to: recipientEmail,
                sparks,
                code: giftCode,
                message: giftMessage,
                paymentId,
              });
            }
          }
        } else if (kind === "ebook") {
          await deliverPaidEbook(paymentId);
        } else {
          await fulfillPaidOrder(paymentId);
          const order = await getAdminPayment(paymentId);
          await sendOrderConfirmationEmail({
            uid,
            orderRef: order?.orderId ?? paymentId,
            itemLabel: "Your custom picture book",
            paymentId,
          });
        }
        // Any money at all counts as the referred user's first purchase. Safe to
        // call on every purchase: a reward exists once per invitation, rule and
        // side, so the second purchase can't re-pay. Also settles the earned
        // discount (if any) that this payment consumed.
        await onReferralEvent(uid, "first_purchase", { ref: paymentId, amount: gross });
        await finalizeDiscountsForPayment(paymentId);
      }
      return;
    }

    // Recurring subscription billing — grant the plan's Sparks for each paid
    // invoice (idempotent on the invoice id, so renewals + retries are safe).
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      await grantSubscriptionSparks(invoice);
      return;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentId =
        (pi.metadata?.paymentId as string) ||
        (await findPaymentIdByStripeId("stripePaymentIntentId", pi.id)) ||
        "";
      const uid = (pi.metadata?.uid as string) || "";
      if (!paymentId || !uid) return;
      const gross = toMajor(pi.amount_received || pi.amount, pi.currency);
      const fin = await chargeFinancials(pi.id);
      await updatePayment({
        paymentId,
        uid,
        status: "paid",
        amount: gross,
        currency: pi.currency,
        stripePaymentIntentId: pi.id,
        stripeChargeId: fin.chargeId,
        receiptUrl: fin.receiptUrl ?? null,
        feeAmount: fin.fee ?? null,
        netAmount: fin.net ?? null,
        billingCountry: fin.country ?? null,
        event: "payment_intent.succeeded",
      });

      const kind = ((pi.metadata?.kind as string) || "order") as PaymentKind;
      const payment = await getAdminPayment(paymentId);
      const projectId =
        payment?.fulfillment?.merchantReference ?? payment?.ebook?.projectId ?? undefined;
      const dims = await paymentDimensions(kind, payment, pi.metadata);

      // Revenue + fee land in the finance stream here (this event carries the
      // charge financials). Idempotent on the paymentId.
      await recordChargeRevenue({
        category: kind === "order" || kind === "ebook" ? "books" : "sparks",
        kind: kind === "order" ? "printRevenue" : kind === "ebook" ? "ebookRevenue" : "packRevenue",
        uid,
        projectId,
        gross,
        fee: fin.fee,
        currency: pi.currency.toUpperCase(),
        country: fin.country,
        productId: dims.productId,
        sku: dims.sku,
        units: dims.units,
        ref: paymentId,
        meta: {
          ...(kind === "sparkGift" ? { gift: true } : {}),
          // Where it SHIPPED, alongside where it was BILLED — they diverge on
          // gift orders, and print margin follows the destination.
          ...(dims.destinationCountry ? { destinationCountry: dims.destinationCountry } : {}),
        },
      });

      // Close the project funnel: a paid print/ebook order is the last
      // milestone a book can reach, and the one every conversion rate is
      // measured against.
      if (uid && projectId && (kind === "order" || kind === "ebook")) {
        await stampMilestone(uid, projectId, "ordered").catch(() => {});
      }

      // Safety net in case checkout.session.completed was missed: grants and
      // fulfillment are all idempotent on the paymentId, so double-fire is safe.
      if (kind === "sparkPack") {
        const sparks = Number(pi.metadata?.sparks ?? 0);
        if (sparks > 0) {
          const paidUsd = await toUsd(gross, pi.currency);
          await grantSparks({
            uid,
            amount: sparks,
            type: "purchase",
            reason: `pack:${pi.metadata?.packId ?? ""}`,
            source: "pack",
            usdPerSpark: paidUsd > 0 ? paidUsd / sparks : null,
            ref: paymentId,
          });
        }
      } else if (kind === "sparkGift") {
        const sparks = Number(pi.metadata?.sparks ?? 0);
        const giftCode = (pi.metadata?.giftCode as string) || "";
        if (sparks > 0 && giftCode) {
          const paidUsd = await toUsd(gross, pi.currency);
          await createPaidGift({
            code: giftCode,
            sparks,
            usdPerSpark: paidUsd > 0 ? paidUsd / sparks : null,
            buyerUid: uid,
            recipientEmail: (pi.metadata?.recipientEmail as string) || null,
            message: (pi.metadata?.giftMessage as string) || null,
            paymentId,
          });
        }
      } else if (kind === "ebook") {
        await deliverPaidEbook(paymentId);
      } else {
        await fulfillPaidOrder(paymentId);
      }
      await onReferralEvent(uid, "first_purchase", { ref: paymentId, amount: gross });
      await finalizeDiscountsForPayment(paymentId);

      // Celebratory ping (#growth). Deduped on the paymentId so a webhook retry
      // (or the checkout.session.completed safety-net) can't double-post.
      const label =
        kind === "order"
          ? "📦 Print order placed"
          : kind === "ebook"
            ? "📖 Ebook purchased"
            : kind === "sparkGift"
              ? "🎁 Spark gift purchased"
              : "✨ Spark pack purchased";
      await notifySlack({
        channel: "growth",
        messageKey: "purchase",
        ref: `purchase_${paymentId}`,
        text: `${label} — ${money(gross, pi.currency)}${projectId ? ` · project ${projectId}` : ""}`,
      });
      return;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentId = (pi.metadata?.paymentId as string) || "";
      const uid = (pi.metadata?.uid as string) || "";
      if (!paymentId || !uid) return;
      await updatePayment({ paymentId, uid, status: "failed", event: "payment_intent.payment_failed" });
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      const paymentId = piId ? await findPaymentIdByStripeId("stripePaymentIntentId", piId) : null;
      if (!paymentId) {
        // A refunded MEMBERSHIP invoice has no payment document of its own —
        // Stripe raises those invoices itself — so the referral reward it paid is
        // keyed on the invoice id instead. Without this branch, "reward when they
        // subscribe" could never be reversed, which is the whole attack.
        const invoiceRef = (charge as unknown as { invoice?: string | { id?: string } | null }).invoice;
        const invoiceId = typeof invoiceRef === "string" ? invoiceRef : (invoiceRef?.id ?? null);
        if (invoiceId && charge.amount_refunded >= charge.amount) {
          await clawbackForRef(invoiceId, "membership invoice refunded").catch((err) => {
            console.warn("[stripe] referral clawback failed", err);
          });
        }
        return;
      }
      const payment = await getAdminPayment(paymentId);
      if (!payment) return;
      const refunded = toMajor(charge.amount_refunded, charge.currency);
      const fullyRefunded = charge.amount_refunded >= charge.amount;
      await updatePayment({
        paymentId,
        uid: payment.ownerUid,
        status: fullyRefunded ? "refunded" : "partially_refunded",
        refundedAmount: refunded,
        event: "charge.refunded",
      });
      // Refunds subtract from the payment kind's category. `amount_refunded`
      // is CUMULATIVE, so record only the DELTA over what was already recorded
      // (keyed on the cumulative level so webhook retries stay idempotent).
      const delta = Math.max(0, refunded - payment.refundedAmount);
      if (delta > 0) {
        const currency = (charge.currency ?? "usd").toUpperCase();
        // Carry the original charge's dimensions so a refund subtracts from the
        // market and product that earned the revenue, not from "unattributed".
        const dims = await paymentDimensions(payment.kind, payment, charge.metadata);
        await recordFinanceEvent({
          category:
            payment.kind === "order" || payment.kind === "ebook"
              ? "books"
              : payment.kind === "subscription"
                ? "subscriptions"
                : "sparks",
          kind: "refund",
          amountUsd: -(await toUsd(delta, currency)),
          uid: payment.ownerUid,
          projectId: payment.fulfillment?.merchantReference ?? payment.ebook?.projectId ?? undefined,
          currency,
          amount: delta,
          country: billingCountryOf(charge),
          productId: dims.productId,
          sku: dims.sku,
          // Negative units: a refunded copy is a copy un-sold, so per-product
          // unit counts stay honest instead of double-counting the sale.
          units: fullyRefunded ? -dims.units : 0,
          ref: `${paymentId}_${charge.amount_refunded}`,
          meta: { cumulativeRefunded: refunded, fullyRefunded },
        });
      }
      // A fully refunded ebook loses its download entitlement (the buyer no
      // longer owns it; a later re-purchase grants a fresh one).
      if (fullyRefunded && payment.kind === "ebook") {
        await revokeRefundedEbook(paymentId);
      }
      // Take back any referral reward this purchase paid out — buy, collect the
      // bonus, refund is the cheapest attack on the program. Only on a FULL
      // refund: a partial (e.g. a shipping goodwill credit) is still a sale.
      if (fullyRefunded) {
        await clawbackForRef(paymentId, "purchase refunded").catch((err) => {
          console.warn("[stripe] referral clawback failed", err);
        });
      }
      // A refunded print order may already be at (or past) the printer —
      // fulfillment isn't auto-cancelled, so a human must decide what to do.
      if (payment.kind === "order" && refunded > 0) {
        await raiseAlert({
          severity: "warning",
          kind: "print-order-refunded",
          message:
            `Print order payment ${paymentId} was ${fullyRefunded ? "fully" : "partially"} refunded ` +
            `(${refunded} ${(charge.currency ?? "usd").toUpperCase()}). ` +
            "Check the print job — it is NOT cancelled automatically and may still ship.",
          meta: {
            paymentId,
            uid: payment.ownerUid,
            orderId: payment.orderId,
            projectId: payment.fulfillment?.merchantReference ?? null,
            refunded,
            fullyRefunded,
          },
          // One alert per cumulative refund level (webhook retries stay quiet).
          ref: `${paymentId}_${charge.amount_refunded}`,
        });
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const uid = (sub.metadata?.uid as string) || (await findUidByCustomerId(customerId));
      await upsertSubscription(subStatusToUpsert(sub, uid));

      // Lifecycle emails (best-effort; deduped on the subscription id). "Started"
      // fires once on the first active/trialing state; "cancelled" on deletion.
      if (uid) {
        try {
          const priceId = sub.items.data[0]?.price?.id ?? null;
          const plan = priceId ? resolvePlanByPriceId(await getPlansConfig(), priceId) : null;
          const planName = plan?.presentation.name ?? "your plan";
          if (event.type === "customer.subscription.deleted") {
            await sendSubscriptionCancelledEmail({ uid, planName, subscriptionId: sub.id });
            await notifySlack({
              channel: "growth",
              messageKey: "subscription_cancelled",
              ref: `sub_cancelled_${sub.id}`,
              text: `👋 Subscription cancelled — ${planName}`,
            });
          } else if (sub.status === "active" || sub.status === "trialing") {
            await sendSubscriptionStartedEmail({
              uid,
              planName,
              sparks: plan?.grant.monthlySparks,
              subscriptionId: sub.id,
            });
            // Deduped on the subscription id: fires once, not on every renewal.
            await notifySlack({
              channel: "growth",
              messageKey: "subscription_started",
              ref: `sub_started_${sub.id}`,
              text: `💳 New subscriber — ${planName}`,
            });
          }
        } catch (err) {
          console.warn("[stripe] subscription email failed", err);
        }
      }
      return;
    }

    default:
      // Unhandled event types are acknowledged (200) so Stripe stops retrying.
      return;
  }
}

/**
 * Public Stripe webhook receiver. Mounted OUTSIDE the auth guards (Stripe sends
 * no Firebase token — authenticity comes from the signature). Verifies the
 * signature over the EXACT raw bytes, then dispatches.
 */
export function registerStripeWebhookRoute(app: Express): void {
  app.post(
    "/stripe-webhook",
    express.raw({ type: "*/*", limit: "10mb" }),
    async (req: Request, res: Response) => {
      const secret = serverConfig().stripe.webhookSecret;
      const sig = req.get("stripe-signature") ?? "";
      if (!secret) {
        console.error("[stripe] webhook secret not configured");
        res.status(500).json({ error: { message: "Webhook not configured." } });
        return;
      }

      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const raw: Buffer = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === "string" ? req.body : "");

      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(raw, sig, secret);
      } catch (err) {
        console.warn("[stripe] webhook signature verification failed", (err as Error)?.message);
        res.status(400).json({ error: { message: "Invalid signature." } });
        return;
      }

      try {
        await handleEvent(event);
        res.json({ received: true });
      } catch (err) {
        console.error("[stripe] webhook handler error", event.type, err);
        res.status(500).json({ error: { message: "Webhook processing failed." } });
      }
    },
  );
}

// ---- Admin routes ----------------------------------------------------------

/** The dashboard-wide `?country=` filter (see analytics.ts `parseCountry`). */
function marketFilter(req: Request): string | null {
  const raw = String(req.query.country ?? "").trim().toUpperCase();
  if (!raw || raw === "ALL") return null;
  return raw === UNKNOWN_COUNTRY ? UNKNOWN_COUNTRY : normalizeCountry(raw);
}

export function registerStripeAdminRoutes(app: Express): void {
  const json = express.json();

  // List recent payments for the admin dashboard.
  app.get("/admin/payments", async (req: Request, res: Response) => {
    try {
      const sinceDays = Number(req.query.days);
      const sinceMs = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : undefined;
      const items = await listPayments({ sinceMs, limit: 500, country: marketFilter(req) });
      res.json({ payments: items });
    } catch (err) {
      console.error("[stripe-admin] list failed", err);
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Failed to list payments." } });
    }
  });

  // Aggregate analytics for the "Payments" analysis tab.
  app.get("/admin/payments/analytics", async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      res.json(await paymentsAnalytics(days, marketFilter(req)));
    } catch (err) {
      console.error("[stripe-admin] analytics failed", err);
      res.status(500).json({ error: { message: (err as Error)?.message ?? "Failed to compute analytics." } });
    }
  });

  // Refund a payment (full or partial). The webhook records the result.
  app.post("/admin/payments/:id/refund", json, async (req: Request, res: Response) => {
    try {
      const payment = await getAdminPayment(req.params.id);
      if (!payment) {
        res.status(404).json({ error: { message: "Payment not found." } });
        return;
      }
      if (!payment.stripePaymentIntentId) {
        res.status(409).json({ error: { message: "This payment has no captured charge to refund." } });
        return;
      }
      const { amount } = (req.body ?? {}) as { amount?: number };
      const refund = await getStripe().refunds.create({
        payment_intent: payment.stripePaymentIntentId,
        amount: typeof amount === "number" && amount > 0 ? toMinor(amount, payment.currency) : undefined,
      });
      res.json({ ok: true, refundId: refund.id, status: refund.status });
    } catch (err) {
      console.error("[stripe-admin] refund failed", err);
      res.status(502).json({ error: { message: (err as Error)?.message ?? "Refund failed." } });
    }
  });

  // Connection health check — verifies keys, account, tax, portal, webhooks.
  app.get("/admin/stripe/health", async (_req: Request, res: Response) => {
    res.json(await stripeHealth());
  });
}

// ---- Health diagnostics ----------------------------------------------------

export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
}

export interface StripeHealthReport {
  environment: "sandbox" | "live";
  ok: boolean;
  checks: HealthCheck[];
}

export async function stripeHealth(): Promise<StripeHealthReport> {
  const cfg = serverConfig().stripe;
  const env: "sandbox" | "live" = isSandbox() ? "sandbox" : "live";
  const checks: HealthCheck[] = [];
  const expectedMode = env === "live" ? "live" : "test";

  // 1. Secret key present.
  if (!cfg.secretKey) {
    checks.push({
      id: "secret-key",
      label: "API secret key",
      status: "fail",
      message: "No Stripe secret key is configured for this environment.",
      fix: `Set STRIPE_${env === "live" ? "LIVE" : "SANDBOX"}_SECRET_KEY (sk_${expectedMode}_…) as a function secret, or in functions/.env.local for the emulator.`,
    });
    return { environment: env, ok: false, checks };
  }

  // 2. Key mode matches environment.
  const mode = keyMode(cfg.secretKey);
  if (mode !== expectedMode && mode !== "unknown") {
    checks.push({
      id: "key-mode",
      label: "Key mode matches environment",
      status: "fail",
      message: `Active environment is ${env} (${expectedMode} mode) but the configured key is a ${mode} key (${maskKey(cfg.secretKey)}).`,
      fix: `Use an sk_${expectedMode}_… key for ${env}, or change STRIPE_ENV.`,
    });
  } else {
    checks.push({
      id: "key-mode",
      label: "Key mode matches environment",
      status: "pass",
      message: `Using a ${mode} key (${maskKey(cfg.secretKey)}) in ${env}.`,
    });
  }

  // 3. Key authenticates + account capabilities.
  try {
    // Passing a null id retrieves the account the API key belongs to.
    const account = await getStripe().accounts.retrieve(null);
    if (account.charges_enabled) {
      checks.push({
        id: "account",
        label: "Account can accept charges",
        status: "pass",
        message: `Account ${account.id} is active (default currency ${(account.default_currency ?? "?").toUpperCase()}).`,
      });
    } else {
      checks.push({
        id: "account",
        label: "Account can accept charges",
        status: env === "live" ? "fail" : "warn",
        message: "The Stripe account can't accept charges yet (charges_enabled is false).",
        fix: "Complete account activation / verification in the Stripe dashboard.",
      });
    }
  } catch (err) {
    checks.push({
      id: "account",
      label: "API key authenticates",
      status: "fail",
      message: `Stripe rejected the key: ${(err as Error)?.message ?? "unknown error"}.`,
      fix: "Check the secret key value and that it belongs to the right account/mode.",
    });
    return { environment: env, ok: false, checks };
  }

  // 4. Webhook signing secret present.
  if (!cfg.webhookSecret) {
    checks.push({
      id: "webhook-secret",
      label: "Webhook signing secret",
      status: env === "live" ? "fail" : "warn",
      message: "No webhook signing secret is configured, so incoming events can't be verified.",
      fix:
        env === "live"
          ? "Set STRIPE_LIVE_WEBHOOK_SECRET to the signing secret of your registered webhook endpoint."
          : "Run `yarn dev:backend --stripe` to start the Stripe CLI listener (it injects the secret), or set STRIPE_SANDBOX_WEBHOOK_SECRET.",
    });
  } else {
    checks.push({
      id: "webhook-secret",
      label: "Webhook signing secret",
      status: "pass",
      message: "A webhook signing secret is configured; events will be verified.",
    });
  }

  // 5. Registered webhook endpoint (live only — sandbox uses the CLI).
  if (env === "live") {
    try {
      const endpoints = await getStripe().webhookEndpoints.list({ limit: 100 });
      const active = endpoints.data.filter((e) => e.status === "enabled");
      if (active.length === 0) {
        checks.push({
          id: "webhook-endpoint",
          label: "Webhook endpoint registered",
          status: "fail",
          message: "No enabled webhook endpoints are registered on this account.",
          fix: "Add a webhook endpoint pointing at https://<your-host>/stripe-webhook subscribed to checkout.session.completed, payment_intent.*, charge.refunded, customer.subscription.*, invoice.paid.",
        });
      } else {
        checks.push({
          id: "webhook-endpoint",
          label: "Webhook endpoint registered",
          status: "pass",
          message: `${active.length} enabled webhook endpoint(s): ${active.map((e) => e.url).join(", ")}.`,
        });
      }
    } catch (err) {
      checks.push({
        id: "webhook-endpoint",
        label: "Webhook endpoint registered",
        status: "warn",
        message: `Couldn't list webhook endpoints: ${(err as Error)?.message ?? "error"}.`,
      });
    }
  }

  // 6. Stripe Tax activated.
  try {
    const settings = await getStripe().tax.settings.retrieve();
    if (settings.status === "active") {
      checks.push({
        id: "tax",
        label: "Stripe Tax",
        status: "pass",
        message: "Stripe Tax is active; tax will be calculated automatically at checkout.",
      });
    } else {
      checks.push({
        id: "tax",
        label: "Stripe Tax",
        status: "warn",
        message: "Stripe Tax is not active. Checkout still works, but tax won't be calculated automatically.",
        fix: "Activate Stripe Tax (set an origin address + register where you collect) in the dashboard, or disable automatic tax.",
      });
    }
  } catch (err) {
    checks.push({
      id: "tax",
      label: "Stripe Tax",
      status: "warn",
      message: `Stripe Tax status unavailable: ${(err as Error)?.message ?? "error"}.`,
      fix: "Activate Stripe Tax in the dashboard if you want automatic tax calculation.",
    });
  }

  // 7. Book tax code resolves.
  try {
    const pricing = await getPricingSettings();
    const code = pricing.tax.bookTaxCode;
    if (!code) {
      checks.push({
        id: "tax-code",
        label: "Book tax code",
        status: "warn",
        message: "No product tax code is set in Pricing settings.",
        fix: "Set a Stripe tax code for physical books (e.g. txcd_35010000) in Pricing settings.",
      });
    } else {
      const tc = await getStripe().taxCodes.retrieve(code);
      checks.push({
        id: "tax-code",
        label: "Book tax code",
        status: "pass",
        message: `Tax code ${code} resolves to “${tc.name}”.`,
      });
    }
  } catch (err) {
    checks.push({
      id: "tax-code",
      label: "Book tax code",
      status: "fail",
      message: `The configured book tax code is invalid: ${(err as Error)?.message ?? "error"}.`,
      fix: "Set a valid Stripe tax code in Pricing settings.",
    });
  }

  // 8. Customer Portal configured (for subscription self-service).
  try {
    const configs = await getStripe().billingPortal.configurations.list({ limit: 1, active: true });
    if (configs.data.length > 0) {
      checks.push({
        id: "portal",
        label: "Customer Portal",
        status: "pass",
        message: "An active Customer Portal configuration exists.",
      });
    } else {
      checks.push({
        id: "portal",
        label: "Customer Portal",
        status: "warn",
        message: "No active Customer Portal configuration; subscribers can't self-manage billing yet.",
        fix: "Configure the Customer Portal in the Stripe dashboard (Settings → Billing → Customer portal).",
      });
    }
  } catch (err) {
    checks.push({
      id: "portal",
      label: "Customer Portal",
      status: "warn",
      message: `Couldn't check the Customer Portal: ${(err as Error)?.message ?? "error"}.`,
    });
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { environment: env, ok, checks };
}
