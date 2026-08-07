"use client";

/**
 * Single source of truth for every tab's label + icon across the whole admin
 * dashboard, plus a flattened, searchable index built from it (`NAV_INDEX`) —
 * the data behind the ⌘K command palette (`CommandPalette.tsx`).
 *
 * This used to be scattered: Configuration's tab labels lived inline in
 * `AdminApp.tsx`, Marketing/Communication/Legal had their own inline arrays
 * there too, and Analysis had a third, icon-less copy inside `AnalysisTab.tsx`.
 * Centralizing it here means adding a tab in one place automatically makes it
 * navigable from the sidebar, the tab strip, AND the command palette — nothing
 * to keep in sync by hand.
 */
import type { ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  Coins,
  Cookie,
  Cpu,
  CreditCard,
  DollarSign,
  FileText,
  Handshake,
  Hash,
  HeartPulse,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  Megaphone,
  MessageSquareText,
  MessagesSquare,
  Newspaper,
  Package,
  PartyPopper,
  Percent,
  QrCode,
  Scale,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Stamp,
  Type,
  UserX,
  Users,
  Wand2,
} from "lucide-react";
import {
  ANALYSIS_GROUPS,
  CONFIG_GROUPS,
  useAdminTab,
  type AdminSection,
  type AnalysisTabId,
  type CommunicationTabId,
  type ConfigTabId,
  type LegalTabId,
  type MarketingTabId,
} from "./adminTabStore";

/** Top-level admin sections (rendered as the left sidebar). */
export const SECTIONS: { id: AdminSection; label: string; icon: ReactNode; description: string }[] = [
  { id: "analysis", label: "Analysis", icon: <BarChart3 className="size-4" />, description: "Usage, signups and active users across the product." },
  { id: "configuration", label: "Configuration", icon: <Settings2 className="size-4" />, description: "Global app configuration. Changes apply to everyone immediately." },
  { id: "marketing", label: "Marketing", icon: <Megaphone className="size-4" />, description: "Campaigns and growth tools." },
  { id: "communication", label: "Communication", icon: <MessagesSquare className="size-4" />, description: "Transactional email and Slack notifications." },
  { id: "legal", label: "Legal & Privacy", icon: <Scale className="size-4" />, description: "Legal documents, cookie consent, and GDPR data requests." },
];

export const CONFIG_TAB_META: Record<ConfigTabId, { label: string; icon: ReactNode }> = {
  // Business
  overview: { label: "Overview", icon: <LayoutDashboard className="size-4" /> },
  catalog: { label: "Catalog", icon: <Package className="size-4" /> },
  memberships: { label: "Memberships", icon: <CreditCard className="size-4" /> },
  sparks: { label: "Sparks economy", icon: <Sparkles className="size-4" /> },
  referrals: { label: "Referrals", icon: <Users className="size-4" /> },
  affiliates: { label: "Affiliates", icon: <Handshake className="size-4" /> },
  financial: { label: "Financial settings", icon: <Coins className="size-4" /> },
  discounts: { label: "Discount planner", icon: <Percent className="size-4" /> },
  campaigns: { label: "Campaigns", icon: <Megaphone className="size-4" /> },
  surveys: { label: "Surveys", icon: <ClipboardList className="size-4" /> },
  // AI pipeline
  models: { label: "Models", icon: <Cpu className="size-4" /> },
  modelCosts: { label: "Model costs", icon: <DollarSign className="size-4" /> },
  prompts: { label: "Prompts", icon: <MessageSquareText className="size-4" /> },
  // Creative defaults
  artStyles: { label: "Art styles", icon: <ImageIcon className="size-4" /> },
  layouts: { label: "Page layouts", icon: <LayoutTemplate className="size-4" /> },
  ageWriting: { label: "Age writing", icon: <BookOpen className="size-4" /> },
  storyCraft: { label: "Story craft", icon: <Wand2 className="size-4" /> },
  typography: { label: "Typography", icon: <Type className="size-4" /> },
  // Operations
  system: { label: "System health", icon: <HeartPulse className="size-4" /> },
};

export const ANALYSIS_TAB_META: Record<AnalysisTabId, { label: string; icon: ReactNode }> = {
  users: { label: "Users", icon: <Users className="size-4" /> },
  projects: { label: "Books", icon: <BookOpen className="size-4" /> },
  costs: { label: "Costs", icon: <DollarSign className="size-4" /> },
  finance: { label: "Finance", icon: <Coins className="size-4" /> },
  payments: { label: "Payments", icon: <CreditCard className="size-4" /> },
  products: { label: "Products", icon: <Package className="size-4" /> },
  referrals: { label: "Referrals", icon: <Share2 className="size-4" /> },
  affiliates: { label: "Affiliates", icon: <Handshake className="size-4" /> },
  campaigns: { label: "Campaigns", icon: <Megaphone className="size-4" /> },
  surveys: { label: "Customer profile", icon: <ClipboardList className="size-4" /> },
};

export const MARKETING_TABS: { id: MarketingTabId; label: string; icon: ReactNode }[] = [
  { id: "announcements", label: "Announcements", icon: <PartyPopper className="size-4" /> },
  { id: "seo", label: "SEO", icon: <Search className="size-4" /> },
  { id: "blog", label: "Blog", icon: <Newspaper className="size-4" /> },
  { id: "branding", label: "Branding", icon: <Stamp className="size-4" /> },
  { id: "qrCodes", label: "QR codes", icon: <QrCode className="size-4" /> },
];

export const COMMUNICATION_TABS: { id: CommunicationTabId; label: string; icon: ReactNode }[] = [
  { id: "contact", label: "Contact inbox", icon: <Inbox className="size-4" /> },
  { id: "transactional-emails", label: "Transactional Emails", icon: <Mail className="size-4" /> },
  { id: "admin-slack", label: "Admin Slack", icon: <Hash className="size-4" /> },
];

export const LEGAL_TABS: { id: LegalTabId; label: string; icon: ReactNode }[] = [
  { id: "documents", label: "Documents", icon: <FileText className="size-4" /> },
  { id: "cookies", label: "Cookies", icon: <Cookie className="size-4" /> },
  { id: "gdpr", label: "Data requests", icon: <UserX className="size-4" /> },
];

/** One entry in the command palette's flat, searchable list. */
export interface NavEntry {
  id: string;
  label: string;
  icon: ReactNode;
  sectionLabel: string;
  groupLabel?: string;
  go: () => void;
}

function buildNavIndex(): NavEntry[] {
  const entries: NavEntry[] = [];

  for (const group of CONFIG_GROUPS) {
    for (const tab of group.tabs) {
      const meta = CONFIG_TAB_META[tab];
      entries.push({
        id: `configuration:${tab}`,
        label: meta.label,
        icon: meta.icon,
        sectionLabel: "Configuration",
        groupLabel: group.label,
        go: () => useAdminTab.getState().openConfigTab(tab),
      });
    }
  }

  for (const group of ANALYSIS_GROUPS) {
    for (const tab of group.tabs) {
      const meta = ANALYSIS_TAB_META[tab];
      entries.push({
        id: `analysis:${tab}`,
        label: meta.label,
        icon: meta.icon,
        sectionLabel: "Analysis",
        groupLabel: group.label,
        go: () => useAdminTab.getState().openAnalysis(tab),
      });
    }
  }

  for (const tab of MARKETING_TABS) {
    entries.push({
      id: `marketing:${tab.id}`,
      label: tab.label,
      icon: tab.icon,
      sectionLabel: "Marketing",
      go: () => useAdminTab.getState().openMarketingTab(tab.id),
    });
  }

  for (const tab of COMMUNICATION_TABS) {
    entries.push({
      id: `communication:${tab.id}`,
      label: tab.label,
      icon: tab.icon,
      sectionLabel: "Communication",
      go: () => useAdminTab.getState().openCommunicationTab(tab.id),
    });
  }

  for (const tab of LEGAL_TABS) {
    entries.push({
      id: `legal:${tab.id}`,
      label: tab.label,
      icon: tab.icon,
      sectionLabel: "Legal & Privacy",
      go: () => useAdminTab.getState().openLegalTab(tab.id),
    });
  }

  return entries;
}

/** Every navigable tab in the admin dashboard, flattened for search. Built
 * once at module load — the underlying arrays above are static. */
export const NAV_INDEX: NavEntry[] = buildNavIndex();
