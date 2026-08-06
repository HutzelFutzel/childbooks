/**
 * Structured data for the affiliate program page: FAQPage only. No
 * Product/Offer/Service markup — there's no SKU or fixed price here (the
 * commission rate is confirmed per-affiliate at approval), so that kind of
 * markup would be a claim the page can't keep. Same judgement as
 * `ui/pricing/PricingJsonLd`'s note on why it uses `WebApplication` rather than
 * `Product` for a page with no single price.
 */
import type { AffiliateFaqItem } from "./faq";

export function AffiliateJsonLd({ faq }: { faq: AffiliateFaqItem[] }) {
  if (faq.length === 0) return null;

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <script
      // eslint-disable-next-line react/no-danger
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage) }}
    />
  );
}
