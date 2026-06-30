/**
 * Live subscription state for the signed-in user (mirrors
 * `users/{uid}/subscriptions`). Drives the "current plan" indicator and the
 * Manage-subscription entry point. Watch for full accounts, stop on sign-out.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import {
  activeSubscription,
  subscribeUserSubscriptions,
  type UserSubscription,
} from "../platform/subscriptions";

interface SubscriptionState {
  subscriptions: UserSubscription[];
  loading: boolean;
  unsub: Unsubscribe | null;
  watch: () => void;
  stop: () => void;
  /** The current benefit-providing subscription, or null. */
  active: () => UserSubscription | null;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscriptions: [],
  loading: false,
  unsub: null,

  watch() {
    if (get().unsub) return;
    set({ loading: true });
    const unsub = subscribeUserSubscriptions((subscriptions) => set({ subscriptions, loading: false }));
    set({ unsub });
  },

  stop() {
    get().unsub?.();
    set({ subscriptions: [], loading: false, unsub: null });
  },

  active() {
    return activeSubscription(get().subscriptions);
  },
}));
