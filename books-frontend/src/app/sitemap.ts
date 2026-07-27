import type { MetadataRoute } from "next";
import { getSeoConfig } from "../server/seo";
import { getPublishedPosts } from "../server/blog";
import { getPublicProducts } from "../server/products";
import { formatSlug, offerablePublicProducts } from "../core/config/products";

// Reflects the admin SEO config (base URL + last edit time), the published blog
// and the sellable print formats without a redeploy. Only lists publicly
// indexable routes — /studio and /admin are disallowed in robots.ts, so they MUST
// NOT appear here (a sitemap must never list a URL that robots blocks, or Search
// Console flags the conflict).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [seo, posts, catalog] = await Promise.all([
    getSeoConfig(),
    getPublishedPosts(),
    getPublicProducts(),
  ]);
  // Use the admin's last SEO/content edit as the change signal instead of
  // "now" on every crawl — a stable lastModified is what tells crawlers a page
  // actually changed.
  const lastModified = new Date(seo.updatedAt);
  // Only formats actually on sale. A per-format page 404s when its product isn't
  // offerable, so listing every catalog entry would advertise soft 404s — and the
  // same `offerablePublicProducts` gate the page uses keeps the two in step.
  const formats = offerablePublicProducts(catalog.products);
  return [
    { url: `${seo.siteUrl}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${seo.siteUrl}/print-pricing`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${seo.siteUrl}/blog`, lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: `${seo.siteUrl}/contact`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    ...formats.map((product) => ({
      url: `${seo.siteUrl}/print-pricing/${formatSlug(product.spec)}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...posts.map((post) => ({
      url: `${seo.siteUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
