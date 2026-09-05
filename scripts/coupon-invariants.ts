/**
 * Coupon engine invariants — the properties that must hold for any coupon an
 * admin can configure, checked against the real engine rather than a
 * restatement of it.
 *
 * These are the failures that give away money quietly. A coupon doesn't crash
 * when it's wrong; it just discounts more orders, or more deeply, than anybody
 * intended, and the only symptom is next month's margin. None of the following
 * shows up in a typecheck, and none of it is visible from evaluating the engine
 * at a single point:
 *
 *   - a restriction that an unknown fact turns into a free pass ("we couldn't
 *     tell which country, so we allowed it"),
 *   - a cap that binds on the preview path but not inside the transaction,
 *   - two offers stacking into a below-cost sale,
 *   - a code alphabet that a customer mis-transcribes into somebody else's code,
 *   - a public projection that ships every unredeemed code to the browser,
 *   - a hand-edited config that turns an uncapped 100%-off coupon live,
 *   - a tracked QR code that encodes a URL redirecting to itself, or that lends
 *     our own domain out as an open redirect.
 *
 * Run by `yarn check:coupons`, which bundles this with esbuild first: the engine
 * lives in the Next workspace as TypeScript, and re-implementing its rules in a
 * plain .mjs check would let the check pass while the shipped code was wrong.
 */
import {
  COUPON_ISSUANCE_KINDS,
  COUPON_ITEM_TYPES,
  COUPON_REJECTION_REASONS,
  MAX_COUPON_CODE_LENGTH,
  couponDiscountPercent,
  couponRates,
  couponSummary,
  couponsConfigSchema,
  createAudience,
  createCoupon,
  createDefaultCouponsConfig,
  createMechanic,
  createRestrictions,
  describeMechanic,
  describeRejection,
  describeRestrictions,
  discountedAmount,
  emptyCouponDayStats,
  emptyUsage,
  formatCouponCode,
  freezeCouponTerms,
  generateCouponCode,
  isPlausibleCouponCode,
  maskCouponCode,
  normalizeCouponCode,
  normalizeCouponDayStats,
  normalizeCouponsConfig,
  publicCouponsProjection,
  resolveBestDiscount,
  totalCouponDayStats,
  validateCoupon,
  type Coupon,
  type CouponCodeRecord,
  type CouponGrantRecord,
  type CouponPurchaseFacts,
  type CouponRejectionReason,
  type CouponUsageFacts,
  type CouponUserFacts,
  type DiscountCandidate,
} from "../books-frontend/src/core/config/coupons";
import {
  ARRIVAL_KINDS,
  MAX_ARRIVAL_TOKENS,
  MAX_ARRIVAL_TOKEN_LENGTH,
  arrivalToken,
  describeArrivalToken,
  emptyAcquisitionProfile,
  matchesArrival,
  mergeArrival,
  normalizeAcquisitionProfile,
  normalizeArrival,
  normalizeArrivalId,
  parseArrivalToken,
} from "../books-frontend/src/core/profile/acquisition";
import {
  normalizeQrCodesConfig,
  qrEncodedValue,
  qrScanDestination,
} from "../books-frontend/src/core/config/qrCodes";
import {
  normalizePlansConfig,
  pricePointForId,
  resolvePlanByPriceId,
} from "../books-frontend/src/core/config/plans";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function user(over: Partial<CouponUserFacts> = {}): CouponUserFacts {
  return {
    uid: "u1",
    anonymous: false,
    emailVerified: true,
    createdAt: NOW - 30 * DAY,
    country: "DE",
    isSubscriber: false,
    planId: null,
    purchaseCount: 0,
    arrivedVia: [],
    ...over,
  };
}

function purchase(over: Partial<CouponPurchaseFacts> = {}): CouponPurchaseFacts {
  return { itemType: "print", subtotal: 40, currency: "EUR", productId: "p-1", country: "DE", ...over };
}

function usage(over: Partial<CouponUsageFacts> = {}): CouponUsageFacts {
  return { ...emptyUsage(), ...over };
}

/** An active, capped, code-based coupon — the shape most checks start from. */
function coupon(over: Partial<Coupon> = {}): Coupon {
  return createCoupon({
    id: "c1",
    name: "Test coupon",
    status: "active",
    issuance: "sharedCode",
    sharedCode: "WELCOME20",
    mechanic: { kind: "percentOff", percentOff: 20, maxDiscountAmount: 0 },
    ...over,
  });
}

function code(over: Partial<CouponCodeRecord> = {}): CouponCodeRecord {
  return {
    code: "WELCOME20",
    couponId: "c1",
    boundUid: null,
    redeemedCount: 0,
    reservedCount: 0,
    revoked: false,
    createdAt: NOW - DAY,
    batchId: null,
    ...over,
  };
}

function grant(c: Coupon, over: Partial<CouponGrantRecord> = {}): CouponGrantRecord {
  return {
    id: `u1__${c.id}`,
    couponId: c.id,
    uid: "u1",
    terms: freezeCouponTerms(c, NOW),
    source: "auto",
    grantedBy: null,
    redeemedCount: 0,
    revoked: false,
    createdAt: NOW - DAY,
    ...over,
  };
}

/** Run validation with everything defaulted to "should pass". */
function verdict(args: {
  coupon?: Coupon;
  codeRecord?: CouponCodeRecord | null;
  grant?: CouponGrantRecord | null;
  user?: CouponUserFacts;
  purchase?: CouponPurchaseFacts;
  usage?: CouponUsageFacts;
  enabled?: boolean;
  at?: number;
}) {
  const c = args.coupon ?? coupon();
  return validateCoupon({
    coupon: c,
    codeRecord: args.codeRecord === undefined ? code() : args.codeRecord,
    grant: args.grant ?? null,
    user: args.user ?? user(),
    purchase: args.purchase ?? purchase(),
    usage: args.usage ?? usage(),
    enabled: args.enabled ?? true,
    at: args.at ?? NOW,
  });
}

/** Assert a configuration is refused, and name the reason we expected. */
function refuses(
  name: string,
  args: Parameters<typeof verdict>[0],
  reason: CouponRejectionReason,
): void {
  const result = verdict(args);
  check(
    `refuses ${name}`,
    !result.ok && result.reason === reason,
    result.ok ? "accepted" : `got "${result.reason}", wanted "${reason}"`,
  );
}

// ---- 0. The positive control ------------------------------------------------
//
// Without this, every refusal below could be satisfied by a validator that
// refuses everything — which is the easiest way to write a passing invariant
// suite that protects nothing.

{
  const ok = verdict({});
  check("accepts a well-formed coupon on a matching purchase", ok.ok, ok.ok ? "" : ok.reason);
  if (ok.ok) {
    check("an acceptance quotes the money", ok.discountAmount === 8, `got ${ok.discountAmount}`);
    check("an acceptance quotes the percentage", ok.percentOff === 20, `got ${ok.percentOff}`);
    check("an acceptance carries the customer-facing promise", ok.summary.trim().length > 0);
    check("an acceptance carries frozen terms", ok.terms.couponId === "c1");
  }
}

// ---- 1. Every refusal has copy a customer can act on ------------------------
//
// The compiler forces `describeRejection` to be exhaustive; it can't force the
// sentences to say anything. A code that bounces with no explanation is the
// failure the whole module exists to prevent.

for (const reason of COUPON_REJECTION_REASONS) {
  const message = describeRejection(reason);
  check(`describeRejection(${reason}) is a sentence`, message.trim().length > 15, JSON.stringify(message));
  check(`describeRejection(${reason}) names no internals`, !/\b(uid|couponId|null|undefined)\b/.test(message), message);
}

// The three that must read IDENTICALLY, or the preview endpoint becomes an
// oracle for which codes exist.
check(
  "an unknown, a revoked and a disabled-engine refusal are indistinguishable",
  describeRejection("unknown_code") === describeRejection("code_revoked") &&
    describeRejection("unknown_code") === describeRejection("engine_disabled"),
  [
    describeRejection("unknown_code"),
    describeRejection("code_revoked"),
    describeRejection("engine_disabled"),
  ].join(" | "),
);
check(
  "an allowlist refusal doesn't reveal that an allowlist exists",
  !/allow|list|invite/i.test(describeRejection("not_allowlisted")),
  describeRejection("not_allowlisted"),
);

// ---- 2. Unknown facts never open a gate -------------------------------------
//
// The single most expensive failure mode: honoring a restricted coupon because
// the fact it restricts on was missing. Every one of these must FAIL.

refuses(
  "an unknown country against a country-gated coupon",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), countries: ["DE"] } }),
    user: user({ country: null }),
    purchase: purchase({ country: null }),
  },
  "country_not_eligible",
);
refuses(
  "a missing product against a product-gated coupon",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), productIds: ["p-1"] } }),
    purchase: purchase({ productId: null }),
  },
  "product_not_eligible",
);
refuses(
  "an unknown plan against a plan-gated coupon",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), planIds: ["studio"] } }),
    user: user({ planId: null }),
  },
  "plan_not_eligible",
);
refuses(
  "a wrong currency",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), currencies: ["USD"] } }),
    purchase: purchase({ currency: "EUR" }),
  },
  "currency_not_eligible",
);
refuses(
  "a no-code coupon with no grant",
  { coupon: coupon({ issuance: "autoGrant" }), codeRecord: null, grant: null },
  "not_allowlisted",
);
refuses(
  "a no-code coupon whose grant was revoked",
  (() => {
    const c = coupon({ issuance: "autoGrant" });
    return { coupon: c, codeRecord: null, grant: grant(c, { revoked: true }) };
  })(),
  "not_allowlisted",
);

// A country gate must still bite when only the ACCOUNT's country is unknown but
// the purchase names one, and vice versa — the fallback must not become a hole.
{
  const gated = coupon({ restrictions: { ...createRestrictions(), countries: ["DE"] } });
  check(
    "a country gate reads the purchase country when the account's is unknown",
    verdict({ coupon: gated, user: user({ country: null }), purchase: purchase({ country: "DE" }) }).ok,
  );
  refuses(
    "a purchase country outside the gate even when the account is inside it",
    { coupon: gated, user: user({ country: "DE" }), purchase: purchase({ country: "FR" }) },
    "country_not_eligible",
  );
}

// ---- 3. Identity and status gates ------------------------------------------

refuses("a draft coupon", { coupon: coupon({ status: "draft" }) }, "not_active");
refuses("a paused coupon", { coupon: coupon({ status: "paused" }) }, "not_active");
refuses("an ended coupon", { coupon: coupon({ status: "ended" }) }, "not_active");
refuses("everything when the engine is off", { enabled: false }, "engine_disabled");
refuses("a revoked code", { codeRecord: code({ revoked: true }) }, "code_revoked");
refuses(
  "a code belonging to a different coupon",
  { codeRecord: code({ couponId: "other" }) },
  "unknown_code",
);
refuses(
  "a personalized code presented by the wrong account",
  { codeRecord: code({ boundUid: "someone-else" }) },
  "code_bound_to_other_account",
);
refuses("a guest by default", { user: user({ anonymous: true }) }, "guests_not_allowed");
refuses(
  "an unverified email by default",
  { user: user({ emailVerified: false }) },
  "requires_verified_email",
);
refuses(
  "an account that isn't on the allowlist",
  { coupon: coupon({ audience: { ...createAudience(), allowlistUids: ["someone-else"] } }) },
  "not_allowlisted",
);

// A window is a window in both directions.
refuses(
  "a coupon that hasn't opened yet",
  { coupon: coupon({ restrictions: { ...createRestrictions(), startsAt: NOW + DAY } }) },
  "not_started",
);
refuses(
  "a coupon past its end",
  { coupon: coupon({ restrictions: { ...createRestrictions(), endsAt: NOW - DAY } }) },
  "expired",
);

// Guests are allowed only when BOTH flags say so, since `requireVerified` is
// the stronger statement and a guest can never satisfy it.
check(
  "a guest is accepted only when guests are allowed and verification isn't required",
  verdict({
    coupon: coupon({
      restrictions: { ...createRestrictions(), allowGuests: true, requireVerified: false },
    }),
    user: user({ anonymous: true, emailVerified: false }),
  }).ok,
);

// ---- 4. Caps bind, on the preview path and in the transaction ---------------
//
// `validateCoupon` is called twice per redemption — once to quote, once inside
// the reserve transaction with fresh counters. Both calls run THIS function, so
// a cap that binds here binds in both places. What's checked below is that each
// cap binds at all, and binds at the boundary rather than one past it.

const capped = coupon({
  restrictions: {
    ...createRestrictions(),
    maxPerAccount: 1,
    maxRedemptions: 100,
    maxPerCode: 1,
    lifetimeBudget: 1000,
    dailyBudget: 250,
  },
});

refuses("a code that's already been used its allowance", { coupon: capped, usage: usage({ codeRedeemed: 1 }) }, "code_exhausted");
refuses("a coupon at its global cap", { coupon: capped, usage: usage({ totalRedeemed: 100 }) }, "coupon_exhausted");
refuses("an account at its per-account cap", { coupon: capped, usage: usage({ accountRedeemed: 1 }) }, "per_account_limit");
refuses("a coupon that's spent its lifetime budget", { coupon: capped, usage: usage({ lifetimeSpend: 1000 }) }, "budget_exhausted");
refuses("a coupon that's spent today's budget", { coupon: capped, usage: usage({ todaySpend: 250 }) }, "budget_exhausted");

check(
  "a cap allows the last use rather than refusing it early",
  verdict({ coupon: capped, usage: usage({ totalRedeemed: 99, accountRedeemed: 0, codeRedeemed: 0 }) }).ok,
);
check(
  "a budget allows the spend that reaches it rather than refusing early",
  verdict({ coupon: capped, usage: usage({ lifetimeSpend: 999, todaySpend: 249 }) }).ok,
);

// A zero cap means unlimited, not "nobody" — the difference between a default
// and a lockout.
check(
  "a zero cap is unlimited, not zero",
  verdict({
    coupon: coupon({
      restrictions: { ...createRestrictions(), maxPerAccount: 0, maxRedemptions: 0, maxPerCode: 0 },
    }),
    usage: usage({ totalRedeemed: 10_000, accountRedeemed: 500, codeRedeemed: 500 }),
  }).ok,
);

// Caps and budgets are monotone: more usage can never make a coupon MORE usable.
{
  let monotone = true;
  let wasUsable = true;
  for (const used of [0, 1, 50, 99, 100, 500]) {
    const nowUsable = verdict({ coupon: capped, usage: usage({ totalRedeemed: used }) }).ok;
    if (nowUsable && !wasUsable) monotone = false;
    wasUsable = nowUsable;
  }
  check("usability is monotone in usage", monotone);
}

// ---- 5. Purchase-shape gates -----------------------------------------------

refuses(
  "an item type the coupon doesn't cover",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), itemTypes: ["ebook"] } }),
    purchase: purchase({ itemType: "print" }),
  },
  "item_not_eligible",
);
refuses(
  "an order below the minimum",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), minSubtotal: 50 } }),
    purchase: purchase({ subtotal: 40 }),
  },
  "min_subtotal",
);
refuses(
  "a first-order-only coupon for a repeat customer",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), firstPurchaseOnly: true } }),
    user: user({ purchaseCount: 3 }),
  },
  "first_purchase_only",
);
refuses(
  "a members-only coupon for a non-member",
  { coupon: coupon({ restrictions: { ...createRestrictions(), subscriberScope: "subscribers" } }) },
  "subscribers_only",
);
refuses(
  "a non-members-only coupon for a member",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), subscriberScope: "nonSubscribers" } }),
    user: user({ isSubscriber: true }),
  },
  "non_subscribers_only",
);
refuses(
  "an account that's too new",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), minAccountAgeDays: 60 } }),
    user: user({ createdAt: NOW - DAY }),
  },
  "account_too_new",
);
refuses(
  "an account that's too old",
  {
    coupon: coupon({ restrictions: { ...createRestrictions(), maxAccountAgeDays: 7 } }),
    user: user({ createdAt: NOW - 90 * DAY }),
  },
  "account_too_old",
);
refuses(
  "a coupon that would take nothing off",
  { purchase: purchase({ subtotal: 0 }) },
  "no_headroom",
);

// An empty restriction list means "no restriction", not "no match" — half-typed
// coupons are saved constantly and must not become gates nobody passes.
check(
  "empty restriction lists restrict nothing",
  verdict({
    coupon: coupon({
      restrictions: {
        ...createRestrictions(),
        itemTypes: [],
        productIds: [],
        currencies: [],
        countries: [],
        planIds: [],
      },
    }),
  }).ok,
);

// ---- 6. Frozen terms are a real snapshot, and they WIN ----------------------
//
// A grant made a promise. Editing the coupon afterwards must not rewrite what
// the holder was already shown, and must not be able to make their discount
// larger OR smaller.

{
  const live = coupon({ issuance: "autoGrant", mechanic: { kind: "percentOff", percentOff: 25, maxDiscountAmount: 0 } });
  const held = grant(live);
  const frozenSummary = held.terms.summary;

  live.mechanic = { kind: "percentOff", percentOff: 5, maxDiscountAmount: 0 };
  live.restrictions = { ...live.restrictions, minSubtotal: 9999 };
  live.name = "Renamed";

  const result = verdict({ coupon: live, codeRecord: null, grant: held });
  check("a grant's frozen terms survive a later edit", held.terms.summary === frozenSummary);
  check(
    "a granted discount is calculated from the frozen terms, not the live coupon",
    result.ok && result.percentOff === 25,
    result.ok ? `got ${result.percentOff}` : result.reason,
  );

  // The mirror: a frozen restriction still applies. A grant is a promise, not
  // an exemption from the terms it was granted under.
  const strict = coupon({
    issuance: "autoGrant",
    restrictions: { ...createRestrictions(), minSubtotal: 100 },
  });
  refuses(
    "a granted coupon on an order below its frozen minimum",
    { coupon: strict, codeRecord: null, grant: grant(strict) },
    "min_subtotal",
  );

  // Deep-frozen, not shallow: mutating the live coupon's arrays must not reach
  // the snapshot.
  const arrays = coupon({ restrictions: { ...createRestrictions(), itemTypes: ["print"], countries: ["DE"] } });
  const snapshot = freezeCouponTerms(arrays, NOW);
  arrays.restrictions.itemTypes.push("ebook");
  arrays.restrictions.countries.push("FR");
  check(
    "frozen terms deep-copy their lists",
    snapshot.restrictions.itemTypes.length === 1 && snapshot.restrictions.countries.length === 1,
    JSON.stringify(snapshot.restrictions.itemTypes),
  );
  check("frozen terms carry the caveats", Array.isArray(snapshot.notes));
}

// ---- 7. The discount maths never mints value -------------------------------

{
  const pct = { kind: "percentOff" as const, percentOff: 20, maxDiscountAmount: 0 };
  check("20% of 40 is 8", couponDiscountPercent(pct, 40).discountAmount === 8);
  check("a zero subtotal takes nothing off", couponDiscountPercent(pct, 0).discountAmount === 0);
  check("a negative subtotal takes nothing off", couponDiscountPercent(pct, -50).discountAmount === 0);

  const cappedMechanic = { kind: "percentOff" as const, percentOff: 50, maxDiscountAmount: 10 };
  const big = couponDiscountPercent(cappedMechanic, 100);
  check("the money cap binds", big.discountAmount === 10, `got ${big.discountAmount}`);
  check(
    "the reported percentage reflects the cap, not the headline",
    big.percentOff === 10,
    `got ${big.percentOff}`,
  );

  // The invariant that matters most: whatever the mechanic, the discount can
  // never exceed the subtotal, and never be negative.
  let sane = true;
  for (const percentOff of [1, 10, 20, 50, 99, 100]) {
    for (const cap of [0, 1, 5, 50, 1000]) {
      for (const subtotal of [0.01, 1, 9.99, 40, 250, 9999]) {
        const out = couponDiscountPercent({ kind: "percentOff", percentOff, maxDiscountAmount: cap }, subtotal);
        if (out.discountAmount < 0 || out.discountAmount > subtotal + 0.005) sane = false;
        if (out.percentOff < 0 || out.percentOff > 100) sane = false;
        if (cap > 0 && out.discountAmount > cap + 0.005) sane = false;
        if (discountedAmount(subtotal, out.percentOff) < -0.005) sane = false;
      }
    }
  }
  check("a discount never exceeds the subtotal, its cap, or 100%", sane);

  // Monotone in the percentage: a bigger coupon can never take less off.
  let monotone = true;
  let previous = -1;
  for (const percentOff of [1, 5, 10, 25, 50, 100]) {
    const out = couponDiscountPercent({ kind: "percentOff", percentOff, maxDiscountAmount: 0 }, 100);
    if (out.discountAmount < previous) monotone = false;
    previous = out.discountAmount;
  }
  check("the discount is monotone in the percentage", monotone);
}

// ---- 8. Stacking: exactly one set of rules, best for the customer -----------

function candidate(over: Partial<DiscountCandidate> = {}): DiscountCandidate {
  return {
    source: "coupon",
    percentOff: 10,
    summary: "10% off",
    handle: "h1",
    stackable: false,
    priority: 0,
    ...over,
  } as DiscountCandidate;
}

{
  const referral = candidate({ source: "referral", handle: "ref", percentOff: 15, summary: "15% off" });
  const typed = candidate({ source: "coupon", handle: "code", percentOff: 25, summary: "25% off" });

  const best = resolveBestDiscount({ candidates: [referral, typed], maxDiscountPct: 100 });
  check("the bigger discount wins", best.percentOff === 25, `got ${best.percentOff}`);
  check("only one non-stackable offer applies", best.applied.length === 1);
  check("the loser is reported, not silently dropped", best.rejected.length === 1);
  check(
    "the loser's reason is one a customer can be shown",
    best.rejected[0]?.reason === "better_offer_active",
    best.rejected[0]?.reason,
  );

  check(
    "the order candidates arrive in doesn't decide the winner",
    resolveBestDiscount({ candidates: [typed, referral], maxDiscountPct: 100 }).percentOff ===
      resolveBestDiscount({ candidates: [referral, typed], maxDiscountPct: 100 }).percentOff,
  );

  // Priority breaks ties. It must NEVER beat a bigger discount: a customer
  // offered 25% and charged 15% experiences a bug, whatever the config says.
  const prioritized = resolveBestDiscount({
    candidates: [
      candidate({ handle: "small", percentOff: 15, priority: 100 }),
      candidate({ handle: "big", percentOff: 25, priority: 0 }),
    ],
    maxDiscountPct: 100,
  });
  check(
    "priority never beats a bigger discount",
    prioritized.percentOff === 25,
    `got ${prioritized.percentOff}`,
  );
  const tie = resolveBestDiscount({
    candidates: [
      candidate({ handle: "low", percentOff: 20, priority: 1 }),
      candidate({ handle: "high", percentOff: 20, priority: 9 }),
    ],
    maxDiscountPct: 100,
  });
  check("priority breaks a tie", tie.applied[0]?.handle === "high", tie.applied[0]?.handle);

  // Stacking requires MUTUAL consent, and is still clamped.
  const stacked = resolveBestDiscount({
    candidates: [
      candidate({ handle: "a", percentOff: 10, stackable: true }),
      candidate({ handle: "b", percentOff: 15, stackable: true }),
    ],
    maxDiscountPct: 100,
  });
  check("two mutually stackable offers combine", stacked.percentOff === 25, `got ${stacked.percentOff}`);
  const halfStacked = resolveBestDiscount({
    candidates: [
      candidate({ handle: "a", percentOff: 10, stackable: true }),
      candidate({ handle: "b", percentOff: 15, stackable: false }),
    ],
    maxDiscountPct: 100,
  });
  check(
    "one unwilling party stops the stack",
    halfStacked.applied.length === 1 && halfStacked.percentOff === 15,
    `${halfStacked.applied.length} applied at ${halfStacked.percentOff}%`,
  );

  // The clamps. This is the check that stands between a promotion and a
  // below-cost sale.
  let clamped = true;
  for (const maxDiscountPct of [0, 5, 10, 25, 100]) {
    for (const appliedPct of [0, 10, 30]) {
      for (const breakEvenPct of [0, 15, 40, 100]) {
        const out = resolveBestDiscount({
          candidates: [
            candidate({ handle: "a", percentOff: 90, stackable: true }),
            candidate({ handle: "b", percentOff: 90, stackable: true }),
          ],
          maxDiscountPct,
          appliedPct,
          breakEvenPct,
        });
        const ceiling = Math.max(0, Math.min(maxDiscountPct, breakEvenPct - appliedPct));
        if (out.percentOff > ceiling + 0.05) clamped = false;
        // A candidate that was clamped to nothing must be REJECTED, not applied
        // at 0 — otherwise a single-use code is consumed for no benefit.
        if (ceiling <= 0 && out.applied.length > 0) clamped = false;
      }
    }
  }
  check("the total never exceeds the catalog ceiling or the break-even headroom", clamped);

  const noRoom = resolveBestDiscount({
    candidates: [typed],
    maxDiscountPct: 20,
    appliedPct: 20,
    breakEvenPct: 20,
  });
  check("a code with no headroom is refused rather than burned", noRoom.applied.length === 0);
  check(
    "the refusal explains there's no room",
    noRoom.rejected[0]?.reason === "no_headroom",
    noRoom.rejected[0]?.reason,
  );

  check(
    "no candidates means no discount",
    resolveBestDiscount({ candidates: [], maxDiscountPct: 100 }).percentOff === 0,
  );
  check(
    "a 0% candidate is ignored",
    resolveBestDiscount({ candidates: [candidate({ percentOff: 0 })], maxDiscountPct: 100 }).applied
      .length === 0,
  );
}

// ---- 9. Codes are unguessable, unambiguous and canonical -------------------

{
  check("normalization upper-cases and strips punctuation", normalizeCouponCode("welcome-20") === "WELCOME20");
  check("normalization ignores spacing", normalizeCouponCode("  welcome 20 ") === "WELCOME20");
  check("normalization is idempotent", normalizeCouponCode(normalizeCouponCode("wel-come_20")) === "WELCOME20");
  check(
    "normalization bounds the length",
    normalizeCouponCode("A".repeat(500)).length === MAX_COUPON_CODE_LENGTH,
  );
  check("the display form round-trips", normalizeCouponCode(formatCouponCode("K3ZQ8MHW")) === "K3ZQ8MHW");
  check("a short string isn't a plausible code", !isPlausibleCouponCode("ab"));
  check("a real code is plausible", isPlausibleCouponCode("welcome-20"));

  // Masking must never reveal more than the tail, whatever it's given.
  let masked = true;
  for (const raw of ["A", "ABCD", "WELCOME20", "K3ZQ8MHW", "A".repeat(40)]) {
    const out = maskCouponCode(raw);
    const normalized = normalizeCouponCode(raw);
    if (normalized.length > 4 && !out.endsWith(normalized.slice(-4))) masked = false;
    if (out.replace(/•/g, "").length > 4) masked = false;
    if (normalized.length > 4 && out.includes(normalized.slice(0, -4))) masked = false;
  }
  check("a masked code reveals at most its last four characters", masked);
  check("a code too short to mask reveals nothing", maskCouponCode("ABC") === "••••");

  // The generated alphabet. `0/O` and `1/I` are the four shapes people mistype
  // off a printed poster, and a mistyped code that resolves to a DIFFERENT
  // live code is somebody else's discount.
  const draws: string[] = [];
  let seed = 12345;
  const seededRandomInt = (maxExclusive: number) => {
    // xorshift — deterministic, so a failure here reproduces.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return Math.abs(seed) % maxExclusive;
  };
  for (let i = 0; i < 20_000; i++) draws.push(generateCouponCode(seededRandomInt, 10));
  check(
    "generated codes contain no ambiguous characters",
    draws.every((c) => !/[01OI]/.test(c)),
    draws.find((c) => /[01OI]/.test(c)),
  );
  check("generated codes are canonical", draws.every((c) => normalizeCouponCode(c) === c));
  check("generated codes honour the requested length", draws.every((c) => c.length === 10));
  check(
    "20,000 generated codes collide fewer than 5 times",
    draws.length - new Set(draws).size < 5,
    `${draws.length - new Set(draws).size} collisions`,
  );
  check(
    "a short length is raised to the minimum rather than accepted",
    generateCouponCode(seededRandomInt, 2).length >= 6,
  );
  check(
    "a prefix survives normalization",
    generateCouponCode(seededRandomInt, 8, "XMAS").startsWith("XMAS"),
  );
}

// ---- 10. Normalization can't be talked past, and is idempotent -------------
//
// Everything here is what a hand-edited Firestore document would try.

{
  const hostile = {
    version: 1,
    enabled: true,
    coupons: [
      // A 0% coupon that claims to be active: it would validate and take
      // nothing off, which is a support ticket rather than a discount.
      {
        id: "zero",
        name: "Zero",
        status: "active",
        issuance: "sharedCode",
        sharedCode: "zero-pct",
        mechanic: { kind: "percentOff", percentOff: 0, maxDiscountAmount: 0 },
      },
      // An expired window that still says "active".
      {
        id: "stale",
        name: "Stale",
        status: "active",
        issuance: "sharedCode",
        sharedCode: "STALE",
        mechanic: { kind: "percentOff", percentOff: 10, maxDiscountAmount: 0 },
        restrictions: { ...createRestrictions(), endsAt: NOW - DAY },
      },
      // A duplicate id: two coupons collapsed onto one set of counters and one
      // budget.
      {
        id: "zero",
        name: "Duplicate",
        status: "draft",
        issuance: "sharedCode",
        sharedCode: "DUPE",
        mechanic: { kind: "percentOff", percentOff: 10, maxDiscountAmount: 0 },
      },
      // An unknown mechanic, and a shared code on a channel that has none.
      {
        id: "weird",
        name: "Weird",
        status: "active",
        issuance: "autoGrant",
        sharedCode: "SHOULD-VANISH",
        mechanic: { kind: "buyOneGetOne" },
      },
    ],
  };

  const normalized = normalizeCouponsConfig(hostile, NOW);
  const byId = (id: string) => normalized.coupons.find((c) => c.id === id);

  check(
    "a 0% coupon can't normalize to active",
    byId("zero")?.status === "draft",
    byId("zero")?.status,
  );
  check("an expired window normalizes to ended", byId("stale")?.status === "ended", byId("stale")?.status);
  check(
    "duplicate ids are separated rather than sharing a budget",
    new Set(normalized.coupons.map((c) => c.id)).size === normalized.coupons.length,
    normalized.coupons.map((c) => c.id).join(","),
  );
  check(
    "an unknown mechanic can't normalize to active",
    byId("weird")?.status === "draft",
    byId("weird")?.status,
  );
  check(
    "a shared code is dropped from a channel that has no codes",
    byId("weird")?.sharedCode === "",
    byId("weird")?.sharedCode,
  );
  check(
    "normalization is idempotent",
    JSON.stringify(normalizeCouponsConfig(normalized, NOW)) === JSON.stringify(normalized),
  );
  check(
    "an absent config normalizes to a no-op",
    normalizeCouponsConfig(undefined, NOW).coupons.length === 0 &&
      normalizeCouponsConfig(undefined, NOW).enabled === false,
  );
  check(
    "garbage normalizes to a no-op",
    normalizeCouponsConfig({ enabled: "yes", coupons: "nope" }, NOW).coupons.length === 0,
  );
  check(
    "the default config is a no-op",
    createDefaultCouponsConfig().coupons.length === 0 && !createDefaultCouponsConfig().enabled,
  );

  // The engine's own switch has to survive a round trip, or an operator turns
  // coupons on and they come back off.
  check(
    "the master switch survives normalization",
    normalizeCouponsConfig({ version: 1, enabled: true, coupons: [] }, NOW).enabled,
  );

  // Every issuance kind must survive. A channel silently rewritten to
  // `sharedCode` is a no-code coupon that suddenly needs a code nobody has.
  for (const issuance of COUPON_ISSUANCE_KINDS) {
    const round = normalizeCouponsConfig(
      { version: 1, enabled: true, coupons: [{ ...coupon({ issuance }), id: "x" }] },
      NOW,
    );
    check(`issuance "${issuance}" survives normalization`, round.coupons[0]?.issuance === issuance);
  }

  // Every item type must survive, for the same reason: a dropped restriction is
  // a coupon honored more widely than its author believed.
  const items = normalizeCouponsConfig(
    {
      version: 1,
      enabled: true,
      coupons: [{ ...coupon({ restrictions: { ...createRestrictions(), itemTypes: [...COUPON_ITEM_TYPES] } }), id: "x" }],
    },
    NOW,
  );
  check(
    "every item-type restriction survives normalization",
    items.coupons[0]?.restrictions.itemTypes.length === COUPON_ITEM_TYPES.length,
    JSON.stringify(items.coupons[0]?.restrictions.itemTypes),
  );
}

// ---- 11. The save-time schema refuses the expensive mistakes ---------------

function rejects(name: string, over: Partial<Coupon>): void {
  const result = couponsConfigSchema.safeParse({
    version: 1,
    enabled: true,
    coupons: [coupon(over)],
  });
  check(`schema rejects ${name}`, !result.success);
  if (!result.success) {
    check(
      `the refusal of ${name} explains itself`,
      result.error.issues.every((i) => i.message.trim().length > 20),
      result.error.issues.map((i) => i.message).join(" | "),
    );
  }
}

/**
 * The other half of {@link rejects}.
 *
 * A schema that refuses too much is as expensive as one that refuses too
 * little — it just fails in the admin's face instead of on the balance sheet,
 * which is why the shapes an operator legitimately needs are asserted rather
 * than assumed.
 */
function accepts(name: string, over: Partial<Coupon>): void {
  const result = couponsConfigSchema.safeParse({
    version: 1,
    enabled: true,
    coupons: [coupon(over)],
  });
  check(
    `schema accepts ${name}`,
    result.success,
    result.success ? "" : result.error.issues.map((i) => i.message).join(" | "),
  );
}

const safeCaps = {
  ...createRestrictions(),
  maxPerAccount: 1,
  maxRedemptions: 100,
  dailyBudget: 250,
  lifetimeBudget: 5000,
};

rejects("an active coupon with no cap and no budget", {
  restrictions: {
    ...createRestrictions(),
    maxPerAccount: 0,
    maxRedemptions: 0,
    lifetimeBudget: 0,
    dailyBudget: 0,
  },
});
rejects("an active coupon with no budget at all", {
  restrictions: { ...safeCaps, dailyBudget: 0, lifetimeBudget: 0 },
});
rejects("a shared-code coupon with no code", { restrictions: safeCaps, sharedCode: "" });
rejects("a code too short to be unguessable", { restrictions: safeCaps, sharedCode: "AB" });
rejects("an auto-granted coupon with no audience", {
  restrictions: safeCaps,
  issuance: "autoGrant",
  sharedCode: "",
  audience: createAudience(),
});
// The grant IS the audience for a hand-granted coupon, so an empty one has to
// save — an operator can't paste a uid they haven't looked up, and the panel
// that resolves an email into one only appears once the coupon exists. The
// entitlement rule is asserted from the other side in section 16: an
// `adminGrant` coupon with no grant validates for nobody, which is what stops
// "saves with no audience" from meaning "usable by anyone".
accepts("a hand-granted coupon with no audience, because grants are the audience", {
  restrictions: safeCaps,
  issuance: "adminGrant",
  sharedCode: "",
  audience: createAudience(),
});
rejects("a window that ends before it starts", {
  restrictions: { ...safeCaps, startsAt: NOW, endsAt: NOW - DAY },
});
rejects("an account-age range that can never match", {
  restrictions: { ...safeCaps, minAccountAgeDays: 90, maxAccountAgeDays: 7 },
});
rejects("a discount open to unverified guests", {
  restrictions: { ...safeCaps, allowGuests: true, requireVerified: false },
});
rejects("an uncapped 100%-off coupon", {
  restrictions: { ...safeCaps, maxRedemptions: 0 },
  mechanic: { kind: "percentOff", percentOff: 100, maxDiscountAmount: 0 },
});
rejects("a 0% coupon", {
  restrictions: safeCaps,
  mechanic: { kind: "percentOff", percentOff: 0, maxDiscountAmount: 0 },
});

{
  // Two coupons answering to one code: whichever wins, half the customers get
  // an offer nobody promised them.
  const collision = couponsConfigSchema.safeParse({
    version: 1,
    enabled: true,
    coupons: [
      coupon({ id: "a", name: "First", restrictions: safeCaps, sharedCode: "WELCOME20" }),
      coupon({ id: "b", name: "Second", restrictions: safeCaps, sharedCode: "welcome-20" }),
    ],
  });
  check("schema rejects two coupons sharing a code", !collision.success);
  check(
    "the collision refusal names the other coupon",
    !collision.success && collision.error.issues.some((i) => i.message.includes("First")),
    collision.success ? "" : collision.error.issues.map((i) => i.message).join(" | "),
  );

  // The positive controls.
  const sane = couponsConfigSchema.safeParse({
    version: 1,
    enabled: true,
    coupons: [coupon({ restrictions: safeCaps })],
  });
  check(
    "schema accepts a well-formed coupon",
    sane.success,
    sane.success ? "" : JSON.stringify(sane.error.issues.map((i) => i.message)),
  );
  check(
    "schema accepts an empty config",
    couponsConfigSchema.safeParse({ version: 1, enabled: false, coupons: [] }).success,
  );
  // A draft is where an operator builds up to a valid coupon, so the caps that
  // an ACTIVE coupon must have can't be demanded of one.
  check(
    "schema accepts an uncapped DRAFT",
    couponsConfigSchema.safeParse({
      version: 1,
      enabled: true,
      coupons: [
        coupon({
          status: "draft",
          restrictions: {
            ...createRestrictions(),
            maxPerAccount: 0,
            maxRedemptions: 0,
            dailyBudget: 0,
            lifetimeBudget: 0,
          },
        }),
      ],
    }).success,
  );
}

// ---- 12. The public projection ships nothing but the switch ----------------
//
// Unlike campaigns, the client evaluates nothing here — so publishing anything
// else would hand out every unredeemed code in the system.

{
  const config = normalizeCouponsConfig(
    {
      version: 1,
      enabled: true,
      coupons: [
        coupon({
          id: "live",
          name: "Poster promo",
          notes: "internal reasoning about margin",
          sharedCode: "SECRETCODE",
          restrictions: { ...safeCaps, dailyBudget: 999, lifetimeBudget: 12345 },
          audience: { ...createAudience(), allowlistUids: ["secret-uid"] },
        }),
      ],
    },
    NOW,
  );
  const projection = publicCouponsProjection(config);
  const serialized = JSON.stringify(projection);
  check("the public projection publishes no codes", !serialized.includes("SECRETCODE"));
  check("the public projection publishes no budgets", !serialized.includes("12345"));
  check("the public projection publishes no admin notes", !serialized.includes("internal reasoning"));
  check("the public projection publishes no allowlist", !serialized.includes("secret-uid"));
  check("the public projection publishes no names", !serialized.includes("Poster promo"));
  check(
    "the public projection is only the switch",
    Object.keys(projection).length === 1 && projection.enabled === true,
    Object.keys(projection).join(","),
  );
}

// ---- 13. Generated copy exists and stays honest ----------------------------

{
  check(
    "a coupon with no headline still has a promise",
    couponSummary(coupon({ presentation: { headline: "", subline: "" } })).trim().length > 0,
  );
  check(
    "an explicit headline wins over the generated promise",
    couponSummary(coupon({ presentation: { headline: "Half price this week", subline: "" } })) ===
      "Half price this week",
  );
  check(
    "the generated promise mentions the money cap",
    describeMechanic({ kind: "percentOff", percentOff: 20, maxDiscountAmount: 15 }, []).includes("15"),
    describeMechanic({ kind: "percentOff", percentOff: 20, maxDiscountAmount: 15 }, []),
  );
  for (const itemType of COUPON_ITEM_TYPES) {
    check(
      `the generated promise names the ${itemType} scope`,
      describeMechanic(createMechanic(), [itemType]).trim().length > 0,
    );
  }

  // The caveats are the offer. A restriction with no sentence is a restriction
  // the customer discovers at checkout.
  const notes = describeRestrictions({
    ...createRestrictions(),
    minSubtotal: 50,
    itemTypes: ["print"],
    countries: ["DE"],
    firstPurchaseOnly: true,
    maxPerAccount: 1,
    endsAt: NOW + DAY,
    subscriberScope: "subscribers",
    planIds: ["studio"],
    productIds: ["p-1"],
  });
  check("caveats are de-duplicated", new Set(notes).size === notes.length, notes.join(" | "));
  check("the minimum order is disclosed", notes.some((n) => n.includes("50")), notes.join(" | "));
  check("the item scope is disclosed", notes.some((n) => /print/i.test(n)), notes.join(" | "));
  check("the country limit is disclosed", notes.some((n) => n.includes("DE")), notes.join(" | "));
  check("first-order-only is disclosed", notes.some((n) => /first/i.test(n)), notes.join(" | "));
  check("the expiry is disclosed", notes.some((n) => /lasts/i.test(n)), notes.join(" | "));
  check(
    "non-stackability is disclosed",
    describeRestrictions(createRestrictions()).some((n) => /combined/i.test(n)),
  );
  check(
    "an unrestricted coupon has no caveats to invent",
    describeRestrictions({
      ...createRestrictions(),
      maxPerAccount: 0,
      requireVerified: false,
      stackable: true,
    }).length === 0,
  );
}

// ---- 14. Report maths is finite, and never divides by zero -----------------

{
  const empty = couponRates(emptyCouponDayStats("2026-01-01"));
  check(
    "every rate on an empty day is finite",
    Object.values(empty).every((v) => v === null || Number.isFinite(v)),
    JSON.stringify(empty),
  );
  check("nothing tried means a 0% accept rate, not NaN", empty.acceptRatePct === 0);
  check("nothing given away means no return-on-discount", empty.returnOnDiscount === null);

  const busy = {
    ...emptyCouponDayStats("2026-01-02"),
    accepted: 30,
    rejected: 10,
    redemptions: 20,
    released: 5,
    discount: 100,
    revenue: 900,
    orders: 20,
    newCustomers: 12,
  };
  const rates = couponRates(busy);
  check("the accept rate is a percentage", rates.acceptRatePct === 75, `got ${rates.acceptRatePct}`);
  check("the return on discount divides revenue by spend", rates.returnOnDiscount === 9, `got ${rates.returnOnDiscount}`);
  check("the new-customer share is a percentage", rates.newCustomerPct === 60, `got ${rates.newCustomerPct}`);
  check("the abandon rate uses reservations, not attempts", rates.abandonRatePct === 20, `got ${rates.abandonRatePct}`);

  const totals = totalCouponDayStats([busy, busy], "total");
  check("day totals add up", totals.redemptions === 40 && totals.discount === 200);
  check("day totals keep their label", totals.day === "total");
  check(
    "a garbage stats document reads back as zeros",
    normalizeCouponDayStats("2026-01-03", { redemptions: "lots", discount: null }).redemptions === 0,
  );
  check(
    "a stats document keeps its day key",
    normalizeCouponDayStats("2026-01-03", {}).day === "2026-01-03",
  );
}

// ---- 15. Arrival attribution -----------------------------------------------
//
// The layer a QR-granted coupon keys on. Two failure modes matter: a token that
// can't be matched (the poster granted nothing), and a token that matches too
// much (every visitor got the discount).

{
  check("a token is namespaced", arrivalToken("qr", "Berlin Window") === "qr:berlin-window");
  check("a token round-trips", parseArrivalToken("qr:berlin-window").id === "berlin-window");
  check("a token round-trips its kind", parseArrivalToken("qr:berlin-window").kind === "qr");
  check("an unknown namespace reads as direct", parseArrivalToken("nonsense:x").kind === "direct");
  check("an id with no safe characters yields the bare kind", arrivalToken("qr", "###") === "qr");
  check(
    "ids are folded to a safe, bounded subset",
    normalizeArrivalId("Berlin/../Window?x=1") === "berlin-window-x-1",
    normalizeArrivalId("Berlin/../Window?x=1"),
  );
  check(
    "a token can never exceed the indexable length",
    arrivalToken("affiliate", "x".repeat(500)).length <= MAX_ARRIVAL_TOKEN_LENGTH,
  );
  for (const kind of ARRIVAL_KINDS) {
    check(`describeArrivalToken(${kind}) is non-empty`, describeArrivalToken(arrivalToken(kind, "abc")).trim().length > 0);
  }

  // Matching semantics: empty means unset (matches everyone), a bare kind means
  // the whole channel, a full token means that one poster.
  check("an empty filter matches everyone", matchesArrival([], []));
  check("a full token matches exactly", matchesArrival(["qr:berlin"], ["qr:berlin"]));
  check("a full token doesn't match a different poster", !matchesArrival(["qr:berlin"], ["qr:munich"]));
  check("a bare kind matches the whole channel", matchesArrival(["qr:berlin"], ["qr"]));
  check("a bare kind doesn't match another channel", !matchesArrival(["utm:mailer"], ["qr"]));
  check("an account with no arrivals fails a filter", !matchesArrival([], ["qr:berlin"]));
  check(
    "a token that merely contains the filter doesn't match",
    !matchesArrival(["qr:berlin-window"], ["qr:berlin"]),
  );

  // Proposals are untrusted input.
  check("a direct arrival is not recorded", normalizeArrival({ kind: "direct" }, NOW) === null);
  check("an unknown kind is not recorded", normalizeArrival({ kind: "hack" }, NOW) === null);
  check("an arrival with no identifier is not recorded", normalizeArrival({ kind: "qr" }, NOW) === null);
  check(
    "a bare UTM source is still attributable",
    normalizeArrival({ kind: "utm", source: "newsletter" }, NOW)?.token === "utm:newsletter",
  );
  check(
    "a query string is stripped from the landing path",
    normalizeArrival({ kind: "qr", id: "b", landingPath: "/studio?token=secret" }, NOW)?.landingPath ===
      "/studio",
  );
  check(
    "a referrer is reduced to its host",
    normalizeArrival({ kind: "qr", id: "b", referrer: "https://ref.example/some/path?e=a@b.com" }, NOW)
      ?.referrerHost === "ref.example",
  );
  check(
    "a future timestamp is replaced with now",
    normalizeArrival({ kind: "qr", id: "b", at: NOW + 10 * DAY }, NOW)?.at === NOW,
  );

  // First touch is written once. A first touch that can be overwritten isn't one.
  const first = normalizeArrival({ kind: "qr", id: "berlin", at: NOW - 10 * DAY }, NOW)!;
  const second = normalizeArrival({ kind: "utm", id: "mailer", at: NOW }, NOW)!;
  const merged = mergeArrival(mergeArrival(emptyAcquisitionProfile(), first), second);
  check("first touch is never overwritten", merged.first?.token === "qr:berlin");
  check("last touch is always the newest", merged.latest?.token === "utm:mailer");
  check("both tokens are matchable afterwards", matchesArrival(merged.tokens, ["qr:berlin"]) && matchesArrival(merged.tokens, ["utm:mailer"]));
  check("arrivals are counted", merged.arrivals === 2);

  const repeated = mergeArrival(mergeArrival(emptyAcquisitionProfile(), first), first);
  check("a repeat scan doesn't duplicate the token", repeated.tokens.length === 1);
  check("a repeat scan still counts as an arrival", repeated.arrivals === 2);

  // A bot cycling ids must not grow a user document without bound.
  let flooded = emptyAcquisitionProfile();
  for (let i = 0; i < MAX_ARRIVAL_TOKENS * 3; i++) {
    flooded = mergeArrival(flooded, normalizeArrival({ kind: "qr", id: `poster-${i}`, at: NOW }, NOW)!);
  }
  check(
    "the token set is capped",
    flooded.tokens.length === MAX_ARRIVAL_TOKENS,
    `${flooded.tokens.length}`,
  );
  check("the cap keeps the most recent arrivals", flooded.tokens.includes(`qr:poster-${MAX_ARRIVAL_TOKENS * 3 - 1}`));
  check("the first touch survives the cap", flooded.first?.token === "qr:poster-0");

  check(
    "a garbage acquisition document reads back empty",
    normalizeAcquisitionProfile({ tokens: "nope", first: 7 }).tokens.length === 0,
  );
  check(
    "reading an acquisition profile back is idempotent",
    JSON.stringify(normalizeAcquisitionProfile(normalizeAcquisitionProfile(merged))) ===
      JSON.stringify(normalizeAcquisitionProfile(merged)),
  );
}

// ---- 16. An arrival-gated coupon reaches the right people ------------------
//
// The end-to-end property the QR feature exists for: scan the poster, hold the
// coupon; don't scan it, don't.

{
  const poster = coupon({
    id: "poster",
    issuance: "autoGrant",
    sharedCode: "",
    audience: { ...createAudience(), arrivedVia: ["qr:berlin-window"] },
  });
  const scanned = normalizeArrival({ kind: "qr", id: "berlin-window", at: NOW }, NOW)!;
  const profile = mergeArrival(emptyAcquisitionProfile(), scanned);

  check(
    "someone who scanned the poster matches its audience",
    matchesArrival(profile.tokens, poster.audience.arrivedVia),
  );
  check(
    "someone who didn't scan it does not",
    !matchesArrival(emptyAcquisitionProfile().tokens, poster.audience.arrivedVia),
  );
  check(
    "a holder of the resulting grant can use it",
    verdict({ coupon: poster, codeRecord: null, grant: grant(poster) }).ok,
  );
  check(
    "an arrival-gated coupon still can't be used without a grant",
    !verdict({ coupon: poster, codeRecord: null, grant: null }).ok,
  );

  // The same property for the hand-granted channel, and the reason the schema
  // can afford to save one with no audience at all (section 11): a coupon
  // nobody has been granted reaches nobody, whatever its audience says.
  const makeGood = coupon({
    id: "make-good",
    issuance: "adminGrant",
    sharedCode: "",
    audience: createAudience(),
  });
  check(
    "a hand-granted coupon with no audience is usable by nobody until it's granted",
    !verdict({ coupon: makeGood, codeRecord: null, grant: null }).ok,
  );
  check(
    "and by exactly the person it was granted to once it is",
    verdict({ coupon: makeGood, codeRecord: null, grant: grant(makeGood) }).ok,
  );
  check(
    "a revoked grant takes it away again",
    !verdict({
      coupon: makeGood,
      codeRecord: null,
      grant: { ...grant(makeGood), revoked: true },
    }).ok,
  );
}

// ---- 17. Tracked QR codes: what's encoded, and where a scan lands ----------
//
// The two halves of the `/q/{id}` indirection have to agree, and neither is
// visible to typechecking: one decides what gets printed (permanently), the
// other decides where a scan goes. The expensive failures are a code that
// encodes something unresolvable, a redirect that loops, and an open redirect
// that lends our domain to somebody else's URL.

{
  const SITE = "https://childbooks.test";
  const plain = { id: "abc-123", data: "https://childbooks.test/shop", tracked: false };
  const tracked = { ...plain, tracked: true };

  check(
    "an untracked code encodes its destination verbatim",
    qrEncodedValue(plain, SITE) === plain.data,
  );
  check(
    "a tracked code encodes the /q/ hop instead",
    qrEncodedValue(tracked, SITE) === `${SITE}/q/abc-123`,
  );
  check(
    "a trailing slash on the site URL doesn't double up",
    qrEncodedValue(tracked, `${SITE}/`) === `${SITE}/q/abc-123`,
  );
  check(
    "with no site URL configured, a tracked code falls back to the destination",
    // Rather than encoding a bare "/q/x", which would print a code that
    // resolves to nothing at all.
    qrEncodedValue(tracked, "") === plain.data,
  );
  check(
    "turning tracking on never encodes an empty string",
    qrEncodedValue({ ...tracked, data: "" }, SITE).length > 0,
  );

  // The round trip that makes an arrival-gated coupon work: the `?qr=` value on
  // the destination has to normalize to the same token the coupon matches on.
  const landing = new URL(qrScanDestination(plain.data, plain.id, SITE));
  check(
    "a scan lands on the destination with its arrival token attached",
    landing.origin + landing.pathname === plain.data &&
      landing.searchParams.get("qr") === "abc-123",
  );
  check(
    "the token derived from the landing URL is the one the audience matches",
    arrivalToken("qr", landing.searchParams.get("qr") ?? "") === arrivalToken("qr", plain.id),
  );
  check(
    "an existing query string on the destination survives",
    new URL(qrScanDestination("https://childbooks.test/shop?a=1", plain.id, SITE)).searchParams.get(
      "a",
    ) === "1",
  );

  check(
    "a destination that is itself a /q/ path is refused rather than looped",
    qrScanDestination(`${SITE}/q/abc-123`, "abc-123", SITE) === "",
  );
  check(
    "so is the bare /q path",
    qrScanDestination(`${SITE}/q`, "abc-123", SITE) === "",
  );
  check(
    "a path that merely starts with q is not mistaken for the redirect",
    qrScanDestination(`${SITE}/questions`, "abc-123", SITE) !== "",
  );

  const offsite = qrScanDestination("https://example.com/partner", plain.id, SITE);
  check("an off-site destination still resolves", offsite !== "");
  check(
    "but is never tagged with our tracking parameter",
    !new URL(offsite).searchParams.has("qr"),
  );
  check(
    "a non-http destination is refused, so /q/ can't be an open redirect",
    qrScanDestination("javascript:alert(1)", plain.id, SITE) === "" &&
      qrScanDestination("data:text/html,<script>", plain.id, SITE) === "",
  );
  check(
    "a plain-text QR has nowhere to redirect to",
    // `new URL` would read this as a path on our own domain and return a 404
    // with a straight face, so it has to be rejected before parsing.
    qrScanDestination("Call us on 0800 123", plain.id, SITE) === "" &&
      qrScanDestination("childbooks.test/shop", plain.id, SITE) === "",
  );
  check(
    "a site-relative destination still works",
    qrScanDestination("/shop", plain.id, SITE) === `${SITE}/shop?qr=abc-123`,
  );
  check(
    "an empty destination has nowhere to redirect to",
    qrScanDestination("   ", plain.id, SITE) === "",
  );

  check(
    "normalizing a config leaves existing codes untracked",
    // The default that protects everything already printed: tracking is opted
    // into, never inferred.
    normalizeQrCodesConfig({ codes: [{ id: "x", data: "https://childbooks.test" }] }).codes[0]
      ?.tracked === false,
  );
  check(
    "and preserves it once opted in",
    normalizeQrCodesConfig({
      codes: [{ id: "x", data: "https://childbooks.test", tracked: true }],
    }).codes[0]?.tracked === true,
  );
}

// ---- 18. A membership discount survives the trip through Stripe ------------

// Memberships are the one purchase we don't price ourselves: Stripe raises the
// invoice, so the resolved discount has to leave here as a single Stripe coupon
// carrying a single percentage. Two things can go wrong quietly. The checkout
// can fail to work out what it's charging, in which case every "minimum order"
// restriction passes against a subtotal of zero and the coupon is booked as
// costing nothing. Or the resolver can hand back a total Stripe won't take,
// which fails the checkout for a customer who did nothing wrong.
{
  const plansConfig = normalizePlansConfig({
    plans: [
      {
        id: "plan-family",
        billing: {
          prices: {
            USD: {
              month: { amount: 8, stripePriceIds: { live: "price_m_live" }, active: true },
              year: { amount: 80, stripePriceIds: { live: "price_y_live" }, active: true },
            },
            EUR: { month: { amount: 7, stripePriceIds: { live: "price_m_eur" }, active: true } },
            // Superseded in Stripe, but a subscriber is still on it.
            GBP: { month: { amount: 6, stripePriceIds: { live: "price_m_old" }, active: false } },
          },
        },
      },
    ],
  });
  // Never `.plans[0]`: normalizing guarantees a free baseline plan at the front.
  const plan = plansConfig.plans.find((p) => p.id === "plan-family")!;

  check(
    "the plan that owns a price id is the one found",
    resolvePlanByPriceId(plansConfig, "price_y_live")?.id === "plan-family",
  );

  const monthly = pricePointForId(plan, "price_m_live");
  check(
    "a plan price resolves to the amount a coupon is measured against",
    monthly?.point.amount === 8 && monthly?.currency === "USD" && monthly?.interval === "month",
    JSON.stringify(monthly),
  );
  check(
    "the annual price resolves to the annual amount, not the monthly one",
    pricePointForId(plan, "price_y_live")?.point.amount === 80,
  );
  check(
    "a non-USD price keeps its own currency",
    pricePointForId(plan, "price_m_eur")?.currency === "EUR",
  );
  check(
    "an archived price still resolves, so a legacy subscriber isn't priced at zero",
    pricePointForId(plan, "price_m_old")?.point.amount === 6,
  );
  check(
    "an unknown price id resolves to nothing rather than to the first plan it sees",
    pricePointForId(plan, "price_not_ours") === null,
  );

  // Whatever wins, and however many sources stack, Stripe gets ONE percentage.
  // It must be expressible: 1–100, and at most two decimal places.
  let expressible = true;
  for (const [a, b] of [
    [10, 15],
    [33.3, 33.3],
    [7.5, 0.5],
    [99, 99],
    [1, 1],
  ] as const) {
    const out = resolveBestDiscount({
      candidates: [
        candidate({ handle: "a", percentOff: a, stackable: true }),
        candidate({ handle: "b", percentOff: b, stackable: true }),
      ],
      maxDiscountPct: 100,
    });
    if (out.percentOff <= 0) continue;
    if (out.percentOff > 100) expressible = false;
    // Compared through `toFixed` rather than by multiplying up: 66.6 is a
    // perfectly good two-decimal percentage that fails an arithmetic test on
    // binary floats, while 66.60000000000001 — what summing two 33.3% offers
    // actually produces before rounding — is the value Stripe refuses.
    if (Number(out.percentOff.toFixed(2)) !== out.percentOff) expressible = false;
  }
  check("a resolved total is always a percentage Stripe will accept", expressible);
}

// ---- Report -----------------------------------------------------------------

console.log(`${checks.length} invariant(s) held.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} invariant(s) FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log("All coupon invariants hold.");
}
