/**
 * The Analysis dashboard's shared market (country) filter.
 *
 * Deliberately its own tiny store rather than a field on each section's store:
 * "show me Germany" is one decision that must hold across Users, Products,
 * Payments and Finance simultaneously. Per-section pickers would let the
 * sections silently disagree about which market they're describing, which is
 * exactly the bug that makes a market dashboard untrustworthy.
 *
 * Section stores read {@link marketParam} when building their query strings;
 * the Analysis tab re-fetches the visible section when the selection changes.
 */
import { create } from "zustand";
import type { CountryActivity } from "../core/analytics/types";

interface AdminMarketState {
  /** Selected market (ISO-2 or "ZZ"), or null for "all markets". */
  country: string | null;
  /** Markets seen in the data, newest overview first — populates the picker. */
  known: CountryActivity[];
  setCountry: (country: string | null) => void;
  setKnown: (known: CountryActivity[]) => void;
}

export const useAdminMarket = create<AdminMarketState>((set) => ({
  country: null,
  known: [],
  setCountry: (country) => set({ country }),
  setKnown: (known) => set({ known }),
}));

/** `&country=DE` for the current selection, or "" when unfiltered. */
export function marketParam(): string {
  const { country } = useAdminMarket.getState();
  return country ? `&country=${encodeURIComponent(country)}` : "";
}
