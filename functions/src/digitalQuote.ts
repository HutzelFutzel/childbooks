/**
 * Stored quotes for digital purchases (ebook, Spark packs and their gifts).
 *
 * The same idea as `printQuote.ts` — the server decides the price once, writes it
 * down, shows exactly that and charges exactly that — for purchases that are one
 * unit with no shipping. Lives in the same collection (`checkoutQuotes`), so the
 * claim/unclaim step and the TTL policy are shared.
 *
 * Tax is the one thing a digital quote does not contain: Stripe Tax works it out
 * from the billing address typed on the payment page. The lines here are what is
 * charged BEFORE tax, and the payment is checked against them afterwards.
 */
import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  canonicalDigitalInputs,
  quoteProblems,
  type DigitalQuoteInputs,
  type DigitalQuoteView,
  type QuoteLines,
} from "../../books-frontend/src/core/billing/printQuote";
import { stripUndefined, type QuoteRefusal, type StoredDiscount } from "./printQuote";

const COLLECTION = "checkoutQuotes";

function db() {
  ensureAdmin();
  return getFirestore();
}

export interface DigitalQuoteRecord {
  id: string;
  uid: string;
  createdAt: number;
  expiresAt: number;
  /** Real Date for the Firestore TTL policy. */
  expireAt: Date;
  inputHash: string;
  inputs: DigitalQuoteInputs;
  currency: string;
  lines: QuoteLines;
  discount: StoredDiscount | null;
  couponRejection: { reason: string; message: string } | null;
  claimedAt?: number;
  paymentId?: string;
}

export function hashDigitalInputs(inputs: DigitalQuoteInputs): string {
  return createHash("sha256").update(canonicalDigitalInputs(inputs)).digest("hex");
}

export async function saveDigitalQuote(record: DigitalQuoteRecord): Promise<void> {
  const problems = quoteProblems(record.lines);
  if (problems.length > 0) throw new Error(`refusing to store an unsound quote: ${problems.join("; ")}`);
  await db().doc(`${COLLECTION}/${record.id}`).set(stripUndefined(record));
}

/** Load a digital quote and prove it is the one the customer approved, for this purchase. */
export async function loadDigitalQuote(args: {
  quoteId: string;
  uid: string;
  inputs: DigitalQuoteInputs;
}): Promise<{ ok: true; quote: DigitalQuoteRecord } | { ok: false; reason: QuoteRefusal }> {
  if (!args.quoteId) return { ok: false, reason: "not_found" };
  const snap = await db().doc(`${COLLECTION}/${args.quoteId}`).get();
  if (!snap.exists) return { ok: false, reason: "not_found" };
  const quote = snap.data() as DigitalQuoteRecord;
  if (quote.uid !== args.uid) return { ok: false, reason: "not_yours" };
  if (!quote.inputs || !("kind" in quote.inputs) || !("subject" in quote.inputs)) {
    // A print quote's id, or something else that isn't ours to charge.
    return { ok: false, reason: "different_order" };
  }
  if (Date.now() > quote.expiresAt) return { ok: false, reason: "expired" };
  if (quote.inputHash !== hashDigitalInputs(args.inputs)) return { ok: false, reason: "different_order" };
  if (quote.inputHash !== hashDigitalInputs(quote.inputs)) return { ok: false, reason: "unsound" };
  if (quoteProblems(quote.lines).length > 0) return { ok: false, reason: "unsound" };
  return { ok: true, quote: { ...quote, id: args.quoteId, expireAt: new Date(quote.expiresAt) } };
}

export function digitalQuoteView(record: DigitalQuoteRecord): DigitalQuoteView {
  return {
    quoteId: record.id,
    expiresAt: record.expiresAt,
    lines: record.lines,
    discount:
      record.discount && record.lines.discountMinor > 0
        ? {
            amountMinor: record.lines.discountMinor,
            percentOff: record.discount.percentOff,
            summary: record.discount.summary,
            notes: record.discount.notes,
            code: record.discount.code,
          }
        : null,
    couponRejection: record.couponRejection ? { message: record.couponRejection.message } : null,
  };
}
