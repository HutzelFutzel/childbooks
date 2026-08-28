/**
 * What the print provider will actually DO for each country — discovered, never
 * declared.
 *
 * This is deliberately a separate document from {@link MarketsConfig} (which
 * countries an admin has switched on). Coverage is a fact about the provider
 * that a background sweep rewrites wholesale; enablement is an intent an admin
 * expressed. Storing them together means either the sweep clobbers someone's
 * choice or the sweep can't run — so they never share a document, and the UI
 * derives the interesting case ("enabled here, but the printer stopped serving
 * it") by comparing the two.
 *
 * Stored at the world-readable `appConfig/marketCapability`. Written only by
 * the backend sweep in `functions/src/marketDiscovery.ts`.
 */
import type { ShippingMethod } from "../fulfillment/types";
import type { ProviderEnv } from "./products";

/**
 * Whether we know what the provider does for a country.
 *
 * The three-way split is the point. `refused` is evidence — the provider looked
 * and said no. `unknown` is our failure: throttled, network, outage. Collapsing
 * them means one rate-limited probe permanently closes a country, and at ~250
 * probes per sweep that stops being a rare accident.
 */
export type CapabilityStatus = "available" | "refused" | "unknown";

/** One shipping service the provider was observed to run to a country. */
export interface DiscoveredLevel {
  /** The provider's own level string, e.g. "PRIORITY_MAIL". */
  level: string;
  /**
   * The domain tier this level maps to, when it maps to one. Undefined for
   * services we haven't given a tier (Lulu's GROUND_HD / GROUND_BUS) — kept
   * rather than dropped, because they're real coverage we may want later.
   */
  method?: ShippingMethod;
  /** Business days from start of production to delivery, when reported. */
  transitDaysMin?: number;
  transitDaysMax?: number;
  traceable: boolean;
  postboxOk: boolean;
  businessOnly: boolean;
  /**
   * What this service cost for the SWEEP's reference book, in the sweep's
   * currency. Indicative only — real shipping scales with a book's weight, so
   * nothing may bill a customer from this number.
   */
  indicativeCost?: number;
}

export interface MarketCapability {
  /** ISO-3166-1 alpha-2, uppercase. */
  country: string;
  status: CapabilityStatus;
  /** Empty unless `status` is `"available"`. */
  levels: DiscoveredLevel[];
  /** The provider's refusal text, or why the probe was inconclusive. */
  message?: string;
  probedAt: number;
}

export interface MarketCapabilityConfig {
  version: 1;
  /**
   * What the sweep asked about. Coverage barely varies by product, but cost
   * does and page bounds do, so recording the probe makes a stale or
   * unrepresentative result identifiable instead of mysterious.
   */
  probe: {
    sku: string;
    pageCount: number;
    copies: number;
    currency: string;
    env: ProviderEnv;
  };
  countries: MarketCapability[];
  sweptAt: number;
}

export function createEmptyMarketCapability(): MarketCapabilityConfig {
  return {
    version: 1,
    probe: { sku: "", pageCount: 0, copies: 1, currency: "USD", env: "sandbox" },
    countries: [],
    sweptAt: 0,
  };
}

function str(v: unknown, fallback = "", max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeLevel(input: unknown): DiscoveredLevel | null {
  const l = (input ?? {}) as Partial<DiscoveredLevel>;
  const level = str(l.level, "", 40).trim().toUpperCase();
  if (!level) return null;
  return {
    level,
    ...(l.method ? { method: l.method } : {}),
    ...(typeof l.transitDaysMin === "number" ? { transitDaysMin: num(l.transitDaysMin) } : {}),
    ...(typeof l.transitDaysMax === "number" ? { transitDaysMax: num(l.transitDaysMax) } : {}),
    traceable: bool(l.traceable),
    postboxOk: bool(l.postboxOk),
    businessOnly: bool(l.businessOnly),
    ...(typeof l.indicativeCost === "number" ? { indicativeCost: num(l.indicativeCost) } : {}),
  };
}

/**
 * Normalize one country's verdict.
 *
 * Exported because {@link ../config/productCapability} stores the same shape
 * per product and must decode it identically — two normalizers for one document
 * shape is how a field ends up trusted in one place and dropped in the other.
 */
export function normalizeCountryCapability(input: unknown): MarketCapability | null {
  const c = (input ?? {}) as Partial<MarketCapability>;
  const country = str(c.country, "", 2).trim().toUpperCase();
  if (country.length !== 2) return null;
  const status: CapabilityStatus =
    c.status === "available" || c.status === "refused" ? c.status : "unknown";
  const levels = Array.isArray(c.levels)
    ? c.levels.slice(0, 20).flatMap((l) => {
        const level = normalizeLevel(l);
        return level ? [level] : [];
      })
    : [];
  return {
    country,
    status,
    // A country can only carry levels if the provider actually answered.
    levels: status === "available" ? levels : [],
    ...(c.message ? { message: str(c.message, "", 500) } : {}),
    probedAt: num(c.probedAt),
  };
}

export function normalizeMarketCapability(input: unknown): MarketCapabilityConfig {
  const c = (input ?? {}) as Partial<MarketCapabilityConfig>;
  const probe = (c.probe ?? {}) as Partial<MarketCapabilityConfig["probe"]>;
  const seen = new Set<string>();
  const countries: MarketCapability[] = [];
  for (const raw of Array.isArray(c.countries) ? c.countries.slice(0, 400) : []) {
    const cap = normalizeCountryCapability(raw);
    if (!cap || seen.has(cap.country)) continue;
    seen.add(cap.country);
    countries.push(cap);
  }
  countries.sort((a, b) => a.country.localeCompare(b.country));
  return {
    version: 1,
    probe: {
      sku: str(probe.sku, "", 40),
      pageCount: num(probe.pageCount),
      copies: num(probe.copies, 1),
      currency: str(probe.currency, "USD", 3).toUpperCase() || "USD",
      env: probe.env === "live" ? "live" : "sandbox",
    },
    countries,
    sweptAt: num(c.sweptAt),
  };
}

/** What the admin's "re-check coverage" button gets back from the sweep. */
export interface MarketSweepSummary {
  capability: MarketCapabilityConfig;
  /** Countries actually asked about this run (a resumed run skips settled ones). */
  probed: number;
  available: number;
  refused: number;
  unknown: number;
  /** The run hit the provider's rate limit, so it is incomplete rather than final. */
  throttled: boolean;
  message?: string;
}

/** Index by country for the O(1) lookups the admin table and validation want. */
export function capabilityIndex(
  config: MarketCapabilityConfig,
): ReadonlyMap<string, MarketCapability> {
  return new Map(config.countries.map((c) => [c.country, c]));
}

/**
 * The domain tiers a country can receive, deduped and in no particular order.
 * Levels with no domain tier are omitted — they're recorded for later, but
 * nothing can be sold on a tier the rest of the system can't name.
 */
export function availableMethodsFor(cap: MarketCapability | undefined): ShippingMethod[] {
  if (!cap || cap.status !== "available") return [];
  const out = new Set<ShippingMethod>();
  for (const level of cap.levels) if (level.method) out.add(level.method);
  return [...out];
}
