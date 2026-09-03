/**
 * The print-pricing FAQ, generated from the live catalog.
 *
 * Generated rather than written down for two reasons. It stays true — the answers
 * quote the page ranges, markets and delivery speeds actually on sale, so
 * withdrawing a market can't leave a page promising it. And the visible copy and
 * the FAQPage structured data are built from one source, which is not just tidy
 * but a requirement: markup whose answers differ from the page is a
 * rich-result violation.
 */
import type { PricingSettings, PublicProduct } from "../../core/config/products";
import { publicMarketsFor, publicUnitPrice } from "../../core/config/productMath";
import { countryLabel } from "../../core/analytics/markets";
import { bindingNoun } from "../../core/fulfillment";
import { formatMoney } from "./format";

export interface PricingFaqItem {
  question: string;
  answer: string;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Build the FAQ for a set of formats. Pass one product for a format page, the
 * whole offerable catalog for the index.
 */
export function pricingFaq(
  products: PublicProduct[],
  settings: PricingSettings,
  currency: string,
): PricingFaqItem[] {
  if (products.length === 0) return [];

  // The entry price: the shortest book each format can print, in the currency
  // being displayed. Deliberately not the minimum of `prices`, which holds one
  // amount per currency — taking the smallest of those picks whichever currency
  // happens to have the weakest number and then labels it with the wrong symbol.
  const cheapest = Math.min(
    ...products.map((p) =>
      publicUnitPrice(p, settings, { currency, pages: p.conditions.pages.min }),
    ),
  );
  const markets = [...new Set(products.flatMap(publicMarketsFor))];
  const bindings = [...new Set(products.map((p) => bindingNoun(p.spec.binding)))];
  const minPages = Math.min(...products.map((p) => p.conditions.pages.min));
  const maxPages = Math.max(...products.map((p) => p.conditions.pages.max));
  const taxInclusive = products.some((p) => p.taxBehavior[currency] === "inclusive");
  const allDiscounts = products.flatMap((p) => Object.values(p.planPrintDiscountPct)).filter((v) => v > 0);
  const maxDiscount = allDiscounts.length > 0 ? Math.max(...allDiscounts) : 0;

  const faq: PricingFaqItem[] = [
    {
      question: "How much does it cost to print a children's book?",
      answer:
        Number.isFinite(cheapest)
          ? `Printing starts at ${formatMoney(cheapest, currency)} per copy for a single book, plus shipping. The exact price depends on the binding, page count, cover finish and how many copies you order — the calculator on this page shows the real figure for any combination.`
          : "The price depends on the binding, page count, cover finish and number of copies. The calculator on this page shows the real figure for any combination.",
    },
    {
      question: "Why does the price stay the same when I add a few pages?",
      answer:
        "Printing is priced in page brackets rather than per page, because the bindery charges by band. Adding pages inside your current bracket costs nothing extra, and crossing into the next one steps the price up. You can view the page brackets in the detailed pricing section below.",
    },
    {
      question: "Is shipping included in the price?",
      answer: `No — shipping is charged separately and depends on where the book is going and how fast you want it. ${
        markets.length > 0
          ? `We currently ship to ${list(markets.map(countryLabel))}.`
          : ""
      } The calculator shows the shipping estimate for your destination; the exact amount is confirmed by the carrier at checkout.`,
    },
    {
      question: "Are these prices what I actually pay?",
      answer: `Yes. The book price shown is the price charged at checkout — it comes from the same price table the order does, not from an estimate. ${
        taxInclusive
          ? "Prices include VAT where it applies."
          : "Sales tax, where it applies, is added at checkout."
      } Shipping is the one figure that can move, because it is confirmed against a live carrier quote for your address.`,
    },
    {
      question: "Do I need an account to see prices?",
      answer:
        "No. This page is open to everyone, with no sign-up and no card required. You only need an account when you want to save a book or place an order.",
    },
    {
      question: "How long can a book be?",
      answer: `${
        bindings.length === 1 ? `A ${bindings[0]}` : "Depending on the binding, a book"
      } can be between ${minPages} and ${maxPages} pages. Each binding has its own limits and its own page increment — a bindery that works in fours can't make a book with an odd number of pages — and the calculator only lets you pick lengths that can actually be made.`,
    },
  ];

  if (maxDiscount > 0) {
    faq.push({
      question: "Do members get a discount on printing?",
      answer:
        `Yes. Active membership plans include up to ${maxDiscount}% off printed books, applied automatically at checkout. You do not need a membership to order books at standard prices.`,
    });
  }

  return faq;
}
