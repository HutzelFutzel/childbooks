import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy print pricing route: redirects to unified `/pricing` page.
 */
export default async function PrintPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string; plan?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.currency) params.set("currency", sp.currency);
  if (sp.plan) params.set("plan", sp.plan);
  const qs = params.toString();
  redirect(qs ? `/pricing?${qs}` : "/pricing");
}
