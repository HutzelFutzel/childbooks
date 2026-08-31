import { create } from "zustand";

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
      "Where new users come from, whether the referral, affiliate and campaign programs pay for themselves, and who your customers actually are.",
    tabs: ["referrals", "affiliates", "campaigns", "surveys"],
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
      "Programs that acquire, reward, or learn from customers — referrals, affiliates, campaigns, and the surveys that feed targeting.",
    tabs: ["referrals", "affiliates", "campaigns", "surveys"],
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

/** Admin navigation state, lifted to a store so views can cross-link (e.g. a
 * missing-cost warning on the Models tab can jump to the Model costs tab, or
 * the Business overview can deep-link to the exact editor for a setting). */
export const useAdminTab = create<AdminNavState>((set) => ({
  section: "analysis",
  configGroup: "business",
  configTab: "overview",
  catalogSegment: "print",
  analysisGroup: "people",
  analysisTab: "users",
  // Growth first: the higher-stakes half of Marketing (real money moving).
  marketingGroup: "growth",
  marketingTab: "referrals",
  // Contact first: it's the only inbox for the public form (the site publishes
  // no email address), so unread submissions are the thing most worth surfacing
  // by default when an admin opens Communication.
  communicationTab: "contact",
  legalTab: "documents",
  setSection: (section) => set({ section }),
  setConfigGroup: (configGroup) => {
    const first = CONFIG_GROUPS.find((g) => g.id === configGroup)?.tabs[0];
    set({ configGroup, ...(first ? { configTab: first } : {}) });
  },
  setConfigTab: (configTab) =>
    set({ configTab, configGroup: configGroupForTab(configTab) }),
  openCatalog: (catalogSegment) =>
    set({ configTab: "catalog", configGroup: "business", catalogSegment }),
  setCatalogSegment: (catalogSegment) => set({ catalogSegment }),
  openConfigTab: (configTab) =>
    set({ section: "configuration", configTab, configGroup: configGroupForTab(configTab) }),
  openAnalysis: (analysisTab) =>
    set({ section: "analysis", analysisTab, analysisGroup: analysisGroupForTab(analysisTab) }),
  setAnalysisGroup: (analysisGroup) => {
    const first = ANALYSIS_GROUPS.find((g) => g.id === analysisGroup)?.tabs[0];
    set({ analysisGroup, ...(first ? { analysisTab: first } : {}) });
  },
  setAnalysisTab: (analysisTab) =>
    set({ analysisTab, analysisGroup: analysisGroupForTab(analysisTab) }),
  setMarketingGroup: (marketingGroup) => {
    const first = MARKETING_GROUPS.find((g) => g.id === marketingGroup)?.tabs[0];
    set({ marketingGroup, ...(first ? { marketingTab: first } : {}) });
  },
  setMarketingTab: (marketingTab) =>
    set({ marketingTab, marketingGroup: marketingGroupForTab(marketingTab) }),
  setCommunicationTab: (communicationTab) => set({ communicationTab }),
  setLegalTab: (legalTab) => set({ legalTab }),
  openMarketingTab: (marketingTab) =>
    set({
      section: "marketing",
      marketingTab,
      marketingGroup: marketingGroupForTab(marketingTab),
    }),
  openCommunicationTab: (communicationTab) => set({ section: "communication", communicationTab }),
  openLegalTab: (legalTab) => set({ section: "legal", legalTab }),
}));
