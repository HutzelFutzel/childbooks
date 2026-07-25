"use client";

import { ChevronDown, BookOpen, LogOut, Shield } from "lucide-react";
import { useAuthStore, userLabel } from "../../state/authStore";
import { Popover } from "../components/Popover";
import { MenuDivider, MenuHeader, MenuItem, UserAvatar } from "../components/UserMenu";
import { cn } from "../lib/cn";

/**
 * Compact account control for the marketing chrome (landing, blog, contact) —
 * the counterpart to `ui/auth/AuthMenu` used inside the Studio/Admin shells.
 * Both share their header/item building blocks (`ui/components/UserMenu`) so
 * the two stay visually and behaviorally in sync.
 *
 * Marketing pages don't mount the Studio/Admin-only dialogs (Settings, Orders,
 * Plans, Downloads), so this intentionally only offers what's safe to act on
 * from here: jump into the Studio, jump into Admin (if the account is an
 * admin), and sign out. Everything else lives in the full `AuthMenu`.
 *
 * This is what makes a signed-in visitor's status visible on marketing pages
 * at all — previously `Nav` was fully static and always showed "Sign in",
 * even for someone already signed in (or an admin, with no way to reach
 * `/admin` short of typing the URL).
 */
export function AccountMenu() {
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);

  if (!ready) {
    return <div className="hidden h-9 w-20 animate-pulse rounded-xl bg-ink-100 sm:block" />;
  }

  const signedIn = Boolean(user) && !user?.isAnonymous;

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={() => openAuthDialog()}
        className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-ink-700 transition-colors hover:text-ink-900 sm:inline-flex"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="hidden sm:block">
      <Popover
        align="end"
        panelClassName="w-64 overflow-hidden p-0"
        trigger={(open) => (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-xl py-1.5 pl-1.5 pr-3 transition-colors",
              open ? "bg-ink-100" : "hover:bg-ink-100",
            )}
          >
            <UserAvatar user={user} size="sm" />
            <span className="max-w-32 truncate text-sm font-medium text-ink-700">{userLabel(user)}</span>
            <ChevronDown className={cn("size-3.5 text-ink-400 transition-transform", open && "rotate-180")} />
          </span>
        )}
      >
        {(close) => (
          <>
            <MenuHeader user={user} />
            <div className="py-1">
              <MenuItem icon={<BookOpen className="size-4" />} label="Open the Studio" href="/studio" onClick={close} />
            </div>

            {isAdmin && (
              <>
                <MenuDivider />
                <div className="py-1">
                  <MenuItem icon={<Shield className="size-3" />} label="Admin" href="/admin" tone="admin" onClick={close} />
                </div>
              </>
            )}

            <MenuDivider />
            <div className="py-1">
              <MenuItem
                icon={<LogOut className="size-4" />}
                label="Sign out"
                tone="danger"
                onClick={() => { close(); void signOutUser(); }}
              />
            </div>
          </>
        )}
      </Popover>
    </div>
  );
}
