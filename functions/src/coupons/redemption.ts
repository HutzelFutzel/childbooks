/**
 * The coupon **lifecycle** — validate, reserve, settle, release, restore.
 *
 * ## The five states, and why there are five
 *
 * A naive coupon system has two: unused and used. That system double-spends
 * single-use codes on a double-submitted checkout, and permanently burns codes
 * on checkouts the customer abandoned. So:
 *
 *   reserved  → a checkout is in flight holding this code
 *   redeemed  → the payment settled; the use is spent
 *   released  → the checkout went away; the use went back
 *   restored  → a refund gave the use back
 *   void      → an owner cancelled it
 *
 * `released` is the state the referral and campaign engines learned the hard way
 * they needed. Their reservations simply LAPSE after a TTL, which means an
 * abandoned checkout locks a discount for thirty minutes; for a single-use coupon
 * that's thirty minutes of "that code has already been used" for the person
 * holding it. Here, `checkout.session.expired` releases explicitly.
 *
 * ## Validation happens twice, on purpose
 *
 * {@link previewCoupon} answers "would this work?" with no side effects, and
 * {@link reserveCoupon} re-answers it inside a transaction with authoritative
 * counters. Both call the SAME pure {@link validateCoupon}, because a customer
 * quoted a discount they then don't get is the single most expensive bug class in
 * a promotions engine. The duplication is the reservation, never the rules.
 *
 * ## What this module refuses to do
 *
 * It never decides whether a coupon BEATS another discount — that's
 * {@link resolveBestDiscount}, shared with the referral and campaign paths and
 * called from one place in `stripe.ts`. Two modules deciding stacking is how you
 * end up selling below cost.
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  couponDiscountPercent,
  freezeCouponTerms,
  issuanceUsesCodes,
  normalizeCouponCode,
  validateCoupon,
  type Coupon,
  type CouponGrantRecord,
  type CouponPurchaseFacts,
  type CouponRedemptionRecord,
  type CouponTerms,
  type CouponUserFacts,
  type CouponVerdict,
} from "../../../books-frontend/src/core/config/coupons";
import { matchesArrival } from "../../../books-frontend/src/core/profile/acquisition";
import type { DiscountItemType } from "../../../books-frontend/src/core/config/discountImpact";
import { getCouponsConfig } from "../appConfig";
import { userFacts } from "../campaigns/facts";
import { readAcquisition } from "../acquisition";
import {
  accountUsageId,
  ACCOUNT_USAGE,
  bumpCounters,
  CODES,
  createGrant,
  db,
  GRANTS,
  grantId,
  isAlreadyExists,
  listGrantsFor,
  normalizeCodeRecord,
  normalizeRedemption,
  readCode,
  readGrant,
  readUsage,
  redemptionId,
  REDEMPTIONS,
  redemptionsForPayment,
  safeId,
} from "./store";
import { bumpStats, recordRejection } from "./stats";

// ---- Facts ------------------------------------------------------------------

/**
 * Everything coupon validation needs about an account.
 *
 * Built from the campaign engine's `userFacts` rather than a second assembler,
 * for the reason that module's docstring gives: if the coupon path decided
 * "subscriber" one way and the campaign path another, a customer would be quoted
 * an offer they then don't get.
 */
export async function couponUserFacts(uid: string): Promise<CouponUserFacts> {
  const facts = await userFacts(uid);
  return {
    uid,
    anonymous: facts.anonymous,
    emailVerified: facts.emailVerified,
    createdAt: facts.createdAt,
    country: facts.country,
    isSubscriber: facts.isSubscriber,
    planId: facts.planId,
    purchaseCount: facts.purchaseCount,
    arrivedVia: facts.arrivedVia,
  };
}

function findCoupon(coupons: Coupon[], id: string): Coupon | null {
  return coupons.find((c) => c.id === id) ?? null;
}

// ---- Preview ----------------------------------------------------------------

export interface CouponPreview {
  verdict: CouponVerdict;
}

/**
 * Would this code work on this purchase? No reservation, no side effects beyond
 * telemetry.
 *
 * This is what the checkout's "apply code" field calls. It counts the attempt
 * either way, because the rejection tally is the only thing that distinguishes a
 * code nobody has from a code whose cap is spent.
 */
export async function previewCoupon(args: {
  uid: string;
  code: string;
  purchase: CouponPurchaseFacts;
}): Promise<CouponVerdict> {
  const config = await getCouponsConfig();
  const code = normalizeCouponCode(args.code);
  if (!code) {
    await recordRejection(null, "unknown_code");
    return { ok: false, reason: "unknown_code", message: "That code isn't valid. Check it and try again." };
  }
  if (!config.enabled) {
    await recordRejection(null, "engine_disabled");
    return {
      ok: false,
      reason: "engine_disabled",
      message: "That code isn't valid. Check it and try again.",
    };
  }

  const codeRecord = await readCode(code);
  const coupon = codeRecord ? findCoupon(config.coupons, codeRecord.couponId) : null;
  if (!codeRecord || !coupon) {
    // Attributed to the synthetic unknown bucket — a spike there is somebody
    // guessing at codes, which is worth being able to see.
    await recordRejection(null, "unknown_code");
    return {
      ok: false,
      reason: "unknown_code",
      message: "That code isn't valid. Check it and try again.",
    };
  }

  const [user, usage] = await Promise.all([
    couponUserFacts(args.uid),
    readUsage({ couponId: coupon.id, uid: args.uid, code }),
  ]);
  const verdict = validateCoupon({
    coupon,
    codeRecord,
    user,
    purchase: args.purchase,
    usage,
    enabled: config.enabled,
  });

  if (verdict.ok) await bumpStats(coupon.id, { accepted: 1 });
  else await recordRejection(coupon.id, verdict.reason);
  return verdict;
}

// ---- Candidates for the checkout resolver ----------------------------------

/**
 * A coupon that could apply to this purchase, in the shape the shared discount
 * resolver compares against referral and campaign offers.
 *
 * `handle` is what {@link reserveCoupon} is later called with. Carrying the
 * frozen terms rather than the coupon id is what makes the reservation honor the
 * promise that was evaluated, even if the coupon was edited in between.
 */
export interface CouponCandidate {
  couponId: string;
  couponName: string;
  code: string | null;
  percentOff: number;
  discountAmount: number;
  summary: string;
  notes: string[];
  terms: CouponTerms;
  stackable: boolean;
  priority: number;
}

/**
 * Every coupon this account could use on this purchase: the code they typed (if
 * any) plus every no-code coupon they hold a grant for.
 *
 * Best-percentage first. Deliberately NOT priority-first: priority breaks ties
 * for the operator's benefit, but a customer offered 20% and charged 10%
 * experiences a bug whatever the config says.
 *
 * Never throws. A coupon lookup must not be the reason a purchase can't start.
 */
export async function couponCandidates(args: {
  uid: string;
  purchase: CouponPurchaseFacts;
  /** A code the customer typed at checkout, if any. */
  code?: string | null;
}): Promise<{ candidates: CouponCandidate[]; typedCodeVerdict: CouponVerdict | null }> {
  try {
    const config = await getCouponsConfig();
    if (!config.enabled) return { candidates: [], typedCodeVerdict: null };

    const [user, grants] = await Promise.all([
      couponUserFacts(args.uid),
      listGrantsFor(args.uid),
    ]);

    const candidates: CouponCandidate[] = [];
    let typedCodeVerdict: CouponVerdict | null = null;

    const consider = async (
      coupon: Coupon,
      codeRecord: Awaited<ReturnType<typeof readCode>>,
      grant: CouponGrantRecord | null,
    ): Promise<CouponVerdict> => {
      const usage = await readUsage({
        couponId: coupon.id,
        uid: args.uid,
        code: codeRecord?.code ?? null,
      });
      const verdict = validateCoupon({
        coupon,
        codeRecord,
        grant,
        user,
        purchase: args.purchase,
        usage,
        enabled: config.enabled,
      });
      if (verdict.ok) {
        candidates.push({
          couponId: verdict.couponId,
          couponName: verdict.couponName,
          code: verdict.code,
          percentOff: verdict.percentOff,
          discountAmount: verdict.discountAmount,
          summary: verdict.summary,
          notes: verdict.notes,
          terms: verdict.terms,
          stackable: verdict.stackable,
          priority: verdict.priority,
        });
      }
      return verdict;
    };

    if (args.code) {
      const code = normalizeCouponCode(args.code);
      const codeRecord = code ? await readCode(code) : null;
      const coupon = codeRecord ? findCoupon(config.coupons, codeRecord.couponId) : null;
      if (!coupon || !codeRecord) {
        typedCodeVerdict = {
          ok: false,
          reason: "unknown_code",
          message: "That code isn't valid. Check it and try again.",
        };
      } else {
        typedCodeVerdict = await consider(coupon, codeRecord, null);
      }
    }

    for (const grant of grants) {
      const coupon = findCoupon(config.coupons, grant.couponId);
      if (!coupon) continue;
      // A grant for a coupon they ALSO typed a code for would double-count the
      // same offer, so the typed code wins (it's the one they chose).
      if (candidates.some((c) => c.couponId === coupon.id)) continue;
      await consider(coupon, null, grant);
    }

    candidates.sort((a, b) => b.percentOff - a.percentOff || b.priority - a.priority);
    return { candidates, typedCodeVerdict };
  } catch (err) {
    console.warn("[coupons] candidate lookup failed", err);
    return { candidates: [], typedCodeVerdict: null };
  }
}

// ---- Reserve ----------------------------------------------------------------

/**
 * Hold a coupon for a checkout attempt.
 *
 * Returns false when someone got there first, in which case the caller charges
 * the undiscounted price rather than risk giving one single-use code away twice.
 *
 * The transaction does four things atomically: re-read the code, re-check the
 * caps against authoritative counters, bump the code's `reservedCount`, and
 * create the redemption. Splitting any of those out reintroduces the race — in
 * particular, checking the cap outside the transaction is exactly how two
 * simultaneous checkouts both pass a `maxRedemptions: 1` coupon.
 *
 * `percentOff` and `discountAmount` are passed in by the caller rather than
 * recomputed, because the caller has already clamped them against the catalog
 * maximum and the break-even headroom. Recomputing here would silently undo
 * those clamps.
 */
export async function reserveCoupon(args: {
  uid: string;
  candidate: CouponCandidate;
  paymentRef: string;
  itemType: DiscountItemType;
  /** After every clamp — this is what actually comes off the price. */
  percentOff: number;
  discountAmount: number;
  originalSubtotal: number;
  currency: string;
}): Promise<boolean> {
  const { candidate } = args;
  if (!args.paymentRef || args.percentOff <= 0) return false;
  const id = redemptionId(candidate.couponId, args.uid, args.paymentRef);

  try {
    return await db().runTransaction(async (tx) => {
      const redemptionRef = db().doc(`${REDEMPTIONS}/${id}`);
      const codeRef = candidate.code ? db().doc(`${CODES}/${candidate.code}`) : null;
      const accountRef = db().doc(
        `${ACCOUNT_USAGE}/${accountUsageId(args.uid, candidate.couponId)}`,
      );
      const grantRef = candidate.code
        ? null
        : db().doc(`${GRANTS}/${grantId(args.uid, candidate.couponId)}`);

      const [existing, codeSnap, accountSnap] = await Promise.all([
        tx.get(redemptionRef),
        codeRef ? tx.get(codeRef) : Promise.resolve(null),
        tx.get(accountRef),
      ]);

      // Same payment, same coupon, already held or spent: idempotent success.
      if (existing.exists) {
        const current = normalizeRedemption(existing.id, existing.data());
        return current.status === "reserved" || current.status === "redeemed";
      }

      const r = candidate.terms.restrictions;

      if (codeRef && codeSnap) {
        if (!codeSnap.exists) return false;
        const record = normalizeCodeRecord(candidate.code!, codeSnap.data());
        if (record.revoked) return false;
        if (record.boundUid && record.boundUid !== args.uid) return false;
        if (r.maxPerCode > 0 && record.redeemedCount + record.reservedCount >= r.maxPerCode) {
          return false;
        }
      }

      if (r.maxPerAccount > 0) {
        const redeemed = accountSnap.exists ? Number(accountSnap.get("redeemed") ?? 0) : 0;
        const reserved = accountSnap.exists ? Number(accountSnap.get("reserved") ?? 0) : 0;
        if (redeemed + reserved >= r.maxPerAccount) return false;
      }

      if (grantRef) {
        const grantSnap = await tx.get(grantRef);
        if (!grantSnap.exists || grantSnap.get("revoked") === true) return false;
      }

      const record: Omit<CouponRedemptionRecord, "id"> = {
        couponId: candidate.couponId,
        couponName: candidate.couponName,
        code: candidate.code,
        uid: args.uid,
        paymentRef: args.paymentRef,
        status: "reserved",
        itemType: args.itemType,
        percentOff: args.percentOff,
        discountAmount: round2(args.discountAmount),
        originalSubtotal: round2(args.originalSubtotal),
        currency: args.currency.toUpperCase(),
        terms: candidate.terms,
        createdAt: Date.now(),
        settledAt: null,
        releasedAt: null,
        note: null,
      };
      tx.create(redemptionRef, record);
      if (codeRef) tx.set(codeRef, { reservedCount: FieldValue.increment(1) }, { merge: true });
      tx.set(
        accountRef,
        {
          uid: args.uid,
          couponId: candidate.couponId,
          reserved: FieldValue.increment(1),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      return true;
    });
  } catch (err) {
    if (isAlreadyExists(err)) return true;
    console.warn("[coupons] could not reserve", candidate.couponId, err);
    return false;
  }
}

// ---- Settle -----------------------------------------------------------------

export interface SettledCoupon {
  redemption: CouponRedemptionRecord;
  /** Uses left on this coupon for this account after settling (null = unlimited). */
  usesLeft: number | null;
}

/**
 * Convert every reservation on a settled payment into a real redemption, and
 * book what it cost.
 *
 * The cost is booked HERE rather than at reserve time for the same reason the
 * campaign engine books it late: until the payment clears, the discount has cost
 * nothing, and a budget that counted unsettled reservations would throttle a
 * coupon on money it never spent.
 *
 * Returns what settled, so the caller can fire the email and the Slack ping.
 * Those are deliberately NOT sent from in here: this function runs inside a
 * webhook that Stripe will retry, and a notification sent from a retried path
 * has to be deduplicated by the notifier, not hidden by the settler.
 */
export async function settleCoupons(args: {
  paymentRef: string;
  /** Order revenue in the base currency, for the return-on-discount report. */
  revenue?: number;
  /** True when the buyer had no prior purchase — the acquisition signal. */
  isNewCustomer?: boolean;
}): Promise<SettledCoupon[]> {
  if (!args.paymentRef) return [];
  const settled: SettledCoupon[] = [];
  try {
    const held = await redemptionsForPayment(args.paymentRef);
    for (const redemption of held) {
      if (redemption.status !== "reserved") continue;

      const applied = await db().runTransaction(async (tx) => {
        const ref = db().doc(`${REDEMPTIONS}/${redemption.id}`);
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const current = normalizeRedemption(snap.id, snap.data());
        // A webhook retry lands here; anything already moved on is a no-op.
        if (current.status !== "reserved") return false;
        tx.set(ref, { status: "redeemed", settledAt: Date.now() }, { merge: true });
        if (current.code) {
          tx.set(
            db().doc(`${CODES}/${current.code}`),
            {
              redeemedCount: FieldValue.increment(1),
              reservedCount: FieldValue.increment(-1),
              lastRedeemedAt: Date.now(),
            },
            { merge: true },
          );
        }
        tx.set(
          db().doc(`${ACCOUNT_USAGE}/${accountUsageId(current.uid, current.couponId)}`),
          { reserved: FieldValue.increment(-1) },
          { merge: true },
        );
        return true;
      });
      if (!applied) continue;

      await bumpCounters({
        couponId: redemption.couponId,
        uid: redemption.uid,
        uses: 1,
        discount: redemption.discountAmount,
        revenue: args.revenue ?? 0,
      });
      await bumpStats(redemption.couponId, {
        redemptions: 1,
        discount: redemption.discountAmount,
        revenue: args.revenue ?? 0,
        orders: 1,
        newCustomers: args.isNewCustomer ? 1 : 0,
      });
      if (!redemption.code) {
        await db()
          .doc(`${GRANTS}/${grantId(redemption.uid, redemption.couponId)}`)
          .set({ redeemedCount: FieldValue.increment(1) }, { merge: true })
          .catch(() => {});
      }

      settled.push({
        redemption: { ...redemption, status: "redeemed", settledAt: Date.now() },
        usesLeft: await remainingUsesForAccount(redemption.uid, redemption.couponId),
      });
    }
  } catch (err) {
    // A settlement failure must not fail the webhook — the payment is real
    // either way, and a stuck reservation is recoverable where a 500 loop isn't.
    console.warn("[coupons] could not settle", args.paymentRef, err);
  }
  return settled;
}

/** Uses this account has left on this coupon (null = uncapped). */
async function remainingUsesForAccount(uid: string, couponId: string): Promise<number | null> {
  try {
    const config = await getCouponsConfig();
    const coupon = findCoupon(config.coupons, couponId);
    const max = coupon?.restrictions.maxPerAccount ?? 0;
    if (max <= 0) return null;
    const snap = await db().doc(`${ACCOUNT_USAGE}/${accountUsageId(uid, couponId)}`).get();
    const used = snap.exists ? Number(snap.get("redeemed") ?? 0) : 0;
    return Math.max(0, max - used);
  } catch {
    return null;
  }
}

// ---- Release ----------------------------------------------------------------

/**
 * Give back every reservation on a checkout that went away.
 *
 * Called on `checkout.session.expired` and on explicit cancellation. This is the
 * step the referral and campaign engines don't have, and its absence is why an
 * abandoned checkout locks their discount for the full TTL — for a single-use
 * coupon, that's the customer being told their code is already used while
 * they're still trying to buy something.
 */
export async function releaseCoupons(paymentRef: string, reason = "expired"): Promise<number> {
  if (!paymentRef) return 0;
  let released = 0;
  try {
    const held = await redemptionsForPayment(paymentRef);
    for (const redemption of held) {
      if (redemption.status !== "reserved") continue;
      const ok = await db().runTransaction(async (tx) => {
        const ref = db().doc(`${REDEMPTIONS}/${redemption.id}`);
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const current = normalizeRedemption(snap.id, snap.data());
        if (current.status !== "reserved") return false;
        tx.set(
          ref,
          { status: "released", releasedAt: Date.now(), note: reason.slice(0, 200) },
          { merge: true },
        );
        if (current.code) {
          tx.set(
            db().doc(`${CODES}/${current.code}`),
            { reservedCount: FieldValue.increment(-1) },
            { merge: true },
          );
        }
        tx.set(
          db().doc(`${ACCOUNT_USAGE}/${accountUsageId(current.uid, current.couponId)}`),
          { reserved: FieldValue.increment(-1) },
          { merge: true },
        );
        return true;
      });
      if (ok) {
        released++;
        await bumpStats(redemption.couponId, { released: 1 });
      }
    }
  } catch (err) {
    console.warn("[coupons] could not release", paymentRef, err);
  }
  return released;
}

// ---- Refunds ----------------------------------------------------------------

/**
 * Give a use back after a refund, according to each coupon's own policy.
 *
 * The three policies exist because the honest answer differs by situation. A
 * customer whose order we cancelled should get their one-time code back
 * (`restoreOnFullRefund`, matching how referral and campaign clawback already
 * behave). A partial refund for a damaged copy shouldn't cost them the code
 * either, if the operator says so (`restoreAlways`). And a make-good coupon
 * issued *because* something went wrong shouldn't come back when the refund it
 * accompanies lands (`consume`).
 *
 * `isFullRefund` is passed rather than inferred: only the caller knows whether
 * the refunded amount was everything.
 */
export async function restoreCouponsForRefund(args: {
  paymentRef: string;
  isFullRefund: boolean;
}): Promise<number> {
  if (!args.paymentRef) return 0;
  let restored = 0;
  try {
    const redemptions = await redemptionsForPayment(args.paymentRef);
    for (const redemption of redemptions) {
      if (redemption.status !== "redeemed") continue;
      const policy = redemption.terms?.restrictions.refundPolicy ?? "restoreOnFullRefund";
      if (policy === "consume") continue;
      if (policy === "restoreOnFullRefund" && !args.isFullRefund) continue;

      const ok = await db().runTransaction(async (tx) => {
        const ref = db().doc(`${REDEMPTIONS}/${redemption.id}`);
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const current = normalizeRedemption(snap.id, snap.data());
        if (current.status !== "redeemed") return false;
        tx.set(
          ref,
          {
            status: "restored",
            releasedAt: Date.now(),
            note: args.isFullRefund ? "refunded in full" : "partially refunded",
          },
          { merge: true },
        );
        if (current.code) {
          tx.set(
            db().doc(`${CODES}/${current.code}`),
            { redeemedCount: FieldValue.increment(-1) },
            { merge: true },
          );
        }
        return true;
      });
      if (!ok) continue;

      restored++;
      // The discount is reversed out of the budget too: money that came back
      // isn't money the coupon spent, and leaving it booked would retire a
      // coupon's budget on refunded orders.
      await bumpCounters({
        couponId: redemption.couponId,
        uid: redemption.uid,
        uses: -1,
        discount: -redemption.discountAmount,
      });
      await bumpStats(redemption.couponId, {
        restored: 1,
        discount: -redemption.discountAmount,
      });
      if (!redemption.code) {
        await db()
          .doc(`${GRANTS}/${grantId(redemption.uid, redemption.couponId)}`)
          .set({ redeemedCount: FieldValue.increment(-1) }, { merge: true })
          .catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[coupons] could not restore after refund", args.paymentRef, err);
  }
  return restored;
}

// ---- Auto-granting ----------------------------------------------------------

export interface GrantedCoupon {
  coupon: Coupon;
  grant: CouponGrantRecord;
}

/**
 * Give this account every no-code coupon its arrival entitles it to.
 *
 * Called after signup and after an arrival is recorded for an existing account —
 * the two moments the answer can change. Idempotent by construction: the grant
 * document id is `{uid}__{couponId}` and creation uses `create`, so only the
 * first attempt returns a grant and only the first attempt emails.
 *
 * The audience is evaluated ONCE and its terms frozen, exactly like a campaign
 * enrollment. Somebody who scanned a poster promising 20% keeps 20% even if the
 * coupon is edited down to 10% tomorrow.
 */
export async function autoGrantCoupons(args: {
  uid: string;
  /** Which arrival triggered this, for the audit trail. */
  source?: string;
}): Promise<GrantedCoupon[]> {
  const granted: GrantedCoupon[] = [];
  try {
    const config = await getCouponsConfig();
    if (!config.enabled) return [];
    const candidates = config.coupons.filter(
      (c) => c.status === "active" && c.issuance === "autoGrant",
    );
    if (candidates.length === 0) return [];

    const [acquisition, facts] = await Promise.all([
      readAcquisition(args.uid),
      couponUserFacts(args.uid),
    ]);
    const now = Date.now();

    for (const coupon of candidates) {
      const a = coupon.audience;
      if (!matchesArrival(acquisition.tokens, a.arrivedVia)) continue;
      if (a.signedUpFrom > 0 && facts.createdAt < a.signedUpFrom) continue;
      if (a.signedUpTo > 0 && facts.createdAt > a.signedUpTo) continue;
      if (a.allowlistUids.length > 0 && !a.allowlistUids.includes(args.uid)) continue;
      // The window is checked at grant time as well as at redemption: granting
      // an expired coupon would email somebody a promise that can't be kept.
      const r = coupon.restrictions;
      if (r.endsAt > 0 && now > r.endsAt) continue;
      // Guests are excluded unless the coupon explicitly opens itself to them,
      // for the same reason campaigns exclude them: a guest costs nothing to
      // create, so anything of value handed to one is a faucet.
      if (facts.anonymous && !r.allowGuests) continue;

      const grant = await createGrant({
        uid: args.uid,
        couponId: coupon.id,
        terms: freezeCouponTerms(coupon, now),
        source: args.source || acquisition.latest?.token || "auto",
      });
      if (grant) granted.push({ coupon, grant });
    }
  } catch (err) {
    // Never allowed to break signup.
    console.warn("[coupons] auto-grant failed for", args.uid, err);
  }
  return granted;
}

/** Attach a coupon to one named account by hand (the make-good path). */
export async function grantCouponManually(args: {
  uid: string;
  couponId: string;
  by: string;
}): Promise<GrantedCoupon | null> {
  const config = await getCouponsConfig();
  const coupon = findCoupon(config.coupons, args.couponId);
  if (!coupon) throw new Error("That coupon doesn't exist.");
  if (issuanceUsesCodes(coupon.issuance)) {
    throw new Error(
      `"${coupon.name}" is a code-based coupon — generate a code for it instead of granting it.`,
    );
  }
  const grant = await createGrant({
    uid: args.uid,
    couponId: coupon.id,
    terms: freezeCouponTerms(coupon),
    source: `admin:${safeId(args.by)}`,
  });
  return grant ? { coupon, grant } : null;
}

// ---- Customer-visible state -------------------------------------------------

/** One coupon the customer holds, as their wallet shows it. */
export interface CouponWalletEntry {
  couponId: string;
  /** Present only when there's a code they'd type. */
  code: string | null;
  summary: string;
  notes: string[];
  /** 0 = open-ended. */
  endsAt: number;
  /** Null = uncapped. */
  usesLeft: number | null;
  /** True when it applies itself with nothing to type. */
  automatic: boolean;
  /** Set when it can't currently be used, phrased for them to read. */
  blockedReason: string | null;
}

/**
 * What the customer holds right now.
 *
 * The whole reason this endpoint exists: an auto-applied coupon the customer
 * can't see is indistinguishable from no coupon at all, and one they can't see
 * the CAVEATS of is worse — they find out at checkout that "20% off" meant print
 * only. So the notes come along, and so does the blocking reason when there is
 * one.
 *
 * Deliberately evaluated against a neutral purchase (no item, no amount) so a
 * restriction that only bites at checkout doesn't read here as a hard block. The
 * customer is being told what they HAVE, not what this particular basket would
 * get.
 */
export async function couponWallet(uid: string): Promise<CouponWalletEntry[]> {
  try {
    const config = await getCouponsConfig();
    if (!config.enabled) return [];
    const grants = await listGrantsFor(uid);
    if (grants.length === 0) return [];

    const entries: CouponWalletEntry[] = [];
    for (const grant of grants) {
      const coupon = findCoupon(config.coupons, grant.couponId);
      if (!coupon) continue;
      const terms = grant.terms;
      const max = terms.restrictions.maxPerAccount;
      const usesLeft = max > 0 ? Math.max(0, max - grant.redeemedCount) : null;
      // A fully-spent coupon is dropped rather than shown as unusable: "you have
      // a discount, but no" is not information.
      if (usesLeft === 0) continue;

      const expired = terms.restrictions.endsAt > 0 && Date.now() > terms.restrictions.endsAt;
      const paused = coupon.status !== "active";
      entries.push({
        couponId: coupon.id,
        code: null,
        summary: terms.summary,
        notes: terms.notes,
        endsAt: terms.restrictions.endsAt,
        usesLeft,
        automatic: true,
        blockedReason: expired
          ? "This offer has expired."
          : paused
            ? "This offer is paused right now."
            : null,
      });
    }
    return entries;
  } catch (err) {
    console.warn("[coupons] wallet lookup failed for", uid, err);
    return [];
  }
}

/** History for the customer's own view, newest first. */
export async function couponHistory(uid: string, limit = 20): Promise<CouponRedemptionRecord[]> {
  const snap = await db()
    .collection(REDEMPTIONS)
    .where("uid", "==", uid)
    .where("status", "==", "redeemed")
    .limit(limit)
    .get();
  return snap.docs
    .map((d) => normalizeRedemption(d.id, d.data()))
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
}

// ---- Admin actions ----------------------------------------------------------

/** Cancel one redemption by hand, handing the use back. */
export async function voidRedemption(id: string, by: string): Promise<boolean> {
  try {
    return await db().runTransaction(async (tx) => {
      const ref = db().doc(`${REDEMPTIONS}/${id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const current = normalizeRedemption(snap.id, snap.data());
      if (current.status === "void") return true;
      tx.set(
        ref,
        { status: "void", releasedAt: Date.now(), note: `voided by ${safeId(by)}` },
        { merge: true },
      );
      if (current.code && current.status === "redeemed") {
        tx.set(
          db().doc(`${CODES}/${current.code}`),
          { redeemedCount: FieldValue.increment(-1) },
          { merge: true },
        );
      }
      if (current.code && current.status === "reserved") {
        tx.set(
          db().doc(`${CODES}/${current.code}`),
          { reservedCount: FieldValue.increment(-1) },
          { merge: true },
        );
      }
      return true;
    });
  } catch (err) {
    console.warn("[coupons] could not void", id, err);
    return false;
  }
}

/** Recompute what a coupon would take off a subtotal — for the admin simulator. */
export function simulateCoupon(coupon: Coupon, subtotal: number) {
  return couponDiscountPercent(coupon.mechanic, subtotal);
}

/** The one place a grant's terms are refreshed to the coupon's current shape. */
export async function refreshGrantTerms(uid: string, couponId: string): Promise<boolean> {
  const config = await getCouponsConfig();
  const coupon = findCoupon(config.coupons, couponId);
  const grant = await readGrant(uid, couponId);
  if (!coupon || !grant) return false;
  await db()
    .doc(`${GRANTS}/${grantId(uid, couponId)}`)
    .set({ terms: freezeCouponTerms(coupon), termsRefreshedAt: Date.now() }, { merge: true });
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
