import type { MetadataRoute } from "next";
import { getSeoConfig } from "../server/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const seo = await getSeoConfig();
  const now = new Date();
  return [
    { url: `${seo.siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${seo.siteUrl}/studio`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
