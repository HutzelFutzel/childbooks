import type { Metadata } from "next";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { getSeoConfig } from "../../server/seo";
import { marketingPageMetadata } from "../../server/pageSeo";
import { resolveSeoPage } from "../../core/config/seo";
import { legalUrlByRole } from "../../core/config/legal";
import { Nav } from "../../ui/marketing/Nav";
import { Footer } from "../../ui/marketing/Footer";
import { BreadcrumbJsonLd } from "../../ui/marketing/BreadcrumbJsonLd";
import { AffiliateApplyForm } from "../../ui/affiliates/AffiliateApplyForm";
import { AffiliateFaq } from "../../ui/affiliates/AffiliateFaq";
import { AffiliateJsonLd } from "../../ui/affiliates/AffiliateJsonLd";
import { AFFILIATE_FAQ } from "../../ui/affiliates/faq";

/**
 * Public affiliate program landing + application form.
 *
 * Server-rendered so the pitch copy is in the HTML for crawlers and guests.
 * Applications go to Firestore + Slack; partners are created in Rewardful only
 * after manual approval.
 */
export const dynamic = "force-dynamic";

const PATH = "/affiliates" as const;

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  return marketingPageMetadata(seo, PATH, branding);
}

export default async function AffiliatesPage() {
  const [branding, legal, seo] = await Promise.all([
    getBrandingConfig(),
    getLegalConfig(),
    getSeoConfig(),
  ]);
  const logoUrl = branding.logo?.imageUrl ?? null;
  const privacyUrl = legalUrlByRole(legal, "privacy") || undefined;
  const { title } = resolveSeoPage(seo, PATH);
  const brand = branding.brandName;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: title, url: `${seo.siteUrl}${PATH}` },
        ]}
      />
      <AffiliateJsonLd faq={AFFILIATE_FAQ} />
      <Nav siteName={brand} logoUrl={logoUrl} />
      <main className="mx-auto max-w-2xl px-6 pb-20 pt-28 sm:pt-32">
        <header className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-ink-900">{brand} Affiliate Program</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-500">
            Earn commission by sharing {brand} with your audience. Join our curated
            affiliate program and get paid when the people you refer create
            personalized children&apos;s books. We approve every partner by hand so
            the program stays a good fit for families and creators.
          </p>
        </header>

        <section className="mb-10 space-y-6" aria-labelledby="how-you-earn">
          <h2 id="how-you-earn" className="text-lg font-semibold text-ink-900">
            How you earn
          </h2>
          <ul className="space-y-3 text-sm leading-relaxed text-ink-600">
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>
                Share your unique link. When someone signs up through it and makes a
                commissionable purchase, you earn a share of that sale.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>
                Track clicks, referrals, and payouts in your affiliate dashboard once
                you&apos;re approved.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>
                Get paid on a regular schedule for commissions that clear — rates and
                terms are confirmed when we welcome you in.
              </span>
            </li>
          </ul>
        </section>

        <section className="mb-10 space-y-3" aria-labelledby="who-we-approve">
          <h2 id="who-we-approve" className="text-lg font-semibold text-ink-900">
            Who we approve
          </h2>
          <p className="text-sm leading-relaxed text-ink-600">
            We look for creators, bloggers, and newsletters with a genuine connection
            to parenting, kids, gifts, or storytelling — and channels that feel brand-safe
            for families. Coupon mills, spam, and misleading claims aren&apos;t a fit.
            There&apos;s no minimum audience size — a good fit matters more than reach.
          </p>
        </section>

        <section className="mb-10 space-y-4" aria-labelledby="affiliate-faq">
          <h2 id="affiliate-faq" className="text-lg font-semibold text-ink-900">
            Frequently asked questions
          </h2>
          <AffiliateFaq items={AFFILIATE_FAQ} />
        </section>

        <section aria-labelledby="apply">
          <h2 id="apply" className="mb-4 text-lg font-semibold text-ink-900">
            Apply to join
          </h2>
          <p className="mb-6 text-sm text-ink-500">
            Tell us a bit about yourself and your channels. If it looks like a match,
            we&apos;ll email you next steps to get set up.
          </p>
          <AffiliateApplyForm privacyUrl={privacyUrl} />
        </section>
      </main>
      <Footer siteName={brand} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
