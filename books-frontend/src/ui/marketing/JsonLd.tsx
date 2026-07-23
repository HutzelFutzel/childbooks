import type { SeoConfig } from "../../core/config/seo";
import type { BrandingConfig } from "../../core/config/branding";
import type { PublicPlansConfig } from "../../core/config/plans";

/**
 * Structured data (schema.org JSON-LD) for the landing page: Organization,
 * WebSite, a FAQPage (from the admin-managed FAQ), and Product/Offer entries
 * for each paid plan. Emitted server-side so crawlers see it in the raw HTML.
 * The organization logo comes from the branding kit.
 */
export function JsonLd({
  seo,
  branding,
  plans,
}: {
  seo: SeoConfig;
  branding: BrandingConfig;
  plans: PublicPlansConfig;
}) {
  const base = seo.siteUrl;
  const logoUrl = branding.icon?.imageUrl ?? branding.logo?.imageUrl;

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: seo.organization.name || branding.brandName,
    url: base,
    logo: logoUrl || undefined,
    sameAs: seo.organization.sameAs.length > 0 ? seo.organization.sameAs : undefined,
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: seo.siteName,
    url: base,
  };

  const faqPage =
    seo.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: seo.faq.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  // A subscription to a browser-based creative tool is a SoftwareApplication
  // (schema.org's type for exactly this), not a physical Product — cleaner,
  // warning-free structured data. The paid-plan prices map to the same Offer
  // shape either type uses.
  const paidOffers = plans.plans
    .filter((p) => !p.isFree && p.status === "active")
    .flatMap((plan) => {
      const currency = plan.prices.USD ? "USD" : Object.keys(plan.prices)[0];
      if (!currency) return [];
      const month = plan.prices[currency]?.month;
      if (!month) return [];
      return [
        {
          "@type": "Offer",
          name: plan.name,
          price: month.amount,
          priceCurrency: currency,
          url: `${base}/studio`,
          availability: "https://schema.org/InStock",
        },
      ];
    });

  const application = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: seo.siteName,
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    description: seo.description,
    url: base,
    // Only advertise offers when there are paid plans; the free tier makes an
    // empty `offers` array both accurate and warning-free.
    ...(paidOffers.length > 0 ? { offers: paidOffers } : {}),
  };

  const blocks = [organization, website, faqPage, application].filter(Boolean);

  return (
    <>
      {blocks.map((block, i) => (
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
