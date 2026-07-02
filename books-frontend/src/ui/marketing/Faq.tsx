"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
          <h2 id="faq-title" className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            Frequently asked questions
          </h2>
        </Reveal>

        <div className="mt-12 divide-y divide-ink-100 rounded-2xl border border-ink-200">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                >
                  <span className="font-semibold text-ink-900">{item.question}</span>
                  <ChevronDown
                    className={cn(
                      "size-5 shrink-0 text-ink-400 transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen && (
                  <p className="px-6 pb-5 text-sm leading-relaxed text-ink-600">{item.answer}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
