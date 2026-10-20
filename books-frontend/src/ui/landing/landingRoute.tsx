import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getSeoConfig } from "../../server/seo";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { getPublishedPosts } from "../../server/blog";
import { getLandingIndex, getLandingPage } from "../../server/landingPages";
import { findLocale, localeOrDefault } from "../../core/i18n/locales";
import { isPublished, publishedLocales } from "../../core/i18n/publish";
import { localeUrl } from "../../core/i18n/urls";
import {
  LANDING_PATH_PREFIX,
  landingHreflang,
  landingStatsKey,
  resolveCtaHref,
  resolveLandingRoute,
  resolveLandingSeo,
  type LandingPage,
  type LandingPagesIndex,
} from "../../core/config/landingPages";
import { Nav } from "../marketing/Nav";
import { Footer } from "../marketing/Footer";
import { BreadcrumbJsonLd } from "../marketing/BreadcrumbJsonLd";
import { BlogAnalytics } from "../blog/BlogAnalytics";
import { BlogCard } from "../blog/BlogCard";
import { LandingJsonLd } from "./LandingJsonLd";
import { LandingPageTemplate } from "./LandingPageTemplate";

/**
 * Everything the `/lp/[slug]` route does, parameterised by locale.
 *
 * The App Router tree isn't locale-segmented yet (see `middleware.ts`), so the
 * route passes the default locale. When the tree moves under `[locale]`, the
 * only change is where `locale` comes from — the resolution, metadata, redirects
 * and `hreflang` below already account for more than one language.
 */

interface Resolved {
  page: LandingPage;
  index: LandingPagesIndex;
}

/** The page to render, or `null` when the answer is a 404 or a redirect. */
async function resolve(locale: string, slug: string): Promise<
  | { kind: "page"; value: Resolved }
  | { kind: "redirect"; to: string; permanent: boolean }
  | { kind: "notFound" }
> {
  // A locale that isn't live has no landing pages, whatever the documents say.
  if (!isPublished(locale)) return { kind: "notFound" };

  const index = await getLandingIndex();
  const route = resolveLandingRoute(index, locale, slug);
  if (route.kind === "redirect") return route;
  if (route.kind === "notFound") return route;

  const page = await getLandingPage(locale, route.entry.slug);
  // The projection and the document can briefly disagree (e.g. mid-unpublish);
  // when they do, "not found" is the safe answer.
  return page ? { kind: "page", value: { page, index } } : { kind: "notFound" };
}

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export async function landingMetadata(locale: string, slug: string): Promise<Metadata> {
  const [seo, branding, resolved] = await Promise.all([
    getSeoConfig(),
    getBrandingConfig(),
    resolve(locale, slug),
  ]);
  if (resolved.kind !== "page") {
    return { title: "Page not found", robots: { index: false, follow: false } };
  }

  const { page, index } = resolved.value;
  const meta = resolveLandingSeo(page);
  const def = localeOrDefault(locale);
  const canonical = localeUrl(seo.siteUrl, def, `${LANDING_PATH_PREFIX}/${page.slug}`);
  const languages = landingHreflang(seo.siteUrl, index, page, publishedLocales());
  const ogImage = meta.image?.imageUrl ?? branding.ogImage?.imageUrl;
  const ogAlt = meta.image?.alt || page.hero.title || meta.title;
  // The global switch wins (it's how staging stays out of search), then the
  // page's own opt-out.
  const indexable = seo.robots.index && !meta.noindex;

  return {
    metadataBase: safeUrl(seo.siteUrl),
    title: meta.title,
    description: meta.description,
    alternates: { canonical, ...(languages ? { languages } : {}) },
    robots: {
      index: indexable,
      follow: seo.robots.follow,
      googleBot: { index: indexable, follow: seo.robots.follow },
    },
    openGraph: {
      type: "website",
      siteName: seo.siteName,
      title: meta.title,
      description: meta.description,
      url: canonical,
      locale: def.hreflang[0]?.replace("-", "_"),
      images: ogImage ? [{ url: ogImage, alt: ogAlt }] : undefined,
    },
    twitter: {
      card: seo.twitterCard,
      site: seo.twitterHandle || undefined,
      title: meta.title,
      description: meta.description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/** Related reading: posts that share a tag with the page (never arbitrary filler). */
async function relatedPosts(page: LandingPage) {
  if (page.tags.length === 0) return [];
  const wanted = new Set(page.tags.map((t) => t.toLowerCase()));
  const posts = await getPublishedPosts();
  return posts.filter((p) => p.tags.some((t) => wanted.has(t.toLowerCase()))).slice(0, 3);
}

export async function LandingRoutePage({ locale, slug }: { locale: string; slug: string }) {
  const resolved = await resolve(locale, slug);
  if (resolved.kind === "redirect") {
    if (resolved.permanent) permanentRedirect(resolved.to);
    redirect(resolved.to);
  }
  if (resolved.kind === "notFound") notFound();

  const { page } = resolved.value;
  const [seo, branding, legal, related] = await Promise.all([
    getSeoConfig(),
    getBrandingConfig(),
    getLegalConfig(),
    relatedPosts(page),
  ]);
  const logoUrl = branding.logo?.imageUrl ?? null;
  const def = findLocale(locale) ?? localeOrDefault(locale);
  const url = localeUrl(seo.siteUrl, def, `${LANDING_PATH_PREFIX}/${page.slug}`);

  return (
    <>
      <BlogAnalytics slug={landingStatsKey(page)} />
      <LandingJsonLd page={page} seo={seo} branding={branding} url={url} />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: page.title || page.hero.title, url },
        ]}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main>
        <LandingPageTemplate page={page} ctaHref={resolveCtaHref(page)} />
        {related.length > 0 && (
          <section aria-labelledby="lp-related" className="bg-canvas pb-20">
            <div className="mx-auto max-w-6xl px-6">
              <h2
                id="lp-related"
                className="font-display text-2xl font-bold tracking-tight text-ink-900"
              >
                Related reading for parents
              </h2>
              <ul className="mt-6 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((p) => (
                  <li key={p.slug}>
                    <BlogCard post={p} />
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm">
                <Link href="/blog" className="font-medium text-brand-700 underline underline-offset-2">
                  More articles
                </Link>
              </p>
            </div>
          </section>
        )}
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
