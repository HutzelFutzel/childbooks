"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Cpu,
  DollarSign,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Package,
  Settings2,
  ShieldAlert,
  Sparkles,
  Stamp,
  Tags,
  CreditCard,
  Gauge,
  Workflow,
  HeartPulse,
} from "lucide-react";
import { Button } from "@/ui/components/Button";
import { Tabs } from "@/ui/components/Tabs";
import { Toaster } from "@/ui/components/Toaster";
import { TopBar } from "@/ui/layout/TopBar";
import { AuthMenu } from "@/ui/auth/AuthMenu";
import { AuthDialog } from "@/ui/auth/AuthDialog";
import { cn } from "@/ui/lib/cn";
import { useAuthStore } from "@/state/authStore";
import { useAppConfigStore } from "@/state/appConfigStore";
import { useAdminTab, type AdminSection } from "./adminTabStore";
import { ModelConfigTab } from "./tabs/ModelConfigTab";
import { ArtStylesTab } from "./tabs/ArtStylesTab";
import { ModelCostsTab } from "./tabs/ModelCostsTab";
import { ProductsTab } from "./tabs/ProductsTab";
import { PricingSettingsTab } from "./tabs/PricingSettingsTab";
import { PlansTab } from "./tabs/PlansTab";
import { SparksTab } from "./tabs/SparksTab";
import { CostIntelligenceTab } from "./tabs/CostIntelligenceTab";
import { BrandingTab } from "./tabs/BrandingTab";
import { ActionsTab } from "./tabs/ActionsTab";
import { SystemHealthTab } from "./tabs/SystemHealthTab";
import { MarketingTab } from "./tabs/MarketingTab";
import { AnalysisTab } from "./analysis/AnalysisTab";

const SECTIONS: { id: AdminSection; label: string; icon: ReactNode; description: string }[] = [
  { id: "analysis", label: "Analysis", icon: <BarChart3 className="size-4" />, description: "Usage, signups and active users across the product." },
  { id: "configuration", label: "Configuration", icon: <Settings2 className="size-4" />, description: "Global app configuration. Changes apply to everyone immediately." },
  { id: "marketing", label: "Marketing", icon: <Megaphone className="size-4" />, description: "Campaigns and growth tools." },
];

const CONFIG_TABS = [
  { id: "actions", label: "Actions", icon: <Workflow className="size-4" /> },
  { id: "products", label: "Products", icon: <Package className="size-4" /> },
  { id: "pricing", label: "Pricing settings", icon: <Tags className="size-4" /> },
  { id: "plans", label: "Plans", icon: <CreditCard className="size-4" /> },
  { id: "sparks", label: "Sparks", icon: <Sparkles className="size-4" /> },
  { id: "costs", label: "Cost intelligence", icon: <Gauge className="size-4" /> },
  { id: "models", label: "Models", icon: <Cpu className="size-4" /> },
  { id: "artStyles", label: "Art styles", icon: <ImageIcon className="size-4" /> },
  { id: "branding", label: "Branding", icon: <Stamp className="size-4" /> },
  { id: "modelCosts", label: "Model costs", icon: <DollarSign className="size-4" /> },
  { id: "system", label: "System health", icon: <HeartPulse className="size-4" /> },
];

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
  const section = useAdminTab((s) => s.section);
  const setSection = useAdminTab((s) => s.setSection);
  const configTab = useAdminTab((s) => s.configTab);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (isAdmin) subscribeConfig();
  }, [isAdmin, subscribeConfig]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

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
                  <div className="space-y-6">
                    <Tabs
                      items={CONFIG_TABS}
                      value={configTab}
                      onChange={(id) => setConfigTab(id as typeof configTab)}
                    />
                    {configTab === "actions" && <ActionsTab />}
                    {configTab === "products" && <ProductsTab />}
                    {configTab === "pricing" && <PricingSettingsTab />}
                    {configTab === "plans" && <PlansTab />}
                    {configTab === "sparks" && <SparksTab />}
                    {configTab === "costs" && <CostIntelligenceTab />}
                    {configTab === "models" && <ModelConfigTab />}
                    {configTab === "artStyles" && <ArtStylesTab />}
                    {configTab === "branding" && <BrandingTab />}
                    {configTab === "modelCosts" && <ModelCostsTab />}
                    {configTab === "system" && <SystemHealthTab />}
                  </div>
                )}

                {section === "analysis" && <AnalysisTab />}
                {section === "marketing" && <MarketingTab />}
              </div>
            </div>
          </>
        )}
      </main>

      <AuthDialog />
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
