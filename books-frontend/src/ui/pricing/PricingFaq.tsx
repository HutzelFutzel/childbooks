/** A compact native disclosure list. Answers remain present in the server HTML. */
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
    <div className={cn("divide-y divide-ink-200 border-y border-ink-200", className)}>
      {items.map((item) => (
        <details key={item.question} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-ink-800">
            {item.question}
            <span
              aria-hidden
              className="text-lg font-normal text-ink-400 transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="max-w-3xl pb-5 pr-8 text-sm leading-relaxed text-ink-600">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
