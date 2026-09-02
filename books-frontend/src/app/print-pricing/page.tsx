import type { Metadata } from "next";
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
import { pricingFaq } from "../../ui/pricing/faq";
import { requestedCurrency, requestedPlanId } from "../../ui/pricing/format";

/**
 * Public print-price calculator.
 *
 * Server-rendered per request for the same reason the landing page is: the prices
 * come from the admin catalog and must be current without a redeploy. It also
 * means the real numbers are in the raw HTML, so the page says something to a
 * crawler and to a visitor whose JavaScript hasn't arrived — a slider alone would
 * render as an empty shell to both.
 *
 * Open to guests deliberately. `/checkout/price` (the live-quote path) needs a
 * verified account and calls the print provider on every request, so it can't
 * back a public tool; everything here is computed from the world-readable catalog
 * projection instead, which costs nothing to serve and cannot leak cost data.
 */
export const dynamic = "force-dynamic";

const PATH = "/print-pricing" as const;

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  return marketingPageMetadata(seo, PATH, branding);
}

export default async function PrintPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string; plan?: string }>;
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
  // Read from the URL so the static tables and the calculator can never disagree
  // about which currency the page is in. Validated, and canonicalized away in
  // `generateMetadata` so this doesn't fragment the page across currencies.
  const currency = requestedCurrency(settings, askedCurrency);
  // Preselects a returning subscriber's own plan (a deep link from the Studio),
  // so the receipt opens on what they'd actually pay. Never part of the
  // canonical URL — see `requestedPlanId`.
  const planId = requestedPlanId(plans.plans, askedPlan);
  const faq = pricingFaq(products, settings, currency);
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
        name={`${branding.brandName} print pricing calculator`}
        description={description}
        url={`${seo.siteUrl}${PATH}`}
        faq={faq}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main className="mx-auto max-w-5xl px-6 pb-20 pt-28 sm:pt-32">
        <header className="mx-auto max-w-xl text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            See what your printed book will cost
          </h1>
          <p className="mt-3 text-base leading-relaxed text-ink-600">
            Choose a few details to see your price. No account or purchase required.
          </p>
        </header>

        <section aria-labelledby="calculator" className="mt-10">
          <h2 id="calculator" className="sr-only">
            Price calculator
          </h2>
          <PriceSimulator
            products={products}
            settings={settings}
            plans={plans.plans}
            media={media}
            currency={currency}
            planId={planId}
          />
        </section>

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
                Prices below are for one copy at the standard specification, in {currency}.
                Printing is charged in page brackets, so adding pages within a bracket does not
                change the price.
              </p>
              <PriceTable products={products} settings={settings} currency={currency} />
              <p className="mt-5 text-sm leading-relaxed text-ink-500">
                The final total depends on format, page count, print options, number of copies,
                destination, and delivery speed.
              </p>
            </div>
          </details>
        )}

        {faq.length > 0 && (
          <section aria-labelledby="pricing-faq" className="mx-auto mt-16 max-w-4xl">
            <h2 id="pricing-faq" className="font-display text-xl font-bold tracking-tight text-ink-900">
              Common questions
            </h2>
            <PricingFaq items={faq} className="mt-4" />
          </section>
        )}
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
