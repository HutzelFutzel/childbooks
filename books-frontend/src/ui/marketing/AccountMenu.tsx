"use client";

import { useEffect } from "react";
import { BookOpen, LogOut, Settings, Shield, Sparkles } from "lucide-react";
import { useAuthStore } from "../../state/authStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSparksStore } from "../../state/sparksStore";
import { Button } from "../components/Button";
import { Popover } from "../components/Popover";
import { MenuDivider, MenuHeader, MenuItem, MenuSparksWallet, UserMenuTrigger } from "../components/UserMenu";

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
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const sparksEnabled = useAppConfigStore((s) => s.sparks.enabled);
  const balance = useSparksStore((s) => s.balance);
  const balanceLoading = useSparksStore((s) => s.loading);
  const watchSparks = useSparksStore((s) => s.watch);

  const signedIn = Boolean(user) && !user?.isAnonymous;

  useEffect(() => {
    if (!ready || !signedIn || accessLevel === "loading") return;
    watchSparks();
  }, [ready, signedIn, accessLevel, watchSparks]);

  if (!ready) {
    return <div className="hidden h-9 w-20 animate-pulse rounded-xl bg-ink-100 sm:block" />;
  }

  if (!signedIn) {
    return (
      <Button variant="secondary" size="sm" className="hidden sm:inline-flex" onClick={() => openAuthDialog()}>
        Sign in
      </Button>
    );
  }

  return (
    <div className="hidden sm:block">
      <Popover
        align="end"
        panelClassName="w-64 overflow-hidden p-0"
        trigger={(open) => <UserMenuTrigger user={user} open={open} />}
      >
        {(close) => (
          <>
            <MenuHeader user={user} />
            {sparksEnabled && accessLevel !== "loading" && (
              <MenuSparksWallet
                balance={balance}
                loading={balanceLoading}
                onClose={close}
              />
            )}
            <div className="py-1">
              <MenuItem icon={<BookOpen className="size-4" />} label="Open the Studio" href="/studio" onClick={close} />
              <MenuItem icon={<Sparkles className="size-4" />} label="Sparks" href="/account/sparks" onClick={close} />
              <MenuItem icon={<Settings className="size-4" />} label="Account settings" href="/account/settings" onClick={close} />
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
