import type { Metadata, Viewport } from "next";
import { getSeoConfig } from "../server/seo";
import { getBrandingConfig } from "../server/branding";
import { getPublicPlans } from "../server/plans";
import { getSiteImagesConfig } from "../server/siteImages";
import { getSiteContentConfig } from "../server/siteContent";
import { Nav } from "../ui/marketing/Nav";
import { Hero } from "../ui/marketing/Hero";
import { TrustStrip } from "../ui/marketing/TrustStrip";
import { HowItWorks } from "../ui/marketing/HowItWorks";
import { Features } from "../ui/marketing/Features";
import { Pricing } from "../ui/marketing/Pricing";
import { Faq } from "../ui/marketing/Faq";
import { CtaBand } from "../ui/marketing/CtaBand";
import { Footer } from "../ui/marketing/Footer";
import { JsonLd } from "../ui/marketing/JsonLd";
import { AdminEditBar } from "../ui/marketing/AdminEditBar";

/**
 * Marketing landing page — server-rendered for SEO. Title/description, social
 * metadata, robots and structured data all come from the admin-managed SEO
 * config (`appConfig/seo`); pricing comes from the public plans projection.
 * Rendered per request so admin edits appear without a redeploy.
 */
export const dynamic = "force-dynamic";

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  const canonical = `${seo.siteUrl}${seo.canonicalPath}`;
  const ogImage = branding.ogImage?.imageUrl;
  const ogAlt = branding.ogImage?.alt || seo.titleDefault;

  return {
    metadataBase: safeUrl(seo.siteUrl),
    title: { default: seo.titleDefault, template: seo.titleTemplate },
    description: seo.description,
    keywords: seo.keywords.length > 0 ? seo.keywords : undefined,
    applicationName: seo.siteName,
    alternates: { canonical },
    robots: {
      index: seo.robots.index,
      follow: seo.robots.follow,
      googleBot: { index: seo.robots.index, follow: seo.robots.follow },
    },
    openGraph: {
      type: "website",
      siteName: seo.siteName,
      title: seo.titleDefault,
      description: seo.description,
      url: canonical,
      images: ogImage ? [{ url: ogImage, alt: ogAlt }] : undefined,
    },
    twitter: {
      card: seo.twitterCard,
      site: seo.twitterHandle || undefined,
      title: seo.titleDefault,
      description: seo.description,
      images: ogImage ? [ogImage] : undefined,
    },
    verification: {
      google: seo.verification.google || undefined,
      other: seo.verification.bing ? { "msvalidate.01": seo.verification.bing } : undefined,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getBrandingConfig();
  return { themeColor: branding.colors.primary };
}

export default async function Home() {
  const [seo, branding, plans, siteImages, siteContent] = await Promise.all([
    getSeoConfig(),
    getBrandingConfig(),
    getPublicPlans(),
    getSiteImagesConfig(),
    getSiteContentConfig(),
  ]);
  const logoUrl = branding.logo?.imageUrl ?? null;
  const images = siteImages.images;
  const text = siteContent.text;

  return (
    <>
      <JsonLd seo={seo} branding={branding} plans={plans} />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main>
        <Hero images={images} text={text} />
        <TrustStrip text={text} />
        <HowItWorks images={images} text={text} />
        <Features text={text} />
        <Pricing initial={plans} />
        <Faq items={seo.faq} />
        <CtaBand text={text} />
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} />
      <AdminEditBar />
    </>
  );
}
