/**
 * Firestore access for the coupon engine — collection paths, stored shapes, and
 * the primitives the rest of the modules share.
 *
 * Collections (all backend-only; see `firestore.rules`):
 *   - `couponCodes/{CODE}`                    the redeemable string. The doc id IS
 *                                               the normalized code, so validating
 *                                               a typed code is one point read
 *   - `couponGrants/{uid}__{couponId}`        one account's entitlement to a
 *                                               no-code coupon, with FROZEN terms
 *   - `couponRedemptions/{id}`                one application to one payment; the
 *                                               doc id IS the idempotency key
 *   - `couponCounters/{couponId}`             global redemption + spend counters
 *   - `couponAccountUsage/{uid}__{couponId}`  per-account redemption counter
 *   - `couponStats/{couponId}__{YYYY-MM-DD}`  daily counters for the admin report
 *
 * ## Why the code is the document id
 *
 * The alternative — a `where("code", "==", …)` query — costs an index, a query
 * round trip, and (fatally) can't be read inside a transaction the same way a
 * point read can. Code validation happens on the checkout path, and the reserve
 * step MUST re-read the code transactionally to hold a single-use code against a
 * double submit. Making the code the id is what makes that a one-document
 * transaction instead of a query-then-write race.
 *
 * ## Why counters are separate documents
 *
 * A popular shared code is a hot key. Keeping the global counter, the per-account
 * counter and the per-code counter in three documents means two concurrent
 * checkouts by DIFFERENT customers don't contend on the same row, while two
 * concurrent checkouts by the SAME customer still serialize on their own
 * per-account document — which is exactly where the contention needs to be.
 */
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { randomInt as cryptoRandomInt } from "node:crypto";
import { ensureAdmin } from "../storage";
import {
  emptyUsage,
  generateCouponCode,
  normalizeCouponCode,
  type CouponCodeRecord,
  type CouponGrantRecord,
  type CouponRedemptionRecord,
  type CouponRedemptionStatus,
  type CouponTerms,
  type CouponUsageFacts,
} from "../../../books-frontend/src/core/config/coupons";
import type { DiscountItemType } from "../../../books-frontend/src/core/config/discountImpact";

export function db(): Firestore {
  ensureAdmin();
  return getFirestore();
}

export const CODES = "couponCodes";
export const GRANTS = "couponGrants";
export const REDEMPTIONS = "couponRedemptions";
export const COUNTERS = "couponCounters";
export const ACCOUNT_USAGE = "couponAccountUsage";
export const STATS = "couponStats";

/** Firestore's ALREADY_EXISTS — how `.create()` reports "someone got here first". */
export const ALREADY_EXISTS = 6;

export function isAlreadyExists(err: unknown): boolean {
  return (err as { code?: number })?.code === ALREADY_EXISTS;
}

export const DAY_MS = 86_400_000;

export function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Firestore ids can't contain "/" and shouldn't be unbounded. */
export function safeId(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

export function grantId(uid: string, couponId: string): string {
  return `${safeId(uid)}__${safeId(couponId)}`;
}

export function accountUsageId(uid: string, couponId: string): string {
  return `${safeId(uid)}__${safeId(couponId)}`;
}

/**
 * The redemption doc id — and the idempotency key.
 *
 * Keyed on (coupon, account, payment) rather than including the code: a customer
 * who somehow held two codes for the same offer must not get it applied twice to
 * one payment, and a webhook that fires five times has to converge on one
 * redemption. The payment ref is what distinguishes a legitimate second use from
 * a retry of the first.
 */
export function redemptionId(couponId: string, uid: string, paymentRef: string): string {
  return `${safeId(couponId)}__${safeId(uid)}__${safeId(paymentRef)}`;
}

/** How long a checkout session holds a coupon. Matches campaigns and referrals. */
export const RESERVATION_TTL_MS = 30 * 60_000;

// ---- Codes ------------------------------------------------------------------

export function normalizeCodeRecord(code: string, raw: unknown): CouponCodeRecord {
  const d = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return {
    code,
    couponId: typeof d.couponId === "string" ? d.couponId : "",
    boundUid: typeof d.boundUid === "string" && d.boundUid ? d.boundUid : null,
    redeemedCount: n(d.redeemedCount),
    reservedCount: n(d.reservedCount),
    revoked: d.revoked === true,
    createdAt: n(d.createdAt),
    batchId: typeof d.batchId === "string" && d.batchId ? d.batchId : null,
  };
}

/** One point read. Returns null for an unknown code. */
export async function readCode(rawCode: string): Promise<CouponCodeRecord | null> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return null;
  const snap = await db().doc(`${CODES}/${code}`).get();
  if (!snap.exists) return null;
  return normalizeCodeRecord(code, snap.data());
}

/**
 * Register one code, failing if it already exists.
 *
 * `create` rather than `set` on purpose: a code that silently overwrote an
 * existing one would repoint somebody's printed poster at a different offer.
 */
export async function createCode(args: {
  code: string;
  couponId: string;
  boundUid?: string | null;
  batchId?: string | null;
}): Promise<boolean> {
  const code = normalizeCouponCode(args.code);
  if (!code) return false;
  try {
    await db()
      .doc(`${CODES}/${code}`)
      .create({
        couponId: args.couponId,
        boundUid: args.boundUid ?? null,
        redeemedCount: 0,
        reservedCount: 0,
        revoked: false,
        createdAt: Date.now(),
        batchId: args.batchId ?? null,
      });
    return true;
  } catch (err) {
    if (isAlreadyExists(err)) return false;
    throw err;
  }
}

/**
 * Mint a batch of unguessable single-use codes.
 *
 * Collisions are retried rather than ignored, because a silently-dropped code is
 * a code that got printed on something and doesn't work. The retry budget is
 * bounded so a nearly-exhausted alphabet can't spin forever.
 */
export async function generateCodes(args: {
  couponId: string;
  count: number;
  length?: number;
  prefix?: string;
  batchId: string;
}): Promise<string[]> {
  const count = Math.max(1, Math.min(5_000, Math.round(args.count)));
  const created: string[] = [];
  let attempts = 0;
  const budget = count * 5 + 20;
  while (created.length < count && attempts < budget) {
    attempts++;
    const code = generateCouponCode(
      (maxExclusive) => cryptoRandomInt(maxExclusive),
      args.length ?? 10,
      args.prefix ?? "",
    );
    if (!code) continue;
    const ok = await createCode({ code, couponId: args.couponId, batchId: args.batchId });
    if (ok) created.push(code);
  }
  return created;
}

/** Revoke every code in a batch (or a whole coupon's codes when no batch given). */
export async function revokeCodes(couponId: string, batchId?: string | null): Promise<number> {
  let query = db().collection(CODES).where("couponId", "==", couponId);
  if (batchId) query = query.where("batchId", "==", batchId);
  const snap = await query.limit(5_000).get();
  let revoked = 0;
  // Batched rather than one-at-a-time: revoking a leaked code is a thing you do
  // in a hurry.
  for (let i = 0; i < snap.docs.length; i += 400) {
    const chunk = snap.docs.slice(i, i + 400);
    const batch = db().batch();
    for (const doc of chunk) {
      if (doc.get("revoked") === true) continue;
      batch.set(doc.ref, { revoked: true, revokedAt: Date.now() }, { merge: true });
      revoked++;
    }
    await batch.commit();
  }
  return revoked;
}

export async function listCodes(
  couponId: string,
  limit = 200,
): Promise<CouponCodeRecord[]> {
  const snap = await db()
    .collection(CODES)
    .where("couponId", "==", couponId)
    .limit(Math.min(2_000, Math.max(1, limit)))
    .get();
  return snap.docs.map((d) => normalizeCodeRecord(d.id, d.data()));
}

// ---- Grants -----------------------------------------------------------------

export function normalizeGrant(id: string, raw: unknown): CouponGrantRecord {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    id,
    couponId: typeof d.couponId === "string" ? d.couponId : "",
    uid: typeof d.uid === "string" ? d.uid : "",
    terms: (d.terms ?? null) as CouponTerms,
    source: typeof d.source === "string" ? d.source : "",
    grantedAt: typeof d.grantedAt === "number" ? d.grantedAt : 0,
    redeemedCount:
      typeof d.redeemedCount === "number" && d.redeemedCount > 0 ? Math.round(d.redeemedCount) : 0,
    revoked: d.revoked === true,
  };
}

export async function readGrant(uid: string, couponId: string): Promise<CouponGrantRecord | null> {
  const snap = await db().doc(`${GRANTS}/${grantId(uid, couponId)}`).get();
  if (!snap.exists) return null;
  const grant = normalizeGrant(snap.id, snap.data());
  // A grant with no frozen terms is corrupt — treat it as absent rather than
  // fall back to the live coupon, which would hand out today's terms for
  // yesterday's promise.
  return grant.terms ? grant : null;
}

export async function listGrantsFor(uid: string, limit = 50): Promise<CouponGrantRecord[]> {
  const snap = await db()
    .collection(GRANTS)
    .where("uid", "==", uid)
    .limit(limit)
    .get();
  return snap.docs
    .map((d) => normalizeGrant(d.id, d.data()))
    .filter((g) => g.terms && !g.revoked);
}

/**
 * Who holds this coupon, newest first.
 *
 * Revoked grants are kept in the result — unlike {@link listGrantsFor}, which
 * answers "what can this account use". This one answers "what did we hand out",
 * and a revocation an operator can't see is a revocation they'll perform twice.
 */
export async function listGrantsForCoupon(
  couponId: string,
  limit = 100,
): Promise<CouponGrantRecord[]> {
  const snap = await db()
    .collection(GRANTS)
    .where("couponId", "==", couponId)
    .orderBy("grantedAt", "desc")
    .limit(Math.min(500, Math.max(1, limit)))
    .get();
  return snap.docs.map((d) => normalizeGrant(d.id, d.data())).filter((g) => g.terms);
}

/**
 * Entitle an account to a no-code coupon, exactly once.
 *
 * Returns the grant when it was newly created, null when one already existed —
 * the caller uses that to decide whether to send the "you've got a discount"
 * email, so a repeated signup callback doesn't email twice.
 */
export async function createGrant(args: {
  uid: string;
  couponId: string;
  terms: CouponTerms;
  source: string;
}): Promise<CouponGrantRecord | null> {
  const id = grantId(args.uid, args.couponId);
  const record = {
    couponId: args.couponId,
    uid: args.uid,
    terms: args.terms,
    source: args.source.slice(0, 120),
    grantedAt: Date.now(),
    redeemedCount: 0,
    revoked: false,
  };
  try {
    await db().doc(`${GRANTS}/${id}`).create(record);
    return { id, ...record };
  } catch (err) {
    if (isAlreadyExists(err)) return null;
    throw err;
  }
}

export async function revokeGrant(uid: string, couponId: string): Promise<void> {
  await db()
    .doc(`${GRANTS}/${grantId(uid, couponId)}`)
    .set({ revoked: true, revokedAt: Date.now() }, { merge: true })
    .catch(() => {});
}

// ---- Usage counters ---------------------------------------------------------

/**
 * Read every counter validation needs, in one round trip.
 *
 * Fails OPEN on a read error (all zeros) for the same reason the campaign engine
 * does: a counter read that throws must not silently refuse a code somebody was
 * legitimately given. The reserve transaction re-checks against authoritative
 * numbers, so the worst case is an accept at preview that's refused a moment
 * later with an honest reason — not an over-redemption.
 */
export async function readUsage(args: {
  couponId: string;
  uid: string;
  code?: string | null;
}): Promise<CouponUsageFacts> {
  try {
    const day = dayKey();
    const refs = [
      db().doc(`${COUNTERS}/${safeId(args.couponId)}`),
      db().doc(`${ACCOUNT_USAGE}/${accountUsageId(args.uid, args.couponId)}`),
      db().doc(`${STATS}/${statsId(args.couponId, day)}`),
    ];
    if (args.code) refs.push(db().doc(`${CODES}/${normalizeCouponCode(args.code)}`));
    const [counters, account, today, code] = await db().getAll(...refs);
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      totalRedeemed: n(counters.get("redeemed")),
      accountRedeemed: n(account.get("redeemed")),
      // A reserved-but-unsettled use counts against a single-use code: the
      // alternative lets a double-submitted checkout spend one code twice.
      codeRedeemed: code ? n(code.get("redeemedCount")) + n(code.get("reservedCount")) : 0,
      lifetimeSpend: n(counters.get("discount")),
      todaySpend: n(today?.get("discount")),
    };
  } catch {
    return emptyUsage();
  }
}

export function statsId(couponId: string, day: string): string {
  return `${safeId(couponId)}__${day}`;
}

// ---- Redemptions ------------------------------------------------------------

export function normalizeRedemption(id: string, raw: unknown): CouponRedemptionRecord {
  const d = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const statuses: CouponRedemptionStatus[] = [
    "reserved",
    "redeemed",
    "released",
    "restored",
    "void",
  ];
  return {
    id,
    couponId: typeof d.couponId === "string" ? d.couponId : "",
    couponName: typeof d.couponName === "string" ? d.couponName : "",
    code: typeof d.code === "string" && d.code ? d.code : null,
    uid: typeof d.uid === "string" ? d.uid : "",
    paymentRef: typeof d.paymentRef === "string" ? d.paymentRef : "",
    status: statuses.includes(d.status as CouponRedemptionStatus)
      ? (d.status as CouponRedemptionStatus)
      : "reserved",
    itemType: (typeof d.itemType === "string" ? d.itemType : "print") as DiscountItemType,
    percentOff: n(d.percentOff),
    discountAmount: n(d.discountAmount),
    originalSubtotal: n(d.originalSubtotal),
    currency: typeof d.currency === "string" ? d.currency : "",
    terms: (d.terms ?? null) as CouponTerms,
    createdAt: n(d.createdAt),
    settledAt: n(d.settledAt) || null,
    releasedAt: n(d.releasedAt) || null,
    note: typeof d.note === "string" && d.note ? d.note : null,
  };
}

/** Every redemption tied to one payment — what settle and release both act on. */
export async function redemptionsForPayment(
  paymentRef: string,
  limit = 10,
): Promise<CouponRedemptionRecord[]> {
  if (!paymentRef) return [];
  const snap = await db()
    .collection(REDEMPTIONS)
    .where("paymentRef", "==", paymentRef)
    .limit(limit)
    .get();
  return snap.docs.map((d) => normalizeRedemption(d.id, d.data()));
}

export async function listRedemptionsFor(
  uid: string,
  limit = 50,
): Promise<CouponRedemptionRecord[]> {
  const snap = await db().collection(REDEMPTIONS).where("uid", "==", uid).limit(limit).get();
  return snap.docs
    .map((d) => normalizeRedemption(d.id, d.data()))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Recent redemptions across all accounts, for the admin report's activity list. */
export async function recentRedemptions(
  couponId: string | null,
  limit = 100,
): Promise<CouponRedemptionRecord[]> {
  let query = db().collection(REDEMPTIONS).orderBy("createdAt", "desc").limit(limit);
  if (couponId) {
    query = db()
      .collection(REDEMPTIONS)
      .where("couponId", "==", couponId)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }
  const snap = await query.get();
  return snap.docs.map((d) => normalizeRedemption(d.id, d.data()));
}

// ---- Counter mutations ------------------------------------------------------

/**
 * Move the global and per-account counters by `delta` uses and `discount` money.
 *
 * Split out so settle (+1), release (0 uses — the reservation was never counted)
 * and refund restoration (−1) all go through one place. Increments rather than
 * reads-then-writes, so concurrent settlements on a popular code don't lose
 * counts.
 */
export async function bumpCounters(args: {
  couponId: string;
  uid: string;
  uses: number;
  discount: number;
  revenue?: number;
}): Promise<void> {
  const now = Date.now();
  const writes: Promise<unknown>[] = [];
  if (args.uses !== 0 || args.discount !== 0) {
    writes.push(
      db()
        .doc(`${COUNTERS}/${safeId(args.couponId)}`)
        .set(
          {
            couponId: args.couponId,
            redeemed: FieldValue.increment(args.uses),
            discount: FieldValue.increment(round2(args.discount)),
            revenue: FieldValue.increment(round2(args.revenue ?? 0)),
            updatedAt: now,
          },
          { merge: true },
        ),
    );
  }
  if (args.uses !== 0) {
    writes.push(
      db()
        .doc(`${ACCOUNT_USAGE}/${accountUsageId(args.uid, args.couponId)}`)
        .set(
          {
            uid: args.uid,
            couponId: args.couponId,
            redeemed: FieldValue.increment(args.uses),
            updatedAt: now,
          },
          { merge: true },
        ),
    );
  }
  await Promise.all(writes);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
