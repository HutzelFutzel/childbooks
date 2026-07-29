/**
 * Open-state for the account-area modals (Settings, Orders, Invites), lifted to a
 * store so the account dropdown, the wallet and the post-purchase screen can all
 * trigger them while each dialog is rendered once.
 */
import { create } from "zustand";

interface AccountUiState {
  settingsOpen: boolean;
  ordersOpen: boolean;
  downloadsOpen: boolean;
  inviteOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openOrders: () => void;
  closeOrders: () => void;
  openDownloads: () => void;
  closeDownloads: () => void;
  openInvite: () => void;
  closeInvite: () => void;
}

export const useAccountUiStore = create<AccountUiState>((set) => ({
  settingsOpen: false,
  ordersOpen: false,
  downloadsOpen: false,
  inviteOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openOrders: () => set({ ordersOpen: true }),
  closeOrders: () => set({ ordersOpen: false }),
  openDownloads: () => set({ downloadsOpen: true }),
  closeDownloads: () => set({ downloadsOpen: false }),
  openInvite: () => set({ inviteOpen: true }),
  closeInvite: () => set({ inviteOpen: false }),
}));
