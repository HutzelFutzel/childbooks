/**
 * Server-side **Sparks** ledger — the source of truth for a user's balance.
 *
 * The economy uses a prepaid balance with a "reserve → settle" feel:
 *   1. Before an AI action we PRE-CHECK affordability against the action's
 *      estimate plus the admin's negative buffer ({@link ensureAfford}). If the
 *      user can't even start within the buffer, we throw {@link InsufficientSparks}
 *      and the caller surfaces a top-up prompt.
 *   2. We only DEDUCT at settle time ({@link settleActionCost}), pricing the real
 *      metered usage. Because nothing is held up front, a failed/aborted call
 *      costs nothing — no refund bookkeeping needed. The negative buffer means a
 *      render that lands above its estimate still completes (never fail mid-book);
 *      the user simply goes slightly negative and tops up before the next action.
 *
 * Balance is cached on `users/{uid}.sparkBalance`; the immutable audit trail is
 * `users/{uid}/sparksLedger/{id}`. All writes are transactional. The whole path
 * is a no-op while the economy is disabled, so generation keeps working as-is.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getModelCostTable, getSparksConfig } from "./appConfig";
import { actionMultiplier } from "./plans";
import {
  estimateForAction,
  priceForAction,
  type LedgerEntryType,
  type SparksConfig,
} from "../../books-frontend/src/core/config/sparks";
import { costForUsage, costKey } from "../../books-frontend/src/core/config/modelCosts";
import type { UsageEvent } from "./usage";

/** Thrown when a user can't afford to START an action within the negative buffer. */
export class InsufficientSparks extends Error {
  constructor(
    public balance: number,
    public needed: number,
  ) {
    super("You don't have enough Sparks for this. Top up to continue.");
    this.name = "InsufficientSparks";
  }
}

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Current cached Spark balance for a user (0 when unset). */
export async function getBalance(uid: string): Promise<number> {
  const snap = await db().doc(`users/${uid}`).get();
  const v = snap.exists ? (snap.get("sparkBalance") as unknown) : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

interface GrantArgs {
  uid: string;
  amount: number;
  type: Extract<LedgerEntryType, "grant" | "purchase" | "refund" | "adjust">;
  reason: string;
  /**
   * External id for idempotency (invoice/payment id). When present the ledger
   * entry uses a deterministic doc id so retries can't double-grant.
   */
  ref?: string;
  /**
   * Optional carry-over cap applied BEFORE adding `amount` (recurring grants):
   * any balance above `rolloverCap` is forfeited, then the fresh grant is added.
   */
  rolloverCap?: number;
}

/**
 * Add Sparks to a user's balance + append a ledger entry, atomically. When `ref`
 * is given the operation is idempotent (a second call with the same ref + type
 * is a no-op), so webhook retries are safe.
 */
export async function grantSparks(args: GrantArgs): Promise<void> {
  if (args.amount <= 0) return;
  ensureAdmin();
  const userRef = db().doc(`users/${args.uid}`);
  const ledgerId = args.ref ? `${args.type}_${args.ref}` : randomUUID();
  const ledgerRef = userRef.collection("sparksLedger").doc(ledgerId);

  await db().runTransaction(async (tx) => {
    if (args.ref) {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) return; // already granted for this ref
    }
    const userSnap = await tx.get(userRef);
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    const base =
      typeof args.rolloverCap === "number" ? Math.min(current, Math.max(0, args.rolloverCap)) : current;
    const balanceAfter = base + args.amount;
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: args.type,
      amount: args.amount,
      balanceAfter,
      reason: args.reason,
      ...(args.ref ? { ref: args.ref } : {}),
      at: Date.now(),
    });
  });
}

/**
 * Grant the one-time starter Sparks to a brand-new account, exactly once (keyed
 * by a fixed ref). No-op when the economy is disabled or the grant is zero.
 */
export async function ensureStarterGrant(uid: string): Promise<void> {
  try {
    const config = await getSparksConfig();
    if (!config.enabled || config.starterGrant <= 0) return;
    await grantSparks({
      uid,
      amount: config.starterGrant,
      type: "grant",
      reason: "starter",
      ref: "starter",
    });
  } catch {
    // Best-effort: never block sign-in/first use on the starter grant.
  }
}

/**
 * Pre-flight affordability check. Throws {@link InsufficientSparks} when starting
 * an action costing `estimateSparks` would push the balance below the configured
 * negative buffer. No-op when the economy is off or the estimate is 0.
 */
export async function ensureAfford(uid: string, estimateSparks: number): Promise<void> {
  if (estimateSparks <= 0) return;
  const config = await getSparksConfig();
  if (!config.enabled) return;
  const balance = await getBalance(uid);
  if (balance - estimateSparks < -config.maxNegativeSparks) {
    throw new InsufficientSparks(balance, estimateSparks);
  }
}

/** Total USD cost of a set of metered usage events against the cost table. */
async function usdForEvents(events: UsageEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const costs = await getModelCostTable();
  let total = 0;
  for (const e of events) {
    const c = costForUsage(costs.models[costKey(e.provider, e.model)], e.usage);
    if (c != null) total += c;
  }
  return total;
}

/**
 * Deduct the real Spark price of a completed action from the user's metered
 * usage, applying any per-plan multiplier. Returns the Sparks spent (0 when the
 * economy is off or the action is free). Best-effort: a failure here never
 * breaks generation — usage is already recorded separately for accounting.
 */
export async function settleActionCost(
  uid: string,
  action: string,
  events: UsageEvent[],
): Promise<number> {
  try {
    const config = await getSparksConfig();
    if (!config.enabled) return 0;
    const [costUsd, multiplier] = await Promise.all([
      usdForEvents(events),
      actionMultiplier(uid, action),
    ]);
    const price = priceForAction(config, action, costUsd, multiplier);
    if (price <= 0) return 0;
    await deductSparks(uid, price, action);
    return price;
  } catch {
    return 0;
  }
}

/**
 * Admin-initiated manual wallet adjustment. Unlike {@link grantSparks} this
 * accepts a SIGNED delta (credit or debit), always writes an `adjust` ledger
 * entry for the audit trail, and returns the resulting balance. Not idempotent —
 * each call is a distinct, intentional admin action.
 */
export async function adminAdjustSparks(
  uid: string,
  delta: number,
  reason: string,
): Promise<number> {
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("Provide a non-zero numeric delta.");
  }
  ensureAdmin();
  const userRef = db().doc(`users/${uid}`);
  const ledgerRef = userRef.collection("sparksLedger").doc(randomUUID());
  return db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error("User not found.");
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    const balanceAfter = current + delta;
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: "adjust",
      amount: delta,
      balanceAfter,
      reason,
      at: Date.now(),
    });
    return balanceAfter;
  });
}

/** Deduct Sparks (allowed to dip into the negative buffer) + append a ledger entry. */
async function deductSparks(uid: string, amount: number, reason: string): Promise<void> {
  ensureAdmin();
  const userRef = db().doc(`users/${uid}`);
  const ledgerRef = userRef.collection("sparksLedger").doc(randomUUID());
  await db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    const balanceAfter = current - amount;
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: "spend",
      amount: -amount,
      balanceAfter,
      reason,
      at: Date.now(),
    });
  });
}

/** The Spark estimate to pre-check for one action (config + plan aware). */
export async function estimateForUser(uid: string, action: string): Promise<number> {
  const config = await getSparksConfig();
  if (!config.enabled) return 0;
  const multiplier = await actionMultiplier(uid, action);
  return estimateForAction(config, action, multiplier);
}

/** Convenience: the affordability estimate for a single action, then ensure it. */
export async function ensureAffordAction(uid: string, action: string): Promise<void> {
  const estimate = await estimateForUser(uid, action);
  await ensureAfford(uid, estimate);
}

export type { SparksConfig };
