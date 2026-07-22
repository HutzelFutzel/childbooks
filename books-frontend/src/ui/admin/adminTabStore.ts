import { create } from "zustand";

/** Top-level admin sections (rendered as the left sidebar). */
export type AdminSection = "configuration" | "analysis" | "marketing";

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
  // AI pipeline group.
  | "models"
  | "modelCosts"
  | "actions"
  | "prompts"
  | "costs"
  // Creative defaults group.
  | "artStyles"
  | "ageWriting"
  | "typography"
  // Operations group.
  | "system";

/** Segments within the combined Catalog tab (things sold once). */
export type CatalogSegment = "print" | "ebook" | "packs";

/** Sub-tabs within the Marketing section. */
export type MarketingTabId = "seo" | "branding" | "email";

export const CONFIG_GROUPS: {
  id: ConfigGroupId;
  label: string;
  tabs: ConfigTabId[];
}[] = [
  {
    id: "business",
    label: "Business",
    tabs: ["overview", "catalog", "memberships", "sparks", "financial"],
  },
  {
    id: "ai",
    label: "AI pipeline",
    tabs: ["models", "modelCosts", "actions", "prompts", "costs"],
  },
  {
    id: "creative",
    label: "Creative defaults",
    tabs: ["artStyles", "ageWriting", "typography"],
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
  marketingTab: MarketingTabId;
  setSection: (section: AdminSection) => void;
  setConfigGroup: (group: ConfigGroupId) => void;
  setConfigTab: (tab: ConfigTabId) => void;
  /** Jump straight to a Catalog segment (used by the overview cross-links). */
  openCatalog: (segment: CatalogSegment) => void;
  setCatalogSegment: (segment: CatalogSegment) => void;
  setMarketingTab: (tab: MarketingTabId) => void;
}

/** Admin navigation state, lifted to a store so views can cross-link (e.g. a
 * missing-cost warning on the Models tab can jump to the Model costs tab, or
 * the Business overview can deep-link to the exact editor for a setting). */
export const useAdminTab = create<AdminNavState>((set) => ({
  section: "analysis",
  configGroup: "business",
  configTab: "overview",
  catalogSegment: "print",
  marketingTab: "seo",
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
  setMarketingTab: (marketingTab) => set({ marketingTab }),
}));
