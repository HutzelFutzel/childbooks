/**
 * The destination the storefront should assume, resolved against the markets
 * we actually sell to.
 *
 * The store holds the raw signals (a guess and a choice); this is where they
 * meet the market registry, because a guess is only useful if we can act on
 * it. A visitor in a country we don't serve gets `""` — "we don't know where to
 * ship" — rather than their real country, which would filter the whole catalog
 * away on the strength of a hint they never confirmed.
 *
 * Detection is kicked off here rather than at app start so it costs nothing on
 * pages that never ask. It runs at most once per session.
 */
"use client";

import { useEffect } from "react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { resolveShipCountry, useShipCountryStore } from "../../state/shipCountryStore";

export interface ShipCountry {
  /** ISO-2, or "" when unknown or not a market we serve. Empty means "don't filter". */
  country: string;
  /** What the visitor explicitly chose, or "" — for telling a guess from an answer. */
  chosen: string;
  /** The raw geo hint, even when we don't sell there. */
  detected: string;
  /** True while the guess is still in flight and the registry hasn't settled. */
  loading: boolean;
  setCountry: (country: string) => void;
}

export function useShipCountry(): ShipCountry {
  const chosen = useShipCountryStore((s) => s.chosen);
  const detected = useShipCountryStore((s) => s.detected);
  const hydrated = useShipCountryStore((s) => s.hydrated);
  const detecting = useShipCountryStore((s) => s.detecting);
  const hydrate = useShipCountryStore((s) => s.hydrate);
  const detect = useShipCountryStore((s) => s.detect);
  const setCountry = useShipCountryStore((s) => s.setCountry);
  const registry = useAppConfigStore((s) => s.markets);
  const marketsLoaded = useAppConfigStore((s) => s.marketsLoaded);

  useEffect(() => {
    hydrate();
    void detect();
  }, [hydrate, detect]);

  const resolved = resolveShipCountry({ chosen, detected });
  // The registry is empty until it loads, and an empty one allows nothing — so
  // gate on `marketsLoaded` rather than on the set's contents, or every visitor
  // would be told we don't ship to them for the first few hundred milliseconds.
  const country = marketsLoaded && registry.enabled.has(resolved) ? resolved : "";

  return {
    country,
    chosen,
    detected,
    loading: !hydrated || detecting || !marketsLoaded,
    setCountry,
  };
}
