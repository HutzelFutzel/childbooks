/**
 * The coupon engine's public surface.
 *
 * Everything outside `coupons/` imports from here, so the internal split between
 * the store, the lifecycle and the counters stays an implementation detail —
 * the same shape `campaigns/` and `referrals/` present.
 */
export {
  autoGrantCoupons,
  couponCandidates,
  couponHistory,
  couponUserFacts,
  couponWallet,
  grantCouponManually,
  previewCoupon,
  refreshGrantTerms,
  releaseCoupons,
  reserveCoupon,
  restoreCouponsForRefund,
  settleCoupons,
  simulateCoupon,
  voidRedemption,
  type CouponCandidate,
  type CouponWalletEntry,
  type GrantedCoupon,
  type SettledCoupon,
} from "./redemption";

export {
  couponReport,
  discountToday,
  readCounters,
  recordRejection,
  type CouponCounters,
} from "./stats";

export {
  createCode,
  generateCodes,
  listCodes,
  listGrantsFor,
  readCode,
  readGrant,
  recentRedemptions,
  revokeCodes,
  revokeGrant,
} from "./store";
