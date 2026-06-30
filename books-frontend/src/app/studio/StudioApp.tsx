"use client";

import { useEffect } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/ui/components/Button";
import { Toaster } from "@/ui/components/Toaster";
import { AuthMenu } from "@/ui/auth/AuthMenu";
import { AuthDialog } from "@/ui/auth/AuthDialog";
import { GuestMigrationDialog } from "@/ui/auth/GuestMigrationDialog";
import { VerifyEmailGate } from "@/ui/auth/VerifyEmailGate";
import { Dashboard } from "@/ui/dashboard/Dashboard";
import { TopBar } from "@/ui/layout/TopBar";
import { JobProgress } from "@/ui/layout/JobProgress";
import { OrdersButton } from "@/ui/checkout/OrdersDialog";
import { ProjectWorkspace } from "@/ui/project/ProjectWorkspace";
import { useProjectsStore } from "@/state/projectsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useAuthStore } from "@/state/authStore";
import { useJobsStore } from "@/state/jobsStore";
import { useOrdersStore } from "@/state/ordersStore";
import { usePaymentsStore } from "@/state/paymentsStore";
import { useProfileStore } from "@/state/profileStore";
import { useAppConfigStore } from "@/state/appConfigStore";
import { useSparksStore } from "@/state/sparksStore";
import { useSubscriptionStore } from "@/state/subscriptionStore";
import { SparksBadge } from "@/ui/layout/SparksBadge";
import { PlansButton, PlansDialog } from "@/ui/billing/PlansDialog";
import { notify } from "@/ui/lib/notify";

export default function StudioApp() {
  const loadProjects = useProjectsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const currentId = useProjectsStore((s) => s.currentId);
  const closeProject = useProjectsStore((s) => s.closeProject);
  const initAuth = useAuthStore((s) => s.init);
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const watchJobs = useJobsStore((s) => s.watch);
  const stopJobs = useJobsStore((s) => s.stop);
  const watchOrders = useOrdersStore((s) => s.watch);
  const stopOrders = useOrdersStore((s) => s.stop);
  const watchPayments = usePaymentsStore((s) => s.watch);
  const stopPayments = usePaymentsStore((s) => s.stop);
  const watchProfile = useProfileStore((s) => s.watch);
  const stopProfile = useProfileStore((s) => s.stop);
  const recordSession = useProfileStore((s) => s.recordSession);
  const subscribeConfig = useAppConfigStore((s) => s.subscribe);
  const watchSparks = useSparksStore((s) => s.watch);
  const stopSparks = useSparksStore((s) => s.stop);
  const watchSubs = useSubscriptionStore((s) => s.watch);
  const stopSubs = useSubscriptionStore((s) => s.stop);
  const sparksEnabled = useAppConfigStore((s) => s.sparks.enabled);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Live, world-readable global config (models, art-style examples, model costs).
  useEffect(() => {
    subscribeConfig();
  }, [subscribeConfig]);

  // Persistence is per-user (Firestore/Storage), so (re)load whenever the
  // signed-in user changes. Guest-first means a uid appears shortly after mount.
  // Closing first ensures a previous identity's open project never leaks across.
  useEffect(() => {
    if (!uid) return;
    closeProject();
    void loadProjects();
    void loadSettings();
  }, [uid, closeProject, loadProjects, loadSettings]);

  // Track (and reconcile) the open project's generation jobs. This surfaces
  // background progress and applies results that finished while away.
  useEffect(() => {
    if (!uid || !currentId) {
      stopJobs();
      return;
    }
    watchJobs(currentId);
    return () => stopJobs();
  }, [uid, currentId, watchJobs, stopJobs]);

  // Mirror the user's order history (only full accounts can place orders, and
  // orders are owner-readable). Restart on identity change so they never leak.
  useEffect(() => {
    if (!uid || accessLevel !== "full") {
      stopOrders();
      stopPayments();
      return;
    }
    watchOrders();
    watchPayments();
    watchSparks();
    watchSubs();
    return () => {
      stopOrders();
      stopPayments();
      stopSparks();
      stopSubs();
    };
  }, [uid, accessLevel, watchOrders, stopOrders, watchPayments, stopPayments, watchSparks, stopSparks, watchSubs, stopSubs]);

  // Surface the result of a Stripe Checkout redirect (success/cancel) once, then
  // strip the query params so a refresh doesn't re-toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const subscription = params.get("subscription");
    const sparks = params.get("sparks");
    if (!checkout && !subscription && !sparks) return;
    if (checkout === "success") {
      notify.success(
        "Payment received",
        "Thanks! Your book is being sent to print — track it under Orders.",
      );
    } else if (checkout === "cancel") {
      notify.info("Checkout cancelled", "No charge was made. You can try again anytime.");
    } else if (subscription === "success") {
      notify.success("Subscription active", "Your plan is now active.");
    } else if (sparks === "success") {
      notify.success("Sparks added", "Your Sparks have been topped up.");
    } else if (sparks === "cancel") {
      notify.info("Purchase cancelled", "No charge was made.");
    }
    params.delete("checkout");
    params.delete("subscription");
    params.delete("sparks");
    params.delete("session_id");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Mirror the profile + saved address book (full accounts only — the same gate
  // as orders, since addresses exist to speed up reordering). Also stamp coarse
  // profile metadata once per identity for convenience + light analytics.
  useEffect(() => {
    if (!uid || accessLevel !== "full") {
      stopProfile();
      return;
    }
    watchProfile();
    const user = useAuthStore.getState().user;
    void recordSession({
      displayName: user?.displayName ?? null,
      email: user?.email ?? null,
      photoURL: user?.photoURL ?? null,
      signupSource: user?.providerData?.[0]?.providerId ?? (user?.isAnonymous ? "guest" : null),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
    });
    return () => stopProfile();
  }, [uid, accessLevel, watchProfile, stopProfile, recordSession]);

  // Unverified users are gated out of the studio entirely (hard gate). Guests
  // see the library but can't open a project. Only a full account may be in the
  // studio, so a stale currentId from a previous identity can never leak in.
  const gated = accessLevel === "unverified";
  const inProject = currentId !== null && accessLevel === "full";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <TopBar
        center={gated ? null : <JobProgress />}
        right={
          <>
            {accessLevel === "full" && sparksEnabled && <SparksBadge />}
            {accessLevel === "full" && <PlansButton />}
            {accessLevel === "full" && <OrdersButton />}
            <AuthMenu />
          </>
        }
        left={
          inProject ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={() => closeProject()}
            >
              Library
            </Button>
          ) : null
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-grid">
        {accessLevel === "loading" ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-7 animate-spin text-brand-400" />
          </div>
        ) : gated ? (
          <VerifyEmailGate />
        ) : inProject ? (
          <ProjectWorkspace />
        ) : (
          <Dashboard />
        )}
      </main>

      <AuthDialog />
      <GuestMigrationDialog />
      <PlansDialog />
      <Toaster />
    </div>
  );
}
