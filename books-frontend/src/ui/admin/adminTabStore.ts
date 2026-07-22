import { create } from "zustand";

/** Top-level admin sections (rendered as the left sidebar). */
export type AdminSection = "configuration" | "analysis" | "marketing";

/** Configuration section groups (second-level nav). */
export type ConfigGroupId = "commerce" | "ai" | "creative" | "operations";

/** Sub-tabs within the Configuration section. */
export type ConfigTabId =
  | "actions"
  | "models"
  | "artStyles"
  | "ageWriting"
  | "typography"
  | "prompts"
  | "modelCosts"
  | "products"
  | "pricing"
  | "plans"
  | "sparks"
  | "costs"
  | "system";

/** Sub-tabs within the Marketing section. */
export type MarketingTabId = "seo" | "branding" | "email";

export const CONFIG_GROUPS: {
  id: ConfigGroupId;
  label: string;
  tabs: ConfigTabId[];
}[] = [
  {
    id: "commerce",
    label: "Commerce",
    tabs: ["products", "pricing", "plans", "sparks"],
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
  return CONFIG_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "commerce";
}

interface AdminNavState {
  section: AdminSection;
  configGroup: ConfigGroupId;
  configTab: ConfigTabId;
  marketingTab: MarketingTabId;
  setSection: (section: AdminSection) => void;
  setConfigGroup: (group: ConfigGroupId) => void;
  setConfigTab: (tab: ConfigTabId) => void;
  setMarketingTab: (tab: MarketingTabId) => void;
}

/** Admin navigation state, lifted to a store so views can cross-link (e.g. a
 * missing-cost warning on the Models tab can jump to the Model costs tab). */
export const useAdminTab = create<AdminNavState>((set) => ({
  section: "analysis",
  configGroup: "commerce",
  configTab: "products",
  marketingTab: "seo",
  setSection: (section) => set({ section }),
  setConfigGroup: (configGroup) => {
    const first = CONFIG_GROUPS.find((g) => g.id === configGroup)?.tabs[0];
    set({ configGroup, ...(first ? { configTab: first } : {}) });
  },
  setConfigTab: (configTab) =>
    set({ configTab, configGroup: configGroupForTab(configTab) }),
  setMarketingTab: (marketingTab) => set({ marketingTab }),
}));
