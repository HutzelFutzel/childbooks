import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "../layout/BrandMark";
import { CookieSettingsButton } from "../consent/CookieSettingsButton";
import { visibleLegalLinks, type LegalConfig } from "../../core/config/legal";
import { getLandingFooterLinks } from "../../server/landingPages";
import { getBrandingConfig } from "../../server/branding";
import { FooterMascots } from "./FooterMascots";

// Root-relative hashes (`/#…`) so they work from any page, not just the landing.
// Vocabulary matches the top margin (`Journal`, single clear `Plans & print pricing`).
const COLUMNS = [
  {
    title: "Storybook Studio",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Plans & print pricing" },
      { href: "/studio", label: "Open the Studio" },
    ],
  },
  {
    title: "House & Community",
    links: [
      { href: "/blog", label: "Journal" },
      { href: "/#faq", label: "FAQ" },
      { href: "/affiliates", label: "Affiliate program" },
      { href: "/contact", label: "Write to Hugo & the team" },
    ],
  },
];

/**
 * Editorial Book Colophon & Character Ledge Footer:
 * - Warm cream paper (`bg-canvas`) with a 1px ink colophon rule.
 * - Top curtain-call ledge where Momo (reading on a stack of books), Cleo
 *   (perched with her tail & paw dangling *below* the 1px line), and Scout
 *   (peeking up with his paws resting *over* the line) physically interact
 *   with the divider across mobile, tablet, and desktop.
 * - Responsive 2-column mobile / multi-column desktop index for product,
 *   company, SEO landing pages, and legal links.
 */
export async function Footer({
  siteName,
  logoUrl,
  legal,
}: {
  siteName: string;
  logoUrl?: string | null;
  legal?: LegalConfig;
}) {
  const year = new Date().getFullYear();
  const [branding, landingLinks] = await Promise.all([
    getBrandingConfig(),
    getLandingFooterLinks(),
  ]);
  const legalLinks = legal ? visibleLegalLinks(legal, "footer") : [];

  return (
    <footer className="relative overflow-hidden border-t border-ink-900/12 bg-canvas">
      <div className="mx-auto max-w-6xl px-6 pt-12 sm:pt-14">
        {/* Top Colophon Ledge: Imprint on the left, characters perched ON and hanging OVER the 1px rule on the right */}
        <div className="relative flex flex-col justify-between gap-6 border-b border-ink-900/14 md:flex-row md:items-end">
          <div className="max-w-md pb-2 md:pb-7">
            <BrandMark
              siteName={siteName}
              logoUrl={logoUrl}
              iconUrl={branding.icon?.imageUrl}
            />
            <p className="mt-3.5 text-sm leading-relaxed text-ink-600">
              Write a bedtime tale, illustrate every page with consistent characters, and hold an heirloom picture book made for your family&apos;s shelf.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link
                href="/studio"
                className="inline-flex items-center gap-1 font-display text-sm font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                <span>Open the Studio</span>
                <ArrowUpRight className="size-4" />
              </Link>
              <Link
                href="/contact"
                className="font-display text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
              >
                Need a hand? Write to us →
              </Link>
            </div>
          </div>

          {/* Characters sit flush on the bottom border of this container so Cleo's tail & Scout's paws cross the 1px line */}
          <div className="flex items-end justify-end">
            <FooterMascots
              leftUrl={branding.footerMascotLeft?.imageUrl}
              leftAlt={branding.footerMascotLeft?.alt}
              centerUrl={branding.footerMascotCenter?.imageUrl}
              centerAlt={branding.footerMascotCenter?.alt}
              rightUrl={branding.footerMascotRight?.imageUrl}
              rightAlt={branding.footerMascotRight?.alt}
            />
          </div>
        </div>

        {/* Responsive Editorial Index Grid (2 cols on mobile, 3–4 cols on md+) */}
        <div
          className={`grid grid-cols-2 gap-x-8 gap-y-10 pt-12 pb-11 sm:py-12 ${
            landingLinks.length > 0 ? "md:grid-cols-4" : "md:grid-cols-3"
          }`}
        >
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="flex items-center gap-2 font-display text-xs font-medium uppercase tracking-[0.08em] text-ink-400">
                <span aria-hidden className="size-1.5 rounded-full bg-brand-600" />
                <span>{col.title}</span>
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-ink-600 transition-colors hover:text-ink-900"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {landingLinks.length > 0 && (
            <div>
              <h3 className="flex items-center gap-2 font-display text-xs font-medium uppercase tracking-[0.08em] text-ink-400">
                <span aria-hidden className="size-1.5 rounded-full bg-brand-600" />
                <span>Storybook Ideas</span>
              </h3>
              <ul className="mt-4 space-y-2.5">
                {landingLinks.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-ink-600 transition-colors hover:text-ink-900"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="flex items-center gap-2 font-display text-xs font-medium uppercase tracking-[0.08em] text-ink-400">
              <span aria-hidden className="size-1.5 rounded-full bg-brand-600" />
              <span>Colophon &amp; Legal</span>
            </h3>
            <ul className="mt-4 space-y-2.5">
              {legalLinks.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-ink-600 transition-colors hover:text-ink-900"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <CookieSettingsButton className="text-sm text-ink-600 transition-colors hover:text-ink-900" />
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Colophon Strip */}
      <div className="border-t border-ink-900/10 bg-ink-900/[0.02]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-5 text-xs text-ink-400 sm:flex-row sm:items-center">
          <p>© {year} {siteName}. All rights reserved.</p>
          <p className="font-display text-[11.5px] text-ink-400">
            Crafted for bedtime reading · Digital &amp; heirloom print
          </p>
        </div>
      </div>
    </footer>
  );
}
