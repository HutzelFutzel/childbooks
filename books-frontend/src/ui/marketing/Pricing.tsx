"use client";

import Link from "next/link";
import type { PublicPlansConfig } from "../../core/config/plans";
import { formatMoney } from "../pricing/format";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteTextMap } from "./content";
import type { LandingPrintOffer, LandingPrintPricing } from "./printOffers";

const EMPTY_PRINT: LandingPrintPricing = {
  currency: "USD",
  taxInclusive: false,
  print: [],
  memberPlanName: null,
  ebook: null,
};

const DEFAULT_OFFERS: LandingPrintOffer[] = [
  {
    id: "paperback",
    label: "Paperback",
    blurb: "Light to hold at bedtime.",
    featured: false,
    fromPrice: 25.99,
    memberFromPrice: null,
    memberDiscountPct: 0,
    minPages: 24,
    trim: "8.5x8.5",
    href: "/print-pricing/paperback",
  },
  {
    id: "hardcover",
    label: "Hardcover",
    blurb: "The keepsake for the shelf.",
    featured: true,
    fromPrice: 43.99,
    memberFromPrice: null,
    memberDiscountPct: 0,
    minPages: 24,
    trim: "8.5x8.5",
    href: "/print-pricing/hardcover",
  },
];

export function Pricing({
  initial: _initial,
  print = EMPTY_PRINT,
  text = {},
}: {
  initial?: PublicPlansConfig;
  print?: LandingPrintPricing;
  text?: SiteTextMap;
}) {
  const offers = print.print.length > 0 ? print.print : DEFAULT_OFFERS;

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-20 lg:py-28">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <EditableText
            slotId="pricing.heading"
            as="h2"
            multiline
            defaultValue="Free to make. Pay only when you love it."
            serverValue={text["pricing.heading"]}
            className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl lg:text-5xl"
          />
          <EditableText
            slotId="pricing.subhead"
            as="p"
            multiline
            defaultValue="Read the whole book on screen before you spend anything. Printing is a choice you make afterwards — never a surprise."
            serverValue={text["pricing.subhead"]}
            className="mt-4 text-base leading-relaxed text-ink-600 sm:text-lg"
          />
        </Reveal>

        {/* 2 Print cards side by side */}
        <div className="mx-auto mt-12 grid max-w-2xl grid-cols-1 items-stretch gap-6 sm:grid-cols-2">
          {offers.map((offer, i) => (
            <Reveal key={offer.id} delay={i * 0.05}>
              <div className="relative flex h-full flex-col items-center justify-center rounded-3xl border border-ink-100 bg-white p-7 text-center shadow-soft sm:p-8">
                <span className="text-xs font-semibold uppercase tracking-widest text-ink-400">
                  {offer.label}
                </span>
                <p className="mt-3 text-3xl font-extrabold tabular-nums text-ink-900 sm:text-4xl">
                  From {formatMoney(offer.fromPrice, print.currency)}
                </p>
                <p className="mt-2 text-sm text-ink-600 sm:text-base">
                  {offer.blurb}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Membership reassurance note */}
        <Reveal delay={0.12} className="mx-auto mt-8 max-w-xl text-center">
          <EditableText
            slotId="pricing.note"
            as="p"
            defaultValue="Reading regularly? Members save on every print order — optional, cancel anytime."
            serverValue={text["pricing.note"]}
            className="text-sm text-ink-500 sm:text-base"
          />
        </Reveal>

        {/* Action buttons */}
        <Reveal delay={0.18} className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/studio"
            className="inline-flex w-full items-center justify-center rounded-full bg-brand-600 px-8 py-3.5 text-base font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700 sm:w-auto"
          >
            <EditableText
              slotId="pricing.ctaPrimary"
              as="span"
              defaultValue="Start their story free"
              serverValue={text["pricing.ctaPrimary"]}
            />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex w-full items-center justify-center rounded-full border border-ink-200 bg-white px-8 py-3.5 text-base font-semibold text-ink-800 shadow-xs transition hover:border-ink-300 hover:bg-ink-50 sm:w-auto"
          >
            <EditableText
              slotId="pricing.ctaSecondary"
              as="span"
              defaultValue="See every price and membership"
              serverValue={text["pricing.ctaSecondary"]}
            />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
