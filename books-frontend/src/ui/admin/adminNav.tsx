"use client";

/**
 * Single source of truth for every tab's label, icon, and one-line purpose
 * across the whole admin dashboard. `NAV_INDEX` is the flattened command
 * palette. `NAV_TREE` is the nested sidebar. Permission keys stay 1:1 with
 * tab ids — Catalog's three products share `configuration.catalog`.
 */
import type { ReactNode } from "react";
import {
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
  Share2,
  Smartphone,
  Sparkles,
  Stamp,
  Tablet,
  Ticket,
  Type,
  UserX,
  Users,
  Wand2,
} from "lucide-react";
import {
  ANALYSIS_GROUPS,
  adminHref,
  canonicalAdminPath,
  CONFIG_GROUPS,
  MARKETING_GROUPS,
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
    label: "Overview",
    icon: <LayoutDashboard className="size-4" />,
    description: "How customers pay you, and what each choice gives them.",
  },
  catalog: {
    label: "Catalog",
    icon: <Package className="size-4" />,
    description: "One-time purchases: printed books, the digital edition, and Spark packs.",
  },
  markets: {
    label: "Markets",
    icon: <Globe className="size-4" />,
    description: "Which countries we sell to, and what the printer reaches.",
  },
  memberships: {
    label: "Memberships",
    icon: <CreditCard className="size-4" />,
    description: "Recurring plans, perks, and Stripe billing.",
  },
  sparks: {
    label: "Sparks",
    icon: <Sparkles className="size-4" />,
    description: "How AI generation is metered and priced.",
  },
  financial: {
    label: "Currencies & tax",
    icon: <Coins className="size-4" />,
    description: "Currencies, fees, tax, and sale guardrails behind every price.",
  },
  discounts: {
    label: "Sale planner",
    icon: <Percent className="size-4" />,
    description: "What a discount does to every product's margin.",
  },
  models: {
    label: "Models & pricing",
    icon: <Cpu className="size-4" />,
    description: "Which models run each generation step, and what they cost.",
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
    description: "Writing, pacing, and safety for each age.",
  },
  storyCraft: {
    label: "Story craft",
    icon: <Wand2 className="size-4" />,
    description: "Story structure the pipeline follows by default.",
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
    description: "Question order, wording, and rollout of the chat studio.",
  },
  system: {
    label: "System health",
    icon: <HeartPulse className="size-4" />,
    description: "Runtime health and the sandbox/live billing switch.",
  },
};

export const CATALOG_SEGMENT_META: Record<CatalogSegment, TabMeta> = {
  print: {
    label: "Print books",
    icon: <BookOpen className="size-4" />,
    description: "Physical books offered at checkout.",
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
    label: "Users",
    icon: <Users className="size-4" />,
    description: "Who signed up, logged in, and stayed active.",
  },
  projects: {
    label: "Books",
    icon: <BookOpen className="size-4" />,
    description: "Books people are making.",
  },
  devices: {
    label: "Devices",
    icon: <Smartphone className="size-4" />,
    description: "Phones, tablets, and desktops.",
  },
  flows: {
    label: "Studio flows",
    icon: <GitCompare className="size-4" />,
    description: "Steps vs Chat side by side, and what the Chat misread.",
  },
  costs: {
    label: "Costs",
    icon: <DollarSign className="size-4" />,
    description: "What generation and fulfillment cost.",
  },
  finance: {
    label: "Finance",
    icon: <Coins className="size-4" />,
    description: "Revenue, fees, and contribution.",
  },
  payments: {
    label: "Payments",
    icon: <CreditCard className="size-4" />,
    description: "Charges, refunds, and Stripe health.",
  },
  products: {
    label: "Products",
    icon: <Package className="size-4" />,
    description: "How each product line is selling.",
  },
  referrals: {
    label: "Referrals",
    icon: <Share2 className="size-4" />,
    description: "Invite-a-friend funnel and payouts.",
  },
  affiliates: {
    label: "Affiliates",
    icon: <Handshake className="size-4" />,
    description: "Partner performance.",
  },
  campaigns: {
    label: "Campaigns",
    icon: <Megaphone className="size-4" />,
    description: "Promotion results.",
  },
  coupons: {
    label: "Coupons",
    icon: <Ticket className="size-4" />,
    description: "Code redemptions.",
  },
  qrCodes: {
    label: "QR codes",
    icon: <QrCode className="size-4" />,
    description: "Scan and conversion stats.",
  },
  surveys: {
    label: "Customer profile",
    icon: <ClipboardList className="size-4" />,
    description: "Who your customers actually are.",
  },
};

export const MARKETING_TAB_META: Record<MarketingTabId, TabMeta> = {
  referrals: {
    label: "Referrals",
    icon: <Users className="size-4" />,
    description: "Invite-a-friend rules, rewards, and budget.",
  },
  affiliates: {
    label: "Affiliates",
    icon: <Handshake className="size-4" />,
    description: "Partner program switch and what earns.",
  },
  campaigns: {
    label: "Campaigns",
    icon: <Megaphone className="size-4" />,
    description: "Promotions: refunds, gifts, and price breaks.",
  },
  coupons: {
    label: "Coupons",
    icon: <Ticket className="size-4" />,
    description: "Codes a customer types, and codes that apply themselves.",
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
    description: "Titles, descriptions, and index rules.",
  },
  blog: {
    label: "Blog",
    icon: <Newspaper className="size-4" />,
    description: "Public posts and their stats.",
  },
  branding: {
    label: "Branding",
    icon: <Stamp className="size-4" />,
    description: "Logo, name, and storefront chrome.",
  },
  qrCodes: {
    label: "QR codes",
    icon: <QrCode className="size-4" />,
    description: "Printable codes and their destinations.",
  },
};

export const COMMUNICATION_TABS: { id: CommunicationTabId; label: string; icon: ReactNode; description: string }[] = [
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
    description: "Receipts, resets, and other mail the app sends.",
  },
  {
    id: "admin-slack",
    label: "Admin Slack",
    icon: <Hash className="size-4" />,
    description: "Alerts posted to the admin Slack.",
  },
];

export const LEGAL_TABS: { id: LegalTabId; label: string; icon: ReactNode; description: string }[] = [
  {
    id: "documents",
    label: "Documents",
    icon: <FileText className="size-4" />,
    description: "Terms, privacy, and other legal copy.",
  },
  {
    id: "cookies",
    label: "Cookies",
    icon: <Cookie className="size-4" />,
    description: "Consent categories and the banner.",
  },
  {
    id: "gdpr",
    label: "Data requests",
    icon: <UserX className="size-4" />,
    description: "Customer data export and deletion requests.",
  },
];

/** One entry in the command palette's flat, searchable list. */
export interface NavEntry {
  id: string;
  label: string;
  icon: ReactNode;
  sectionLabel: string;
  groupLabel?: string;
  /** Extra command-palette matches without adding visible navigation items. */
  keywords?: string;
  href: string;
  /** The grant this entry needs to be reachable — omitted for owner-only entries. */
  key?: PermissionKey;
  /** True for entries only owners should ever see (the Permissions page itself). */
  ownerOnly?: boolean;
}

function catalogHref(segment: CatalogSegment): string {
  return segment === "print"
    ? adminHref("configuration", "catalog")
    : `${adminHref("configuration", "catalog")}?segment=${segment}`;
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
        sectionLabel: group.label === "Business" ? "Sell" : group.label,
        groupLabel: group.label,
        keywords: tab === "models" ? "model costs pricing rates" : tab === "catalog" ? "print ebook packs" : undefined,
        key: `configuration.${tab}`,
        href: adminHref("configuration", tab),
      });
      if (tab === "catalog") {
        (Object.keys(CATALOG_SEGMENT_META) as CatalogSegment[]).forEach((segment) => {
          const seg = CATALOG_SEGMENT_META[segment];
          entries.push({
            id: `configuration:catalog:${segment}`,
            label: seg.label,
            icon: seg.icon,
            sectionLabel: "Sell",
            groupLabel: "Catalog",
            key: "configuration.catalog",
            href: catalogHref(segment),
          });
        });
      }
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
        key: `analysis.${tab}`,
        href: adminHref("analysis", tab),
      });
    }
  }

  for (const group of MARKETING_GROUPS) {
    for (const tab of group.tabs) {
      const meta = MARKETING_TAB_META[tab];
      entries.push({
        id: `marketing:${tab}`,
        label: meta.label,
        icon: meta.icon,
        sectionLabel: "Grow",
        groupLabel: group.label,
        key: `marketing.${tab}`,
        href: adminHref("marketing", tab),
      });
    }
  }

  for (const tab of COMMUNICATION_TABS) {
    entries.push({
      id: `communication:${tab.id}`,
      label: tab.label,
      icon: tab.icon,
      sectionLabel: "Inbox",
      key: `communication.${tab.id}`,
      href: adminHref("communication", tab.id),
    });
  }

  for (const tab of LEGAL_TABS) {
    entries.push({
      id: `legal:${tab.id}`,
      label: tab.label,
      icon: tab.icon,
      sectionLabel: "Legal",
      key: `legal.${tab.id}`,
      href: adminHref("legal", tab.id),
    });
  }

  entries.push({
    id: "permissions:home",
    label: "Permissions",
    icon: <KeyRound className="size-4" />,
    sectionLabel: "Permissions",
    ownerOnly: true,
    href: adminHref("permissions"),
  });

  return entries;
}

/** Every navigable tab in the admin dashboard, flattened for search. Built
 * once at module load — the underlying arrays above are static. */
export const NAV_INDEX: NavEntry[] = buildNavIndex();

export type NavLeaf = {
  kind: "leaf";
  id: string;
  label: string;
  href: string;
  description: string;
  key?: PermissionKey;
  ownerOnly?: boolean;
};

export type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  children: NavNode[];
};

export type NavNode = NavLeaf | NavGroup;

function configLeaf(tab: ConfigTabId, extra?: Partial<NavLeaf>): NavLeaf {
  const meta = CONFIG_TAB_META[tab];
  return {
    kind: "leaf",
    id: `configuration:${tab}`,
    label: meta.label,
    href: adminHref("configuration", tab),
    description: meta.description,
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
    href: catalogHref(segment),
    description: meta.description,
    key: "configuration.catalog",
  };
}

function analysisLeaf(tab: AnalysisTabId): NavLeaf {
  const meta = ANALYSIS_TAB_META[tab];
  return {
    kind: "leaf",
    id: `analysis:${tab}`,
    label: meta.label,
    href: adminHref("analysis", tab),
    description: meta.description,
    key: `analysis.${tab}`,
  };
}

function marketingLeaf(tab: MarketingTabId): NavLeaf {
  const meta = MARKETING_TAB_META[tab];
  return {
    kind: "leaf",
    id: `marketing:${tab}`,
    label: meta.label,
    href: adminHref("marketing", tab),
    description: meta.description,
    key: `marketing.${tab}`,
  };
}

/**
 * Nested sidebar. Groups are presentation only — URLs and permission keys
 * are unchanged. Catalog's three products share `configuration.catalog`.
 */
export const NAV_TREE: NavNode[] = [
  configLeaf("overview"),
  {
    kind: "group",
    id: "sell",
    label: "Sell",
    children: [
      catalogLeaf("print"),
      catalogLeaf("ebook"),
      catalogLeaf("packs"),
      configLeaf("memberships"),
      configLeaf("markets"),
    ],
  },
  {
    kind: "group",
    id: "money",
    label: "Money",
    children: [configLeaf("sparks"), configLeaf("financial"), configLeaf("discounts")],
  },
  {
    kind: "group",
    id: "grow",
    label: "Grow",
    children: [
      {
        kind: "group",
        id: "grow-programs",
        label: "Programs",
        children: (MARKETING_GROUPS.find((g) => g.id === "growth")?.tabs ?? []).map(marketingLeaf),
      },
      {
        kind: "group",
        id: "grow-site",
        label: "Site",
        children: (MARKETING_GROUPS.find((g) => g.id === "site")?.tabs ?? []).map(marketingLeaf),
      },
    ],
  },
  {
    kind: "group",
    id: "studio",
    label: "Studio",
    children: ["guide", "audience", "artStyles", "layouts", "storyCraft", "bookLanguages", "typography"].map(
      (tab) => configLeaf(tab as ConfigTabId),
    ),
  },
  {
    kind: "group",
    id: "ai",
    label: "AI",
    children: [configLeaf("models"), configLeaf("prompts")],
  },
  {
    kind: "group",
    id: "inbox",
    label: "Inbox",
    children: COMMUNICATION_TABS.map((tab) => ({
      kind: "leaf" as const,
      id: `communication:${tab.id}`,
      label: tab.label,
      href: adminHref("communication", tab.id),
      description: tab.description,
      key: `communication.${tab.id}` as PermissionKey,
    })),
  },
  {
    kind: "group",
    id: "legal",
    label: "Legal",
    children: LEGAL_TABS.map((tab) => ({
      kind: "leaf" as const,
      id: `legal:${tab.id}`,
      label: tab.label,
      href: adminHref("legal", tab.id),
      description: tab.description,
      key: `legal.${tab.id}` as PermissionKey,
    })),
  },
  {
    kind: "group",
    id: "analysis",
    label: "Analysis",
    children: ANALYSIS_GROUPS.map((group) => ({
      kind: "group" as const,
      id: `analysis-${group.id}`,
      label: group.label,
      children: group.tabs.map(analysisLeaf),
    })),
  },
  configLeaf("system"),
  {
    kind: "leaf",
    id: "permissions:home",
    label: "Permissions",
    href: adminHref("permissions"),
    description: "Who can open this dashboard, and to what.",
    ownerOnly: true,
  },
];

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
    const wanted = (new URLSearchParams(query ?? "").get("segment") as CatalogSegment | null) ?? "print";
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

export function resolveAdminPage(
  pathname: string,
  catalogSegment: CatalogSegment,
): { title: string; description: string } {
  const canonical = canonicalAdminPath(pathname);
  if (canonical === adminHref("configuration", "catalog")) {
    const meta = CATALOG_SEGMENT_META[catalogSegment];
    return { title: meta.label, description: meta.description };
  }
  const leaf = navLeaves(NAV_TREE).find((item) => {
    const [path] = item.href.split("?");
    return path === canonical && !item.href.includes("segment=");
  });
  if (leaf) return { title: leaf.label, description: leaf.description };
  return { title: "Admin", description: "" };
}
