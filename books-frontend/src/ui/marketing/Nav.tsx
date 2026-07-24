"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/cn";

// Root-relative hashes so these work from any route (e.g. /contact), not just
// the landing page: they navigate to `/` and scroll to the section.
const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/#faq", label: "FAQ" },
];

/** Sticky top navigation that gains a solid, blurred background once scrolled. */
export function Nav({ siteName, logoUrl }: { siteName: string; logoUrl?: string | null }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors",
        scrolled
          ? "border-b border-ink-100 bg-canvas/80 backdrop-blur"
          : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-ink-900" aria-label={siteName}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={siteName} className="h-8 w-auto" />
          ) : (
            <>
              <span className="flex size-8 items-center justify-center rounded-xl bg-brand-600 text-(--color-brand-foreground) shadow-soft">
                <Sparkles className="size-4.5" />
              </span>
              {siteName}
            </>
          )}
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/studio"
            className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-ink-700 transition-colors hover:text-ink-900 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/studio"
            className="inline-flex items-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
          >
            Open the Studio
          </Link>
        </div>
      </nav>
    </header>
  );
}
