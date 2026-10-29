"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  BookOpen,
  Loader2,
  LogOut,
  Menu,
  Settings,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";
import { isDev } from "../../platform/runtime";
import { useAuthStore, userLabel, userSecondaryLine } from "../../state/authStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSparksStore } from "../../state/sparksStore";
import { BrandMark } from "../layout/BrandMark";
import { DEV_BANNER_HEIGHT_REM } from "../layout/DevEnvironmentBanner";
import { UserAvatar } from "../components/UserMenu";
import { AccountMenu } from "./AccountMenu";

const AuthDialog = dynamic(
  () => import("../auth/AuthDialog").then((m) => m.AuthDialog),
  { ssr: false },
);
const GuestMigrationDialog = dynamic(
  () => import("../auth/GuestMigrationDialog").then((m) => m.GuestMigrationDialog),
  { ssr: false },
);

// `DevEnvironmentBanner` scrolls away with the page, so once it's out of view
// this header slides up from `top-6` to `top-0` to close the gap.
const DEV_BANNER_HEIGHT_PX = DEV_BANNER_HEIGHT_REM * 16;

// Three focused top-margin destinations. Secondary anchors (Features, FAQ,
// Contact, Legal) live on the page and in the Footer / mobile Table of Contents.
const MARGIN_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Journal" },
] as const;

const MOBILE_SECONDARY_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
] as const;

function linkIsActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/pricing") {
    return pathname === "/pricing" || pathname.startsWith("/print-pricing");
  }
  if (href === "/blog") {
    return pathname === "/blog" || pathname.startsWith("/blog/");
  }
  return false;
}

/**
 * Marketing header styled as the top margin of a printed picture book:
 * - A 1px ink baseline across the full width (transparent over the hero until
 *   scrolled, then warm cream paper `#fdfbf7`).
 * - Three links in `Fredoka` with a moving 2×20px coral underline stroke.
 * - A physical coral bookmark ribbon for "Open the Studio" that hangs 10px
 *   below the baseline on `md+` and eases down 4px on hover.
 * - A full-height "Table of Contents" sheet on mobile with the account card
 *   pinned to the foot.
 */
export function Nav({ siteName, logoUrl }: { siteName: string; logoUrl?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [openingStudio, startStudioTransition] = useTransition();
  const [scrolled, setScrolled] = useState(false);
  const [pastDevBanner, setPastDevBanner] = useState(false);
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const authReady = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const dialogOpen = useAuthStore((s) => s.dialogOpen);
  const pendingMigration = useAuthStore((s) => s.pendingMigration);
  const signedIn = authReady && Boolean(user) && !user?.isAnonymous;
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const signOutUser = useAuthStore((s) => s.signOutUser);

  const sparksEnabled = useAppConfigStore((s) => s.sparks.enabled);
  const balance = useSparksStore((s) => s.balance);
  const balanceLoading = useSparksStore((s) => s.loading);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      setPastDevBanner(window.scrollY >= DEV_BANNER_HEIGHT_PX);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onResize = () => {
      if (window.innerWidth >= 768) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const activeHref =
    MARGIN_LINKS.find((l) => linkIsActive(pathname, l.href))?.href ?? null;
  const strokeTargetHref = hoveredHref ?? activeHref;

  const handleOpenStudio = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setMenuOpen(false);
    startStudioTransition(() => {
      router.push("/studio");
    });
  };

  return (
    <MotionConfig reducedMotion="user">
      <header
        className={cn(
          "fixed inset-x-0 z-50 transition-[top,background-color,box-shadow] duration-200",
          isDev() && !pastDevBanner ? "top-6" : "top-0",
          scrolled || menuOpen
            ? "bg-canvas/96 shadow-[0_6px_20px_-14px_rgba(20,22,58,0.12)]"
            : "bg-transparent",
        )}
      >
        <nav
          aria-label="Primary"
          className="mx-auto flex h-17 max-w-6xl items-center justify-between px-5 sm:px-6"
        >
          {/* Wordmark / Publisher Imprint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.12 }}
            className="flex shrink-0 items-center"
          >
            <BrandMark
              siteName={siteName}
              logoUrl={logoUrl}
              onClick={() => setMenuOpen(false)}
            />
          </motion.div>

          {/* Three editorial margin links with moving coral stroke */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.22 }}
            onMouseLeave={() => setHoveredHref(null)}
            className="hidden items-center gap-8 md:flex"
          >
            {MARGIN_LINKS.map((l) => {
              const active = linkIsActive(pathname, l.href);
              const showStroke = strokeTargetHref === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={() => setHoveredHref(l.href)}
                  onFocus={() => setHoveredHref(l.href)}
                  className={cn(
                    "relative py-2 font-display text-[15px] font-medium tracking-[-0.01em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-900",
                    active || showStroke ? "text-ink-900" : "text-ink-600 hover:text-ink-900",
                  )}
                >
                  <span>{l.label}</span>
                  {showStroke && (
                    <motion.span
                      layoutId="marketing-nav-stroke"
                      transition={{ type: "spring", stiffness: 420, damping: 30 }}
                      className="pointer-events-none absolute bottom-0.5 left-0 h-[2px] w-5 rounded-full bg-brand-600"
                    />
                  )}
                </Link>
              );
            })}
          </motion.div>

          {/* Right cluster: Endpaper account menu + Hanging Coral Bookmark */}
          <div className="flex h-full items-center gap-2.5 sm:gap-3.5">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.28 }}
              className="flex items-center"
            >
              <AccountMenu />
            </motion.div>

            {/* Desktop Hanging Coral Bookmark: breaks the baseline by 10px */}
            <motion.div
              initial={{ y: -14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 24,
                delay: 0.34,
              }}
              className="relative hidden h-full items-start md:flex"
            >
              <Link
                href="/studio"
                onClick={handleOpenStudio}
                aria-busy={openingStudio}
                className={cn(
                  "group/ribbon relative z-10 -mb-2.5 flex h-[calc(100%+10px)] items-center gap-2 bg-brand-600 px-4 pt-1 pb-2.5 font-display text-[14px] font-medium tracking-[0.005em] text-(--color-brand-foreground) [text-shadow:0_1px_1.5px_rgba(20,22,58,0.22)] shadow-soft transition-transform duration-200 ease-out",
                  "hover:translate-y-1 hover:bg-brand-700 focus-visible:translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900 motion-reduce:hover:translate-y-0",
                  "[clip-path:polygon(0_0,100%_0,100%_100%,50%_calc(100%-7px),0_100%)]",
                )}
              >
                {/* Fine vertical ribbon stitch lines */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1.5 top-0 bottom-2 border-x border-white/18"
                />
                {openingStudio && <Loader2 className="size-3.5 animate-spin" />}
                <span>{openingStudio ? "Opening Studio…" : "Open the Studio"}</span>
              </Link>
            </motion.div>

            {/* Mobile compact coral tab: stays inside the bar height so it never covers hero copy */}
            <Link
              href="/studio"
              onClick={handleOpenStudio}
              aria-busy={openingStudio}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 font-display text-[13.5px] font-medium tracking-[0.005em] text-(--color-brand-foreground) [text-shadow:0_1px_1.5px_rgba(20,22,58,0.22)] shadow-2xs transition hover:bg-brand-700 md:hidden"
            >
              {openingStudio && <Loader2 className="size-3.5 animate-spin" />}
              <span className="sm:hidden">{openingStudio ? "Opening…" : "Studio"}</span>
              <span className="hidden sm:inline">
                {openingStudio ? "Opening Studio…" : "Open the Studio"}
              </span>
            </Link>

            {/* Mobile Table of Contents trigger (44x44px touch target) */}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              aria-label={menuOpen ? "Close contents" : "Open contents"}
              className="-mr-1.5 inline-flex size-11 items-center justify-center rounded-lg text-ink-700 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-ink-900 md:hidden"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </nav>

        {/* Full-width 1px ink typesetter's hairline */}
        <motion.div
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "h-px w-full origin-left transition-colors duration-200",
            scrolled || menuOpen ? "bg-ink-900/12" : "bg-ink-900/[0.07]",
          )}
        />

        {/* Mobile Table of Contents Sheet (< md) */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              id="mobile-nav-menu"
              role="dialog"
              aria-label="Site contents"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "fixed inset-x-0 bottom-0 z-40 flex flex-col justify-between overflow-y-auto border-t border-ink-900/10 bg-canvas px-6 pt-6 pb-8 md:hidden",
                isDev() && !pastDevBanner ? "top-[5.75rem]" : "top-[4.25rem]",
              )}
            >
              {/* Primary Table of Contents */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                  Contents
                </p>
                <nav aria-label="Mobile contents" className="mt-3 flex flex-col">
                  {MARGIN_LINKS.map((l) => {
                    const active = linkIsActive(pathname, l.href);
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setMenuOpen(false)}
                        className="group flex items-baseline gap-3 py-3.5 text-ink-900"
                      >
                        <span
                          className={cn(
                            "font-display text-2xl font-semibold tracking-tight transition-colors group-hover:text-brand-600",
                            active && "text-brand-600",
                          )}
                        >
                          {l.label}
                        </span>
                        <span
                          aria-hidden
                          className="mx-1 flex-1 border-b border-dotted border-ink-900/18"
                        />
                        <span className="font-display text-xs font-medium text-ink-400 group-hover:text-brand-600">
                          →
                        </span>
                      </Link>
                    );
                  })}
                </nav>

                {/* Secondary index row so FAQ/Features/Contact stay reachable on phones */}
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-900/[0.08] pt-4">
                  {MOBILE_SECONDARY_LINKS.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMenuOpen(false)}
                      className="py-1 font-display text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Endpaper Account Card pinned to the bottom of the mobile sheet */}
              <div className="mt-8 overflow-hidden rounded-xl border border-ink-900/12 bg-white/70 shadow-soft">
                <div aria-hidden className="h-[3px] w-full bg-brand-600" />
                {signedIn ? (
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <UserAvatar user={user} />
                        <div className="min-w-0">
                          <p className="truncate font-display text-sm font-semibold text-ink-900">
                            {userLabel(user)}
                          </p>
                          {userSecondaryLine(user) && (
                            <p className="truncate text-xs text-ink-500">
                              {userSecondaryLine(user)}
                            </p>
                          )}
                        </div>
                      </div>
                      {sparksEnabled && accessLevel !== "loading" && (
                        <Link
                          href="/account/sparks"
                          onClick={() => setMenuOpen(false)}
                          className="flex shrink-0 items-baseline gap-1 rounded-lg bg-magic-100/60 px-2.5 py-1"
                        >
                          <Sparkles className="size-3.5 self-center text-magic-500" />
                          <span className="font-display text-base font-bold tabular-nums text-magic-700">
                            {balanceLoading ? "…" : balance.toLocaleString()}
                          </span>
                          <span className="text-[11px] font-medium text-ink-500">Sparks</span>
                        </Link>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-ink-900/[0.08] pt-3">
                      <Link
                        href="/account/sparks"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-ink-700 transition hover:bg-ink-900/[0.04]"
                      >
                        <Sparkles className="size-3.5 text-magic-500" /> Sparks wallet
                      </Link>
                      <Link
                        href="/account/settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-ink-700 transition hover:bg-ink-900/[0.04]"
                      >
                        <Settings className="size-3.5 text-ink-400" /> Settings
                      </Link>
                      {isAdmin && (
                        <Link
                          href="/admin"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-ink-900 transition hover:bg-ink-900/[0.04]"
                        >
                          <Shield className="size-3.5 text-ink-700" /> Admin
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void signOutUser();
                        }}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-ink-600 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <LogOut className="size-3.5" /> Sign out
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-display text-sm font-semibold text-ink-900">
                        Have a library already?
                      </p>
                      <p className="text-xs text-ink-500">
                        Sign in to open your saved books and Sparks.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        openAuthDialog();
                      }}
                      className="shrink-0 rounded-lg border border-ink-900/15 bg-canvas px-3.5 py-2 font-display text-xs font-semibold text-ink-900 transition hover:bg-ink-900/[0.04]"
                    >
                      Sign in
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Mounted here so "Sign in" opens in place on every marketing page. */}
      {dialogOpen && <AuthDialog />}
      {pendingMigration && <GuestMigrationDialog />}
    </MotionConfig>
  );
}
