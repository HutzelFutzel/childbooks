"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Eye, FlaskConical, Loader2, Rocket, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/ui/components/Button";
import { Tabs } from "@/ui/components/Tabs";
import { Toaster } from "@/ui/components/Toaster";
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
import { filterReadableTabs, SectionGate } from "./AccessGate";
import type { PermissionKey } from "@/core/config/permissions";
import {
  useAdminTab,
  adminHref,
  adminSectionHref,
  canonicalAdminPath,
  ANALYSIS_GROUPS,
  CONFIG_GROUPS,
  MARKETING_GROUPS,
  type AdminSection,
  type ConfigTabId,
  type CommunicationTabId,
  type LegalTabId,
  type MarketingTabId,
} from "./adminTabStore";
import {
  SECTIONS,
  CONFIG_TAB_META,
  ANALYSIS_TAB_META,
  MARKETING_TAB_META,
  COMMUNICATION_TABS,
  LEGAL_TABS,
  NAV_INDEX,
} from "./adminNav";
import { CommandPalette } from "./CommandPalette";
import { ModelConfigTab } from "./tabs/ModelConfigTab";
import { ArtStylesTab } from "./tabs/ArtStylesTab";
import { LayoutsTab } from "./tabs/LayoutsTab";
import { AgeWritingTab } from "./tabs/AgeWritingTab";
import { StoryCraftTab } from "./tabs/StoryCraftTab";
import { BookLanguagesTab } from "./tabs/BookLanguagesTab";
import { TypographyTab } from "./tabs/TypographyTab";
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
    case "ageWriting":
      return <AgeWritingTab />;
    case "storyCraft":
      return <StoryCraftTab />;
    case "bookLanguages":
      return <BookLanguagesTab />;
    case "typography":
      return <TypographyTab />;
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
  const setSection = useAdminTab((s) => s.setSection);
  const configGroup = useAdminTab((s) => s.configGroup);
  const configTab = useAdminTab((s) => s.configTab);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const marketingGroup = useAdminTab((s) => s.marketingGroup);
  const marketingTab = useAdminTab((s) => s.marketingTab);
  const setMarketingTab = useAdminTab((s) => s.setMarketingTab);
  const communicationTab = useAdminTab((s) => s.communicationTab);
  const setCommunicationTab = useAdminTab((s) => s.setCommunicationTab);
  const legalTab = useAdminTab((s) => s.legalTab);
  const setLegalTab = useAdminTab((s) => s.setLegalTab);
  // Only needed here for the breadcrumb — AnalysisTab owns its own copies for
  // rendering its group pills.
  const analysisGroup = useAdminTab((s) => s.analysisGroup);
  const analysisTab = useAdminTab((s) => s.analysisTab);
  const ordersOpen = useAccountUiStore((s) => s.ordersOpen);
  const closeOrders = useAccountUiStore((s) => s.closeOrders);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const initAccess = useAdminAccess((s) => s.init);
  const accessLoaded = useAdminAccess((s) => s.loaded);
  const canRead = useAdminAccess((s) => s.canRead);
  // `canRead` is a stable function reference for the whole session (it's a
  // zustand action, never reassigned), so memoizing on it alone would freeze
  // the nav-filtering results at whatever `canRead` returned during the very
  // first render — before `initAccess()` (kicked off in a `useEffect` below)
  // has had a chance to populate `me`. Depending on the actual state that
  // `canRead` reads keeps these memos correctly reactive once access loads.
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
    // The full rate table is an admin-only doc, so it has its own subscription.
    subscribeAdminModelCosts();
    void initAccess();
  }, [isAdmin, subscribeConfig, subscribeAdminModelCosts, initAccess]);

  useEffect(() => {
    const canonical = canonicalAdminPath(pathname);
    if (canonical !== pathname) router.replace(canonical);
  }, [pathname, router]);

  useEffect(() => {
    if (!isAdmin || !accessLoaded) return;
    const current = NAV_INDEX.find((entry) => entry.href === canonicalAdminPath(pathname));
    const currentIsReachable =
      current && (current.ownerOnly ? isOwnerAccess : !current.key || canRead(current.key));
    if (currentIsReachable) return;

    const fallback = NAV_INDEX.find((entry) =>
      entry.ownerOnly ? isOwnerAccess : !entry.key || canRead(entry.key),
    );
    if (fallback && fallback.href !== pathname) router.replace(fallback.href);
  }, [accessLoaded, canRead, isAdmin, isOwnerAccess, me, pathname, router, viewAsUid]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const canReachEntry = (entry: (typeof NAV_INDEX)[number]) =>
    entry.ownerOnly ? isOwnerAccess : !entry.key || canRead(entry.key);
  // Hide sections with no readable destination and point each remaining
  // section at its first permitted page, not necessarily its global default.
  const visibleSections = SECTIONS.filter(
    (candidate) =>
      (candidate.id !== "permissions" || isOwnerAccess) &&
      (!accessLoaded ||
        NAV_INDEX.some(
          (entry) => entry.id.startsWith(`${candidate.id}:`) && canReachEntry(entry),
        )),
  );
  const hrefForSection = (target: AdminSection) =>
    NAV_INDEX.find(
      (entry) => entry.id.startsWith(`${target}:`) && canReachEntry(entry),
    )?.href ?? adminSectionHref(target);

  const visibleConfigGroups = useMemo(
    () =>
      CONFIG_GROUPS.map((g) => ({ ...g, tabs: filterReadableTabs("configuration", g.tabs, canRead) })).filter(
        (g) => g.tabs.length > 0,
      ),
    [canRead, me, previewAdmins, viewAsUid],
  );
  const activeGroup =
    visibleConfigGroups.find((g) => g.id === configGroup) ?? visibleConfigGroups[0] ?? CONFIG_GROUPS[0];
  const groupTabs = activeGroup.tabs.map((id) => ({
    id,
    label: CONFIG_TAB_META[id].label,
    icon: CONFIG_TAB_META[id].icon,
    href: adminHref("configuration", id),
  }));

  const visibleMarketingGroups = useMemo(
    () =>
      MARKETING_GROUPS.map((g) => ({ ...g, tabs: filterReadableTabs("marketing", g.tabs, canRead) })).filter(
        (g) => g.tabs.length > 0,
      ),
    [canRead, me, previewAdmins, viewAsUid],
  );
  const activeMarketingGroup =
    visibleMarketingGroups.find((g) => g.id === marketingGroup) ??
    visibleMarketingGroups[0] ??
    MARKETING_GROUPS[0];
  const marketingGroupTabs = activeMarketingGroup.tabs.map((id) => ({
    id,
    label: MARKETING_TAB_META[id].label,
    icon: MARKETING_TAB_META[id].icon,
    href: adminHref("marketing", id),
  }));

  const visibleCommunicationTabs = useMemo(
    () =>
      COMMUNICATION_TABS.filter((t) => canRead(`communication.${t.id}` as PermissionKey)),
    [canRead, me, previewAdmins, viewAsUid],
  );
  const visibleLegalTabs = useMemo(
    () => LEGAL_TABS.filter((t) => canRead(`legal.${t.id}` as PermissionKey)),
    [canRead, me, previewAdmins, viewAsUid],
  );

  // A persistent "you are here" trail — the deep nav (section → group → tab)
  // is otherwise only visible in the pill row you clicked to get there, which
  // scrolls out of the way once you're reading a tab's content. Segments with
  // an `onClick` jump back up a level (e.g. clicking the group name resets to
  // that group's first tab); the leaf segment is inert.
  const breadcrumb: { label: string; href?: string }[] = (() => {
    switch (section) {
      case "configuration":
        return [
          { label: "Configuration", href: adminHref("configuration") },
          {
            label: activeGroup.label,
            href: adminHref("configuration", activeGroup.tabs[0] ?? "overview"),
          },
          { label: CONFIG_TAB_META[configTab].label },
        ];
      case "analysis": {
        const group = ANALYSIS_GROUPS.find((g) => g.id === analysisGroup) ?? ANALYSIS_GROUPS[0];
        return [
          { label: "Analysis", href: adminHref("analysis") },
          {
            label: group.label,
            href: adminHref("analysis", group.tabs[0] ?? "users"),
          },
          { label: ANALYSIS_TAB_META[analysisTab].label },
        ];
      }
      case "marketing":
        return [
          { label: "Marketing", href: adminHref("marketing") },
          {
            label: activeMarketingGroup.label,
            href: adminHref("marketing", activeMarketingGroup.tabs[0] ?? "referrals"),
          },
          { label: MARKETING_TAB_META[marketingTab].label },
        ];
      case "communication":
        return [
          { label: "Communication", href: adminHref("communication") },
          { label: COMMUNICATION_TABS.find((t) => t.id === communicationTab)?.label ?? "" },
        ];
      case "legal":
        return [
          { label: "Legal & Privacy", href: adminHref("legal") },
          { label: LEGAL_TABS.find((t) => t.id === legalTab)?.label ?? "" },
        ];
      default:
        return [{ label: active.label }];
    }
  })();

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-canvas",
        // Leaves room for the dev-environment banner (`h-6`) above it instead
        // of overflowing past the viewport — see ui/layout/DevEnvironmentBanner.
        isDev() ? "h-[calc(100vh-1.5rem)]" : "h-screen",
      )}
    >
      <TopBar
        right={
          <>
            {isAdmin && (
              <BillingEnvBadge
                onOpenSystemHealth={() => setConfigTab("system")}
              />
            )}
            <HelpButton />
            <AuthMenu />
          </>
        }
        left={
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
        }
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-7 animate-spin text-brand-400" />
          </div>
        ) : !isAdmin ? (
          <AccessDenied onLeave={() => router.push("/studio")} />
        ) : (
          <>
            <aside className="hidden w-56 shrink-0 border-r border-ink-100 bg-white/60 px-3 py-5 sm:block">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                Admin
              </p>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="mb-3 flex w-full items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-xs font-medium text-ink-400 ring-1 ring-inset ring-ink-100 transition hover:bg-ink-100 hover:text-ink-600"
              >
                <Search className="size-3.5" />
                Search
                <kbd className="ml-auto rounded border border-ink-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-ink-400">
                  ⌘K
                </kbd>
              </button>
              <nav className="space-y-1">
                {visibleSections.map((s) => (
                  <Link
                    key={s.id}
                    href={section === s.id ? canonicalAdminPath(pathname) : hrefForSection(s.id)}
                    aria-current={section === s.id ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      section === s.id
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-600 hover:bg-ink-100",
                    )}
                  >
                    {s.icon}
                    {s.label}
                  </Link>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 flex-1 overflow-y-auto">
              {/* Mobile section switcher */}
              <div className="sticky top-0 z-10 border-b border-ink-100 bg-canvas/80 px-5 py-2 backdrop-blur sm:hidden">
                <Tabs
                  items={visibleSections.map((s) => ({
                    id: s.id,
                    label: s.label,
                    icon: s.icon,
                    href:
                      section === s.id
                        ? canonicalAdminPath(pathname)
                        : hrefForSection(s.id),
                  }))}
                  value={section}
                  onChange={(id) => setSection(id as AdminSection)}
                />
              </div>

              <div className="mx-auto w-full max-w-5xl px-5 py-8">
                <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs font-medium text-ink-400">
                  {breadcrumb.map((crumb, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="size-3 shrink-0" />}
                      {crumb.href && i !== breadcrumb.length - 1 ? (
                        <Link
                          href={crumb.href}
                          className="rounded px-0.5 transition-colors hover:text-ink-600 hover:underline"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className={i === breadcrumb.length - 1 ? "text-ink-600" : undefined}>
                          {crumb.label}
                        </span>
                      )}
                    </span>
                  ))}
                </nav>
                <header className="mb-6">
                  <h1 className="text-xl font-bold text-ink-900">{active.label}</h1>
                  <p className="text-sm text-ink-500">{active.description}</p>
                </header>

                {viewAsUid && (
                  <div className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
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
                  <div className="space-y-5">
                    <div className="flex flex-wrap gap-2">
                      {visibleConfigGroups.map((group) => (
                        <Link
                          key={group.id}
                          href={adminHref(
                            "configuration",
                            group.tabs[0] as ConfigTabId,
                          )}
                          aria-current={configGroup === group.id ? "location" : undefined}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                            configGroup === group.id
                              ? "bg-brand-600 text-white shadow-sm"
                              : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50",
                          )}
                        >
                          {group.label}
                        </Link>
                      ))}
                    </div>
                    <p className="text-xs text-ink-400">{activeGroup.description}</p>
                    <Tabs
                      items={groupTabs}
                      value={configTab}
                      onChange={(id) => setConfigTab(id as ConfigTabId)}
                    />
                    <SectionGate permissionKey={`configuration.${configTab}`}>
                      <ConfigTabPanel tab={configTab} />
                    </SectionGate>
                  </div>
                )}

                {section === "analysis" && <AnalysisTab />}
                {section === "permissions" && isOwnerAccess && <PermissionsTab />}
                {section === "marketing" && (
                  <div className="space-y-5">
                    <div className="flex flex-wrap gap-2">
                      {visibleMarketingGroups.map((group) => (
                        <Link
                          key={group.id}
                          href={adminHref(
                            "marketing",
                            group.tabs[0] as MarketingTabId,
                          )}
                          aria-current={marketingGroup === group.id ? "location" : undefined}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                            marketingGroup === group.id
                              ? "bg-brand-600 text-white shadow-sm"
                              : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50",
                          )}
                        >
                          {group.label}
                        </Link>
                      ))}
                    </div>
                    <p className="text-xs text-ink-400">{activeMarketingGroup.description}</p>
                    <Tabs
                      items={marketingGroupTabs}
                      value={marketingTab}
                      onChange={(id) => setMarketingTab(id as MarketingTabId)}
                    />
                    <SectionGate permissionKey={`marketing.${marketingTab}`}>
                      {marketingTab === "referrals" && <ReferralsTab />}
                      {marketingTab === "affiliates" && <AffiliatesTab />}
                      {marketingTab === "campaigns" && <CampaignsTab />}
                      {marketingTab === "surveys" && <SurveysTab />}
                      {marketingTab === "announcements" && <AnnouncementsTab />}
                      {marketingTab === "seo" && <SeoTab />}
                      {marketingTab === "blog" && <BlogTab />}
                      {marketingTab === "branding" && <BrandingTab />}
                      {marketingTab === "qrCodes" && <QrCodesTab />}
                    </SectionGate>
                  </div>
                )}
                {section === "communication" && (
                  <div className="space-y-6">
                    <Tabs
                      items={visibleCommunicationTabs.map((tab) => ({
                        ...tab,
                        href: adminHref("communication", tab.id),
                      }))}
                      value={communicationTab}
                      onChange={(id) => setCommunicationTab(id as CommunicationTabId)}
                    />
                    <SectionGate permissionKey={`communication.${communicationTab}`}>
                      {communicationTab === "contact" && <ContactInboxTab />}
                      {communicationTab === "transactional-emails" && <EmailTab />}
                      {communicationTab === "admin-slack" && <SlackTab />}
                    </SectionGate>
                  </div>
                )}
                {section === "legal" && (
                  <div className="space-y-6">
                    <Tabs
                      items={visibleLegalTabs.map((tab) => ({
                        ...tab,
                        href: adminHref("legal", tab.id),
                      }))}
                      value={legalTab}
                      onChange={(id) => setLegalTab(id as LegalTabId)}
                    />
                    <SectionGate permissionKey={`legal.${legalTab}`}>
                      {legalTab === "documents" && <LegalDocsTab />}
                      {legalTab === "cookies" && <CookieConsentTab />}
                      {legalTab === "gdpr" && <GdprTab />}
                    </SectionGate>
                  </div>
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
      {isAdmin && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
      <Toaster />
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
