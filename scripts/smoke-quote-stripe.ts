/**
 * Sandbox smoke test: does STRIPE agree with the quote arithmetic?
 *
 *   yarn smoke:quote-stripe
 *
 * Builds the exact session shapes `/checkout` sends — the books as one line at the quote's items amount,
 * postage as a shipping rate, the customer's delivery address saved for tax — from the shared quote
 * arithmetic, asks Stripe to price them, and fails if Stripe's total is not the quote's, to the cent.
 *
 * Needs a TEST key (`STRIPE_SANDBOX_SECRET_KEY` in functions/.env.local) and the network, so it is run by
 * hand, not in CI. It refuses any other key, and it closes every session and deletes every customer it makes.
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { bookChargeLine, composeQuoteLines, minorStep, type QuoteLines } from "../books-frontend/src/core/billing/printQuote";

const env = Object.fromEntries(
  readFileSync(new URL("../functions/.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const key = env.STRIPE_SANDBOX_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) throw new Error("Refusing to run: STRIPE_SANDBOX_SECRET_KEY is missing or is not a test key.");
const stripe = new Stripe(key);

const customers: string[] = [];
const sessions: string[] = [];
let failures = 0;
let passed = 0;

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}: Stripe ${String(actual)} ≠ quote ${String(expected)}`);
}

async function customerFor(address: Stripe.AddressParam, shipping: boolean): Promise<string> {
  const c = await stripe.customers.create({
    email: "quote-smoke@example.com",
    ...(shipping ? { shipping: { name: "Smoke Test", address } } : { address }),
  });
  customers.push(c.id);
  return c.id;
}

async function session(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> {
  const s = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: "https://example.com/ok",
    cancel_url: "https://example.com/no",
    ...params,
  });
  sessions.push(s.id);
  return s;
}

/** The print shape: books as one line, postage as a shipping rate, tax located at delivery. */
async function printCase(label: string, lines: QuoteLines, taxed: boolean): Promise<void> {
  const currency = lines.currency.toLowerCase();
  const customer = await customerFor({ line1: "Hauptstrasse 1", city: "Berlin", postal_code: "10115", country: "DE" }, true);
  const charge = bookChargeLine(lines.itemsMinor, lines.copies);
  const s = await session({
    customer,
    ...(taxed ? { automatic_tax: { enabled: true } } : {}),
    line_items: [
      {
        quantity: charge.quantity,
        price_data: {
          currency,
          unit_amount: charge.unitAmountMinor,
          ...(taxed ? { tax_behavior: lines.taxBehavior } : {}),
          product_data: { name: "Smoke book", ...(taxed ? { tax_code: "txcd_35010000" } : {}) },
        },
      },
    ],
    ...(lines.shippingMinor > 0
      ? {
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount" as const,
                display_name: "Shipping & handling",
                fixed_amount: { amount: lines.shippingMinor, currency },
                ...(taxed ? { tax_behavior: lines.taxBehavior } : {}),
              },
            },
          ],
        }
      : {}),
  });
  expectEqual(`${label}: total`, s.amount_total, lines.totalMinor);
  expectEqual(`${label}: subtotal (books)`, s.amount_subtotal, lines.itemsMinor);
  if (taxed) expectEqual(`${label}: tax located at creation`, s.automatic_tax?.status, "complete");
}

/** The digital shape: one line at the items amount; tax is Stripe's, from the page. */
async function digitalCase(label: string, lines: QuoteLines, taxed: boolean): Promise<void> {
  const customer = await customerFor({ country: "DE", postal_code: "10115" }, false);
  const s = await session({
    customer,
    ...(taxed
      ? {
          customer_update: { address: "auto", name: "auto" },
          billing_address_collection: "required" as const,
          automatic_tax: { enabled: true },
        }
      : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: lines.currency.toLowerCase(),
          unit_amount: lines.itemsMinor,
          ...(taxed ? { tax_behavior: lines.taxBehavior } : {}),
          product_data: { name: "Smoke ebook", ...(taxed ? { tax_code: "txcd_10302000" } : {}) },
        },
      },
    ],
  });
  expectEqual(`${label}: items before tax`, s.amount_subtotal, lines.itemsMinor);
  if (!taxed) expectEqual(`${label}: total`, s.amount_total, lines.totalMinor);
}

try {
  console.log("Quote ↔ Stripe smoke test (sandbox)\n");
  const base = { currency: "EUR", listUnitMinor: 4199, listShippingMinor: 1168, taxBehavior: "inclusive" as const, taxMinor: 0 };
  const cases: [string, QuoteLines][] = [
    ["2 books, no code", composeQuoteLines({ ...base, copies: 2, discount: null })],
    ["2 books, 50% off", composeQuoteLines({ ...base, copies: 2, discount: { kind: "percent", percentOff: 50 } })],
    ["2 books, 10% off (the Stripe-page figure)", composeQuoteLines({ ...base, copies: 2, discount: { kind: "percent", percentOff: 10 } })],
    ["3 books, 33.3% off (not divisible)", composeQuoteLines({ ...base, copies: 3, discount: { kind: "percent", percentOff: 33.3 } })],
    ["7 books, 12.5% off, capped", composeQuoteLines({ ...base, copies: 7, discount: { kind: "percent", percentOff: 12.5, capMinor: 2000 } })],
    ["at cost", composeQuoteLines({ ...base, copies: 2, discount: { kind: "atCost", itemsMinor: 5000, shippingMinor: 600 } })],
    ["USD exclusive", composeQuoteLines({ currency: "USD", copies: 2, listUnitMinor: 3999, listShippingMinor: 1299, discount: { kind: "percent", percentOff: 15 }, taxBehavior: "exclusive", taxMinor: 0 })],
  ];
  for (const [label, lines] of cases) {
    await printCase(`${label} (untaxed)`, lines, false);
    await printCase(`${label} (taxed)`, lines, true);
  }
  const ebook = composeQuoteLines({ currency: "EUR", copies: 1, listUnitMinor: 999, listShippingMinor: 0, discount: { kind: "percent", percentOff: 15 }, taxBehavior: "inclusive", taxMinor: 0 });
  await digitalCase("ebook 15% off (untaxed)", ebook, false);
  await digitalCase("ebook 15% off (taxed)", ebook, true);
  const isk = composeQuoteLines({ currency: "ISK", copies: 1, listUnitMinor: 1500 * minorStep("ISK"), listShippingMinor: 0, discount: { kind: "percent", percentOff: 20 }, taxBehavior: "inclusive", taxMinor: 0 });
  await digitalCase("ISK pack 20% off (untaxed)", isk, false);
} finally {
  for (const id of sessions) await stripe.checkout.sessions.expire(id).catch(() => undefined);
  for (const id of customers) await stripe.customers.del(id).catch(() => undefined);
}

console.log(`\n${passed} checks agreed with Stripe, ${failures} did not.`);
if (failures > 0) process.exitCode = 1;
