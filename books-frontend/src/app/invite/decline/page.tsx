import type { Metadata } from "next";
import { getBrandingConfig } from "../../../server/branding";
import { getLegalConfig } from "../../../server/legal";
import { getSeoConfig } from "../../../server/seo";
import { Nav } from "../../../ui/marketing/Nav";
import { Footer } from "../../../ui/marketing/Footer";
import { DeclineInviteClient } from "./DeclineInviteClient";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [branding, seo] = await Promise.all([getBrandingConfig(), getSeoConfig()]);
  return {
    title: "Decline invitation",
    description: `Opt out of invitation emails from ${branding.brandName}.`,
    robots: { index: false, follow: false },
    alternates: { canonical: `${seo.siteUrl}/invite/decline` },
  };
}

export default async function DeclineInviteRoute({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const [branding, legal] = await Promise.all([getBrandingConfig(), getLegalConfig()]);
  const logoUrl = branding.logo?.imageUrl ?? null;

  return (
    <>
      <Nav siteName={branding.brandName} logoUrl={logoUrl} />
      <DeclineInviteClient code={typeof params.code === "string" ? params.code : ""} />
      <Footer siteName={branding.brandName} logoUrl={logoUrl} legal={legal} />
    </>
  );
}
