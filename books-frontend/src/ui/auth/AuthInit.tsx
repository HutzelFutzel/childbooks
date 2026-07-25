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
    init();
  }, [init]);
  return null;
}
