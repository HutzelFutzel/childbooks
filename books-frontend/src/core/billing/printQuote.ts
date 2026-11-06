/**
 * The print-order quote: the ONE definition of what an order costs.
 *
 * Pricing used to be computed in three places that never compared notes — the
 * order dialog subtracted a coupon on its own, the coupon preview ran a
 * different evaluator from checkout, and checkout then re-priced from scratch
 * and charged whatever came out. Each was individually reasonable; together a
 * customer could be shown one total, told "50% off" by Stripe, and charged a
 * third.
 *
 * The rule here is the standard one for money: the server decides every number
 * exactly once, writes it down (a quote), shows exactly that to the customer,
 * and charges exactly that. Nothing downstream re-derives a price.
 *
 * Everything in this file is pure integer arithmetic in the currency's minor
 * units, so the same function can be run by the server that produces a quote,
 * by the check that proves its invariants, and by anything that wants to audit
 * one — and so rounding happens in exactly one place, once, on the line total.
 * It deliberately never rounds per copy and multiplies, which is how two copies
 * of a €41.99 book at 50% off used to come out a cent away from what was shown.
 */
import type { AddressValidation } from "../fulfillment/types";

// ---- Minor units ------------------------------------------------------------

const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
// Stripe keeps two-decimal API amounts for these even though they have no
// fractional unit in practice: the amount must end in 00.
const COMPAT_TWO_DECIMAL = new Set(["ISK", "UGX"]);

/** The granularity every charged amount in `currency` must be a multiple of. */
export function minorStep(currency: string): number {
  return COMPAT_TWO_DECIMAL.has(currency.toUpperCase()) ? 100 : 1;
}

/** Major units (as priced) → the currency's minor units, as Stripe wants them. */
export function toMinorUnits(amount: number, currency: string): number {
  const code = currency.toUpperCase();
  if (COMPAT_TWO_DECIMAL.has(code)) return Math.round(amount) * 100;
  const factor = ZERO_DECIMAL.has(code) ? 1 : 100;
  return Math.round(amount * factor);
}

/** Minor units → major units, for display. Never feed the result back into money math. */
export function fromMinorUnits(minor: number, currency: string): number {
  const factor = ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round((minor / factor) * 100) / 100;
}

// ---- The arithmetic ---------------------------------------------------------

export type QuoteTaxBehavior = "inclusive" | "exclusive";

/** How a discount is taken off, decided upstream by the one resolver. */
export type QuoteDiscountPlan =
  | {
      kind: "percent";
      /** Resolved percentage of the BOOKS line, after every ceiling. At most one decimal. */
      percentOff: number;
      /** A coupon's "up to" amount, when it is the sole winner. The discount never exceeds it. */
      capMinor?: number | null;
    }
  | {
      /** Print at cost: replaces both the books and the shipping charge. */
      kind: "atCost";
      itemsMinor: number;
      shippingMinor: number;
    };

/** Every number on the order, as integers. What is shown is what is charged. */
export interface QuoteLines {
  currency: string;
  copies: number;
  /** One copy's sticker price (a plan perk is already in it). */
  listUnitMinor: number;
  /** `listUnitMinor × copies`. */
  listItemsMinor: number;
  /** Shipping before any offer. */
  listShippingMinor: number;
  /** Everything taken off, books and (for at-cost) shipping. */
  discountMinor: number;
  /** What the books line is actually charged. */
  itemsMinor: number;
  /** What shipping is actually charged. */
  shippingMinor: number;
  /** `itemsMinor + shippingMinor`. Includes tax when `taxBehavior` is inclusive. */
  subtotalMinor: number;
  taxBehavior: QuoteTaxBehavior;
  /** Tax contained in (inclusive) or added on top of (exclusive) the subtotal. */
  taxMinor: number;
  /** The exact amount Stripe will take. */
  totalMinor: number;
}

export class QuoteArithmeticError extends Error {}

function isMinor(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Build the lines of a quote.
 *
 * The percentage discount is computed ONCE, on the whole books line, rounding
 * half up in exact integer arithmetic. It is never computed per copy: per-copy
 * rounding then multiplying is a different number from rounding the line, and
 * having both in the system is how a preview and a charge drift apart.
 */
export function composeQuoteLines(input: {
  currency: string;
  copies: number;
  listUnitMinor: number;
  listShippingMinor: number;
  discount: QuoteDiscountPlan | null;
  taxBehavior: QuoteTaxBehavior;
  taxMinor: number;
}): QuoteLines {
  const { currency, copies, listUnitMinor, listShippingMinor, taxBehavior, taxMinor } = input;
  if (!Number.isSafeInteger(copies) || copies < 1) throw new QuoteArithmeticError("copies must be a positive integer");
  if (!isMinor(listUnitMinor) || !isMinor(listShippingMinor) || !isMinor(taxMinor)) {
    throw new QuoteArithmeticError("amounts must be non-negative integers in minor units");
  }
  const step = minorStep(currency);
  const listItemsMinor = listUnitMinor * copies;

  let itemsMinor = listItemsMinor;
  let shippingMinor = listShippingMinor;
  const plan = input.discount;
  if (plan?.kind === "percent") {
    const tenths = Math.round(Math.min(100, Math.max(0, plan.percentOff)) * 10);
    let off = Math.floor((listItemsMinor * tenths + 500) / 1000);
    if (plan.capMinor != null && plan.capMinor >= 0) off = Math.min(off, plan.capMinor);
    off = Math.min(off, listItemsMinor);
    if (step > 1) off = Math.round(off / step) * step;
    itemsMinor = listItemsMinor - off;
  } else if (plan?.kind === "atCost") {
    if (!isMinor(plan.itemsMinor) || !isMinor(plan.shippingMinor)) {
      throw new QuoteArithmeticError("at-cost amounts must be non-negative integers");
    }
    // An at-cost price above the sticker price is not a discount. Refusing to
    // apply it here, rather than trusting the caller, is what keeps this offer
    // from ever raising the price it was meant to lower.
    if (plan.itemsMinor + plan.shippingMinor < listItemsMinor + listShippingMinor) {
      itemsMinor = plan.itemsMinor;
      shippingMinor = plan.shippingMinor;
    }
  }

  const subtotalMinor = itemsMinor + shippingMinor;
  if (taxBehavior === "inclusive" && taxMinor > subtotalMinor) {
    throw new QuoteArithmeticError("inclusive tax cannot exceed the subtotal");
  }
  const totalMinor = taxBehavior === "exclusive" ? subtotalMinor + taxMinor : subtotalMinor;
  const lines: QuoteLines = {
    currency: currency.toUpperCase(),
    copies,
    listUnitMinor,
    listItemsMinor,
    listShippingMinor,
    discountMinor: listItemsMinor + listShippingMinor - subtotalMinor,
    itemsMinor,
    shippingMinor,
    subtotalMinor,
    taxBehavior,
    taxMinor,
    totalMinor,
  };
  const problems = quoteProblems(lines);
  if (problems.length > 0) throw new QuoteArithmeticError(problems.join("; "));
  return lines;
}

/**
 * Everything that must be true of a set of lines. Empty means sound.
 *
 * Run before a quote is stored and again before it is charged, so a quote that
 * was damaged on the way (a hand edit, a partial write) cannot reach Stripe.
 */
export function quoteProblems(l: QuoteLines): string[] {
  const out: string[] = [];
  const ints: [string, number][] = [
    ["listUnitMinor", l.listUnitMinor],
    ["listItemsMinor", l.listItemsMinor],
    ["listShippingMinor", l.listShippingMinor],
    ["discountMinor", l.discountMinor],
    ["itemsMinor", l.itemsMinor],
    ["shippingMinor", l.shippingMinor],
    ["subtotalMinor", l.subtotalMinor],
    ["taxMinor", l.taxMinor],
    ["totalMinor", l.totalMinor],
  ];
  for (const [name, value] of ints) {
    if (!isMinor(value)) out.push(`${name} is not a non-negative integer (${String(value)})`);
  }
  if (out.length > 0) return out;
  const step = minorStep(l.currency);
  if (l.listItemsMinor !== l.listUnitMinor * l.copies) out.push("list items ≠ unit × copies");
  if (l.itemsMinor + l.shippingMinor !== l.subtotalMinor) out.push("items + shipping ≠ subtotal");
  if (l.listItemsMinor + l.listShippingMinor - l.discountMinor !== l.subtotalMinor) {
    out.push("list − discount ≠ subtotal");
  }
  if (l.discountMinor > l.listItemsMinor + l.listShippingMinor) out.push("discount exceeds the order");
  const expectedTotal = l.taxBehavior === "exclusive" ? l.subtotalMinor + l.taxMinor : l.subtotalMinor;
  if (l.totalMinor !== expectedTotal) out.push("total ≠ subtotal (+ exclusive tax)");
  if (l.taxBehavior === "inclusive" && l.taxMinor > l.subtotalMinor) out.push("inclusive tax exceeds subtotal");
  if (step > 1) {
    for (const [name, value] of ints) {
      if (value % step !== 0) out.push(`${name} is not a multiple of ${step} in ${l.currency}`);
    }
  }
  return out;
}

/** The books line as Stripe will be asked to charge it. */
export interface BookChargeLine {
  quantity: number;
  /** Per unit, in minor units. `quantity × unitAmountMinor` is exactly the books charge. */
  unitAmountMinor: number;
  /**
   * True when the copies could not be split into equal whole-cent units, so the
   * line is sent as one item. The alternative — a per-copy price rounded to a
   * cent — would make the Stripe total differ from the quote by up to a cent
   * per copy.
   */
  collapsed: boolean;
}

export function bookChargeLine(itemsMinor: number, copies: number): BookChargeLine {
  if (copies >= 1 && itemsMinor % copies === 0 && (itemsMinor / copies) % 1 === 0) {
    return { quantity: copies, unitAmountMinor: itemsMinor / copies, collapsed: false };
  }
  return { quantity: 1, unitAmountMinor: itemsMinor, collapsed: true };
}

// ---- Identity ---------------------------------------------------------------

/**
 * What a quote was priced for. Checkout recomputes this from the order it was
 * given and refuses a quote that was made for something else — so a quote can
 * never be spent on a different book, address, speed or code than the customer
 * was shown.
 */
export interface QuoteInputs {
  /** The composed print SKU (it already encodes the chosen variant). */
  printSku: string;
  copies: number;
  /** The page count that is printed, after the binding's own rounding. */
  pages: number;
  shippingMethod: string;
  destinationCountry: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
  };
  /** The normalised code that was APPLIED, or null. A rejected code is not part of a quote. */
  couponCode: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/** A stable string for the inputs: same order, same normalisation, every time. */
export function canonicalQuoteInputs(i: QuoteInputs): string {
  return JSON.stringify([
    clean(i.printSku),
    i.copies,
    i.pages,
    clean(i.shippingMethod),
    clean(i.destinationCountry).toUpperCase(),
    clean(i.address.line1),
    clean(i.address.line2),
    clean(i.address.city),
    clean(i.address.state),
    clean(i.address.postalCode),
    i.couponCode ? clean(i.couponCode).toUpperCase() : "",
  ]);
}

// ---- What the customer is shown ----------------------------------------------

export type QuoteTaxStatus =
  /** Stripe Tax computed this order's tax (which may legitimately be none). */
  | "calculated"
  /** Stripe Tax is on but we hold no registration where this ships, so none is collected. */
  | "not_collecting"
  /** Tax is not configured for print orders. */
  | "off";

/** The quote as the browser receives it: integers and labels, nothing to derive. */
export interface PrintQuoteView {
  quoteId: string;
  /** Epoch ms after which checkout refuses this quote. */
  expiresAt: number;
  lines: QuoteLines;
  /** Plan perk already in the sticker price, as a percentage. */
  planDiscountPct: number;
  /** One copy's price before the plan perk. */
  listUnitBeforePlanMinor: number;
  discount: {
    amountMinor: number;
    percentOff: number;
    summary: string;
    notes: string[];
    /** The code that earned it, when a typed code did. */
    code: string | null;
    atCost: boolean;
  } | null;
  /** Why a code the customer typed did not apply. The quote itself is still valid. */
  couponRejection: { message: string } | null;
  taxStatus: QuoteTaxStatus;
  addressValidation: AddressValidation | null;
}

// ---- Digital purchases (ebook, Spark packs) -----------------------------------
//
// The same quote, for things with no shipping and one unit. Tax for these is
// worked out by Stripe Tax from the billing address typed on its payment page —
// nothing on our side knows the buyer's country — so a digital quote is exact up
// to tax: its lines are what Stripe is asked to charge before tax, and the
// payment is checked against them once Stripe has added its own.

/** What a digital quote was made for. Spark gifts price exactly like the pack itself. */
export interface DigitalQuoteInputs {
  kind: "ebook" | "pack";
  /** The project id (ebook) or the pack id. */
  subject: string;
  currency: string;
  /** The normalised code that was APPLIED, or null. */
  couponCode: string | null;
}

export function canonicalDigitalInputs(i: DigitalQuoteInputs): string {
  return JSON.stringify([
    i.kind,
    clean(i.subject),
    clean(i.currency).toUpperCase(),
    i.couponCode ? clean(i.couponCode).toUpperCase() : "",
  ]);
}

/** A digital quote as the browser receives it. */
export interface DigitalQuoteView {
  quoteId: string;
  expiresAt: number;
  lines: QuoteLines;
  discount: {
    amountMinor: number;
    percentOff: number;
    summary: string;
    notes: string[];
    code: string | null;
  } | null;
  couponRejection: { message: string } | null;
}
