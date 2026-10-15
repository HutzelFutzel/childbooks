/**
 * What an admin sees after opening a market: per product, can customers buy it
 * there, and if not, why. Produced by `functions/src/marketOnboarding.ts` from
 * stored coverage evidence; shared so the server and the Markets screen can't
 * disagree about the vocabulary.
 */
import type { MarketCapability } from "./marketCapability";
import type { ShippingMethod } from "../fulfillment/types";

export type ProductMarketState =
  /** Offered to customers in this market. */
  | "sellable"
  /** The provider was observed not to make this format for this country. */
  | "refused"
  /** The product's own destination policy excludes the country. */
  | "excluded"
  /** Provider answer unavailable (throttled / outage) — retried automatically. */
  | "unknown"
  /** Not a live product (draft) — will become sellable on activation. */
  | "draft";

export interface ProductMarketRow {
  productId: string;
  name: string;
  state: ProductMarketState;
  methods: ShippingMethod[];
  /** Whether a measured shipping rate exists, so passthrough can price it offline. */
  priced: boolean;
  message?: string;
}

export type MarketOnboardingState =
  /** At least one live product is sellable. */
  | "ready"
  /** Opened, but evidence is incomplete — the scheduled job is still working on it. */
  | "pending"
  /** The provider ships there but none of our live products can be sold. */
  | "nothing_sellable"
  /** The provider doesn't ship to this country at all. */
  | "unreachable";

export interface MarketOnboardingReport {
  country: string;
  state: MarketOnboardingState;
  /** Provider's country-level verdict. */
  coverage: MarketCapability["status"] | "unprobed";
  products: ProductMarketRow[];
  throttled: boolean;
  notes: string[];
  at: number;
}

