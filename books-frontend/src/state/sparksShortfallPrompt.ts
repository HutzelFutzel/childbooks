/**
 * The warning shown when a batch would cost more Sparks than the user has.
 *
 * Generation is deliberately all-or-nothing: the server reserves the whole batch
 * before starting it, so an unaffordable batch never runs at all. Half-drawing a
 * cast — or a book with pages 1-6 illustrated and 7-12 blank — is a worse
 * outcome than not starting, and the user can always draw the rest in a second
 * pass once they've topped up.
 *
 * What this store adds is the EXPLANATION. Previously the refusal just opened
 * the wallet with a number in it, which reads as a sales prompt rather than an
 * answer to "why did nothing happen?". Generation entry points call
 * {@link warnBatchShortfall}; the dialog states the cost, the balance and how
 * far it goes, and hands off to the wallet only if the user chooses to top up.
 */
import { create } from "zustand";
import type { ImageActionId } from "../core/ai/actions";

export interface SparksShortfall {
  action: ImageActionId;
  /** Units the batch would render (references, pages, covers). */
  requested: number;
  /** How many of those the current balance covers — often 0. */
  affordable: number;
  /** Estimated Sparks for the whole batch. */
  estimate: number;
  balance: number;
  /** Sparks the user must buy before the batch can start (at least 1). */
  shortfall: number;
}

interface SparksShortfallState {
  pending: SparksShortfall | null;
  warn: (shortfall: SparksShortfall) => void;
  dismiss: () => void;
}

export const useSparksShortfallStore = create<SparksShortfallState>((set) => ({
  pending: null,
  warn: (pending) => set({ pending }),
  dismiss: () => set({ pending: null }),
}));

/** Open the shortfall warning. Callers abort the batch after calling this. */
export function warnBatchShortfall(shortfall: SparksShortfall): void {
  useSparksShortfallStore.getState().warn(shortfall);
}
