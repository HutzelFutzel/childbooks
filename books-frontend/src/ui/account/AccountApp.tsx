"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CreditCard,
  Download,
  Loader2,
  Package,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { useDownloadsStore } from "../../state/downloadsStore";
import { useOrdersStore } from "../../state/ordersStore";
import { usePaymentsStore } from "../../state/paymentsStore";
import { useProfileStore } from "../../state/profileStore";
import { useSparksStore } from "../../state/sparksStore";
import { useSubscriptionStore } from "../../state/subscriptionStore";
import { AuthDialog } from "../auth/AuthDialog";
import { AuthMenu } from "../auth/AuthMenu";
import { PlansContent } from "../billing/PlansDialog";
import { Button } from "../components/Button";
import { Toaster } from "../components/Toaster";
import { PurchaseConfirmation } from "../checkout/PurchaseConfirmation";
import { DownloadsContent } from "../checkout/DownloadsDialog";
import { OrdersContent } from "../checkout/OrdersDialog";
import { HelpButton } from "../contact/HelpButton";
import { TopBar } from "../layout/TopBar";
import { InviteFriendsContent } from "../referrals/InviteFriendsDialog";
import { SettingsContent } from "../settings/SettingsDialog";
import { cn } from "../lib/cn";
import { SparksAccountContent } from "./SparksAccountContent";

type AccountSection = "settings" | "sparks" | "membership" | "orders" | "downloads" | "invites";

interface AccountNavItem {
  id: AccountSection;
  label: string;
  description: string;
  icon: React.ReactNode;
  fullAccountOnly?: boolean;
  referralOnly?: boolean;
}

const ACCOUNT_NAV: AccountNavItem[] = [
  {
    id: "settings",
    label: "Settings",
    description: "Your account and creative preferences.",
    icon: <Settings className="size-4" />,
  },
  {
    id: "sparks",
    label: "Sparks",
    description: "Balance, top-ups and activity.",
    icon: <Sparkles className="size-4" />,
  },
  {
    id: "membership",
    label: "Membership",
    description: "Plans, benefits and billing.",
    icon: <CreditCard className="size-4" />,
    fullAccountOnly: true,
  },
  {
    id: "orders",
    label: "Orders",
    description: "Printed books, payments and receipts.",
    icon: <Package className="size-4" />,
    fullAccountOnly: true,
  },
  {
    id: "downloads",
    label: "Downloads",
    description: "Your digital books, ready anytime.",
    icon: <Download className="size-4" />,
    fullAccountOnly: true,
  },
  {
    id: "invites",
    label: "Invite friends",
    description: "Share your link and follow rewards.",
    icon: <Users className="size-4" />,
    referralOnly: true,
  },
];

export default function AccountApp() {
  const pathname = usePathname();
  const router = useRouter();
  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const uid = user?.uid ?? null;
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const referralEnabled = useAppConfigStore((s) => s.referral.enabled);
  const configLoaded = useAppConfigStore((s) => s.loaded);
  const subscribeConfig = useAppConfigStore((s) => s.subscribe);
  const watchProfile = useProfileStore((s) => s.watch);
  const stopProfile = useProfileStore((s) => s.stop);
  const watchSparks = useSparksStore((s) => s.watch);
  const stopSparks = useSparksStore((s) => s.stop);
  const watchOrders = useOrdersStore((s) => s.watch);
  const stopOrders = useOrdersStore((s) => s.stop);
  const watchPayments = usePaymentsStore((s) => s.watch);
  const stopPayments = usePaymentsStore((s) => s.stop);
  const watchDownloads = useDownloadsStore((s) => s.watch);
  const stopDownloads = useDownloadsStore((s) => s.stop);
  const watchSubscriptions = useSubscriptionStore((s) => s.watch);
  const stopSubscriptions = useSubscriptionStore((s) => s.stop);

  useEffect(() => {
    subscribeConfig();
  }, [subscribeConfig]);

  useEffect(() => {
    if (!uid || accessLevel === "loading") {
      stopProfile();
      stopSparks();
      return;
    }
    watchProfile();
    watchSparks();
    return () => {
      stopProfile();
      stopSparks();
    };
  }, [accessLevel, stopProfile, stopSparks, uid, watchProfile, watchSparks]);

  useEffect(() => {
    if (!uid || accessLevel !== "full") {
      stopOrders();
      stopPayments();
      stopDownloads();
      stopSubscriptions();
      return;
    }
    watchOrders();
    watchPayments();
    watchDownloads();
    watchSubscriptions();
    return () => {
      stopOrders();
      stopPayments();
      stopDownloads();
      stopSubscriptions();
    };
  }, [
    accessLevel,
    stopDownloads,
    stopOrders,
    stopPayments,
    stopSubscriptions,
    uid,
    watchDownloads,
    watchOrders,
    watchPayments,
    watchSubscriptions,
  ]);

  const visibleNav = useMemo(
    () =>
      ACCOUNT_NAV.filter(
        (item) =>
          (!item.fullAccountOnly || accessLevel === "full") &&
          (!item.referralOnly || !configLoaded || referralEnabled),
      ),
    [accessLevel, configLoaded, referralEnabled],
  );

  const requestedSection = pathname.split("/")[2] as AccountSection | undefined;
  const active = visibleNav.find((item) => item.id === requestedSection) ?? visibleNav[0];

  useEffect(() => {
    if (!ready || accessLevel === "loading" || !active) return;
    if (requestedSection !== active.id) router.replace(`/account/${active.id}`);
  }, [accessLevel, active, ready, requestedSection, router]);

  const signedIn = Boolean(user && !user.isAnonymous);

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar
        left={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="size-4" />}
            onClick={() => router.back()}
          >
            Back
          </Button>
        }
        right={
          <>
            <HelpButton />
            <AuthMenu />
          </>
        }
      />

      {!ready || accessLevel === "loading" ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand-500" />
        </div>
      ) : !signedIn ? (
        <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Settings className="size-5" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold text-ink-900">Your account</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            Sign in to manage Sparks, orders, downloads and invitations.
          </p>
          <Button className="mt-5" onClick={() => openAuthDialog()}>
            Sign in
          </Button>
        </main>
      ) : active ? (
        <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
          <div className="mb-6 lg:hidden">
            <label htmlFor="account-section" className="mb-1.5 block text-xs font-semibold text-ink-500">
              Account section
            </label>
            <select
              id="account-section"
              value={active.id}
              onChange={(event) => router.push(`/account/${event.target.value}`)}
              className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 shadow-soft outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20"
            >
              {visibleNav.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <aside className="sticky top-20 hidden lg:block">
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Your account</p>
              <nav aria-label="Account">
                {visibleNav.map((item) => (
                  <Link
                    key={item.id}
                    href={`/account/${item.id}`}
                    aria-current={active.id === item.id ? "page" : undefined}
                    className={cn(
                      "mb-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                      active.id === item.id
                        ? "bg-white text-ink-900 shadow-soft ring-1 ring-ink-100"
                        : "text-ink-500 hover:bg-white/70 hover:text-ink-800",
                    )}
                  >
                    <span className={active.id === item.id ? "text-brand-600" : "text-ink-400"}>{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>

            <article className="min-w-0">
              <header className="mb-5">
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
                  {active.label}
                </h1>
                <p className="mt-1 text-sm text-ink-500">{active.description}</p>
              </header>
              <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft sm:p-7">
                <AccountSectionContent section={active.id} />
              </div>
            </article>
          </div>
        </main>
      ) : null}

      <AuthDialog />
      <PurchaseConfirmation />
      <Toaster />
    </div>
  );
}

function AccountSectionContent({ section }: { section: AccountSection }) {
  switch (section) {
    case "settings":
      return <SettingsContent />;
    case "sparks":
      return <SparksAccountContent />;
    case "membership":
      return <PlansContent />;
    case "orders":
      return <OrdersContent />;
    case "downloads":
      return <DownloadsContent />;
    case "invites":
      return <InviteFriendsContent />;
  }
}
