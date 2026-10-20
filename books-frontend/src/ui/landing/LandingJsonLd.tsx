import type { LandingPage } from "../../core/config/landingPages";
import { resolveLandingSeo } from "../../core/config/landingPages";
import type { SeoConfig } from "../../core/config/seo";
import type { BrandingConfig } from "../../core/config/branding";
import { jsonLdHtml } from "../marketing/jsonLdHtml";

/**
 * Structured data for a landing page: a `WebPage` tied to the site's
 * `WebSite`/`Organization`, plus a `FAQPage` built from the page's FAQ.
 *
 * Be honest about what this buys. Google now shows FAQ rich results almost only
 * for government and health sites, so don't expect expandable answers in the
 * search listing. The markup still states the page's questions and answers
 * unambiguously to every crawler, which is what AI answer engines read. It
 * costs nothing because the FAQ is the same data the page already renders.
 *
 * (No `HowTo`: Google retired those rich results, so it would be dead weight.)
 */
export function LandingJsonLd({
  page,
  seo,
  branding,
  url,
}: {
  page: LandingPage;
  seo: SeoConfig;
  branding: BrandingConfig;
  /** Absolute canonical URL of this page. */
  url: string;
}) {
  const meta = resolveLandingSeo(page);
  const logoUrl = branding.icon?.imageUrl ?? branding.logo?.imageUrl;
  const publisher = {
    "@type": "Organization",
    name: seo.organization.name || branding.brandName,
    url: seo.siteUrl,
    logo: logoUrl || undefined,
  };

  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: meta.title,
    description: meta.description,
    url,
    inLanguage: page.locale,
    primaryImageOfPage: meta.image?.imageUrl,
    datePublished: page.publishedAt ? new Date(page.publishedAt).toISOString() : undefined,
    dateModified: new Date(page.updatedAt).toISOString(),
    isPartOf: { "@type": "WebSite", name: seo.siteName, url: seo.siteUrl },
    publisher,
  };

  const faqPage =
    page.faq.items.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: page.faq.items.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  return (
    <>
      {[webPage, faqPage].filter(Boolean).map((block, i) => (
        <script
          // eslint-disable-next-line react/no-danger
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(block) }}
        />
      ))}
    </>
  );
}
