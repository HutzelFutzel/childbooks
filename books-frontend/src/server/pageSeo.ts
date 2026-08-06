/**
 * Shared `generateMetadata` helper for fixed marketing routes that read
 * Admin → Marketing → SEO → Pages overrides (with code defaults as fallback).
 */
import type { Metadata } from "next";
import type { BrandingConfig } from "../core/config/branding";
import { resolveSeoPage, type SeoConfig, type SeoPageId } from "../core/config/seo";

export function marketingPageMetadata(
  seo: SeoConfig,
  path: SeoPageId,
  branding?: BrandingConfig,
): Metadata {
  const { title, description } = resolveSeoPage(seo, path);
  const canonical = `${seo.siteUrl}${path}`;
  const ogImage = branding?.ogImage?.imageUrl;
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
      images: ogImage ? [{ url: ogImage, alt: branding?.ogImage?.alt || title }] : undefined,
    },
    twitter: {
      card: seo.twitterCard,
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}
