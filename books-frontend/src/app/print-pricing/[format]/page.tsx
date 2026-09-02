import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandingConfig } from "../../../server/branding";
import { getLegalConfig } from "../../../server/legal";
import { getSeoConfig } from "../../../server/seo";
import { getPublicPlans } from "../../../server/plans";
import { getCatalogMedia, getPricingSettings, getPublicProducts } from "../../../server/products";
import {
  findPublicProductBySlug,
  formatSlug,
  offerablePublicProducts,
  type PublicProduct,
} from "../../../core/config/products";
import { bindingNoun } from "../../../core/fulfillment";
import { Nav } from "../../../ui/marketing/Nav";
import { Footer } from "../../../ui/marketing/Footer";
import { BreadcrumbJsonLd } from "../../../ui/marketing/BreadcrumbJsonLd";
import { PriceSimulator } from "../../../ui/pricing/PriceSimulator";
import { PriceTable, ShippingTable } from "../../../ui/pricing/PriceTable";
import { PricingJsonLd } from "../../../ui/pricing/PricingJsonLd";
import { PricingFaq } from "../../../ui/pricing/PricingFaq";
import { pricingFaq } from "../../../ui/pricing/faq";
import { requestedCurrency, requestedPlanId, trimLabel } from "../../../ui/pricing/format";

/**
 * Print pricing for ONE format.
 *
 * One route per trim × binding, and no deeper. The variant space is 200-odd
 * sellable combinations before multiplying by five markets and a page range, so
 * making the rest of the tool's state addressable would produce thousands of
 * near-identical URLs — thin content, wasted crawl budget, and no reader served.
 * A format genuinely differs (its own limits, its own brackets, its own shipping),
 * which is what makes these worth indexing; everything else stays client state.
 */
export const dynamic = "force-dynamic";

/** The offerable format a slug names, plus its siblings for the comparison table. */
async function loadFormat(slug: string): Promise<{
  product: PublicProduct;
  siblings: PublicProduct[];
} | null> {
  const catalog = await getPublicProducts();
  const products = offerablePublicProducts(catalog.products);
  const product = findPublicProductBySlug(products, slug);
  if (!product) return null;
  return { product, siblings: products };
}

/** `Hardcover children's book, 8.5 × 8.5″` — the words someone would search. */
function formatName(product: PublicProduct): string {
  return `${bindingNoun(product.spec.binding)}, ${trimLabel(product.spec.pageTrim)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ format: string }>;
}): Promise<Metadata> {
  const { format } = await params;
  const [seo, branding, loaded] = await Promise.all([
    getSeoConfig(),
    getBrandingConfig(),
    loadFormat(format),
  ]);
  if (!loaded) return { title: "Print pricing", robots: { index: false, follow: true } };

  const { product } = loaded;
  const name = formatName(product);
  const title = `${name} — print pricing`;
  const description = `What it costs to print a ${bindingNoun(product.spec.binding)} children's book at ${trimLabel(
    product.spec.pageTrim,
  )}, from ${product.conditions.pages.min} to ${product.conditions.pages.max} pages, including shipping.`;
  const canonical = `${seo.siteUrl}/print-pricing/${formatSlug(product.spec)}`;
  const ogImage = branding.ogImage?.imageUrl;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: seo.siteName,
      title,
      description,
      url: canonical,
      images: ogImage ? [{ url: ogImage, alt: branding.ogImage?.alt || title }] : undefined,
    },
    twitter: {
      card: seo.twitterCard,
      site: seo.twitterHandle || undefined,
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function FormatPricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ format: string }>;
  searchParams: Promise<{ currency?: string; plan?: string }>;
}) {
  const { format } = await params;
  const [{ currency: askedCurrency, plan: askedPlan }, branding, legal, seo, settings, plans, media, loaded] =
    await Promise.all([
      searchParams,
      getBrandingConfig(),
      getLegalConfig(),
      getSeoConfig(),
      getPricingSettings(),
      getPublicPlans(),
      getCatalogMedia(),
      loadFormat(format),
    ]);

  // A format that isn't on sale has no honest price to show, and a page that
  // invented one would be indexed. 404 is the truthful answer.
  if (!loaded) notFound();

  const { product, siblings } = loaded;
  const logoUrl = branding.logo?.imageUrl ?? null;
  const currency = requestedCurrency(settings, askedCurrency);
  // Preselects a returning subscriber's own plan (a deep link from the Studio),
  // so the receipt opens on what they'd actually pay. Never part of the
  // canonical URL — see `requestedPlanId`.
  const planId = requestedPlanId(plans.plans, askedPlan);
  const name = formatName(product);
  const slug = formatSlug(product.spec);
  const faq = pricingFaq([product], settings, currency);
  const others = siblings.filter((p) => p.sku !== product.sku);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: "Print pricing", url: `${seo.siteUrl}/print-pricing` },
          { name, url: `${seo.siteUrl}/print-pricing/${slug}` },
        ]}
      />
      <PricingJsonLd
        name={`${name} print pricing calculator`}
        description={`Work out what printing a ${bindingNoun(product.spec.binding)} children's book costs.`}
        url={`${seo.siteUrl}/print-pricing/${slug}`}
        faq={faq}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main className="mx-auto max-w-5xl px-6 pb-20 pt-28 sm:pt-32">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-ink-500">
          <Link href="/print-pricing" className="underline decoration-ink-300 underline-offset-2 hover:text-ink-700">
            Print pricing
          </Link>
          <span className="mx-1.5 text-ink-300">/</span>
          <span className="capitalize text-ink-700">{name}</span>
        </nav>

        <header className="max-w-xl">
          <h1 className="font-display text-3xl font-bold capitalize tracking-tight text-ink-900 sm:text-4xl">
            See what this {bindingNoun(product.spec.binding)} will cost
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
            products={siblings}
            lockedFormat={product}
            settings={settings}
            plans={plans.plans}
            media={media}
            currency={currency}
            planId={planId}
          />
        </section>

        <details className="group mx-auto mt-14 max-w-4xl border-y border-ink-200">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-sm font-semibold text-ink-800">
            Detailed pricing and delivery
            <span
              aria-hidden
              className="text-lg font-normal text-ink-400 transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="space-y-9 pb-6">
            <section aria-labelledby="brackets">
              <h2 id="brackets" className="font-display text-lg font-bold tracking-tight text-ink-900">
                Price by page count
              </h2>
              <p className="mb-5 mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">
                One copy at the standard specification, in {currency}. Printing is charged in page
                brackets, so adding pages within a bracket does not change the price.
              </p>
              <PriceTable
                products={[product]}
                settings={settings}
                currency={currency}
                linkFormats={false}
              />
            </section>

            <section aria-labelledby="shipping">
              <h2 id="shipping" className="font-display text-lg font-bold tracking-tight text-ink-900">
                Delivery for one copy
              </h2>
              <p className="mb-5 mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">
                Delivery scales with the number of copies and is confirmed against a live carrier
                quote for your address at checkout.
              </p>
              <ShippingTable product={product} currency={currency} />
            </section>

            {product.description && (
              <section aria-labelledby="about" className="max-w-2xl">
                <h2 id="about" className="font-display text-lg font-bold tracking-tight text-ink-900">
                  About this format
                </h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                  {product.description}
                </p>
              </section>
            )}

            {others.length > 0 && (
              <section aria-labelledby="other-formats" className="max-w-2xl border-t border-ink-100 pt-6">
                <h2 id="other-formats" className="font-display text-lg font-bold tracking-tight text-ink-900">
                  Other book formats
                </h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {others.map((p) => {
                    const otherSlug = formatSlug(p.spec);
                    const otherName = `${bindingNoun(p.spec.binding)}, ${trimLabel(p.spec.pageTrim)}`;
                    return (
                      <li key={p.sku}>
                        <Link
                          href={`/print-pricing/${otherSlug}`}
                          className="text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
                        >
                          {otherName}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </details>

        {faq.length > 0 && (
          <section aria-labelledby="format-faq" className="mx-auto mt-16 max-w-4xl">
            <h2 id="format-faq" className="font-display text-xl font-bold tracking-tight text-ink-900">
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
