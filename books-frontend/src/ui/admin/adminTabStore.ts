"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Top-level admin sections (rendered as the left sidebar). */
export type AdminSection =
  | "configuration"
  | "analysis"
  | "marketing"
  | "communication"
  | "legal"
  // Owner-only: who has access to this dashboard, and to what. Never shown to
  // a plain admin — see `AdminAccessContext`/`useAdminAccess`.
  | "permissions";

/** Configuration section groups (second-level nav). */
export type ConfigGroupId = "business" | "ai" | "creative" | "operations";

/** Sub-tabs within the Configuration section. */
export type ConfigTabId =
  // Business group — the whole business model, ordered by revenue stream.
  | "overview" // read-only summary of the entire business model
  | "catalog" // things you sell once: print books, the ebook, Spark packs
  | "memberships" // subscription plans (incl. member ebook pricing)
  | "sparks" // the Sparks economy internals (peg, grants, action pricing)
  | "financial" // currencies, FX, fees, rounding, tax — the money plumbing
  | "discounts" // sale planner: per-item break-even & safe max discount + slider
  | "markets" // which countries we ship to, and what the printer reaches
  // AI pipeline group. (Cost *reporting* lives in Analysis → Costs; this group
  // only holds the knobs that set what things cost.)
  | "models"
  | "modelCosts"
  | "prompts"
  // Creative defaults group.
  | "artStyles"
  | "layouts"
  | "ageWriting"
  | "storyCraft"
  | "bookLanguages"
  | "typography"
  // Operations group.
  | "system";

/** Segments within the combined Catalog tab (things sold once). */
export type CatalogSegment = "print" | "ebook" | "packs";

/** Analysis section groups (second-level nav, mirroring Configuration). */
export type AnalysisGroupId = "people" | "money" | "growth";

/** Sub-tabs within the Analysis section. */
export type AnalysisTabId =
  // Who is using it and what they're making.
  | "users"
  | "projects"
  | "devices"
  // What it costs and what it earns.
  | "costs"
  | "finance"
  | "payments"
  | "products"
  // Where new users come from.
  | "referrals"
  | "affiliates"
  | "campaigns"
  | "coupons"
  | "qrCodes"
  | "surveys";

/**
 * Analysis is grouped rather than shown as one long tab strip: an admin
 * arrives with a question ("who's using this", "are we making money", "is the
 * referral program working") and the groups answer it before they have to read
 * eight tab labels.
 */
export const ANALYSIS_GROUPS: {
  id: AnalysisGroupId;
  label: string;
  /** One-line orientation shown under the group pills, mirroring `CONFIG_GROUPS`. */
  description: string;
  tabs: AnalysisTabId[];
}[] = [
  {
    id: "people",
    label: "People & books",
    description: "Who's using the product, what they're making, and what they're using to do it.",
    tabs: ["users", "projects", "devices"],
  },
  {
    id: "money",
    label: "Money",
    description: "What it costs to run, what it earns, and how each product line performs.",
    tabs: ["costs", "finance", "payments", "products"],
  },
  {
    id: "growth",
    label: "Growth",
    description:
      "Where new users come from, whether the referral, affiliate, campaign and coupon programs pay for themselves, and who your customers actually are.",
    tabs: ["referrals", "affiliates", "campaigns", "coupons", "qrCodes", "surveys"],
  },
];

export function analysisGroupForTab(tab: AnalysisTabId): AnalysisGroupId {
  return ANALYSIS_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "people";
}

/** Marketing section groups (second-level nav, mirroring Configuration). */
export type MarketingGroupId = "growth" | "site";

/** Sub-tabs within the Marketing section. */
export type MarketingTabId =
  // Growth — mechanisms with real money / targeting impact.
  | "referrals" // invite-a-friend program (rules, impact, funnel)
  | "affiliates" // Rewardful affiliate program (master switch + what earns)
  | "campaigns" // promotions: refunds, gifts, price breaks, purchase discounts
  | "coupons" // codes a customer types, and codes that apply themselves
  | "surveys" // the questions asked after checkout, and who gets asked them
  // Site & content — how the brand shows up publicly.
  | "announcements"
  | "seo"
  | "blog"
  | "branding"
  | "qrCodes";

/**
 * Marketing is grouped the same way Analysis → Growth is the metrics side of
 * the same four programs: an admin arrives asking either "how do we acquire /
 * reward / learn about customers?" or "how does the public site look?".
 */
export const MARKETING_GROUPS: {
  id: MarketingGroupId;
  label: string;
  description: string;
  tabs: MarketingTabId[];
}[] = [
  {
    id: "growth",
    label: "Growth",
    description:
      "Programs that acquire, reward, or learn from customers — referrals, affiliates, campaigns, coupon codes, and the surveys that feed targeting.",
    tabs: ["referrals", "affiliates", "campaigns", "coupons", "surveys"],
  },
  {
    id: "site",
    label: "Site & content",
    description: "How the brand shows up on the public site: announcements, SEO, blog, branding and QR codes.",
    tabs: ["announcements", "seo", "blog", "branding", "qrCodes"],
  },
];

export function marketingGroupForTab(tab: MarketingTabId): MarketingGroupId {
  return MARKETING_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "growth";
}

/** Sub-tabs within the Communication section. */
export type CommunicationTabId = "contact" | "transactional-emails" | "admin-slack";

/** Sub-tabs within the Legal & Privacy section. */
export type LegalTabId = "documents" | "cookies" | "gdpr";

export const CONFIG_GROUPS: {
  id: ConfigGroupId;
  label: string;
  /** One-line orientation shown under the group pills — the "what lives here"
   * answer for a group an admin hasn't opened before. */
  description: string;
  tabs: ConfigTabId[];
}[] = [
  {
    id: "business",
    label: "Business",
    description:
      "Everything that makes money: what you sell, how memberships work, and the plumbing (currencies, discounts) behind every price.",
    tabs: ["overview", "catalog", "markets", "memberships", "sparks", "financial", "discounts"],
  },
  {
    id: "ai",
    label: "AI pipeline",
    description: "What each generation actually costs to produce, and the prompts that drive it.",
    tabs: ["models", "modelCosts", "prompts"],
  },
  {
    id: "creative",
    label: "Creative defaults",
    description:
      "Defaults for the creative pipeline — art direction, page layout, age-appropriate writing and story structure.",
    tabs: ["artStyles", "layouts", "ageWriting", "storyCraft", "bookLanguages", "typography"],
  },
  {
    id: "operations",
    label: "Operations",
    description: "Runtime health and the sandbox/live billing switch.",
    tabs: ["system"],
  },
];

export function configGroupForTab(tab: ConfigTabId): ConfigGroupId {
  return CONFIG_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "business";
}

interface AdminNavState {
  section: AdminSection;
  configGroup: ConfigGroupId;
  configTab: ConfigTabId;
  /** Which sub-section of the Catalog tab is showing. */
  catalogSegment: CatalogSegment;
  analysisGroup: AnalysisGroupId;
  analysisTab: AnalysisTabId;
  marketingGroup: MarketingGroupId;
  marketingTab: MarketingTabId;
  communicationTab: CommunicationTabId;
  legalTab: LegalTabId;
  setSection: (section: AdminSection) => void;
  setConfigGroup: (group: ConfigGroupId) => void;
  setConfigTab: (tab: ConfigTabId) => void;
  /** Jump straight to a Catalog segment (used by the overview cross-links). */
  openCatalog: (segment: CatalogSegment) => void;
  setCatalogSegment: (segment: CatalogSegment) => void;
  /** Jump straight to a Configuration tab (the mirror of `openAnalysis`). */
  openConfigTab: (tab: ConfigTabId) => void;
  /** Jump straight to an Analysis sub-tab (used by cross-links from Configuration). */
  openAnalysis: (tab: AnalysisTabId) => void;
  setAnalysisGroup: (group: AnalysisGroupId) => void;
  setAnalysisTab: (tab: AnalysisTabId) => void;
  setMarketingGroup: (group: MarketingGroupId) => void;
  setMarketingTab: (tab: MarketingTabId) => void;
  setCommunicationTab: (tab: CommunicationTabId) => void;
  setLegalTab: (tab: LegalTabId) => void;
  /** Jump straight to a Marketing/Communication/Legal tab from anywhere (e.g.
   * the command palette) — the flat-section equivalent of `openConfigTab`. */
  openMarketingTab: (tab: MarketingTabId) => void;
  openCommunicationTab: (tab: CommunicationTabId) => void;
  openLegalTab: (tab: LegalTabId) => void;
}

const DEFAULT_TAB = {
  analysis: "users",
  configuration: "overview",
  marketing: "referrals",
  communication: "contact",
  legal: "documents",
} as const satisfies Record<Exclude<AdminSection, "permissions">, string>;

const CONFIG_TABS = new Set<ConfigTabId>(CONFIG_GROUPS.flatMap((group) => group.tabs));
const ANALYSIS_TABS = new Set<AnalysisTabId>(ANALYSIS_GROUPS.flatMap((group) => group.tabs));
const MARKETING_TABS = new Set<MarketingTabId>(MARKETING_GROUPS.flatMap((group) => group.tabs));
const COMMUNICATION_TABS = new Set<CommunicationTabId>([
  "contact",
  "transactional-emails",
  "admin-slack",
]);
const LEGAL_TABS = new Set<LegalTabId>(["documents", "cookies", "gdpr"]);
const SECTIONS = new Set<AdminSection>([
  "analysis",
  "configuration",
  "marketing",
  "communication",
  "legal",
  "permissions",
]);

export function adminHref(section: "permissions"): string;
export function adminHref(section: "analysis", tab?: AnalysisTabId): string;
export function adminHref(section: "configuration", tab?: ConfigTabId): string;
export function adminHref(section: "marketing", tab?: MarketingTabId): string;
export function adminHref(section: "communication", tab?: CommunicationTabId): string;
export function adminHref(section: "legal", tab?: LegalTabId): string;
export function adminHref(section: AdminSection, tab?: string): string {
  if (section === "permissions") return "/admin/permissions";
  return `/admin/${section}/${tab ?? DEFAULT_TAB[section]}`;
}

export function adminSectionHref(section: AdminSection): string {
  switch (section) {
    case "permissions":
      return adminHref("permissions");
    case "analysis":
      return adminHref("analysis");
    case "configuration":
      return adminHref("configuration");
    case "marketing":
      return adminHref("marketing");
    case "communication":
      return adminHref("communication");
    case "legal":
      return adminHref("legal");
  }
}

/**
 * Return the stable canonical path for any admin URL. Group names intentionally
 * stay out of the URL because they are presentation hierarchy and can change
 * without breaking bookmarked links.
 */
export function canonicalAdminPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "admin") return adminHref("analysis");

  const section = segments[1] as AdminSection | undefined;
  if (!section || !SECTIONS.has(section)) return adminHref("analysis");
  if (section === "permissions") return adminHref("permissions");

  const tab = segments[2];
  if (section === "analysis" && ANALYSIS_TABS.has(tab as AnalysisTabId)) {
    return adminHref("analysis", tab as AnalysisTabId);
  }
  if (section === "configuration" && CONFIG_TABS.has(tab as ConfigTabId)) {
    return adminHref("configuration", tab as ConfigTabId);
  }
  if (section === "marketing" && MARKETING_TABS.has(tab as MarketingTabId)) {
    return adminHref("marketing", tab as MarketingTabId);
  }
  if (section === "communication" && COMMUNICATION_TABS.has(tab as CommunicationTabId)) {
    return adminHref("communication", tab as CommunicationTabId);
  }
  if (section === "legal" && LEGAL_TABS.has(tab as LegalTabId)) {
    return adminHref("legal", tab as LegalTabId);
  }
  return adminSectionHref(section);
}

function routeState(pathname: string) {
  const canonical = canonicalAdminPath(pathname);
  const [, , rawSection, rawTab] = canonical.split("/");
  const section = rawSection as AdminSection;

  const configTab =
    section === "configuration" ? (rawTab as ConfigTabId) : DEFAULT_TAB.configuration;
  const analysisTab = section === "analysis" ? (rawTab as AnalysisTabId) : DEFAULT_TAB.analysis;
  const marketingTab =
    section === "marketing" ? (rawTab as MarketingTabId) : DEFAULT_TAB.marketing;
  const communicationTab =
    section === "communication"
      ? (rawTab as CommunicationTabId)
      : DEFAULT_TAB.communication;
  const legalTab = section === "legal" ? (rawTab as LegalTabId) : DEFAULT_TAB.legal;

  return {
    section,
    configTab,
    configGroup: configGroupForTab(configTab),
    analysisTab,
    analysisGroup: analysisGroupForTab(analysisTab),
    marketingTab,
    marketingGroup: marketingGroupForTab(marketingTab),
    communicationTab,
    legalTab,
  };
}

/**
 * URL-backed replacement for the former Zustand navigation store. The selector
 * API is retained so feature tabs can keep their focused cross-link calls while
 * pathname changes now support refresh, Back/Forward, and shareable deep links.
 */
export function useAdminTab<T>(selector: (state: AdminNavState) => T): T {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const state = useMemo<AdminNavState>(() => {
    const route = routeState(pathname);
    const rawSegment = searchParams.get("segment");
    const catalogSegment: CatalogSegment =
      rawSegment === "ebook" || rawSegment === "packs" ? rawSegment : "print";
    const push = (href: string) => router.push(href);

    return {
      ...route,
      catalogSegment,
      setSection: (section) => push(adminSectionHref(section)),
      setConfigGroup: (configGroup) => {
        const tab = CONFIG_GROUPS.find((group) => group.id === configGroup)?.tabs[0] ?? "overview";
        push(adminHref("configuration", tab));
      },
      setConfigTab: (configTab) => push(adminHref("configuration", configTab)),
      openCatalog: (segment) => {
        const suffix = segment === "print" ? "" : `?segment=${segment}`;
        push(`${adminHref("configuration", "catalog")}${suffix}`);
      },
      setCatalogSegment: (segment) => {
        const next = new URLSearchParams(searchParams.toString());
        if (segment === "print") next.delete("segment");
        else next.set("segment", segment);
        const query = next.toString();
        router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
      },
      openConfigTab: (configTab) => push(adminHref("configuration", configTab)),
      openAnalysis: (analysisTab) => push(adminHref("analysis", analysisTab)),
      setAnalysisGroup: (analysisGroup) => {
        const tab = ANALYSIS_GROUPS.find((group) => group.id === analysisGroup)?.tabs[0] ?? "users";
        push(adminHref("analysis", tab));
      },
      setAnalysisTab: (analysisTab) => push(adminHref("analysis", analysisTab)),
      setMarketingGroup: (marketingGroup) => {
        const tab =
          MARKETING_GROUPS.find((group) => group.id === marketingGroup)?.tabs[0] ?? "referrals";
        push(adminHref("marketing", tab));
      },
      setMarketingTab: (marketingTab) => push(adminHref("marketing", marketingTab)),
      setCommunicationTab: (communicationTab) =>
        push(adminHref("communication", communicationTab)),
      setLegalTab: (legalTab) => push(adminHref("legal", legalTab)),
      openMarketingTab: (marketingTab) => push(adminHref("marketing", marketingTab)),
      openCommunicationTab: (communicationTab) =>
        push(adminHref("communication", communicationTab)),
      openLegalTab: (legalTab) => push(adminHref("legal", legalTab)),
    };
  }, [pathname, router, searchParams]);

  return selector(state);
}
