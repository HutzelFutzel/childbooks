"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Coins,
  Cpu,
  DollarSign,
  Image as ImageIcon,
  LayoutDashboard,
  Loader2,
  Megaphone,
  Package,
  Settings2,
  ShieldAlert,
  Sparkles,
  Stamp,
  CreditCard,
  Gauge,
  HeartPulse,
  Search,
  MessageSquareText,
  MessagesSquare,
  Hash,
  Mail,
  Type,
} from "lucide-react";
import { Button } from "@/ui/components/Button";
import { Tabs } from "@/ui/components/Tabs";
import { Toaster } from "@/ui/components/Toaster";
import { TopBar } from "@/ui/layout/TopBar";
import { AuthMenu } from "@/ui/auth/AuthMenu";
import { AuthDialog } from "@/ui/auth/AuthDialog";
import { SettingsDialog } from "@/ui/settings/SettingsDialog";
import { OrdersDialog } from "@/ui/checkout/OrdersDialog";
import { PlansDialog } from "@/ui/billing/PlansDialog";
import { cn } from "@/ui/lib/cn";
import { useAuthStore } from "@/state/authStore";
import { useAccountUiStore } from "@/state/accountUiStore";
import { useAppConfigStore } from "@/state/appConfigStore";
import {
  useAdminTab,
  CONFIG_GROUPS,
  type AdminSection,
  type ConfigGroupId,
  type ConfigTabId,
  type CommunicationTabId,
} from "./adminTabStore";
import { ModelConfigTab } from "./tabs/ModelConfigTab";
import { ArtStylesTab } from "./tabs/ArtStylesTab";
import { AgeWritingTab } from "./tabs/AgeWritingTab";
import { TypographyTab } from "./tabs/TypographyTab";
import { PromptsTab } from "./tabs/PromptsTab";
import { ModelCostsTab } from "./tabs/ModelCostsTab";
import { BusinessOverviewTab } from "./tabs/BusinessOverviewTab";
import { CatalogTab } from "./tabs/CatalogTab";
import { FinancialTab } from "./tabs/FinancialTab";
import { PlansTab } from "./tabs/PlansTab";
import { SparksTab } from "./tabs/SparksTab";
import { CostIntelligenceTab } from "./tabs/CostIntelligenceTab";
import { SystemHealthTab } from "./tabs/SystemHealthTab";
import { SeoTab } from "./tabs/marketing/SeoTab";
import { BrandingTab } from "./tabs/marketing/BrandingTab";
import { EmailTab } from "./tabs/communication/EmailTab";
import { SlackTab } from "./tabs/communication/SlackTab";
import { AnalysisTab } from "./analysis/AnalysisTab";

const SECTIONS: { id: AdminSection; label: string; icon: ReactNode; description: string }[] = [
  { id: "analysis", label: "Analysis", icon: <BarChart3 className="size-4" />, description: "Usage, signups and active users across the product." },
  { id: "configuration", label: "Configuration", icon: <Settings2 className="size-4" />, description: "Global app configuration. Changes apply to everyone immediately." },
  { id: "marketing", label: "Marketing", icon: <Megaphone className="size-4" />, description: "Campaigns and growth tools." },
  { id: "communication", label: "Communication", icon: <MessagesSquare className="size-4" />, description: "Transactional email and Slack notifications." },
];

const CONFIG_TAB_META: Record<
  ConfigTabId,
  { label: string; icon: ReactNode }
> = {
  // Business
  overview: { label: "Overview", icon: <LayoutDashboard className="size-4" /> },
  catalog: { label: "Catalog", icon: <Package className="size-4" /> },
  memberships: { label: "Memberships", icon: <CreditCard className="size-4" /> },
  sparks: { label: "Sparks economy", icon: <Sparkles className="size-4" /> },
  financial: { label: "Financial settings", icon: <Coins className="size-4" /> },
  // AI pipeline
  models: { label: "Models", icon: <Cpu className="size-4" /> },
  modelCosts: { label: "Model costs", icon: <DollarSign className="size-4" /> },
  prompts: { label: "Prompts", icon: <MessageSquareText className="size-4" /> },
  costs: { label: "Cost intelligence", icon: <Gauge className="size-4" /> },
  // Creative defaults
  artStyles: { label: "Art styles", icon: <ImageIcon className="size-4" /> },
  ageWriting: { label: "Age writing", icon: <BookOpen className="size-4" /> },
  typography: { label: "Typography", icon: <Type className="size-4" /> },
  // Operations
  system: { label: "System health", icon: <HeartPulse className="size-4" /> },
};

const MARKETING_TABS = [
  { id: "seo", label: "SEO", icon: <Search className="size-4" /> },
  { id: "branding", label: "Branding", icon: <Stamp className="size-4" /> },
];

const COMMUNICATION_TABS = [
  { id: "transactional-emails", label: "Transactional Emails", icon: <Mail className="size-4" /> },
  { id: "admin-slack", label: "Admin Slack", icon: <Hash className="size-4" /> },
];

function ConfigTabPanel({ tab }: { tab: ConfigTabId }) {
  switch (tab) {
    case "overview":
      return <BusinessOverviewTab />;
    case "catalog":
      return <CatalogTab />;
    case "memberships":
      return <PlansTab />;
    case "sparks":
      return <SparksTab />;
    case "financial":
      return <FinancialTab />;
    case "costs":
      return <CostIntelligenceTab />;
    case "models":
      return <ModelConfigTab />;
    case "artStyles":
      return <ArtStylesTab />;
    case "ageWriting":
      return <AgeWritingTab />;
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
 * Admin-only dashboard, served at `/admin`. The `isAdmin` check below is a
 * cosmetic gate — every write goes through the backend `/admin/*` routes which
 * independently enforce admin status, so a non-admin reaching this page can't do
 * anything anyway.
 */
export default function AdminApp() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const ready = useAuthStore((s) => s.ready);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const subscribeConfig = useAppConfigStore((s) => s.subscribe);
  const subscribeAdminModelCosts = useAppConfigStore((s) => s.subscribeAdminModelCosts);
  const section = useAdminTab((s) => s.section);
  const setSection = useAdminTab((s) => s.setSection);
  const configGroup = useAdminTab((s) => s.configGroup);
  const setConfigGroup = useAdminTab((s) => s.setConfigGroup);
  const configTab = useAdminTab((s) => s.configTab);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const marketingTab = useAdminTab((s) => s.marketingTab);
  const setMarketingTab = useAdminTab((s) => s.setMarketingTab);
  const communicationTab = useAdminTab((s) => s.communicationTab);
  const setCommunicationTab = useAdminTab((s) => s.setCommunicationTab);
  const ordersOpen = useAccountUiStore((s) => s.ordersOpen);
  const closeOrders = useAccountUiStore((s) => s.closeOrders);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (!isAdmin) return;
    subscribeConfig();
    // The full rate table is an admin-only doc, so it has its own subscription.
    subscribeAdminModelCosts();
  }, [isAdmin, subscribeConfig, subscribeAdminModelCosts]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const activeGroup = CONFIG_GROUPS.find((g) => g.id === configGroup) ?? CONFIG_GROUPS[0];
  const groupTabs = activeGroup.tabs.map((id) => ({
    id,
    label: CONFIG_TAB_META[id].label,
    icon: CONFIG_TAB_META[id].icon,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <TopBar
        right={<AuthMenu />}
        left={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="size-4" />}
            onClick={() => router.push("/studio")}
          >
            Studio
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
              <nav className="space-y-1">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      section === s.id
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-600 hover:bg-ink-100",
                    )}
                  >
                    {s.icon}
                    {s.label}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 flex-1 overflow-y-auto">
              {/* Mobile section switcher */}
              <div className="sticky top-0 z-10 border-b border-ink-100 bg-canvas/80 px-5 py-2 backdrop-blur sm:hidden">
                <Tabs
                  items={SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
                  value={section}
                  onChange={(id) => setSection(id as AdminSection)}
                />
              </div>

              <div className="mx-auto w-full max-w-5xl px-5 py-8">
                <header className="mb-6">
                  <h1 className="text-xl font-bold text-ink-900">{active.label}</h1>
                  <p className="text-sm text-ink-500">{active.description}</p>
                </header>

                {section === "configuration" && (
                  <div className="space-y-5">
                    <div className="flex flex-wrap gap-2">
                      {CONFIG_GROUPS.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => setConfigGroup(group.id as ConfigGroupId)}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                            configGroup === group.id
                              ? "bg-brand-600 text-white shadow-sm"
                              : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50",
                          )}
                        >
                          {group.label}
                        </button>
                      ))}
                    </div>
                    <Tabs
                      items={groupTabs}
                      value={configTab}
                      onChange={(id) => setConfigTab(id as ConfigTabId)}
                    />
                    <ConfigTabPanel tab={configTab} />
                  </div>
                )}

                {section === "analysis" && <AnalysisTab />}
                {section === "marketing" && (
                  <div className="space-y-6">
                    <Tabs
                      items={MARKETING_TABS}
                      value={marketingTab}
                      onChange={(id) => setMarketingTab(id as typeof marketingTab)}
                    />
                    {marketingTab === "seo" && <SeoTab />}
                    {marketingTab === "branding" && <BrandingTab />}
                  </div>
                )}
                {section === "communication" && (
                  <div className="space-y-6">
                    <Tabs
                      items={COMMUNICATION_TABS}
                      value={communicationTab}
                      onChange={(id) => setCommunicationTab(id as CommunicationTabId)}
                    />
                    {communicationTab === "transactional-emails" && <EmailTab />}
                    {communicationTab === "admin-slack" && <SlackTab />}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      <AuthDialog />
      <SettingsDialog />
      <PlansDialog />
      <OrdersDialog open={ordersOpen} onClose={closeOrders} />
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
