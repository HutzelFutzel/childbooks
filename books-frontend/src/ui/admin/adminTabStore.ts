import { create } from "zustand";

/** Top-level admin sections (rendered as the left sidebar). */
export type AdminSection =
  | "configuration"
  | "analysis"
  | "marketing"
  | "communication"
  | "legal";

/** Configuration section groups (second-level nav). */
export type ConfigGroupId = "business" | "ai" | "creative" | "operations";

/** Sub-tabs within the Configuration section. */
export type ConfigTabId =
  // Business group — the whole business model, ordered by revenue stream.
  | "overview" // read-only summary of the entire business model
  | "catalog" // things you sell once: print books, the ebook, Spark packs
  | "memberships" // subscription plans (incl. member ebook pricing)
  | "sparks" // the Sparks economy internals (peg, grants, action pricing)
  | "referrals" // invite-a-friend program (rules, impact, funnel)
  | "affiliates" // Rewardful affiliate program (master switch + what earns)
  | "financial" // currencies, FX, fees, rounding, tax — the money plumbing
  | "discounts" // sale planner: per-item break-even & safe max discount + slider
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
  // What it costs and what it earns.
  | "costs"
  | "finance"
  | "payments"
  | "products"
  // Where new users come from.
  | "referrals"
  | "affiliates";

/**
 * Analysis is grouped rather than shown as one long tab strip: an admin
 * arrives with a question ("who's using this", "are we making money", "is the
 * referral program working") and the groups answer it before they have to read
 * eight tab labels.
 */
export const ANALYSIS_GROUPS: {
  id: AnalysisGroupId;
  label: string;
  tabs: AnalysisTabId[];
}[] = [
  { id: "people", label: "People & books", tabs: ["users", "projects"] },
  { id: "money", label: "Money", tabs: ["costs", "finance", "payments", "products"] },
  { id: "growth", label: "Growth", tabs: ["referrals", "affiliates"] },
];

export function analysisGroupForTab(tab: AnalysisTabId): AnalysisGroupId {
  return ANALYSIS_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "people";
}

/** Sub-tabs within the Marketing section. */
export type MarketingTabId = "seo" | "blog" | "branding" | "qrCodes" | "announcements";

/** Sub-tabs within the Communication section. */
export type CommunicationTabId = "contact" | "transactional-emails" | "admin-slack";

/** Sub-tabs within the Legal & Privacy section. */
export type LegalTabId = "documents" | "cookies" | "gdpr";

export const CONFIG_GROUPS: {
  id: ConfigGroupId;
  label: string;
  tabs: ConfigTabId[];
}[] = [
  {
    id: "business",
    label: "Business",
    tabs: [
      "overview",
      "catalog",
      "memberships",
      "sparks",
      "referrals",
      "affiliates",
      "financial",
      "discounts",
    ],
  },
  {
    id: "ai",
    label: "AI pipeline",
    tabs: ["models", "modelCosts", "prompts"],
  },
  {
    id: "creative",
    label: "Creative defaults",
    tabs: ["artStyles", "layouts", "ageWriting", "storyCraft", "typography"],
  },
  {
    id: "operations",
    label: "Operations",
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
  setMarketingTab: (tab: MarketingTabId) => void;
  setCommunicationTab: (tab: CommunicationTabId) => void;
  setLegalTab: (tab: LegalTabId) => void;
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
  marketingTab: "seo",
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
  setMarketingTab: (marketingTab) => set({ marketingTab }),
  setCommunicationTab: (communicationTab) => set({ communicationTab }),
  setLegalTab: (legalTab) => set({ legalTab }),
}));
