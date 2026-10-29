"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import {
  BookOpen,
  Calculator,
  ChevronDown,
  Cookie,
  CreditCard,
  Download,
  ExternalLink,
  Handshake,
  LogOut,
  Package,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import type { User } from "firebase/auth";
import { cn } from "../lib/cn";
import { endpaperLift } from "../lib/motion";
import { useAuthStore, userLabel, userSecondaryLine } from "../../state/authStore";
import { useOrdersStore } from "../../state/ordersStore";
import { unseenDownloadCount, useDownloadsStore } from "../../state/downloadsStore";
import { useConsentStore } from "../../state/consentStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSparksStore } from "../../state/sparksStore";
import { useSparksUiStore } from "../../state/sparksUiStore";
import { visibleLegalLinks } from "../../core/config/legal";
import { useImageActionRange } from "../layout/SparkCost";
import { Popover } from "./Popover";
import { Skeleton } from "./Skeleton";

/**
 * Shared building blocks and unified `EndpaperMenu` for the account dropdown,
 * used on both marketing pages (`surface="marketing"`) and workspace shells
 * (`surface="workspace"` in Studio, Account, and Admin).
 */

function initials(user: User | null): string {
  if (!user || user.isAnonymous) return "?";
  const name = user.displayName?.trim();
  if (name) {
    const chars = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
    if (chars) return chars;
  }
  return user.email?.[0]?.toUpperCase() ?? "?";
}

function shortFirstName(user: User | null): string {
  const full = userLabel(user);
  const first = full.trim().split(/\s+/)[0];
  return first || full;
}

/**
 * The user's photo when one exists (Google, etc.), otherwise their initials
 * on a warm coral bookplate badge.
 */
export function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user: User | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";

  if (user?.photoURL) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.photoURL}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(
          dim,
          "shrink-0 rounded-full object-cover ring-1 ring-ink-900/12",
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-display font-medium text-(--color-brand-foreground) [text-shadow:0_1px_1.5px_rgba(20,22,58,0.22)]",
        className,
      )}
    >
      {initials(user)}
    </span>
  );
}

/**
 * Closed trigger in the top margin: avatar + first name in Fredoka, with a
 * 6px coral dot when an order needs attention or a download is unseen.
 */
export function UserMenuTrigger({
  user,
  open,
  badge,
}: {
  user: User | null;
  open: boolean;
  /** Small 6px coral attention dot (order needs attention or unseen download). */
  badge?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors",
        open ? "bg-ink-900/[0.06] text-ink-900" : "text-ink-700 hover:bg-ink-900/[0.04] hover:text-ink-900",
      )}
    >
      <span className="relative flex">
        <UserAvatar user={user} size="sm" />
        {badge && (
          <span
            aria-label="Attention needed"
            className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-brand-600 ring-2 ring-canvas"
          />
        )}
      </span>
      <span className="hidden max-w-28 truncate font-display text-[13.5px] font-medium tracking-[-0.01em] sm:inline">
        {shortFirstName(user)}
      </span>
      <ChevronDown
        className={cn(
          "size-3.5 text-ink-400 transition-transform duration-200",
          open && "rotate-180 text-ink-700",
        )}
      />
    </span>
  );
}

/** Small uppercase caption above a group of related items ("Account", "Resources"). */
export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400">
      {children}
    </p>
  );
}

/**
 * Identity block at the top of the endpaper card. Name in Fredoka, email in
 * quiet ink underneath.
 */
export function MenuHeader({ user }: { user: User | null }) {
  const secondary = userSecondaryLine(user);
  return (
    <div className="flex items-center gap-3 border-b border-ink-900/[0.08] px-3.5 py-3">
      <UserAvatar user={user} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-semibold leading-snug text-ink-900">
          {user ? userLabel(user) : "Account"}
        </p>
        {secondary && <p className="truncate text-xs text-ink-500">{secondary}</p>}
      </div>
    </div>
  );
}

/**
 * Endpaper Sparks ledger block: the Sparks balance is the one large figure on
 * the card, rendered in violet (`text-magic-700`), with a crisp coral "Top up"
 * text action beside it.
 */
export function MenuSparksWallet({
  balance,
  loading,
  outOf,
  runningLow,
  onTopUp,
  onClose,
}: {
  balance: number;
  loading: boolean;
  outOf?: boolean;
  runningLow?: boolean;
  onTopUp?: () => void;
  onClose: () => void;
}) {
  const low = Boolean(outOf || runningLow);

  return (
    <div className="border-b border-ink-900/[0.08] px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href="/account/sparks"
          onClick={onClose}
          className="group min-w-0 flex-1 text-left"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400 transition-colors group-hover:text-ink-600">
            Sparks balance
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <Sparkles className="size-4 shrink-0 self-center text-magic-500" />
            {loading ? (
              <Skeleton className="h-6 w-14 self-center" rounded="full" />
            ) : (
              <span className="font-display text-2xl font-bold tabular-nums leading-none text-magic-700">
                {balance.toLocaleString()}
              </span>
            )}
            <span className="text-xs font-medium text-ink-500">Sparks</span>
          </div>
        </Link>

        {onTopUp ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onTopUp();
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-display text-xs font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <Plus className="size-3.5" />
            Top up
          </button>
        ) : (
          <Link
            href="/account/sparks"
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-display text-xs font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <Plus className="size-3.5" />
            Top up
          </Link>
        )}
      </div>

      {low && (
        <p className="mt-1.5 text-[11px] font-medium text-brand-700">
          {outOf
            ? "Out of Sparks — top up to keep illustrating."
            : "Running low for another page."}
        </p>
      )}
    </div>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-ink-900/[0.08]" />;
}

export interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** Renders as a link instead of a button. */
  href?: string;
  /** Opens `href` in a new tab (plain `<a>`) instead of an in-app `<Link>`. */
  openInNewTab?: boolean;
  /** Small icon shown at the trailing edge, e.g. an external-link glyph. */
  trailingIcon?: ReactNode;
  /** Small 6px coral attention dot on the leading icon. */
  badge?: boolean;
  /** Trailing count pill (e.g. unseen downloads). */
  count?: number;
  /**
   * `admin` gives the row a distinct Staff badge.
   * `danger` stays quiet ink at rest and turns danger-toned on hover/focus.
   */
  tone?: "default" | "danger" | "admin";
}

export function MenuItem({
  icon,
  label,
  onClick,
  href,
  openInNewTab,
  trailingIcon,
  badge,
  count,
  tone = "default",
}: MenuItemProps) {
  const isAdmin = tone === "admin";
  const isDanger = tone === "danger";
  const className = cn(
    "group/item flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] transition-colors",
    isDanger && "text-ink-600 hover:bg-rose-50/80 hover:text-rose-600 focus-visible:text-rose-600",
    tone === "default" && "text-ink-700 hover:bg-ink-900/[0.04] hover:text-ink-900",
    isAdmin && "font-semibold text-ink-900 hover:bg-ink-900/[0.04]",
  );

  const content = (
    <>
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center transition-colors",
          isAdmin
            ? "size-5 rounded-md bg-ink-900 text-canvas"
            : isDanger
              ? "size-4 text-ink-400 group-hover/item:text-rose-600"
              : "size-4 text-ink-400 group-hover/item:text-ink-700",
        )}
      >
        {icon}
        {badge && (
          <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-brand-600 ring-2 ring-canvas" />
        )}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {isAdmin && (
        <span className="rounded-full bg-ink-900/[0.07] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-600">
          Staff
        </span>
      )}
      {count != null && count > 0 && (
        <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
          {count}
        </span>
      )}
      {trailingIcon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-300 group-hover/item:text-ink-500">
          {trailingIcon}
        </span>
      )}
    </>
  );

  if (href) {
    if (openInNewTab) {
      return (
        <a role="menuitem" href={href} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
          {content}
        </a>
      );
    }
    return (
      <Link role="menuitem" href={href} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" role="menuitem" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

/**
 * The unified Endpaper account card used by both `AccountMenu` (marketing) and
 * `AuthMenu` (Studio, Account, Admin).
 *
 * Closed: avatar + first name + 6px coral dot when attention is needed.
 * Open: a cream paper card (`bg-canvas`) that drops from the top edge with a
 * subtle page-lift rotation (`endpaperLift`), crowned by a 3px coral band.
 */
export function EndpaperMenu({ surface }: { surface: "marketing" | "workspace" }) {
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  const sparksEnabled = useAppConfigStore((s) => s.sparks.enabled);
  const referralEnabled = useAppConfigStore((s) => s.referral.enabled);
  const legal = useAppConfigStore((s) => s.legal);
  const cookieEnabled = useAppConfigStore((s) => s.cookieConfig.enabled);
  const openCookiePreferences = useConsentStore((s) => s.openPreferences);

  const balance = useSparksStore((s) => s.balance);
  const balanceLoading = useSparksStore((s) => s.loading);
  const watchSparks = useSparksStore((s) => s.watch);
  const openWallet = useSparksUiStore((s) => s.openWallet);

  const ordersNeedAttention = useOrdersStore((s) =>
    s.orders.some((o) => o.stage === "onHold" || o.stage === "error"),
  );
  const unseenDownloads = useDownloadsStore((s) => unseenDownloadCount(s.downloads));
  const pageRange = useImageActionRange("pageIllustration");
  const pageEstimate = pageRange?.maxSparks ?? 0;

  const signedIn = Boolean(user) && !user?.isAnonymous;
  const isMarketing = surface === "marketing";
  const outOf = !balanceLoading && balance <= 0;
  const runningLow = !balanceLoading && !outOf && pageEstimate > 0 && balance < pageEstimate;
  const buttonBadge = ordersNeedAttention || unseenDownloads > 0;
  const legalLinks = visibleLegalLinks(legal, "footer");

  useEffect(() => {
    if (!ready || !signedIn || accessLevel === "loading") return;
    watchSparks();
  }, [ready, signedIn, accessLevel, watchSparks]);

  if (!ready) {
    return (
      <div
        className={cn(
          "h-8 w-20 animate-pulse rounded-full bg-ink-900/[0.06]",
          isMarketing && "hidden sm:block",
        )}
      />
    );
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={() => openAuthDialog()}
        className={cn(
          " items-center rounded-md px-2.5 py-1.5 font-display text-[14px] font-medium text-ink-700 transition-colors hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
          isMarketing ? "hidden sm:inline-flex" : "inline-flex",
        )}
      >
        Sign in
      </button>
    );
  }

  return (
    <div className={cn(isMarketing && "hidden sm:block")}>
      <Popover
        align="end"
        variants={endpaperLift}
        panelClassName="w-68 origin-top-right overflow-hidden rounded-xl border border-ink-900/12 bg-canvas p-0 shadow-lifted"
        trigger={(open) => <UserMenuTrigger user={user} open={open} badge={buttonBadge} />}
      >
        {(close) => (
          <div>
            {/* 3px coral endpaper head-band */}
            <div aria-hidden className="h-[3px] w-full bg-brand-600" />

            <MenuHeader user={user} />

            {sparksEnabled && accessLevel !== "loading" && (
              <MenuSparksWallet
                balance={balance}
                loading={balanceLoading}
                outOf={outOf}
                runningLow={runningLow}
                onTopUp={isMarketing ? undefined : () => openWallet()}
                onClose={close}
              />
            )}

            {isMarketing ? (
              <div className="py-1.5">
                <MenuItem
                  icon={<BookOpen className="size-4" />}
                  label="Open the Studio"
                  href="/studio"
                  onClick={close}
                />
                <MenuItem
                  icon={<Sparkles className="size-4" />}
                  label="Sparks wallet"
                  href="/account/sparks"
                  onClick={close}
                />
                <MenuItem
                  icon={<Settings className="size-4" />}
                  label="Account settings"
                  href="/account/settings"
                  onClick={close}
                />
                {ordersNeedAttention && (
                  <MenuItem
                    icon={<Package className="size-4" />}
                    label="Orders"
                    badge
                    href="/account/orders"
                    onClick={close}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="py-1">
                  <MenuSectionLabel>Account</MenuSectionLabel>
                  <MenuItem
                    icon={<Settings className="size-4" />}
                    label="Settings"
                    href="/account/settings"
                    onClick={close}
                  />
                  <MenuItem
                    icon={<Sparkles className="size-4" />}
                    label="Sparks"
                    href="/account/sparks"
                    onClick={close}
                  />
                  <MenuItem
                    icon={<CreditCard className="size-4" />}
                    label="Membership"
                    href="/account/membership"
                    onClick={close}
                  />
                  <MenuItem
                    icon={<Package className="size-4" />}
                    label="Orders"
                    badge={ordersNeedAttention}
                    href="/account/orders"
                    onClick={close}
                  />
                  <MenuItem
                    icon={<Download className="size-4" />}
                    label="Downloads"
                    badge={unseenDownloads > 0}
                    count={unseenDownloads}
                    href="/account/downloads"
                    onClick={close}
                  />
                  {referralEnabled && accessLevel !== "guest" && (
                    <MenuItem
                      icon={<Users className="size-4" />}
                      label="Invite friends"
                      href="/account/invites"
                      onClick={close}
                    />
                  )}
                </div>

                <MenuDivider />
                <div className="py-1">
                  <MenuSectionLabel>Resources</MenuSectionLabel>
                  <MenuItem
                    icon={<Calculator className="size-4" />}
                    label="Plans & pricing calculator"
                    href="/pricing"
                    openInNewTab
                    trailingIcon={<ExternalLink className="size-3.5" />}
                    onClick={close}
                  />
                  <MenuItem
                    icon={<BookOpen className="size-4" />}
                    label="Journal"
                    href="/blog"
                    openInNewTab
                    trailingIcon={<ExternalLink className="size-3.5" />}
                    onClick={close}
                  />
                  <MenuItem
                    icon={<Handshake className="size-4" />}
                    label="Affiliate program"
                    href="/affiliates"
                    openInNewTab
                    trailingIcon={<ExternalLink className="size-3.5" />}
                    onClick={close}
                  />
                  {legalLinks.map((l) => (
                    <MenuItem
                      key={l.id}
                      icon={<ExternalLink className="size-4" />}
                      label={l.label}
                      href={l.url}
                      openInNewTab
                      onClick={close}
                    />
                  ))}
                  {cookieEnabled && (
                    <MenuItem
                      icon={<Cookie className="size-4" />}
                      label="Cookie settings"
                      onClick={() => {
                        close();
                        openCookiePreferences();
                      }}
                    />
                  )}
                </div>
              </>
            )}

            {isAdmin && (
              <>
                <MenuDivider />
                <div className="py-1">
                  <MenuItem
                    icon={<Shield className="size-3" />}
                    label="Admin"
                    href="/admin"
                    tone="admin"
                    onClick={close}
                  />
                </div>
              </>
            )}

            <MenuDivider />
            <div className="py-1">
              <MenuItem
                icon={<LogOut className="size-4" />}
                label="Sign out"
                tone="danger"
                onClick={() => {
                  close();
                  void signOutUser();
                }}
              />
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
