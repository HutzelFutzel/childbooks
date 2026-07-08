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
 *
 * LOT ACCOUNTING: every credit also creates a lot in `users/{uid}/sparkLots`
 * carrying its source (starter / subscription / pack / referral / gift /
 * adjust) and — for purchases — the real USD paid per Spark. Spends consume
 * lots FIFO and record the paid/free split on the ledger entry, so the finance
 * stream can distinguish recognized revenue from promotional cost.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue, type Transaction } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getImageCostStats, getModelCostTable, getSparksConfig } from "./appConfig";
import { resolveImageModels } from "./modelResolve";
import { actionMultiplier } from "./plans";
import { recordFinanceEvent } from "./finance";
import {
  estimateForAction,
  estimateSparkRange,
  maxEstimateSparks,
  priceForAction,
  type LedgerEntryType,
  type SparksConfig,
} from "../../books-frontend/src/core/config/sparks";
import { costForUsage, costKey } from "../../books-frontend/src/core/config/modelCosts";
import { recentCostSamples } from "../../books-frontend/src/core/config/imageCostStats";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../../books-frontend/src/core/ai/actions";
import { DEFAULT_IMAGE_TIER, type ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import type { UsageEvent } from "./usage";

function isImageAction(action: string): action is ImageActionId {
  return (ALL_IMAGE_ACTION_IDS as string[]).includes(action);
}

/** A nominal per-call USD cost for an action+tier's bound model (window fallback). */
async function nominalRateCostUsd(action: ImageActionId, tier: ImageTier): Promise<number | null> {
  try {
    const { imageModel } = await resolveImageModels(action, tier);
    const costs = await getModelCostTable();
    return costForUsage(costs.models[costKey(imageModel.provider, imageModel.id)], {
      images: 1,
      size: "1024x1024",
    });
  } catch {
    return null;
  }
}

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

// ---- Lot accounting ----------------------------------------------------------

/** Where a lot of Sparks came from — "pack" and "gift" are paid, the rest free. */
export type SparkLotSource =
  | "starter"
  | "subscription"
  | "pack"
  | "referral"
  | "gift"
  | "adjust"
  | "refund";

interface SparkLot {
  id: string;
  source: SparkLotSource;
  amount: number;
  remaining: number;
  /** Real USD revenue per Spark (pack/gift purchases); null for free grants. */
  usdPerSpark: number | null;
  at: number;
}

/** How a spend decomposed across lots — the paid/free revenue attribution. */
export interface SpendBreakdown {
  paidSparks: number;
  freeSparks: number;
  /** Sparks spent past all lots (negative-buffer territory). Treated as free. */
  unfundedSparks: number;
  /** Recognized revenue value of the paid portion (sum of lot rates). */
  paidUsd: number;
  /** Free sparks by source, e.g. { starter: 3, subscription: 2 }. */
  freeBySource: Record<string, number>;
}

const MAX_LOTS_READ = 500;

/** Read a user's lots oldest-first inside a transaction (FIFO consumption order). */
async function readLots(tx: Transaction, uid: string): Promise<SparkLot[]> {
  const snap = await tx.get(
    db().collection(`users/${uid}/sparkLots`).orderBy("at", "asc").limit(MAX_LOTS_READ),
  );
  return snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      source: (raw.source as SparkLotSource) ?? "adjust",
      amount: typeof raw.amount === "number" ? raw.amount : 0,
      remaining: typeof raw.remaining === "number" ? raw.remaining : 0,
      usdPerSpark: typeof raw.usdPerSpark === "number" ? raw.usdPerSpark : null,
      at: typeof raw.at === "number" ? raw.at : 0,
    };
  });
}

/**
 * Consume `amount` Sparks from the given lots FIFO (mutates `remaining` and
 * stages the writes on the transaction). Returns the paid/free breakdown.
 */
function consumeLots(
  tx: Transaction,
  uid: string,
  lots: SparkLot[],
  amount: number,
): SpendBreakdown {
  let left = amount;
  const breakdown: SpendBreakdown = {
    paidSparks: 0,
    freeSparks: 0,
    unfundedSparks: 0,
    paidUsd: 0,
    freeBySource: {},
  };
  for (const lot of lots) {
    if (left <= 0) break;
    if (lot.remaining <= 0) continue;
    const take = Math.min(lot.remaining, left);
    lot.remaining -= take;
    left -= take;
    if (lot.usdPerSpark != null && lot.usdPerSpark > 0) {
      breakdown.paidSparks += take;
      breakdown.paidUsd += take * lot.usdPerSpark;
    } else {
      breakdown.freeSparks += take;
      breakdown.freeBySource[lot.source] = (breakdown.freeBySource[lot.source] ?? 0) + take;
    }
    tx.set(
      db().doc(`users/${uid}/sparkLots/${lot.id}`),
      { remaining: lot.remaining },
      { merge: true },
    );
  }
  breakdown.unfundedSparks = left;
  breakdown.paidUsd = Math.round(breakdown.paidUsd * 10000) / 10000;
  return breakdown;
}

/** Stage a new lot write on the transaction. */
function createLot(
  tx: Transaction,
  uid: string,
  args: { source: SparkLotSource; amount: number; usdPerSpark?: number | null; ref?: string },
): void {
  const id = args.ref ? `lot_${args.ref}` : randomUUID();
  tx.set(db().doc(`users/${uid}/sparkLots/${id}`), {
    source: args.source,
    amount: args.amount,
    remaining: args.amount,
    usdPerSpark: args.usdPerSpark ?? null,
    at: Date.now(),
    ...(args.ref ? { ref: args.ref } : {}),
  });
}

// ---- Grants -------------------------------------------------------------------

interface GrantArgs {
  uid: string;
  amount: number;
  type: Extract<LedgerEntryType, "grant" | "purchase" | "refund" | "adjust">;
  reason: string;
  /** Provenance of the Sparks (drives paid/free attribution on later spends). */
  source: SparkLotSource;
  /** Real USD revenue per Spark for purchased Sparks (packs, gifts). */
  usdPerSpark?: number | null;
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
 * Add Sparks to a user's balance + append a ledger entry + create a lot,
 * atomically. When `ref` is given the operation is idempotent (a second call
 * with the same ref + type is a no-op), so webhook retries are safe. Returns
 * true when the grant was applied (false = already granted for this ref).
 */
export async function grantSparks(args: GrantArgs): Promise<boolean> {
  if (args.amount <= 0) return false;
  ensureAdmin();
  const userRef = db().doc(`users/${args.uid}`);
  const ledgerId = args.ref ? `${args.type}_${args.ref}` : randomUUID();
  const ledgerRef = userRef.collection("sparksLedger").doc(ledgerId);

  let granted = false;
  await db().runTransaction(async (tx) => {
    granted = false;
    if (args.ref) {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) return; // already granted for this ref
    }
    const userSnap = await tx.get(userRef);
    const lots = await readLots(tx, args.uid);
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    let base = current;
    if (typeof args.rolloverCap === "number" && current > Math.max(0, args.rolloverCap)) {
      base = Math.max(0, args.rolloverCap);
      // Keep lots in sync with the forfeited balance (oldest sparks expire first).
      consumeLots(tx, args.uid, lots, current - base);
    }
    const balanceAfter = base + args.amount;
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: args.type,
      amount: args.amount,
      balanceAfter,
      reason: args.reason,
      source: args.source,
      ...(args.ref ? { ref: args.ref } : {}),
      at: Date.now(),
    });
    createLot(tx, args.uid, {
      source: args.source,
      amount: args.amount,
      usdPerSpark: args.usdPerSpark ?? null,
      ref: args.ref ? `${args.type}_${args.ref}` : undefined,
    });
    granted = true;
  });

  if (granted) {
    await recordFinanceEvent({
      category: "sparks",
      kind: "sparkGrant",
      amountUsd: 0,
      uid: args.uid,
      sparks: args.amount,
      ref: ledgerId,
      meta: { source: args.source, reason: args.reason },
    });
  }
  return granted;
}

/**
 * When more fresh accounts than this claim the starter grant in one (UTC) day,
 * an admin alert fires — the cheap tripwire against starter-grant farming.
 */
const STARTER_GRANT_DAILY_ALERT_THRESHOLD = 50;

/**
 * Grant the one-time starter Sparks to a brand-new account, exactly once (keyed
 * by a fixed ref). No-op when the economy is disabled or the grant is zero.
 * Also feeds a per-day counter with a velocity alert for abuse detection.
 */
export async function ensureStarterGrant(uid: string): Promise<void> {
  try {
    const config = await getSparksConfig();
    if (!config.enabled || config.starterGrant <= 0) return;
    const granted = await grantSparks({
      uid,
      amount: config.starterGrant,
      type: "grant",
      reason: "starter",
      source: "starter",
      ref: "starter",
    });
    if (granted) await bumpStarterGrantCounter();
  } catch {
    // Best-effort: never block sign-in/first use on the starter grant.
  }
}

/** Increment today's starter-grant counter and alert when velocity spikes. */
async function bumpStarterGrantCounter(): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = db().doc(`stats/starterGrants_${day}`);
    const count = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = ((snap.exists ? (snap.get("count") as number) : 0) ?? 0) + 1;
      tx.set(ref, { count: next, day, updatedAt: Date.now() }, { merge: true });
      return next;
    });
    if (count === STARTER_GRANT_DAILY_ALERT_THRESHOLD) {
      const { raiseAlert } = await import("./alerts");
      await raiseAlert({
        severity: "warning",
        kind: "starterGrant.velocity",
        message: `${count} starter grants were claimed today (${day}) — check for signup farming.`,
        meta: { day, count },
        ref: day,
      });
    }
  } catch {
    // telemetry only
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

export interface SettleOptions {
  /** The project the action belongs to (stamped on ledger + finance events). */
  projectId?: string;
}

/**
 * Deduct the real Spark price of a completed action from the user's metered
 * usage, applying any per-plan multiplier. Returns the Sparks spent (0 when the
 * economy is off or the action is free). Best-effort: a failure here never
 * breaks generation — but it is LOGGED and recorded to the finance stream so
 * uncharged work can't leak silently.
 */
export async function settleActionCost(
  uid: string,
  action: string,
  events: UsageEvent[],
  opts: SettleOptions = {},
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
    const breakdown = await deductSparks(uid, price, action, opts.projectId);
    await recordFinanceEvent({
      category: "sparks",
      kind: "sparkSpend",
      amountUsd: 0,
      uid,
      projectId: opts.projectId,
      sparks: -price,
      meta: {
        action,
        paidSparks: breakdown.paidSparks,
        freeSparks: breakdown.freeSparks,
        unfundedSparks: breakdown.unfundedSparks,
        paidUsd: breakdown.paidUsd,
        freeBySource: breakdown.freeBySource,
      },
    });
    return price;
  } catch (err) {
    // Never break generation — but a user who wasn't charged is a revenue leak,
    // so make it loud: error log + a waste marker the dashboard surfaces.
    console.error("[sparks] settle failed — action completed WITHOUT charge", {
      uid,
      action,
      projectId: opts.projectId,
      err,
    });
    await recordFinanceEvent({
      category: "waste",
      kind: "settleFailed",
      amountUsd: 0,
      uid,
      projectId: opts.projectId,
      meta: { action, error: (err as Error)?.message ?? String(err) },
    });
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
  const ledgerId = randomUUID();
  const ledgerRef = userRef.collection("sparksLedger").doc(ledgerId);
  const balance = await db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error("User not found.");
    const lots = await readLots(tx, uid);
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    const balanceAfter = current + delta;
    if (delta > 0) createLot(tx, uid, { source: "adjust", amount: delta });
    else consumeLots(tx, uid, lots, -delta);
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: "adjust",
      amount: delta,
      balanceAfter,
      reason,
      source: "adjust",
      at: Date.now(),
    });
    return balanceAfter;
  });
  await recordFinanceEvent({
    category: "sparks",
    kind: delta > 0 ? "sparkGrant" : "sparkSpend",
    amountUsd: 0,
    uid,
    sparks: delta,
    ref: ledgerId,
    meta: { source: "adjust", reason },
  });
  return balance;
}

/**
 * Deduct Sparks (allowed to dip into the negative buffer) + append a ledger
 * entry, consuming lots FIFO. Returns the paid/free breakdown of the spend.
 */
async function deductSparks(
  uid: string,
  amount: number,
  reason: string,
  projectId?: string,
): Promise<SpendBreakdown> {
  ensureAdmin();
  const userRef = db().doc(`users/${uid}`);
  const ledgerRef = userRef.collection("sparksLedger").doc(randomUUID());
  return db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const lots = await readLots(tx, uid);
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    const balanceAfter = current - amount;
    const breakdown = consumeLots(tx, uid, lots, amount);
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: "spend",
      amount: -amount,
      balanceAfter,
      reason,
      ...(projectId ? { projectId } : {}),
      paidSparks: breakdown.paidSparks,
      freeSparks: breakdown.freeSparks + breakdown.unfundedSparks,
      paidUsd: breakdown.paidUsd,
      at: Date.now(),
    });
    return breakdown;
  });
}

/**
 * The Spark estimate to pre-check (reserve) for one action (config + plan
 * aware). For image actions priced as "derived", the reserve uses the UPPER
 * bound of the recent-cost window for the chosen tier (falling back to the
 * model's rate-table cost, then the flat configured estimate) so we never start
 * a render the user can't afford. Settlement still charges the exact cost.
 */
export async function estimateForUser(
  uid: string,
  action: string,
  tier: ImageTier = DEFAULT_IMAGE_TIER,
): Promise<number> {
  const config = await getSparksConfig();
  if (!config.enabled) return 0;
  const multiplier = await actionMultiplier(uid, action);
  const rule = config.actions[action];
  if (rule?.mode === "derived" && isImageAction(action)) {
    const [stats, rateCostUsd] = await Promise.all([
      getImageCostStats(),
      nominalRateCostUsd(action, tier),
    ]);
    const range = estimateSparkRange(config, {
      samples: recentCostSamples(stats, action, tier),
      rateCostUsd,
      fallbackSparks: rule.estimatedSparks,
    });
    const m = multiplier > 0 ? multiplier : 1;
    return Math.max(0, Math.round(maxEstimateSparks(range) * m));
  }
  return estimateForAction(config, action, multiplier);
}

/** Convenience: the affordability estimate for a single action, then ensure it. */
export async function ensureAffordAction(
  uid: string,
  action: string,
  tier: ImageTier = DEFAULT_IMAGE_TIER,
): Promise<void> {
  const estimate = await estimateForUser(uid, action, tier);
  await ensureAfford(uid, estimate);
}

export type { SparksConfig };
