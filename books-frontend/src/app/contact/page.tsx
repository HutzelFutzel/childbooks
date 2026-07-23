import type { Metadata } from "next";
import { getBrandingConfig } from "../../server/branding";
import { getLegalConfig } from "../../server/legal";
import { legalUrlByRole } from "../../core/config/legal";
import { Nav } from "../../ui/marketing/Nav";
import { Footer } from "../../ui/marketing/Footer";
import { ContactForm } from "../../ui/contact/ContactForm";

/** Rendered per request so brand + legal links reflect admin edits without a redeploy. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingConfig();
  return {
    title: "Contact",
    description: `Get in touch with the ${branding.brandName} team.`,
  };
}

export default async function ContactPage() {
  const [branding, legal] = await Promise.all([getBrandingConfig(), getLegalConfig()]);
  const logoUrl = branding.logo?.imageUrl ?? null;
  const privacyUrl = legalUrlByRole(legal, "privacy") || undefined;

  return (
    <>
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <main className="mx-auto max-w-2xl px-6 pb-20 pt-28 sm:pt-32">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-ink-900">Get in touch</h1>
          <p className="mt-2 text-sm text-ink-500">
            Questions, feedback, or need a hand with an order? Send us a message and we&apos;ll reply by email.
          </p>
        </header>
        <ContactForm privacyUrl={privacyUrl} />
      </main>
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
