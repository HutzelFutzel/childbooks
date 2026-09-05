import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock, HelpCircle, ShieldCheck, Sparkles } from "lucide-react";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { getSeoConfig } from "../../server/seo";
import { marketingPageMetadata } from "../../server/pageSeo";
import { resolveSeoPage } from "../../core/config/seo";
import { legalUrlByRole } from "../../core/config/legal";
import { Nav } from "../../ui/marketing/Nav";
import { Footer } from "../../ui/marketing/Footer";
import { BreadcrumbJsonLd } from "../../ui/marketing/BreadcrumbJsonLd";
import { ContactForm } from "../../ui/contact/ContactForm";

/** Rendered per request so brand + legal links reflect admin edits without a redeploy. */
export const dynamic = "force-dynamic";

const PATH = "/contact" as const;

export async function generateMetadata(): Promise<Metadata> {
  const [seo, branding] = await Promise.all([getSeoConfig(), getBrandingConfig()]);
  return marketingPageMetadata(seo, PATH, branding);
}

export default async function ContactPage() {
  const [branding, legal, seo] = await Promise.all([
    getBrandingConfig(),
    getLegalConfig(),
    getSeoConfig(),
  ]);
  const logoUrl = branding.logo?.imageUrl ?? null;
  const privacyUrl = legalUrlByRole(legal, "privacy") || undefined;
  const { title } = resolveSeoPage(seo, PATH);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${seo.siteUrl}/` },
          { name: title, url: `${seo.siteUrl}${PATH}` },
        ]}
      />
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main className="mx-auto max-w-5xl px-6 pb-20 pt-28 sm:pt-32">
        <header className="mx-auto mb-10 max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1 text-xs font-medium text-brand-700">
            <Sparkles className="size-3.5 text-brand-500" />
            <span>Support &amp; Inquiries</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            We&apos;re here to help
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-600 sm:text-base">
            Have a question about creating your storybook, need help with an existing order, or want to share feedback? Our team is always happy to hear from you.
          </p>
        </header>

        <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
          {/* Main Contact Form */}
          <div>
            <ContactForm privacyUrl={privacyUrl} />
          </div>

          {/* Reassurance & Quick Info sidebar */}
          <div className="space-y-4">
            <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
              <div className="flex items-start gap-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                  <Clock className="size-5" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-semibold text-ink-900">
                    Friendly human replies
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    We read and respond to every message personally. Most questions are answered within 2 to 4 hours on business days (always within 24h).
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
              <div className="flex items-start gap-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-semibold text-ink-900">
                    Print happiness guarantee
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    If your hardcover or paperback arrives with any print defect or shipping damage, we&apos;ll reprint and reship it at no cost or issue a prompt refund.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick self-service answers */}
            <div className="rounded-3xl border border-ink-100 bg-canvas p-6">
              <h3 className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-wider text-ink-500">
                <HelpCircle className="size-4 text-ink-400" />
                Looking for quick answers?
              </h3>
              <ul className="mt-3 divide-y divide-ink-100 text-xs">
                <li className="py-2.5">
                  <Link
                    href="/#how-it-works"
                    className="group flex items-center justify-between font-medium text-ink-700 transition hover:text-brand-600"
                  >
                    <span>How personalized storybooks work</span>
                    <ArrowRight className="size-3.5 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </Link>
                </li>
                <li className="py-2.5">
                  <Link
                    href="/print-pricing"
                    className="group flex items-center justify-between font-medium text-ink-700 transition hover:text-brand-600"
                  >
                    <span>Print pricing, paper &amp; formats</span>
                    <ArrowRight className="size-3.5 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </Link>
                </li>
                <li className="py-2.5">
                  <Link
                    href="/#faq"
                    className="group flex items-center justify-between font-medium text-ink-700 transition hover:text-brand-600"
                  >
                    <span>Frequently asked questions</span>
                    <ArrowRight className="size-3.5 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
