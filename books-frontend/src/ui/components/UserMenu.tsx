"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { User } from "firebase/auth";
import { cn } from "../lib/cn";
import { userLabel, userSecondaryLine } from "../../state/authStore";

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
