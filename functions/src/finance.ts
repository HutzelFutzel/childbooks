/**
 * Finance events — the single, normalized stream every money-relevant fact is
 * written to, powering the admin "total win" dashboard.
 *
 * One document per event in the top-level `financeEvents` collection (server
 * writes only; denied to clients):
 *
 *   { at, category, kind, amountUsd, uid?, projectId?, sparks?, currency?,
 *     amount?, ref?, meta? }
 *
 * `amountUsd` is SIGNED: positive = revenue, negative = cost. Non-money facts
 * (Spark grants/spends, failure markers) carry `amountUsd: 0` plus a `sparks`
 * delta so the dashboard can show the Spark economy without double counting —
 * the real dollar cost of granted Sparks materializes as `providerCost` events
 * when they're spent, and pack revenue is recognized at purchase time.
 *
 * Money in a non-USD currency is converted with the admin FX table (pricing
 * settings) at write time; the original `currency` + `amount` are kept so the
 * conversion is auditable.
 *
 * Idempotency: pass `ref` (paymentId / invoiceId / ledgerId) and the event id
 * becomes deterministic (`${kind}_${ref}`), so webhook retries can't double-
 * write. All writes are best-effort — bookkeeping must never break the flow
 * that produced the fact.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, type Query } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getPricingSettings } from "./appConfig";
import { fxRate } from "../../books-frontend/src/core/config/productMath";
import type { CurrencyCode } from "../../books-frontend/src/core/config/products";

export type FinanceCategory = "sparks" | "books" | "subscriptions" | "waste" | "infra" | "ops";

/** Well-known event kinds (free-form strings are allowed for forward-compat). */
export type FinanceKind =
  // sparks
  | "packRevenue" // + a Spark pack was paid for (gross)
  | "providerCost" // − metered AI provider cost of one action (charged or free)
  | "sparkGrant" // 0, sparks +N (meta.source: starter/subscription/referral/gift/adjust)
  | "sparkSpend" // 0, sparks −N (meta.paidSparks/freeSparks/paidUsd)
  // books
  | "printRevenue" // + a print order was paid for (gross)
  | "printCost" // − what the print provider charges us for a placed order
  | "ebookRevenue" // + a digital edition was paid for (gross; ~zero marginal cost)
  | "refund" // − refunded to the customer
  // subscriptions
  | "subscriptionRevenue" // + a subscription invoice was paid (gross)
  // any revenue category
  | "stripeFee" // − processor fee on a captured charge
  | "taxRemitted" // − sales tax / VAT collected on a charge (owed to the authority, not revenue)
  // waste
  | "failedCalls" // 0 (count marker) — failed/timed-out provider attempts
  | "fulfillmentFailed" // 0 (marker) — paid order whose print job failed
  // infra
  | "cloudCost" // − Google Cloud / Firebase spend (BigQuery billing export)
  | "infraBudget" // − prorated share of the admin-entered monthly infra budget
  // ops — admin-entered custom costs use per-cost kinds: `custom:{slug}` so
  // every service gets its own line in the cost-points table
  | (string & {});

export interface FinanceEventInput {
  category: FinanceCategory;
  kind: FinanceKind;
  /** Signed USD: + revenue, − cost. 0 for count/marker events. */
  amountUsd: number;
  uid?: string;
  projectId?: string;
  /** Signed Spark delta for Spark-economy events. */
  sparks?: number;
  /** Original money amount + currency (before USD conversion), if applicable. */
  currency?: string;
  amount?: number;
  /** Idempotency handle — same (kind, ref) never writes twice. */
  ref?: string;
  meta?: Record<string, unknown>;
  /** Event time override (defaults to now). */
  at?: number;
}

function db() {
  ensureAdmin();
  return getFirestore();
}

const COLLECTION = "financeEvents";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Convert a major-unit amount in `currency` to USD using the admin FX table.
 * Rates express base→currency multipliers; USD is assumed to be the base (the
 * default) — when it isn't, the USD rate converts through the base.
 */
export async function toUsd(amount: number, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "USD" || !Number.isFinite(amount) || amount === 0) return amount;
  try {
    const settings = await getPricingSettings();
    const inBase = amount / fxRate(settings, cur as CurrencyCode);
    if (settings.baseCurrency === "USD") return round4(inBase);
    return round4(inBase * fxRate(settings, "USD" as CurrencyCode));
  } catch {
    return amount; // best-effort: an unconverted amount beats a lost event
  }
}

/**
 * Append one finance event. Never throws — accounting must not break the
 * payment/generation flow that produced the fact.
 */
export async function recordFinanceEvent(e: FinanceEventInput): Promise<void> {
  try {
    const id = e.ref ? `${e.kind}_${e.ref}` : randomUUID();
    const doc: Record<string, unknown> = {
      at: e.at ?? Date.now(),
      category: e.category,
      kind: e.kind,
      amountUsd: round4(e.amountUsd),
    };
    if (e.uid) doc.uid = e.uid;
    if (e.projectId) doc.projectId = e.projectId;
    if (typeof e.sparks === "number" && e.sparks !== 0) doc.sparks = e.sparks;
    if (e.currency) doc.currency = e.currency.toUpperCase();
    if (typeof e.amount === "number") doc.amount = e.amount;
    if (e.ref) doc.ref = e.ref;
    if (e.meta && Object.keys(e.meta).length > 0) doc.meta = e.meta;
    if (e.ref) {
      // Deterministic id + create() ⇒ retries are no-ops (already exists).
      await db().collection(COLLECTION).doc(id).create(doc);
    } else {
      await db().collection(COLLECTION).doc(id).set(doc);
    }
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 6) return; // ALREADY_EXISTS — idempotent retry, expected
    console.error("[finance] failed to record event", e.kind, err);
  }
}

/** Convenience: record a captured charge (gross revenue + fee) in one call. */
export async function recordChargeRevenue(args: {
  category: FinanceCategory;
  kind: FinanceKind;
  uid: string;
  projectId?: string;
  gross: number;
  fee?: number | null;
  currency: string;
  ref: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const grossUsd = await toUsd(args.gross, args.currency);
  await recordFinanceEvent({
    category: args.category,
    kind: args.kind,
    amountUsd: grossUsd,
    uid: args.uid,
    projectId: args.projectId,
    currency: args.currency,
    amount: args.gross,
    ref: args.ref,
    meta: args.meta,
  });
  if (typeof args.fee === "number" && args.fee > 0) {
    const feeUsd = await toUsd(args.fee, args.currency);
    await recordFinanceEvent({
      category: args.category,
      kind: "stripeFee",
      amountUsd: -feeUsd,
      uid: args.uid,
      projectId: args.projectId,
      currency: args.currency,
      amount: args.fee,
      ref: args.ref,
    });
  }
}

/**
 * Record the sales tax / VAT collected on a charge as a cost line. Charge
 * grosses (`amount_received`, `invoice.amount_paid`) INCLUDE the tax Stripe
 * Tax collected — money owed to the tax authority, not revenue — so without
 * this line the "total win" is overstated by the full tax in every taxed
 * market. Booked as a separate line (rather than shrinking the recorded gross)
 * so the stream stays auditable against Stripe's own numbers.
 *
 * Known approximation: refunds are booked at their gross (tax-inclusive)
 * amount while the remitted tax here isn't reversed — a fully refunded charge
 * therefore looks worse by its tax portion (in reality the remittance is
 * adjusted). Rare enough to accept for a dashboard.
 */
export async function recordTaxRemitted(args: {
  category: FinanceCategory;
  uid?: string;
  projectId?: string;
  /** Major-unit tax amount in `currency`. */
  tax: number;
  currency: string;
  /** Idempotency handle (paymentId / invoiceId). */
  ref: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (!(args.tax > 0)) return;
  await recordFinanceEvent({
    category: args.category,
    kind: "taxRemitted",
    amountUsd: -(await toUsd(args.tax, args.currency)),
    uid: args.uid,
    projectId: args.projectId,
    currency: args.currency,
    amount: args.tax,
    ref: args.ref,
  });
}

// ---- Summary (admin dashboard) ----------------------------------------------

export interface FinanceKindSummary {
  category: FinanceCategory;
  kind: string;
  revenueUsd: number;
  costUsd: number; // positive number (magnitude of negative amounts)
  netUsd: number;
  count: number;
  sparks: number; // signed sum of spark deltas
}

export interface FinanceGroupSummary {
  key: string; // uid or projectId
  revenueUsd: number;
  costUsd: number;
  netUsd: number;
  count: number;
}

export interface FinanceSummary {
  fromMs: number;
  toMs: number;
  /** True when the scan hit the safety cap — totals are a lower bound. */
  capped: boolean;
  eventCount: number;
  totalRevenueUsd: number;
  totalCostUsd: number;
  /** The "total win": revenue − costs across everything in the window. */
  netUsd: number;
  byCategory: Record<string, { revenueUsd: number; costUsd: number; netUsd: number; count: number }>;
  /** Ranked cost points + revenue lines (the leak finder). */
  byKind: FinanceKindSummary[];
  byUser: FinanceGroupSummary[];
  byProject: FinanceGroupSummary[];
}

const MAX_SCAN = 50_000;
const PAGE = 5_000;

export interface FinanceSummaryQuery {
  fromMs: number;
  toMs: number;
  /** Optional filter to a single category ("sparks-total", "books-total", …). */
  category?: FinanceCategory;
  /** Optional filters for drill-down. */
  uid?: string;
  projectId?: string;
  /** Cap for the per-user / per-project group lists. */
  groupLimit?: number;
}

/**
 * Aggregate the finance stream over a window. Streams in pages ordered by `at`
 * (single-field index) and aggregates in memory; category/uid/project filters
 * are applied in memory so no composite indexes are required.
 */
export async function financeSummary(q: FinanceSummaryQuery): Promise<FinanceSummary> {
  const groupLimit = Math.min(Math.max(q.groupLimit ?? 50, 1), 500);
  const byCategory = new Map<string, { revenueUsd: number; costUsd: number; netUsd: number; count: number }>();
  const byKind = new Map<string, FinanceKindSummary>();
  const byUser = new Map<string, FinanceGroupSummary>();
  const byProject = new Map<string, FinanceGroupSummary>();
  let revenue = 0;
  let cost = 0;
  let count = 0;
  let capped = false;

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  for (;;) {
    let query: Query = db()
      .collection(COLLECTION)
      .where("at", ">=", q.fromMs)
      .where("at", "<=", q.toMs)
      .orderBy("at", "asc")
      .limit(PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      const d = doc.data() as Record<string, unknown>;
      const category = (d.category as string) ?? "sparks";
      if (q.category && category !== q.category) continue;
      const uid = (d.uid as string) ?? "";
      const projectId = (d.projectId as string) ?? "";
      if (q.uid && uid !== q.uid) continue;
      if (q.projectId && projectId !== q.projectId) continue;

      const kind = (d.kind as string) ?? "unknown";
      const amountUsd = typeof d.amountUsd === "number" ? d.amountUsd : 0;
      const sparks = typeof d.sparks === "number" ? d.sparks : 0;

      count += 1;
      if (amountUsd >= 0) revenue += amountUsd;
      else cost += -amountUsd;

      const cat = byCategory.get(category) ?? { revenueUsd: 0, costUsd: 0, netUsd: 0, count: 0 };
      if (amountUsd >= 0) cat.revenueUsd += amountUsd;
      else cat.costUsd += -amountUsd;
      cat.netUsd += amountUsd;
      cat.count += 1;
      byCategory.set(category, cat);

      const kk = `${category}|${kind}`;
      const k =
        byKind.get(kk) ??
        ({ category, kind, revenueUsd: 0, costUsd: 0, netUsd: 0, count: 0, sparks: 0 } as FinanceKindSummary);
      if (amountUsd >= 0) k.revenueUsd += amountUsd;
      else k.costUsd += -amountUsd;
      k.netUsd += amountUsd;
      k.count += 1;
      k.sparks += sparks;
      byKind.set(kk, k);

      for (const [key, map] of [
        [uid, byUser],
        [projectId, byProject],
      ] as const) {
        if (!key) continue;
        const g = map.get(key) ?? { key, revenueUsd: 0, costUsd: 0, netUsd: 0, count: 0 };
        if (amountUsd >= 0) g.revenueUsd += amountUsd;
        else g.costUsd += -amountUsd;
        g.netUsd += amountUsd;
        g.count += 1;
        map.set(key, g);
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (scanned >= MAX_SCAN) {
      capped = true;
      break;
    }
    if (snap.size < PAGE) break;
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const roundGroup = (g: FinanceGroupSummary): FinanceGroupSummary => ({
    ...g,
    revenueUsd: r2(g.revenueUsd),
    costUsd: r2(g.costUsd),
    netUsd: r2(g.netUsd),
  });
  const topGroups = (map: Map<string, FinanceGroupSummary>) =>
    [...map.values()]
      .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
      .slice(0, groupLimit)
      .map(roundGroup);

  return {
    fromMs: q.fromMs,
    toMs: q.toMs,
    capped,
    eventCount: count,
    totalRevenueUsd: r2(revenue),
    totalCostUsd: r2(cost),
    netUsd: r2(revenue - cost),
    byCategory: Object.fromEntries(
      [...byCategory.entries()].map(([cat, v]) => [
        cat,
        { revenueUsd: r2(v.revenueUsd), costUsd: r2(v.costUsd), netUsd: r2(v.netUsd), count: v.count },
      ]),
    ),
    byKind: [...byKind.values()]
      .map((k) => ({
        ...k,
        revenueUsd: r2(k.revenueUsd),
        costUsd: r2(k.costUsd),
        netUsd: r2(k.netUsd),
        sparks: Math.round(k.sparks),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.revenueUsd - a.revenueUsd),
    byUser: topGroups(byUser),
    byProject: topGroups(byProject),
  };
}
