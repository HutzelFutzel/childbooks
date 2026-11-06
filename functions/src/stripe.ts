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
import { holdQuoteForCheckout } from "./generationQuotes";
import { bookIsBeingDrawn } from "./bookBusy";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { serverConfig } from "./config";
import { isAnonymousToken, isVerifiedToken, requireAuth, type AuthedRequest } from "./auth";
import { createAdminAssetHost, printFileUnreachableReason } from "./assets";
import { cachedDocumentPath, cachedDocumentUrl, documentKey, invalidateCachedDocument } from "./renders";
import { padInteriorToPages, preflightPrintFiles } from "./printPreflight";
import { planPageCount } from "../../books-frontend/src/core/print/pageCountPlan";
import { fulfillmentProvider } from "./lulu";
import { persistCreatedOrder } from "./orders";
import { placementKeyFor } from "../../books-frontend/src/core/orders/lifecycle";
import { recordOrderEmail, syncOrderFromPayment } from "./printOrders";
import { printFilesForPlacement } from "./printPrep";
import { getAuth } from "firebase-admin/auth";
import { ensureAdmin } from "./storage";
import { getProductsConfig } from "./products";
import { capabilityForProduct, getMarketRegistry } from "./markets";
import { getShippingSettings } from "./shipping";
import { getPricingSettings } from "./appConfig";
import {
  currencyForMarket,
  isIsoCountry,
  STATE_CODE_REQUIRED,
  TAX_ID_LABEL,
  TAX_ID_REQUIRED,
} from "../../books-frontend/src/core/config/countries";
import {
  computeAtCostOrder,
  computeMargin,
  defaultShippingMethod,
  destinationPolicyFor,
  hasUsableShippingCost,
  hasUsableUnitCost,
  isDestinationAllowed,
  offeredMethodsFor,
  resolveShippingCharged,
  type AtCostBreakdown,
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
import { NO_OPTION, type VariantSelection } from "../../books-frontend/src/core/config/variants";
import { foilStampText } from "../../books-frontend/src/core/fulfillment/lulu/foilStamp";
import { phoneProblem, taxIdProblem } from "../../books-frontend/src/core/fulfillment/recipientFormat";
import {
  CUSTOMER_FIX_LABEL,
  FulfillmentError,
  customerFixableDetail,
} from "../../books-frontend/src/core/fulfillment/errors";
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
  activeBillingEnv,
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
  draftRecipient,
  findPaymentIdByStripeId,
  findUidByCustomerId,
  forgetStripeCustomerId,
  getAdminPayment,
  getPaymentQuote,
  getStripeCustomerId,
  listFailedFulfillments,
  listOpenCheckoutsForBook,
  listPendingOrderCheckouts,
  listPayments,
  listStrandedPaidOrders,
  markFulfillmentFailed,
  paymentsAnalytics,
  planRecipient,
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
import { deviceFactsFromHeaders } from "./geo";
import { recordDevicePurchase } from "./deviceStats";
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
  countryLabel,
  normalizeCountry,
  UNKNOWN_COUNTRY,
} from "../../books-frontend/src/core/analytics/markets";
import { affiliateChargeMetadata, stampCustomerAttribution } from "./affiliates";
import { raiseAlert } from "./alerts";
import { couponAttemptsExhausted, recordCouponAttempt } from "./coupons/throttle";
import {
  notifySlack,
  money,
  formatCouponSlackMessage,
  formatPurchaseSlackMessage,
  formatSubscriptionSlackMessage,
  getProjectTitle,
  getUserSlackIdentity,
} from "./notify";
import {
  clawbackForRef,
  discountedAmount,
  effectivePercentOff,
  finalizeDiscountsForPayment,
  findRedeemableDiscount,
  onReferralEvent,
  onSubscriptionInvoicePaid,
  reserveDiscount,
} from "./referrals";
import { createSingleUseCoupon } from "./stripeDiscounts";
import {
  campaignClawbackForRef,
  earnedCampaignDiscounts,
  finalizeCampaignDiscounts,
  itemTypeForPaymentKind,
  onCampaignEvent,
  reserveCampaignDiscount,
  triggerForPaymentKind,
} from "./campaigns";
import {
  couponCandidates,
  couponUserFacts,
  releaseCoupons,
  reserveCoupon,
  restoreCouponsForRefund,
  settleCoupons,
  type CouponCandidate,
} from "./coupons";
import {
  bookChargeLine,
  composeQuoteLines,
  fromMinorUnits,
  quoteProblems,
  toMinorUnits,
  type DigitalQuoteInputs,
  type QuoteDiscountPlan,
  type QuoteInputs,
  type QuoteLines,
  type QuoteTaxBehavior,
  type QuoteTaxStatus,
} from "../../books-frontend/src/core/billing/printQuote";
import {
  QUOTE_REFUSAL_MESSAGE,
  QUOTE_TTL_MS,
  claimQuote,
  hashQuoteInputs,
  loadQuoteForCheckout,
  newQuoteId,
  quoteView,
  saveQuote,
  unclaimQuote,
  type PrintQuoteRecord,
} from "./printQuote";
import {
  digitalQuoteView,
  hashDigitalInputs,
  loadDigitalQuote,
  saveDigitalQuote,
  type DigitalQuoteRecord,
} from "./digitalQuote";
import {
  describeRejection,
  normalizeCouponCode,
  resolveBestDiscount,
  type CouponRejectionReason,
  type DiscountCandidate,
} from "../../books-frontend/src/core/config/coupons";
import { claimGift, createPaidGift, listGiftsBought, newGiftCode } from "./gifts";
import {
  intervalForPriceId,
  priceIdForEnv,
  pricePointForId,
  resolvePlanByPriceId,
  type BillingInterval,
} from "../../books-frontend/src/core/config/plans";
import { packTotalSparks, type SparkPack } from "../../books-frontend/src/core/config/sparks";
import {
  sendCouponRedeemedEmail,
  sendGiftPurchasedEmail,
  sendGiftReceivedEmail,
  sendOrderConfirmationEmail,
  sendOrderFailedEmail,
  sendSparksPurchasedEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionStartedEmail,
} from "./email/triggers";

// ---- Money helpers ---------------------------------------------------------

/**
 * Major ↔ minor units. One definition, shared with the quote arithmetic
 * (`core/billing/printQuote`), so the amount a quote promises and the amount
 * sent to Stripe can never be converted two different ways.
 */
function toMinor(amount: number, currency: string): number {
  return toMinorUnits(amount, currency);
}

/** Convert Stripe minor units back to a major-unit number. */
function toMajor(amount: number, currency: string): number {
  return fromMinorUnits(amount, currency);
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
  /** Customer reviewed the carrier's suggested correction, if one was returned. */
  addressConfirmed?: boolean;
  /** Which way they decided it. Recorded on the order; never a substitute for `addressConfirmed`. */
  addressChoice?: "suggested" | "entered";
  assets?: WireAsset[];
  /**
   * Content fingerprint of the render (see `core/print/fingerprint`). When the
   * book has already been rendered, the cached files are used and `assets` is
   * absent — a reorder of an unchanged book uploads nothing at all.
   */
  fingerprint?: string;
  /**
   * The quote the customer was shown and approved. Checkout charges THIS quote —
   * it is refused unless it is theirs, unexpired, and was made for exactly this
   * order — and never prices the order again.
   */
  quoteId?: string;
  /** The coupon code that quote APPLIED (not whatever was last typed). Must match the quote. */
  couponCode?: string;
  /** Spine foil lines for a linen-wrap book. Re-fit server side; ignored on other bindings. */
  foilStamp?: { title?: unknown; author?: unknown };
}

function clientError(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: { message } });
}

/**
 * The price the customer approved no longer holds. A 409 with a stable `code`,
 * which the order dialog answers by fetching and showing a fresh quote — never
 * by retrying the same payment.
 */
function priceChanged(res: Response, message: string): void {
  res.status(409).json({ error: { message, code: "price_changed" } });
}

/**
 * Customer-facing name for a payment kind, for the coupon email and Slack ping.
 *
 * Kept blunt rather than looked up: both callers have only Stripe's untyped
 * `kind` metadata to work from, and a wrong-but-generic label beats a database
 * read inside a webhook.
 */
function purchaseLabel(kind: string | undefined): string {
  switch (kind) {
    case "order":
      return "your printed book";
    case "ebook":
      return "your digital edition";
    case "sparkPack":
      return "your Spark pack";
    case "sparkGift":
      return "your Spark gift";
    case "subscription":
      return "your membership";
    default:
      return "your order";
  }
}

/** What actually comes off a purchase, after every source has been compared. */
interface AppliedDiscount {
  percentOff: number;
  /** Frozen description, for the checkout line the buyer sees. */
  summary: string;
  /**
   * True when the winning offer is a `printAtCost` coupon, so print checkout
   * replaces both the book and shipping line items with the exact break-even
   * at-cost figures (Lulu cost + Stripe fee).
   */
  atCost?: boolean;
  /** A sole coupon's "up to" amount (major units), so the discount can never exceed it. */
  capAmount?: number | null;
  /** The typed code that earned (part of) it, when one did. */
  code?: string | null;
  /** Conditions of the winning coupon, in the customer's words. */
  notes?: string[];
}

interface DiscountOutcome {
  applied: AppliedDiscount | null;
  /**
   * Why a code the customer TYPED didn't apply.
   *
   * Separate from `applied` because the two failures are nothing alike. A
   * referral perk that can't be honored should quietly charge full price — the
   * customer wasn't expecting it on this order. A code somebody typed and that
   * silently does nothing is a support ticket, so the caller refuses the
   * checkout and says why.
   */
  codeRejection: { reason: CouponRejectionReason; message: string } | null;
}

/**
 * The best discount to apply to this purchase — from the referral program, a
 * marketing campaign, or a coupon — already reserved for `paymentId`.
 *
 * Two clamps make it safe to hand a percentage to a customer months after the
 * program was configured: the catalog-wide `maxDiscountPct`, and whatever
 * headroom is left below break-even after the buyer's plan discount. If those
 * leave nothing, no reward is consumed — a discount that would have to be
 * silently reduced to 0 is better saved for a purchase that can carry it.
 *
 * All three sources are compared HERE, in one place, by the shared
 * {@link resolveBestDiscount}. A customer holding a referral perk, a campaign
 * offer and a typed code gets the best ONE of the three rather than their sum,
 * unless every winner opts into stacking: stacking is how a promotion
 * accidentally sells below cost, and it must not be something one config can
 * decide by itself.
 *
 * Reservations are taken only for the source that actually won, so the losers
 * stay available for the buyer's next purchase — and a single-use coupon isn't
 * burned on a checkout where a bigger referral reward beat it.
 */
async function earnedDiscount(args: {
  uid: string;
  itemType: DiscountItemType;
  paymentId: string;
  settings: PricingSettings;
  /** Amount the discount would come off (for the cost bookkeeping). */
  amount: number;
  /** Full retail order total (items + shipping) for print orders. */
  orderTotal?: number | null;
  /** Break-even at-cost total (Lulu cost + Stripe fee) for print orders. */
  atCostTotal?: number | null;
  /** Discount % the buyer's plan already applied. */
  appliedPct?: number;
  /** Deepest TOTAL discount that still breaks even (default: unbounded). */
  breakEvenPct?: number;
  /** A coupon code the customer typed at checkout. */
  couponCode?: string | null;
  /** Currency the amount is quoted in — coupon restrictions can gate on it. */
  currency?: string;
  /** Catalog product / plan / pack id, when a coupon could be scoped to it. */
  productId?: string | null;
  /** Destination or billing country, when known. */
  country?: string | null;
  /**
   * Decide WITHOUT reserving anything. Used to build a quote: the customer is
   * being shown a price, not buying, so no single-use code or reward may be held
   * for them yet. Everything else — the sources compared, the ceilings applied,
   * the arithmetic — is identical, which is the point: the quote and the
   * checkout that follows it cannot disagree about what was won.
   */
  dryRun?: boolean;
}): Promise<DiscountOutcome> {
  try {
    const currency = (args.currency ?? "").toUpperCase();
    const [referral, campaigns, coupons] = await Promise.all([
      findRedeemableDiscount(args.uid, args.itemType),
      earnedCampaignDiscounts(args.uid, args.itemType),
      couponCandidates({
        uid: args.uid,
        code: args.couponCode ?? null,
        purchase: {
          itemType: args.itemType,
          subtotal: args.amount,
          orderTotal: args.orderTotal ?? null,
          atCostTotal: args.atCostTotal ?? null,
          currency,
          productId: args.productId ?? null,
          country: args.country ?? null,
        },
      }),
    ]);
    const campaign = campaigns[0] ?? null;

    // Everything is expressed in the one shape the resolver compares, so no
    // source can smuggle in its own idea of what beats what.
    const candidates: DiscountCandidate[] = [];
    if (referral) {
      candidates.push({
        source: "referral",
        percentOff: referral.percentOff,
        summary: referral.summary,
        handle: referral.rewardId,
        // Referral rewards have never been stackable and this isn't the change
        // that makes them so.
        stackable: false,
        priority: 0,
      });
    }
    if (campaign) {
      candidates.push({
        source: "campaign",
        percentOff: campaign.percentOff,
        summary: campaign.summary,
        handle: campaign.redemptionId,
        stackable: campaign.stackable,
        priority: campaign.priority,
      });
    }
    for (const coupon of coupons.candidates) {
      const isAtCost = coupon.terms.mechanic.kind === "printAtCost";
      candidates.push({
        source: "coupon",
        percentOff: coupon.percentOff,
        summary: coupon.summary,
        handle: coupon.couponId,
        stackable: isAtCost ? false : coupon.stackable,
        priority: coupon.priority,
        atCost: isAtCost,
      });
    }

    const resolution = resolveBestDiscount({
      candidates,
      maxDiscountPct: effectivePercentOff(100, args.settings),
      appliedPct: args.appliedPct,
      breakEvenPct: args.breakEvenPct,
    });

    // A code the customer typed that never made it into the resolution needs an
    // explanation, whether it was refused on its own merits or simply lost.
    const typed = coupons.typedCodeVerdict;
    const typedCoupon = typed?.ok
      ? coupons.candidates.find((c) => c.couponId === typed.couponId) ?? null
      : null;
    let codeRejection: DiscountOutcome["codeRejection"] = null;
    if (typed && !typed.ok) {
      codeRejection = { reason: typed.reason, message: typed.message };
    } else if (typedCoupon) {
      const lost = resolution.rejected.find(
        (r) => r.candidate.source === "coupon" && r.candidate.handle === typedCoupon.couponId,
      );
      const won = resolution.applied.some(
        (c) => c.source === "coupon" && c.handle === typedCoupon.couponId,
      );
      if (!won) {
        const reason = lost?.reason ?? "better_offer_active";
        codeRejection = { reason, message: describeRejection(reason) };
      }
    }

    if (resolution.applied.length === 0 || resolution.percentOff <= 0) {
      return { applied: null, codeRejection };
    }

    // Reserve every winner. The percentage each one is credited with is its
    // SHARE of the resolved total, not its configured rate — when a stack was
    // clamped, the books have to reflect what was actually given away.
    const total = resolution.applied.reduce((sum, c) => sum + c.percentOff, 0);
    const summaries: string[] = [];
    let reservedPct = 0;
    let wonAtCost = false;
    const appliedCoupons: CouponCandidate[] = [];
    let appliedCode: string | null = null;
    for (const candidate of resolution.applied) {
      const share =
        total > 0
          ? Math.round(((candidate.percentOff / total) * resolution.percentOff) * 10) / 10
          : 0;
      if (share <= 0) continue;
      const discount = args.amount - discountedAmount(args.amount, share);
      let ok = false;
      switch (candidate.source) {
        case "referral":
          ok = args.dryRun ? true : await reserveDiscount(candidate.handle, args.paymentId, discount);
          break;
        case "campaign":
          ok = args.dryRun ? true : await reserveCampaignDiscount(candidate.handle, args.paymentId, discount);
          break;
        case "coupon": {
          const coupon = coupons.candidates.find((c) => c.couponId === candidate.handle);
          if (!coupon) break;
          const isAtCost = coupon.terms.mechanic.kind === "printAtCost";
          const couponDiscount = isAtCost ? coupon.discountAmount : discount;
          const couponSubtotal =
            isAtCost && typeof args.orderTotal === "number" && args.orderTotal > 0
              ? args.orderTotal
              : args.amount;
          ok = args.dryRun
            ? true
            : await reserveCoupon({
                uid: args.uid,
                candidate: coupon,
                paymentRef: args.paymentId,
                itemType: args.itemType,
                percentOff: share,
                discountAmount: couponDiscount,
                originalSubtotal: couponSubtotal,
                currency,
              });
          if (ok) {
            appliedCoupons.push(coupon);
            if (coupon.code) appliedCode = coupon.code;
          }
          if (ok && isAtCost) wonAtCost = true;
          // Losing the reservation race means somebody else is mid-checkout with
          // the same single-use code. The buyer needs to hear that rather than
          // be quietly charged full price on an order they thought was discounted.
          if (!ok && coupon.code) {
            codeRejection = {
              reason: "code_exhausted",
              message: describeRejection("code_exhausted"),
            };
          }
          break;
        }
      }
      if (ok) {
        reservedPct += share;
        summaries.push(candidate.summary);
      }
    }

    if (reservedPct <= 0) return { applied: null, codeRejection };

    // A coupon's "up to" amount only binds as a cap when the coupon is the SOLE
    // winner: its percentage was derived from that amount, so a stack's
    // combined percentage is not something one coupon's cap speaks for.
    const sole = resolution.applied.length === 1 && appliedCoupons.length === 1 ? appliedCoupons[0] : null;
    const capAmount =
      sole && sole.terms.mechanic.kind === "percentOff" && sole.terms.mechanic.maxDiscountAmount > 0
        ? sole.terms.mechanic.maxDiscountAmount
        : null;
    return {
      applied: {
        percentOff: Math.round(reservedPct * 10) / 10,
        summary: summaries.join(" + "),
        ...(wonAtCost ? { atCost: true } : {}),
        capAmount,
        code: appliedCode,
        notes: appliedCoupons.flatMap((c) => c.notes),
      },
      codeRejection,
    };
  } catch (err) {
    // An earned perk must never be the reason a purchase can't be started. A
    // typed code is the one exception, and it's handled above rather than here:
    // if the whole resolver threw, we genuinely don't know why the code failed.
    console.warn("[stripe] discount resolution failed", err);
    return { applied: null, codeRejection: null };
  }
}

/**
 * Tell the campaign engine a purchase cleared, and settle any campaign discount
 * it consumed.
 *
 * Kept next to the referral hook and called from the same two places, so a new
 * purchase path can't be added that fires one engine and not the other.
 *
 * `projectId` matters more than it looks: a campaign can refund "the Sparks you
 * spent on THIS book", and the only place that link exists is the fulfillment
 * plan's merchant reference. Without it, project-scoped refunds silently pay
 * zero rather than visibly failing.
 */
async function notifyCampaignsOfPurchase(args: {
  uid: string;
  paymentId: string;
  /** Straight from Stripe session/PI metadata, so untyped by construction. */
  kind: string | undefined;
  amount?: number;
  productId?: string;
}): Promise<void> {
  try {
    let projectId: string | undefined;
    if (args.kind === "order") {
      const payment = await getAdminPayment(args.paymentId);
      const plan = (payment as { fulfillment?: { merchantReference?: string | null } } | null)
        ?.fulfillment;
      projectId = plan?.merchantReference ?? undefined;
    }
    await onCampaignEvent(args.uid, triggerForPaymentKind(args.kind), {
      ref: args.paymentId,
      amount: args.amount,
      itemType: itemTypeForPaymentKind(args.kind),
      productId: args.productId,
      projectId,
    });
    await finalizeCampaignDiscounts(args.paymentId);
  } catch (err) {
    // A campaign must never be the reason a paid order isn't fulfilled.
    console.warn("[campaigns] purchase hook failed", args.paymentId, err);
  }
}

/**
 * Settle any coupon this payment consumed, then tell the customer and the team.
 *
 * The Slack ping fires HERE, on settlement, and not when a code merely
 * validates. The distinction is the whole value of the notification: a valid
 * code typed into a checkout that's then abandoned is noise, while a code
 * actually coming off money is the signal that a leaked or over-performing
 * coupon is costing something — and it needs to arrive while pausing it is still
 * cheap.
 *
 * Both notifications are deduplicated by their own layers (`notifySlack`'s `ref`
 * marker, the email sender's dedupe key) rather than by a guard here, because
 * Stripe will retry this webhook and the settlement itself is already
 * idempotent.
 */
async function settleCouponsForPurchase(args: {
  uid: string;
  paymentId: string;
  /** Gross in the charged currency. */
  amount: number;
  currency: string;
  itemLabel: string;
}): Promise<void> {
  try {
    // `purchaseCount` is read BEFORE the purchase hooks bump it, so "was this a
    // new customer?" is answered about the moment the coupon was used, which is
    // what the acquisition report is asking.
    const facts = await couponUserFacts(args.uid).catch(() => null);
    const isNewCustomer = (facts?.purchaseCount ?? 1) <= 1;
    const settled = await settleCoupons({
      paymentRef: args.paymentId,
      revenue: await toUsd(args.amount, args.currency).catch(() => 0),
      isNewCustomer,
    });
    if (settled.length === 0) return;

    const buyer = await getUserSlackIdentity(args.uid);

    for (const { redemption, usesLeft } of settled) {
      await sendCouponRedeemedEmail({
        uid: args.uid,
        summary: redemption.terms?.summary ?? redemption.couponName,
        savedAmount: money(redemption.discountAmount, redemption.currency),
        itemLabel: args.itemLabel,
        orderRef: args.paymentId,
        code: redemption.code,
        usesLeft,
      }).catch(() => {});

      await notifySlack({
        messageKey: "coupon_redeemed",
        // Keyed on the redemption, not the payment: an order that somehow
        // carried two coupons is two facts worth knowing.
        ref: `coupon_${redemption.id}`,
        text: formatCouponSlackMessage({
          couponName: redemption.couponName,
          code: redemption.code,
          discountAmount: redemption.discountAmount,
          orderAmount: args.amount,
          currency: args.currency || redemption.currency,
          itemLabel: args.itemLabel,
          email: buyer.email,
          isNewCustomer,
          usesLeft,
        }),
      }).catch(() => {});
    }
  } catch (err) {
    // A coupon must never be the reason a paid order isn't fulfilled.
    console.warn("[coupons] purchase hook failed", args.paymentId, err);
  }
}

/**
 * Give back the coupon that paid for a refunded MEMBERSHIP invoice.
 *
 * Memberships have no payment document to key on — Stripe raises those invoices
 * itself — so the reservation ref is read off the subscription, which is where
 * checkout stamped it. That's also why the discount is verified against THIS
 * invoice before anything is restored: the ref stays on the subscription for
 * life, so a refunded renewal would otherwise hand back a coupon that was spent
 * on the first invoice months ago.
 */
async function restoreMembershipCoupons(invoiceId: string): Promise<void> {
  try {
    const invoice = await getStripe().invoices.retrieve(invoiceId);
    const discounted = (invoice.total_discount_amounts ?? []).some((d) => d.amount > 0);
    if (!discounted) return;
    const meta = (
      invoice as unknown as {
        subscription_details?: { metadata?: Record<string, string> | null } | null;
      }
    ).subscription_details?.metadata;
    const ref = typeof meta?.discountRef === "string" ? meta.discountRef : "";
    // Always a full refund here: the caller only reaches this on one.
    if (ref) await restoreCouponsForRefund({ paymentRef: ref, isFullRefund: true });
  } catch (err) {
    console.warn("[coupons] membership refund restore failed", invoiceId, err);
  }
}

/** Create a Checkout Session without weakening configured tax collection. */
async function createCheckoutSession(
  params: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session> {
  // Stripe's "Adaptive Pricing" is an account-level default, and it is ON unless somebody turned it
  // off in the Dashboard: the payment page then offers the buyer a converted amount in their own
  // currency (a second price nobody here calculated, at Stripe's rate of the day) and selects it
  // by default. A sale is made at the quoted amount in the quoted currency, so every one-time
  // payment says so itself rather than depending on a setting. (Subscriptions aren't eligible.)
  return getStripe().checkout.sessions.create(
    params.mode === "payment" ? { adaptive_pricing: { enabled: false }, ...params } : params,
  );
}

/**
 * Whether a stored customer id still resolves in the ACTIVE Stripe account.
 *
 * Two ways a saved id goes bad: it was minted in the other environment (the
 * sandbox↔live toggle moved under it), or it was deleted in the Dashboard. Both
 * surface as `resource_missing`, and both are recoverable by minting a new
 * customer. Any OTHER failure — auth, rate limit, outage — is rethrown: treating
 * those as "missing" would quietly fork a second customer per checkout attempt
 * and scatter one buyer's payment methods and tax location across all of them.
 */
async function customerResolves(customerId: string): Promise<boolean> {
  try {
    const customer = await getStripe().customers.retrieve(customerId);
    return !(customer as Stripe.DeletedCustomer).deleted;
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") return false;
    throw err;
  }
}

/**
 * Get (or lazily create) the Stripe customer for a user, in the active
 * environment.
 *
 * Self-healing on purpose. Every checkout path funnels through here, so a
 * customer id that the active Stripe key can't see used to take down ALL of
 * them at once (Sparks packs and gifts, plans, print orders, reorders, paid
 * ebooks) with a generic 500, and the only repair was editing Firestore by hand.
 * Now a stale id is verified, discarded, and replaced in the environment that
 * actually needs it.
 *
 * Also the single choke point where affiliate attribution reaches Stripe: every
 * checkout path resolves its customer here, so stamping the referral once at
 * this point covers all of them — including a customer that already existed
 * before the person followed an affiliate link.
 */
async function ensureCustomer(uid: string, email?: string | null): Promise<string> {
  const env = activeBillingEnv();
  const existing = await getStripeCustomerId(uid, env);
  if (existing && (await customerResolves(existing))) {
    // Re-save even on a hit: for a pre-split id this back-fills the scoped
    // field, so the next checkout skips the round trip above.
    await saveStripeCustomerId(uid, existing, env);
    await stampCustomerAttribution(uid, existing);
    return existing;
  }
  if (existing) {
    console.warn(`[stripe] customer ${existing} not found in ${env} for uid ${uid} — creating a replacement`);
    await forgetStripeCustomerId(uid, existing).catch(() => {});
  }
  const customer = await getStripe().customers.create({
    email: email ?? undefined,
    metadata: { uid },
  });
  await saveStripeCustomerId(uid, customer.id, env);
  await stampCustomerAttribution(uid, customer.id);
  return customer.id;
}

/**
 * A checkout that died server-side: log it, alert, and answer the buyer.
 *
 * The alert is the point. A broken checkout is silent by construction — the
 * buyer reads a toast that sounds retryable, gives up, and the only trace is a
 * `console.error` in a log nobody is watching. That is how a stale Stripe
 * customer id took every purchase path to zero for weeks without a single
 * report. Deduped per surface per hour so a sustained outage pings #ops once an
 * hour instead of once per abandoned buyer, while still naming which button is
 * dead and which Stripe environment it died in.
 */
async function checkoutFailed(res: Response, err: unknown, surface: string, message?: string): Promise<void> {
  console.error(`[stripe] ${surface} checkout failed`, err);
  await raiseAlert({
    severity: "critical",
    kind: "checkout_failed",
    message: `${surface} checkout failed: ${(err as Error)?.message ?? "unknown error"}`,
    meta: { surface, env: activeBillingEnv(), stripeCode: (err as { code?: string }).code ?? null },
    ref: `${surface}_${Math.floor(Date.now() / 3_600_000)}`,
  });
  clientError(res, message ?? "We couldn't start checkout. Please try again.", 500);
}

/** A portal session URL, or the client-facing reason there isn't one. */
type PortalResult = { url: string } | { error: string; status: number };

/**
 * Open a Stripe Customer Portal session for a user.
 *
 * The two ways this fails are both permanent, and neither deserves the "please
 * try again" that a 500 implies:
 *   - The portal needs a saved configuration, held PER STRIPE ACCOUNT. Sandbox
 *     having one says nothing about live, so the first live subscriber hits a
 *     hard `invalid_request` unless someone configured it in the Dashboard.
 *   - The stored customer can belong to the other environment. Checkout heals
 *     that by minting a replacement, but there is nothing to manage on a
 *     customer this account has never seen.
 */
async function openBillingPortal(uid: string): Promise<PortalResult> {
  const customerId = await getStripeCustomerId(uid, activeBillingEnv());
  if (!customerId) return { error: "No billing account yet.", status: 404 };
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl()}/studio`,
    });
    return { url: session.url };
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") {
      return { error: "No billing account yet.", status: 404 };
    }
    // Distinguishable in the logs from a transient Stripe failure, because the
    // fix is a one-time Dashboard change (Settings → Billing → Customer portal)
    // rather than a retry.
    const message = (err as Error)?.message ?? "";
    if (/configuration/i.test(message)) {
      console.error("[stripe] Customer Portal has no configuration in this environment", err);
      return { error: "Billing management isn't available yet. Please contact support.", status: 503 };
    }
    throw err;
  }
}

// ---- Print-order checkout core ----------------------------------------------

/** Coarse device dimensions stamped on a payment at checkout time. */
interface CheckoutDevice {
  device: string | null;
  deviceOs: string | null;
}

/**
 * The form factor the buyer is checking out ON, read from the request headers.
 *
 * This has to be captured at session-creation time: the Stripe webhook that
 * settles the payment arrives from Stripe's servers, so by then the only
 * user-agent available is Stripe's own. Null when unreadable, so the analytics
 * can tell "not recorded" from a real form factor.
 */
function checkoutDevice(req: Request): CheckoutDevice {
  const facts = deviceFactsFromHeaders(req.headers);
  if (facts.device === "unknown") return { device: null, deviceOs: null };
  return { device: facts.device, deviceOs: facts.os };
}

interface PrintCheckoutArgs {
  uid: string;
  email: string | null;
  /** Where the checkout was started, for the device analytics. */
  device: CheckoutDevice;
  product: ProductDefinition;
  /** Variant being sold; drives retail deltas and the composed print SKU. */
  variant: VariantSelection;
  /** Provider package id that actually prints (base SKU ⊕ variant). */
  printSku: string;
  settings: PricingSettings;
  /**
   * The quote being paid. Checkout charges THIS — it never prices the order
   * again — so the amount Stripe takes is, by construction, the amount the
   * customer was shown. Its inputs have already been proven to match the order.
   */
  quote: PrintQuoteRecord;
  copies: number;
  pages: number;
  currency: CurrencyCode;
  shippingMethod: ShippingMethod;
  destinationCountry: string;
  recipient: OrderDraft["recipient"];
  /** Customer reviewed the live carrier correction, if one was returned. */
  addressConfirmed?: boolean;
  /** Which way the customer decided it (see `FulfillmentPlan.addressChoice`). */
  addressChoice?: "suggested" | "entered";
  sourceFileUrls: { interior?: string; cover?: string };
  /** How to rebuild the files at print resolution after payment (see `FulfillmentPlan.printPrep`). */
  printPrep?: FulfillmentPlan["printPrep"];
  merchantReference: string | null;
  /** Spine foil lines, kept only when the print SKU is foil stamped. */
  foilStamp?: { title?: unknown; author?: unknown } | null;
}

type PrintCheckoutResult =
  | { ok: true; url: string | null; paymentId: string }
  /** `priceChanged`: the quote no longer holds; the client must fetch and show a new one. */
  | { ok: false; error: string; priceChanged?: boolean; inProgress?: boolean };

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
  /** Exact break-even at-cost pricing (Lulu production + Lulu shipping + Stripe fee). */
  atCost: AtCostBreakdown;
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
  // Read here rather than threaded through every caller: it's a 30-second
  // cached read on a path that already makes a provider round trip, and it
  // must be the SAME policy the projection published or the price the customer
  // was shown and the price they're charged would differ.
  const shippingSettings = await getShippingSettings();

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
  // Same rule for shipping: passthrough with no quote and no measured rate
  // would charge the customer nothing while we still pay the provider.
  if (!hasUsableShippingCost(shippingSettings, product.shipping, live.shippingCost, scenario)) {
    throw new PricingUnavailableError(
      `No shipping cost for SKU ${printSku}: ` +
        `live quote ${live.error ?? "returned no shipping cost"} and shipping is ` +
        `${shippingSettings.pricing.mode} with no rate for ${args.shippingMethod} ` +
        `to ${args.destinationCountry}.`,
    );
  }

  const margin = computeMargin(product, scenario, settings, shippingSettings);
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
    margin.shippingCharged ||
    resolveShippingCharged(shippingSettings, settings, live.shippingCost ?? 0, {
      currency,
      copies,
      method: args.shippingMethod,
    });
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
  const atCost = computeAtCostOrder(margin, settings);
  return {
    unitPrice,
    listUnitPrice: margin.pricePerUnit,
    discountPct,
    breakEvenDiscountPct: margin.breakEvenDiscountPct,
    shippingCharged,
    atCost,
    addressValidation: live.addressValidation,
    estimatedCost,
  };
}

// ---- The quote ---------------------------------------------------------------

/**
 * Tax could not be worked out, so the order can't be priced. Refused rather than
 * guessed: a total shown without tax, or with tax invented by us, is exactly the
 * wrong-price-on-screen this module exists to prevent.
 */
class TaxUnavailableError extends Error {}

/** What Stripe Tax says this order owes at its delivery address. */
async function calculateOrderTax(args: {
  currency: string;
  taxBehavior: QuoteTaxBehavior;
  taxCode: string;
  itemsMinor: number;
  shippingMinor: number;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    state?: string | null;
    postalCode: string;
    country: string;
  };
}): Promise<{ taxMinor: number; status: QuoteTaxStatus; reasons: string[] }> {
  if (args.itemsMinor + args.shippingMinor <= 0) return { taxMinor: 0, status: "calculated", reasons: [] };
  try {
    const calc = await getStripe().tax.calculations.create({
      currency: args.currency.toLowerCase(),
      // Taxed where the parcel is going, not at whatever billing address is
      // typed on the payment page: VAT on a physical book follows delivery.
      customer_details: {
        address: {
          line1: args.address.line1,
          line2: args.address.line2 || undefined,
          city: args.address.city,
          state: args.address.state || undefined,
          postal_code: args.address.postalCode,
          country: args.address.country,
        },
        address_source: "shipping",
      },
      line_items:
        args.itemsMinor > 0
          ? [
              {
                amount: args.itemsMinor,
                quantity: 1,
                reference: "books",
                tax_behavior: args.taxBehavior,
                tax_code: args.taxCode,
              },
            ]
          : [],
      // Left without a tax code on purpose: Stripe rates shipping with the
      // account's shipping tax code, which is the right one for postage.
      ...(args.shippingMinor > 0
        ? { shipping_cost: { amount: args.shippingMinor, tax_behavior: args.taxBehavior } }
        : {}),
    });
    const expectedTotal =
      args.itemsMinor +
      args.shippingMinor +
      (args.taxBehavior === "exclusive" ? calc.tax_amount_exclusive : 0);
    if (calc.amount_total !== expectedTotal) {
      throw new Error(`Stripe Tax total ${calc.amount_total} disagrees with ${expectedTotal}`);
    }
    const reasons = (calc.tax_breakdown ?? []).map((b) => String(b.taxability_reason));
    return {
      taxMinor: args.taxBehavior === "inclusive" ? calc.tax_amount_inclusive : calc.tax_amount_exclusive,
      status: reasons.includes("not_collecting") ? "not_collecting" : "calculated",
      reasons,
    };
  } catch (err) {
    console.error("[stripe] tax calculation failed", (err as Error)?.message ?? err);
    throw new TaxUnavailableError((err as Error)?.message ?? "tax calculation failed");
  }
}

/** How a resolved discount becomes arithmetic. The one translation, used to quote AND to re-check. */
function discountPlanFor(
  earned: AppliedDiscount | null,
  atCost: { itemsMinor: number; shippingMinor: number },
  currency: string,
): QuoteDiscountPlan | null {
  if (!earned) return null;
  if (earned.atCost) return { kind: "atCost", itemsMinor: atCost.itemsMinor, shippingMinor: atCost.shippingMinor };
  return {
    kind: "percent",
    percentOff: earned.percentOff,
    capMinor: earned.capAmount != null ? toMinor(earned.capAmount, currency) : null,
  };
}

/** At-cost orders are quoted ex-tax and let Stripe Tax add any destination tax on top. */
function taxBehaviorFor(
  earned: AppliedDiscount | null,
  settings: PricingSettings,
  currency: string,
): QuoteTaxBehavior {
  return earned?.atCost ? "exclusive" : (settings.tax.perCurrency[currency]?.behavior ?? "exclusive");
}

interface BuildQuoteArgs {
  uid: string;
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
  /** A code the customer typed, as typed. Applied only if the engine accepts it. */
  couponCode: string | null;
}

/**
 * Decide what this order costs — once — and write it down.
 *
 * Everything a customer can be shown or charged for a print order comes from
 * here: the books at the buyer's sticker price, shipping, every discount the one
 * resolver awards (a typed code, a referral perk, a campaign offer, the plan),
 * and the tax Stripe Tax computes for the delivery address. The result is
 * integers in minor units that add up exactly, and checkout charges those
 * integers rather than working anything out again.
 *
 * Nothing is reserved here: a quote is a price, not a purchase.
 */
async function buildPrintQuote(args: BuildQuoteArgs): Promise<PrintQuoteRecord> {
  const { uid, product, settings, copies, pages, currency, printSku } = args;
  const destinationCountry = args.destinationCountry.trim().toUpperCase();
  const priced = await priceRetailOrder({
    product,
    variant: args.variant,
    printSku,
    settings,
    activePlan: args.activePlan,
    copies,
    pages,
    currency,
    shippingMethod: args.shippingMethod,
    destinationCountry,
    address: args.address,
  });
  if (priced.unitPrice <= 0) throw new PricingUnavailableError(`${printSku} has no retail price`, "This product isn't priced for ordering yet.");

  const listUnitMinor = toMinor(priced.unitPrice, currency);
  const listShippingMinor = toMinor(priced.shippingCharged, currency);
  const atCostItemsMinor = toMinor(priced.atCost.unitPrice, currency) * copies;
  const atCostShippingMinor = toMinor(priced.atCost.shipping, currency);
  const listItemsMajor = toMajor(listUnitMinor * copies, currency);
  const listTotalMajor = toMajor(listUnitMinor * copies + listShippingMinor, currency);

  const quoteId = newQuoteId();
  const typedCode = args.couponCode?.trim() ? normalizeCouponCode(args.couponCode) : null;
  const { applied: earned, codeRejection } = await earnedDiscount({
    uid,
    itemType: "print",
    paymentId: `quote:${quoteId}`,
    settings,
    amount: listItemsMajor,
    orderTotal: listTotalMajor,
    atCostTotal: priced.atCost.total,
    appliedPct: priced.discountPct,
    breakEvenPct: priced.breakEvenDiscountPct,
    couponCode: typedCode,
    currency,
    productId: product.id,
    country: destinationCountry,
    dryRun: true,
  });

  const taxBehavior = taxBehaviorFor(earned, settings, currency);
  const plan = discountPlanFor(earned, { itemsMinor: atCostItemsMinor, shippingMinor: atCostShippingMinor }, currency);
  const base = {
    currency,
    copies,
    listUnitMinor,
    listShippingMinor,
    discount: plan,
    taxBehavior,
  };
  let lines = composeQuoteLines({ ...base, taxMinor: 0 });

  const taxCode = settings.tax.bookTaxCode;
  let taxStatus: QuoteTaxStatus = "off";
  let taxabilityReasons: string[] = [];
  if (taxCode) {
    const tax = await calculateOrderTax({
      currency,
      taxBehavior,
      taxCode,
      itemsMinor: lines.itemsMinor,
      shippingMinor: lines.shippingMinor,
      address: {
        line1: args.address.line1 ?? "",
        line2: args.address.line2,
        city: args.address.townOrCity,
        state: args.address.stateOrCounty,
        postalCode: args.address.postalOrZipCode,
        country: destinationCountry,
      },
    });
    lines = composeQuoteLines({ ...base, taxMinor: tax.taxMinor });
    taxStatus = tax.status;
    taxabilityReasons = tax.reasons;
  }

  // A discount that rounds to nothing isn't one: don't advertise it, and don't
  // let it burn a single-use code at checkout.
  const effective = earned && lines.discountMinor > 0 ? earned : null;
  const appliedCode = effective?.code ?? null;
  const inputs: QuoteInputs = {
    printSku,
    copies,
    pages,
    shippingMethod: args.shippingMethod,
    destinationCountry,
    address: {
      line1: args.address.line1 ?? "",
      line2: args.address.line2 ?? "",
      city: args.address.townOrCity,
      state: args.address.stateOrCounty ?? "",
      postalCode: args.address.postalOrZipCode,
    },
    // Normalised, because checkout compares this against the code the browser
    // sends back — which is normalised the same way — and a display form with a
    // dash in it would never match its own quote.
    couponCode: appliedCode ? normalizeCouponCode(appliedCode) : null,
  };
  const now = Date.now();
  return {
    id: quoteId,
    uid,
    createdAt: now,
    expiresAt: now + QUOTE_TTL_MS,
    expireAt: new Date(now + QUOTE_TTL_MS),
    inputHash: hashQuoteInputs(inputs),
    inputs,
    currency,
    productId: product.id,
    printSku,
    lines,
    planDiscountPct: priced.discountPct,
    listUnitBeforePlanMinor: toMinor(priced.listUnitPrice, currency),
    breakEvenDiscountPct: priced.breakEvenDiscountPct,
    atCostTotal: priced.atCost.total,
    atCostItemsMinor,
    atCostShippingMinor,
    discount: effective
      ? {
          percentOff: effective.percentOff,
          amountMinor: lines.discountMinor,
          summary: effective.summary,
          notes: effective.notes ?? [],
          code: appliedCode,
          atCost: Boolean(effective.atCost),
          capMinor: effective.capAmount != null ? toMinor(effective.capAmount, currency) : null,
        }
      : null,
    couponRejection: typedCode && codeRejection ? { reason: codeRejection.reason, message: codeRejection.message } : null,
    taxStatus,
    taxabilityReasons,
    addressValidation: priced.addressValidation ?? null,
    estimatedCost: priced.estimatedCost,
  };
}

// ---- Digital quotes (ebook, Spark packs) -----------------------------------------

/** What is being sold, before any code or perk. Everything else about its price is decided from this. */
interface DigitalPurchase {
  uid: string;
  kind: "ebook" | "pack";
  /** The project id (ebook) or the pack id — what the quote is identified by. */
  subject: string;
  /** The key the discount engine scopes offers by. */
  productId: string;
  settings: PricingSettings;
  currency: CurrencyCode;
  /** The sticker price in major units, with any member or print-owner price already in it. */
  listPrice: number;
}

function digitalInputs(p: DigitalPurchase, code: string | null): DigitalQuoteInputs {
  return {
    kind: p.kind,
    subject: p.subject,
    currency: p.currency,
    couponCode: code?.trim() ? normalizeCouponCode(code) : null,
  };
}

/**
 * Decide what a digital purchase costs — once — and write it down.
 *
 * Same resolver, same integer arithmetic as the print quote. Nothing is reserved
 * (a quote is a price, not a purchase), and tax is left to Stripe Tax on the
 * payment page, so `taxMinor` is 0 and the lines are the charge before tax.
 */
async function buildDigitalQuote(p: DigitalPurchase, couponCode: string | null): Promise<DigitalQuoteRecord> {
  const listUnitMinor = toMinor(p.listPrice, p.currency);
  const id = newQuoteId();
  const typed = couponCode?.trim() ? normalizeCouponCode(couponCode) : null;
  const { applied: earned, codeRejection } = await earnedDiscount({
    uid: p.uid,
    itemType: p.kind,
    paymentId: `quote:${id}`,
    settings: p.settings,
    amount: fromMinorUnits(listUnitMinor, p.currency),
    couponCode: typed,
    currency: p.currency,
    productId: p.productId,
    dryRun: true,
  });
  const taxBehavior = taxBehaviorFor(null, p.settings, p.currency);
  const lines = composeQuoteLines({
    currency: p.currency,
    copies: 1,
    listUnitMinor,
    listShippingMinor: 0,
    discount: discountPlanFor(earned, { itemsMinor: 0, shippingMinor: 0 }, p.currency),
    taxBehavior,
    taxMinor: 0,
  });
  // A discount that rounds to nothing isn't one: don't advertise it, and don't
  // let it burn a single-use code at checkout.
  const effective = earned && lines.discountMinor > 0 ? earned : null;
  const now = Date.now();
  const inputs = digitalInputs(p, effective?.code ?? null);
  return {
    id,
    uid: p.uid,
    createdAt: now,
    expiresAt: now + QUOTE_TTL_MS,
    expireAt: new Date(now + QUOTE_TTL_MS),
    inputHash: hashDigitalInputs(inputs),
    inputs,
    currency: p.currency,
    lines,
    discount: effective
      ? {
          percentOff: effective.percentOff,
          amountMinor: lines.discountMinor,
          summary: effective.summary,
          notes: effective.notes ?? [],
          code: inputs.couponCode,
          atCost: false,
          capMinor: effective.capAmount != null ? toMinor(effective.capAmount, p.currency) : null,
        }
      : null,
    couponRejection: typed && codeRejection ? { reason: codeRejection.reason, message: codeRejection.message } : null,
  };
}

type DigitalFailure = { ok: false; error: string; priceChanged?: boolean; status?: number };

/**
 * The quote a digital checkout will charge: the one the customer was shown (by
 * id), or — for the one-click buttons that never showed a quote — one made now,
 * by the same code. Checked cheaply, before anything is reserved or uploaded.
 */
async function resolveDigitalQuote(
  p: DigitalPurchase,
  quoteId: string | undefined,
  couponCode: string | null,
): Promise<{ ok: true; quote: DigitalQuoteRecord } | DigitalFailure> {
  if (quoteId) {
    const loaded = await loadDigitalQuote({ quoteId, uid: p.uid, inputs: digitalInputs(p, couponCode) });
    if (!loaded.ok) return { ok: false, error: QUOTE_REFUSAL_MESSAGE[loaded.reason], priceChanged: true };
    // The price itself can move under a quote (a member price, a print purchase
    // that cheapens the ebook): then the quote is for a price that no longer exists.
    if (loaded.quote.lines.listUnitMinor !== toMinor(p.listPrice, p.currency)) {
      return { ok: false, error: QUOTE_REFUSAL_MESSAGE.different_order, priceChanged: true };
    }
    return { ok: true, quote: loaded.quote };
  }
  const quote = await buildDigitalQuote(p, couponCode);
  // A code the customer typed must work or say why — never be quietly dropped.
  if (couponCode?.trim() && quote.couponRejection) return { ok: false, error: quote.couponRejection.message };
  await saveDigitalQuote(quote);
  return { ok: true, quote };
}

/**
 * Take the quote for one checkout and reserve what it promised. The discount is
 * decided again with the reservation actually taken, and must come to the SAME
 * money as the quote — anything else is a price the customer hasn't seen.
 */
async function reserveDigitalQuote(
  p: DigitalPurchase,
  quote: DigitalQuoteRecord,
  paymentId: string,
): Promise<{ ok: true; earned: AppliedDiscount | null } | DigitalFailure> {
  if (!(await claimQuote(quote.id, paymentId))) {
    return { ok: false, error: QUOTE_REFUSAL_MESSAGE.in_progress, status: 409 };
  }
  try {
    const { applied: earned, codeRejection } = await earnedDiscount({
      uid: p.uid,
      itemType: p.kind,
      paymentId,
      settings: p.settings,
      amount: fromMinorUnits(quote.lines.listUnitMinor, p.currency),
      couponCode: quote.inputs.couponCode,
      currency: p.currency,
      productId: p.productId,
    });
    const rebuilt = composeQuoteLines({
      currency: p.currency,
      copies: 1,
      listUnitMinor: quote.lines.listUnitMinor,
      listShippingMinor: 0,
      discount: discountPlanFor(earned, { itemsMinor: 0, shippingMinor: 0 }, p.currency),
      taxBehavior: quote.lines.taxBehavior,
      taxMinor: 0,
    });
    if (codeRejection || rebuilt.itemsMinor !== quote.lines.itemsMinor) {
      await releaseCoupons(paymentId, "price changed since the quote");
      await unclaimQuote(quote.id);
      return {
        ok: false,
        error: codeRejection?.message ?? QUOTE_REFUSAL_MESSAGE.different_order,
        priceChanged: true,
      };
    }
    return { ok: true, earned };
  } catch (err) {
    await releaseCoupons(paymentId, "checkout failed before payment");
    await unclaimQuote(quote.id);
    throw err;
  }
}

/** Hand back everything a failed digital checkout was holding. */
async function abandonDigitalCheckout(paymentId: string, quoteId: string): Promise<void> {
  await releaseCoupons(paymentId, "checkout failed before payment").catch(() => undefined);
  await unclaimQuote(quoteId);
}

/**
 * Stripe has priced the session itself; it must agree with the quote. The tax is
 * Stripe's to add, so what is compared is the part we decided: the items line
 * (before any tax), and the whole total when no tax is being collected at all.
 * On a difference the session is closed, nothing has been charged, someone is told.
 */
/**
 * The payment page sells in the currency the buyer was quoted, with no converted second price on it.
 * `adaptive_pricing` is switched off on every session we create; this is the check that it held.
 */
function sessionSellsInQuotedCurrency(session: Stripe.Checkout.Session, currency: string): boolean {
  return session.currency === currency.toLowerCase() && session.adaptive_pricing?.enabled !== true;
}

async function sessionMatchesDigitalQuote(
  session: Stripe.Checkout.Session,
  quote: DigitalQuoteRecord,
  hasTax: boolean,
  paymentId: string,
): Promise<boolean> {
  const lines = quote.lines;
  const ok =
    session.amount_subtotal === lines.itemsMinor &&
    (hasTax || session.amount_total === lines.totalMinor) &&
    sessionSellsInQuotedCurrency(session, lines.currency);
  if (ok) return true;
  await getStripe()
    .checkout.sessions.expire(session.id)
    .catch(() => undefined);
  void raiseAlert({
    severity: "critical",
    kind: "checkout_price_mismatch",
    ref: paymentId,
    message:
      `A ${quote.inputs.kind} checkout was refused before payment: Stripe priced it at ` +
      `${session.amount_subtotal} before tax (${session.amount_total} total) but the quote was ${lines.itemsMinor} ${lines.currency}.`,
    meta: { uid: quote.uid, quoteId: quote.id, paymentId, sessionId: session.id, quoted: lines },
  }).catch(() => undefined);
  return false;
}

/** What the payment record keeps of a digital quote, for the webhook to check against. */
function digitalQuoteRecordMeta(quote: DigitalQuoteRecord, hasTax: boolean) {
  return {
    id: quote.id,
    totalMinor: quote.lines.totalMinor,
    taxMinor: 0,
    discountMinor: quote.lines.discountMinor,
    subtotalMinor: quote.lines.subtotalMinor,
    taxBehavior: quote.lines.taxBehavior,
    taxDeferred: hasTax,
  };
}

function respondDigitalFailure(res: Response, f: DigitalFailure): void {
  if (f.priceChanged) priceChanged(res, f.error);
  else clientError(res, f.error, f.status ?? 400);
}

/**
 * Why this order can't ship, or `null` if it can.
 *
 * One implementation, two call sites: {@link createPrintCheckout} enforces it so
 * no path can skip it, and `/checkout` calls it before uploading print files so
 * a doomed order doesn't cost a Storage round trip first. Sharing the function
 * means the fast path can't drift from the binding one.
 */
async function shippingRefusal(
  product: ProductDefinition,
  dest: {
    country?: string | null;
    region?: string;
    method: ShippingMethod;
    /**
     * `"quote"` checks only destination eligibility; `"order"` also demands the
     * order-time fields the provider will insist on. A price preview must not
     * fail on a missing tax id — the customer hasn't reached that input yet, and
     * an error there reads as "we won't sell to you" rather than "keep typing".
     */
    stage: "quote" | "order";
    taxId?: string | null;
  },
): Promise<string | null> {
  const country = (dest.country ?? "").trim().toUpperCase();
  const [registry, shippingSettings, capability] = await Promise.all([
    getMarketRegistry(),
    getShippingSettings(),
    capabilityForProduct(product.provider.sku, country),
  ]);
  const policy = destinationPolicyFor(shippingSettings, product.shipping);

  // Three separate refusals, because they have three different remedies and a
  // single message sent everyone down the wrong one. "We don't serve your
  // country" is final; "this book doesn't go there" means try another book;
  // "not to your state" means the rest of the country is fine. The old shared
  // wording ("this product … that destination") told a customer in an unserved
  // country to go shopping for a different book that also wouldn't ship.
  if (!country || !registry.enabled.has(country)) {
    const where = country ? countryLabel(country) : "that country";
    return `We're sorry — we don't currently ship to ${where}.`;
  }
  if (!isDestinationAllowed(registry, policy, { country })) {
    return `This book can't be shipped to ${countryLabel(country)} yet.`;
  }
  if (!isDestinationAllowed(registry, policy, { country, region: dest.region })) {
    return `We can't ship this book to that part of ${countryLabel(country)} yet.`;
  }
  // The same resolver the storefront's picker is built from, so a speed can't
  // be selectable in the form and rejected here. It also catches the case the
  // picker can't: coverage discovered AFTER the page was rendered.
  if (!offeredMethodsFor(shippingSettings, capability, product.shipping, country).includes(dest.method)) {
    return `That delivery speed isn't available to ${countryLabel(country)}.`;
  }
  // Enforced here as well as in the checkout form because this is the binding
  // check: the provider only rejects a missing recipient tax id when the print
  // job is created, which is after the customer has paid.
  if (dest.stage === "order" && TAX_ID_REQUIRED.has(country) && !dest.taxId?.trim()) {
    return `Orders to ${countryLabel(country)} need the recipient's ${TAX_ID_LABEL[country] ?? "tax id"} for customs.`;
  }
  return null;
}

/**
 * A phone or customs id the printer would refuse — caught here because it only
 * refuses them when the job is created, after payment.
 */
function recipientFormatIssue(country: string, recipient: OrderDraft["recipient"]): string | null {
  const phone = phoneProblem(recipient.phoneNumber ?? "");
  if (phone) return `Recipient phone: ${phone}`;
  if (TAX_ID_REQUIRED.has(country)) {
    const taxId = taxIdProblem(country, recipient.address.taxId ?? "");
    if (taxId) return `Recipient ${TAX_ID_LABEL[country] ?? "tax id"}: ${taxId}`;
  }
  return null;
}

/**
 * The tier to quote when the client didn't name one.
 *
 * The cheapest speed that actually reaches this destination, since that's what
 * a "from" price should say. Falls back to the cheapest tier sold anywhere only
 * when the destination offers none — the refusal check that follows will turn
 * that order away with a better message than a pricing error would.
 */
async function previewShippingMethod(
  product: ProductDefinition,
  country: string,
): Promise<ShippingMethod> {
  const [settings, capability] = await Promise.all([
    getShippingSettings(),
    capabilityForProduct(product.provider.sku, country),
  ]);
  const offered = offeredMethodsFor(settings, capability, product.shipping, country);
  return offered[0] ?? defaultShippingMethod(settings);
}

/**
 * Retire this buyer's earlier, still-open checkout of the same book.
 *
 * Coming back from the payment page and trying again used to leave the first
 * attempt holding the buyer's single-use code until its session expired a day
 * later, so the retry was refused with "already used". One live checkout per
 * book is also what a customer expects.
 *
 * Returns false when an earlier session turns out to be PAID already (its
 * webhook just hasn't landed): the new checkout must not go ahead, and nothing
 * of the paid one may be released.
 */
async function retireEarlierCheckouts(uid: string, merchantReference: string | null): Promise<boolean> {
  if (!merchantReference) return true;
  const open = await listOpenCheckoutsForBook(uid, merchantReference);
  for (const { paymentId, stripeSessionId } of open) {
    try {
      await getStripe().checkout.sessions.expire(stripeSessionId);
    } catch {
      const session = await getStripe().checkout.sessions.retrieve(stripeSessionId).catch(() => null);
      if (session?.status === "complete") return false;
      if (session && session.status !== "expired") continue;
    }
    await releaseCoupons(paymentId, "superseded by a newer checkout");
  }
  return true;
}

async function createPrintCheckout(args: PrintCheckoutArgs): Promise<PrintCheckoutResult> {
  const { uid, product, variant, printSku, settings, quote, copies, pages, currency, recipient } = args;
  const destinationCountry = args.destinationCountry.trim().toUpperCase();
  const recipientCountry = recipient.address.countryCode.trim().toUpperCase();
  if (
    !isIsoCountry(destinationCountry) ||
    destinationCountry !== recipientCountry
  ) {
    return {
      ok: false,
      error: "The checkout destination must match the recipient's shipping country.",
    };
  }
  if (
    !recipient.name.trim() ||
    !recipient.phoneNumber?.trim() ||
    !recipient.address.line1.trim() ||
    !recipient.address.townOrCity.trim() ||
    !recipient.address.postalOrZipCode.trim()
  ) {
    return {
      ok: false,
      error: "A recipient name, phone number, and complete shipping address are required.",
    };
  }
  const formatIssue = recipientFormatIssue(destinationCountry, recipient);
  if (formatIssue) return { ok: false, error: formatIssue };
  if (STATE_CODE_REQUIRED.has(destinationCountry) && !recipient.address.stateOrCounty?.trim()) {
    return {
      ok: false,
      error: `Orders to ${countryLabel(destinationCountry)} require a state or province code.`,
    };
  }

  // Checked HERE, at the chokepoint both physical-order paths funnel through.
  // Only one of them used to validate: a reorder replayed a stored address, so
  // an order placed before a market was withdrawn stayed repeatable forever.
  const refusal = await shippingRefusal(product, {
    country: destinationCountry,
    region: recipient.address.stateOrCounty ?? undefined,
    method: args.shippingMethod,
    stage: "order",
    taxId: recipient.address.taxId,
  });
  if (refusal) return { ok: false, error: refusal };

  // The quote is the price. Prove it is for THIS order and still sound before a
  // cent of it is used — the route already matched its inputs, this is the
  // belt to that pair of braces.
  const lines = quote.lines;
  if (
    quote.printSku !== printSku ||
    lines.copies !== copies ||
    lines.currency !== currency.toUpperCase() ||
    quoteProblems(lines).length > 0
  ) {
    return { ok: false, error: QUOTE_REFUSAL_MESSAGE.unsound, priceChanged: true };
  }
  const addressValidation = quote.addressValidation;
  if (addressValidation?.severity === "error") {
    return {
      ok: false,
      error: "The shipping address could not be verified. Please correct it before paying.",
    };
  }
  if (addressValidation?.suggested && !args.addressConfirmed) {
    return {
      ok: false,
      error: "Review the carrier's suggested address correction before paying.",
    };
  }
  if (lines.listUnitMinor <= 0) {
    return { ok: false, error: "This product isn't priced for ordering yet." };
  }
  if (lines.totalMinor <= 0) {
    return { ok: false, error: "This order can't be paid for online. Please contact us." };
  }

  // The provider downloads the print files LATER, on its own schedule, so a URL
  // it can't fetch comes back as a rejected job with the customer already
  // charged. Both callers funnel through here — a fresh checkout and a reorder
  // reusing files from months ago — and both are still pre-payment at this
  // point, so an unreachable file is a retryable error instead of a refund.
  //
  // Done BEFORE anything is reserved: a refusal after a single-use code was
  // taken used to leave that code held until its session would have expired.
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

  if (!(await retireEarlierCheckouts(uid, args.merchantReference))) {
    return {
      ok: false,
      error: "A payment for this book is already in progress. Check your email or your orders before trying again.",
    };
  }

  // The payment id is minted here (rather than just before the session) because
  // an earned discount is RESERVED against it — the reservation is what makes the
  // reward single-use across an abandoned checkout.
  const paymentId = randomUUID();
  if (!(await claimQuote(quote.id, paymentId))) {
    return { ok: false, error: QUOTE_REFUSAL_MESSAGE.in_progress, inProgress: true };
  }

  // Everything from the reservation on is undone if anything fails, so a refused
  // or broken checkout can never leave a single-use code held for somebody who
  // was never charged.
  let reserved = false;
  try {
    const { applied: earned, codeRejection } = await earnedDiscount({
      uid,
      itemType: "print",
      paymentId,
      settings,
      amount: fromMinorUnits(lines.listItemsMinor, currency),
      orderTotal: fromMinorUnits(lines.listItemsMinor + lines.listShippingMinor, currency),
      atCostTotal: quote.atCostTotal,
      appliedPct: quote.planDiscountPct,
      breakEvenPct: quote.breakEvenDiscountPct,
      couponCode: quote.inputs.couponCode,
      currency,
      productId: product.id,
      country: destinationCountry,
    });
    reserved = true;

    // Re-decide the discount with the reservation actually taken, and require the
    // SAME money as the quote. A code someone else just used, a reward that
    // lapsed, a referral that arrived — any of it moves the price, and the
    // customer has to see the new price before it is charged.
    const rebuilt = composeQuoteLines({
      currency,
      copies,
      listUnitMinor: lines.listUnitMinor,
      listShippingMinor: lines.listShippingMinor,
      discount: discountPlanFor(
        earned,
        { itemsMinor: quote.atCostItemsMinor, shippingMinor: quote.atCostShippingMinor },
        currency,
      ),
      taxBehavior: taxBehaviorFor(earned, settings, currency),
      taxMinor: lines.taxMinor,
    });
    if (
      codeRejection ||
      rebuilt.itemsMinor !== lines.itemsMinor ||
      rebuilt.shippingMinor !== lines.shippingMinor ||
      rebuilt.taxBehavior !== lines.taxBehavior
    ) {
      await releaseCoupons(paymentId, "price changed since the quote");
      reserved = false;
      await unclaimQuote(quote.id);
      return {
        ok: false,
        error: codeRejection?.message ?? QUOTE_REFUSAL_MESSAGE.different_order,
        priceChanged: true,
      };
    }

    const customerId = await ensureCustomer(uid, args.email);

    const taxCode = settings.tax.bookTaxCode;
    const hasTax = Boolean(taxCode);
    const taxBehavior = lines.taxBehavior;
    const stripeCurrency = currency.toLowerCase();
    const bookLine = bookChargeLine(lines.itemsMinor, copies);
    const discountNote = quote.discount && lines.discountMinor > 0 ? `Discount applied: ${quote.discount.summary}` : null;

    // The books are charged as exactly `itemsMinor`: equal whole-cent units when
    // the copies divide it evenly, otherwise one line for the lot. Never a
    // rounded per-copy price, which is how a Stripe total drifts from a quote.
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: bookLine.quantity,
        price_data: {
          currency: stripeCurrency,
          unit_amount: bookLine.unitAmountMinor,
          tax_behavior: hasTax ? taxBehavior : undefined,
          product_data: {
            name: bookLine.collapsed ? `${product.presentation.name} × ${copies}` : product.presentation.name,
            // The reward is spelled out on the line item, because a price that's
            // quietly lower than the storefront's reads as a bug to the buyer.
            description:
              [product.presentation.tagline || null, discountNote].filter(Boolean).join(" · ") || undefined,
            tax_code: taxCode,
            metadata: { sku: printSku },
          },
        },
      },
    ];

    // Where the tax is worked out. Stripe Tax takes the customer's saved
    // SHIPPING address ahead of the billing address typed on its page, so putting
    // the delivery address there makes Checkout tax the same place the quote did.
    if (hasTax) {
      await getStripe().customers.update(customerId, {
        shipping: {
          name: recipient.name.trim(),
          phone: recipient.phoneNumber?.trim() || undefined,
          address: {
            line1: recipient.address.line1.trim(),
            line2: recipient.address.line2?.trim() || undefined,
            city: recipient.address.townOrCity.trim(),
            state: recipient.address.stateOrCounty?.trim() || undefined,
            postal_code: recipient.address.postalOrZipCode.trim(),
            country: destinationCountry,
          },
        },
      });
    }

    const fulfillment: FulfillmentPlan = {
      productSku: printSku,
      variant,
      copies,
      shippingMethod: args.shippingMethod,
      destinationCountry,
      currency,
      pageCount: pages,
      merchantReference: args.merchantReference,
      recipient: planRecipient(recipient),
      sourceFileUrls: args.sourceFileUrls,
      printPrep: args.printPrep ?? null,
      // What the customer told us when the carrier offered a correction. It is
      // NOT derived from the live re-validation above: once they take the
      // suggestion the address is already corrected, so the carrier has nothing
      // left to suggest and the only record of the decision is what they sent.
      addressChoice: args.addressChoice ?? null,
      estimatedCost: quote.estimatedCost,
      foilStamp: variant.foil && variant.foil !== NO_OPTION ? foilStampText(args.foilStamp) : null,
    };

    // `rewardful: "false"` when a print order is outside the referring campaign's
    // scope — Rewardful reads it off the charge and creates no commission.
    const affiliateMeta = await affiliateChargeMetadata(uid, "order");
    const studioReturnPath = args.merchantReference
      ? `/studio/${encodeURIComponent(args.merchantReference)}/order`
      : "/studio";
    const projectParam = args.merchantReference
      ? `&project=${encodeURIComponent(args.merchantReference)}`
      : "";
    const session = await createCheckoutSession({
      mode: "payment",
      customer: customerId,
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: hasTax ? "required" : "auto",
      automatic_tax: { enabled: hasTax },
      line_items: lineItems,
      // Postage is a shipping rate, not a line item, so Stripe Tax rates it as
      // shipping instead of as whatever the account's default product code is.
      ...(lines.shippingMinor > 0
        ? {
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount" as const,
                  display_name: "Shipping & handling",
                  fixed_amount: { amount: lines.shippingMinor, currency: stripeCurrency },
                  tax_behavior: hasTax ? taxBehavior : undefined,
                },
              },
            ],
          }
        : {}),
      client_reference_id: paymentId,
      metadata: { paymentId, uid, kind: "order", quoteId: quote.id },
      payment_intent_data: { metadata: { paymentId, uid, kind: "order", quoteId: quote.id, ...affiliateMeta } },
      // `payment` is what the confirmation screen keys on: it opens on our own
      // payment id (not the Stripe session) so it can follow the record live —
      // including the fulfillment leg, which happens after this redirect.
      success_url: `${appBaseUrl()}${studioReturnPath}?checkout=success&payment=${paymentId}${projectParam}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl()}${studioReturnPath}?checkout=cancel`,
    });

    // The last line of defence: Stripe has now priced the session itself. If its
    // total is not exactly the quote, the customer must not be sent to pay it —
    // the session is closed, nothing was charged, and someone is told.
    const taxLocated = !hasTax || session.automatic_tax?.status === "complete";
    if (session.amount_total !== lines.totalMinor || !taxLocated || !sessionSellsInQuotedCurrency(session, lines.currency)) {
      await getStripe()
        .checkout.sessions.expire(session.id)
        .catch(() => undefined);
      void raiseAlert({
        severity: "critical",
        kind: "checkout_price_mismatch",
        ref: paymentId,
        message:
          `A checkout was refused before payment: Stripe priced it at ${session.amount_total} ` +
          `(tax status ${session.automatic_tax?.status ?? "n/a"}) but the quote was ${lines.totalMinor} ${lines.currency}.`,
        meta: { uid, quoteId: quote.id, paymentId, sessionId: session.id, quoted: lines, stripeTotal: session.amount_total },
      }).catch(() => undefined);
      await releaseCoupons(paymentId, "stripe priced the session differently");
      reserved = false;
      await unclaimQuote(quote.id);
      return {
        ok: false,
        error: "We couldn't confirm your final price just now. Nothing has been charged — please try again.",
        priceChanged: true,
      };
    }

    await createPendingPayment({
      paymentId,
      uid,
      kind: "order",
      // The exact amount Stripe will take, tax included — not an estimate.
      amount: fromMinorUnits(lines.totalMinor, currency),
      currency,
      description: `${product.presentation.name} ×${copies}`,
      stripeSessionId: session.id,
      stripeCustomerId: customerId,
      fulfillment,
      ...args.device,
      quote: {
        id: quote.id,
        totalMinor: lines.totalMinor,
        taxMinor: lines.taxMinor,
        discountMinor: lines.discountMinor,
      },
      items: [
        {
          label: product.presentation.name,
          amount: fromMinorUnits(bookLine.unitAmountMinor, currency),
          quantity: bookLine.quantity,
        },
        ...(lines.shippingMinor > 0
          ? [{ label: "Shipping & handling", amount: fromMinorUnits(lines.shippingMinor, currency), quantity: 1 }]
          : []),
      ],
    });

    // The checkout is real from here: stamp the book so abandonment can be read per
    // studio flow. Best-effort and first-write-wins, like every milestone.
    if (args.merchantReference) {
      await stampMilestone(uid, args.merchantReference, "checkoutStarted").catch(() => {});
    }

    return { ok: true, url: session.url, paymentId };
  } catch (err) {
    if (reserved) await releaseCoupons(paymentId, "checkout failed before payment");
    await unclaimQuote(quote.id);
    throw err;
  }
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
      const destinationCountry = body.destinationCountry?.trim().toUpperCase();
      const recipientCountry = body.recipient.address?.countryCode?.trim().toUpperCase();
      if (
        !isIsoCountry(destinationCountry) ||
        !isIsoCountry(recipientCountry) ||
        destinationCountry !== recipientCountry
      ) {
        clientError(res, "The checkout destination must match the recipient's shipping country.");
        return;
      }
      const recipient: OrderDraft["recipient"] = {
        ...body.recipient,
        name: body.recipient.name.trim(),
        phoneNumber: body.recipient.phoneNumber?.trim(),
        email: body.recipient.email?.trim(),
        address: {
          ...body.recipient.address,
          line1: body.recipient.address.line1?.trim(),
          line2: body.recipient.address.line2?.trim() || undefined,
          townOrCity: body.recipient.address.townOrCity?.trim(),
          stateOrCounty: body.recipient.address.stateOrCounty?.trim() || undefined,
          postalOrZipCode: body.recipient.address.postalOrZipCode?.trim(),
          countryCode: destinationCountry,
          taxId: body.recipient.address.taxId?.trim() || undefined,
        },
      };
      if (
        !recipient.name ||
        !recipient.phoneNumber ||
        !recipient.address.line1 ||
        !recipient.address.townOrCity ||
        !recipient.address.postalOrZipCode
      ) {
        clientError(res, "A recipient name, phone number, and complete shipping address are required.");
        return;
      }
      const formatIssue = recipientFormatIssue(destinationCountry, recipient);
      if (formatIssue) {
        clientError(res, formatIssue);
        return;
      }
      if (STATE_CODE_REQUIRED.has(destinationCountry) && !recipient.address.stateOrCounty) {
        clientError(res, `Orders to ${countryLabel(destinationCountry)} require a state or province code.`);
        return;
      }
      // The print provider needs a contact address for the job (delivery problems
      // are reported there). The recipient email is optional in the form — a gift
      // for somebody else — so fall back to the buyer's own, rather than finding
      // out after payment that the job can't be created.
      if (!recipient.email) {
        const accountEmail = (req.authToken as { email?: string } | undefined)?.email?.trim();
        recipient.email = accountEmail || undefined;
      }
      if (!recipient.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
        clientError(res, "A valid email address is required so we can reach you about this order.");
        return;
      }

      // What prints is the saved book: not while one of its pictures is being replaced. (The merchant
      // reference is the book's id.)
      const drawingBook = body.merchantReference?.trim();
      if (drawingBook && (await bookIsBeingDrawn(uid, drawingBook))) {
        clientError(res, "Your book is still being drawn. You can order when it finishes.", 409);
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

      // Destination-derived, exactly as in the price preview — see the note
      // there. Taking it from the body would let the two disagree, which means
      // charging an amount the customer was never shown.
      const currency = currencyForMarket(
        destinationCountry,
        settings.currencies,
        settings.baseCurrency,
      ) as CurrencyCode;
      const copies = Math.max(1, Math.floor(body.copies || 1));

      // Server-authoritative order limits — the client UI mirrors these, but
      // only this check is binding.
      //
      // A page count is never refused for being the wrong shape: a binding made
      // in sheets of four takes a book of 18 pages as 20, and the two blank
      // pages are added to the file below. Only a book LONGER than the binding
      // can hold is turned away — a count we can't print at all.
      const cond = product.conditions;
      const pagePlan = planPageCount(
        Math.max(1, Math.floor(body.pageCount || cond.pages.min)),
        cond.pages,
      );
      if (pagePlan.status === "too-long") {
        clientError(
          res,
          `This product takes up to ${cond.pages.max} pages — pick a binding that holds a longer book.`,
        );
        return;
      }
      const pages = pagePlan.printed;
      if (copies < cond.copies.min || copies > cond.copies.max) {
        clientError(res, `You can order between ${cond.copies.min} and ${cond.copies.max} copies.`);
        return;
      }
      // Checked before the uploads below purely to save the round trip;
      // `createPrintCheckout` re-checks and is the binding one.
      const refusal = await shippingRefusal(product, {
        country: destinationCountry,
        region: recipient.address.stateOrCounty ?? undefined,
        method: body.shippingMethod,
        stage: "order",
        taxId: recipient.address.taxId,
      });
      if (refusal) {
        clientError(res, refusal);
        return;
      }

      // The price is a quote the customer was shown. Prove this order is the one
      // it was made for BEFORE the expensive part (hosting the print files): a
      // stale or foreign quote is a 409 that makes the dialog show a fresh price,
      // not a payment page for an amount nobody approved.
      const quoteInputs: QuoteInputs = {
        printSku,
        copies,
        pages,
        shippingMethod: body.shippingMethod,
        destinationCountry,
        address: {
          line1: recipient.address.line1,
          line2: recipient.address.line2 ?? "",
          city: recipient.address.townOrCity,
          state: recipient.address.stateOrCounty ?? "",
          postalCode: recipient.address.postalOrZipCode,
        },
        couponCode: body.couponCode?.trim() ? normalizeCouponCode(body.couponCode) : null,
      };
      const loaded = await loadQuoteForCheckout({
        quoteId: typeof body.quoteId === "string" ? body.quoteId : "",
        uid,
        inputs: quoteInputs,
      });
      if (!loaded.ok) {
        // A double-click, not a price problem: say so without sending the dialog off to re-quote.
        if (loaded.reason === "in_progress") clientError(res, QUOTE_REFUSAL_MESSAGE.in_progress, 409);
        else priceChanged(res, QUOTE_REFUSAL_MESSAGE[loaded.reason]);
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
      // Only files the server rendered can be re-rendered at print resolution.
      const printPrep =
        body.fingerprint && sourceFileUrls.interior && sourceFileUrls.cover && !(body.assets?.length)
          ? {
              fingerprint: body.fingerprint,
              interiorKey: documentKey("interior"),
              coverKey: documentKey("cover", { sku: printSku, pages }),
              pages,
              printSku,
              baseSku: product.provider.sku,
            }
          : null;

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

      // The files are about to be sold as this order. Check they ARE this order —
      // page count, sheet size, cover size — while a mismatch is still a
      // "prepare it again" instead of a rejected job and a refund. A bad cached
      // render is dropped so the retry assembles a fresh one rather than
      // hitting the same file forever.
      // A file one or two sheets short is finished here rather than refused —
      // the blank pages the customer was told about are added at the end.
      sourceFileUrls.interior = await padInteriorToPages(sourceFileUrls.interior, pages);
      const fileProblems = await preflightPrintFiles({
        interiorUrl: sourceFileUrls.interior,
        coverUrl: sourceFileUrls.cover,
        printSku,
        baseSku: product.provider.sku,
        pages,
      });
      if (fileProblems.length > 0) {
        console.error(`[stripe] checkout blocked — print files don't match the order (${printSku}, ${pages}p): ${fileProblems.join("; ")}`);
        if (body.fingerprint) {
          await Promise.all([
            invalidateCachedDocument(uid, body.fingerprint, documentKey("interior")),
            invalidateCachedDocument(uid, body.fingerprint, documentKey("cover", { sku: printSku, pages })),
          ]);
        }
        void raiseAlert({
          severity: "warning",
          kind: "print_files_mismatch",
          ref: `${uid}_${printSku}_${pages}_${Date.now().toString(36)}`,
          message: `A customer's print files failed pre-payment verification (${printSku}, ${pages} pages): ${fileProblems[0]}`,
          meta: { uid, printSku, pages, problems: fileProblems },
        }).catch(() => undefined);
        clientError(
          res,
          "Your book needs to be prepared for printing again. Please close this and try ordering once more.",
        );
        return;
      }

      const result = await createPrintCheckout({
        uid,
        email: recipient.email ?? req.authToken?.email ?? null,
        device: checkoutDevice(req),
        product,
        variant,
        printSku,
        settings,
        quote: loaded.quote,
        copies,
        pages,
        currency,
        shippingMethod: body.shippingMethod,
        destinationCountry,
        recipient,
        addressConfirmed: body.addressConfirmed === true,
        addressChoice:
          body.addressChoice === "suggested" || body.addressChoice === "entered"
            ? body.addressChoice
            : undefined,
        sourceFileUrls,
        printPrep,
        merchantReference: body.merchantReference ?? null,
        foilStamp: body.foilStamp ?? null,
      });
      if (!result.ok) {
        if (result.priceChanged) priceChanged(res, result.error);
        else clientError(res, result.error, result.inProgress ? 409 : 400);
        return;
      }
      res.json({ url: result.url, paymentId: result.paymentId });
    } catch (err) {
      if (err instanceof PricingUnavailableError) {
        console.error("[stripe] checkout blocked — order is unpriceable:", err.message);
        clientError(res, err.clientMessage, 409);
        return;
      }
      await checkoutFailed(res, err, "print order");
    }
  });

  // The quote for the order dialog: the ONE place a print order's price is worked
  // out. Books, shipping, every discount (a typed code, referral, campaign, plan)
  // and the tax Stripe Tax computes for the delivery address — as integers that
  // add up — saved under an id. The dialog shows it verbatim and `/checkout`
  // charges it by that id, so the amount shown and the amount charged are the
  // same record rather than two calculations that must agree. Never exposes
  // wholesale/production costs to the client.
  app.post("/checkout/quote", json, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const body = (req.body ?? {}) as {
        productSku?: string;
        variant?: VariantSelection;
        copies?: number;
        pageCount?: number;
        shippingMethod?: ShippingMethod;
        destinationCountry?: string;
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        couponCode?: string;
      };
      if (!body.productSku || !body.city || !body.postalCode || !body.destinationCountry) {
        clientError(res, "A destination (city, postal code, country) is required.");
        return;
      }
      const destinationCountry = body.destinationCountry.trim().toUpperCase();
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
      // Derived from the DESTINATION, not taken from the client. Checkout charges
      // this quote, so the currency can't differ — and a client can't pick the
      // currency its book happens to be cheapest in.
      const currency = currencyForMarket(
        destinationCountry,
        settings.currencies,
        settings.baseCurrency,
      ) as CurrencyCode;
      // The client always sends a method; when it doesn't, quote the cheapest
      // tier that actually reaches THIS destination.
      const shippingMethod = body.shippingMethod ?? (await previewShippingMethod(product, destinationCountry));
      // The same refusal as checkout, so a customer in a closed market isn't shown
      // a real total and only turned away at "Continue to payment".
      const refusal = await shippingRefusal(product, {
        country: destinationCountry,
        region: body.state,
        method: shippingMethod,
        stage: "quote",
      });
      if (refusal) {
        clientError(res, refusal);
        return;
      }
      const copies = Math.max(1, Math.floor(body.copies || 1));
      // The same normalisation checkout applies, so the quote is for the length
      // that will actually be printed and charged.
      const quotePlan = planPageCount(
        Math.max(1, Math.floor(body.pageCount || product.conditions.pages.min)),
        product.conditions.pages,
      );
      if (quotePlan.status === "too-long") {
        clientError(
          res,
          `This product takes up to ${product.conditions.pages.max} pages — pick a binding that holds a longer book.`,
        );
        return;
      }
      const typedCode = body.couponCode?.trim() ? body.couponCode.trim() : null;
      // Typing codes is guessing codes: past the limit the code is simply not
      // looked at, and the price comes back without it.
      const codeThrottled = typedCode != null && couponAttemptsExhausted(uid);
      const quote = await buildPrintQuote({
        uid,
        product,
        variant,
        printSku,
        settings,
        activePlan: await resolveActivePlan(uid),
        copies,
        pages: quotePlan.printed,
        currency,
        shippingMethod,
        destinationCountry,
        address: {
          line1: body.line1,
          line2: body.line2 ?? null,
          townOrCity: body.city,
          stateOrCounty: body.state ?? null,
          postalOrZipCode: body.postalCode,
        },
        couponCode: codeThrottled ? null : typedCode,
      });
      // Only a REJECTED code counts against the throttle: re-quoting because the
      // address or copies changed, with a good code still in the box, is shopping.
      if (typedCode && !codeThrottled && quote.couponRejection && recordCouponAttempt(uid)) {
        quote.couponRejection = {
          reason: "throttled",
          message: "Too many attempts. Wait a few minutes and try again.",
        };
      }
      if (codeThrottled) {
        quote.couponRejection = {
          reason: "throttled",
          message: "Too many attempts. Wait a few minutes and try again.",
        };
      }
      if (quote.taxStatus === "not_collecting") {
        // Not an error for the customer — there is genuinely no tax to collect —
        // but it is for us if we're meant to be collecting here. One alert per
        // country per day, not one per keystroke.
        void raiseAlert({
          severity: "warning",
          kind: "tax_not_collecting",
          ref: `${destinationCountry}_${new Date().toISOString().slice(0, 10)}`,
          message:
            `An order to ${destinationCountry} was quoted with no tax because Stripe Tax holds no ` +
            `registration there. If tax is due, add the registration in Stripe.`,
          meta: { country: destinationCountry, reasons: quote.taxabilityReasons },
        }).catch(() => undefined);
      }
      await saveQuote(quote);
      res.json(quoteView(quote));
    } catch (err) {
      if (err instanceof PricingUnavailableError) {
        console.error("[stripe] quote blocked — order is unpriceable:", err.message);
        clientError(res, err.clientMessage, 409);
        return;
      }
      if (err instanceof TaxUnavailableError) {
        // Fail closed: a total with the tax missing is a wrong total.
        void raiseAlert({
          severity: "critical",
          kind: "tax_unavailable",
          ref: new Date().toISOString().slice(0, 13),
          message: `Print orders can't be priced: the tax calculation failed (${err.message}).`,
        }).catch(() => undefined);
        clientError(res, "We couldn't work out the tax for this address just now. Please try again in a moment.", 503);
        return;
      }
      console.error("[stripe] quote failed", err);
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

  // The same answer, plus the priced quote the dialog shows and checkout charges.
  // POST so a code the customer typed isn't written into a URL (and a log line).
  app.post("/checkout/ebook/quote", json, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const body = (req.body ?? {}) as { projectId?: string; currency?: string; couponCode?: string };
      const projectId = String(body.projectId ?? "").trim();
      if (!projectId) {
        clientError(res, "A project is required.");
        return;
      }
      const settings = await getPricingSettings();
      const currency = String(body.currency || settings.baseCurrency).toUpperCase() as CurrencyCode;
      if (!settings.currencies.includes(currency)) {
        clientError(res, `Currency ${currency} isn't supported.`);
        return;
      }
      const activePlan = await resolveActivePlan(uid);
      const ebook = await priceEbook(uid, projectId, currency, settings, activePlan);
      // Only something that can actually be paid for has a price to quote.
      let priceQuote = null;
      if (ebook.enabled && !ebook.owned && !ebook.included && ebook.price > 0) {
        const typed = body.couponCode?.trim() ? body.couponCode.trim() : null;
        const codeThrottled = typed != null && couponAttemptsExhausted(uid);
        const record = await buildDigitalQuote(
          { uid, kind: "ebook", subject: projectId, productId: "ebook", settings, currency, listPrice: ebook.price },
          codeThrottled ? null : typed,
        );
        const rejected = codeThrottled
          ? { reason: "throttled", message: "Too many attempts. Wait a few minutes and try again." }
          : typed && record.couponRejection && recordCouponAttempt(uid)
            ? { reason: "throttled", message: "Too many attempts. Wait a few minutes and try again." }
            : record.couponRejection;
        record.couponRejection = rejected;
        await saveDigitalQuote(record);
        priceQuote = digitalQuoteView(record);
      }
      res.json({ ...ebook, downloadUrl: null, priceQuote });
    } catch (err) {
      console.error("[stripe] ebook price quote failed", err);
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
        /** The quote the customer was shown. Charged as it is, or refused with `price_changed`. */
        quoteId?: string;
        /** The code that quote applied (or, with no quote, one the customer typed). Never trusted. */
        couponCode?: string;
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

      // Anything that has to be paid for is paid for at a quote. Settled BEFORE the
      // upload below, so a stale or foreign quote costs the customer a refreshed
      // price rather than a hosted PDF first.
      const payable = !(quote.included || quote.price <= 0 || quote.owned);
      const purchase: DigitalPurchase = {
        uid,
        kind: "ebook",
        subject: body.projectId,
        productId: "ebook",
        settings,
        currency,
        listPrice: quote.price,
      };
      let digital: DigitalQuoteRecord | null = null;
      if (payable) {
        const resolved = await resolveDigitalQuote(purchase, body.quoteId, body.couponCode ?? null);
        if (!resolved.ok) {
          respondDigitalFailure(res, resolved);
          return;
        }
        digital = resolved.quote;
      }

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
          ...checkoutDevice(req),
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
      // `digital` is set whenever the purchase is payable, which is the only way to be here.
      if (!digital) throw new Error("payable ebook without a quote");
      const reserved = await reserveDigitalQuote(purchase, digital, paymentId);
      if (!reserved.ok) {
        respondDigitalFailure(res, reserved);
        return;
      }
      const earned = reserved.earned;
      const lines = digital.lines;
      try {
        const customerId = await ensureCustomer(uid, req.authToken?.email ?? null);
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
                // Exactly the quote's books line — never worked out again here.
                unit_amount: lines.itemsMinor,
                tax_behavior: hasTax ? lines.taxBehavior : undefined,
                product_data: {
                  name: `${title} — digital edition (PDF)`,
                  description:
                    [
                      quote.planName ? `${quote.planName} member price.` : null,
                      quote.discountPct > 0
                        ? `Includes your ${quote.discountPct}% print-owner discount.`
                        : null,
                      earned ? `Discount applied: ${earned.summary}.` : null,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined,
                  tax_code: taxCode,
                },
              },
            },
          ],
          client_reference_id: paymentId,
          metadata: { paymentId, uid, kind: "ebook", quoteId: digital.id },
          payment_intent_data: {
            metadata: {
              paymentId,
              uid,
              kind: "ebook",
              quoteId: digital.id,
              ...(await affiliateChargeMetadata(uid, "ebook")),
            },
          },
          success_url: `${appBaseUrl()}/studio/${encodeURIComponent(body.projectId)}/order?ebook=success&payment=${paymentId}&project=${encodeURIComponent(body.projectId)}`,
          cancel_url: `${appBaseUrl()}/studio/${encodeURIComponent(body.projectId)}/order?ebook=cancel`,
        });
        if (!(await sessionMatchesDigitalQuote(session, digital, hasTax, paymentId))) {
          await abandonDigitalCheckout(paymentId, digital.id);
          priceChanged(res, "We couldn't confirm your final price just now. Nothing has been charged — please try again.");
          return;
        }

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
          amount: fromMinorUnits(lines.totalMinor, currency),
          currency,
          description: `${title} — digital edition`,
          stripeSessionId: session.id,
          stripeCustomerId: customerId,
          ebook,
          ...checkoutDevice(req),
          quote: digitalQuoteRecordMeta(digital, hasTax),
          items: [
            { label: `${title} — digital edition (PDF)`, amount: fromMinorUnits(lines.itemsMinor, currency), quantity: 1 },
          ],
        });
        await stampMilestone(uid, body.projectId, "checkoutStarted").catch(() => {});

        res.json({ url: session.url, paymentId });
        return;
      } catch (err) {
        await abandonDigitalCheckout(paymentId, digital.id);
        throw err;
      }
    } catch (err) {
      await checkoutFailed(res, err, "ebook", "We couldn't start the ebook checkout. Please try again.");
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
      // The files the first order was printed with, when they were print-resolution
      // ones (they differ from the checked-out files only then). Otherwise the
      // reorder gets its own chance at preparation, if the recipe still applies.
      const placed = previous.placedFileUrls;
      const reusePrinted =
        Boolean(placed?.interior && placed.cover) &&
        (placed!.interior !== plan.sourceFileUrls.interior || placed!.cover !== plan.sourceFileUrls.cover);
      const reorderFiles = reusePrinted ? placed! : plan.sourceFileUrls;
      const reorderPrep =
        !reusePrinted && plan.printPrep && plan.printPrep.printSku === printSku && plan.printPrep.pages === plan.pageCount
          ? plan.printPrep
          : null;
      // Re-derived rather than replayed: the stored currency can be one the
      // catalog has since stopped supporting, which would fail the reorder on
      // a price the customer never chose in the first place.
      const currency = currencyForMarket(
        plan.destinationCountry,
        settings.currencies,
        settings.baseCurrency,
      ) as CurrencyCode;
      const recipient = draftRecipient(plan.recipient);
      // A reorder has no price screen before the payment page, so its quote is
      // made and charged in one step: today's price, with no code. The payment
      // page then shows exactly that, tax included.
      const quote = await buildPrintQuote({
        uid,
        product,
        variant,
        printSku,
        settings,
        activePlan,
        copies,
        pages: plan.pageCount,
        currency,
        shippingMethod: plan.shippingMethod as ShippingMethod,
        destinationCountry: plan.destinationCountry,
        address: {
          line1: recipient.address.line1,
          line2: recipient.address.line2 ?? null,
          townOrCity: recipient.address.townOrCity,
          stateOrCounty: recipient.address.stateOrCounty ?? null,
          postalOrZipCode: recipient.address.postalOrZipCode,
        },
        couponCode: null,
      });
      await saveQuote(quote);
      const result = await createPrintCheckout({
        uid,
        email: plan.recipient.email ?? req.authToken?.email ?? null,
        device: checkoutDevice(req),
        product,
        variant,
        printSku,
        settings,
        quote,
        copies,
        pages: plan.pageCount,
        currency,
        shippingMethod: plan.shippingMethod as ShippingMethod,
        destinationCountry: plan.destinationCountry,
        recipient,
        sourceFileUrls: reorderFiles,
        printPrep: reorderPrep,
        merchantReference: plan.merchantReference ?? null,
        foilStamp: plan.foilStamp ?? null,
      });
      if (!result.ok) {
        clientError(
          res,
          result.error.startsWith("Review the carrier")
            ? "The carrier wants this saved address reviewed again. Open the book and use its order checkout to review the correction before paying."
            : result.error,
        );
        return;
      }
      res.json({ url: result.url, paymentId: result.paymentId });
    } catch (err) {
      if (err instanceof TaxUnavailableError) {
        clientError(res, "We couldn't work out the tax for this address just now. Please try again in a moment.", 503);
        return;
      }
      await checkoutFailed(res, err, "reorder");
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
        couponCode?: string;
      };

      // One live subscription per account: plan CHANGES go through the Customer
      // Portal (which upgrades/downgrades the existing subscription with
      // proration) instead of opening a second Checkout subscription.
      if (await hasActiveSubscription(uid)) {
        const portal = await openBillingPortal(uid);
        if ("url" in portal) {
          res.json({ url: portal.url, portal: true });
          return;
        }
        // Pointing them at the account menu only helps if the portal works from
        // there — which is the same call that just failed.
        clientError(
          res,
          portal.status === 404
            ? "You already have an active subscription. Manage it from your account menu."
            : portal.error,
          portal.status === 404 ? 400 : portal.status,
        );
        return;
      }

      const plansConfig = await getPlansConfig();
      let priceId = body.priceId?.trim() || "";
      if (!priceId && body.planId) {
        const plan = plansConfig.plans.find((p) => p.id === body.planId);
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

      // What's being discounted, resolved from the PRICE rather than from the
      // request. The back-compat raw-priceId path then gets exactly the same
      // coupon restrictions (minimum subtotal, currency, which plans qualify)
      // as the normal one, instead of a subtotal of zero that quietly passes
      // every minimum ever configured.
      const plan = resolvePlanByPriceId(plansConfig, priceId);
      const priced = plan ? pricePointForId(plan, priceId) : null;

      const customerId = await ensureCustomer(uid, req.authToken?.email);
      const subscriptionRef = randomUUID();
      // Membership is the one place a discount has to be a real Stripe coupon:
      // Stripe generates the invoice, so we can't just quote less. What that
      // coupon is WORTH is decided by the same resolver every other checkout
      // runs — which this route previously skipped, taking the referral perk
      // directly and never seeing a campaign offer or a typed code at all.
      const { applied: earned, codeRejection } = await earnedDiscount({
        uid,
        itemType: "plan",
        paymentId: subscriptionRef,
        settings: await getPricingSettings(),
        amount: priced?.point.amount ?? 0,
        couponCode: body.couponCode ?? null,
        currency: priced?.currency ?? (body.currency || "USD").toUpperCase(),
        productId: plan?.id ?? null,
      });
      if (codeRejection) {
        await releaseCoupons(subscriptionRef, `code refused: ${codeRejection.reason}`);
        clientError(res, codeRejection.message);
        return;
      }
      // The discount is one Stripe coupon regardless of how many sources won:
      // `earned.percentOff` is already the resolved total, and a stack split
      // across two coupon objects would double-apply on the same invoice.
      const stripeCouponId = earned
        ? await createSingleUseCoupon({
            percentOff: earned.percentOff,
            // A day is plenty: the coupon is minted for THIS checkout, and the
            // session itself expires within 24 hours.
            expiresAt: Date.now() + 86_400_000,
            name: earned.summary,
            source: "coupon",
          })
        : null;
      if (earned && !stripeCouponId) {
        // Reserved, then Stripe refused to hold it. Hand the coupon back so a
        // single-use code isn't burned on a discount nobody received. (A
        // referral or campaign reservation lapses on its own TTL, as it always
        // has when this path failed.)
        await releaseCoupons(subscriptionRef, "stripe coupon unavailable");
        if (body.couponCode?.trim()) {
          clientError(
            res,
            "We couldn't apply that code to a membership just now. Please try again in a minute.",
            503,
          );
          return;
        }
      }
      const discounted = Boolean(earned && stripeCouponId);
      // Tax configuration is binding. If Stripe Tax is not ready, checkout
      // fails rather than silently creating an untaxed subscription.
      const session = await createCheckoutSession({
        mode: "subscription",
        customer: customerId,
        customer_update: { address: "auto", name: "auto" },
        automatic_tax: { enabled: true },
        line_items: [{ price: priceId, quantity: 1 }],
        ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
        metadata: {
          uid,
          kind: "subscription",
          // The reservation ref, so the webhooks can settle — or hand back —
          // whatever this checkout is holding. Was `referralRef` when a referral
          // perk was the only thing that could win; the invoice hook still reads
          // that name for subscriptions stamped before this.
          ...(discounted ? { discountRef: subscriptionRef } : {}),
        },
        // Stamp uid on the subscription so invoice grants can attribute Sparks.
        // The affiliate flag rides on the SUBSCRIPTION rather than a charge so it
        // applies to every renewal invoice, not just the first one.
        subscription_data: {
          metadata: {
            uid,
            ...(discounted ? { discountRef: subscriptionRef } : {}),
            ...(await affiliateChargeMetadata(uid, "subscription")),
          },
        },
        success_url: `${appBaseUrl()}/studio?subscription=success`,
        cancel_url: `${appBaseUrl()}/studio?subscription=cancel`,
      });
      // Stripe prices a membership (and every renewal) itself, so there is no quote
      // to charge here. What we CAN do is hold Stripe to what we decided — the
      // plan's price and the discount we resolved — and say so loudly if it
      // disagrees. Alert-only: refusing a membership over a one-cent rounding
      // difference would cost more than it protects.
      if (priced && session.amount_subtotal != null) {
        try {
          const listMinor = toMinor(priced.point.amount, priced.currency);
          const expected = composeQuoteLines({
            currency: priced.currency,
            copies: 1,
            listUnitMinor: listMinor,
            listShippingMinor: 0,
            discount: discounted && earned ? { kind: "percent", percentOff: earned.percentOff } : null,
            taxBehavior: "exclusive",
            taxMinor: 0,
          });
          const stripeDiscount = session.total_details?.amount_discount ?? 0;
          if (session.amount_subtotal !== listMinor || Math.abs(stripeDiscount - expected.discountMinor) > 1) {
            void raiseAlert({
              severity: "warning",
              kind: "subscription_price_mismatch",
              ref: subscriptionRef,
              message:
                `A membership checkout was priced by Stripe at ${session.amount_subtotal} with ${stripeDiscount} off, ` +
                `but we expected ${listMinor} with ${expected.discountMinor} off (${priced.currency}).`,
              meta: { uid, planId: plan?.id ?? null, sessionId: session.id },
            }).catch(() => undefined);
          }
        } catch (err) {
          console.warn("[stripe] subscription price check failed", err);
        }
      }
      res.json({ url: session.url });
    } catch (err) {
      await checkoutFailed(res, err, "subscription");
    }
  });

  // What a Spark pack is being sold for, from the Sparks config — never from the
  // client, which only names a pack and a currency the pack is priced in.
  async function packSale(
    uid: string,
    rawPackId: unknown,
    rawCurrency: unknown,
  ): Promise<
    | { ok: true; pack: SparkPack; currency: CurrencyCode; purchase: DigitalPurchase; settings: PricingSettings }
    | { ok: false; error: string; status: number }
  > {
    const config = await getSparksConfig();
    if (!config.enabled) return { ok: false, error: "Spark purchases aren't available right now.", status: 503 };
    const pack = config.packs.find((p) => p.id === rawPackId && p.active);
    if (!pack) return { ok: false, error: "That Spark pack isn't available.", status: 400 };
    const currency = (String(rawCurrency || "USD")).toUpperCase() as CurrencyCode;
    const price = pack.prices[currency];
    if (typeof price !== "number" || price <= 0) {
      return { ok: false, error: `This pack isn't priced in ${currency}.`, status: 400 };
    }
    const settings = await getPricingSettings();
    return {
      ok: true,
      pack,
      currency,
      settings,
      // A gift prices exactly like the pack itself — the buyer could apply the
      // identical discount to a pack for themselves — so both share one quote.
      purchase: { uid, kind: "pack", subject: pack.id, productId: pack.id, settings, currency, listPrice: price },
    };
  }

  // The price of a Spark pack for this buyer, with any code they typed: the quote
  // the wallet shows, and the one `/checkout/sparks-pack` and `/checkout/sparks-gift`
  // charge by id.
  app.post("/checkout/sparks-pack/quote", json, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const body = (req.body ?? {}) as { packId?: string; currency?: string; couponCode?: string };
      const sale = await packSale(uid, body.packId, body.currency);
      if (!sale.ok) {
        clientError(res, sale.error, sale.status);
        return;
      }
      const typed = body.couponCode?.trim() ? body.couponCode.trim() : null;
      const codeThrottled = typed != null && couponAttemptsExhausted(uid);
      const record = await buildDigitalQuote(sale.purchase, codeThrottled ? null : typed);
      if (codeThrottled || (typed && record.couponRejection && recordCouponAttempt(uid))) {
        record.couponRejection = {
          reason: "throttled",
          message: "Too many attempts. Wait a few minutes and try again.",
        };
      }
      await saveDigitalQuote(record);
      res.json(digitalQuoteView(record));
    } catch (err) {
      console.error("[stripe] pack quote failed", err);
      clientError(res, "We couldn't price this pack.", 500);
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
      const body = (req.body ?? {}) as {
        packId?: string;
        currency?: string;
        /** The quote the buyer was shown, when they were shown one. */
        quoteId?: string;
        couponCode?: string;
      };
      const sale = await packSale(uid, body.packId, body.currency);
      if (!sale.ok) {
        clientError(res, sale.error, sale.status);
        return;
      }
      const { pack, currency, purchase, settings } = sale;
      const totalSparks = packTotalSparks(pack);
      // The quote they were shown — or, from the one-click buttons that never show
      // one, a quote made right now by the very same code.
      const resolved = await resolveDigitalQuote(purchase, body.quoteId, body.couponCode ?? null);
      if (!resolved.ok) {
        respondDigitalFailure(res, resolved);
        return;
      }
      const digital = resolved.quote;
      const lines = digital.lines;
      const paymentId = randomUUID();
      const reserved = await reserveDigitalQuote(purchase, digital, paymentId);
      if (!reserved.ok) {
        respondDigitalFailure(res, reserved);
        return;
      }
      const earned = reserved.earned;
      try {
        const customerId = await ensureCustomer(uid, req.authToken?.email);
        const taxCode = settings.tax.sparkTaxCode;
        const hasTax = Boolean(taxCode);
        // Buying for a specific action: hold its price, and come back ready to start it.
        const resumeQuoteId = (req.body as { resumeQuoteId?: unknown })?.resumeQuoteId;
        const quoteExpiresAt =
          typeof resumeQuoteId === "string"
            ? await holdQuoteForCheckout(uid, resumeQuoteId).catch(() => null)
            : null;
        const resume = quoteExpiresAt ? `&draw=${encodeURIComponent(resumeQuoteId as string)}` : "";
        const session = await createCheckoutSession({
          mode: "payment",
          customer: customerId,
          // Stripe Tax needs the buyer's address to rate a digital sale; it asks
          // for it on its own page. Without a configured tax code nothing changes.
          ...(hasTax
            ? {
                customer_update: { address: "auto" as const, name: "auto" as const },
                billing_address_collection: "required" as const,
                automatic_tax: { enabled: true },
              }
            : {}),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: lines.itemsMinor,
                tax_behavior: hasTax ? lines.taxBehavior : undefined,
                product_data: {
                  name: `${totalSparks} Sparks (${pack.label})`,
                  description: earned ? `Discount applied: ${earned.summary}.` : undefined,
                  tax_code: taxCode,
                },
              },
            },
          ],
          client_reference_id: paymentId,
          metadata: {
            paymentId,
            uid,
            kind: "sparkPack",
            packId: pack.id,
            sparks: String(totalSparks),
            quoteId: digital.id,
          },
          payment_intent_data: {
            metadata: {
              paymentId,
              uid,
              kind: "sparkPack",
              packId: pack.id,
              sparks: String(totalSparks),
              quoteId: digital.id,
              ...(await affiliateChargeMetadata(uid, "sparkPack")),
            },
          },
          // A purchase started from a book returns to that book, where the action
          // the reader was about to take is still waiting.
          success_url: `${appBaseUrl()}${sparkReturnPath(req.body)}?sparks=success&payment=${paymentId}${resume}`,
          cancel_url: `${appBaseUrl()}${sparkReturnPath(req.body)}?sparks=cancel`,
        });
        if (!(await sessionMatchesDigitalQuote(session, digital, hasTax, paymentId))) {
          await abandonDigitalCheckout(paymentId, digital.id);
          priceChanged(res, "We couldn't confirm your final price just now. Nothing has been charged — please try again.");
          return;
        }
        await createPendingPayment({
          paymentId,
          uid,
          kind: "sparkPack",
          amount: fromMinorUnits(lines.totalMinor, currency),
          currency,
          description: `${totalSparks} Sparks`,
          stripeSessionId: session.id,
          stripeCustomerId: customerId,
          ...checkoutDevice(req),
          quote: digitalQuoteRecordMeta(digital, hasTax),
          items: [
            { label: `${totalSparks} Sparks`, amount: fromMinorUnits(lines.itemsMinor, currency), quantity: 1 },
          ],
        });
        res.json({ url: session.url, paymentId, ...(quoteExpiresAt ? { quoteExpiresAt } : {}) });
      } catch (err) {
        await abandonDigitalCheckout(paymentId, digital.id);
        throw err;
      }
    } catch (err) {
      await checkoutFailed(res, err, "sparks pack");
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
        quoteId?: string;
        couponCode?: string;
      };
      // Same `pack` scope the direct top-up uses: a gift is still a Spark pack
      // purchase, and the wallet promises earned discounts "apply automatically
      // at checkout" without carving out gifts.
      const sale = await packSale(uid, body.packId, body.currency);
      if (!sale.ok) {
        clientError(res, sale.error, sale.status);
        return;
      }
      const { pack, currency, purchase, settings } = sale;
      const totalSparks = packTotalSparks(pack);
      const resolved = await resolveDigitalQuote(purchase, body.quoteId, body.couponCode ?? null);
      if (!resolved.ok) {
        respondDigitalFailure(res, resolved);
        return;
      }
      const digital = resolved.quote;
      const lines = digital.lines;
      const paymentId = randomUUID();
      const giftCode = newGiftCode();
      const reserved = await reserveDigitalQuote(purchase, digital, paymentId);
      if (!reserved.ok) {
        respondDigitalFailure(res, reserved);
        return;
      }
      const earned = reserved.earned;
      try {
        const customerId = await ensureCustomer(uid, req.authToken?.email);
        const taxCode = settings.tax.sparkTaxCode;
        const hasTax = Boolean(taxCode);
        const meta = {
          paymentId,
          uid,
          kind: "sparkGift",
          packId: pack.id,
          sparks: String(totalSparks),
          giftCode,
          recipientEmail: (body.recipientEmail ?? "").slice(0, 200),
          giftMessage: (body.message ?? "").slice(0, 300),
          quoteId: digital.id,
        };
        const session = await createCheckoutSession({
          mode: "payment",
          customer: customerId,
          ...(hasTax
            ? {
                customer_update: { address: "auto" as const, name: "auto" as const },
                billing_address_collection: "required" as const,
                automatic_tax: { enabled: true },
              }
            : {}),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: lines.itemsMinor,
                tax_behavior: hasTax ? lines.taxBehavior : undefined,
                product_data: {
                  name: `Gift: ${totalSparks} Sparks (${pack.label})`,
                  description: earned ? `Discount applied: ${earned.summary}.` : undefined,
                  tax_code: taxCode,
                },
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
        if (!(await sessionMatchesDigitalQuote(session, digital, hasTax, paymentId))) {
          await abandonDigitalCheckout(paymentId, digital.id);
          priceChanged(res, "We couldn't confirm your final price just now. Nothing has been charged — please try again.");
          return;
        }
        await createPendingPayment({
          paymentId,
          uid,
          kind: "sparkGift",
          amount: fromMinorUnits(lines.totalMinor, currency),
          currency,
          description: `Gift: ${totalSparks} Sparks`,
          stripeSessionId: session.id,
          stripeCustomerId: customerId,
          ...checkoutDevice(req),
          quote: digitalQuoteRecordMeta(digital, hasTax),
          items: [
            { label: `Gift: ${totalSparks} Sparks`, amount: fromMinorUnits(lines.itemsMinor, currency), quantity: 1 },
          ],
        });
        res.json({ url: session.url, paymentId, giftCode });
      } catch (err) {
        await abandonDigitalCheckout(paymentId, digital.id);
        throw err;
      }
    } catch (err) {
      await checkoutFailed(res, err, "sparks gift");
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
      // is where the referral program and the campaign engine learn it too.
      // Idempotent downstream.
      if (verified) {
        await onReferralEvent(req.uid!, "email_verified");
        await onCampaignEvent(req.uid!, "email_verified");
      }
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
      const portal = await openBillingPortal(req.uid!);
      if (!("url" in portal)) {
        clientError(res, portal.error, portal.status);
        return;
      }
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
 * The buyer's account email, for the print job's contact address when the
 * recipient (often somebody else) left theirs blank. Never throws.
 */
async function accountEmailFor(uid: string): Promise<string | null> {
  if (!uid) return null;
  try {
    ensureAdmin();
    return (await getAuth().getUser(uid)).email?.trim() || null;
  } catch (err) {
    console.warn("[stripe] could not read account email", uid, err);
    return null;
  }
}

/**
 * Make sure the order record exists and knows the order is paid. Idempotent: the
 * "paid" event is written once, so webhook redeliveries and the safety-net events
 * all converge on the same record.
 */
async function recordPaidOrder(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  await syncOrderFromPayment(
    payment,
    { type: "paid", source: "stripe", message: "Payment received" },
    undefined,
    { dedupeId: "paid" },
  );
}

/**
 * Tell the customer their order is in — but only once it really is. This used to
 * go out straight after the placement attempt whether or not it worked, so a
 * customer whose order had failed was told it was confirmed (and, with the email's
 * once-only dedupe, never told anything better). Called after every successful
 * placement: the first try, a retry, a replacement of a rejected job.
 */
export async function sendConfirmationIfPlaced(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  if (!payment || payment.kind !== "order") return;
  if (!payment.orderId || payment.fulfillmentState !== "placed") return;
  try {
    const sent = await sendOrderConfirmationEmail({
      uid: payment.ownerUid,
      orderRef: payment.orderId,
      itemLabel: "Your custom picture book",
      paymentId,
    });
    await recordOrderEmail(paymentId, "confirmation", sent);
  } catch (err) {
    console.warn("[stripe] order confirmation email failed", paymentId, err);
    await recordOrderEmail(paymentId, "confirmation", { ok: false, error: (err as Error)?.message ?? "error" });
  }
}

/**
 * Place the print order for a PAID payment, exactly once. Builds the order from
 * the stored fulfillment plan (with already-hosted file URLs) and persists the
 * neutral + admin order records, then links the order id onto the payment.
 */
export async function fulfillPaidOrder(paymentId: string): Promise<void> {
  const payment = await getAdminPayment(paymentId);
  if (!payment || !payment.fulfillment) return;
  if (payment.orderId) return;
  // Money already went back to the customer; never print a refunded order.
  if (payment.status === "refunded") return;

  // Print-resolution files may still be on their way. Waiting is bounded by a
  // deadline the gate enforces itself; past it (or on any doubt) this answers
  // with the files verified at checkout. Never throws.
  const files = await printFilesForPlacement(payment);
  if (files.wait) return;

  const claimed = await claimFulfillment(paymentId);
  if (!claimed) return; // a concurrent/retry webhook already took it

  const plan = payment.fulfillment;
  const placementKey = placementKeyFor(paymentId, payment.rejectedOrderIds.length);
  const draft: OrderDraft = {
    productSku: plan.productSku,
    copies: plan.copies,
    recipient: draftRecipient(plan.recipient),
    shippingMethod: plan.shippingMethod as ShippingMethod,
    assets: [],
    sourceFileUrls: files.files,
    destinationCountry: plan.destinationCountry,
    currency: plan.currency,
    merchantReference: plan.merchantReference ?? undefined,
    idempotencyKey: placementKey,
    foilStamp: plan.foilStamp ?? undefined,
  };

  await syncOrderFromPayment(
    payment,
    {
      type: "placing",
      source: "fulfillment",
      message:
        payment.rejectedOrderIds.length > 0
          ? `Placing replacement job ${payment.rejectedOrderIds.length}`
          : `Placing order (attempt ${payment.fulfillmentAttempts + 1})`,
      data: { placementKey },
    },
    // `autoReplacing` is deliberately left as it is: while a replacement for a
    // rejected job is being placed, the order is "retrying", not "rejected".
    { fulfillmentState: "placing" },
    { silent: true },
  );

  try {
    // The provider needs a contact address. Plans created before the checkout
    // started defaulting it have none, so fill it from the buyer's account here.
    if (!draft.recipient.email?.trim()) {
      draft.recipient.email = (await accountEmailFor(payment.ownerUid)) ?? undefined;
    }

    // A Checkout Session may remain open while an admin closes its market.
    // Re-check at the last pre-press boundary. Because payment has already been
    // captured here, a refusal must be paired with an idempotent full refund.
    const destination = plan.destinationCountry.trim().toUpperCase();
    const registry = await getMarketRegistry();
    if (!registry.enabled.has(destination)) {
      // A previous worker may have lost Lulu's create response before it could
      // persist the order. Recover that job first; refunding now would leave a
      // real print job running with no captured payment.
      const provider = fulfillmentProvider();
      const recovered = provider.findOrderByIdempotencyKey
        ? await provider.findOrderByIdempotencyKey(placementKey)
        : null;
      if (recovered) {
        const cfg = serverConfig();
        await persistCreatedOrder({
          uid: payment.ownerUid,
          provider: "lulu",
          env: cfg.fulfillment.lulu.env,
          paymentId,
          estimatedCost: plan.estimatedCost ?? null,
          addressChoice: plan.addressChoice ?? null,
          draft,
          order: recovered,
        });
        await updatePayment({
          paymentId,
          uid: payment.ownerUid,
          orderId: recovered.id,
          event: "order.recovered",
          fulfillmentState: "placed",
          placedFileUrls: files.files,
        });
        return;
      }
      if (!payment.stripePaymentIntentId) {
        throw new Error(`Paid payment ${paymentId} has no PaymentIntent to refund.`);
      }
      await getStripe().refunds.create(
        { payment_intent: payment.stripePaymentIntentId },
        { idempotencyKey: `closed-market-${paymentId}` },
      );
      await updatePayment({
        paymentId,
        uid: payment.ownerUid,
        status: "refunded",
        refundedAmount: payment.amount,
        event: "fulfillment.market_closed_refund",
        fulfillmentState: "failed",
      });
      await syncOrderFromPayment(
        await getAdminPayment(paymentId),
        {
          type: "refund",
          source: "fulfillment",
          message: `Refunded in full: ${destination} was closed before the order could be placed`,
        },
      );
      await raiseAlert({
        severity: "warning",
        kind: "fulfillment.marketClosed",
        message: `Payment ${paymentId} was refunded because ${destination} closed before print placement.`,
        meta: { paymentId, uid: payment.ownerUid, destination },
        ref: paymentId,
      });
      return;
    }

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
      addressChoice: plan.addressChoice ?? null,
      draft,
      order,
    });
    await updatePayment({
      paymentId,
      uid: payment.ownerUid,
      orderId: order.id,
      event: files.printResolution ? "order.placed.print_resolution" : "order.placed",
      fulfillmentState: "placed",
      placedFileUrls: files.files,
    });
    // A correction appearing HERE usually means something slipped through — the
    // provider may hold the job for manual confirmation while the customer is
    // already charged. The customer sees it on their order; this is so a human
    // does too.
    //
    // The exception is a customer who was shown this very correction at checkout
    // and chose to keep their own address: the provider repeating itself is
    // expected, not a fault, so it is logged at "info" rather than paged as a
    // warning on every such order.
    const warnings = order.addressValidation?.warnings ?? [];
    if (warnings.length > 0 || order.addressValidation?.suggested) {
      const keptOwn = plan.addressChoice === "entered";
      await raiseAlert({
        severity: keptOwn ? "info" : "warning",
        kind: "fulfillment.addressCorrected",
        message:
          `Print order ${order.id} (payment ${paymentId}) was accepted with an address correction` +
          (keptOwn ? " (the customer kept their own address at checkout): " : ": ") +
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
    // The provider's own explanation lives in `details`; the message alone is
    // just "request failed with status 400".
    const details = err instanceof FulfillmentError && err.details ? ` — ${err.details.slice(0, 600)}` : "";
    const message = `${(err as Error)?.message ?? "Unknown fulfillment error"}${details}`;
    console.error("[stripe] fulfillment after payment failed", paymentId, err);
    const attempt = payment.fulfillmentAttempts + 1;
    // A request the provider refused as invalid will be refused identically on
    // every retry; five of them over five hours only delayed telling anyone.
    const permanent = err instanceof FulfillmentError && err.kind === "validation";
    const fixable = customerFixableDetail(err);
    const customerFix = fixable
      ? fixable === "taxId"
        ? (TAX_ID_LABEL[plan.recipient.address.countryCode?.toUpperCase() ?? ""] ?? CUSTOMER_FIX_LABEL.taxId)
        : CUSTOMER_FIX_LABEL[fixable]
      : null;
    const exhausted = permanent || attempt >= MAX_FULFILLMENT_ATTEMPTS;
    await markFulfillmentFailed({
      paymentId,
      uid: payment.ownerUid,
      error: message,
      exhausted,
      customerFix,
    });
    // The order record decides whether this needs a person (and pages #ops when it
    // does). This alert stays as the audit entry: one per ORDER, not one per
    // attempt, so five failed retries are one line, not five.
    const afterFailure = await getAdminPayment(paymentId);
    await syncOrderFromPayment(
      afterFailure,
      {
        type: "placement_failed",
        source: "fulfillment",
        message: (permanent
          ? `Placement refused by the printer (not retried${customerFix ? `; customer asked for the correct ${customerFix}` : ""}): ${message}`
          : `Placement failed (attempt ${attempt} of ${MAX_FULFILLMENT_ATTEMPTS}): ${message}`
        ).slice(0, 1000),
        data: { attempt, placementKey, permanent, customerFix },
      },
      // Out of retries: nothing is replacing the dead job any more.
      afterFailure?.fulfillmentState === "failed" ? { autoReplacing: false } : undefined,
    );
    await raiseAlert({
      // Nothing automatic will fix a refused request, so it pages.
      severity: permanent ? "critical" : "warning",
      kind: permanent ? "fulfillment.refused" : "fulfillment.failed",
      message: permanent
        ? `Print order for paid payment ${paymentId} was refused by the printer and won't be retried` +
          `${customerFix ? ` (customer emailed for the correct ${customerFix}; fix it with "Correct recipient")` : ""}: ${message}`
        : `Print order for paid payment ${paymentId} failed (attempt ${attempt}): ${message}`,
      meta: { paymentId, uid: payment.ownerUid, attempt, permanent },
      ref: paymentId,
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
    // Once retries are exhausted (or pointless), tell the customer — naming the
    // detail to correct when it's theirs. Deduped on the payment id so it goes
    // out at most once. Best-effort.
    if (exhausted) {
      try {
        const sent = await sendOrderFailedEmail({
          uid: payment.ownerUid,
          orderRef: payment.orderId ?? paymentId,
          paymentId,
          ...(customerFix ? { fix: customerFix } : {}),
        });
        await recordOrderEmail(paymentId, "failed", sent);
      } catch (mailErr) {
        console.warn("[stripe] order_failed email failed", paymentId, mailErr);
        await recordOrderEmail(paymentId, "failed", { ok: false, error: (mailErr as Error)?.message ?? "error" });
      }
    }
  }
}

const MAX_FULFILLMENT_ATTEMPTS = 5;

/**
 * Refund whatever is left of a payment. Idempotent per payment, so a repeated
 * click (or a retried request) can't refund twice. The webhook records the
 * result on the payment as for any other refund.
 */
export async function refundRemaining(
  payment: AdminPaymentRecord,
): Promise<{ refundId: string; amount: number; currency: string }> {
  if (!payment.stripePaymentIntentId) throw new Error("This payment has no captured charge to refund.");
  const refund = await getStripe().refunds.create(
    { payment_intent: payment.stripePaymentIntentId, metadata: { reason: "order_cancelled", paymentId: payment.id } },
    { idempotencyKey: `order_cancel_refund_${payment.id}` },
  );
  return { refundId: refund.id, amount: toMajor(refund.amount, refund.currency), currency: refund.currency.toUpperCase() };
}

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
      // The customer was never told the order was in, because it wasn't.
      await sendConfirmationIfPlaced(p.id);
    }
  }
  return placed;
}

/**
 * Paid orders that never started placing. The payment settled, but the webhook
 * handler died or timed out before it claimed the order — so there is no failure
 * record, nothing for the retry sweep to find, and the customer has paid for
 * nothing until somebody notices. Re-drives them.
 */
export async function retryStrandedFulfillments(): Promise<number> {
  const stranded = (await listStrandedPaidOrders(10 * 60_000)).slice(0, 20);
  let redriven = 0;
  for (const p of stranded) {
    await recordPaidOrder(p.id);
    await fulfillPaidOrder(p.id);
    await sendConfirmationIfPlaced(p.id);
    redriven += 1;
  }
  return redriven;
}

/**
 * Checkouts that are still "pending" here but may already be paid at Stripe — a
 * webhook we never received (an outage on our side, a misconfigured endpoint, a
 * rotated signing secret). Without this, the customer's card is charged and
 * nothing in our system ever finds out.
 *
 * For each one old enough to have settled, ask Stripe. A paid session is replayed
 * through the very same handler the webhook uses (it is idempotent on the payment
 * id), and a critical alert is raised, because a missed webhook is a symptom with
 * a cause that needs fixing.
 */
export async function reconcilePendingCheckouts(): Promise<{ checked: number; healed: number }> {
  if (!stripeConfigured()) return { checked: 0, healed: 0 };
  const pending = (await listPendingOrderCheckouts(20 * 60_000, 7 * 86_400_000)).slice(0, 50);
  let healed = 0;
  for (const p of pending) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(p.stripeSessionId);
      if (session.payment_status === "paid") {
        await handleEvent({
          id: `reconcile_${p.id}`,
          type: "checkout.session.completed",
          data: { object: session },
        } as unknown as Stripe.Event);
        const piId =
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (piId) {
          const pi = await getStripe().paymentIntents.retrieve(piId);
          await handleEvent({
            id: `reconcile_pi_${p.id}`,
            type: "payment_intent.succeeded",
            data: { object: pi },
          } as unknown as Stripe.Event);
        }
        healed += 1;
        await raiseAlert({
          severity: "critical",
          kind: "stripe.webhook_missed",
          message:
            `Payment ${p.id} was PAID at Stripe but we never received the webhook. ` +
            "It has been processed now — but check Stripe → Developers → Webhooks for failing " +
            "deliveries, and that the signing secret matches.",
          meta: { paymentId: p.id, uid: p.ownerUid, sessionId: p.stripeSessionId },
          ref: p.id,
        });
      } else if (session.status === "expired") {
        await handleEvent({
          id: `reconcile_exp_${p.id}`,
          type: "checkout.session.expired",
          data: { object: session },
        } as unknown as Stripe.Event);
      }
    } catch (err) {
      console.warn("[stripe] pending checkout reconcile failed", p.id, err);
    }
  }
  return { checked: pending.length, healed };
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
      let invoiceNumber = 0;
      if (subscriptionId) {
        invoiceNumber = await onSubscriptionInvoicePaid({
          uid,
          subscriptionId,
          invoiceId: invoice.id,
          amount: gross,
        });
      }
      // `subtotal` is the invoice BEFORE the coupon, so it's what the discount
      // actually cost us — `amount_paid` is what's left after it. `referralRef`
      // is the old name for this same ref, still stamped on every subscription
      // created before a campaign offer or a typed code could win a membership
      // discount; both are read so those keep settling.
      const discountRef =
        (typeof subMeta?.discountRef === "string" ? subMeta.discountRef : "") ||
        (typeof subMeta?.referralRef === "string" ? subMeta.referralRef : "");
      if (discountRef) {
        const discountCost = toMajor(invoice.subtotal ?? 0, currency);
        await finalizeDiscountsForPayment(discountRef, discountCost);
        await finalizeCampaignDiscounts(discountRef, discountCost);
      }

      // Campaign triggers for membership, keyed on the SAME invoice count the
      // referral hook just derived — see `onSubscriptionInvoicePaid`. Counting it
      // separately here would give `nthInvoice` rules a second chance to
      // disagree with themselves.
      if (invoice.id) {
        await onCampaignEvent(uid, invoiceNumber > 1 ? "subscription_renewed" : "subscription_started", {
          ref: invoice.id,
          amount: gross,
          itemType: "plan",
          productId: plan.id,
          invoiceNumber,
        });
        await finalizeCampaignDiscounts(invoice.id, toMajor(invoice.subtotal ?? 0, currency));
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
        // Signature-verified against this environment's webhook secret, so the
        // active env is the one that minted this customer.
        await saveStripeCustomerId(uid, customerId, activeBillingEnv()).catch(() => {});
      }

      if (kind === "subscription") {
        // Subscription details arrive via customer.subscription.* events; the
        // recurring Spark grant happens on invoice.paid.
        //
        // A coupon, though, is settled HERE rather than waiting for the invoice
        // like the referral reward does. The two need different things: the
        // reward is priced off the invoice subtotal, so it can't be booked
        // until there is one, while a coupon's discount was frozen the moment
        // it was reserved. Settling at the earliest honest point is what keeps
        // "you have 1 use left" true while the customer is still on the
        // thank-you page.
        const discountRef = (session.metadata?.discountRef as string) || "";
        // "unpaid" is a subscription whose first invoice hasn't cleared; the
        // coupon stays reserved and lapses if it never does. Everything else,
        // including the 100%-off case Stripe marks `no_payment_required`, is a
        // discount that has been applied.
        if (discountRef && uid && session.payment_status !== "unpaid") {
          await settleCouponsForPurchase({
            uid,
            paymentId: discountRef,
            amount:
              session.amount_total != null ? toMajor(session.amount_total, session.currency ?? "usd") : 0,
            currency: session.currency ?? "",
            itemLabel: purchaseLabel("subscription"),
          });
        }
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
        // Prove Stripe took what the customer was quoted. Creation already checks
        // the session's total, so a difference here means something changed it in
        // between — which has to be loud, not silent, because the customer has paid.
        if (kind === "order" || kind === "ebook" || kind === "sparkPack" || kind === "sparkGift") {
          const quoted = await getPaymentQuote(paymentId);
          if (quoted) {
            const tax = session.total_details?.amount_tax ?? 0;
            const total = session.amount_total ?? 0;
            // Where Stripe Tax rates the sale on its own page, the tax is Stripe's
            // to add and what we can hold it to is the part before tax. Elsewhere
            // the total and the tax are both ours.
            const differs =
              quoted.taxDeferred && quoted.subtotalMinor != null
                ? (quoted.taxBehavior === "inclusive" ? total : total - tax) !== quoted.subtotalMinor
                : total !== quoted.totalMinor || tax !== quoted.taxMinor;
            if (differs) {
              await raiseAlert({
                severity: "critical",
                kind: "payment_differs_from_quote",
                ref: paymentId,
                message:
                  `A ${kind} payment was ${total} (tax ${tax}) ` +
                  `but the customer was quoted ${quoted.totalMinor} (tax ${quoted.taxMinor}) ${(session.currency ?? "").toUpperCase()}.`,
                meta: { paymentId, uid, quoteId: quoted.id, sessionId: session.id, taxDeferred: quoted.taxDeferred ?? false },
              });
            }
          }
        }
        // The session's `amount_total` (and the PI gross recorded as revenue on
        // payment_intent.succeeded) includes the tax Stripe Tax collected —
        // owed to the authority, not revenue. Book it as a cost line here, the
        // one event that carries the tax split. Idempotent on the paymentId.
        const taxMinor = session.total_details?.amount_tax ?? 0;
        if (taxMinor > 0) {
          const cur = (session.currency ?? "usd").toUpperCase();
          // Carry the same project and product the charge's revenue and fee
          // carry. Without them the tax was invisible to per-book and
          // per-product nets, which then read higher than the cash really was.
          const taxPayment = await getAdminPayment(paymentId);
          const taxDims = await paymentDimensions(
            (kind as PaymentKind) ?? "order",
            taxPayment,
            session.metadata,
          );
          await recordTaxRemitted({
            category: kind === "order" || kind === "ebook" ? "books" : "sparks",
            uid,
            projectId:
              taxPayment?.fulfillment?.merchantReference ?? taxPayment?.ebook?.projectId ?? undefined,
            productId: taxDims.productId,
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
          await recordPaidOrder(paymentId);
          await fulfillPaidOrder(paymentId);
          await sendConfirmationIfPlaced(paymentId);
        }
        // Any money at all counts as the referred user's first purchase. Safe to
        // call on every purchase: a reward exists once per invitation, rule and
        // side, so the second purchase can't re-pay. Also settles the earned
        // discount (if any) that this payment consumed.
        await onReferralEvent(uid, "first_purchase", { ref: paymentId, amount: gross });
        await finalizeDiscountsForPayment(paymentId);
        await notifyCampaignsOfPurchase({
          uid,
          paymentId,
          kind,
          amount: gross,
          productId: (session.metadata?.productId as string) || undefined,
        });
        await settleCouponsForPurchase({
          uid,
          paymentId,
          amount: gross ?? 0,
          currency: session.currency ?? "",
          itemLabel: purchaseLabel(kind),
        });
      }
      return;
    }

    // The buyer abandoned Checkout and Stripe closed the session. Without this,
    // the payment document sits "pending" forever and shows up in the user's
    // receipts as a purchase that never resolves.
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      // A membership session has no payment document of its own — Stripe raises
      // that invoice — so there's nothing to mark failed, but the coupon it was
      // holding still has to come back.
      if (session.metadata?.kind === "subscription") {
        const discountRef = (session.metadata?.discountRef as string) || "";
        if (discountRef) await releaseCoupons(discountRef, "checkout.session.expired");
        return;
      }
      const paymentId = (session.metadata?.paymentId as string) || session.client_reference_id || "";
      const uid = (session.metadata?.uid as string) || "";
      if (!paymentId || !uid) return;
      const payment = await getAdminPayment(paymentId);
      // A session can expire AFTER it was paid via a delayed method; never walk
      // a settled payment backwards.
      if (!payment || payment.status !== "pending") return;
      await updatePayment({ paymentId, uid, status: "failed", event: "checkout.session.expired" });
      // Hand every held coupon back. Without this the reservation only lapses
      // after its TTL, which for a single-use code means the person holding it
      // is told "already used" for half an hour after walking away from a
      // checkout they never completed.
      await releaseCoupons(paymentId, "checkout.session.expired");
      return;
    }

    // The customer was deleted in Stripe. Forget the id so the next checkout
    // mints a replacement instead of failing on an id that can't come back.
    case "customer.deleted": {
      const customer = event.data.object as Stripe.Customer;
      const uid = (customer.metadata?.uid as string) || (await findUidByCustomerId(customer.id));
      if (uid) await forgetStripeCustomerId(uid, customer.id).catch(() => {});
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

      // Attribute the sale to the device checkout was started on. Read back off
      // the payment record rather than this request, because this request is
      // Stripe's — see `checkoutDevice`.
      if (payment?.device) {
        await recordDevicePurchase({
          uid: uid ?? null,
          ref: paymentId,
          device: payment.device,
          revenueUsd: await toUsd(gross, pi.currency),
        });
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
        await recordPaidOrder(paymentId);
        await fulfillPaidOrder(paymentId);
        await sendConfirmationIfPlaced(paymentId);
      }
      await onReferralEvent(uid, "first_purchase", { ref: paymentId, amount: gross });
      await finalizeDiscountsForPayment(paymentId);
      await notifyCampaignsOfPurchase({
        uid,
        paymentId,
        kind,
        amount: gross,
        productId: (pi.metadata?.productId as string) || undefined,
      });
      await settleCouponsForPurchase({
        uid,
        paymentId,
        amount: gross,
        currency: pi.currency ?? "",
        itemLabel: purchaseLabel(kind),
      });

      // Celebratory ping (#growth). Deduped on the paymentId so a webhook retry
      // (or the checkout.session.completed safety-net) can't double-post.
      const [buyer, bookTitle] = await Promise.all([
        getUserSlackIdentity(uid),
        payment?.ebook?.title
          ? Promise.resolve(payment.ebook.title)
          : getProjectTitle(uid, projectId),
      ]);
      const estCost = payment?.fulfillment?.estimatedCost ?? null;
      const netAfterCosts =
        kind === "order" &&
        estCost &&
        estCost.currency.toUpperCase() === (pi.currency ?? "").toUpperCase()
          ? (fin.net ?? gross) - estCost.amount
          : null;
      const sparksBought = Number(pi.metadata?.sparks ?? 0) || null;
      await notifySlack({
        channel: "growth",
        messageKey: "purchase",
        ref: `purchase_${paymentId}`,
        text: formatPurchaseSlackMessage({
          kind,
          gross,
          currency: pi.currency,
          netAfterCosts,
          itemDescription: payment?.description ?? null,
          pageCount: payment?.fulfillment?.pageCount ?? null,
          bookTitle,
          sparks: sparksBought,
          recipientEmail: (pi.metadata?.recipientEmail as string) || null,
          buyerEmail: buyer.email,
          billingCountry: fin.country ?? buyer.country,
          destinationCountry: dims.destinationCountry ?? null,
          orderNumber: buyer.purchaseCount,
        }),
      });
      return;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentId = (pi.metadata?.paymentId as string) || "";
      const uid = (pi.metadata?.uid as string) || "";
      if (!paymentId || !uid) return;
      await updatePayment({ paymentId, uid, status: "failed", event: "payment_intent.payment_failed" });
      await releaseCoupons(paymentId, "payment_intent.payment_failed");
      return;
    }

    // A chargeback has a hard deadline (usually ~7–21 days to submit evidence) and
    // is lost by default if nobody answers. That makes it one of the few Stripe
    // events that needs a human the same day.
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      const paymentId = chargeId ? await findPaymentIdByStripeId("stripeChargeId", chargeId) : null;
      const due = dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
        : null;
      await raiseAlert({
        severity: "critical",
        kind: "stripe.dispute",
        message:
          `A customer disputed a payment: ${money(toMajor(dispute.amount, dispute.currency), dispute.currency)} ` +
          `(${dispute.reason})${paymentId ? ` · payment ${paymentId}` : ""}.` +
          `${due ? ` Evidence is due ${due}.` : ""} ` +
          "Do: answer it in Stripe → Disputes before the deadline, and check whether the book shipped.",
        meta: { disputeId: dispute.id, chargeId, paymentId, reason: dispute.reason },
        ref: dispute.id,
      });
      if (paymentId) {
        const payment = await getAdminPayment(paymentId);
        if (payment) {
          await updatePayment({ paymentId, uid: payment.ownerUid, event: "charge.dispute.created" });
        }
      }
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
          await campaignClawbackForRef(invoiceId);
          await restoreMembershipCoupons(invoiceId);
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
      if (payment.kind === "order") {
        await syncOrderFromPayment(
          await getAdminPayment(paymentId),
          {
            type: "refund",
            source: "stripe",
            message: `${fullyRefunded ? "Fully" : "Partially"} refunded: ${refunded} ${(charge.currency ?? "usd").toUpperCase()}`,
            data: { refunded, fullyRefunded },
          },
          undefined,
          { dedupeId: `refund_${charge.amount_refunded}` },
        );
      }
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
        // Same reasoning for campaigns: buy, collect the Spark refund, refund the
        // purchase is the cheapest attack on a spend-refund campaign.
        await campaignClawbackForRef(paymentId);
      }
      // Coupons go the OTHER way from referral and campaign clawback, and that
      // asymmetry is deliberate. A reward paid out has to be taken back; a
      // coupon use has to be given back. So this runs on partial refunds too and
      // lets each coupon's own `refundPolicy` decide — the operator knows
      // whether a make-good code should survive the refund it accompanied.
      await restoreCouponsForRefund({ paymentRef: paymentId, isFullRefund: fullyRefunded });
      // A refunded print order may already be at (or past) the printer —
      // fulfillment isn't auto-cancelled, so a human must decide what to do.
      if (payment.kind === "order" && refunded > 0) {
        await raiseAlert({
          severity: "warning",
          kind: "print-order-refunded",
          message:
            `Print order payment ${paymentId} was ${fullyRefunded ? "fully" : "partially"} refunded ` +
            `(${refunded} ${(charge.currency ?? "usd").toUpperCase()}). ` +
            "Check the print job — it is NOT canceled automatically and may still ship.",
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
          const item = sub.items.data[0];
          const price = item?.price;
          const priceId = price?.id ?? null;
          const plan = priceId ? resolvePlanByPriceId(await getPlansConfig(), priceId) : null;
          const planName = plan?.presentation.name ?? "your plan";
          const subAmount =
            price?.unit_amount != null ? toMajor(price.unit_amount, price.currency ?? "usd") : null;
          const subCurrency = price?.currency ?? null;
          const subInterval = price?.recurring?.interval ?? null;
          const startedAtSec =
            (sub as unknown as { start_date?: number; created?: number }).start_date ?? sub.created;
          const startedAtMs = typeof startedAtSec === "number" ? startedAtSec * 1000 : null;
          const subscriber = await getUserSlackIdentity(uid);
          if (event.type === "customer.subscription.deleted") {
            await sendSubscriptionCancelledEmail({ uid, planName, subscriptionId: sub.id });
            await notifySlack({
              channel: "growth",
              messageKey: "subscription_cancelled",
              ref: `sub_cancelled_${sub.id}`,
              text: formatSubscriptionSlackMessage({
                event: "cancelled",
                planName,
                amount: subAmount,
                currency: subCurrency,
                interval: subInterval,
                email: subscriber.email,
                country: subscriber.country,
                startedAtMs,
              }),
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
              text: formatSubscriptionSlackMessage({
                event: "started",
                planName,
                amount: subAmount,
                currency: subCurrency,
                interval: subInterval,
                trialing: sub.status === "trialing",
                email: subscriber.email,
                country: subscriber.country,
              }),
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
      // Active is not the same as collecting: with no registration Stripe Tax
      // computes zero everywhere, which is how a customer ends up charged no tax
      // on an order that owed some.
      const registrations = await getStripe()
        .tax.registrations.list({ status: "active", limit: 1 })
        .catch(() => null);
      if (registrations && registrations.data.length === 0) {
        checks.push({
          id: "tax",
          label: "Stripe Tax",
          status: "warn",
          message:
            "Stripe Tax is active but has no registrations, so it collects NO tax anywhere — every order is charged without tax.",
          fix: "Add a tax registration for each place you must collect tax (Stripe Dashboard → Tax → Registrations).",
        });
      } else {
        checks.push({
          id: "tax",
          label: "Stripe Tax",
          status: "pass",
          message: "Stripe Tax is active with registrations; tax will be calculated at checkout.",
        });
      }
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

  // 7b. The other tax codes: digital goods are taxed too, and a missing or
  // invalid code means they are sold without Stripe Tax.
  try {
    const pricing = await getPricingSettings();
    for (const [id, label, code, where] of [
      ["tax-code-ebook", "Ebook tax code", pricing.ebook.taxCode, "Ebook settings"],
      ["tax-code-sparks", "Spark pack tax code", pricing.tax.sparkTaxCode, "Pricing settings → Tax"],
    ] as const) {
      if (!code) {
        checks.push({
          id,
          label,
          status: "warn",
          message: `No tax code is set, so this is sold without Stripe Tax.`,
          fix: `Choose the Stripe tax code that describes it (with your accountant) and set it in ${where}.`,
        });
        continue;
      }
      const tc = await getStripe().taxCodes.retrieve(code);
      checks.push({ id, label, status: "pass", message: `Tax code ${code} resolves to “${tc.name}”.` });
    }
  } catch (err) {
    checks.push({
      id: "tax-code-digital",
      label: "Digital tax codes",
      status: "fail",
      message: `A configured digital tax code is invalid: ${(err as Error)?.message ?? "error"}.`,
      fix: "Set valid Stripe tax codes for ebooks and Spark packs.",
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

/** `/studio/{projectId}` when a pack was bought from inside a book, else `/studio`. */
function sparkReturnPath(body: unknown): string {
  const projectId = (body as { returnProjectId?: unknown } | undefined)?.returnProjectId;
  return typeof projectId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(projectId)
    ? `/studio/${encodeURIComponent(projectId)}`
    : "/studio";
}
