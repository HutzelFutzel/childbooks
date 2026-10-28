"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Plus, Sparkles } from "lucide-react";
import type { User } from "firebase/auth";
import { cn } from "../lib/cn";
import { userLabel, userSecondaryLine } from "../../state/authStore";
import { Skeleton } from "./Skeleton";

/**
 * Shared building blocks for the account dropdown, used by both `ui/auth/AuthMenu`
 * (Studio/Admin chrome) and `ui/marketing/AccountMenu` (marketing chrome). Keeping
 * these in one place is what keeps the two menus visually in sync — previously
 * each reimplemented its own header/item markup and quietly drifted apart.
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

/** The user's photo when one exists (Google, etc.), otherwise their initials
 * on a brand gradient. A real face/mark reads far more "product" than a
 * generic person-outline icon everywhere identity shows up. */
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
        className={cn(dim, "shrink-0 rounded-full object-cover ring-1 ring-ink-100", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-(--color-brand-foreground)",
        className,
      )}
    >
      {initials(user)}
    </span>
  );
}

/**
 * The account-menu trigger — shared by `AuthMenu` (Studio/Admin) and
 * `AccountMenu` (marketing nav) so the control looks and behaves identically
 * everywhere it appears, right down to the pixel. Meant to be passed as
 * `Popover`'s `trigger` render-prop so the chevron can flip on open.
 */
export function UserMenuTrigger({
  user,
  open,
  badge,
}: {
  user: User | null;
  open: boolean;
  /** Small attention dot (e.g. an order needs a look, a download is unseen). */
  badge?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 transition-colors",
        open ? "bg-ink-100" : "hover:bg-ink-100",
      )}
    >
      <span className="relative flex">
        <UserAvatar user={user} size="sm" />
        {badge && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-white" />}
      </span>
      <span className="hidden max-w-32 truncate text-xs font-medium text-ink-700 sm:inline">{userLabel(user)}</span>
      <ChevronDown className={cn("size-3.5 text-ink-400 transition-transform", open && "rotate-180")} />
    </span>
  );
}

/** Small uppercase caption above a group of related items (e.g. "Account",
 * "Resources") — improves scannability once a menu has more than a
 * couple of groups, without repeating a group's own item labels. */
export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-300">{children}</p>
  );
}

/** Identity block at the top of an account dropdown. Shows the email under
 * the name only when it isn't already what the name line is showing — see
 * `userSecondaryLine`. */
export function MenuHeader({ user }: { user: User | null }) {
  const secondary = userSecondaryLine(user);
  return (
    <div className="flex items-center gap-2.5 border-b border-ink-100 px-3 py-3">
      <UserAvatar user={user} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-900">{user ? userLabel(user) : "Account"}</p>
        {secondary && <p className="truncate text-xs text-ink-400">{secondary}</p>}
      </div>
    </div>
  );
}

/**
 * Compact Sparks wallet card at the top of the user dropdown. Surfaces the live
 * balance, a low-balance warning when needed, a one-click "+ Top up" button to
 * buy packs in place, and a link to the full `/account/sparks` page.
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
    <div className="border-b border-ink-100 p-2">
      <div
        className={cn(
          "rounded-xl p-2.5 ring-1 ring-inset transition",
          low ? "bg-amber-50/85 ring-amber-200/80" : "bg-ink-50/70 ring-ink-200/60",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/account/sparks"
            onClick={onClose}
            className="group min-w-0 flex-1 text-left"
          >
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                low ? "text-amber-700" : "text-ink-400 group-hover:text-ink-600",
              )}
            >
              Sparks wallet
            </p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <Sparkles
                className={cn(
                  "size-4 shrink-0 self-center",
                  low ? "text-amber-600" : "text-magic-500",
                )}
              />
              {loading ? (
                <Skeleton className="h-5 w-12 self-center" rounded="full" />
              ) : (
                <span className="font-display text-lg font-bold tabular-nums leading-tight text-ink-900">
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
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-(--color-brand-foreground) shadow-2xs transition hover:bg-brand-700 active:scale-[0.98]"
            >
              <Plus className="size-3.5" />
              Top up
            </button>
          ) : (
            <Link
              href="/account/sparks"
              onClick={onClose}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-(--color-brand-foreground) shadow-2xs transition hover:bg-brand-700 active:scale-[0.98]"
            >
              <Plus className="size-3.5" />
              Top up
            </Link>
          )}
        </div>

        {outOf && (
          <p className="mt-1.5 text-[11px] font-medium text-amber-700">
            Out of Sparks — top up to keep illustrating.
          </p>
        )}
        {!outOf && runningLow && (
          <p className="mt-1.5 text-[11px] font-medium text-amber-700">
            Running low for another page.
          </p>
        )}

        <Link
          href="/account/sparks"
          onClick={onClose}
          className="mt-2 flex items-center justify-between border-t border-ink-900/[0.06] pt-1.5 text-[11px] font-medium text-ink-500 transition hover:text-ink-900"
        >
          <span>Wallet &amp; activity</span>
          <span aria-hidden className="text-ink-400">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-ink-100" />;
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
  /** Small attention dot on the leading icon. */
  badge?: boolean;
  /** Trailing count pill (e.g. unseen downloads). */
  count?: number;
  /**
   * `admin` gives the row a distinct, "different zone" treatment — a dark
   * icon chip, bold label and a "Staff" tag — so a privileged destination
   * never reads like just another feature link in the list.
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
  const className = cn(
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-ink-50",
    tone === "danger" && "text-rose-600",
    tone === "default" && "text-ink-700",
    isAdmin && "font-semibold text-ink-900",
  );

  const content = (
    <>
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center",
          isAdmin ? "size-5 rounded-md bg-ink-900 text-white" : "size-4 text-ink-400",
        )}
      >
        {icon}
        {badge && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {isAdmin && (
        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-500">
          Staff
        </span>
      )}
      {count != null && count > 0 && (
        <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
          {count}
        </span>
      )}
      {trailingIcon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-300">{trailingIcon}</span>
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
