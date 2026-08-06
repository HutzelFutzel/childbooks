/**
 * The affiliate FAQ as plain, always-open markup — same rationale as
 * `ui/pricing/PricingFaq`: the answers are the page's indexable content, and
 * content hidden behind a click is content a crawler (and a skimming reader)
 * has to work harder for. Pairs with the FAQPage JSON-LD in `AffiliateJsonLd`.
 */
import type { AffiliateFaqItem } from "./faq";

export function AffiliateFaq({ items }: { items: AffiliateFaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="grid gap-5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.question} className="rounded-2xl border border-ink-200 bg-white p-5">
          <dt className="text-sm font-semibold text-ink-900">{item.question}</dt>
          <dd className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
