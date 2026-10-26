"use client";

/**
 * Single source of truth for every tab's label, icon, domain workspace, and
 * one-line purpose across the whole admin dashboard.
 *
 * - `NAV_TREE` organizes the dashboard into 6 domain-centric workspaces
 *   (Commerce & Orders, Customers & Books, Economy & Finance, Growth &
 *   Marketing, Studio & AI, Operations & Legal) plus the pinned Control Center,
 *   keeping Settings and Analytics side-by-side within each domain.
 * - `PAIRED_VIEWS` connects each feature's configuration screen with its
 *   live analytics counterpart so `AdminPageHeader` can render a 1-click
 *   [Configure ↔ Analytics] segmented switcher.
 * - `NAV_INDEX` is the flattened list for the ⌘K Command Palette.
 * - Permission keys and URLs remain 1:1 with tab ids.
 */
import type { ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  Coins,
  Compass,
  Cookie,
  Cpu,
  CreditCard,
  DollarSign,
  FileText,
  GitCompare,
  Globe,
  Handshake,
  Hash,
  HeartPulse,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  Languages,
  Mail,
  Megaphone,
  MessageSquareText,
  Newspaper,
  Package,
  PartyPopper,
  Percent,
  QrCode,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Stamp,
  Tablet,
  Terminal,
  Ticket,
  TrendingUp,
  Truck,
  Type,
  UserX,
  Users,
  Wand2,
} from "lucide-react";
import {
  adminHref,
  canonicalAdminPath,
  parseCatalogSegment,
  type AnalysisTabId,
  type CatalogSegment,
  type CommunicationTabId,
  type ConfigTabId,
  type LegalTabId,
  type MarketingTabId,
} from "./adminTabStore";
import type { PermissionKey } from "../../core/config/permissions";

export type TabMeta = { label: string; icon: ReactNode; description: string };

export const CONFIG_TAB_META: Record<ConfigTabId, TabMeta> = {
  overview: {
    label: "Control Center",
    icon: <LayoutDashboard className="size-4" />,
    description: "Live pulse, items needing attention, workspace directory, and business model map.",
  },
  catalog: {
    label: "Catalog",
    icon: <Package className="size-4" />,
    description: "One-time purchases: printed books, the digital edition, and Spark packs.",
  },
  markets: {
    label: "Markets & shipping",
    icon: <Globe className="size-4" />,
    description: "Which countries we sell to, shipping policies, and what the printer reaches.",
  },
  memberships: {
    label: "Memberships",
    icon: <CreditCard className="size-4" />,
    description: "Recurring subscription plans, perks, and Stripe billing.",
  },
  sparks: {
    label: "Sparks economy",
    icon: <Sparkles className="size-4" />,
    description: "How AI generation is metered, granted, and priced.",
  },
  financial: {
    label: "Currencies & tax",
    icon: <Coins className="size-4" />,
    description: "Currencies, FX fees, tax, and sale guardrails behind every price.",
  },
  discounts: {
    label: "Sale planner",
    icon: <Percent className="size-4" />,
    description: "What a discount does to every product's margin and break-even.",
  },
  models: {
    label: "Models & pricing",
    icon: <Cpu className="size-4" />,
    description: "Which AI models run each generation step, and what they cost.",
  },
  modelCosts: {
    label: "Model costs",
    icon: <DollarSign className="size-4" />,
    description: "Per-model rate table.",
  },
  prompts: {
    label: "Prompts",
    icon: <MessageSquareText className="size-4" />,
    description: "Prompt templates for each generation step.",
  },
  artStyles: {
    label: "Art styles",
    icon: <ImageIcon className="size-4" />,
    description: "Illustration styles offered in the studio.",
  },
  layouts: {
    label: "Page layouts",
    icon: <LayoutTemplate className="size-4" />,
    description: "How a book is laid out on the page.",
  },
  audience: {
    label: "Age bands",
    icon: <BookOpen className="size-4" />,
    description: "Writing, pacing, reading levels, and safety for each age.",
  },
  storyCraft: {
    label: "Story craft",
    icon: <Wand2 className="size-4" />,
    description: "Story structure and creative choices the pipeline follows by default.",
  },
  bookLanguages: {
    label: "Book languages",
    icon: <Languages className="size-4" />,
    description: "Languages a book can be written in.",
  },
  typography: {
    label: "Typography",
    icon: <Type className="size-4" />,
    description: "Fonts offered in the studio.",
  },
  guide: {
    label: "Guided studio",
    icon: <Compass className="size-4" />,
    description: "Persona, facts, wording, skills, and story options of the chat studio.",
  },
  system: {
    label: "System health",
    icon: <HeartPulse className="size-4" />,
    description: "Runtime health checks, webhooks, and the sandbox/live billing switch.",
  },
};

export const CATALOG_SEGMENT_META: Record<CatalogSegment, TabMeta> = {
  print: {
    label: "Print books",
    icon: <BookOpen className="size-4" />,
    description: "Physical hardcover and softcover books offered at checkout.",
  },
  options: {
    label: "Print options",
    icon: <ImageIcon className="size-4" />,
    description: "Pictures for every choice on a print book — shared by all books, set once.",
  },
  ebook: {
    label: "Digital edition",
    icon: <Tablet className="size-4" />,
    description: "The finished book sold as a downloadable PDF.",
  },
  packs: {
    label: "Spark packs",
    icon: <Sparkles className="size-4" />,
    description: "One-time Spark top-ups between renewals.",
  },
};

export const ANALYSIS_TAB_META: Record<AnalysisTabId, TabMeta> = {
  users: {
    label: "Users & activity",
    icon: <Users className="size-4" />,
    description: "Who signed up, logged in, and stayed active across markets.",
  },
  projects: {
    label: "Books created",
    icon: <BookOpen className="size-4" />,
    description: "Books people are making, inspecting, and finishing.",
  },
  devices: {
    label: "Devices",
    icon: <Smartphone className="size-4" />,
    description: "Conversion and activity across phones, tablets, and desktops.",
  },
  flows: {
    label: "Studio flows",
    icon: <GitCompare className="size-4" />,
    description: "Steps vs Chat side by side, and turn-by-turn guide accuracy.",
  },
  costs: {
    label: "AI & print costs",
    icon: <DollarSign className="size-4" />,
    description: "What AI generation and print fulfillment cost.",
  },
  finance: {
    label: "Finance & P&L",
    icon: <Coins className="size-4" />,
    description: "Revenue, fees, operating costs, and net contribution.",
  },
  payments: {
    label: "Payments",
    icon: <CreditCard className="size-4" />,
    description: "Charges, refunds, disputes, and Stripe health.",
  },
  orders: {
    label: "Print orders",
    icon: <Truck className="size-4" />,
    description: "Every print order, where it stands, and what needs your attention.",
  },
  products: {
    label: "Product sales",
    icon: <Package className="size-4" />,
    description: "How each print format, digital edition, and pack is selling.",
  },
  referrals: {
    label: "Referral funnel",
    icon: <Share2 className="size-4" />,
    description: "Invite-a-friend funnel, conversion, and payouts.",
  },
  affiliates: {
    label: "Affiliate stats",
    icon: <Handshake className="size-4" />,
    description: "Partner clicks, conversions, and commissions.",
  },
  campaigns: {
    label: "Campaign results",
    icon: <Megaphone className="size-4" />,
    description: "Promotion redemptions, revenue lift, and cost.",
  },
  coupons: {
    label: "Coupon redemptions",
    icon: <Ticket className="size-4" />,
    description: "Code usage and discount volume.",
  },
  qrCodes: {
    label: "QR code scans",
    icon: <QrCode className="size-4" />,
    description: "Scan counts and conversion stats per code.",
  },
  surveys: {
    label: "Customer profile",
    icon: <ClipboardList className="size-4" />,
    description: "Post-checkout survey responses and buyer segments.",
  },
  logs: {
    label: "Logs & diagnostics",
    icon: <Terminal className="size-4" />,
    description: "Structured frontend and backend events, user timelines, AI root-cause analysis, and Slack fatal alerts.",
  },
};

export const MARKETING_TAB_META: Record<MarketingTabId, TabMeta> = {
  referrals: {
    label: "Referrals",
    icon: <Share2 className="size-4" />,
    description: "Invite-a-friend rules, rewards, and daily budget.",
  },
  affiliates: {
    label: "Affiliates",
    icon: <Handshake className="size-4" />,
    description: "Partner program switch and commission rules.",
  },
  campaigns: {
    label: "Campaigns",
    icon: <Megaphone className="size-4" />,
    description: "Promotions: refunds, gifts, and price breaks.",
  },
  coupons: {
    label: "Coupons",
    icon: <Ticket className="size-4" />,
    description: "Codes a customer types, and codes that apply automatically.",
  },
  surveys: {
    label: "Surveys",
    icon: <ClipboardList className="size-4" />,
    description: "Post-checkout questions and who gets asked.",
  },
  announcements: {
    label: "Announcements",
    icon: <PartyPopper className="size-4" />,
    description: "Site-wide banners and notices.",
  },
  seo: {
    label: "SEO",
    icon: <Search className="size-4" />,
    description: "Titles, descriptions, and indexing rules.",
  },
  blog: {
    label: "Blog",
    icon: <Newspaper className="size-4" />,
    description: "Public articles and readership stats.",
  },
  landingPages: {
    label: "Landing pages",
    icon: <LayoutTemplate className="size-4" />,
    description: "Campaign and SEO pages built from one template, with their own slug and status.",
  },
  branding: {
    label: "Branding",
    icon: <Stamp className="size-4" />,
    description: "Logo, name, and storefront chrome.",
  },
  qrCodes: {
    label: "QR codes",
    icon: <QrCode className="size-4" />,
    description: "Printable QR codes and their destinations.",
  },
};

export const COMMUNICATION_TABS: {
  id: CommunicationTabId;
  label: string;
  icon: ReactNode;
  description: string;
}[] = [
  {
    id: "contact",
    label: "Contact inbox",
    icon: <Inbox className="size-4" />,
    description: "Messages sent from the public contact form.",
  },
  {
    id: "transactional-emails",
    label: "Transactional emails",
    icon: <Mail className="size-4" />,
    description: "Receipts, password resets, and order updates the app sends.",
  },
  {
    id: "admin-slack",
    label: "Admin Slack",
    icon: <Hash className="size-4" />,
    description: "Operational alerts posted to the admin Slack channel.",
  },
];

export const LEGAL_TABS: {
  id: LegalTabId;
  label: string;
  icon: ReactNode;
  description: string;
}[] = [
  {
    id: "documents",
    label: "Legal documents",
    icon: <FileText className="size-4" />,
    description: "Terms of service, privacy policy, and imprint.",
  },
  {
    id: "cookies",
    label: "Cookie consent",
    icon: <Cookie className="size-4" />,
    description: "Consent categories and the cookie banner.",
  },
  {
    id: "gdpr",
    label: "Data requests (GDPR)",
    icon: <UserX className="size-4" />,
    description: "Customer data export and deletion requests.",
  },
];

export function catalogHref(segment: CatalogSegment): string {
  return segment === "print"
    ? adminHref("configuration", "catalog")
    : `${adminHref("configuration", "catalog")}?segment=${segment}`;
}

export type NavMode = "overview" | "config" | "analytics" | "ops";

export type NavLeaf = {
  kind: "leaf";
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  description: string;
  mode?: NavMode;
  key?: PermissionKey;
  ownerOnly?: boolean;
};

export type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  children: NavNode[];
};

export type NavNode = NavLeaf | NavGroup;

function configLeaf(tab: ConfigTabId, extra?: Partial<NavLeaf>): NavLeaf {
  const meta = CONFIG_TAB_META[tab];
  return {
    kind: "leaf",
    id: `configuration:${tab}`,
    label: meta.label,
    icon: meta.icon,
    href: adminHref("configuration", tab),
    description: meta.description,
    mode: tab === "overview" ? "overview" : tab === "system" ? "ops" : "config",
    key: `configuration.${tab}`,
    ...extra,
  };
}

function catalogLeaf(segment: CatalogSegment): NavLeaf {
  const meta = CATALOG_SEGMENT_META[segment];
  return {
    kind: "leaf",
    id: `configuration:catalog:${segment}`,
    label: meta.label,
    icon: meta.icon,
    href: catalogHref(segment),
    description: meta.description,
    mode: "config",
    key: "configuration.catalog",
  };
}

function analysisLeaf(tab: AnalysisTabId, extra?: Partial<NavLeaf>): NavLeaf {
  const meta = ANALYSIS_TAB_META[tab];
  return {
    kind: "leaf",
    id: `analysis:${tab}`,
    label: meta.label,
    icon: meta.icon,
    href: adminHref("analysis", tab),
    description: meta.description,
    mode: tab === "orders" || tab === "payments" || tab === "logs" ? "ops" : "analytics",
    key: `analysis.${tab}`,
    ...extra,
  };
}

function marketingLeaf(tab: MarketingTabId, extra?: Partial<NavLeaf>): NavLeaf {
  const meta = MARKETING_TAB_META[tab];
  return {
    kind: "leaf",
    id: `marketing:${tab}`,
    label: meta.label,
    icon: meta.icon,
    href: adminHref("marketing", tab),
    description: meta.description,
    mode: "config",
    key: `marketing.${tab}`,
    ...extra,
  };
}

/**
 * Domain-centric workspace tree.
 *
 * Instead of splitting "Settings" and "Analytics" into separate halves of the
 * sidebar, each business domain groups its live operations/analytics alongside
 * its configuration screens. URLs and permission keys are completely unchanged.
 */
export const NAV_TREE: NavNode[] = [
  configLeaf("overview"),
  {
    kind: "group",
    id: "domain-commerce",
    label: "Commerce & Orders",
    icon: <ShoppingBag className="size-4" />,
    description: "Fulfillment, payments, products, memberships, and markets.",
    children: [
      {
        kind: "group",
        id: "commerce-ops",
        label: "Orders & Sales",
        children: [
          analysisLeaf("orders"),
          analysisLeaf("payments"),
          analysisLeaf("products"),
        ],
      },
      {
        kind: "group",
        id: "commerce-catalog",
        label: "Catalog & Pricing",
        children: [
          catalogLeaf("print"),
          catalogLeaf("options"),
          catalogLeaf("ebook"),
          catalogLeaf("packs"),
          configLeaf("memberships"),
          configLeaf("markets"),
          configLeaf("discounts"),
        ],
      },
    ],
  },
  {
    kind: "group",
    id: "domain-customers",
    label: "Customers & Books",
    icon: <Users className="size-4" />,
    description: "Who uses the product, what books they create, and their devices.",
    children: [
      analysisLeaf("users"),
      analysisLeaf("projects"),
      analysisLeaf("surveys"),
      analysisLeaf("devices"),
    ],
  },
  {
    kind: "group",
    id: "domain-finance",
    label: "Economy & Finance",
    icon: <Coins className="size-4" />,
    description: "P&L, AI and fulfillment costs, the Sparks economy, and currencies.",
    children: [
      {
        kind: "group",
        id: "finance-analytics",
        label: "Performance & Costs",
        children: [
          analysisLeaf("finance"),
          analysisLeaf("costs"),
        ],
      },
      {
        kind: "group",
        id: "finance-config",
        label: "Economy Settings",
        children: [
          configLeaf("sparks"),
          configLeaf("financial"),
        ],
      },
    ],
  },
  {
    kind: "group",
    id: "domain-growth",
    label: "Growth & Marketing",
    icon: <TrendingUp className="size-4" />,
    description: "Acquisition programs, promotions, content, SEO, and QR codes.",
    children: [
      {
        kind: "group",
        id: "growth-programs",
        label: "Programs (Configure)",
        children: [
          marketingLeaf("referrals"),
          marketingLeaf("affiliates"),
          marketingLeaf("campaigns"),
          marketingLeaf("coupons"),
          marketingLeaf("surveys"),
        ],
      },
      {
        kind: "group",
        id: "growth-analytics",
        label: "Program Performance",
        children: [
          analysisLeaf("referrals"),
          analysisLeaf("affiliates"),
          analysisLeaf("campaigns"),
          analysisLeaf("coupons"),
          analysisLeaf("qrCodes"),
        ],
      },
      {
        kind: "group",
        id: "growth-site",
        label: "Site & Content",
        children: [
          marketingLeaf("announcements"),
          marketingLeaf("blog"),
          marketingLeaf("landingPages"),
          marketingLeaf("seo"),
          marketingLeaf("branding"),
          marketingLeaf("qrCodes"),
        ],
      },
    ],
  },
  {
    kind: "group",
    id: "domain-studio",
    label: "Studio & AI",
    icon: <Wand2 className="size-4" />,
    description: "Guided studio flow, creative defaults, AI models, and prompts.",
    children: [
      {
        kind: "group",
        id: "studio-experience",
        label: "Book Studio",
        children: [
          configLeaf("guide"),
          analysisLeaf("flows"),
          configLeaf("audience"),
          configLeaf("artStyles"),
          configLeaf("layouts"),
          configLeaf("storyCraft"),
          configLeaf("bookLanguages"),
          configLeaf("typography"),
        ],
      },
      {
        kind: "group",
        id: "studio-ai",
        label: "AI Pipeline",
        children: [
          configLeaf("models"),
          configLeaf("prompts"),
        ],
      },
    ],
  },
  {
    kind: "group",
    id: "domain-ops",
    label: "Operations & Legal",
    icon: <ShieldCheck className="size-4" />,
    description: "Customer inbox, emails, Slack alerts, legal compliance, and access.",
    children: [
      {
        kind: "group",
        id: "ops-inbox",
        label: "Inbox & Notifications",
        children: COMMUNICATION_TABS.map((tab) => ({
          kind: "leaf" as const,
          id: `communication:${tab.id}`,
          label: tab.label,
          icon: tab.icon,
          href: adminHref("communication", tab.id),
          description: tab.description,
          mode: (tab.id === "contact" ? "ops" : "config") as NavMode,
          key: `communication.${tab.id}` as PermissionKey,
        })),
      },
      {
        kind: "group",
        id: "ops-legal",
        label: "Legal & Privacy",
        children: LEGAL_TABS.map((tab) => ({
          kind: "leaf" as const,
          id: `legal:${tab.id}`,
          label: tab.label,
          icon: tab.icon,
          href: adminHref("legal", tab.id),
          description: tab.description,
          mode: (tab.id === "gdpr" ? "ops" : "config") as NavMode,
          key: `legal.${tab.id}` as PermissionKey,
        })),
      },
      {
        kind: "group",
        id: "ops-platform",
        label: "Platform & Access",
        children: [
          analysisLeaf("logs"),
          configLeaf("system"),
          {
            kind: "leaf",
            id: "permissions:home",
            label: "Permissions",
            icon: <KeyRound className="size-4" />,
            href: adminHref("permissions"),
            description: "Who can open this dashboard, and what they can read or change.",
            mode: "ops",
            ownerOnly: true,
          },
        ],
      },
    ],
  },
];

/**
 * Paired Configure ↔ Analytics screens within the same domain.
 * When the admin is on either side of a pair, `AdminPageHeader` shows a
 * 1-click segmented switch between configuring the feature and viewing its
 * live analytics.
 */
export interface PairedView {
  configHref: string;
  configLabel: string;
  configKey: PermissionKey;
  analyticsHref: string;
  analyticsLabel: string;
  analyticsKey: PermissionKey;
}

const PAIRED_VIEW_LIST: PairedView[] = [
  {
    configHref: adminHref("marketing", "referrals"),
    configLabel: "Configure rules",
    configKey: "marketing.referrals",
    analyticsHref: adminHref("analysis", "referrals"),
    analyticsLabel: "Funnel & payouts",
    analyticsKey: "analysis.referrals",
  },
  {
    configHref: adminHref("marketing", "affiliates"),
    configLabel: "Configure program",
    configKey: "marketing.affiliates",
    analyticsHref: adminHref("analysis", "affiliates"),
    analyticsLabel: "Partner stats",
    analyticsKey: "analysis.affiliates",
  },
  {
    configHref: adminHref("marketing", "campaigns"),
    configLabel: "Configure campaigns",
    configKey: "marketing.campaigns",
    analyticsHref: adminHref("analysis", "campaigns"),
    analyticsLabel: "Campaign results",
    analyticsKey: "analysis.campaigns",
  },
  {
    configHref: adminHref("marketing", "coupons"),
    configLabel: "Manage codes",
    configKey: "marketing.coupons",
    analyticsHref: adminHref("analysis", "coupons"),
    analyticsLabel: "Redemptions",
    analyticsKey: "analysis.coupons",
  },
  {
    configHref: adminHref("marketing", "surveys"),
    configLabel: "Configure questions",
    configKey: "marketing.surveys",
    analyticsHref: adminHref("analysis", "surveys"),
    analyticsLabel: "Customer profile",
    analyticsKey: "analysis.surveys",
  },
  {
    configHref: adminHref("marketing", "qrCodes"),
    configLabel: "Manage QR codes",
    configKey: "marketing.qrCodes",
    analyticsHref: adminHref("analysis", "qrCodes"),
    analyticsLabel: "Scan stats",
    analyticsKey: "analysis.qrCodes",
  },
  {
    configHref: adminHref("configuration", "guide"),
    configLabel: "Configure studio",
    configKey: "configuration.guide",
    analyticsHref: adminHref("analysis", "flows"),
    analyticsLabel: "Flow analytics",
    analyticsKey: "analysis.flows",
  },
  {
    configHref: adminHref("configuration", "catalog"),
    configLabel: "Edit catalog",
    configKey: "configuration.catalog",
    analyticsHref: adminHref("analysis", "products"),
    analyticsLabel: "Product sales",
    analyticsKey: "analysis.products",
  },
  {
    configHref: adminHref("configuration", "models"),
    configLabel: "Models & rates",
    configKey: "configuration.models",
    analyticsHref: adminHref("analysis", "costs"),
    analyticsLabel: "AI & print costs",
    analyticsKey: "analysis.costs",
  },
  {
    configHref: adminHref("configuration", "financial"),
    configLabel: "Currencies & tax",
    configKey: "configuration.financial",
    analyticsHref: adminHref("analysis", "finance"),
    analyticsLabel: "Finance & P&L",
    analyticsKey: "analysis.finance",
  },
];

export function findPairedView(canonicalPath: string): PairedView | undefined {
  return PAIRED_VIEW_LIST.find(
    (p) => p.configHref === canonicalPath || p.analyticsHref === canonicalPath,
  );
}

/** One entry in the command palette's flat, searchable list. */
export interface NavEntry {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  sectionLabel: string;
  groupLabel?: string;
  mode?: NavMode;
  /** Extra command-palette matches without adding visible navigation items. */
  keywords?: string;
  href: string;
  /** The grant this entry needs to be reachable — omitted for owner-only entries. */
  key?: PermissionKey;
  /** True for entries only owners should ever see (the Permissions page itself). */
  ownerOnly?: boolean;
}

function buildNavIndex(): NavEntry[] {
  const entries: NavEntry[] = [];

  const walk = (nodes: NavNode[], domainLabel?: string, subGroupLabel?: string) => {
    for (const node of nodes) {
      if (node.kind === "leaf") {
        entries.push({
          id: node.id,
          label: node.label,
          description: node.description,
          icon: node.icon,
          sectionLabel: domainLabel ?? "Home",
          groupLabel: subGroupLabel,
          mode: node.mode,
          keywords:
            node.id === "configuration:models"
              ? "model costs pricing rates llm openai gemini"
              : node.id === "analysis:logs"
                ? "logs diagnostics errors fatal crash debugging traces timeline ai root cause"
              : node.id.startsWith("configuration:catalog:")
                ? "catalog print ebook packs hardcover softcover pdf"
                : node.id === "configuration:overview"
                  ? "home dashboard overview summary control center pulse"
                  : undefined,
          href: node.href,
          key: node.key,
          ownerOnly: node.ownerOnly,
        });
      } else if (!domainLabel) {
        walk(node.children, node.label, undefined);
      } else {
        walk(node.children, domainLabel, node.label);
      }
    }
  };

  walk(NAV_TREE);
  return entries;
}

/** Every navigable tab in the admin dashboard, flattened for search. */
export const NAV_INDEX: NavEntry[] = buildNavIndex();

export function navLeaves(nodes: NavNode[]): NavLeaf[] {
  return nodes.flatMap((node) => (node.kind === "leaf" ? [node] : navLeaves(node.children)));
}

export function filterNavTree(
  nodes: NavNode[],
  canReach: (leaf: NavLeaf) => boolean,
): NavNode[] {
  const next: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (canReach(node)) next.push(node);
      continue;
    }
    const children = filterNavTree(node.children, canReach);
    if (children.length > 0) next.push({ ...node, children });
  }
  return next;
}

/** True when this href is the page the admin is looking at, including Catalog segments. */
export function hrefIsActive(
  href: string,
  pathname: string,
  catalogSegment: CatalogSegment,
): boolean {
  const [path, query] = href.split("?");
  const canonical = canonicalAdminPath(pathname);
  if (path !== canonical) return false;
  if (canonical === adminHref("configuration", "catalog")) {
    const wanted = parseCatalogSegment(new URLSearchParams(query ?? "").get("segment"));
    return wanted === catalogSegment;
  }
  return true;
}

export function treeContainsActive(
  node: NavNode,
  pathname: string,
  catalogSegment: CatalogSegment,
): boolean {
  if (node.kind === "leaf") return hrefIsActive(node.href, pathname, catalogSegment);
  return node.children.some((child) => treeContainsActive(child, pathname, catalogSegment));
}

export interface ResolvedAdminPage {
  title: string;
  description: string;
  domainLabel?: string;
  groupLabel?: string;
  mode?: NavMode;
  pair?: PairedView;
  canonicalPath: string;
}

export function resolveAdminPage(
  pathname: string,
  catalogSegment: CatalogSegment,
): ResolvedAdminPage {
  const canonical = canonicalAdminPath(pathname);
  const pair = findPairedView(canonical);

  if (canonical === adminHref("configuration", "catalog")) {
    const meta = CATALOG_SEGMENT_META[catalogSegment];
    return {
      title: meta.label,
      description: meta.description,
      domainLabel: "Commerce & Orders",
      groupLabel: "Catalog & Pricing",
      mode: "config",
      pair,
      canonicalPath: canonical,
    };
  }

  const entry = NAV_INDEX.find((item) => {
    const [path] = item.href.split("?");
    return path === canonical && !item.href.includes("segment=");
  });

  if (entry) {
    return {
      title: entry.label,
      description: entry.description,
      domainLabel: entry.sectionLabel === "Home" ? undefined : entry.sectionLabel,
      groupLabel: entry.groupLabel,
      mode: entry.mode,
      pair,
      canonicalPath: canonical,
    };
  }

  return { title: "Admin", description: "", canonicalPath: canonical };
}

export const MODE_BADGE_META: Record<
  Exclude<NavMode, "overview">,
  { label: string; icon: ReactNode }
> = {
  config: { label: "Config", icon: <Settings2 className="size-3" /> },
  analytics: { label: "Stats", icon: <BarChart3 className="size-3" /> },
  ops: { label: "Live", icon: <BarChart3 className="size-3" /> },
};
