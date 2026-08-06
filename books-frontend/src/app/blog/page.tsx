import type { Metadata } from "next";
import { getSeoConfig } from "../../server/seo";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { getPublishedPosts } from "../../server/blog";
import { marketingPageMetadata } from "../../server/pageSeo";
import { resolveSeoPage } from "../../core/config/seo";
import { Nav } from "../../ui/marketing/Nav";
import { Footer } from "../../ui/marketing/Footer";
import { BreadcrumbJsonLd } from "../../ui/marketing/BreadcrumbJsonLd";
import { BlogCard } from "../../ui/blog/BlogCard";

/**
 * Blog index — server-rendered with ISR so published articles appear within the
 * revalidation window (and instantly via on-demand revalidation on save). Reads
 * the lightweight published-posts projection, never the full bodies.
 */
export const revalidate = 60;

const PATH = "/blog" as const;

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  return marketingPageMetadata(seo, PATH, branding);
}

export default async function BlogIndexPage() {
  const [seo, branding, legal, posts] = await Promise.all([
    getSeoConfig(),
    getBrandingConfig(),
    getLegalConfig(),
    getPublishedPosts(),
  ]);
  const logoUrl = branding.logo?.imageUrl ?? null;
  const { title } = resolveSeoPage(seo, PATH);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: title, url: `${seo.siteUrl}${PATH}` },
        ]}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-28 sm:pt-32">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">
            The {branding.brandName} blog
          </h1>
          <p className="mt-4 text-lg text-ink-600">
            Guides, ideas and inspiration for turning your stories into beautiful, personalized
            children&apos;s books.
          </p>
        </header>

        {posts.length === 0 ? (
          <p className="mt-16 text-center text-ink-400">No posts yet — check back soon.</p>
        ) : (
          <section aria-label="Latest articles">
            <h2 className="sr-only">Latest articles</h2>
            <ul className="mt-14 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <li key={post.slug}>
                  <BlogCard post={post} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
