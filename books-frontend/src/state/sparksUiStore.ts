/**
 * UI state for the Sparks wallet, lifted out of the badge so it can be opened
 * from anywhere — most importantly when an AI call is rejected for lack of
 * Sparks (HTTP 402). The interceptor in `platform/aiClient` calls `openWallet`
 * with the shortfall so the wallet can pre-suggest the smallest pack that covers
 * it, turning "you ran out" into a one-click fix.
 */
import { create } from "zustand";

interface SparksUiState {
  walletOpen: boolean;
  /** Sparks the user is short by (drives the top-up prompt), or null when opened manually. */
  needed: number | null;
  openWallet: (needed?: number) => void;
  closeWallet: () => void;
}

export const useSparksUiStore = create<SparksUiState>((set) => ({
  walletOpen: false,
  needed: null,
  openWallet: (needed) => set({ walletOpen: true, needed: needed && needed > 0 ? Math.ceil(needed) : null }),
  closeWallet: () => set({ walletOpen: false, needed: null }),
}));
