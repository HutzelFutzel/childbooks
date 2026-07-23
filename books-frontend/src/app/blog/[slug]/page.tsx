import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { getSeoConfig } from "../../../server/seo";
import { getBrandingConfig } from "../../../server/branding";
import { getLegalConfig } from "../../../server/legal";
import { getSiteContentConfig } from "../../../server/siteContent";
import { getPostBySlug, getPublishedPosts } from "../../../server/blog";
import { Nav } from "../../../ui/marketing/Nav";
import { Footer } from "../../../ui/marketing/Footer";
import { CtaBand } from "../../../ui/marketing/CtaBand";
import { BreadcrumbJsonLd } from "../../../ui/marketing/BreadcrumbJsonLd";
import { Prose } from "../../../ui/blog/Prose";
import { BlogCard } from "../../../ui/blog/BlogCard";
import { ArticleJsonLd } from "../../../ui/blog/ArticleJsonLd";
import { formatPostDate } from "../../../ui/blog/date";

/** Static params + ISR: pre-render published posts, revalidate on a short window
 *  (and on-demand from the save route). Unknown slugs render on first request. */
export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  const posts = await getPublishedPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [post, seo, branding] = await Promise.all([
    getPostBySlug(slug),
    getSeoConfig(),
    getBrandingConfig(),
  ]);
  if (!post) return { title: "Article not found", robots: { index: false, follow: false } };

  const title = post.seo.title || post.title;
  const description = post.seo.description || post.excerpt;
  const canonical = `${seo.siteUrl}${post.seo.canonicalPath || `/blog/${post.slug}`}`;
  const ogImage = post.coverImage?.imageUrl ?? branding.ogImage?.imageUrl;
  const index = seo.robots.index && !post.seo.noindex;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index, follow: seo.robots.follow, googleBot: { index, follow: seo.robots.follow } },
    openGraph: {
      type: "article",
      siteName: seo.siteName,
      title,
      description,
      url: canonical,
      publishedTime: new Date(post.publishedAt ?? post.updatedAt).toISOString(),
      modifiedTime: new Date(post.updatedAt).toISOString(),
      authors: [post.author.name],
      tags: post.tags,
      images: ogImage ? [{ url: ogImage, alt: post.coverImage?.alt || title }] : undefined,
    },
    twitter: {
      card: seo.twitterCard,
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, seo, branding, legal, siteContent, allPosts] = await Promise.all([
    getPostBySlug(slug),
    getSeoConfig(),
    getBrandingConfig(),
    getLegalConfig(),
    getSiteContentConfig(),
    getPublishedPosts(),
  ]);
  if (!post) notFound();

  const logoUrl = branding.logo?.imageUrl ?? null;

  // Related: prefer posts sharing a tag, fall back to most recent; cap at 3.
  const others = allPosts.filter((p) => p.slug !== post.slug);
  const tagset = new Set(post.tags);
  const related = [...others]
    .sort((a, b) => Number(b.tags.some((t) => tagset.has(t))) - Number(a.tags.some((t) => tagset.has(t))))
    .slice(0, 3);

  return (
    <>
      <ArticleJsonLd post={post} seo={seo} branding={branding} />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: "Blog", url: `${seo.siteUrl}/blog` },
          { name: post.title, url: `${seo.siteUrl}/blog/${post.slug}` },
        ]}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />

      <main>
        <article className="mx-auto max-w-3xl px-6 pt-28 sm:pt-32">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition hover:text-ink-800"
          >
            <ArrowLeft className="size-4" />
            All articles
          </Link>

          <header className="mt-6">
            {post.tags[0] && (
              <span className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
                {post.tags[0]}
              </span>
            )}
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">
              {post.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-500">
              <span className="font-medium text-ink-700">{post.author.name}</span>
              <span aria-hidden>·</span>
              <time dateTime={new Date(post.publishedAt ?? post.updatedAt).toISOString()}>
                {formatPostDate(post.publishedAt ?? post.updatedAt)}
              </time>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" />
                {post.readingMinutes} min read
              </span>
            </div>
          </header>

          {post.coverImage?.imageUrl && (
            <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-3xl bg-brand-50 shadow-soft">
              <Image
                src={post.coverImage.imageUrl}
                alt={post.coverImage.alt || post.title}
                fill
                priority
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover"
              />
            </div>
          )}

          <div className="mt-10 pb-4">
            <Prose markdown={post.body} />
          </div>

          {post.author.bio && (
            <div className="mt-12 flex items-start gap-4 rounded-3xl border border-ink-200 bg-white p-6 shadow-soft">
              {post.author.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                  className="size-14 shrink-0 rounded-full object-cover"
                />
              )}
              <div>
                <p className="font-display text-base font-semibold text-ink-900">{post.author.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{post.author.bio}</p>
              </div>
            </div>
          )}
        </article>

        {related.length > 0 && (
          <section className="mx-auto mt-20 max-w-6xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900">
              Keep reading
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((p) => (
                <BlogCard key={p.slug} post={p} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-20">
          <CtaBand text={siteContent.text} />
        </div>
      </main>

      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
