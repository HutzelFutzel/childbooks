/**
 * Live order history for the signed-in user.
 *
 * Orders are written + updated server-side (on placement and on each provider
 * status webhook), so this store simply mirrors the `users/{uid}/orders`
 * collection into the UI. Watch when a full account is present; stop on sign-out
 * so one identity's orders never leak into another's session.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import type { OrderRecord } from "../core/fulfillment/types";
import { subscribeUserOrders } from "../platform/orders";

interface OrdersState {
  orders: OrderRecord[];
  /** True until the first snapshot arrives. */
  loading: boolean;
  unsub: Unsubscribe | null;
  /** Begin mirroring the current user's orders (idempotent). */
  watch: () => void;
  /** Stop and clear. */
  stop: () => void;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  loading: false,
  unsub: null,

  watch() {
    if (get().unsub) return;
    set({ loading: true });
    const unsub = subscribeUserOrders((orders) => set({ orders, loading: false }));
    set({ unsub });
  },

  stop() {
    get().unsub?.();
    set({ orders: [], loading: false, unsub: null });
  },
}));
