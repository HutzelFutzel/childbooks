import type { MetadataRoute } from "next";
import { getSeoConfig } from "../server/seo";
import { getPublishedPosts } from "../server/blog";

// Reflects the admin SEO config (base URL + last edit time) and the published
// blog without a redeploy. Only lists publicly indexable routes — /studio and
// /admin are disallowed in robots.ts, so they MUST NOT appear here (a sitemap
// must never list a URL that robots blocks, or Search Console flags the conflict).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [seo, posts] = await Promise.all([getSeoConfig(), getPublishedPosts()]);
  // Use the admin's last SEO/content edit as the change signal instead of
  // "now" on every crawl — a stable lastModified is what tells crawlers a page
  // actually changed.
  const lastModified = new Date(seo.updatedAt);
  return [
    { url: `${seo.siteUrl}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${seo.siteUrl}/blog`, lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: `${seo.siteUrl}/contact`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    ...posts.map((post) => ({
      url: `${seo.siteUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
