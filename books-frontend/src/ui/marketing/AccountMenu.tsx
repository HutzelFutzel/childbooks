"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, LogOut, Shield, User as UserIcon } from "lucide-react";
import { useAuthStore, userLabel } from "../../state/authStore";

/**
 * Compact account control for the marketing chrome (landing, blog, contact) —
 * the counterpart to `ui/auth/AuthMenu` used inside the Studio/Admin shells.
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

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — mirrors `ui/auth/AuthMenu`.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <UserIcon className="size-4" />
        <span className="max-w-32 truncate">{userLabel(user)}</span>
        <ChevronDown className={"size-3.5 transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-ink-100"
        >
          <div className="border-b border-ink-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-800">{userLabel(user)}</p>
            {user?.email && <p className="truncate text-xs text-ink-400">{user.email}</p>}
          </div>
          <Link
            href="/studio"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-50"
          >
            <BookOpen className="size-4 text-ink-400" />
            Open the Studio
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-50"
            >
              <Shield className="size-4 text-ink-400" />
              Admin
            </Link>
          )}
          <div className="my-1 border-t border-ink-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(() => void signOutUser())}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-ink-50"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
