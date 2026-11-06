/**
 * Stored print-order quotes.
 *
 * A quote is written once, by the server, when the customer is shown a price —
 * and is the only thing checkout will charge. See `core/billing/printQuote.ts`
 * for the arithmetic and for why nothing downstream is allowed to re-derive a
 * price.
 *
 * Backend-only (`checkoutQuotes/{id}`; `firestore.rules` denies direct access).
 * `expireAt` is a real Date so a Firestore TTL policy on that field can sweep
 * old quotes; until one is configured they are simply ignored once expired.
 */
import { createHash, randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  canonicalQuoteInputs,
  quoteProblems,
  type PrintQuoteView,
  type QuoteInputs,
  type QuoteLines,
  type QuoteTaxStatus,
} from "../../books-frontend/src/core/billing/printQuote";
import type { AddressValidation } from "../../books-frontend/src/core/fulfillment/types";

const COLLECTION = "checkoutQuotes";

/** Long enough to finish an order, short enough that costs and rates can't drift far. */
export const QUOTE_TTL_MS = 30 * 60_000;
/** A second checkout from the same quote inside this window is a double click. */
const CLAIM_WINDOW_MS = 20_000;

function db() {
  ensureAdmin();
  return getFirestore();
}

/** The discount a quote carries — everything needed to reserve and to explain it. */
export interface StoredDiscount {
  /** Resolved percentage of the books line. 0 for at-cost (the amount is what matters). */
  percentOff: number;
  /** What it actually takes off, in minor units. */
  amountMinor: number;
  summary: string;
  notes: string[];
  code: string | null;
  atCost: boolean;
  capMinor: number | null;
}

export interface PrintQuoteRecord {
  id: string;
  uid: string;
  createdAt: number;
  expiresAt: number;
  /** Real Date for a Firestore TTL policy. */
  expireAt: Date;
  inputHash: string;
  inputs: QuoteInputs;
  currency: string;
  productId: string;
  printSku: string;
  lines: QuoteLines;
  planDiscountPct: number;
  listUnitBeforePlanMinor: number;
  /** Deepest TOTAL discount that still breaks even — what the resolver is clamped by. */
  breakEvenDiscountPct: number;
  /** Break-even at-cost total in major units, for the resolver's at-cost candidate. */
  atCostTotal: number;
  /** What an at-cost offer would charge for the books / shipping, so checkout can re-check it exactly. */
  atCostItemsMinor: number;
  atCostShippingMinor: number;
  discount: StoredDiscount | null;
  couponRejection: { reason: string; message: string } | null;
  taxStatus: QuoteTaxStatus;
  /** Stripe Tax's own explanation per breakdown entry, kept for the paper trail. */
  taxabilityReasons: string[];
  /** The carrier's verdict on the address, shown to the customer and enforced at checkout. */
  addressValidation: AddressValidation | null;
  /** The cost view of this order, stamped onto the fulfillment plan. */
  estimatedCost: {
    amount: number;
    production: number;
    shipping: number;
    currency: string;
    shippingSource: "live" | "table";
    productionSource: "live" | "table";
  };
  /** Set when a checkout was started from this quote. */
  claimedAt?: number;
  paymentId?: string;
}

export function hashQuoteInputs(inputs: QuoteInputs): string {
  return createHash("sha256").update(canonicalQuoteInputs(inputs)).digest("hex");
}

export function newQuoteId(): string {
  return randomUUID();
}

/** Firestore refuses `undefined`; drop it without touching Dates, which JSON would turn into strings. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Persist a freshly built quote. Refuses one whose arithmetic doesn't hold. */
export async function saveQuote(record: PrintQuoteRecord): Promise<void> {
  const problems = quoteProblems(record.lines);
  if (problems.length > 0) throw new Error(`refusing to store an unsound quote: ${problems.join("; ")}`);
  await db().doc(`${COLLECTION}/${record.id}`).set(stripUndefined(record));
}

export type QuoteRefusal =
  | "not_found"
  | "not_yours"
  | "expired"
  | "different_order"
  | "unsound"
  | "in_progress";

export const QUOTE_REFUSAL_MESSAGE: Record<QuoteRefusal, string> = {
  not_found: "That price is no longer available. We've refreshed it — please review and continue.",
  not_yours: "That price is no longer available. We've refreshed it — please review and continue.",
  expired: "That price has expired. We've refreshed it — please review and continue.",
  different_order: "Your order changed since that price was shown. We've refreshed it — please review and continue.",
  unsound: "We couldn't confirm that price. We've refreshed it — please review and continue.",
  in_progress: "Your payment page is already opening. Give it a moment.",
};

/**
 * Load a quote for checkout and prove it is the one the customer approved:
 * theirs, unexpired, arithmetically sound, and made for exactly this order.
 */
export async function loadQuoteForCheckout(args: {
  quoteId: string;
  uid: string;
  inputs: QuoteInputs;
}): Promise<{ ok: true; quote: PrintQuoteRecord } | { ok: false; reason: QuoteRefusal }> {
  const snap = await db().doc(`${COLLECTION}/${args.quoteId}`).get();
  if (!snap.exists) return { ok: false, reason: "not_found" };
  const quote = snap.data() as PrintQuoteRecord & { expireAt?: unknown };
  if (quote.uid !== args.uid) return { ok: false, reason: "not_yours" };
  if (Date.now() > quote.expiresAt) return { ok: false, reason: "expired" };
  if (quote.inputHash !== hashQuoteInputs(args.inputs)) return { ok: false, reason: "different_order" };
  // Re-derive the identity from what is stored too: a hash that matches the
  // request but not the record's own inputs means the record was altered.
  if (quote.inputHash !== hashQuoteInputs(quote.inputs)) return { ok: false, reason: "unsound" };
  if (quoteProblems(quote.lines).length > 0) return { ok: false, reason: "unsound" };
  return { ok: true, quote: { ...quote, id: args.quoteId, expireAt: new Date(quote.expiresAt) } };
}

/**
 * Take the quote for one checkout attempt. A repeat inside a few seconds is a
 * double click and is refused; a later one (the customer came back from the
 * payment page) is allowed, and the caller retires the earlier attempt first.
 */
export async function claimQuote(quoteId: string, paymentId: string): Promise<boolean> {
  const ref = db().doc(`${COLLECTION}/${quoteId}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const claimedAt = Number(snap.get("claimedAt") ?? 0);
    if (claimedAt > 0 && Date.now() - claimedAt < CLAIM_WINDOW_MS) return false;
    tx.update(ref, { claimedAt: Date.now(), paymentId });
    return true;
  });
}

/** Free the quote again when the attempt failed before a session existed. */
export async function unclaimQuote(quoteId: string): Promise<void> {
  await db()
    .doc(`${COLLECTION}/${quoteId}`)
    .update({ claimedAt: 0 })
    .catch(() => undefined);
}

/** The quote as the browser sees it. */
export function quoteView(record: PrintQuoteRecord): PrintQuoteView {
  return {
    quoteId: record.id,
    expiresAt: record.expiresAt,
    lines: record.lines,
    planDiscountPct: record.planDiscountPct,
    listUnitBeforePlanMinor: record.listUnitBeforePlanMinor,
    discount:
      record.discount && record.lines.discountMinor > 0
        ? {
            amountMinor: record.lines.discountMinor,
            percentOff: record.discount.percentOff,
            summary: record.discount.summary,
            notes: record.discount.notes,
            code: record.discount.code,
            atCost: record.discount.atCost,
          }
        : null,
    couponRejection: record.couponRejection ? { message: record.couponRejection.message } : null,
    taxStatus: record.taxStatus,
    addressValidation: record.addressValidation,
  };
}
