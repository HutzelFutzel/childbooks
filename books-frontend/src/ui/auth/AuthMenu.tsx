"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CreditCard,
  LogOut,
  Package,
  Settings,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { useAuthStore, userLabel } from "../../state/authStore";
import { useAccountUiStore } from "../../state/accountUiStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useOrdersStore } from "../../state/ordersStore";
import { Button } from "../components/Button";

function MenuItem({
  icon,
  label,
  onClick,
  badge,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-ink-50 " +
        (danger ? "text-rose-600" : "text-ink-700")
      }
    >
      <span className="relative flex size-4 items-center justify-center text-ink-400">
        {icon}
        {badge && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
        )}
      </span>
      {label}
    </button>
  );
}

/**
 * The account dropdown — the single home for user actions that used to clutter
 * the top bar: Settings (image quality + account), Plans, Orders, Admin, and
 * Sign out. Signed-out users just get a "Sign in" button.
 */
export function AuthMenu() {
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const openSettings = useAccountUiStore((s) => s.openSettings);
  const openOrders = useAccountUiStore((s) => s.openOrders);
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const ordersNeedAttention = useOrdersStore((s) =>
    s.orders.some((o) => o.stage === "onHold" || o.stage === "error"),
  );
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
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
    return <div className="h-8 w-24 animate-pulse rounded-lg bg-ink-100" />;
  }

  const signedIn = Boolean(user) && !user?.isAnonymous;

  if (!signedIn) {
    return (
      <Button variant="secondary" size="sm" onClick={openAuthDialog}>
        Sign in
      </Button>
    );
  }

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-200"
      >
        <span className="relative flex size-4 items-center justify-center">
          <UserIcon className="size-3.5" />
          {ordersNeedAttention && (
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
          )}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{user ? userLabel(user) : "Account"}</span>
        <ChevronDown className={"size-3.5 transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-ink-100"
        >
          <div className="border-b border-ink-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-800">{user ? userLabel(user) : "Account"}</p>
            {user?.email && <p className="truncate text-xs text-ink-400">{user.email}</p>}
          </div>
          <MenuItem icon={<Settings className="size-4" />} label="Settings" onClick={() => run(openSettings)} />
          <MenuItem icon={<CreditCard className="size-4" />} label="Plans" onClick={() => run(openPlans)} />
          <MenuItem
            icon={<Package className="size-4" />}
            label="Orders"
            badge={ordersNeedAttention}
            onClick={() => run(openOrders)}
          />
          {isAdmin && (
            <MenuItem icon={<Shield className="size-4" />} label="Admin" onClick={() => run(() => router.push("/admin"))} />
          )}
          <div className="my-1 border-t border-ink-100" />
          <MenuItem
            icon={<LogOut className="size-4" />}
            label="Sign out"
            danger
            onClick={() => run(() => void signOutUser())}
          />
        </div>
      )}
    </div>
  );
}
