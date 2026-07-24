"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  Cookie,
  CreditCard,
  Download,
  ExternalLink,
  LifeBuoy,
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
import { unseenDownloadCount, useDownloadsStore } from "../../state/downloadsStore";
import { useSupportUiStore } from "../../state/supportUiStore";
import { useConsentStore } from "../../state/consentStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { visibleLegalLinks } from "../../core/config/legal";
import { Button } from "../components/Button";

function MenuItem({
  icon,
  label,
  onClick,
  badge,
  count,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: boolean;
  /** Optional count pill shown at the trailing edge (e.g. new downloads). */
  count?: number;
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
      <span className="flex-1">{label}</span>
      {count != null && count > 0 && (
        <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
          {count}
        </span>
      )}
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
  const openDownloads = useAccountUiStore((s) => s.openDownloads);
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const openContact = useSupportUiStore((s) => s.openContact);
  const openCookiePreferences = useConsentStore((s) => s.openPreferences);
  const legal = useAppConfigStore((s) => s.legal);
  const cookieEnabled = useAppConfigStore((s) => s.cookieConfig.enabled);
  const legalLinks = visibleLegalLinks(legal, "footer");
  const ordersNeedAttention = useOrdersStore((s) =>
    s.orders.some((o) => o.stage === "onHold" || o.stage === "error"),
  );
  const unseenDownloads = useDownloadsStore((s) => unseenDownloadCount(s.downloads));
  const router = useRouter();

  // Anything on the account button worth a nudge: an order needing attention or
  // a freshly-delivered download the user hasn't opened the list to see yet.
  const buttonBadge = ordersNeedAttention || unseenDownloads > 0;

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
          {buttonBadge && (
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
          )}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{user ? userLabel(user) : "Account"}</span>
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
          <MenuItem
            icon={<Download className="size-4" />}
            label="Downloads"
            badge={unseenDownloads > 0}
            count={unseenDownloads}
            onClick={() => run(openDownloads)}
          />
          {isAdmin && (
            <MenuItem icon={<Shield className="size-4" />} label="Admin" onClick={() => run(() => router.push("/admin"))} />
          )}

          <div className="my-1 border-t border-ink-100" />
          <a
            role="menuitem"
            href="/blog"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-50"
          >
            <span className="flex size-4 items-center justify-center text-ink-400">
              <BookOpen className="size-4" />
            </span>
            <span className="flex-1">Blog</span>
            <span className="flex size-4 items-center justify-center text-ink-300">
              <ExternalLink className="size-3.5" />
            </span>
          </a>
          <MenuItem icon={<LifeBuoy className="size-4" />} label="Contact us" onClick={() => run(openContact)} />
          {legalLinks.map((l) => (
            <a
              key={l.id}
              role="menuitem"
              href={l.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-50"
            >
              <span className="flex size-4 items-center justify-center text-ink-400">
                <ExternalLink className="size-3.5" />
              </span>
              <span className="flex-1">{l.label}</span>
            </a>
          ))}
          {cookieEnabled && (
            <MenuItem
              icon={<Cookie className="size-4" />}
              label="Cookie settings"
              onClick={() => run(openCookiePreferences)}
            />
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
