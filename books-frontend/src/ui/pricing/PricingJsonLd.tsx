/**
 * Structured data for the print-pricing pages.
 *
 * Deliberately NOT `Product`/`Offer`, which is the obvious reading of "a page
 * with prices on it". The thing being priced is a book the visitor hasn't
 * written yet — there is no SKU to add to a cart, no availability and no single
 * price — so offer markup here would be a claim we can't keep, and the sort that
 * collects rich-result and merchant warnings. `WebApplication` describes what the
 * page actually is (a free calculator), which is both true and eligible.
 *
 * Same judgement the landing page already makes for subscriptions: see the
 * SoftwareApplication note in `JsonLd.tsx`.
 */
export function PricingJsonLd({
  name,
  description,
  url,
  faq,
}: {
  name: string;
  description: string;
  url: string;
  faq: { question: string; answer: string }[];
}) {
  const application = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    description,
    url,
    applicationCategory: "BusinessApplication",
    browserRequirements: "Requires JavaScript for the interactive estimate.",
    // The calculator itself is free to use; this says nothing about what the
    // books cost, which is the page's content rather than its offer.
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
  };

  const faqPage =
    faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  return (
    <>
      {[application, faqPage].filter(Boolean).map((block, i) => (
        <script
          // eslint-disable-next-line react/no-danger
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </>
  );
}
