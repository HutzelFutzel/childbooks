import type { BlogPost } from "@/core/config/blog";
import type { SeoConfig } from "@/core/config/seo";
import type { BrandingConfig } from "@/core/config/branding";

/**
 * BlogPosting structured data (schema.org) for a single article. Server-rendered
 * into the raw HTML so crawlers see headline, images, dates, author and
 * publisher. Publisher/logo come from the branding kit + SEO config.
 */
export function ArticleJsonLd({
  post,
  seo,
  branding,
}: {
  post: BlogPost;
  seo: SeoConfig;
  branding: BrandingConfig;
}) {
  const url = `${seo.siteUrl}/blog/${post.slug}`;
  const logoUrl = branding.icon?.imageUrl ?? branding.logo?.imageUrl;
  const publishedAt = post.publishedAt ?? post.updatedAt;

  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.seo.description || post.excerpt,
    image: post.coverImage?.imageUrl ? [post.coverImage.imageUrl] : undefined,
    datePublished: new Date(publishedAt).toISOString(),
    dateModified: new Date(post.updatedAt).toISOString(),
    author: { "@type": "Person", name: post.author.name },
    publisher: {
      "@type": "Organization",
      name: seo.organization.name || branding.brandName,
      logo: logoUrl ? { "@type": "ImageObject", url: logoUrl } : undefined,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    keywords: post.tags.length > 0 ? post.tags.join(", ") : undefined,
  };

  return (
    <script
      // eslint-disable-next-line react/no-danger
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
