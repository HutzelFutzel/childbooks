"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, FlaskConical, Loader2, Menu, Search, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/ui/components/Skeleton";
import { Button } from "@/ui/components/Button";
import { Drawer } from "@/ui/components/Drawer";
import { TopBar } from "@/ui/layout/TopBar";
import { AuthMenu } from "@/ui/auth/AuthMenu";
import { AuthDialog } from "@/ui/auth/AuthDialog";
import { ContactDialog } from "@/ui/contact/ContactDialog";
import { HelpButton } from "@/ui/contact/HelpButton";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { OrdersDialog } from "@/ui/checkout/OrdersDialog";
import { PlansDialog } from "@/ui/billing/PlansDialog";
import { SparksBadge } from "@/ui/layout/SparksBadge";
import { cn } from "@/ui/lib/cn";
import { isDev } from "@/platform/runtime";
import { useAuthStore } from "@/state/authStore";
import { useAdminHealth } from "@/state/adminHealthStore";
import { useAccountUiStore } from "@/state/accountUiStore";
import { useAppConfigStore } from "@/state/appConfigStore";
import { useAdminAccess } from "@/state/adminAccessStore";
import { AccessLoadState, SectionGate } from "./AccessGate";
import {
  useAdminTab,
  adminHref,
  canonicalAdminPath,
  type CatalogSegment,
  type ConfigTabId,
} from "./adminTabStore";
import { NAV_INDEX, NAV_TREE, hrefIsActive, resolveAdminPage, type NavLeaf } from "./adminNav";
import { AdminSidebarNav } from "./AdminSidebarNav";
import { AdminPageHeader } from "./AdminPageHeader";
import { CommandPalette } from "./CommandPalette";
import { AdminProgressBar, LoadingState, useAdminBusy } from "./LoadingState";
import { ConfigReady, configDocsForPage } from "./ConfigReady";

/** Shown while a tab's code downloads; also lights the top progress bar. */
function TabLoader() {
  useAdminBusy(true);
  return <LoadingState label="Loading section…" />;
}

/** One line of the startup checklist: done, in progress, or still waiting. */
function StartupStep({ label, state }: { label: string; state: "done" | "active" | "waiting" }) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 text-sm",
        state === "done" ? "text-ink-700" : state === "active" ? "font-medium text-ink-900" : "text-ink-400",
      )}
    >
      {state === "done" ? (
        <CheckCircle2 className="size-4 text-emerald-500" />
      ) : state === "active" ? (
        <Loader2 className="size-4 animate-spin text-brand-500" />
      ) : (
        <span className="size-4 rounded-full ring-1 ring-inset ring-ink-200" />
      )}
      {label}
    </li>
  );
}

/**
 * The one screen shown from first paint until the dashboard is ready. Replaces
 * three different full-screen spinners with a stable layout (sidebar outline +
 * a checklist of what's being waited on), so the page doesn't keep restarting.
 * The steps run in parallel, so each shows its own state rather than a
 * misleading "step 2 of 3".
 */
function AdminStartup({
  signedIn,
  adminVerified,
  permissionsLoaded,
}: {
  signedIn: boolean;
  adminVerified: boolean;
  permissionsLoaded: boolean;
}) {
  useAdminBusy(true);
  const stateOf = (done: boolean): "done" | "active" => (done ? "done" : "active");
  return (
    <>
      <aside
        className="hidden w-64 shrink-0 space-y-3 border-r border-ink-100 bg-white px-3 py-4 lg:block"
        aria-hidden
      >
        <Skeleton className="h-8" />
        <Skeleton className="h-32" />
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 px-6" role="status" aria-live="polite">
        <div className="text-center">
          <p className="text-base font-semibold text-ink-900">Getting the dashboard ready…</p>
          <p className="mt-1 text-xs text-ink-500">This only takes a moment.</p>
        </div>
        <ul className="space-y-2">
          <StartupStep label="Signing you in" state={stateOf(signedIn)} />
          <StartupStep label="Verifying admin access" state={signedIn ? stateOf(adminVerified) : "waiting"} />
          <StartupStep label="Loading your permissions" state={signedIn ? stateOf(permissionsLoaded) : "waiting"} />
        </ul>
      </div>
    </>
  );
}

const ModelConfigTab = dynamic(() => import("./tabs/ModelConfigTab").then((m) => m.ModelConfigTab), { loading: TabLoader });
const ArtStylesTab = dynamic(() => import("./tabs/ArtStylesTab").then((m) => m.ArtStylesTab), { loading: TabLoader });
const LayoutsTab = dynamic(() => import("./tabs/LayoutsTab").then((m) => m.LayoutsTab), { loading: TabLoader });
const AudienceTab = dynamic(() => import("./tabs/AudienceTab").then((m) => m.AudienceTab), { loading: TabLoader });
const StoryCraftTab = dynamic(() => import("./tabs/StoryCraftTab").then((m) => m.StoryCraftTab), { loading: TabLoader });
const BookLanguagesTab = dynamic(() => import("./tabs/BookLanguagesTab").then((m) => m.BookLanguagesTab), { loading: TabLoader });
const TypographyTab = dynamic(() => import("./tabs/TypographyTab").then((m) => m.TypographyTab), { loading: TabLoader });
const GuideTab = dynamic(() => import("./tabs/GuideTab").then((m) => m.GuideTab), { loading: TabLoader });
const PromptsTab = dynamic(() => import("./tabs/PromptsTab").then((m) => m.PromptsTab), { loading: TabLoader });
const ModelCostsTab = dynamic(() => import("./tabs/ModelCostsTab").then((m) => m.ModelCostsTab), { loading: TabLoader });
const BusinessOverviewTab = dynamic(() => import("./tabs/BusinessOverviewTab").then((m) => m.BusinessOverviewTab), { loading: TabLoader });
const CatalogTab = dynamic(() => import("./tabs/CatalogTab").then((m) => m.CatalogTab), { loading: TabLoader });
const MarketsTab = dynamic(() => import("./tabs/MarketsTab").then((m) => m.MarketsTab), { loading: TabLoader });
const FinancialTab = dynamic(() => import("./tabs/FinancialTab").then((m) => m.FinancialTab), { loading: TabLoader });
const DiscountPlannerTab = dynamic(() => import("./tabs/DiscountPlannerTab").then((m) => m.DiscountPlannerTab), { loading: TabLoader });
const PlansTab = dynamic(() => import("./tabs/PlansTab").then((m) => m.PlansTab), { loading: TabLoader });
const SparksTab = dynamic(() => import("./tabs/SparksTab").then((m) => m.SparksTab), { loading: TabLoader });
const ReferralsTab = dynamic(() => import("./tabs/ReferralsTab").then((m) => m.ReferralsTab), { loading: TabLoader });
const AffiliatesTab = dynamic(() => import("./tabs/AffiliatesTab").then((m) => m.AffiliatesTab), { loading: TabLoader });
const CampaignsTab = dynamic(() => import("./tabs/CampaignsTab").then((m) => m.CampaignsTab), { loading: TabLoader });
const CouponsTab = dynamic(() => import("./tabs/CouponsTab").then((m) => m.CouponsTab), { loading: TabLoader });
const SurveysTab = dynamic(() => import("./tabs/SurveysTab").then((m) => m.SurveysTab), { loading: TabLoader });
const SystemHealthTab = dynamic(() => import("./tabs/SystemHealthTab").then((m) => m.SystemHealthTab), { loading: TabLoader });
const SeoTab = dynamic(() => import("./tabs/marketing/SeoTab").then((m) => m.SeoTab), { loading: TabLoader });
const BlogTab = dynamic(() => import("./tabs/marketing/BlogTab").then((m) => m.BlogTab), { loading: TabLoader });
const LandingPagesTab = dynamic(() => import("./tabs/marketing/LandingPagesTab").then((m) => m.LandingPagesTab), { loading: TabLoader });
const BrandingTab = dynamic(() => import("./tabs/marketing/BrandingTab").then((m) => m.BrandingTab), { loading: TabLoader });
const QrCodesTab = dynamic(() => import("./tabs/marketing/QrCodesTab").then((m) => m.QrCodesTab), { loading: TabLoader });
const AnnouncementsTab = dynamic(() => import("./tabs/marketing/AnnouncementsTab").then((m) => m.AnnouncementsTab), { loading: TabLoader });
const ContactInboxTab = dynamic(() => import("./tabs/communication/ContactInboxTab").then((m) => m.ContactInboxTab), { loading: TabLoader });
const EmailTab = dynamic(() => import("./tabs/communication/EmailTab").then((m) => m.EmailTab), { loading: TabLoader });
const SlackTab = dynamic(() => import("./tabs/communication/SlackTab").then((m) => m.SlackTab), { loading: TabLoader });
const LegalDocsTab = dynamic(() => import("./tabs/legal/LegalDocsTab").then((m) => m.LegalDocsTab), { loading: TabLoader });
const CookieConsentTab = dynamic(() => import("./tabs/legal/CookieConsentTab").then((m) => m.CookieConsentTab), { loading: TabLoader });
const GdprTab = dynamic(() => import("./tabs/legal/GdprTab").then((m) => m.GdprTab), { loading: TabLoader });
const AnalysisTab = dynamic(() => import("./analysis/AnalysisTab").then((m) => m.AnalysisTab), { loading: TabLoader });
const PermissionsTab = dynamic(() => import("./tabs/PermissionsTab").then((m) => m.PermissionsTab), { loading: TabLoader });

function ConfigTabPanel({ tab }: { tab: ConfigTabId }) {
  switch (tab) {
    case "overview":
      return <BusinessOverviewTab />;
    case "catalog":
      return <CatalogTab />;
    case "markets":
      return <MarketsTab />;
    case "memberships":
      return <PlansTab />;
    case "sparks":
      return <SparksTab />;
    case "financial":
      return <FinancialTab />;
    case "discounts":
      return <DiscountPlannerTab />;
    case "models":
      return <ModelConfigTab />;
    case "artStyles":
      return <ArtStylesTab />;
    case "layouts":
      return <LayoutsTab />;
    case "audience":
      return <AudienceTab />;
    case "storyCraft":
      return <StoryCraftTab />;
    case "bookLanguages":
      return <BookLanguagesTab />;
    case "typography":
      return <TypographyTab />;
    case "guide":
      return <GuideTab />;
    case "prompts":
      return <PromptsTab />;
    case "modelCosts":
      return <ModelCostsTab />;
    case "system":
      return <SystemHealthTab />;
    default:
      return null;
  }
}

/**
 * Persistent sandbox/live indicator for the whole Admin shell — not just the
 * one System Health tab that owns the actual switch. This is the highest-risk
 * control in the app (flips Stripe + Lulu between test and real money/prints
 * at runtime, no redeploy), so it should be impossible to lose track of while
 * navigating anywhere else in Admin. Clicking it jumps straight to the tab
 * that manages it.
 */
function BillingEnvBadge({ onOpenSystemHealth }: { onOpenSystemHealth: () => void }) {
  const runtime = useAdminHealth((s) => s.runtime);
  const loadRuntime = useAdminHealth((s) => s.loadRuntime);

  useEffect(() => {
    if (!runtime) void loadRuntime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!runtime) return null;
  // Live is the normal state — only flag sandbox.
  if (runtime.env === "live") return null;

  return (
    <button
      type="button"
      onClick={onOpenSystemHealth}
      title="Sandbox billing mode — click to manage in System health"
      className="flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-200"
    >
      <FlaskConical className="size-3.5" />
      <span className="hidden sm:inline">Sandbox</span>
    </button>
  );
}

function SidebarChrome({
  pathname,
  catalogSegment,
  canReach,
  onSearch,
  onNavigate,
}: {
  pathname: string;
  catalogSegment: CatalogSegment;
  canReach: (leaf: NavLeaf) => boolean;
  onSearch: () => void;
  onNavigate?: () => void;
}) {
  return (
    <AdminSidebarNav
      tree={NAV_TREE}
      pathname={pathname}
      catalogSegment={catalogSegment}
      canReach={canReach}
      onOpenPalette={onSearch}
      onNavigate={onNavigate}
    />
  );
}

/**
 * Admin-only dashboard, served at `/admin`. The `isAdmin` check below is a
 * cosmetic gate — every write goes through the backend `/admin/*` routes which
 * independently enforce admin status, so a non-admin reaching this page can't do
 * anything anyway.
 */
export default function AdminApp() {
  const router = useRouter();
  const pathname = usePathname();
  const initAuth = useAuthStore((s) => s.init);
  const ready = useAuthStore((s) => s.ready);
  const adminReady = useAuthStore((s) => s.adminReady);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const subscribeConfig = useAppConfigStore((s) => s.subscribe);
  const subscribeAdminModelCosts = useAppConfigStore((s) => s.subscribeAdminModelCosts);
  const section = useAdminTab((s) => s.section);
  const configTab = useAdminTab((s) => s.configTab);
  const catalogSegment = useAdminTab((s) => s.catalogSegment);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const marketingTab = useAdminTab((s) => s.marketingTab);
  const communicationTab = useAdminTab((s) => s.communicationTab);
  const legalTab = useAdminTab((s) => s.legalTab);
  const ordersOpen = useAccountUiStore((s) => s.ordersOpen);
  const closeOrders = useAccountUiStore((s) => s.closeOrders);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const initAccess = useAdminAccess((s) => s.init);
  const reloadAccess = useAdminAccess((s) => s.reload);
  const accessLoaded = useAdminAccess((s) => s.loaded);
  const accessError = useAdminAccess((s) => s.error);
  const canRead = useAdminAccess((s) => s.canRead);
  const me = useAdminAccess((s) => s.me);
  const isOwnerAccess = useAdminAccess((s) => s.isOwner());
  const viewAsUid = useAdminAccess((s) => s.viewAsUid);
  const setViewAsUid = useAdminAccess((s) => s.setViewAsUid);
  const previewAdmins = useAdminAccess((s) => s.admins);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Start the permissions request as soon as a real account is signed in — in
  // parallel with the `admins/{uid}` check above, not after it. The backend is
  // the authority on admin access (it 403s a non-admin, who never sees the
  // result: AccessDenied renders first), and this cuts one full round trip off
  // the "Verifying admin access…" → dashboard wait.
  const hasRealAccount = useAuthStore((s) => Boolean(s.user && !s.user.isAnonymous));
  useEffect(() => {
    if (hasRealAccount) void initAccess();
  }, [hasRealAccount, initAccess]);

  // Fetch the landing tab's code while auth and permissions are in flight, so it
  // is already on hand when access resolves instead of starting its download then.
  useEffect(() => {
    if (canonicalAdminPath(window.location.pathname) === adminHref("configuration", "overview")) {
      void import("./tabs/BusinessOverviewTab");
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    subscribeConfig("admin");
    subscribeAdminModelCosts();
    // No-op if the early request above is running or done; retries it if it failed.
    void initAccess();
  }, [isAdmin, subscribeConfig, subscribeAdminModelCosts, initAccess]);

  useEffect(() => {
    const canonical = canonicalAdminPath(pathname);
    if (canonical !== pathname) router.replace(canonical);
  }, [pathname, router]);

  const canReachEntry = (entry: (typeof NAV_INDEX)[number]) =>
    entry.ownerOnly ? isOwnerAccess : !entry.key || canRead(entry.key);
  const canReachLeaf = (leaf: NavLeaf) =>
    leaf.ownerOnly ? isOwnerAccess : !leaf.key || canRead(leaf.key);

  useEffect(() => {
    if (!isAdmin || !accessLoaded) return;
    // Match the page the sidebar would highlight, including which catalog
    // segment is open. Print books, the digital edition and Spark packs share
    // one path, so a path-only match that skipped those entries treated every
    // catalog visit as unreachable and sent the admin back to Control Center.
    const current = NAV_INDEX.find((entry) => hrefIsActive(entry.href, pathname, catalogSegment));
    if (current && canReachEntry(current)) return;

    const fallback = NAV_INDEX.find(canReachEntry);
    if (fallback && fallback.href.split("?")[0] !== pathname) router.replace(fallback.href.split("?")[0]!);
  }, [accessLoaded, canRead, catalogSegment, isAdmin, isOwnerAccess, me, pathname, router, viewAsUid]);

  const page = resolveAdminPage(pathname, catalogSegment);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-canvas",
        isDev() ? "h-[calc(100vh-1.5rem)]" : "h-screen",
      )}
    >
      <AdminProgressBar />
      <TopBar
        contextLabel="Admin"
        right={
          <>
            {isAdmin && accessLoaded && (
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                title="Jump to any admin tool (⌘K)"
                className="flex items-center gap-1.5 rounded-full bg-ink-100/80 px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-200/70 hover:text-ink-900"
              >
                <Search className="size-3.5" />
                <span className="hidden md:inline">Jump to…</span>
                <kbd className="hidden rounded bg-white px-1 py-0.2 text-[10px] font-semibold text-ink-500 shadow-2xs sm:inline">
                  ⌘K
                </kbd>
              </button>
            )}
            {isAdmin && (
              <BillingEnvBadge onOpenSystemHealth={() => setConfigTab("system")} />
            )}
            <HelpButton />
            <AuthMenu />
          </>
        }
        left={
          <>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              leftIcon={<Menu className="size-4" />}
              onClick={() => setNavOpen(true)}
              aria-label="Open admin navigation"
            />
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={() => router.push("/studio")}
              aria-label="Back to Studio"
              className="px-2 sm:px-3"
            >
              <span className="hidden sm:inline">Studio</span>
            </Button>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {!ready || !adminReady ? (
          <AdminStartup signedIn={ready} adminVerified={adminReady} permissionsLoaded={accessLoaded} />
        ) : !isAdmin ? (
          <AccessDenied onLeave={() => router.push("/studio")} />
        ) : !accessLoaded ? (
          accessError ? (
            <AccessLoadState error={accessError} onRetry={() => void reloadAccess()} />
          ) : (
            <AdminStartup signedIn adminVerified permissionsLoaded={false} />
          )
        ) : (
          <>
            <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-ink-100 bg-white px-3 py-4 lg:block">
              <SidebarChrome
                pathname={pathname}
                catalogSegment={catalogSegment}
                canReach={canReachLeaf}
                onSearch={() => setPaletteOpen(true)}
              />
            </aside>

            <Drawer
              open={navOpen}
              onClose={() => setNavOpen(false)}
              side="left"
              title="Admin"
              widthClass="max-w-[19rem]"
            >
              <div className="px-3 py-3">
                <SidebarChrome
                  pathname={pathname}
                  catalogSegment={catalogSegment}
                  canReach={canReachLeaf}
                  onSearch={() => {
                    setNavOpen(false);
                    setPaletteOpen(true);
                  }}
                  onNavigate={() => setNavOpen(false)}
                />
              </div>
            </Drawer>

            <div className="min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8">
                <AdminPageHeader
                  title={page.title}
                  description={page.description}
                  domainLabel={page.domainLabel}
                  groupLabel={page.groupLabel}
                  canonicalPath={page.canonicalPath}
                  catalogSegment={catalogSegment}
                  pair={page.pair}
                  canRead={canRead}
                />

                {viewAsUid && (
                  <div className="mb-5 flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
                    <span className="flex items-center gap-2">
                      <Eye className="size-4" />
                      Previewing as{" "}
                      <strong>
                        {previewAdmins.find((a) => a.uid === viewAsUid)?.email ?? viewAsUid}
                      </strong>{" "}
                      — every page renders read-only while this is on.
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => setViewAsUid(null)}>
                      Exit preview
                    </Button>
                  </div>
                )}

                {section === "configuration" && (
                  <SectionGate permissionKey={`configuration.${configTab}`}>
                    <ConfigReady docs={configDocsForPage("configuration", configTab)}>
                      <ConfigTabPanel tab={configTab} />
                    </ConfigReady>
                  </SectionGate>
                )}
                {section === "analysis" && <AnalysisTab />}
                {section === "permissions" && isOwnerAccess && <PermissionsTab />}
                {section === "marketing" && (
                  <SectionGate permissionKey={`marketing.${marketingTab}`}>
                    <ConfigReady docs={configDocsForPage("marketing", marketingTab)}>
                      {marketingTab === "referrals" && <ReferralsTab />}
                      {marketingTab === "affiliates" && <AffiliatesTab />}
                      {marketingTab === "campaigns" && <CampaignsTab />}
                      {marketingTab === "coupons" && <CouponsTab />}
                      {marketingTab === "surveys" && <SurveysTab />}
                      {marketingTab === "announcements" && <AnnouncementsTab />}
                      {marketingTab === "seo" && <SeoTab />}
                      {marketingTab === "blog" && <BlogTab />}
                      {marketingTab === "landingPages" && <LandingPagesTab />}
                      {marketingTab === "branding" && <BrandingTab />}
                      {marketingTab === "qrCodes" && <QrCodesTab />}
                    </ConfigReady>
                  </SectionGate>
                )}
                {section === "communication" && (
                  <SectionGate permissionKey={`communication.${communicationTab}`}>
                    <ConfigReady docs={configDocsForPage("communication", communicationTab)}>
                      {communicationTab === "contact" && <ContactInboxTab />}
                      {communicationTab === "transactional-emails" && <EmailTab />}
                      {communicationTab === "admin-slack" && <SlackTab />}
                    </ConfigReady>
                  </SectionGate>
                )}
                {section === "legal" && (
                  <SectionGate permissionKey={`legal.${legalTab}`}>
                    <ConfigReady docs={configDocsForPage("legal", legalTab)}>
                      {legalTab === "documents" && <LegalDocsTab />}
                      {legalTab === "cookies" && <CookieConsentTab />}
                      {legalTab === "gdpr" && <GdprTab />}
                    </ConfigReady>
                  </SectionGate>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      <AuthDialog />
      <ContactDialog />
      <SettingsDialog />
      <PlansDialog />
      <SparksBadge walletOnly />
      <OrdersDialog open={ordersOpen} onClose={closeOrders} />
      {isAdmin && accessLoaded && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </div>
  );
}

function AccessDenied({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
        <ShieldAlert className="size-6" />
      </span>
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Admin access required</h2>
        <p className="mt-1 max-w-sm text-sm text-ink-500">
          This area is restricted to administrators. Sign in with an admin account, or head back to
          the studio.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onLeave}>
        Back to studio
      </Button>
    </div>
  );
}
