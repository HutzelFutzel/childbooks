"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import { isDev } from "../../platform/runtime";
import { AccountMenu } from "./AccountMenu";
import { AuthDialog } from "../auth/AuthDialog";
import { GuestMigrationDialog } from "../auth/GuestMigrationDialog";
import { DEV_BANNER_HEIGHT_REM } from "../layout/DevEnvironmentBanner";

// `DevEnvironmentBanner` scrolls away with the page (see its own comment for
// why it can't just be `sticky`), so once it's out of view this header slides
// up from `top-6` to `top-0` to close the gap instead of leaving it behind.
// Assumes the root font-size is never overridden (it isn't, anywhere in this
// app), so 1rem is always 16px.
const DEV_BANNER_HEIGHT_PX = DEV_BANNER_HEIGHT_REM * 16;

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
  const [pastDevBanner, setPastDevBanner] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      setPastDevBanner(window.scrollY >= DEV_BANNER_HEIGHT_PX);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 z-50 transition-[top,background-color,border-color] duration-200",
          // Parked at `top-6`, under the dev-environment banner, until it's
          // scrolled out of view — then slides up to `top-0` to close the gap
          // it leaves behind. See ui/layout/DevEnvironmentBanner.
          isDev() && !pastDevBanner ? "top-6" : "top-0",
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
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100/70 hover:text-ink-900"
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Reflects the real signed-in state (incl. admin) — see AccountMenu. */}
            <AccountMenu />
            <Link
              href="/studio"
              className="inline-flex items-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-(--color-brand-foreground) shadow-soft transition hover:bg-brand-700"
            >
              Open the Studio
            </Link>
          </div>
        </nav>
      </header>

      {/* Mounted here so "Sign in" opens in place on every marketing page,
          instead of round-tripping through /studio just to see a sign-in form. */}
      <AuthDialog />
      <GuestMigrationDialog />
    </>
  );
}
