/**
 * Invariants for the print-order quote: the arithmetic that decides what a customer is shown and what
 * Stripe is asked to charge.
 *
 * Pure integer maths, run against the SHIPPED module — no network, no Stripe, no Firestore. The
 * properties here are the ones that, when they fail, put two different prices in front of one
 * customer: a discount rounded per copy, a total that isn't the sum of its lines, a Stripe line that
 * doesn't multiply out to the books charge, a currency step ignored.
 */
import assert from "node:assert/strict";
import {
  QuoteArithmeticError,
  bookChargeLine,
  canonicalDigitalInputs,
  canonicalQuoteInputs,
  composeQuoteLines,
  fromMinorUnits,
  minorStep,
  quoteProblems,
  toMinorUnits,
  type DigitalQuoteInputs,
  type QuoteInputs,
} from "../books-frontend/src/core/billing/printQuote";

let passed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}
function section(name: string): void {
  console.log(`  ${name}`);
}

/** A small deterministic generator, so a failure names a case that can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
section("the order from the bug report: two copies, €41.99 each, €11.68 shipping");

const base = { currency: "EUR", copies: 2, listUnitMinor: 4199, listShippingMinor: 1168, taxBehavior: "inclusive" as const, taxMinor: 0 };
const none = composeQuoteLines({ ...base, discount: null });
check(none.totalMinor === 9566, "no code: €95.66");
const half = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: 50 } });
check(half.discountMinor === 4199 && half.totalMinor === 5367, "50% off the books is taken once off the line: €53.67");
const tenth = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: 10 } });
check(tenth.discountMinor === 840 && tenth.totalMinor === 8726, "10% off the books line: €87.26");
check(half.shippingMinor === 1168 && half.listShippingMinor === 1168, "a percentage never touches shipping");

// ---------------------------------------------------------------------------------------------
section("every quote adds up, whatever it is made of");

const currencies = ["EUR", "USD", "GBP", "JPY", "ISK", "KRW", "CHF"];
const random = rng(20260506);
let generated = 0;
for (let i = 0; i < 6000; i += 1) {
  const currency = currencies[Math.floor(random() * currencies.length)];
  const step = minorStep(currency);
  const copies = 1 + Math.floor(random() * 60);
  const listUnitMinor = (100 + Math.floor(random() * 9000)) * step;
  const listShippingMinor = Math.floor(random() * 3000) * step;
  const kind = random();
  const taxBehavior = random() < 0.5 ? "inclusive" : "exclusive";
  const discount =
    kind < 0.25
      ? null
      : kind < 0.85
        ? {
            kind: "percent" as const,
            percentOff: Math.round(random() * 1000) / 10,
            capMinor: random() < 0.4 ? Math.floor(random() * 5000) * step : null,
          }
        : {
            kind: "atCost" as const,
            itemsMinor: Math.floor(random() * listUnitMinor * copies * 1.2),
            shippingMinor: Math.floor(random() * listShippingMinor * 1.2),
          };
  const subtotalGuess = listUnitMinor * copies + listShippingMinor;
  const taxMinor = Math.floor(random() * subtotalGuess * 0.25);
  // Round at-cost parts to the step like the server does.
  const fixed =
    discount?.kind === "atCost"
      ? { ...discount, itemsMinor: Math.round(discount.itemsMinor / step) * step, shippingMinor: Math.round(discount.shippingMinor / step) * step }
      : discount;
  const taxStep = Math.round(taxMinor / step) * step;
  let lines;
  try {
    lines = composeQuoteLines({ currency, copies, listUnitMinor, listShippingMinor, discount: fixed, taxBehavior, taxMinor: taxStep });
  } catch (error) {
    // Only the documented refusal is acceptable: inclusive tax larger than the whole order.
    check(error instanceof QuoteArithmeticError && taxBehavior === "inclusive", `unexpected failure: ${String(error)}`);
    continue;
  }
  generated += 1;
  const problems = quoteProblems(lines);
  check(problems.length === 0, `case ${i} (${currency} ×${copies}) is unsound: ${problems.join("; ")}`);
  check(lines.listItemsMinor + lines.listShippingMinor - lines.discountMinor === lines.subtotalMinor, `case ${i}: list − discount = subtotal`);
  check(lines.totalMinor === (taxBehavior === "exclusive" ? lines.subtotalMinor + lines.taxMinor : lines.subtotalMinor), `case ${i}: total identity`);
  check(lines.discountMinor >= 0 || fixed?.kind === "atCost", `case ${i}: a percentage discount is never negative`);
  check(lines.subtotalMinor <= lines.listItemsMinor + lines.listShippingMinor, `case ${i}: a discount never raises the price`);
  check(lines.totalMinor % step === 0, `case ${i}: total is a multiple of the currency step`);

  // What Stripe is asked to charge for the books multiplies out to exactly the books line.
  const charge = bookChargeLine(lines.itemsMinor, copies);
  check(charge.quantity * charge.unitAmountMinor === lines.itemsMinor, `case ${i}: Stripe line × quantity is the books charge`);
  check(Number.isInteger(charge.unitAmountMinor), `case ${i}: Stripe unit amount is a whole minor unit`);
}
check(generated > 5000, "the generator produced a real sample of quotes");

// ---------------------------------------------------------------------------------------------
section("a discount is rounded once, on the line — never per copy");

for (const copies of [1, 2, 3, 7, 12, 24]) {
  const lines = composeQuoteLines({ ...base, copies, discount: { kind: "percent", percentOff: 33.3 } });
  const exact = (4199 * copies * 333) / 1000;
  check(Math.abs(lines.discountMinor - exact) <= 0.5, `${copies} copies: discount within half a cent of the true figure`);
}

// ---------------------------------------------------------------------------------------------
section("caps and ceilings bind");

const capped = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: 50, capMinor: 1000 } });
check(capped.discountMinor === 1000, "a coupon's 'up to' amount caps the discount in minor units");
const full = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: 100 } });
check(full.itemsMinor === 0 && full.shippingMinor === 1168, "100% off the books still pays the postage");
const over = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: 250 } });
check(over.itemsMinor === 0, "more than 100% is held at 100%");

let previous = Infinity;
for (let pct = 0; pct <= 100; pct += 0.5) {
  const lines = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: pct } });
  check(lines.totalMinor <= previous, `a bigger percentage never raises the total (at ${pct}%)`);
  previous = lines.totalMinor;
}

// ---------------------------------------------------------------------------------------------
section("at cost");

const atCost = composeQuoteLines({ ...base, discount: { kind: "atCost", itemsMinor: 5000, shippingMinor: 600 } });
check(atCost.itemsMinor === 5000 && atCost.shippingMinor === 600, "at cost replaces both the books and the postage");
check(atCost.discountMinor === 9566 - 5600, "and the discount is what that took off");
const dearer = composeQuoteLines({ ...base, discount: { kind: "atCost", itemsMinor: 9000, shippingMinor: 2000 } });
check(dearer.totalMinor === 9566 && dearer.discountMinor === 0, "an 'at cost' price above the sticker price is not applied");

// ---------------------------------------------------------------------------------------------
section("currencies with a coarser step");

const isk = composeQuoteLines({ currency: "ISK", copies: 3, listUnitMinor: 699000, listShippingMinor: 150000, discount: { kind: "percent", percentOff: 12.5 }, taxBehavior: "exclusive", taxMinor: 0 });
check(isk.itemsMinor % 100 === 0 && isk.discountMinor % 100 === 0, "ISK amounts stay a multiple of 100");
check(toMinorUnits(1234.4, "ISK") === 123400, "ISK major → minor is whole krónur × 100");
check(toMinorUnits(1234, "JPY") === 1234 && fromMinorUnits(1234, "JPY") === 1234, "JPY has no minor unit");
check(toMinorUnits(41.99, "EUR") === 4199 && fromMinorUnits(4199, "EUR") === 41.99, "EUR round-trips");
check(toMinorUnits(0.1 + 0.2, "EUR") === 30, "float noise doesn't leak into minor units");

// ---------------------------------------------------------------------------------------------
section("tax");

const exclusive = composeQuoteLines({ ...base, taxBehavior: "exclusive", taxMinor: 1816, discount: { kind: "percent", percentOff: 10 } });
check(exclusive.totalMinor === 8726 + 1816, "exclusive tax is added on top of the discounted subtotal");
const inclusive = composeQuoteLines({ ...base, taxMinor: 1393, discount: { kind: "percent", percentOff: 10 } });
check(inclusive.totalMinor === 8726, "inclusive tax is already in the total");
let refused = false;
try {
  composeQuoteLines({ ...base, taxMinor: 999999, discount: null });
} catch (error) {
  refused = error instanceof QuoteArithmeticError;
}
check(refused, "inclusive tax larger than the order is refused, not charged");

// ---------------------------------------------------------------------------------------------
section("a damaged quote is caught before it can be charged");

const sound = composeQuoteLines({ ...base, discount: { kind: "percent", percentOff: 10 } });
check(quoteProblems(sound).length === 0, "an intact quote is sound");
check(quoteProblems({ ...sound, totalMinor: sound.totalMinor + 1 }).length > 0, "a total off by one cent is caught");
check(quoteProblems({ ...sound, itemsMinor: sound.itemsMinor - 1 }).length > 0, "a books line that no longer fits is caught");
check(quoteProblems({ ...sound, discountMinor: sound.discountMinor + 1 }).length > 0, "a discount that doesn't reconcile is caught");
check(quoteProblems({ ...sound, taxMinor: 0.5 }).length > 0, "a fractional minor amount is caught");
check(quoteProblems({ ...sound, copies: 3 }).length > 0, "a changed copy count is caught");
check(quoteProblems({ ...sound, totalMinor: Number.NaN }).length > 0, "NaN is caught");

// ---------------------------------------------------------------------------------------------
section("what a quote was made for");

const inputs: QuoteInputs = {
  printSku: "0850X1100FCSTDCW080CW444GXX",
  copies: 2,
  pages: 24,
  shippingMethod: "Budget",
  destinationCountry: "de",
  address: { line1: "Hauptstr. 1", line2: "", city: "Berlin", state: "", postalCode: "10115" },
  couponCode: "sarahtest",
};
const same: QuoteInputs = {
  ...inputs,
  destinationCountry: "DE",
  address: { ...inputs.address, line1: "  Hauptstr.   1 ", city: "Berlin " },
  couponCode: "SARAHTEST",
};
check(canonicalQuoteInputs(inputs) === canonicalQuoteInputs(same), "spacing and case don't make a different order");
for (const [label, other] of [
  ["copies", { ...inputs, copies: 3 }],
  ["pages", { ...inputs, pages: 28 }],
  ["sku", { ...inputs, printSku: "OTHER" }],
  ["speed", { ...inputs, shippingMethod: "Express" }],
  ["country", { ...inputs, destinationCountry: "AT" }],
  ["street", { ...inputs, address: { ...inputs.address, line1: "Hauptstr. 2" } }],
  ["postcode", { ...inputs, address: { ...inputs.address, postalCode: "10116" } }],
  ["code", { ...inputs, couponCode: null }],
] as const) {
  check(canonicalQuoteInputs(inputs) !== canonicalQuoteInputs(other), `a different ${label} is a different order`);
}

// ---------------------------------------------------------------------------------------------
section("digital purchases: one unit, no shipping, tax left to the payment page");

const digitalRandom = rng(7);
for (let i = 0; i < 3000; i += 1) {
  const currency = currencies[Math.floor(digitalRandom() * currencies.length)];
  const step = minorStep(currency);
  const listUnitMinor = (50 + Math.floor(digitalRandom() * 4000)) * step;
  const percentOff = Math.round(digitalRandom() * 1000) / 10;
  const capMinor = digitalRandom() < 0.3 ? Math.floor(digitalRandom() * 2000) * step : null;
  const taxBehavior = digitalRandom() < 0.5 ? "inclusive" : "exclusive";
  const lines = composeQuoteLines({
    currency,
    copies: 1,
    listUnitMinor,
    listShippingMinor: 0,
    discount: digitalRandom() < 0.3 ? null : { kind: "percent", percentOff, capMinor },
    taxBehavior,
    taxMinor: 0,
  });
  check(quoteProblems(lines).length === 0, `digital case ${i} is sound`);
  check(lines.shippingMinor === 0 && lines.listShippingMinor === 0, `digital case ${i} has no shipping`);
  // With tax deferred, the Stripe line IS the whole quote: one unit at the items amount.
  const charge = bookChargeLine(lines.itemsMinor, 1);
  check(charge.quantity === 1 && charge.unitAmountMinor === lines.itemsMinor && lines.totalMinor === lines.itemsMinor, `digital case ${i}: Stripe's line is the quote`);
}
const pack = composeQuoteLines({ currency: "EUR", copies: 1, listUnitMinor: 999, listShippingMinor: 0, discount: { kind: "percent", percentOff: 15 }, taxBehavior: "inclusive", taxMinor: 0 });
check(pack.discountMinor === 150 && pack.totalMinor === 849, "15% off a €9.99 pack is €1.50, once: €8.49");

const digital: DigitalQuoteInputs = { kind: "pack", subject: "starter", currency: "eur", couponCode: "sarah-test" };
check(
  canonicalDigitalInputs(digital) === canonicalDigitalInputs({ ...digital, currency: "EUR", subject: " starter ", couponCode: "SARAH-TEST" }),
  "spacing and case don't make a different purchase",
);
for (const [label, other] of [
  ["pack", { ...digital, subject: "big" }],
  ["currency", { ...digital, currency: "USD" }],
  ["code", { ...digital, couponCode: null }],
  ["kind", { ...digital, kind: "ebook" as const }],
] as const) {
  check(canonicalDigitalInputs(digital) !== canonicalDigitalInputs(other), `a different ${label} is a different purchase`);
}

console.log(`\n${passed} checks passed.`);
