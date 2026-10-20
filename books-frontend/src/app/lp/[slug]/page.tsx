import type { Metadata } from "next";
import { DEFAULT_LOCALE } from "../../../core/i18n/locales";
import { getLandingIndex } from "../../../server/landingPages";
import { LandingRoutePage, landingMetadata } from "../../../ui/landing/landingRoute";

/**
 * Admin-managed landing page. All the work — routing a slug to a page, a
 * redirect or a 404, the metadata, the template — lives in `landingRoute.tsx`,
 * parameterised by locale, so this file is only where the URL comes from.
 *
 * Statically rendered with ISR like the blog: pre-built for the published slugs,
 * revalidated every minute and on demand from the admin save. Any other slug
 * renders on first request (`dynamicParams`), which is how a retired page's
 * redirect and a renamed page's old URL get served.
 */
export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  const index = await getLandingIndex();
  return index.pages
    .filter((p) => p.status === "published" && p.locale === DEFAULT_LOCALE)
    .map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return landingMetadata(DEFAULT_LOCALE, slug);
}

export default async function LandingPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LandingRoutePage locale={DEFAULT_LOCALE} slug={slug} />;
}
