import { create } from "zustand";

/** Top-level admin sections (rendered as the left sidebar). */
export type AdminSection = "configuration" | "analysis" | "marketing";

/** Sub-tabs within the Configuration section. */
export type ConfigTabId =
  | "actions"
  | "models"
  | "artStyles"
  | "modelCosts"
  | "products"
  | "pricing"
  | "plans"
  | "sparks"
  | "costs"
  | "branding"
  | "system";

interface AdminNavState {
  section: AdminSection;
  configTab: ConfigTabId;
  setSection: (section: AdminSection) => void;
  setConfigTab: (tab: ConfigTabId) => void;
}

/** Admin navigation state, lifted to a store so views can cross-link (e.g. a
 * missing-cost warning on the Models tab can jump to the Model costs tab). */
export const useAdminTab = create<AdminNavState>((set) => ({
  section: "analysis",
  configTab: "products",
  setSection: (section) => set({ section }),
  setConfigTab: (configTab) => set({ configTab }),
}));
