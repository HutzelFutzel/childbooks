"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Shield, LogOut, Settings, Sparkles, X } from "lucide-react";
import { cn } from "../lib/cn";
import { isDev } from "../../platform/runtime";
import { useAuthStore } from "../../state/authStore";
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
  { href: "/print-pricing", label: "Print costs" },
  { href: "/blog", label: "Blog" },
  { href: "/#faq", label: "FAQ" },
];

/** Sticky top navigation that gains a solid, blurred background once scrolled. */
export function Nav({ siteName, logoUrl }: { siteName: string; logoUrl?: string | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [pastDevBanner, setPastDevBanner] = useState(false);
  // Below `md` the link row (and below `sm`, `AccountMenu` too) hides into
  // this drawer instead — otherwise a mobile visitor has no way to reach
  // "How it works" / "Pricing" / the blog etc, or to sign in, at all.
  const [menuOpen, setMenuOpen] = useState(false);

  const authReady = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signedIn = authReady && Boolean(user) && !user?.isAnonymous;
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const signOutUser = useAuthStore((s) => s.signOutUser);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      setPastDevBanner(window.scrollY >= DEV_BANNER_HEIGHT_PX);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A resize back past `md` (e.g. rotating a tablet) reveals the desktop nav
  // underneath — close the drawer so it doesn't linger open behind it.
  useEffect(() => {
    if (!menuOpen) return;
    const onResize = () => {
      if (window.innerWidth >= 768) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [menuOpen]);

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
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="-mr-1 inline-flex size-9 items-center justify-center rounded-lg text-ink-600 transition hover:bg-ink-100/70 md:hidden"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </nav>

        {/* Mobile drawer: the link row is `md:hidden`, and `AccountMenu` is
            itself `sm:hidden`-gated, so below those breakpoints this is the
            only way to reach navigation and sign-in at all. */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              id="mobile-nav-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden border-b border-ink-100 bg-canvas/95 backdrop-blur-md md:hidden"
            >
              <nav className="flex flex-col gap-1 px-6 py-3">
                {LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/70 hover:text-ink-900"
                  >
                    {l.label}
                  </Link>
                ))}

                {/* Account access — only needed here while `AccountMenu` is
                    hidden (below `sm`); above that it's already in the header. */}
                <div className="mt-1 flex flex-col gap-1 border-t border-ink-100 pt-2 sm:hidden">
                  {signedIn ? (
                    <>
                      <Link
                        href="/account/settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/70"
                      >
                        <Settings className="size-4" /> Account settings
                      </Link>
                      {isAdmin && (
                        <Link
                          href="/admin"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/70"
                        >
                          <Shield className="size-4" /> Admin
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void signOutUser();
                        }}
                        className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                      >
                        <LogOut className="size-4" /> Sign out
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        openAuthDialog();
                      }}
                      className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/70"
                    >
                      Sign in
                    </button>
                  )}
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Mounted here so "Sign in" opens in place on every marketing page,
          instead of round-tripping through /studio just to see a sign-in form. */}
      <AuthDialog />
      <GuestMigrationDialog />
    </>
  );
}
