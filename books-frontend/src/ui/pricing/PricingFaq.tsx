/**
 * The pricing FAQ as plain, always-open markup.
 *
 * Not an accordion: the answers are the page's indexable content and the reason
 * it can rank for the questions people actually type, and content hidden behind a
 * click is content a reader has to hunt for. A `<dl>` also gives the FAQPage
 * structured data an on-page counterpart that says the same words.
 */
import { cn } from "../lib/cn";
import type { PricingFaqItem } from "./faq";

export function PricingFaq({
  items,
  className,
}: {
  items: PricingFaqItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <dl className={cn("grid gap-5 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.question} className="rounded-2xl border border-ink-200 bg-white p-5">
          <dt className="text-sm font-semibold text-ink-900">{item.question}</dt>
          <dd className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
