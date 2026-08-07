/**
 * Firestore access for the campaign engine — collection paths, stored document
 * shapes, and the small primitives (id derivation, day keys, counter reserves)
 * the rest of the modules share.
 *
 * Collections (all backend-only; see `firestore.rules`):
 *   - `campaignEvents/{type}_{ref}`          append-only event log; the doc id IS
 *                                              the idempotency key
 *   - `campaignEnrollments/{uid}__{cid}`     one per (account, campaign), holding
 *                                              the FROZEN terms and the trace
 *   - `campaignRedemptions/{id}`             one payout; the doc id IS the
 *                                              idempotency key
 *   - `campaignCounters/{cid}`               global redemption + spend counters
 *   - `campaignStats/{cid}__{YYYY-MM-DD}`    daily counters for the admin report
 */
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import {
  normalizeCampaignsConfig,
  type CampaignEffect,
  type CampaignTerms,
  type CampaignTrigger,
  type ConditionFailure,
  type RedemptionStatus,
} from "../../../books-frontend/src/core/config/campaigns";

export function db(): Firestore {
  ensureAdmin();
  return getFirestore();
}

export const EVENTS = "campaignEvents";
export const ENROLLMENTS = "campaignEnrollments";
export const REDEMPTIONS = "campaignRedemptions";
export const COUNTERS = "campaignCounters";
export const STATS = "campaignStats";

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
function safeId(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

export function enrollmentId(uid: string, campaignId: string): string {
  return `${safeId(uid)}__${safeId(campaignId)}`;
}

/**
 * The redemption doc id — and the idempotency key.
 *
 * A once-per-account rule keys on (campaign, rule, account), so a webhook that
 * fires five times, a backfill and a retry all converge on one payout. A
 * repeatable rule has to include the triggering event, or the second purchase
 * would look like a duplicate of the first and silently never pay.
 */
export function redemptionId(args: {
  campaignId: string;
  ruleId: string;
  uid: string;
  repeatable: boolean;
  /** Payment/invoice/event ref that distinguishes one firing from the next. */
  instanceRef?: string | null;
}): string {
  const base = `${safeId(args.campaignId)}__${safeId(args.ruleId)}__${safeId(args.uid)}`;
  if (!args.repeatable) return base;
  // No ref on a repeatable rule (a scheduled sweep, say) falls back to the day,
  // which at worst collapses two firings on the same day into one — the safe
  // direction, since the alternative is paying an unbounded number of times.
  return `${base}__${safeId(args.instanceRef || dayKey())}`;
}

// ---- Event log ---------------------------------------------------------------

/**
 * Claim an event, exactly once. Returns false when this exact event has already
 * been processed.
 *
 * The log exists for three reasons beyond deduplication: a campaign bug can be
 * fixed and the events replayed, the admin simulator can project a draft
 * campaign against real history, and "why did this pay out?" has an answer that
 * doesn't depend on re-deriving state.
 */
export async function claimEvent(args: {
  type: CampaignTrigger;
  /** Stable handle for this occurrence — payment id, invoice id, uid, … */
  ref: string;
  uid: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const id = `${safeId(args.type)}_${safeId(args.ref)}`;
  try {
    await db()
      .collection(EVENTS)
      .doc(id)
      .create({
        type: args.type,
        ref: args.ref,
        uid: args.uid,
        payload: args.payload,
        at: Date.now(),
      });
    return true;
  } catch (err) {
    if (isAlreadyExists(err)) return false;
    throw err;
  }
}

// ---- Enrollments -------------------------------------------------------------

export interface EnrollmentDoc {
  id: string;
  uid: string;
  campaignId: string;
  /** Frozen at enrollment — never re-read from live config. */
  terms: CampaignTerms;
  enrolledAt: number;
  /** Copied from the campaign window so an expiry check needs no config read. */
  expiresAt: number;
  /** Redemptions granted under this enrollment (all rules together). */
  redeemedCount: number;
  /** Per-rule redemption tallies, keyed by rule id. */
  perRule: Record<string, number>;
  /** True when the account was eligible but assigned to the holdout group. */
  holdout: boolean;
  /**
   * The most recent evaluation trace. This is what turns "why didn't I get my
   * Sparks?" from an investigation into a lookup.
   */
  lastTrace: { at: number; trigger: string; failures: ConditionFailure[] } | null;
}

export function normalizeEnrollment(id: string, raw: unknown): EnrollmentDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id,
    uid: (d.uid as string) ?? "",
    campaignId: (d.campaignId as string) ?? "",
    terms: (d.terms as CampaignTerms) ?? { campaignId: "", rules: [], limits: { maxPerAccount: 0, maxTotal: 0, dailyBudget: 0, lifetimeBudget: 0 }, summary: "", notes: [], expiresAt: 0, at: 0 },
    enrolledAt: num(d.enrolledAt),
    expiresAt: num(d.expiresAt),
    redeemedCount: num(d.redeemedCount),
    perRule: (d.perRule as Record<string, number>) ?? {},
    holdout: d.holdout === true,
    lastTrace: (d.lastTrace as EnrollmentDoc["lastTrace"]) ?? null,
  };
}

export async function getEnrollment(uid: string, campaignId: string): Promise<EnrollmentDoc | null> {
  const id = enrollmentId(uid, campaignId);
  const snap = await db().doc(`${ENROLLMENTS}/${id}`).get();
  return snap.exists ? normalizeEnrollment(snap.id, snap.data()) : null;
}

export async function listEnrollmentsFor(uid: string, limit = 100): Promise<EnrollmentDoc[]> {
  const snap = await db().collection(ENROLLMENTS).where("uid", "==", uid).limit(limit).get();
  return snap.docs
    .map((doc) => normalizeEnrollment(doc.id, doc.data()))
    .sort((a, b) => b.enrolledAt - a.enrolledAt);
}

/**
 * Enroll an account, freezing the terms onto the record. Idempotent: an existing
 * enrollment is returned untouched, because re-freezing would silently rewrite a
 * promise the customer has already been shown.
 */
export async function ensureEnrollment(args: {
  uid: string;
  campaignId: string;
  terms: CampaignTerms;
  expiresAt: number;
  holdout: boolean;
}): Promise<EnrollmentDoc> {
  const id = enrollmentId(args.uid, args.campaignId);
  const ref = db().doc(`${ENROLLMENTS}/${id}`);
  const doc: Omit<EnrollmentDoc, "id"> = {
    uid: args.uid,
    campaignId: args.campaignId,
    terms: args.terms,
    enrolledAt: Date.now(),
    expiresAt: args.expiresAt,
    redeemedCount: 0,
    perRule: {},
    holdout: args.holdout,
    lastTrace: null,
  };
  try {
    await ref.create(doc);
    return { ...doc, id };
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    const snap = await ref.get();
    return normalizeEnrollment(id, snap.data());
  }
}

/** Record the newest evaluation trace on an enrollment (telemetry only). */
export async function recordTrace(
  uid: string,
  campaignId: string,
  trace: { trigger: string; failures: ConditionFailure[] },
): Promise<void> {
  try {
    await db()
      .doc(`${ENROLLMENTS}/${enrollmentId(uid, campaignId)}`)
      .set({ lastTrace: { at: Date.now(), ...trace } }, { merge: true });
  } catch {
    // telemetry only
  }
}

/** Bump an enrollment's tallies after a successful payout. */
export async function tallyEnrollment(uid: string, campaignId: string, ruleId: string): Promise<void> {
  try {
    await db()
      .doc(`${ENROLLMENTS}/${enrollmentId(uid, campaignId)}`)
      .set(
        {
          redeemedCount: FieldValue.increment(1),
          perRule: { [ruleId]: FieldValue.increment(1) },
        },
        { merge: true },
      );
  } catch (err) {
    // Bookkeeping only — the payout already happened. Not counting it keeps the
    // per-account cap generous rather than the payout unbounded, which is the
    // safe direction to fail.
    console.warn("[campaigns] enrollment tally failed", campaignId, err);
  }
}

// ---- Redemptions ------------------------------------------------------------

export interface RedemptionDoc {
  id: string;
  campaignId: string;
  /** Denormalized so the wallet and the admin queue don't need a config join. */
  campaignName: string;
  ruleId: string;
  uid: string;
  trigger: CampaignTrigger;
  effect: CampaignEffect;
  status: RedemptionStatus;
  /** What it is, e.g. "240 Sparks". */
  summary: string;
  /** What unlocked it, e.g. "when your order is complete". */
  unlocks: string;
  /** Payment/invoice that qualified it — the handle a refund claws back on. */
  qualifyingRef: string | null;
  /** Estimated payout cost in the pricing base currency. */
  cost: number;
  /** Sparks actually granted (grants and refunds). */
  sparks: number;
  /** Ledger entries a spend-refund consumed, so they're never refunded twice. */
  refundedEntryIds: string[];
  createdAt: number;
  grantedAt: number | null;
  /** Why it's held, or how it was reversed. */
  note: string | null;

  // ---- Discount redemption state (mirrors the referral reward doc) ----
  discountExpiresAt: number;
  redeemedAt: number;
  redeemedOn: string | null;
  reservedAt: number;
  reservedFor: string | null;
}

export function normalizeRedemption(id: string, raw: unknown): RedemptionDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const statuses: RedemptionStatus[] = ["pending", "granted", "review", "void", "clawed_back"];
  return {
    id,
    campaignId: (d.campaignId as string) ?? "",
    campaignName: (d.campaignName as string) ?? (d.campaignId as string) ?? "",
    ruleId: (d.ruleId as string) ?? "",
    uid: (d.uid as string) ?? "",
    trigger: (d.trigger as CampaignTrigger) ?? "purchase",
    effect: (d.effect as CampaignEffect) ?? { kind: "sparks", sparks: 0, expiresInDays: 0 },
    status: statuses.includes(d.status as RedemptionStatus) ? (d.status as RedemptionStatus) : "pending",
    summary: (d.summary as string) ?? "",
    unlocks: (d.unlocks as string) ?? "",
    qualifyingRef: typeof d.qualifyingRef === "string" ? d.qualifyingRef : null,
    cost: num(d.cost),
    sparks: num(d.sparks),
    refundedEntryIds: Array.isArray(d.refundedEntryIds) ? (d.refundedEntryIds as string[]) : [],
    createdAt: num(d.createdAt),
    grantedAt: typeof d.grantedAt === "number" ? d.grantedAt : null,
    note: typeof d.note === "string" ? d.note : null,
    discountExpiresAt: num(d.discountExpiresAt),
    redeemedAt: num(d.redeemedAt),
    redeemedOn: typeof d.redeemedOn === "string" ? d.redeemedOn : null,
    reservedAt: num(d.reservedAt),
    reservedFor: typeof d.reservedFor === "string" ? d.reservedFor : null,
  };
}

export async function listRedemptionsFor(uid: string, limit = 100): Promise<RedemptionDoc[]> {
  const snap = await db().collection(REDEMPTIONS).where("uid", "==", uid).limit(limit).get();
  return snap.docs
    .map((doc) => normalizeRedemption(doc.id, doc.data()))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Every redemption a given payment qualified (the clawback lookup). */
export async function listRedemptionsForQualifyingRef(ref: string): Promise<RedemptionDoc[]> {
  if (!ref) return [];
  const snap = await db().collection(REDEMPTIONS).where("qualifyingRef", "==", ref).limit(50).get();
  return snap.docs.map((doc) => normalizeRedemption(doc.id, doc.data()));
}

/** Every redemption in one state, oldest first — the admin's decision queue. */
export async function listRedemptionsByStatus(
  status: RedemptionStatus,
  limit = 200,
): Promise<RedemptionDoc[]> {
  const snap = await db().collection(REDEMPTIONS).where("status", "==", status).limit(limit).get();
  return snap.docs
    .map((doc) => normalizeRedemption(doc.id, doc.data()))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getRedemption(id: string): Promise<RedemptionDoc | null> {
  const snap = await db().doc(`${REDEMPTIONS}/${id}`).get();
  return snap.exists ? normalizeRedemption(snap.id, snap.data()) : null;
}

// ---- Counters + budget ------------------------------------------------------

/**
 * Reserve one slot against a campaign's global redemption cap, transactionally.
 *
 * A plain read-then-write would hand out 130 of a "first 100" offer under any
 * real concurrency, and the overshoot is unrecoverable once customers have been
 * told they won. Returns false when the cap is already full.
 */
export async function reserveGlobalSlot(campaignId: string, maxTotal: number): Promise<boolean> {
  if (maxTotal <= 0) return true;
  const ref = db().doc(`${COUNTERS}/${campaignId}`);
  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = (snap.exists ? (snap.get("redeemed") as number) : 0) ?? 0;
      if (used >= maxTotal) return false;
      tx.set(ref, { redeemed: used + 1, updatedAt: Date.now() }, { merge: true });
      return true;
    });
  } catch {
    // Fail CLOSED: a capped offer whose counter can't be read must not become
    // uncapped. The redemption is held for review instead.
    return false;
  }
}

/** Give a reserved slot back when the payout it was for didn't happen. */
export async function releaseGlobalSlot(campaignId: string): Promise<void> {
  try {
    await db()
      .doc(`${COUNTERS}/${campaignId}`)
      .set({ redeemed: FieldValue.increment(-1), updatedAt: Date.now() }, { merge: true });
  } catch {
    // Bookkeeping only.
  }
}

/** Lifetime payout total for a campaign — the input to the lifetime budget. */
export async function lifetimeSpend(campaignId: string): Promise<number> {
  try {
    const snap = await db().doc(`${COUNTERS}/${campaignId}`).get();
    const v = snap.exists ? snap.get("cost") : 0;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  } catch {
    // Fail OPEN, matching the referral budget: a counter read failure must not
    // silently freeze every payout. The daily budget still applies.
    return 0;
  }
}

export async function addLifetimeSpend(campaignId: string, cost: number): Promise<void> {
  if (cost <= 0) return;
  try {
    await db()
      .doc(`${COUNTERS}/${campaignId}`)
      .set({ cost: FieldValue.increment(cost), updatedAt: Date.now() }, { merge: true });
  } catch {
    // telemetry only
  }
}
