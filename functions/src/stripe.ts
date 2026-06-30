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
import type { AuthedRequest } from "./auth";
import { createAdminAssetHost } from "./assets";
import { fulfillmentProvider } from "./lulu";
import { persistCreatedOrder } from "./orders";
import { getProductsConfig } from "./products";
import { getPricingSettings } from "./appConfig";
import {
  computeMargin,
  resolveShippingCharged,
} from "../../books-frontend/src/core/config/productMath";
import type { CurrencyCode } from "../../books-frontend/src/core/config/products";
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
  listPayments,
  paymentsAnalytics,
  saveStripeCustomerId,
  updatePayment,
  upsertSubscription,
  type FulfillmentPlan,
} from "./payments";
import { getPlansConfig, resolveActivePlan } from "./plans";
import { getSparksConfig } from "./appConfig";
import { grantSparks } from "./sparks";
import {
  intervalForPriceId,
  resolvePlanByPriceId,
  type BillingInterval,
} from "../../books-frontend/src/core/config/plans";
import { packTotalSparks } from "../../books-frontend/src/core/config/sparks";

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

      // Live shipping cost (for an accurate charged-shipping figure).
      let liveShippingCost: number | undefined;
      try {
        const quotes = await fulfillmentProvider().quote({
          productSku: product.provider.sku,
          copies,
          destinationCountry: body.destinationCountry,
          destinationLine1: body.recipient.address.line1,
          destinationCity: body.recipient.address.townOrCity,
          destinationState: body.recipient.address.stateOrCounty,
          destinationPostalCode: body.recipient.address.postalOrZipCode,
          currency,
          shippingMethod: body.shippingMethod,
          pageCount: pages,
        });
        const q = quotes.find((x) => x.shippingMethod) ?? quotes[0];
        if (q) liveShippingCost = Number(q.shipping.amount) || undefined;
      } catch (err) {
        console.warn("[stripe] live shipping quote failed; using offline estimate", err);
      }

      const margin = computeMargin(
        product,
        { currency, pages, copies, liveShippingCost },
        settings,
      );
      // Active subscribers get their plan's print discount, clamped to break-even
      // so the order can never be sold at a loss.
      const discountPct = effectivePrintDiscountPct(
        planEntitlements(activePlan),
        margin.breakEvenDiscountPct,
      );
      const unitPrice =
        discountPct > 0
          ? Math.round(margin.pricePerUnit * (1 - discountPct / 100) * 100) / 100
          : margin.pricePerUnit;
      const shippingCharged =
        margin.shippingCharged ||
        resolveShippingCharged(product.shipping, liveShippingCost ?? 0);

      if (unitPrice <= 0) {
        clientError(res, "This product isn't priced for ordering yet.");
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

      const paymentId = randomUUID();
      const customerId = await ensureCustomer(uid, body.recipient.email ?? req.authToken?.email);

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
        shippingMethod: body.shippingMethod,
        destinationCountry: body.destinationCountry,
        currency,
        pageCount: pages,
        merchantReference: body.merchantReference ?? null,
        recipient: {
          name: body.recipient.name,
          email: body.recipient.email ?? null,
          phoneNumber: body.recipient.phoneNumber ?? null,
          address: {
            line1: body.recipient.address.line1,
            line2: body.recipient.address.line2 ?? null,
            townOrCity: body.recipient.address.townOrCity,
            stateOrCounty: body.recipient.address.stateOrCounty ?? null,
            postalOrZipCode: body.recipient.address.postalOrZipCode,
            countryCode: body.recipient.address.countryCode,
          },
        },
        sourceFileUrls,
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

      res.json({ url: session.url, paymentId });
    } catch (err) {
      console.error("[stripe] checkout failed", err);
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
        priceId = pp?.active && pp.stripePriceId ? pp.stripePriceId : "";
      }
      if (!priceId) {
        clientError(res, "A plan price is required.");
        return;
      }

      const customerId = await ensureCustomer(uid, req.authToken?.email);
      const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
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

  // Claim the one-time starter Spark grant (idempotent). The studio calls this
  // once a verified user opens it; safe to call repeatedly.
  app.post("/account/sparks/claim-starter", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { ensureStarterGrant } = await import("./sparks");
      await ensureStarterGrant(req.uid!);
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
  } catch (err) {
    // The customer has paid; surface the failure for admin follow-up but don't
    // throw (a 500 makes Stripe retry, which won't fix a fulfillment error).
    console.error("[stripe] fulfillment after payment failed", paymentId, err);
    await updatePayment({
      paymentId,
      uid: payment.ownerUid,
      event: "fulfillment.failed",
    });
  }
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
 * Grant a subscription's Sparks for one paid invoice. Resolves the plan from the
 * invoice line's price id, grants `monthlySparks` (capped by the plan's rollover
 * policy) idempotently on the invoice id, and adds the one-time annual bonus on
 * a yearly invoice. Best-effort: never throws back into the webhook.
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

    const monthly = plan.grant.monthlySparks;
    if (monthly > 0) {
      const rolloverCap =
        plan.grant.rolloverMultiple > 0 ? monthly * plan.grant.rolloverMultiple : undefined;
      await grantSparks({
        uid,
        amount: monthly,
        type: "grant",
        reason: `subscription:${plan.id}`,
        ref: invoice.id,
        rolloverCap,
      });
    }

    const interval = intervalForPriceId(plan, priceId);
    if (interval === "year" && plan.grant.annualBonusSparks > 0) {
      await grantSparks({
        uid,
        amount: plan.grant.annualBonusSparks,
        type: "grant",
        reason: `subscription-bonus:${plan.id}`,
        ref: `${invoice.id}_bonus`,
      });
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
        await updatePayment({
          paymentId,
          uid,
          status: "paid",
          amount: session.amount_total != null ? toMajor(session.amount_total, session.currency ?? "usd") : undefined,
          currency: session.currency ?? undefined,
          stripePaymentIntentId: piId,
          event: "checkout.session.completed",
        });
        if (kind === "sparkPack") {
          // Grant the purchased Sparks, idempotent on the paymentId.
          const sparks = Number(session.metadata?.sparks ?? 0);
          if (sparks > 0) {
            await grantSparks({
              uid,
              amount: sparks,
              type: "purchase",
              reason: `pack:${session.metadata?.packId ?? ""}`,
              ref: paymentId,
            });
          }
        } else {
          await fulfillPaidOrder(paymentId);
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
      const fin = await chargeFinancials(pi.id);
      await updatePayment({
        paymentId,
        uid,
        status: "paid",
        amount: toMajor(pi.amount_received || pi.amount, pi.currency),
        currency: pi.currency,
        stripePaymentIntentId: pi.id,
        stripeChargeId: fin.chargeId,
        receiptUrl: fin.receiptUrl ?? null,
        feeAmount: fin.fee ?? null,
        netAmount: fin.net ?? null,
        event: "payment_intent.succeeded",
      });
      // Safety net in case session.completed was missed.
      await fulfillPaidOrder(paymentId);
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
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const uid = (sub.metadata?.uid as string) || (await findUidByCustomerId(customerId));
      await upsertSubscription(subStatusToUpsert(sub, uid));
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
