/**
 * Open-state for the account-area modals (Settings, Orders), lifted to a store
 * so the account dropdown can trigger them while each dialog is rendered once.
 */
import { create } from "zustand";

interface AccountUiState {
  settingsOpen: boolean;
  ordersOpen: boolean;
  downloadsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openOrders: () => void;
  closeOrders: () => void;
  openDownloads: () => void;
  closeDownloads: () => void;
}

export const useAccountUiStore = create<AccountUiState>((set) => ({
  settingsOpen: false,
  ordersOpen: false,
  downloadsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openOrders: () => set({ ordersOpen: true }),
  closeOrders: () => set({ ordersOpen: false }),
  openDownloads: () => set({ downloadsOpen: true }),
  closeDownloads: () => set({ downloadsOpen: false }),
}));
