"use client";

import { useEffect } from "react";
import { useAuthStore } from "../../state/authStore";

/**
 * Attaches the global Firebase auth listener for the whole app — not just
 * inside the Studio/Admin shells. Without this, marketing pages (landing,
 * blog, contact) never learn the real signed-in state, so a returning user
 * sees a generic "Sign in" button instead of their account. Mount this once,
 * near the root of the tree (see `app/layout.tsx`).
 *
 * `init()` is idempotent (guarded by `initialized` in the store), so it's
 * harmless that `StudioApp`/`AdminApp` also call it on mount.
 */
export function AuthInit() {
  const init = useAuthStore((s) => s.init);
  useEffect(() => {
    // The server-side renderer opens a private page here to photograph a book.
    // Signing in is the one thing it must NOT do: nobody is browsing, and a
    // guest-first init would mint (and leave behind) an anonymous account for
    // every book anyone renders. It authenticates with the render job's token.
    const path = window.location.pathname;
    if (path.startsWith("/internal/")) return;
    // On passive marketing pages, restore any existing session without minting
    // a new anonymous account on first page load. Entering `/studio` (or making
    // an authenticated backend request) upgrades to guest-first immediately.
    const autoGuest = path.startsWith("/studio");
    init({ autoGuest });
  }, [init]);
  return null;
}
