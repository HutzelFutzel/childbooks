import type { Metadata, Viewport } from "next";
import "./globals.css";
// Always-available UI chrome fonts (book text fonts are still lazy-loaded on
// demand via ui/typography/fonts). Inter drives body copy; Fredoka the display.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import { ConsentManager } from "../ui/consent/ConsentManager";
import { getBrandingConfig } from "../server/branding";
import { getCookieConfig } from "../server/cookieConfig";
import { getLegalConfig } from "../server/legal";
import { legalUrlByRole } from "../core/config/legal";
import { brandingThemeVars } from "../ui/lib/color";

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Derive the whole palette from the admin's brand colors and inject it as
  // inline CSS variables on <html>, so every `bg-brand-*` / `text-accent-*`
  // utility reflects branding with no flash of the default purple.
  const [branding, cookieConfig, legal] = await Promise.all([
    getBrandingConfig(),
    getCookieConfig(),
    getLegalConfig(),
  ]);
  const themeVars = brandingThemeVars(branding);

  return (
    <html lang="en" style={themeVars as React.CSSProperties}>
      <body>
        {children}
        {/* Cookie consent gates Google Analytics — no analytics cookies fire
            until the visitor grants the analytics category. */}
        <ConsentManager
          config={cookieConfig}
          privacyUrl={legalUrlByRole(legal, "privacy") || undefined}
          cookiePolicyUrl={legalUrlByRole(legal, "cookies") || undefined}
        />
      </body>
    </html>
  );
}
