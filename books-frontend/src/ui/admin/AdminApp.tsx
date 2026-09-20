"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Eye, FlaskConical, Loader2, Menu, Rocket, Search, ShieldAlert } from "lucide-react";
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
  canonicalAdminPath,
  type CatalogSegment,
  type ConfigTabId,
} from "./adminTabStore";
import { NAV_INDEX, NAV_TREE, resolveAdminPage, type NavLeaf } from "./adminNav";
import { AdminSidebarNav } from "./AdminSidebarNav";
import { AdminPageHeader } from "./AdminPageHeader";
import { CommandPalette } from "./CommandPalette";
import { ModelConfigTab } from "./tabs/ModelConfigTab";
import { ArtStylesTab } from "./tabs/ArtStylesTab";
import { LayoutsTab } from "./tabs/LayoutsTab";
import { AudienceTab } from "./tabs/AudienceTab";
import { StoryCraftTab } from "./tabs/StoryCraftTab";
import { BookLanguagesTab } from "./tabs/BookLanguagesTab";
import { TypographyTab } from "./tabs/TypographyTab";
import { GuideTab } from "./tabs/GuideTab";
import { PromptsTab } from "./tabs/PromptsTab";
import { ModelCostsTab } from "./tabs/ModelCostsTab";
import { BusinessOverviewTab } from "./tabs/BusinessOverviewTab";
import { CatalogTab } from "./tabs/CatalogTab";
import { MarketsTab } from "./tabs/MarketsTab";
import { FinancialTab } from "./tabs/FinancialTab";
import { DiscountPlannerTab } from "./tabs/DiscountPlannerTab";
import { PlansTab } from "./tabs/PlansTab";
import { SparksTab } from "./tabs/SparksTab";
import { ReferralsTab } from "./tabs/ReferralsTab";
import { AffiliatesTab } from "./tabs/AffiliatesTab";
import { CampaignsTab } from "./tabs/CampaignsTab";
import { CouponsTab } from "./tabs/CouponsTab";
import { SurveysTab } from "./tabs/SurveysTab";
import { SystemHealthTab } from "./tabs/SystemHealthTab";
import { SeoTab } from "./tabs/marketing/SeoTab";
import { BlogTab } from "./tabs/marketing/BlogTab";
import { BrandingTab } from "./tabs/marketing/BrandingTab";
import { QrCodesTab } from "./tabs/marketing/QrCodesTab";
import { AnnouncementsTab } from "./tabs/marketing/AnnouncementsTab";
import { ContactInboxTab } from "./tabs/communication/ContactInboxTab";
import { EmailTab } from "./tabs/communication/EmailTab";
import { SlackTab } from "./tabs/communication/SlackTab";
import { LegalDocsTab } from "./tabs/legal/LegalDocsTab";
import { CookieConsentTab } from "./tabs/legal/CookieConsentTab";
import { GdprTab } from "./tabs/legal/GdprTab";
import { AnalysisTab } from "./analysis/AnalysisTab";
import { PermissionsTab } from "./tabs/PermissionsTab";

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
  const isLive = runtime.env === "live";

  return (
    <button
      type="button"
      onClick={onOpenSystemHealth}
      title="Sandbox/live billing mode — click to manage in System health"
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
        isLive
          ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
          : "bg-sky-100 text-sky-700 hover:bg-sky-200",
      )}
    >
      {isLive ? <Rocket className="size-3.5" /> : <FlaskConical className="size-3.5" />}
      <span className="hidden sm:inline">{isLive ? "Live billing" : "Sandbox billing"}</span>
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
    <>
      <button
        type="button"
        onClick={onSearch}
        className="mb-4 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-400 transition hover:bg-ink-50 hover:text-ink-600"
      >
        <Search className="size-3.5" />
        Search
        <kbd className="ml-auto rounded border border-ink-200 bg-white px-1 py-0.5 text-[10px] font-medium text-ink-400">
          ⌘K
        </kbd>
      </button>
      <AdminSidebarNav
        tree={NAV_TREE}
        pathname={pathname}
        catalogSegment={catalogSegment}
        canReach={canReach}
        onNavigate={onNavigate}
      />
    </>
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

  useEffect(() => {
    if (!isAdmin) return;
    subscribeConfig();
    subscribeAdminModelCosts();
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
    const current = NAV_INDEX.find((entry) => {
      const [path] = entry.href.split("?");
      return path === canonicalAdminPath(pathname) && !entry.id.includes(":catalog:");
    });
    const currentIsReachable = current && canReachEntry(current);
    if (currentIsReachable) return;

    const fallback = NAV_INDEX.find(canReachEntry);
    if (fallback && fallback.href.split("?")[0] !== pathname) router.replace(fallback.href.split("?")[0]!);
  }, [accessLoaded, canRead, isAdmin, isOwnerAccess, me, pathname, router, viewAsUid]);

  const page = resolveAdminPage(pathname, catalogSegment);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-canvas",
        isDev() ? "h-[calc(100vh-1.5rem)]" : "h-screen",
      )}
    >
      <TopBar
        contextLabel="Admin"
        right={
          <>
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
              className="sm:hidden"
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
        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-7 animate-spin text-brand-400" />
          </div>
        ) : !isAdmin ? (
          <AccessDenied onLeave={() => router.push("/studio")} />
        ) : !accessLoaded ? (
          <AccessLoadState error={accessError} onRetry={() => void reloadAccess()} />
        ) : (
          <>
            <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-ink-100 bg-white px-3 py-4 lg:block">
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
              widthClass="max-w-[18rem]"
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
                <AdminPageHeader title={page.title} description={page.description} />

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
                    <ConfigTabPanel tab={configTab} />
                  </SectionGate>
                )}
                {section === "analysis" && <AnalysisTab />}
                {section === "permissions" && isOwnerAccess && <PermissionsTab />}
                {section === "marketing" && (
                  <SectionGate permissionKey={`marketing.${marketingTab}`}>
                    {marketingTab === "referrals" && <ReferralsTab />}
                    {marketingTab === "affiliates" && <AffiliatesTab />}
                    {marketingTab === "campaigns" && <CampaignsTab />}
                    {marketingTab === "coupons" && <CouponsTab />}
                    {marketingTab === "surveys" && <SurveysTab />}
                    {marketingTab === "announcements" && <AnnouncementsTab />}
                    {marketingTab === "seo" && <SeoTab />}
                    {marketingTab === "blog" && <BlogTab />}
                    {marketingTab === "branding" && <BrandingTab />}
                    {marketingTab === "qrCodes" && <QrCodesTab />}
                  </SectionGate>
                )}
                {section === "communication" && (
                  <SectionGate permissionKey={`communication.${communicationTab}`}>
                    {communicationTab === "contact" && <ContactInboxTab />}
                    {communicationTab === "transactional-emails" && <EmailTab />}
                    {communicationTab === "admin-slack" && <SlackTab />}
                  </SectionGate>
                )}
                {section === "legal" && (
                  <SectionGate permissionKey={`legal.${legalTab}`}>
                    {legalTab === "documents" && <LegalDocsTab />}
                    {legalTab === "cookies" && <CookieConsentTab />}
                    {legalTab === "gdpr" && <GdprTab />}
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
