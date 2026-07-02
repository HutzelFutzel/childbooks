import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AnalyticsInit } from "../ui/components/AnalyticsInit";
import { getBrandingConfig } from "../server/branding";

/**
 * Site-wide defaults. The favicon + theme color come from the admin-managed
 * branding kit so they can be changed without a redeploy (the landing page
 * overrides title/description/OG per its SEO config). Favicons are referenced
 * by their stable public Storage URL — dynamic to configure, cached to serve.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingConfig();
  return {
    title: {
      default: `${branding.brandName} — AI-illustrated children's books`,
      template: `%s · ${branding.brandName}`,
    },
    description:
      "Write, illustrate, and print custom children's picture books with AI. Consistent characters, beautiful layouts, and print-ready export.",
    openGraph: {
      title: branding.brandName,
      description:
        "Write, illustrate, and print custom children's picture books with AI.",
      type: "website",
    },
    icons: branding.favicon?.imageUrl
      ? {
          icon: branding.favicon.imageUrl,
          shortcut: branding.favicon.imageUrl,
          apple: branding.icon?.imageUrl ?? branding.favicon.imageUrl,
        }
      : undefined,
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getBrandingConfig();
  return { themeColor: branding.colors.primary };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <AnalyticsInit />
      </body>
    </html>
  );
}
