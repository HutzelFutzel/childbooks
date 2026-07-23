/**
 * Open-state for the in-app support/contact modal, lifted to a store so the
 * TopBar "Help" button and the account menu can open it while the dialog itself
 * is rendered once per app shell (studio + admin).
 */
import { create } from "zustand";

interface SupportUiState {
  contactOpen: boolean;
  openContact: () => void;
  closeContact: () => void;
}

export const useSupportUiStore = create<SupportUiState>((set) => ({
  contactOpen: false,
  openContact: () => set({ contactOpen: true }),
  closeContact: () => set({ contactOpen: false }),
}));
