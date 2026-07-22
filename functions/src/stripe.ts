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
import { createAdminAssetHost } from "./assets";
import { fulfillmentProvider } from "./lulu";
import { persistCreatedOrder } from "./orders";
import { getProductsConfig } from "./products";
import { getPricingSettings } from "./appConfig";
import {
  computeMargin,
  isDestinationAllowed,
  resolveShippingCharged,
} from "../../books-frontend/src/core/config/productMath";
import type {
  CurrencyCode,
  PricingSettings,
  ProductDefinition,
} from "../../books-frontend/src/core/config/products";
import {
  planMeetsAccess,
  productAccessOf,
} from "../../books-frontend/src/core/config/products";
import {
  effectivePrintDiscountPct,
  planEntitlements,
} from "../../books-frontend/src/core/config/entitlements";
import type { OrderDraft, ShippingMethod } from "../../books-frontend/src/core/fulfillment/types";
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
import { recordChargeRevenue, recordFinanceEvent, toUsd } from "./finance";
import { raiseAlert } from "./alerts";
import { claimReferralCode, ensureReferralCode, maybeRewardReferral } from "./referrals";
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
  productSku: string;
  copies: number;
  pageCount: number;
  currency: string;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  merchantReference?: string;
  recipient: OrderDraft["recipient"];
  assets?: WireAsset[];
}

function clientError(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: { message } });
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

/** Get (or lazily create) the Stripe customer for a user. */
async function ensureCustomer(uid: string, email?: string | null): Promise<string> {
  const existing = await getStripeCustomerId(uid);
  if (existing) return existing;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { uid },
  });
  await saveStripeCustomerId(uid, customer.id);
  return customer.id;
}

// ---- Print-order checkout core ----------------------------------------------

interface PrintCheckoutArgs {
  uid: string;
  email: string | null;
  product: ProductDefinition;
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
  settings: PricingSettings;
  activePlan: Awaited<ReturnType<typeof resolveActivePlan>>;
  copies: number;
  pages: number;
  currency: CurrencyCode;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  address: {
    line1?: string;
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
  shippingCharged: number;
}

/**
 * The single retail pricing path: live shipping quote → retail tiers → plan
 * discount clamped to break-even. Used by checkout, reorders and the client's
 * price preview so all three always agree.
 */
async function priceRetailOrder(args: RetailPriceArgs): Promise<RetailPriceResult> {
  const { product, settings, copies, pages, currency } = args;

  // Live shipping cost (for an accurate charged-shipping figure).
  let liveShippingCost: number | undefined;
  try {
    const quotes = await fulfillmentProvider().quote({
      productSku: product.provider.sku,
      copies,
      destinationCountry: args.destinationCountry,
      destinationLine1: args.address.line1,
      destinationCity: args.address.townOrCity,
      destinationState: args.address.stateOrCounty ?? undefined,
      destinationPostalCode: args.address.postalOrZipCode,
      currency,
      shippingMethod: args.shippingMethod,
      pageCount: pages,
    });
    const q = quotes.find((x) => x.shippingMethod) ?? quotes[0];
    if (q) liveShippingCost = Number(q.shipping.amount) || undefined;
  } catch (err) {
    console.warn("[stripe] live shipping quote failed; using offline estimate", err);
  }

  const margin = computeMargin(product, { currency, pages, copies, liveShippingCost }, settings);
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
    margin.shippingCharged || resolveShippingCharged(product.shipping, liveShippingCost ?? 0);
  return { unitPrice, listUnitPrice: margin.pricePerUnit, discountPct, shippingCharged };
}

async function createPrintCheckout(args: PrintCheckoutArgs): Promise<PrintCheckoutResult> {
  const { uid, product, settings, copies, pages, currency, recipient } = args;

  const { unitPrice, shippingCharged } = await priceRetailOrder({
    product,
    settings,
    activePlan: args.activePlan,
    copies,
    pages,
    currency,
    shippingMethod: args.shippingMethod,
    destinationCountry: args.destinationCountry,
    address: recipient.address,
  });

  if (unitPrice <= 0) {
    return { ok: false, error: "This product isn't priced for ordering yet." };
  }

  const paymentId = randomUUID();
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
          description: product.presentation.tagline || undefined,
          tax_code: taxCode,
          metadata: { sku: product.provider.sku },
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
    productSku: product.provider.sku,
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
  };

  const estimatedTotal = unitPrice * copies + shippingCharged;
  const session = await createCheckoutSession({
    mode: "payment",
    customer: customerId,
    customer_update: { address: "auto", name: "auto" },
    billing_address_collection: hasTax ? "required" : "auto",
    automatic_tax: { enabled: hasTax },
    line_items: lineItems,
    client_reference_id: paymentId,
    metadata: { paymentId, uid, kind: "order" },
    payment_intent_data: { metadata: { paymentId, uid, kind: "order" } },
    success_url: `${appBaseUrl()}/studio?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
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
      const product = config.products.find(
        (p) => p.provider.sku === body.productSku && p.status === "active",
      );
      if (!product) {
        clientError(res, "This product isn't available for ordering.");
        return;
      }

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
      const methodOk = product.shipping.methods.some(
        (m) => m.enabled && m.method === body.shippingMethod,
      );
      if (!methodOk) {
        clientError(res, "That shipping method isn't available for this product.");
        return;
      }
      const destCountry = (body.destinationCountry || body.recipient.address.countryCode || "").trim();
      if (
        !isDestinationAllowed(product.shipping.destinations, {
          country: destCountry,
          region: body.recipient.address.stateOrCounty ?? undefined,
        })
      ) {
        clientError(res, "We can't ship this product to that destination yet.");
        return;
      }

      // Upload print files NOW so they're hosted before payment; the webhook
      // places the order from these URLs (it has no access to the blobs).
      const host = createAdminAssetHost();
      const sourceFileUrls: { interior?: string; cover?: string } = {};
      for (const a of body.assets ?? []) {
        const buf = Buffer.from(a.base64, "base64");
        const ext = (a.contentType ?? "").includes("pdf") ? "pdf" : "png";
        const blob = new Blob([buf], { type: a.contentType || "application/octet-stream" });
        const { url } = await host.upload(blob, `${a.printArea}.${ext}`);
        if (a.printArea === "cover") sourceFileUrls.cover = url;
        else sourceFileUrls.interior = url;
      }
      if (!sourceFileUrls.interior || !sourceFileUrls.cover) {
        clientError(res, "We couldn't prepare your print files. Please try again.");
        return;
      }

      const result = await createPrintCheckout({
        uid,
        email: body.recipient.email ?? req.authToken?.email ?? null,
        product,
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
        copies?: number;
        pageCount?: number;
        currency?: string;
        shippingMethod?: ShippingMethod;
        destinationCountry?: string;
        line1?: string;
        city?: string;
        state?: string;
        postalCode?: string;
      };
      if (!body.productSku || !body.city || !body.postalCode || !body.destinationCountry) {
        clientError(res, "A destination (city, postal code, country) is required.");
        return;
      }
      const [config, settings] = await Promise.all([getProductsConfig(), getPricingSettings()]);
      const product = config.products.find(
        (p) => p.provider.sku === body.productSku && p.status === "active",
      );
      if (!product) {
        clientError(res, "This product isn't available.", 404);
        return;
      }
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
        settings,
        activePlan,
        copies,
        pages,
        currency,
        shippingMethod: body.shippingMethod ?? "Standard",
        destinationCountry: body.destinationCountry,
        address: {
          line1: body.line1,
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
      });
    } catch (err) {
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
      const quote = await priceEbook(uid, projectId, currency, settings.ebook, activePlan);
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
  // after Stripe confirms payment. Price is server-authoritative.
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
      };
      if (!body.projectId || !body.pdfBase64) {
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
      const quote = await priceEbook(uid, body.projectId, currency, settings.ebook, activePlan);
      if (!quote.enabled) {
        clientError(res, "Ebooks aren't available right now.");
        return;
      }
      if (quote.owned) {
        clientError(res, "You already own this ebook — download it from the order screen.");
        return;
      }

      const title = (body.title ?? "").trim() || "Your book";
      const host = createAdminAssetHost();
      const buf = Buffer.from(body.pdfBase64, "base64");
      const blob = new Blob([buf], { type: body.contentType || "application/pdf" });
      const { url: fileUrl } = await host.upload(blob, `ebook-${body.projectId}.pdf`);

      const paymentId = randomUUID();

      // Included with the buyer's plan (price 0): no Stripe session — record a
      // zero-amount paid payment and grant the download entitlement directly.
      if (quote.included || quote.price <= 0) {
        const ebook: EbookFulfillment = { projectId: body.projectId, title, fileUrl };
        await createPendingPayment({
          paymentId,
          uid,
          kind: "ebook",
          amount: 0,
          currency,
          description: `${title} — digital edition (included with ${quote.planName ?? "plan"})`,
          stripeSessionId: null,
          ebook,
          items: [{ label: `${title} — digital edition (PDF)`, amount: 0, quantity: 1 }],
        });
        await updatePayment({ paymentId, uid, status: "paid", event: "ebook.plan_grant" });
        await deliverPaidEbook(paymentId);
        res.json({ granted: true, paymentId });
        return;
      }
      const customerId = await ensureCustomer(uid, req.authToken?.email ?? null);
      const taxBehavior = settings.tax.perCurrency[currency]?.behavior ?? "exclusive";
      const taxCode = settings.ebook.taxCode;
      const hasTax = Boolean(taxCode);

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
              unit_amount: toMinor(quote.price, currency),
              tax_behavior: hasTax ? taxBehavior : undefined,
              product_data: {
                name: `${title} — digital edition (PDF)`,
                description:
                  [
                    quote.planName ? `${quote.planName} member price.` : null,
                    quote.discountPct > 0
                      ? `Includes your ${quote.discountPct}% print-owner discount.`
                      : null,
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
        payment_intent_data: { metadata: { paymentId, uid, kind: "ebook" } },
        success_url: `${appBaseUrl()}/studio?ebook=success`,
        cancel_url: `${appBaseUrl()}/studio?ebook=cancel`,
      });

      const ebook: EbookFulfillment = { projectId: body.projectId, title, fileUrl };
      await createPendingPayment({
        paymentId,
        uid,
        kind: "ebook",
        amount: quote.price,
        currency,
        description: `${title} — digital edition`,
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
        ebook,
        items: [{ label: `${title} — digital edition (PDF)`, amount: quote.price, quantity: 1 }],
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
      const product = config.products.find(
        (p) => p.provider.sku === plan.productSku && p.status === "active",
      );
      if (!product) {
        clientError(res, "This product isn't available for ordering anymore.");
        return;
      }
      const activePlan = await resolveActivePlan(uid);
      const copies = Math.max(
        product.conditions.copies.min,
        Math.min(product.conditions.copies.max, Math.floor(rawCopies || plan.copies || 1)),
      );
      const result = await createPrintCheckout({
        uid,
        email: plan.recipient.email ?? req.authToken?.email ?? null,
        product,
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
      // `createCheckoutSession` retries without automatic tax if Stripe Tax
      // isn't activated, so subscriptions collect tax when possible but never
      // hard-fail because of tax configuration.
      const session = await createCheckoutSession({
        mode: "subscription",
        customer: customerId,
        customer_update: { address: "auto", name: "auto" },
        automatic_tax: { enabled: true },
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { uid, kind: "subscription" },
        // Stamp uid on the subscription so invoice grants can attribute Sparks.
        subscription_data: { metadata: { uid } },
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
      const session = await createCheckoutSession({
        mode: "payment",
        customer: customerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: toMinor(price, currency),
              product_data: { name: `${totalSparks} Sparks (${pack.label})` },
            },
          },
        ],
        client_reference_id: paymentId,
        metadata: { paymentId, uid, kind: "sparkPack", packId: pack.id, sparks: String(totalSparks) },
        payment_intent_data: {
          metadata: { paymentId, uid, kind: "sparkPack", packId: pack.id, sparks: String(totalSparks) },
        },
        success_url: `${appBaseUrl()}/studio?sparks=success`,
        cancel_url: `${appBaseUrl()}/studio?sparks=cancel`,
      });
      await createPendingPayment({
        paymentId,
        uid,
        kind: "sparkPack",
        amount: price,
        currency,
        description: `${totalSparks} Sparks`,
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
        items: [{ label: `${totalSparks} Sparks`, amount: price, quantity: 1 }],
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
        payment_intent_data: { metadata: meta },
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

  // The caller's shareable referral code (minted lazily).
  app.get("/account/referral", async (req: AuthedRequest, res: Response) => {
    try {
      const code = await ensureReferralCode(req.uid!);
      const config = await getSparksConfig();
      res.json({
        code,
        enabled: config.enabled && config.referral.enabled,
        referrerSparks: config.referral.referrerSparks,
        referredSparks: config.referral.referredSparks,
      });
    } catch (err) {
      clientError(res, (err as Error)?.message ?? "Could not load your referral code.", 500);
    }
  });

  // A new user attaches the code that referred them (reward fires on their
  // first payment — see the webhook).
  app.post("/account/referral/claim", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { code } = (req.body ?? {}) as { code?: string };
      const ok = await claimReferralCode(req.uid!, code ?? "");
      res.json({ ok });
    } catch {
      res.json({ ok: false });
    }
  });

  // Claim every starter-grant ladder rung the caller qualifies for (guest →
  // signup → verify; each rung idempotent). Deliberately OUTSIDE the /account
  // requireVerified guard: guests and unverified users claim their rungs too.
  // The studio calls this whenever the sparks watch (re)starts.
  app.post("/sparks/claim", requireAuth, json, async (req: AuthedRequest, res: Response) => {
    try {
      const { ensureGrantLadder } = await import("./sparks");
      await ensureGrantLadder({
        uid: req.uid!,
        anonymous: isAnonymousToken(req.authToken),
        verified: isVerifiedToken(req.authToken),
        ip: req.ip,
      });
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
    await persistCreatedOrder({
      uid: payment.ownerUid,
      provider: "lulu",
      env: cfg.fulfillment.lulu.env,
      draft,
      order,
    });
    await updatePayment({
      paymentId,
      uid: payment.ownerUid,
      orderId: order.id,
      event: "order.placed",
    });
    // Record what the print provider will charge US for this order (COGS).
    try {
      const total = order.charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
      const currency = order.charges[0]?.currency || plan.currency || "USD";
      if (total > 0) {
        await recordFinanceEvent({
          category: "books",
          kind: "printCost",
          amountUsd: -(await toUsd(total, currency)),
          uid: payment.ownerUid,
          projectId: plan.merchantReference ?? undefined,
          currency,
          amount: total,
          ref: paymentId,
          meta: { orderId: order.id, sku: plan.productSku, copies: plan.copies },
        });
      }
    } catch (err) {
      console.warn("[stripe] could not record print cost", paymentId, err);
    }
  } catch (err) {
    // The customer has paid; surface the failure for admin follow-up but don't
    // throw (a 500 makes Stripe retry, which won't fix a fulfillment error).
    // The failure is persisted with retry state — a scheduled sweep retries it
    // with backoff, and an admin alert is raised so a human sees it too.
    const message = (err as Error)?.message ?? "Unknown fulfillment error";
    console.error("[stripe] fulfillment after payment failed", paymentId, err);
    await markFulfillmentFailed(paymentId, message);
    const attempt = payment.fulfillmentAttempts + 1;
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

/** Pull fee + net + receipt off a PaymentIntent's charge (expanded). */
async function chargeFinancials(
  paymentIntentId: string,
): Promise<{ chargeId?: string; receiptUrl?: string; fee?: number; net?: number; currency?: string }> {
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
    };
  } catch (err) {
    console.warn("[stripe] could not load charge financials", err);
    return {};
  }
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
      await recordChargeRevenue({
        category: "subscriptions",
        kind: "subscriptionRevenue",
        uid,
        gross,
        currency,
        ref: invoice.id,
        meta: { planId: plan.id, interval },
      });
      await maybeRewardReferral(uid);
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
          await maybeRewardReferral(uid);
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
          await maybeRewardReferral(uid);
        } else if (kind === "ebook") {
          await deliverPaidEbook(paymentId);
          await maybeRewardReferral(uid);
        } else {
          await fulfillPaidOrder(paymentId);
          const order = await getAdminPayment(paymentId);
          await sendOrderConfirmationEmail({
            uid,
            orderRef: order?.orderId ?? paymentId,
            itemLabel: "Your custom picture book",
            paymentId,
          });
          await maybeRewardReferral(uid);
        }
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
        event: "payment_intent.succeeded",
      });

      const kind = ((pi.metadata?.kind as string) || "order") as PaymentKind;
      const payment = await getAdminPayment(paymentId);
      const projectId =
        payment?.fulfillment?.merchantReference ?? payment?.ebook?.projectId ?? undefined;

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
        ref: paymentId,
        meta: kind === "sparkGift" ? { gift: true } : undefined,
      });

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
      await maybeRewardReferral(uid);
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
      if (!paymentId) return;
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
          ref: `${paymentId}_${charge.amount_refunded}`,
          meta: { cumulativeRefunded: refunded, fullyRefunded },
        });
      }
      // A fully refunded ebook loses its download entitlement (the buyer no
      // longer owns it; a later re-purchase grants a fresh one).
      if (fullyRefunded && payment.kind === "ebook") {
        await revokeRefundedEbook(paymentId);
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
          } else if (sub.status === "active" || sub.status === "trialing") {
            await sendSubscriptionStartedEmail({
              uid,
              planName,
              sparks: plan?.grant.monthlySparks,
              subscriptionId: sub.id,
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

export function registerStripeAdminRoutes(app: Express): void {
  const json = express.json();

  // List recent payments for the admin dashboard.
  app.get("/admin/payments", async (req: Request, res: Response) => {
    try {
      const sinceDays = Number(req.query.days);
      const sinceMs = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : undefined;
      const items = await listPayments({ sinceMs, limit: 500 });
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
      res.json(await paymentsAnalytics(days));
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
