/**
 * Live payment history for the signed-in user.
 *
 * Payments are written + updated server-side (at checkout and from Stripe
 * webhooks), so this store mirrors the `users/{uid}/payments` collection into the
 * UI for the receipts/history view. Watch when a full account is present; stop on
 * sign-out so one identity's payments never leak into another's session.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import { subscribeUserPayments, type UserPaymentRecord } from "../platform/payments";

interface PaymentsState {
  payments: UserPaymentRecord[];
  loading: boolean;
  unsub: Unsubscribe | null;
  watch: () => void;
  stop: () => void;
}

export const usePaymentsStore = create<PaymentsState>((set, get) => ({
  payments: [],
  loading: false,
  unsub: null,

  watch() {
    if (get().unsub) return;
    set({ loading: true });
    const unsub = subscribeUserPayments((payments) => set({ payments, loading: false }));
    set({ unsub });
  },

  stop() {
    get().unsub?.();
    set({ payments: [], loading: false, unsub: null });
  },
}));
