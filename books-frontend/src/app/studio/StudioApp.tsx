"use client";

import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/ui/components/Button";
import { Toaster } from "@/ui/components/Toaster";
import { AuthMenu } from "@/ui/auth/AuthMenu";
import { AuthDialog } from "@/ui/auth/AuthDialog";
import { GuestMigrationDialog } from "@/ui/auth/GuestMigrationDialog";
import { VerifyEmailBanner } from "@/ui/auth/VerifyEmailBanner";
import { Dashboard } from "@/ui/dashboard/Dashboard";
import { TopBar } from "@/ui/layout/TopBar";
import { LowSparksBanner } from "@/ui/layout/LowSparksBanner";
import { JobProgress } from "@/ui/layout/JobProgress";
import { ProjectConflictBanner, SaveFailureBanner } from "@/ui/layout/ProjectConflictBanner";
import { OrdersDialog } from "@/ui/checkout/OrdersDialog";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { ImageTierPromptDialog } from "@/ui/settings/ImageTierPromptDialog";
import { ProjectWorkspace } from "@/ui/project/ProjectWorkspace";
import { useProjectsStore } from "@/state/projectsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useAuthStore } from "@/state/authStore";
import { useJobsStore } from "@/state/jobsStore";
import { useOrdersStore } from "@/state/ordersStore";
import { usePaymentsStore } from "@/state/paymentsStore";
import { useDownloadsStore } from "@/state/downloadsStore";
import { DownloadsDialog } from "@/ui/checkout/DownloadsDialog";
import { useProfileStore } from "@/state/profileStore";
import { useAppConfigStore } from "@/state/appConfigStore";
import { useSparksStore } from "@/state/sparksStore";
import { useSubscriptionStore } from "@/state/subscriptionStore";
import { SparksBadge } from "@/ui/layout/SparksBadge";
import { PlansDialog } from "@/ui/billing/PlansDialog";
import { ImageTierControl } from "@/ui/settings/ImageTierControl";
import { useAccountUiStore } from "@/state/accountUiStore";
import { claimReferralCode } from "@/platform/payments";
import { notify } from "@/ui/lib/notify";

export default function StudioApp() {
  const loadProjects = useProjectsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const currentId = useProjectsStore((s) => s.currentId);
  const createProject = useProjectsStore((s) => s.createProject);
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
  const watchDownloads = useDownloadsStore((s) => s.watch);
  const stopDownloads = useDownloadsStore((s) => s.stop);
  const watchProfile = useProfileStore((s) => s.watch);
  const stopProfile = useProfileStore((s) => s.stop);
  const recordSession = useProfileStore((s) => s.recordSession);
  const subscribeConfig = useAppConfigStore((s) => s.subscribe);
  const watchSparks = useSparksStore((s) => s.watch);
  const stopSparks = useSparksStore((s) => s.stop);
  const watchSubs = useSubscriptionStore((s) => s.watch);
  const stopSubs = useSubscriptionStore((s) => s.stop);
  const sparksEnabled = useAppConfigStore((s) => s.sparks.enabled);
  const ordersOpen = useAccountUiStore((s) => s.ordersOpen);
  const closeOrders = useAccountUiStore((s) => s.closeOrders);
  const downloadsOpen = useAccountUiStore((s) => s.downloadsOpen);
  const closeDownloads = useAccountUiStore((s) => s.closeDownloads);

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
      stopDownloads();
      return;
    }
    watchOrders();
    watchPayments();
    watchDownloads();
    watchSubs();
    return () => {
      stopOrders();
      stopPayments();
      stopDownloads();
      stopSubs();
    };
  }, [
    uid,
    accessLevel,
    watchOrders,
    stopOrders,
    watchPayments,
    stopPayments,
    watchDownloads,
    stopDownloads,
    watchSubs,
    stopSubs,
  ]);

  // Mirror the Spark balance for EVERY signed-in identity — guests hold a small
  // starter balance too. Restarting on access-level changes also re-claims the
  // grant ladder, so the signup/verify bonuses land the moment they're earned.
  useEffect(() => {
    if (!uid || accessLevel === "loading") {
      stopSparks();
      return;
    }
    watchSparks();
    return () => stopSparks();
  }, [uid, accessLevel, watchSparks, stopSparks]);

  // Surface the result of a Stripe Checkout redirect (success/cancel) once, then
  // strip the query params so a refresh doesn't re-toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const subscription = params.get("subscription");
    const sparks = params.get("sparks");
    const gift = params.get("gift");
    const ebook = params.get("ebook");
    const ref = params.get("ref");
    const hero = params.get("hero");
    // A referral landing (`?ref=CODE`) is remembered and claimed once the
    // visitor has a full account (see the claim effect below).
    if (ref) {
      try {
        localStorage.setItem("pendingReferralCode", ref);
      } catch {
        /* storage unavailable — the invite just doesn't stick */
      }
    }
    // A landing-page on-ramp (`?hero=Name`) is remembered until the guest
    // session + project list are ready, then a storybook is created for them.
    if (hero) {
      try {
        sessionStorage.setItem("pendingHeroName", hero.slice(0, 40));
      } catch {
        /* storage unavailable — they just land on the library */
      }
    }
    if (!checkout && !subscription && !sparks && !gift && !ebook && !ref && !hero) return;
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
    } else if (gift === "success") {
      notify.success(
        "Gift purchased",
        "Your gift code is ready — find it in your Sparks wallet under “Gifts you bought”.",
      );
    } else if (gift === "cancel") {
      notify.info("Purchase cancelled", "No charge was made.");
    } else if (ebook === "success") {
      notify.success(
        "Ebook purchased",
        "Your digital edition is unlocked — download it from the Order step anytime.",
      );
    } else if (ebook === "cancel") {
      notify.info("Purchase cancelled", "No charge was made.");
    }
    params.delete("checkout");
    params.delete("subscription");
    params.delete("sparks");
    params.delete("gift");
    params.delete("ebook");
    params.delete("payment");
    params.delete("ref");
    params.delete("hero");
    params.delete("session_id");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Fulfil the landing-page on-ramp: once the (guest) session and project list
  // are ready, create the promised storybook and drop the visitor straight into
  // it. One-shot — the stored name is cleared before creating, so a failure or
  // refresh can't spawn duplicates.
  useEffect(() => {
    if (!uid || !projectsLoaded || accessLevel === "loading") return;
    let heroName: string | null = null;
    try {
      heroName = sessionStorage.getItem("pendingHeroName");
      if (heroName) {
        sessionStorage.removeItem("pendingHeroName");
        // Keep the name for the Story stage's quick-start prefill (session-
        // scoped; cleared once a draft is written).
        sessionStorage.setItem("quickStartHeroName", heroName);
      }
    } catch {
      return;
    }
    if (!heroName) return;
    void createProject(`${heroName}'s Storybook`);
  }, [uid, projectsLoaded, accessLevel, createProject]);

  // Claim a remembered referral code once the user has a full account. The
  // backend rejects self-referrals/stale accounts softly; clearing on any
  // attempt keeps this one-shot.
  useEffect(() => {
    if (!uid || accessLevel !== "full") return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem("pendingReferralCode");
    } catch {
      return;
    }
    if (!pending) return;
    try {
      localStorage.removeItem("pendingReferralCode");
    } catch {
      /* ignore */
    }
    void claimReferralCode(pending).then((ok) => {
      if (ok) {
        notify.success(
          "Invite accepted",
          "You'll both receive bonus Sparks after your first purchase.",
        );
      }
    });
  }, [uid, accessLevel]);

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

  // The studio is open to every signed-in identity — guests included (they
  // draft and generate with their granted Sparks; purchases and premium tier
  // stay account-gated). Unverified accounts see a reminder banner instead of
  // a hard gate. `loading` still blocks so a stale currentId from a previous
  // identity can never leak in before auth resolves.
  const inProject = currentId !== null && accessLevel !== "loading";

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <TopBar
        center={<JobProgress />}
        right={
          <>
            {inProject && accessLevel === "full" && <ImageTierControl />}
            {accessLevel !== "loading" && sparksEnabled && <SparksBadge />}
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

      <ProjectConflictBanner />
      <SaveFailureBanner />
      {accessLevel === "unverified" && <VerifyEmailBanner />}
      <LowSparksBanner />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-grid">
        {accessLevel === "loading" ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-7 animate-spin text-brand-400" />
          </div>
        ) : inProject ? (
          <ProjectWorkspace />
        ) : (
          <Dashboard />
        )}
      </main>

      <AuthDialog />
      <GuestMigrationDialog />
      <PlansDialog />
      {accessLevel === "full" && <OrdersDialog open={ordersOpen} onClose={closeOrders} />}
      {accessLevel === "full" && <DownloadsDialog open={downloadsOpen} onClose={closeDownloads} />}
      <SettingsDialog />
      <ImageTierPromptDialog />
      <Toaster />
    </div>
    </MotionConfig>
  );
}
