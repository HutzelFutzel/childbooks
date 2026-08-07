/**
 * Spend refunds — giving back Sparks the customer already burned.
 *
 * This is the only effect that reads HISTORY rather than reacting to the present,
 * and the only one with genuinely unbounded exposure: spent Sparks are provider
 * work already paid for in cash, so a refund hands back capacity, not margin.
 * Four things keep it safe, and all four live here:
 *
 *   1. **A bounded scan.** The ledger is paged, newest first, with a hard cap.
 *      A heavy account's ledger is far larger than one query, so an unpaged
 *      read would silently refund only some of it — inconsistently.
 *
 *   2. **A watermark.** Every entry a refund consumes is stamped `refundedBy`.
 *      Without it, two overlapping campaigns (or one campaign firing twice)
 *      would refund the same spend repeatedly, which is free money.
 *
 *   3. **Unfunded spend is excluded.** Sparks spent past all lots
 *      (negative-buffer territory) were never funded by anyone, so returning
 *      them mints value from nothing. See {@link SpendEntry.unfundedSparks}.
 *
 *   4. **Caps applied in a fixed order**, in `computeRefund` — percentage of
 *      qualifying spend first, then the ceilings, then the floor, so a
 *      "minimum" can never jump a ceiling that was set to keep this affordable.
 */
import {
  computeRefund,
  type RefundComputation,
  type SpendEntry,
  type SpendRefundEffect,
} from "../../../books-frontend/src/core/config/campaigns";
import type { ImageTier } from "../../../books-frontend/src/core/config/modelConfig";
import { db } from "./store";

/**
 * How far back a single refund will look. Generous enough to cover any realistic
 * account, small enough to stay inside one function invocation's budget. A
 * refund that hits the cap is logged, because silently refunding "most" of
 * someone's spend is worse than refunding a documented slice of it.
 */
const MAX_LEDGER_SCAN = 2000;
const PAGE_SIZE = 400;

/** Project one `spend` ledger doc into the shape the pure calculator wants. */
function toSpendEntry(id: string, raw: Record<string, unknown>): SpendEntry {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const tier = raw.tier === "quick" || raw.tier === "premium" ? (raw.tier as ImageTier) : null;
  return {
    id,
    at: num(raw.at),
    // Spends are stored as a negative delta; the calculator works in positives.
    sparks: Math.abs(num(raw.amount)),
    action: typeof raw.reason === "string" ? raw.reason : "",
    tier,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    paidSparks: num(raw.paidSparks),
    unfundedSparks: num(raw.unfundedSparks),
    refundedBy: typeof raw.refundedBy === "string" ? raw.refundedBy : null,
  };
}

/**
 * Every `spend` entry for an account, newest first, up to the scan cap.
 *
 * Filtered on `type` alone — the one field an index already covers — and scoped
 * in memory. A composite index per scope combination would be deploy ceremony
 * for a query that's capped at a couple of thousand tiny documents anyway.
 */
export async function loadSpendHistory(
  uid: string,
  opts: { since?: number } = {},
): Promise<{ entries: SpendEntry[]; truncated: boolean }> {
  const entries: SpendEntry[] = [];
  let cursor: number | null = null;
  let truncated = false;

  while (entries.length < MAX_LEDGER_SCAN) {
    let query = db()
      .collection(`users/${uid}/sparksLedger`)
      .where("type", "==", "spend")
      .orderBy("at", "desc")
      .limit(PAGE_SIZE);
    if (cursor !== null) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const entry = toSpendEntry(doc.id, doc.data() as Record<string, unknown>);
      if (opts.since && entry.at < opts.since) return { entries, truncated: false };
      entries.push(entry);
    }
    cursor = entries[entries.length - 1]?.at ?? null;
    if (snap.size < PAGE_SIZE) break;
    if (entries.length >= MAX_LEDGER_SCAN) truncated = true;
  }
  return { entries, truncated };
}

export interface RefundPlan extends RefundComputation {
  /** True when the ledger scan hit its cap, so this refund is a partial view. */
  truncated: boolean;
}

/** Work out what a refund would pay, without paying it (used by the simulator). */
export async function planRefund(args: {
  uid: string;
  effect: SpendRefundEffect;
  enrolledAt: number;
  purchasedProjectId?: string | null;
  purchaseAmount?: number;
  sparkValueUsd: number;
}): Promise<RefundPlan> {
  const { entries, truncated } = await loadSpendHistory(args.uid, {
    since: args.effect.scope.sinceEnrollment ? args.enrolledAt : undefined,
  });
  const computation = computeRefund({
    entries,
    effect: args.effect,
    enrolledAt: args.enrolledAt,
    purchasedProjectId: args.purchasedProjectId,
    purchaseAmount: args.purchaseAmount,
    sparkValueUsd: args.sparkValueUsd,
  });
  if (truncated) {
    console.warn("[campaigns] spend-refund scan hit its cap", {
      uid: args.uid,
      scanned: entries.length,
    });
  }
  return { ...computation, truncated };
}

/**
 * Stamp the consumed entries so no other campaign can refund them again.
 *
 * Done AFTER the Sparks are granted, deliberately. If this write fails the
 * customer has been paid and the entries stay claimable — an over-refund risk
 * we log loudly. Stamping first would risk the opposite: entries burned with
 * nothing paid, which the customer experiences as their offer silently vanishing
 * and which no retry can repair.
 */
export async function markRefunded(
  uid: string,
  entryIds: string[],
  redemptionId: string,
): Promise<void> {
  if (entryIds.length === 0) return;
  const col = db().collection(`users/${uid}/sparksLedger`);
  const CHUNK = 400; // Firestore's batch limit is 500; leave headroom.
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const batch = db().batch();
    for (const id of entryIds.slice(i, i + CHUNK)) {
      batch.set(col.doc(id), { refundedBy: redemptionId, refundedAt: Date.now() }, { merge: true });
    }
    try {
      await batch.commit();
    } catch (err) {
      console.error("[campaigns] could not mark refunded spend — entries stay claimable", {
        uid,
        redemptionId,
        err,
      });
    }
  }
}

/**
 * Release the watermark on a reversed refund, so the spend becomes refundable
 * again. Called from the clawback path: if the purchase that triggered a refund
 * was itself refunded, the customer is back where they started and their spend
 * history should be too.
 */
export async function unmarkRefunded(uid: string, entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const col = db().collection(`users/${uid}/sparksLedger`);
  const CHUNK = 400;
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const batch = db().batch();
    for (const id of entryIds.slice(i, i + CHUNK)) {
      batch.set(col.doc(id), { refundedBy: null, refundedAt: null }, { merge: true });
    }
    try {
      await batch.commit();
    } catch {
      // Best-effort: leaving the watermark on is the safe direction (it can only
      // under-refund later, never over-refund).
    }
  }
}
