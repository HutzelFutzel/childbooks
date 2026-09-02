"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, HelpCircle, MessageCircle } from "lucide-react";
import { cn } from "../lib/cn";
import type { SeoFaqItem } from "../../core/config/seo";
import { Reveal } from "./Reveal";

/** Accordion FAQ. Content comes from the admin-managed SEO config (single
 *  source of truth shared with the FAQPage structured data). */
export function Faq({ items }: { items: SeoFaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  if (items.length === 0) return null;

  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal className="text-center">
          <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <HelpCircle className="size-5" />
          </div>
          <h2 id="faq-title" className="mt-4 font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-3 text-base text-ink-600">
            Everything you need to know about creating, previewing, and ordering your storybooks.
          </p>
        </Reveal>

        <div className="mt-12 space-y-3">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={cn(
                  "overflow-hidden rounded-2xl border transition-all duration-200",
                  isOpen
                    ? "border-brand-200 bg-brand-50/20 shadow-xs ring-1 ring-brand-100"
                    : "border-ink-200 bg-white hover:border-ink-300",
                )}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition"
                >
                  <span className={cn("font-display text-base font-semibold", isOpen ? "text-brand-900" : "text-ink-900")}>
                    {item.question}
                  </span>
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full transition-all",
                      isOpen ? "bg-brand-100 text-brand-700 rotate-180" : "bg-ink-100 text-ink-500",
                    )}
                  >
                    <ChevronDown className="size-4" />
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-brand-100/60 px-6 pb-5 pt-3">
                    <p className="text-sm leading-relaxed text-ink-600">{item.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Friendly contact banner */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-canvas p-5 sm:flex-row">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-2xs">
              <MessageCircle className="size-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">Have a different question?</p>
              <p className="text-xs text-ink-500">We're always here to help you make something wonderful.</p>
            </div>
          </div>
          <Link
            href="/contact"
            className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-700 shadow-2xs transition hover:border-ink-300 hover:text-ink-900"
          >
            Contact support
          </Link>
        </div>
      </div>
    </section>
  );
}
