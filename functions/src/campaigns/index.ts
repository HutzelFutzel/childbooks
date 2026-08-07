/**
 * The campaign engine's public surface — the one import the rest of the backend
 * needs.
 *
 * Payment code, auth routes and the studio call `onCampaignEvent` and nothing
 * else; every decision about who is owed what lives behind this boundary. That's
 * deliberate: the referral program grew the same way, and the payoff is that
 * adding a campaign type has never once meant editing the Stripe webhook.
 *
 * `pricing.ts` is NOT re-exported here. It's imported directly by `sparks.ts`,
 * because pulling the payout executors into the wallet would close an import
 * cycle (executors → wallet → executors).
 */
export { onCampaignEvent, ensureEnrollments, type CampaignEventContext } from "./events";
export { clawbackForRef as campaignClawbackForRef } from "./clawback";
export {
  earnedCampaignDiscounts,
  finalizeCampaignDiscounts,
  reserveCampaignDiscount,
  type CampaignDiscount,
} from "./discounts";
export { releaseRedemption, voidRedemption } from "./effects";
export { offersOverview, previewOffers } from "./offers";
export { campaignReport, campaignRates, type CampaignDayStats, type CampaignReport } from "./stats";
export { listRedemptionsByStatus, listEnrollmentsFor, getEnrollment } from "./store";
export { simulateCampaign, type SimulationResult } from "./simulate";

import type { DiscountItemType } from "../../../books-frontend/src/core/config/discountImpact";
import type { CampaignTrigger } from "../../../books-frontend/src/core/config/campaigns";

/**
 * Which discount item type a payment counts as.
 *
 * Takes a bare string rather than `PaymentKind` because the caller's source is
 * Stripe session metadata, which is untyped by construction — pretending
 * otherwise would just move the cast somewhere with less context.
 *
 * Spark gifts map to `pack` because that's what they are commercially — a pack
 * bought for someone else — and an admin who writes "10% off Spark packs" means
 * both. Anything unrecognized falls through to `print`, the conservative choice:
 * print is the only item type with a hard break-even clamp at checkout, so a
 * misclassification there can't quietly discount past cost.
 */
export function itemTypeForPaymentKind(kind: string | undefined): DiscountItemType {
  switch (kind) {
    case "ebook":
      return "ebook";
    case "sparkPack":
    case "sparkGift":
      return "pack";
    case "subscription":
      return "plan";
    case "order":
    default:
      return "print";
  }
}

/** Which campaign trigger a cleared payment fires. */
export function triggerForPaymentKind(kind: string | undefined): CampaignTrigger {
  return kind === "subscription" ? "subscription_started" : "purchase";
}
