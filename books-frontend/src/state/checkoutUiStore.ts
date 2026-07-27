/**
 * UI state for the post-purchase confirmation screen.
 *
 * Lifted to a store because two things open it: the Stripe return URL (parsed
 * once on load in `StudioApp`) and the orders list, so a customer can reopen the
 * status of an order they bought last week. Rendered once, near the app root.
 */
import { create } from "zustand";

/** What was bought — decides which confirmation is shown. */
export type PurchaseKind = "order" | "ebook" | "sparks" | "gift" | "subscription";

export interface ConfirmationTarget {
  kind: PurchaseKind;
  /**
   * Our own payment id. Absent for purchases with no payment record to follow
   * (a subscription, or an ebook the buyer's plan simply included), where the
   * confirmation has nothing to track and just says what happened.
   */
  paymentId: string | null;
  /** The project a book/ebook purchase belongs to, when known. */
  projectId: string | null;
}

interface CheckoutUiState {
  confirmation: ConfirmationTarget | null;
  openConfirmation: (target: Partial<ConfirmationTarget> & { kind: PurchaseKind }) => void;
  closeConfirmation: () => void;
}

export const useCheckoutUiStore = create<CheckoutUiState>((set) => ({
  confirmation: null,
  openConfirmation: (target) =>
    set({
      confirmation: {
        kind: target.kind,
        paymentId: target.paymentId ?? null,
        projectId: target.projectId ?? null,
      },
    }),
  closeConfirmation: () => set({ confirmation: null }),
}));
