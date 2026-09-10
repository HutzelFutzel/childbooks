import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, BookOpen, Calculator, HelpCircle } from "lucide-react";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { getSeoConfig } from "../../server/seo";
import { marketingPageMetadata } from "../../server/pageSeo";
import { resolveSeoPage } from "../../core/config/seo";
import { getPublicPlans } from "../../server/plans";
import { getCatalogMedia, getPricingSettings, getPublicProducts } from "../../server/products";
import { offerablePublicProducts } from "../../core/config/products";
import { Nav } from "../../ui/marketing/Nav";
import { Footer } from "../../ui/marketing/Footer";
import { BreadcrumbJsonLd } from "../../ui/marketing/BreadcrumbJsonLd";
import { PriceSimulator } from "../../ui/pricing/PriceSimulator";
import { PriceTable } from "../../ui/pricing/PriceTable";
import { PricingJsonLd } from "../../ui/pricing/PricingJsonLd";
import { PricingFaq } from "../../ui/pricing/PricingFaq";
import { MembershipPlans } from "../../ui/pricing/MembershipPlans";
import { pricingFaq } from "../../ui/pricing/faq";
import { requestedCurrency, requestedPlanId } from "../../ui/pricing/format";

/**
 * Public comprehensive pricing page: memberships + print pricing calculator.
 *
 * Server-rendered per request for the latest catalog and plan changes without redeploy.
 */
export const dynamic = "force-dynamic";

const PATH = "/pricing" as const;

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  return marketingPageMetadata(seo, PATH, branding);
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string; plan?: string; interval?: string }>;
}) {
  const [{ currency: askedCurrency, plan: askedPlan }, branding, legal, seo, catalog, settings, plans, media] =
    await Promise.all([
      searchParams,
      getBrandingConfig(),
      getLegalConfig(),
      getSeoConfig(),
      getPublicProducts(),
      getPricingSettings(),
      getPublicPlans(),
      getCatalogMedia(),
    ]);

  const logoUrl = branding.logo?.imageUrl ?? null;
  const products = offerablePublicProducts(catalog.products);
  const currency = requestedCurrency(settings, askedCurrency);
  const planId = requestedPlanId(plans.plans, askedPlan);
  const faq = pricingFaq(products, settings, currency, plans.plans);
  const { title, description } = resolveSeoPage(seo, PATH);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: title, url: `${seo.siteUrl}${PATH}` },
        ]}
      />
      <PricingJsonLd
        name={`${branding.brandName} pricing & memberships`}
        description={description}
        url={`${seo.siteUrl}${PATH}`}
        faq={faq}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-28 sm:pt-32">
        {/* Page Hero */}
        <header className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-4 py-1 text-xs font-semibold tracking-wide text-brand-700">
            <Sparkles className="size-3.5" />
            <span>Transparent, simple pricing</span>
          </span>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">
            Everything you need to create bedtime magic
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-600 sm:text-xl">
            Create for free, choose an optional membership for regular story sparks and print discounts,
            or order heirloom books whenever you are ready.
          </p>

          {/* Quick jump navigation pills */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#memberships"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-700 shadow-xs transition hover:border-brand-300 hover:text-brand-700"
            >
              <Sparkles className="size-3.5 text-brand-600" />
              <span>Memberships & Plans</span>
            </a>
            <a
              href="#print-calculator"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-700 shadow-xs transition hover:border-brand-300 hover:text-brand-700"
            >
              <Calculator className="size-3.5 text-brand-600" />
              <span>Print Calculator</span>
            </a>
            <a
              href="#faq"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-700 shadow-xs transition hover:border-brand-300 hover:text-brand-700"
            >
              <HelpCircle className="size-3.5 text-ink-500" />
              <span>Frequently Asked Questions</span>
            </a>
          </div>
        </header>

        {/* Section 1: Memberships */}
        <section id="memberships" className="scroll-mt-24 pt-16 sm:pt-20">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-ink-900">
              Storyteller Memberships
            </h2>
            <p className="mt-3 text-base text-ink-600">
              For parents and grandparents who want a steady flow of fresh bedtime stories. Cancel or
              switch anytime.
            </p>
          </div>

          <MembershipPlans plans={plans.plans} currency={currency} />
        </section>

        {/* Divider */}
        <div className="my-20 border-t border-ink-100" />

        {/* Section 2: Print Cost Calculator */}
        <section id="print-calculator" className="scroll-mt-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-ink-700">
              <BookOpen className="size-3.5" />
              <span>Printed Keepsakes</span>
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink-900">
              See what your printed book will cost
            </h2>
            <p className="mt-3 text-base text-ink-600">
              Custom children's books printed on heavyweight archival paper. Order anytime — no account
              or membership required.
            </p>
          </div>

          <div className="mt-10">
            <PriceSimulator
              products={products}
              settings={settings}
              plans={plans.plans}
              media={media}
              currency={currency}
              planId={planId}
            />
          </div>

          {products.length > 0 && (
            <details className="group mx-auto mt-14 max-w-4xl border-y border-ink-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-sm font-semibold text-ink-800">
                Detailed pricing by format and page count
                <span
                  aria-hidden
                  className="text-lg font-normal text-ink-400 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="pb-6">
                <p className="mb-5 max-w-2xl text-sm leading-relaxed text-ink-600">
                  Prices below are for one copy in {currency}. Printing is charged in page brackets, so
                  adding pages within a bracket does not change the price.
                </p>
                <PriceTable products={products} settings={settings} currency={currency} />
                <p className="mt-5 text-sm leading-relaxed text-ink-500">
                  The final total depends on binding, page count, cover finish, number of copies,
                  destination, and delivery speed.
                </p>
              </div>
            </details>
          )}
        </section>

        {/* Section 3: FAQ */}
        {faq.length > 0 && (
          <section id="faq" aria-labelledby="pricing-faq" className="mx-auto mt-24 max-w-4xl scroll-mt-24">
            <h2 id="pricing-faq" className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl text-center">
              Frequently asked questions
            </h2>
            <PricingFaq items={faq} className="mt-8" />
          </section>
        )}
      </main>

      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
