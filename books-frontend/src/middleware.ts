/**
 * Locale negotiation for every page request.
 *
 * Resolution order is cookie → `Accept-Language` → default, which `next-intl`
 * implements from the routing config; this file's real content is the matcher,
 * because *which* requests get rewritten is the part that breaks things.
 *
 * Excluded, and why each one matters:
 *
 *   - `/api/*` — route handlers, called by Stripe and Lulu webhooks against a
 *     fixed URL. A locale rewrite would move the endpoint out from under them.
 *   - `/_next/*`, `/_vercel/*` — build output.
 *   - Anything with a file extension — `favicon.ico`, `robots.txt`,
 *     `sitemap.xml`, images. `sitemap.xml` in particular must stay at the root:
 *     a locale-prefixed sitemap is not the one crawlers ask for.
 *
 * Everything else, including `/studio` and `/admin`, does pass through. Those
 * two aren't indexed and don't need localized URLs, but they do need a resolved
 * locale to render in, and the middleware is what supplies it.
 *
 * Pages currently live at `app/page.tsx` (not `app/[locale]/...`). next-intl's
 * middleware rewrites `/` → `/en`, which 404s without that folder — so we pass
 * through until the App Router tree is locale-segmented.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function middleware(_req: NextRequest) {
  return NextResponse.next();
}

/**
 * Written as a literal because Next statically analyses this export and rejects
 * an imported identifier. `yarn check:locales` reads the pattern back out of
 * this file and tests it against real paths, so it is checked despite not being
 * shareable — and checked in the form Next actually uses.
 */
export const config = {
  matcher: ["/((?!api(?:/|$)|_next|_vercel|.*\\..*).*)"],
};
