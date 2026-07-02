import type { MetadataRoute } from "next";
import { getSeoConfig } from "../server/seo";

// Reflects the admin robots toggle without a redeploy.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const seo = await getSeoConfig();
  return {
    rules: seo.robots.index
      ? { userAgent: "*", allow: "/", disallow: ["/admin", "/studio"] }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${seo.siteUrl}/sitemap.xml`,
    host: seo.siteUrl,
  };
}
