/**
 * Finance events — the single, normalized stream every money-relevant fact is
 * written to, powering the admin "total win" dashboard.
 *
 * One document per event in the top-level `financeEvents` collection (server
 * writes only; denied to clients):
 *
 *   { at, category, kind, amountUsd, uid?, projectId?, sparks?, currency?,
 *     amount?, country?, productId?, sku?, units?, ref?, meta? }
 *
 * `country` and `productId` are the two analysis dimensions the admin dashboard
 * slices on. Both are stamped at WRITE time rather than joined at read time:
 * the stream is append-only and immutable, so a revenue line that didn't record
 * which market and which product it came from can never be attributed later.
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
import { normalizeCountry, UNKNOWN_COUNTRY } from "../../books-frontend/src/core/analytics/markets";
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
  | "qcCost" // 0 (marker) — repair passes we absorb (dollars booked by providerCost)
  | "settleFailed" // 0 (marker) — an action completed but the wallet write threw
  | "unpricedModel" // 0 (marker) — a cost-derived action gave a render away for free
  | "resettleSkipped" // 0 (marker) — a re-driven task re-rendered; the charge was deduped
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
  /**
   * ISO-3166 alpha-2 market this money came from or went to. Which country
   * that is depends on the line: revenue uses the BILLING country (who paid),
   * print costs use the SHIPPING DESTINATION (what drove the cost). They differ
   * on every gift order, so the dashboard reports them as separate dimensions
   * rather than pretending there's one "country" per order.
   */
  country?: string;
  /** Stable product key (see {@link productKey}) — the "top products" axis. */
  productId?: string;
  /** Provider SKU for print lines, kept for provider-side reconciliation. */
  sku?: string;
  /** Sellable units on this line (copies for print, else 1). */
  units?: number;
  /** Idempotency handle — same (kind, ref) never writes twice. */
  ref?: string;
  meta?: Record<string, unknown>;
  /** Event time override (defaults to now). */
  at?: number;
}

/**
 * Build the stable product key every revenue/cost line is grouped by.
 *
 * Namespaced by family so print books, ebooks, Spark packs and subscription
 * plans share one "top products" ranking. Print uses the catalog's INTERNAL
 * product id, never the provider SKU: re-pointing a product at a different
 * Lulu SKU (paper change, provider switch) must not split its history in two.
 */
export function productKey(
  family: "print" | "ebook" | "pack" | "plan",
  id: string | null | undefined,
): string {
  const slug = (id ?? "").trim();
  return slug ? `${family}:${slug}` : family;
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
    const country = normalizeCountry(e.country);
    if (country) doc.country = country;
    if (e.productId) doc.productId = e.productId;
    if (e.sku) doc.sku = e.sku;
    if (typeof e.units === "number" && Number.isFinite(e.units)) doc.units = e.units;
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
  /** Billing market of the charge. */
  country?: string;
  productId?: string;
  sku?: string;
  units?: number;
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
    country: args.country,
    productId: args.productId,
    sku: args.sku,
    units: args.units,
    ref: args.ref,
    meta: args.meta,
  });
  if (typeof args.fee === "number" && args.fee > 0) {
    const feeUsd = await toUsd(args.fee, args.currency);
    // The fee carries the same dimensions as the charge it was taken from, so
    // per-market and per-product NET stays correct rather than only gross.
    await recordFinanceEvent({
      category: args.category,
      kind: "stripeFee",
      amountUsd: -feeUsd,
      uid: args.uid,
      projectId: args.projectId,
      currency: args.currency,
      amount: args.fee,
      country: args.country,
      productId: args.productId,
      sku: args.sku,
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
  /** Billing market — tax rates are market-specific, so net-by-market needs it. */
  country?: string;
  productId?: string;
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
    country: args.country,
    productId: args.productId,
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

/** One market's contribution to the window. */
export interface FinanceCountrySummary extends FinanceGroupSummary {
  /** Sellable units sold into this market. */
  units: number;
  /** Refunded USD (a subset of `costUsd`) — the market's quality signal. */
  refundUsd: number;
  /** Distinct paying users seen in this market. */
  buyers: number;
}

/** One product's contribution to the window. */
export interface FinanceProductSummary extends FinanceGroupSummary {
  /** Latest provider SKU observed for this product (print lines only). */
  sku: string | null;
  units: number;
  refundUsd: number;
  /** Net USD per unit — the number that ranks products honestly. */
  netPerUnitUsd: number | null;
  /** Distinct markets this product sold into. */
  countries: number;
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
  /** Ranked markets — the "which countries actually pay" view. */
  byCountry: FinanceCountrySummary[];
  /** Ranked products — top sellers by net contribution. */
  byProduct: FinanceProductSummary[];
  /** Daily net/revenue/cost series across the window (zero-filled, ascending). */
  series: FinanceSeriesPoint[];
}

/** One day on the finance time-series axis (`day` is `YYYY-MM-DD` in tz). */
export interface FinanceSeriesPoint {
  day: string;
  revenueUsd: number;
  costUsd: number;
  netUsd: number;
  units: number;
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
  /** Optional market filter (ISO-3166 alpha-2, or "ZZ" for unattributed). */
  country?: string;
  /** Optional product filter (a {@link productKey}). */
  productId?: string;
  /** Cap for the per-user / per-project group lists. */
  groupLimit?: number;
  /** IANA timezone the daily series is bucketed in. Defaults to UTC. */
  timezone?: string;
}

/** `YYYY-MM-DD` for an instant in the given IANA timezone. */
function dayKeyIn(at: number, tz: string): string {
  try {
    // `en-CA` formats as YYYY-MM-DD, which is exactly the sortable key we want.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * Aggregate the finance stream over a window. Streams in pages ordered by `at`
 * (single-field index) and aggregates in memory; category/uid/project filters
 * are applied in memory so no composite indexes are required.
 */
export async function financeSummary(q: FinanceSummaryQuery): Promise<FinanceSummary> {
  const groupLimit = Math.min(Math.max(q.groupLimit ?? 50, 1), 500);
  const tz = q.timezone || "UTC";
  const byCategory = new Map<string, { revenueUsd: number; costUsd: number; netUsd: number; count: number }>();
  const byKind = new Map<string, FinanceKindSummary>();
  const byUser = new Map<string, FinanceGroupSummary>();
  const byProject = new Map<string, FinanceGroupSummary>();
  const byCountry = new Map<
    string,
    FinanceCountrySummary & { buyerSet: Set<string> }
  >();
  const byProduct = new Map<
    string,
    FinanceProductSummary & { countrySet: Set<string> }
  >();
  const byDay = new Map<string, FinanceSeriesPoint>();
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
      const country = normalizeCountry(d.country) ?? UNKNOWN_COUNTRY;
      const productId = (d.productId as string) ?? "";
      if (q.uid && uid !== q.uid) continue;
      if (q.projectId && projectId !== q.projectId) continue;
      if (q.country && country !== q.country) continue;
      if (q.productId && productId !== q.productId) continue;

      const kind = (d.kind as string) ?? "unknown";
      const amountUsd = typeof d.amountUsd === "number" ? d.amountUsd : 0;
      const sparks = typeof d.sparks === "number" ? d.sparks : 0;
      const units = typeof d.units === "number" && Number.isFinite(d.units) ? d.units : 0;
      const at = typeof d.at === "number" ? d.at : q.fromMs;
      const refundUsd = kind === "refund" && amountUsd < 0 ? -amountUsd : 0;

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

      // Market rollup. Unattributed lines (infra, ops, legacy events) still land
      // under "ZZ" so the per-market totals always reconcile to the grand total.
      const cn =
        byCountry.get(country) ??
        ({
          key: country, revenueUsd: 0, costUsd: 0, netUsd: 0, count: 0,
          units: 0, refundUsd: 0, buyers: 0, buyerSet: new Set<string>(),
        } as FinanceCountrySummary & { buyerSet: Set<string> });
      if (amountUsd >= 0) cn.revenueUsd += amountUsd;
      else cn.costUsd += -amountUsd;
      cn.netUsd += amountUsd;
      cn.count += 1;
      cn.units += units;
      cn.refundUsd += refundUsd;
      if (uid && amountUsd > 0) cn.buyerSet.add(uid);
      byCountry.set(country, cn);

      if (productId) {
        const pr =
          byProduct.get(productId) ??
          ({
            key: productId, sku: null, revenueUsd: 0, costUsd: 0, netUsd: 0, count: 0,
            units: 0, refundUsd: 0, netPerUnitUsd: null, countries: 0,
            countrySet: new Set<string>(),
          } as FinanceProductSummary & { countrySet: Set<string> });
        if (amountUsd >= 0) pr.revenueUsd += amountUsd;
        else pr.costUsd += -amountUsd;
        pr.netUsd += amountUsd;
        pr.count += 1;
        pr.units += units;
        pr.refundUsd += refundUsd;
        if (typeof d.sku === "string" && d.sku) pr.sku = d.sku;
        if (country !== UNKNOWN_COUNTRY) pr.countrySet.add(country);
        byProduct.set(productId, pr);
      }

      const dayKey = dayKeyIn(at, tz);
      const day =
        byDay.get(dayKey) ?? { day: dayKey, revenueUsd: 0, costUsd: 0, netUsd: 0, units: 0 };
      if (amountUsd >= 0) day.revenueUsd += amountUsd;
      else day.costUsd += -amountUsd;
      day.netUsd += amountUsd;
      day.units += units;
      byDay.set(dayKey, day);
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

  const countries: FinanceCountrySummary[] = [...byCountry.values()]
    .map(({ buyerSet, ...c }) => ({
      ...roundGroup(c),
      units: c.units,
      refundUsd: r2(c.refundUsd),
      buyers: buyerSet.size,
    }))
    // Revenue-first: a market is interesting because it BUYS, and ranking by
    // net would bury a high-volume market that happens to be cost-heavy.
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.netUsd - a.netUsd)
    .slice(0, groupLimit);

  const products: FinanceProductSummary[] = [...byProduct.values()]
    .map(({ countrySet, ...p }) => ({
      ...roundGroup(p),
      sku: p.sku,
      units: p.units,
      refundUsd: r2(p.refundUsd),
      netPerUnitUsd: p.units > 0 ? r2(p.netUsd / p.units) : null,
      countries: countrySet.size,
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.netUsd - a.netUsd)
    .slice(0, groupLimit);

  // Zero-fill the day axis so a gap reads as "no sales", not "no data".
  const series: FinanceSeriesPoint[] = [];
  const seenDays = new Set<string>();
  for (let t = q.fromMs; t <= q.toMs + 86_400_000; t += 86_400_000) {
    const key = dayKeyIn(Math.min(t, q.toMs), tz);
    if (seenDays.has(key)) continue;
    seenDays.add(key);
    const d = byDay.get(key);
    series.push(
      d
        ? { day: key, revenueUsd: r2(d.revenueUsd), costUsd: r2(d.costUsd), netUsd: r2(d.netUsd), units: d.units }
        : { day: key, revenueUsd: 0, costUsd: 0, netUsd: 0, units: 0 },
    );
  }

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
    byCountry: countries,
    byProduct: products,
    series,
  };
}
