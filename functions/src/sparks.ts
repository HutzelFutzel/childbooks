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
import { createHash, randomUUID } from "node:crypto";
import { getFirestore, FieldValue, type Transaction } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getImageCostStats, getModelCostTable, getSparksConfig } from "./appConfig";
import { resolveImageModels } from "./modelResolve";
import { actionMultiplier } from "./plans";
// Only the pricing half of the campaign engine — it imports config and nothing
// else, so the wallet can read a live price override without pulling in the
// payout executors (which import the wallet right back).
import { campaignActionMultiplier } from "./campaigns/pricing";
import { recordFinanceEvent } from "./finance";
import {
  estimateForAction,
  estimateSparkRange,
  maxEstimateSparks,
  priceForAction,
  type LedgerEntryType,
  type SparksConfig,
} from "../../books-frontend/src/core/config/sparks";
import {
  costForUsage,
  costKey,
  PUBLIC_IMAGE_ESTIMATE_USAGE,
} from "../../books-frontend/src/core/config/modelCosts";
import {
  recentCostSamples,
  type CostSampleKind,
} from "../../books-frontend/src/core/config/imageCostStats";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../../books-frontend/src/core/ai/actions";
import { type ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import { splitBillable, type UsageEvent } from "./usage";

function isImageAction(action: string): action is ImageActionId {
  return (ALL_IMAGE_ACTION_IDS as string[]).includes(action);
}

/** A nominal per-call USD cost for an action+tier's bound model (window fallback). */
async function nominalRateCostUsd(action: ImageActionId, tier: ImageTier): Promise<number | null> {
  try {
    const { imageModel } = await resolveImageModels(action, tier);
    const costs = await getModelCostTable();
    return costForUsage(
      costs.models[costKey(imageModel.provider, imageModel.id)],
      // The same reference image the storefront prices, so the server's reserve
      // and the studio's quote can never disagree about the rate-table rung.
      PUBLIC_IMAGE_ESTIMATE_USAGE,
    );
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
  | "refund"
  /** A marketing campaign grant or spend-refund (see `campaigns/`). */
  | "campaign";

interface SparkLot {
  id: string;
  source: SparkLotSource;
  amount: number;
  remaining: number;
  /** Real USD revenue per Spark (pack/gift purchases); null for free grants. */
  usdPerSpark: number | null;
  at: number;
  /**
   * When this lot's unspent Sparks lapse (0 = never). Promotional grants carry a
   * finite life because an unbounded promotional balance is an unbounded
   * liability tail; purchased Sparks never expire.
   */
  expiresAt: number;
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
      expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : 0,
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
  args: {
    source: SparkLotSource;
    amount: number;
    usdPerSpark?: number | null;
    ref?: string;
    expiresAt?: number;
  },
): void {
  const id = args.ref ? `lot_${args.ref}` : randomUUID();
  tx.set(db().doc(`users/${uid}/sparkLots/${id}`), {
    source: args.source,
    amount: args.amount,
    remaining: args.amount,
    usdPerSpark: args.usdPerSpark ?? null,
    at: Date.now(),
    expiresAt: args.expiresAt ?? 0,
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
  /**
   * How long these Sparks live, in days (0/absent = forever). Promotional grants
   * set this so a campaign's liability has a known end date; purchased Sparks
   * never pass it.
   */
  expiresInDays?: number;
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
    const expiresAt =
      args.expiresInDays && args.expiresInDays > 0 ? Date.now() + args.expiresInDays * 86_400_000 : 0;
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: args.type,
      amount: args.amount,
      balanceAfter,
      reason: args.reason,
      source: args.source,
      ...(expiresAt > 0 ? { expiresAt } : {}),
      ...(args.ref ? { ref: args.ref } : {}),
      at: Date.now(),
    });
    createLot(tx, args.uid, {
      source: args.source,
      amount: args.amount,
      usdPerSpark: args.usdPerSpark ?? null,
      ref: args.ref ? `${args.type}_${args.ref}` : undefined,
      expiresAt,
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
 * When more callers than this claim their FIRST ladder rung in one (UTC) day,
 * an admin alert fires — the cheap tripwire against grant farming.
 */
const GRANT_LADDER_DAILY_ALERT_THRESHOLD = 50;

/** Max distinct users per IP per (UTC) day that may start the grant ladder. */
const GRANT_LADDER_IP_DAILY_LIMIT = 5;

/** What the caller has proven about their identity (from the verified token). */
export interface GrantLadderCaller {
  uid: string;
  /** True for anonymous (guest) sessions. */
  anonymous: boolean;
  /** True when the account's email is verified (or provider-verified). */
  verified: boolean;
  /** Client IP for the per-IP first-grant throttle (best-effort). */
  ip?: string;
}

/**
 * Grant every ladder rung the caller currently qualifies for, exactly once per
 * rung (fixed refs): the guest rung for any session, the signup bonus once the
 * account is non-anonymous, and the verify bonus once the email is verified.
 * Safe to call repeatedly — each rung is idempotent, and later calls simply
 * top up the newly-unlocked rungs.
 *
 * Abuse controls: the FIRST rung for a uid is gated by a per-IP daily cap, and
 * first-rung velocity feeds a per-day counter with an admin alert. Accounts
 * that already received the legacy single "starter" grant are skipped entirely
 * so nobody is double-granted across the migration.
 */
export async function ensureGrantLadder(caller: GrantLadderCaller): Promise<void> {
  try {
    const config = await getSparksConfig();
    if (!config.enabled) return;
    const g = config.grants;

    // Legacy accounts already got the full old starter grant in one lump.
    const legacy = await db().doc(`users/${caller.uid}/sparksLedger/grant_starter`).get();
    if (legacy.exists) return;

    // First contact with the ladder? Enforce the per-IP cap before any grant.
    const first = !(await db().doc(`users/${caller.uid}/sparksLedger/grant_guest-starter`).get()).exists;
    if (first) {
      const allowed = await admitLadderStartForIp(caller.ip);
      if (!allowed) return;
    }

    let anyGranted = false;
    if (g.guestSparks > 0) {
      anyGranted =
        (await grantSparks({
          uid: caller.uid,
          amount: g.guestSparks,
          type: "grant",
          reason: "starter",
          source: "starter",
          ref: "guest-starter",
        })) || anyGranted;
    }
    if (!caller.anonymous && g.signupBonusSparks > 0) {
      anyGranted =
        (await grantSparks({
          uid: caller.uid,
          amount: g.signupBonusSparks,
          type: "grant",
          reason: "signup bonus",
          source: "starter",
          ref: "signup-bonus",
        })) || anyGranted;
    }
    if (!caller.anonymous && caller.verified && g.verifyBonusSparks > 0) {
      anyGranted =
        (await grantSparks({
          uid: caller.uid,
          amount: g.verifyBonusSparks,
          type: "grant",
          reason: "verify bonus",
          source: "starter",
          ref: "verify-bonus",
        })) || anyGranted;
    }
    if (first && anyGranted) await bumpLadderStartCounter();
  } catch {
    // Best-effort: never block sign-in/first use on the starter grants.
  }
}

/**
 * Per-IP daily admission for STARTING the grant ladder. Returns false once too
 * many distinct users behind one IP claimed their first rung today. Fails open
 * (missing/unparseable IP or Firestore hiccups must not block legit users).
 */
async function admitLadderStartForIp(ip: string | undefined): Promise<boolean> {
  if (!ip) return true;
  try {
    const { createHash } = await import("node:crypto");
    const day = new Date().toISOString().slice(0, 10);
    const hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const ref = db().doc(`abuseCounters/ipGrants_${day}_${hash}`);
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = ((snap.exists ? (snap.get("count") as number) : 0) ?? 0) + 1;
      if (count > GRANT_LADDER_IP_DAILY_LIMIT) return false;
      // expiresAt supports a Firestore TTL policy on this collection.
      tx.set(
        ref,
        { count, day, updatedAt: Date.now(), expiresAt: Date.now() + 7 * 86400_000 },
        { merge: true },
      );
      return true;
    });
  } catch {
    return true;
  }
}

/** Increment today's ladder-start counter and alert when velocity spikes. */
async function bumpLadderStartCounter(): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = db().doc(`stats/starterGrants_${day}`);
    const count = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = ((snap.exists ? (snap.get("count") as number) : 0) ?? 0) + 1;
      tx.set(ref, { count: next, day, updatedAt: Date.now() }, { merge: true });
      return next;
    });
    if (count === GRANT_LADDER_DAILY_ALERT_THRESHOLD) {
      const { raiseAlert } = await import("./alerts");
      await raiseAlert({
        severity: "warning",
        kind: "starterGrant.velocity",
        message: `${count} starter-grant ladders were started today (${day}) — check for signup farming.`,
        meta: { day, count },
        ref: day,
      });
    }
  } catch {
    // telemetry only
  }
}

export interface AffordOptions {
  /**
   * Deny the negative buffer (guests): the action must be fully covered by the
   * current balance. Guests have no payment relationship to settle a negative
   * balance against, so they never get credit.
   */
  noNegativeBuffer?: boolean;
}

/**
 * Pre-flight affordability check. Throws {@link InsufficientSparks} when starting
 * an action costing `estimateSparks` would push the balance below the configured
 * negative buffer. No-op when the economy is off or the estimate is 0.
 */
export async function ensureAfford(
  uid: string,
  estimateSparks: number,
  opts: AffordOptions = {},
): Promise<void> {
  if (estimateSparks <= 0) return;
  const config = await getSparksConfig();
  if (!config.enabled) return;
  const balance = await getBalance(uid);
  const floor = opts.noNegativeBuffer ? 0 : -config.maxNegativeSparks;
  if (balance - estimateSparks < floor) {
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

/** Models in this event set that the cost table has no rate for. */
async function unpricedModels(events: UsageEvent[]): Promise<string[]> {
  if (events.length === 0) return [];
  const costs = await getModelCostTable();
  const missing = new Set<string>();
  for (const e of events) {
    const key = costKey(e.provider, e.model);
    if (costForUsage(costs.models[key], e.usage) == null) missing.add(key);
  }
  return [...missing];
}

/**
 * A cost-derived action that settled to nothing did one of two things: it really
 * was free, or a model is missing from the cost table and the whole render was
 * given away. The second is a silent revenue leak — the user is quoted the
 * action's estimate and charged zero — so it gets the same waste marker a failed
 * settlement does rather than being left to a monthly aggregate flag.
 */
async function reportUnpricedIfNeeded(
  uid: string,
  action: string,
  config: SparksConfig,
  billable: UsageEvent[],
  costUsd: number,
  opts: SettleOptions,
): Promise<void> {
  if (config.actions[action]?.mode !== "derived") return;
  if (billable.length === 0 || costUsd > 0) return;
  const models = await unpricedModels(billable);
  if (models.length === 0) return;
  console.error("[sparks] derived action priced at 0 — model missing from the cost table", {
    uid,
    action,
    models,
  });
  await recordFinanceEvent({
    category: "waste",
    kind: "unpricedModel",
    amountUsd: 0,
    uid,
    projectId: opts.projectId,
    meta: {
      action,
      models,
      ...(opts.tier ? { tier: opts.tier } : {}),
      ...(opts.runId ? { runId: opts.runId } : {}),
    },
  });
}

export interface SettleOptions {
  /** The project the action belongs to (stamped on ledger + finance events). */
  projectId?: string;
  /** The action run this settlement belongs to (see `actionRun.ts`). */
  runId?: string;
  /**
   * A stable identifier for the unit of work being paid for — NOT for the
   * attempt. Queue delivery is at-least-once and the reaper re-drives a task
   * whose worker died after rendering, so without this a crash between "charged"
   * and "marked done" bills the same page twice. Given one, the ledger entry
   * takes a deterministic id and the second settlement is a no-op.
   *
   * Provider cost is deliberately NOT deduped on it: a re-render really did call
   * the provider again, and that dollar is real whether or not we charge for it.
   */
  settleKey?: string;
  /**
   * The image tier this action rendered at.
   *
   * Denormalized onto the ledger entry rather than left on the run record it
   * points at, because a campaign can refund "everything you spent on FAST
   * renders" — and that has to be a query over the ledger, not an N+1 join
   * through `actionRuns`. A dimension the ledger never recorded can never be
   * refunded retroactively.
   */
  tier?: ImageTier;
}

/** What one settlement actually charged, for the run record. */
export interface SettleResult {
  sparks: number;
  /** USD of billable provider cost the price was derived from. */
  costUsd: number;
  breakdown: SpendBreakdown | null;
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
): Promise<SettleResult> {
  try {
    const config = await getSparksConfig();
    if (!config.enabled) return { sparks: 0, costUsd: 0, breakdown: null };
    // Only what the user asked for reaches the wallet — repair passes are ours.
    // Split here rather than at the call sites so a direct caller can't skip it.
    const { billable } = splitBillable(events);
    const [costUsd, planMultiplier, campaignMultiplier] = await Promise.all([
      usdForEvents(billable),
      actionMultiplier(uid, action),
      campaignActionMultiplier(uid, action, opts.tier ?? null),
    ]);
    // The campaign override multiplies the plan's own discount. It is applied
    // here AND in `estimateForUser` from the same helper — a promo that only
    // reaches settlement would quote 5 ✦ and charge 0, and one that only reached
    // the quote would promise "free" and then bill for it.
    const multiplier = planMultiplier * campaignMultiplier;
    const price = priceForAction(config, action, costUsd, multiplier);
    if (price <= 0) {
      await reportUnpricedIfNeeded(uid, action, config, billable, costUsd, opts);
      return { sparks: 0, costUsd, breakdown: null };
    }
    const breakdown = await deductSparks(uid, price, action, {
      projectId: opts.projectId,
      runId: opts.runId,
      tier: opts.tier,
      model: primaryModel(billable),
      settleKey: opts.settleKey,
    });
    // A null breakdown means this unit of work was already paid for by an
    // earlier attempt — the render happened again, the charge did not. Marked
    // explicitly so the resulting "quoted N, charged 0" run reads as a re-drive
    // rather than as the revenue leak it would otherwise be indistinguishable
    // from; the provider cost of the second render is booked as usual.
    if (!breakdown) {
      await recordFinanceEvent({
        category: "waste",
        kind: "resettleSkipped",
        amountUsd: 0,
        uid,
        projectId: opts.projectId,
        meta: {
          action,
          sparks: price,
          ...(opts.tier ? { tier: opts.tier } : {}),
          ...(opts.runId ? { runId: opts.runId } : {}),
        },
      });
      return { sparks: 0, costUsd, breakdown: null };
    }
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
        ...(opts.runId ? { runId: opts.runId } : {}),
      },
    });
    return { sparks: price, costUsd, breakdown };
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
      meta: {
        action,
        error: (err as Error)?.message ?? String(err),
        ...(opts.runId ? { runId: opts.runId } : {}),
      },
    });
    return { sparks: 0, costUsd: 0, breakdown: null };
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
 * Take back Sparks from a grant that shouldn't have happened (a referral reward
 * whose purchase was refunded or disputed).
 *
 * Two rules make this safe to run automatically:
 *   - It NEVER drives the balance below zero. Sparks already spent bought real
 *     provider work; clawing them back would leave a legitimate refunder unable
 *     to generate, which is a worse outcome than eating the loss.
 *   - It's idempotent on `ref`, so a repeated refund webhook debits once.
 *
 * Returns how many Sparks were actually recovered (0 when they were all spent,
 * or when this ref was already reversed).
 */
export async function reverseGrantedSparks(args: {
  uid: string;
  amount: number;
  reason: string;
  ref: string;
}): Promise<number> {
  if (args.amount <= 0) return 0;
  ensureAdmin();
  const userRef = db().doc(`users/${args.uid}`);
  const ledgerRef = userRef.collection("sparksLedger").doc(`adjust_${args.ref}`);

  const debited = await db().runTransaction(async (tx) => {
    if ((await tx.get(ledgerRef)).exists) return 0;
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return 0;
    const lots = await readLots(tx, args.uid);
    const current = (userSnap.get("sparkBalance") as number) ?? 0;
    const recover = Math.min(args.amount, Math.max(0, current));
    if (recover <= 0) return 0;
    const balanceAfter = current - recover;
    consumeLots(tx, args.uid, lots, recover);
    tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
    tx.set(ledgerRef, {
      type: "adjust",
      amount: -recover,
      balanceAfter,
      reason: args.reason,
      source: "adjust",
      ref: args.ref,
      at: Date.now(),
    });
    return recover;
  });

  if (debited > 0) {
    await recordFinanceEvent({
      category: "sparks",
      kind: "sparkSpend",
      amountUsd: 0,
      uid: args.uid,
      sparks: -debited,
      ref: `adjust_${args.ref}`,
      meta: { source: "adjust", reason: args.reason },
    });
  }
  return debited;
}

/**
 * Retire promotional Spark lots whose life has run out.
 *
 * The `expiry` ledger type existed long before anything wrote it, which meant
 * `expiresInDays` on a campaign grant was a promise we made to ourselves and
 * never kept — every promotion quietly added to a permanent liability. This is
 * the enforcement.
 *
 * Only the UNSPENT remainder of an expired lot is retired, and only down to zero:
 * Sparks already spent bought real provider work, and a lapse must never leave
 * someone with a negative balance they didn't create. Idempotent — a lot is
 * zeroed and stamped in the same transaction, so a second sweep finds nothing.
 */
export async function expireSparkLots(
  opts: { maxLots?: number; at?: number } = {},
): Promise<{ lots: number; sparks: number }> {
  ensureAdmin();
  const at = opts.at ?? Date.now();
  let lots = 0;
  let sparks = 0;

  // A collection-group query over every user's lots: the alternative is scanning
  // the user table, which is far larger than the set of lots that ever expire.
  const due = await db()
    .collectionGroup("sparkLots")
    .where("expiresAt", ">", 0)
    .where("expiresAt", "<=", at)
    .limit(opts.maxLots ?? 500)
    .get();

  for (const doc of due.docs) {
    // `users/{uid}/sparkLots/{lotId}` — the grandparent is the account.
    const uid = doc.ref.parent.parent?.id;
    if (!uid) continue;
    const remaining = (doc.get("remaining") as number) ?? 0;
    if (remaining <= 0) {
      // Fully spent before it lapsed: nothing to reclaim, but stamp it so the
      // sweep doesn't keep finding it.
      await doc.ref.set({ expiresAt: 0, expiredAt: at }, { merge: true }).catch(() => {});
      continue;
    }

    const userRef = db().doc(`users/${uid}`);
    const ledgerRef = userRef.collection("sparksLedger").doc(`expiry_${doc.id}`);
    try {
      const removed = await db().runTransaction(async (tx) => {
        const lotSnap = await tx.get(doc.ref);
        if (!lotSnap.exists) return 0;
        const left = (lotSnap.get("remaining") as number) ?? 0;
        if (left <= 0) return 0;
        const userSnap = await tx.get(userRef);
        const current = (userSnap.get("sparkBalance") as number) ?? 0;
        const take = Math.min(left, Math.max(0, current));
        const balanceAfter = current - take;
        tx.set(doc.ref, { remaining: left - take, expiresAt: 0, expiredAt: at }, { merge: true });
        if (take > 0) {
          tx.set(userRef, { sparkBalance: balanceAfter }, { merge: true });
          tx.set(ledgerRef, {
            type: "expiry",
            amount: -take,
            balanceAfter,
            reason: "promotional Sparks expired",
            source: (lotSnap.get("source") as string) ?? "adjust",
            ref: doc.id,
            at,
          });
        }
        return take;
      });
      if (removed > 0) {
        lots += 1;
        sparks += removed;
        await recordFinanceEvent({
          category: "sparks",
          kind: "sparkSpend",
          amountUsd: 0,
          uid,
          sparks: -removed,
          ref: `expiry_${doc.id}`,
          meta: { source: "expiry", reason: "promotional Sparks expired" },
        });
      }
    } catch (err) {
      console.warn("[sparks] lot expiry failed", doc.ref.path, err);
    }
  }
  return { lots, sparks };
}

/** The image model most of a call's billable work went to (for the ledger). */
function primaryModel(events: UsageEvent[]): string | undefined {
  const image = events.find((e) => e.modality === "image");
  return (image ?? events[0])?.model;
}

/** Extra provenance stamped on a spend entry so refunds can be scoped by it. */
interface SpendContext {
  projectId?: string;
  runId?: string;
  tier?: ImageTier;
  model?: string;
  /** See {@link SettleOptions.settleKey} — makes the deduction idempotent. */
  settleKey?: string;
}

/**
 * A ledger doc id derived from a settle key. Hashed rather than used raw so an
 * arbitrary caller-supplied key can never contain a `/` and address a different
 * collection, and so the id stays a fixed length.
 */
function spendLedgerId(settleKey: string): string {
  return `spend_${createHash("sha256").update(settleKey).digest("hex").slice(0, 32)}`;
}

/**
 * Deduct Sparks (allowed to dip into the negative buffer) + append a ledger
 * entry, consuming lots FIFO. Returns the paid/free breakdown of the spend, or
 * null when `ctx.settleKey` names work that was already charged for.
 */
async function deductSparks(
  uid: string,
  amount: number,
  reason: string,
  ctx: SpendContext = {},
): Promise<SpendBreakdown | null> {
  ensureAdmin();
  const userRef = db().doc(`users/${uid}`);
  const ledgerRef = userRef
    .collection("sparksLedger")
    .doc(ctx.settleKey ? spendLedgerId(ctx.settleKey) : randomUUID());
  return db().runTransaction(async (tx) => {
    // Read the idempotency marker FIRST: Firestore requires every read before
    // any write, and a hit means there is nothing left to do.
    if (ctx.settleKey && (await tx.get(ledgerRef)).exists) return null;
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
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      // See `SettleOptions.tier` — a campaign can refund by tier or model, and
      // only what the ledger stored is refundable.
      ...(ctx.tier ? { tier: ctx.tier } : {}),
      ...(ctx.model ? { model: ctx.model } : {}),
      paidSparks: breakdown.paidSparks,
      freeSparks: breakdown.freeSparks + breakdown.unfundedSparks,
      // Broken out as well as folded into `freeSparks` above: the subsidy report
      // wants them together (both are unpaid), but a campaign refund must never
      // return Sparks the customer never had, so it needs them apart.
      unfundedSparks: breakdown.unfundedSparks,
      paidUsd: breakdown.paidUsd,
      // Which grants funded the free half (starter / referral / subscription …).
      // The per-project subsidy report reads this, so it has to survive on the
      // ledger rather than only in the finance event's meta.
      freeBySource: breakdown.freeBySource,
      at: Date.now(),
    });
    return breakdown;
  });
}

/**
 * The Spark estimate to pre-check (reserve) for one action (config + plan
 * aware). For image actions priced as "derived", the reserve uses the UPPER
 * bound of the recent-cost window for the chosen tier and render kind (falling
 * back to the model's rate-table cost, then the flat configured estimate) so we
 * never start a render the user can't afford. Settlement still charges the
 * exact cost.
 */
export async function estimateForUser(
  uid: string,
  action: string,
  tier: ImageTier,
  kind: CostSampleKind = "fresh",
): Promise<number> {
  const config = await getSparksConfig();
  if (!config.enabled) return 0;
  // The campaign override is folded in here as well as at settlement, from the
  // same helper. If it only reached one of the two, the studio would quote a
  // price the wallet doesn't charge — in whichever direction is worse.
  const [planMultiplier, campaignMultiplier] = await Promise.all([
    actionMultiplier(uid, action),
    campaignActionMultiplier(uid, action, tier),
  ]);
  const multiplier = planMultiplier * campaignMultiplier;
  const rule = config.actions[action];
  if (rule?.mode === "derived" && isImageAction(action)) {
    const [stats, rateCostUsd] = await Promise.all([
      getImageCostStats(),
      nominalRateCostUsd(action, tier),
    ]);
    const range = estimateSparkRange(config, {
      samples: recentCostSamples(stats, action, tier, kind),
      rateCostUsd,
      fallbackSparks: rule.estimatedSparks,
    });
    const m = multiplier > 0 ? multiplier : 1;
    return Math.max(0, Math.round(maxEstimateSparks(range) * m));
  }
  return estimateForAction(config, action, multiplier);
}

export interface AffordActionOptions extends AffordOptions {
  /**
   * Whether this run is an edit. Edits are priced from their own cost window
   * because they spend one image call per subject, so reserving a fresh
   * render's estimate for one systematically under-quoted the charge.
   */
  kind?: CostSampleKind;
}

/**
 * Convenience: the affordability estimate for a single action, then ensure it.
 * Returns the estimate so the caller can record what the user was quoted
 * alongside what they were finally charged — a quote that routinely undershoots
 * the charge is the most damaging kind of pricing bug, and it's invisible
 * unless both numbers are stored on the same record.
 */
export async function ensureAffordAction(
  uid: string,
  action: string,
  tier: ImageTier,
  opts: AffordActionOptions = {},
): Promise<number> {
  const estimate = await estimateForUser(uid, action, tier, opts.kind ?? "fresh");
  await ensureAfford(uid, estimate, opts);
  return estimate;
}

export type { SparksConfig };
