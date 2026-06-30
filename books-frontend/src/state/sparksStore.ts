/**
 * Live **Sparks** balance + ledger for the signed-in user.
 *
 * Mirrors the backend-authoritative balance (`users/{uid}.sparkBalance`) and the
 * ledger subcollection into the UI (the balance pill, the wallet view). Watch
 * when a full account is present and stop on sign-out so balances never leak
 * across identities. Watching also claims the one-time starter grant (idempotent).
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import { subscribeSparkBalance, subscribeSparkLedger } from "../platform/sparks";
import { claimStarterSparks } from "../platform/payments";
import type { SparksLedgerEntry } from "../core/config/sparks";

interface SparksState {
  balance: number;
  ledger: SparksLedgerEntry[];
  loading: boolean;
  unsubBalance: Unsubscribe | null;
  unsubLedger: Unsubscribe | null;
  watch: () => void;
  stop: () => void;
}

export const useSparksStore = create<SparksState>((set, get) => ({
  balance: 0,
  ledger: [],
  loading: false,
  unsubBalance: null,
  unsubLedger: null,

  watch() {
    if (get().unsubBalance) return;
    set({ loading: true });
    // Best-effort, idempotent starter grant on first studio open.
    void claimStarterSparks();
    const unsubBalance = subscribeSparkBalance((balance) => set({ balance, loading: false }));
    const unsubLedger = subscribeSparkLedger((ledger) => set({ ledger }));
    set({ unsubBalance, unsubLedger });
  },

  stop() {
    get().unsubBalance?.();
    get().unsubLedger?.();
    set({ balance: 0, ledger: [], loading: false, unsubBalance: null, unsubLedger: null });
  },
}));
