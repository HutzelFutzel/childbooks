import type { Metadata } from "next";
import { getSeoConfig } from "../../server/seo";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { getPublishedPosts } from "../../server/blog";
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

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  const canonical = `${seo.siteUrl}/blog`;
  const title = "Blog";
  const description = `Guides, ideas and inspiration for making personalized children's books with ${branding.brandName}.`;
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
    twitter: { card: seo.twitterCard, title, description, images: ogImage ? [ogImage] : undefined },
  };
}

export default async function BlogIndexPage() {
  const [seo, branding, legal, posts] = await Promise.all([
    getSeoConfig(),
    getBrandingConfig(),
    getLegalConfig(),
    getPublishedPosts(),
  ]);
  const logoUrl = branding.logo?.imageUrl ?? null;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: "Blog", url: `${seo.siteUrl}/blog` },
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
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <BlogCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
