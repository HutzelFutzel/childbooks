import Link from "next/link";
import type { ReactNode } from "react";
import { isExternalHref } from "../../core/config/landingPages";

/**
 * A landing-page call-to-action. The `href` has already been sanitized by
 * `resolveCtaHref` (a same-site path or `https://`), so this only decides the
 * element: `next/link` for the site's own routes, a plain anchor for another
 * origin.
 *
 * `data-cta` is what the page's cookieless analytics counts as a conversion, so
 * an admin who points the button somewhere other than `/studio` still gets CTA
 * stats.
 */
export function LandingCta({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const classes = `lp-cta inline-flex items-center justify-center rounded-full px-7 py-3.5 text-base font-semibold ${className}`;
  if (isExternalHref(href)) {
    return (
      <a href={href} data-cta="" rel="noopener" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} data-cta="" className={classes}>
      {children}
    </Link>
  );
}
