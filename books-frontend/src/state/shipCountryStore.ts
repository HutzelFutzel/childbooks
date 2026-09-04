/**
 * Where the visitor intends the book to go — the country every format and
 * shipping-speed decision is filtered against.
 *
 * It exists because "which formats can I buy" turned out to be a question about
 * the destination. The printer doesn't bind every format in every facility, so
 * a hardcover ordered somewhere it isn't made is imported: different carrier,
 * different price, and a DIFFERENT SET OF SERVICE LEVELS. Offering a speed the
 * printer doesn't run there is refused at order time, after payment. So the
 * storefront has to know a country before it can honestly show a price or a
 * delivery option — and asking outright as the first thing anyone sees would be
 * a poor greeting.
 *
 * Hence two fields rather than one. `detected` is a guess we make from signals
 * the browser already exposes; `chosen` is the visitor telling us. They are
 * kept apart so the guess can be refreshed, corrected or ignored without ever
 * overwriting an answer someone actually gave — and so the UI can say "we
 * think you're in Germany" rather than silently pretending they said so.
 *
 * ONLY `chosen` IS PERSISTED. Re-detecting on each visit is cheap and stays
 * right when the visitor moves; persisting a stale guess would quietly outlive
 * the trip that produced it.
 *
 * This is a CONVENIENCE, never an authority. It preselects a dropdown. What a
 * customer may actually order is decided by the destination they enter at
 * checkout and re-checked server-side against a live quote.
 */
import { create } from "zustand";
import { backendFetch } from "../platform/backend";
import { isIsoCountry } from "../core/config/countries";
import { browserGeoHints } from "../core/analytics/geoHints";

const STORAGE_KEY = "childbooks.shipCountry";

interface ShipCountryState {
  /** The visitor's explicit choice, or "" when they haven't made one. */
  chosen: string;
  /** The geo hint, or "" when unknown or not yet asked. */
  detected: string;
  /** True once `localStorage` has been read (client-only, so never during SSR). */
  hydrated: boolean;
  /** True while the geo hint is in flight, so a picker can avoid flashing. */
  detecting: boolean;
  /**
   * Read the stored choice. Idempotent, and safe to call from an effect in
   * several components — the first one wins and the rest are no-ops.
   */
  hydrate: () => void;
  /** Ask the backend where this visitor probably is. Runs at most once. */
  detect: () => Promise<void>;
  /** Record an explicit choice. `""` clears it and falls back to the guess. */
  setCountry: (country: string) => void;
}

function normalize(value: string | null | undefined): string {
  const code = (value ?? "").trim().toUpperCase();
  return isIsoCountry(code) ? code : "";
}

export const useShipCountryStore = create<ShipCountryState>((set, get) => ({
  chosen: "",
  detected: "",
  hydrated: false,
  detecting: false,

  hydrate() {
    if (get().hydrated) return;
    let chosen = "";
    try {
      chosen = normalize(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private mode / storage disabled. A forgotten preference is a smaller
      // problem than a store that never hydrates, so carry on without it.
    }
    set({ chosen, hydrated: true });
  },

  async detect() {
    if (get().detected || get().detecting) return;
    set({ detecting: true });
    try {
      // The browser's own timezone and language are the fallbacks the backend
      // uses when no CDN geo header is present, and only the client can read
      // them. Sent as hints, never trusted as identity. Timezone is the
      // stronger location signal — locale is a language, and `en-US` is not
      // "this person is in the United States".
      const params = new URLSearchParams();
      const { locale, tz } = browserGeoHints();
      if (tz) params.set("tz", tz);
      if (locale) params.set("locale", locale);
      const res = await backendFetch(`/geo/country?${params}`);
      if (!res.ok) return;
      const json = (await res.json()) as { country?: string | null };
      set({ detected: normalize(json.country) });
    } catch {
      // A failed guess is not an error worth showing anyone: every consumer
      // treats "" as "we don't know" and carries on unfiltered.
    } finally {
      set({ detecting: false });
    }
  },

  setCountry(country) {
    const chosen = normalize(country);
    set({ chosen });
    try {
      if (chosen) localStorage.setItem(STORAGE_KEY, chosen);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Same as hydrate: the choice still applies for this session.
    }
  },
}));

/**
 * The destination to assume right now: what they chose, else what we guessed,
 * else nothing.
 *
 * "Nothing" is a real and safe answer — every consumer reads an empty country
 * as "don't filter", so an undetectable visitor sees the whole catalog rather
 * than an empty shop.
 */
export function resolveShipCountry(state: {
  chosen: string;
  detected: string;
}): string {
  return state.chosen || state.detected || "";
}
