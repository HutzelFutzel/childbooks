/**
 * Firestore access for the referral program — collection paths, stored document
 * shapes, and the small primitives (code minting, email hashing, day keys) the
 * rest of the modules share.
 *
 * Collections (all backend-only; see `firestore.rules`):
 *   - `referralInvitations/{id}`     one invitation, with its frozen terms
 *   - `referralCodes/{code}`         code → inviter (+ invitation, for email invites)
 *   - `referralRewards/{id}`         one reward per (invitation, rule, side) — the
 *                                    doc id IS the idempotency key
 *   - `referralInviteIndex/{hash}`   "when was this address last invited, by anyone"
 *   - `referralSuppression/{hash}`   never contact this address again
 *   - `referralCounters/{uid}_{key}` per-user send throttles
 *   - `referralStats/{YYYY-MM-DD}`   the daily funnel counters
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import {
  normalizeTerms,
  type InvitationProgress,
  type InvitationStatus,
  type ReferralTerms,
  type Reward,
  type RewardSide,
  type RewardStatus,
  type RewardTrigger,
} from "../../../books-frontend/src/core/config/referral";

export function db(): Firestore {
  ensureAdmin();
  return getFirestore();
}

export const INVITATIONS = "referralInvitations";
export const CODES = "referralCodes";
export const REWARDS = "referralRewards";
export const INVITE_INDEX = "referralInviteIndex";
export const SUPPRESSION = "referralSuppression";
export const COUNTERS = "referralCounters";
export const STATS = "referralStats";

/** Firestore's ALREADY_EXISTS — how `.create()` reports "someone got here first". */
export const ALREADY_EXISTS = 6;

export function isAlreadyExists(err: unknown): boolean {
  return (err as { code?: number })?.code === ALREADY_EXISTS;
}

// ---- Codes ------------------------------------------------------------------

/**
 * 8 characters from an unambiguous alphabet (no i/l/o/0/1): short enough to
 * read out loud, large enough (31^8 ≈ 8.5e11) that guessing is hopeless.
 */
export function newCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newInvitationId(): string {
  return randomUUID();
}

/** What a code resolves to. An evergreen personal link has no invitation yet. */
export interface CodeTarget {
  inviterUid: string;
  /** Set for single-use email invitations; null for a personal share link. */
  invitationId: string | null;
}

export async function resolveCode(code: string): Promise<CodeTarget | null> {
  const clean = normalizeCode(code);
  if (!clean) return null;
  const snap = await db().doc(`${CODES}/${clean}`).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  // `uid` is the pre-rules field name — still the inviter, so keep reading it.
  const inviterUid = (d.inviterUid as string) ?? (d.uid as string) ?? "";
  if (!inviterUid) return null;
  return {
    inviterUid,
    invitationId: typeof d.invitationId === "string" ? d.invitationId : null,
  };
}

export function normalizeCode(code: string): string {
  return code.trim().toLowerCase().slice(0, 64);
}

// ---- Email hashing ----------------------------------------------------------

/**
 * Addresses are stored HASHED in the cross-inviter index and the suppression
 * list: those two collections exist to answer "have we bothered this person
 * already?", which a hash answers perfectly well without keeping a mailing list
 * of people who never signed up.
 */
export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately loose — the mail provider is the real validator. */
export function looksLikeEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length >= 6 && e.length <= 320 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e);
}

// ---- Day keys ---------------------------------------------------------------

export function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function monthKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

export const DAY_MS = 86_400_000;

// ---- Invitations ------------------------------------------------------------

export type InvitationChannel = "link" | "email";

export interface DeliveryRecord {
  at: number;
  kind: "invite" | "reminder";
  outcome: string;
}

export interface InvitationDoc {
  id: string;
  inviterUid: string;
  /** The address the inviter typed; null for a personal share link. */
  recipientEmail: string | null;
  recipientEmailHash: string | null;
  code: string;
  channel: InvitationChannel;
  status: InvitationStatus;
  /** Frozen at send time (email) or at acceptance (link) — never re-read from config. */
  terms: ReferralTerms;
  createdAt: number;
  /**
   * Deadline for BOTH accepting the invitation and earning its rewards. The
   * second half is what stops a years-old offer from paying out at today's
   * costs.
   */
  expiresAt: number;
  acceptedBy: string | null;
  acceptedAt: number | null;
  progress: InvitationProgress;
  remindersSent: number;
  /** How many rewards have actually been granted against this invitation. */
  rewardedCount: number;
  /**
   * True once the INVITER has been paid anything for this referral. The lifetime
   * cap counts referrals rather than rewards, so this flag — not `rewardedCount`
   * — is what a multi-rule ladder consumes exactly one of.
   */
  referrerRewarded: boolean;
}

export function normalizeInvitation(id: string, raw: unknown): InvitationDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const statuses: InvitationStatus[] = ["pending", "accepted", "expired", "void", "blocked"];
  const progress = (d.progress ?? {}) as Record<string, unknown>;
  return {
    id,
    inviterUid: (d.inviterUid as string) ?? "",
    recipientEmail: typeof d.recipientEmail === "string" ? d.recipientEmail : null,
    recipientEmailHash: typeof d.recipientEmailHash === "string" ? d.recipientEmailHash : null,
    code: (d.code as string) ?? "",
    channel: d.channel === "email" ? "email" : "link",
    status: statuses.includes(d.status as InvitationStatus) ? (d.status as InvitationStatus) : "pending",
    terms: normalizeTerms(d.terms),
    createdAt: num(d.createdAt),
    expiresAt: num(d.expiresAt),
    acceptedBy: typeof d.acceptedBy === "string" ? d.acceptedBy : null,
    acceptedAt: typeof d.acceptedAt === "number" ? d.acceptedAt : null,
    progress: {
      signedUp: progress.signedUp === true,
      verified: progress.verified === true,
      activated: progress.activated === true,
      purchased: progress.purchased === true,
    },
    remindersSent: num(d.remindersSent),
    rewardedCount: num(d.rewardedCount),
    referrerRewarded: d.referrerRewarded === true,
  };
}

export async function getInvitation(id: string): Promise<InvitationDoc | null> {
  if (!id) return null;
  const snap = await db().doc(`${INVITATIONS}/${id}`).get();
  return snap.exists ? normalizeInvitation(snap.id, snap.data()) : null;
}

/**
 * A user's invitations, newest first. Filtered on `inviterUid` alone (a
 * single-field index every collection has) and sorted in memory — a composite
 * index would be deploy ceremony for a list that's capped at 100 anyway.
 */
export async function listInvitationsFor(uid: string, limit = 100): Promise<InvitationDoc[]> {
  const snap = await db().collection(INVITATIONS).where("inviterUid", "==", uid).limit(limit).get();
  return snap.docs
    .map((doc) => normalizeInvitation(doc.id, doc.data()))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ---- Rewards ----------------------------------------------------------------

/**
 * The reward document id — and the idempotency key. One reward per invitation,
 * rule and side, so a webhook that fires five times pays exactly once.
 */
export function rewardId(invitationId: string, ruleId: string, side: RewardSide): string {
  return `${invitationId}__${ruleId}__${side}`;
}

export interface RewardDoc {
  id: string;
  invitationId: string;
  ruleId: string;
  trigger: RewardTrigger;
  side: RewardSide;
  /** Who gets it. */
  uid: string;
  /** The other party, for the notification copy. */
  counterpartUid: string;
  reward: Reward;
  status: RewardStatus;
  /** Payment/invoice id that qualified it — the handle a refund claws back on. */
  qualifyingRef: string | null;
  summary: string;
  unlocks: string;
  /** Estimated payout cost, for the budget breaker and the stats. */
  cost: number;
  createdAt: number;
  grantedAt: number | null;
  /** Stripe coupon id, for the rewards Stripe has to own (membership perks). */
  stripeCouponId: string | null;
  /** Why a reward is held for review, or how it was reversed. */
  note: string | null;

  // ---- Discount-reward redemption state (see `redemption.ts`) ----
  /** When a granted discount stops being redeemable (0 ⇒ no expiry). */
  discountExpiresAt: number;
  /** Set once the discount has actually been used on a purchase. */
  redeemedAt: number;
  /** The payment that consumed it. */
  redeemedOn: string | null;
  /** Short-lived hold while a checkout session is open. */
  reservedAt: number;
  reservedFor: string | null;
}

export function normalizeReward(id: string, raw: unknown): RewardDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const statuses: RewardStatus[] = ["pending", "granted", "void", "clawed_back", "review"];
  return {
    id,
    invitationId: (d.invitationId as string) ?? "",
    ruleId: (d.ruleId as string) ?? "",
    trigger: (d.trigger as RewardTrigger) ?? "first_purchase",
    side: d.side === "referred" ? "referred" : "referrer",
    uid: (d.uid as string) ?? "",
    counterpartUid: (d.counterpartUid as string) ?? "",
    reward: (d.reward as Reward) ?? { kind: "sparks", sparks: 0 },
    status: statuses.includes(d.status as RewardStatus) ? (d.status as RewardStatus) : "pending",
    qualifyingRef: typeof d.qualifyingRef === "string" ? d.qualifyingRef : null,
    summary: (d.summary as string) ?? "",
    unlocks: (d.unlocks as string) ?? "",
    cost: typeof d.cost === "number" ? d.cost : 0,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
    grantedAt: typeof d.grantedAt === "number" ? d.grantedAt : null,
    stripeCouponId: typeof d.stripeCouponId === "string" ? d.stripeCouponId : null,
    note: typeof d.note === "string" ? d.note : null,
    discountExpiresAt: typeof d.discountExpiresAt === "number" ? d.discountExpiresAt : 0,
    redeemedAt: typeof d.redeemedAt === "number" ? d.redeemedAt : 0,
    redeemedOn: typeof d.redeemedOn === "string" ? d.redeemedOn : null,
    reservedAt: typeof d.reservedAt === "number" ? d.reservedAt : 0,
    reservedFor: typeof d.reservedFor === "string" ? d.reservedFor : null,
  };
}

/** A user's rewards (earned + pending), newest first. */
export async function listRewardsFor(uid: string, limit = 100): Promise<RewardDoc[]> {
  const snap = await db().collection(REWARDS).where("uid", "==", uid).limit(limit).get();
  return snap.docs
    .map((doc) => normalizeReward(doc.id, doc.data()))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Every reward that a given payment/invoice qualified (the clawback lookup). */
export async function listRewardsForQualifyingRef(ref: string): Promise<RewardDoc[]> {
  if (!ref) return [];
  const snap = await db().collection(REWARDS).where("qualifyingRef", "==", ref).limit(50).get();
  return snap.docs.map((doc) => normalizeReward(doc.id, doc.data()));
}

/** Rewards granted against one invitation (so the UI can show what landed). */
export async function listRewardsForInvitation(invitationId: string): Promise<RewardDoc[]> {
  if (!invitationId) return [];
  const snap = await db().collection(REWARDS).where("invitationId", "==", invitationId).limit(50).get();
  return snap.docs.map((doc) => normalizeReward(doc.id, doc.data()));
}

/** Every reward in one state, oldest first — the admin's held-payout queue. */
export async function listRewardsByStatus(status: RewardStatus, limit = 200): Promise<RewardDoc[]> {
  const snap = await db().collection(REWARDS).where("status", "==", status).limit(limit).get();
  return snap.docs
    .map((doc) => normalizeReward(doc.id, doc.data()))
    .sort((a, b) => a.createdAt - b.createdAt);
}
