/**
 * Live list of the signed-in user's purchased downloads (ebooks today, more
 * digital products later).
 *
 * Entitlements are written server-side (on delivery and on each download), so
 * this store mirrors `users/{uid}/downloads` into the UI. Watch when a full
 * account is present; stop on sign-out so one identity's downloads never leak
 * into another's session.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import { subscribeUserDownloads, type DownloadEntitlement } from "../platform/downloads";

interface DownloadsState {
  downloads: DownloadEntitlement[];
  loading: boolean;
  unsub: Unsubscribe | null;
  watch: () => void;
  stop: () => void;
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  downloads: [],
  loading: false,
  unsub: null,

  watch() {
    if (get().unsub) return;
    set({ loading: true });
    const unsub = subscribeUserDownloads((downloads) => set({ downloads, loading: false }));
    set({ unsub });
  },

  stop() {
    get().unsub?.();
    set({ downloads: [], loading: false, unsub: null });
  },
}));

/** Number of downloads the user hasn't seen yet (drives the "new" badge). */
export function unseenDownloadCount(downloads: DownloadEntitlement[]): number {
  return downloads.filter((d) => d.seenAt == null).length;
}
