import type { Metadata } from "next";
import Link from "next/link";
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
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-28 sm:pt-32">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            What a printed book costs
          </h1>
          <p className="mt-4 text-lg text-ink-600">
            Every price on this page is the price you would pay — the same figures our checkout
            charges from. Change anything and watch the number move.
          </p>
        </header>

        <section aria-labelledby="calculator" className="mt-12">
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
          <section aria-labelledby="price-table" className="mt-16">
            <h2
              id="price-table"
              className="font-display text-2xl font-bold tracking-tight text-ink-900"
            >
              Price per copy, by format and length
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-600">
              A single copy at the standard specification, in {currency}. Longer books cost more to
              print, so each format is priced in page brackets — see a format&apos;s own page for
              its full bracket table and shipping rates.
            </p>
            <div className="mt-6">
              <PriceTable products={products} settings={settings} currency={currency} />
            </div>
          </section>
        )}

        <section aria-labelledby="how-pricing-works" className="mt-16">
          <h2
            id="how-pricing-works"
            className="font-display text-2xl font-bold tracking-tight text-ink-900"
          >
            What moves the price
          </h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Explainer title="Format">
              The trim size and the binding. A hardcover costs more to make than a stapled softcover,
              and each binding accepts a different range of lengths.
            </Explainer>
            <Explainer title="Length">
              Pages are the biggest lever on a long book. Printing is billed in brackets, so the
              price steps rather than climbing with every page you add.
            </Explainer>
            <Explainer title="Print and paper">
              Colour on heavy coated stock is what makes illustrations sing, and it costs several
              times what black and white on light uncoated paper does — per page, so the gap widens
              with length.
            </Explainer>
            <Explainer title="Destination and speed">
              Shipping is charged separately, scales with the number of copies, and varies by country.
              Not every carrier speed reaches every market.
            </Explainer>
          </div>
        </section>

        {faq.length > 0 && (
          <section aria-labelledby="pricing-faq" className="mt-16">
            <h2 id="pricing-faq" className="font-display text-2xl font-bold tracking-tight text-ink-900">
              Questions about print pricing
            </h2>
            <PricingFaq items={faq} className="mt-6" />
          </section>
        )}

        <div className="mt-16 rounded-3xl border border-brand-200 bg-brand-50 px-6 py-8 text-center">
          <h2 className="font-display text-xl font-bold text-ink-900">
            Make the book first — decide on printing later
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-600">
            You can write and illustrate a complete book for free, then come back to these numbers
            when you want to hold it. Nothing here is decided until you order.
          </p>
          <Link
            href="/studio"
            className="mt-5 inline-flex items-center justify-center rounded-2xl bg-brand-600 px-6 py-3 text-sm font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
          >
            Start your book
          </Link>
        </div>
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}

function Explainer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{children}</p>
    </div>
  );
}
