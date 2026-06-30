/**
 * UI state for the plans/upgrade dialog, lifted to a store so it can be opened
 * from multiple places (the top-bar Plans button and the Sparks wallet's
 * "get monthly Sparks" nudge) while the dialog is rendered once.
 */
import { create } from "zustand";

interface BillingUiState {
  plansOpen: boolean;
  openPlans: () => void;
  closePlans: () => void;
}

export const useBillingUiStore = create<BillingUiState>((set) => ({
  plansOpen: false,
  openPlans: () => set({ plansOpen: true }),
  closePlans: () => set({ plansOpen: false }),
}));
