"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/ui/components/Button";
import { cn } from "@/ui/lib/cn";
import { isDev } from "@/platform/runtime";
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
import { ContactDialog } from "@/ui/contact/ContactDialog";
import { HelpButton } from "@/ui/contact/HelpButton";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { SparksShortfallDialog } from "@/ui/layout/SparksShortfallDialog";
import { ProjectWorkspace } from "@/ui/project/ProjectWorkspace";
import { flushProjectSaves, useProjectsStore } from "@/state/projectsStore";
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
import { usePriceOverridesStore } from "@/state/priceOverridesStore";
import { useSubscriptionStore } from "@/state/subscriptionStore";
import { SparksBadge } from "@/ui/layout/SparksBadge";
import { PlansDialog } from "@/ui/billing/PlansDialog";
import { useAccountUiStore } from "@/state/accountUiStore";
import { useCheckoutUiStore, type PurchaseKind } from "@/state/checkoutUiStore";
import { PurchaseConfirmation } from "@/ui/checkout/PurchaseConfirmation";
import { claimPendingReferral, rememberReferralCode } from "@/platform/referrals";
import { ARRIVAL_QUERY_KEYS, captureArrival } from "@/platform/acquisition";
import { SessionTracker } from "@/ui/analytics/SessionTracker";
import { InviteFriendsDialog } from "@/ui/referrals/InviteFriendsDialog";
import { notify } from "@/ui/lib/notify";
import {
  defaultDestination,
  fallbackDestination,
  parseStudioPath,
  studioPath,
  type StudioDestination,
} from "@/ui/studio/studioRoutes";
import { useGuidePlaylist } from "@/ui/guide/useGuideMode";
import { useFlowAttribution, usePreviewReached } from "@/ui/studio/useFlowAttribution";
import { GuideModeToggle } from "@/ui/guide/GuideModeToggle";
import { useGuideStore } from "@/state/guideStore";

export default function StudioApp() {
  const router = useRouter();
  const pathname = usePathname();
  const route = useMemo(() => parseStudioPath(pathname), [pathname]);
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const currentId = useProjectsStore((s) => s.currentId);
  const currentTitle = useProjectsStore(
    (s) => s.projects.find((project) => project.id === s.currentId)?.title,
  );
  const createProject = useProjectsStore((s) => s.createProject);
  const openProject = useProjectsStore((s) => s.openProject);
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
  const loadPriceOverrides = usePriceOverridesStore((s) => s.load);
  const resetPriceOverrides = usePriceOverridesStore((s) => s.reset);
  const watchSubs = useSubscriptionStore((s) => s.watch);
  const stopSubs = useSubscriptionStore((s) => s.stop);
  const sparksEnabled = useAppConfigStore((s) => s.sparks.enabled);
  const ordersOpen = useAccountUiStore((s) => s.ordersOpen);
  const closeOrders = useAccountUiStore((s) => s.closeOrders);
  const downloadsOpen = useAccountUiStore((s) => s.downloadsOpen);
  const closeDownloads = useAccountUiStore((s) => s.closeDownloads);
  const inviteOpen = useAccountUiStore((s) => s.inviteOpen);
  const closeInvite = useAccountUiStore((s) => s.closeInvite);
  const openInvite = useAccountUiStore((s) => s.openInvite);
  const openConfirmation = useCheckoutUiStore((s) => s.openConfirmation);
  const closeGuide = useGuideStore((s) => s.close);
  const [projectsOwnerUid, setProjectsOwnerUid] = useState<string | null>(null);
  const rejectedBookRef = useRef<string | null>(null);
  // Null for everyone on the wizard, which is everyone until an admin opts in.
  // When set, the guide engine picks the default landing destination instead of
  // the wizard's own precedence — see ui/studio/guideRouting.ts.
  const guidePlaylist = useGuidePlaylist(route.kind === "project" ? route.bookId : null);

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
    const loadingUid = uid;
    setProjectsOwnerUid(null);
    closeProject();
    void loadProjects().then(() => {
      if (useAuthStore.getState().user?.uid === loadingUid) {
        setProjectsOwnerUid(loadingUid);
      }
    });
    void loadSettings();
  }, [uid, closeProject, loadProjects, loadSettings]);

  // The route is the source of truth for both the active book and workflow
  // destination. A route id is never trusted on its own: it can only select a
  // book returned from the active identity's UID-scoped Firestore collection.
  useEffect(() => {
    if (
      !uid ||
      accessLevel === "loading" ||
      !projectsLoaded ||
      projectsOwnerUid !== uid
    ) {
      return;
    }

    if (route.kind === "invalid") {
      closeProject();
      router.replace("/studio", { scroll: false });
      return;
    }

    if (route.kind === "library") {
      rejectedBookRef.current = null;
      if (currentId) closeProject();
      return;
    }

    const project = projects.find((candidate) => candidate.id === route.bookId);
    if (!project) {
      closeProject();
      if (rejectedBookRef.current !== route.bookId) {
        rejectedBookRef.current = route.bookId;
        notify.info("Book not found", "That storybook is unavailable or belongs to another account.");
      }
      router.replace("/studio", { scroll: false });
      return;
    }

    rejectedBookRef.current = null;
    if (currentId !== project.id) openProject(project.id);

    const requested = route.destination ?? defaultDestination(project, guidePlaylist);
    const allowed = fallbackDestination(project, requested, guidePlaylist);
    if (route.destination !== allowed) {
      // Keep the query: a Stripe return can land on a destination this book
      // isn't eligible for, and rewriting the path bare would throw away the
      // `payment` id the confirmation screen needs to survive a refresh.
      const search = typeof window === "undefined" ? "" : window.location.search;
      router.replace(`${studioPath(project.id, allowed)}${search}`, { scroll: false });
    }
  }, [
    accessLevel,
    closeProject,
    currentId,
    guidePlaylist,
    openProject,
    projects,
    projectsLoaded,
    projectsOwnerUid,
    route,
    router,
    uid,
  ]);

  // Drop the guided studio's conversation whenever no book is open. Changing
  // identity closes the project first, so this covers a guest→account switch too:
  // a transcript is one reader's own words and must never survive into another's
  // session, even for the moment before the new one loads.
  useEffect(() => {
    if (!currentId) closeGuide();
  }, [currentId, closeGuide]);

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

  // Campaign price overrides are per-identity and, unlike everything else a
  // Spark quote needs, not world-readable — so they're fetched rather than
  // subscribed, and dropped on identity change so one account's promotion can
  // never price another's renders.
  useEffect(() => {
    if (!uid || accessLevel === "loading") {
      resetPriceOverrides();
      return;
    }
    loadPriceOverrides();
    return () => resetPriceOverrides();
  }, [uid, accessLevel, loadPriceOverrides, resetPriceOverrides]);

  // Surface the result of a Stripe Checkout redirect. A SUCCESS opens the
  // confirmation screen and leaves its params in place, so a refresh comes
  // straight back to it (the screen clears them when dismissed). Only the
  // cancellations — where there is nothing to follow — are toasts, and only
  // those params are stripped here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const subscription = params.get("subscription");
    const sparks = params.get("sparks");
    const gift = params.get("gift");
    const ebook = params.get("ebook");
    const paymentId = params.get("payment");
    const projectId = params.get("project");
    const ref = params.get("ref");
    const hero = params.get("hero");
    const invite = params.get("invite");
    // A referral landing (`?ref=CODE`) is remembered until there's an identity to
    // attach it to (see the claim effect below).
    if (ref) rememberReferralCode(ref);
    // A QR scan or campaign link (`?qr=`, `?lt=`, `?utm_*`) is parked the same
    // way and for the same reason — see `platform/acquisition`. Must happen
    // HERE, not only in root `ArrivalInit`: this effect strips those params,
    // and child effects run first, so waiting for the layout would lose the
    // token on a `/studio?qr=` landing. Separate from `?ref=`: that says who
    // invited them, this says where they came from, and an auto-applied coupon
    // keys on the second.
    const capturedArrival = captureArrival();
    // `?invite=1` — where the "invite someone else" button in our own emails lands.
    if (invite) openInvite();
    // A landing-page on-ramp (`?hero=Name`) is remembered until the guest
    // session + project list are ready, then a storybook is created for them.
    if (hero) {
      try {
        sessionStorage.setItem("pendingHeroName", hero.slice(0, 40));
      } catch {
        /* storage unavailable — they just land on the library */
      }
    }
    if (
      !checkout &&
      !subscription &&
      !sparks &&
      !gift &&
      !ebook &&
      !ref &&
      !hero &&
      !invite &&
      !capturedArrival
    ) {
      return;
    }

    const success: PurchaseKind | null =
      checkout === "success"
        ? "order"
        : ebook === "success"
          ? "ebook"
          : sparks === "success"
            ? "sparks"
            : gift === "success"
              ? "gift"
              : subscription === "success"
                ? "subscription"
                : null;

    if (success) {
      openConfirmation({ kind: success, paymentId, projectId });
    } else if (
      checkout === "cancel" ||
      ebook === "cancel" ||
      sparks === "cancel" ||
      gift === "cancel" ||
      subscription === "cancel"
    ) {
      notify.info("Checkout cancelled", "No charge was made. You can try again anytime.");
    }

    // The confirmation screen owns its own params (it needs them to survive a
    // refresh) and clears them on dismiss, so only the rest are cleaned up here.
    if (!success) {
      for (const key of ["checkout", "subscription", "sparks", "gift", "ebook", "payment", "project", "session_id"]) {
        params.delete(key);
      }
    }
    params.delete("ref");
    params.delete("hero");
    params.delete("invite");
    // Stripped once parked. A tracking parameter left in the address bar rides
    // along into any link this person shares, which would attribute the
    // recipient to a poster they never saw.
    for (const key of ARRIVAL_QUERY_KEYS) {
      params.delete(key);
    }
    const qs = params.toString();
    router.replace(pathname + (qs ? `?${qs}` : ""), { scroll: false });
  }, [openConfirmation, openInvite, pathname, router]);

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
    void createProject(`${heroName}'s Storybook`, false).then((projectId) => {
      router.replace(studioPath(projectId, "story"), { scroll: false });
    });
  }, [uid, projectsLoaded, accessLevel, createProject, router]);

  // Attach a remembered referral code to whatever identity exists NOW — guest
  // included. Attribution has to happen while the invite link is still the reason
  // this person is here; the reward triggers are what stay gated on proof. Re-runs
  // on every identity change (guest → account) until the backend gives a final
  // answer, which is what makes a two-session signup still count.
  useEffect(() => {
    if (!uid || accessLevel === "loading") return;
    void claimPendingReferral().then((outcome) => {
      if (outcome === "attributed") {
        notify.success("Invite accepted", "Your friend's invitation is linked to your account.");
      }
    });
  }, [uid, accessLevel]);

  // Mirror the profile + saved address book for every signed-in identity.
  // Session metadata stays a full-account stamp.
  useEffect(() => {
    if (!uid || accessLevel === "loading") {
      stopProfile();
      return;
    }
    watchProfile();
    if (accessLevel === "full") {
      const user = useAuthStore.getState().user;
      void recordSession({
        displayName: user?.displayName ?? null,
        email: user?.email ?? null,
        photoURL: user?.photoURL ?? null,
        signupSource: user?.providerData?.[0]?.providerId ?? (user?.isAnonymous ? "guest" : null),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
      });
    }
    return () => stopProfile();
  }, [uid, accessLevel, watchProfile, stopProfile, recordSession]);

  // The studio is open to every signed-in identity — guests included (they
  // draft and generate with their granted Sparks; purchases and premium tier
  // stay account-gated). Unverified accounts see a reminder banner instead of
  // a hard gate. `loading` still blocks so a stale currentId from a previous
  // identity can never leak in before auth resolves.
  const routedProject =
    route.kind === "project"
      ? projects.find((project) => project.id === route.bookId) ?? null
      : null;
  const activeDestination =
    route.kind === "project" && routedProject
      ? fallbackDestination(
          routedProject,
          route.destination ?? defaultDestination(routedProject, guidePlaylist),
          guidePlaylist,
        )
      : null;
  const inProject =
    route.kind === "project" &&
    currentId === route.bookId &&
    routedProject !== null &&
    activeDestination !== null &&
    projectsOwnerUid === uid &&
    accessLevel !== "loading";
  const resolvingRoute =
    accessLevel === "loading" ||
    route.kind === "invalid" ||
    (route.kind === "project" && !inProject) ||
    (uid !== null && (!projectsLoaded || projectsOwnerUid !== uid));

  // Which studio built this book, and whether the reader got to the end. Recorded
  // rather than derived: neither is recoverable once the rollout moves on. Only
  // reported once the book is actually open, so a route still resolving doesn't
  // attribute a visit to whichever flow rendered the spinner. Goes with the flow
  // comparison — see docs/LEGACY-GUIDE.md.
  const attributedProjectId = inProject ? route.bookId : null;
  useFlowAttribution(attributedProjectId, inProject ? (guidePlaylist ? "guide" : "legacy") : null);
  usePreviewReached(attributedProjectId, activeDestination === "order");

  const navigateStudio = useCallback(
    (destination: StudioDestination) => {
      if (route.kind !== "project") return;
      router.push(studioPath(route.bookId, destination), { scroll: false });
    },
    [route, router],
  );

  const navigateLibrary = useCallback(() => {
    void flushProjectSaves().finally(() => {
      router.push("/studio", { scroll: false });
    });
  }, [router]);

  return (
    <MotionConfig reducedMotion="user">
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-canvas",
        // Leaves room for the dev-environment banner (`h-6`) above it instead
        // of overflowing past the viewport — see ui/layout/DevEnvironmentBanner.
        isDev() ? "h-[calc(100vh-1.5rem)]" : "h-screen",
      )}
    >
      {/* Cookieless device/session beacon — see SessionTracker for the privacy
          reasoning. Mounted here rather than in the root layout because this is
          the shell every authenticated identity (guests included) passes
          through, and the beacon needs an identity to attribute to. */}
      <SessionTracker />
      <TopBar
        center={<JobProgress />}
        contextLabel={inProject ? currentTitle : undefined}
        right={
          <>
            {inProject && <GuideModeToggle bookId={route.kind === "project" ? route.bookId : null} />}
            {accessLevel !== "loading" && sparksEnabled && <SparksBadge />}
            <HelpButton />
            <AuthMenu />
          </>
        }
        left={
          inProject ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={navigateLibrary}
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

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas">
        {resolvingRoute ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-7 animate-spin text-brand-400" />
          </div>
        ) : inProject ? (
          <ProjectWorkspace
            destination={activeDestination}
            onNavigate={navigateStudio}
            guidePlaylist={guidePlaylist}
          />
        ) : (
          <Dashboard />
        )}
      </main>

      <AuthDialog />
      <ContactDialog />
      <GuestMigrationDialog />
      <PlansDialog />
      {accessLevel === "full" && <OrdersDialog open={ordersOpen} onClose={closeOrders} />}
      {accessLevel === "full" && <DownloadsDialog open={downloadsOpen} onClose={closeDownloads} />}
      {/* Unverified accounts see the offer too — the dialog explains what they
          still need to do rather than hiding the feature until they do it. */}
      {accessLevel !== "loading" && accessLevel !== "guest" && (
        <InviteFriendsDialog open={inviteOpen} onClose={closeInvite} />
      )}
      <SettingsDialog />
      <SparksShortfallDialog />
      <PurchaseConfirmation />
    </div>
    </MotionConfig>
  );
}
