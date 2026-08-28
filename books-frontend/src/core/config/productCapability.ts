/**
 * What the print provider will do for ONE FORMAT in each country — the
 * per-product counterpart to {@link ./marketCapability}.
 *
 * The country sweep asks "does the provider serve this destination at all",
 * once, with a single reference book. That question is genuinely about the
 * destination, which is what makes sweeping ~250 countries affordable. But it
 * is not the question checkout needs, because the answer is not the same for
 * every book:
 *
 *   8.5×8.5 paperback → Australia   Australia Post, MAIL + EXPRESS
 *   8.5×8.5 hardcover → Australia   FedEx International, MAIL + EXPEDITED + EXPRESS
 *   11×8.5  hardcover → Germany     loses GROUND, gains EXPEDITED
 *
 * Hardcovers aren't produced in every facility, so they're printed elsewhere
 * and imported — which changes the carrier, the price, AND which service levels
 * exist. A speed the provider doesn't run for a format is a hard refusal at
 * order time, so selling `Standard` on a landscape hardcover to Germany fails
 * after the customer has paid. That is the bug this document exists to close.
 *
 * SEPARATE FROM {@link MarketCapabilityConfig} ON PURPOSE. Same shape per cell,
 * different cardinality and different cost: the country sweep is the whole world
 * against one book and refreshes weekly; this is the active catalog against the
 * OPEN markets only, because measuring 250 countries per format would multiply
 * the weekly sweep by the size of the catalog to answer a question about
 * countries nobody can order from. They also age differently — opening a market
 * invalidates this document and not that one.
 *
 * Stored at the world-readable `appConfig/productCapability`, written only by
 * the backend sweep in `functions/src/productDiscovery.ts`.
 */
import {
  normalizeCountryCapability,
  type MarketCapability,
} from "./marketCapability";
import type { ProviderEnv } from "./products";

/** Every country probed for one format, plus the book that was probed with. */
export interface ProductCoverage {
  /** Base SKU of the format. Variants share a format's coverage — see below. */
  sku: string;
  /**
   * Page count probed.
   *
   * Recorded because formats accept different ranges (saddle stitch stops at
   * 48 pages where casewrap runs to 800), so a single global probe count would
   * be invalid for some of them. Shipping scales with weight, so the costs here
   * are indicative of this page count and nothing else.
   */
  pageCount: number;
  countries: MarketCapability[];
}

export interface ProductCapabilityConfig {
  version: 1;
  probe: {
    copies: number;
    currency: string;
    /** Sandbox and live are different catalogs, so coverage can't cross over. */
    env: ProviderEnv;
  };
  products: ProductCoverage[];
  sweptAt: number;
}

export function createEmptyProductCapability(): ProductCapabilityConfig {
  return {
    version: 1,
    probe: { copies: 1, currency: "USD", env: "sandbox" },
    products: [],
    sweptAt: 0,
  };
}

function str(v: unknown, fallback = "", max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeCoverage(input: unknown): ProductCoverage | null {
  const c = (input ?? {}) as Partial<ProductCoverage>;
  const sku = str(c.sku, "", 40).trim().toUpperCase();
  if (!sku) return null;
  const seen = new Set<string>();
  const countries: MarketCapability[] = [];
  for (const raw of Array.isArray(c.countries) ? c.countries.slice(0, 400) : []) {
    const cap = normalizeCountryCapability(raw);
    if (!cap || seen.has(cap.country)) continue;
    seen.add(cap.country);
    countries.push(cap);
  }
  countries.sort((a, b) => a.country.localeCompare(b.country));
  return { sku, pageCount: num(c.pageCount), countries };
}

export function normalizeProductCapability(input: unknown): ProductCapabilityConfig {
  const c = (input ?? {}) as Partial<ProductCapabilityConfig>;
  const probe = (c.probe ?? {}) as Partial<ProductCapabilityConfig["probe"]>;
  const seen = new Set<string>();
  const products: ProductCoverage[] = [];
  for (const raw of Array.isArray(c.products) ? c.products.slice(0, 200) : []) {
    const coverage = normalizeCoverage(raw);
    if (!coverage || seen.has(coverage.sku)) continue;
    seen.add(coverage.sku);
    products.push(coverage);
  }
  products.sort((a, b) => a.sku.localeCompare(b.sku));
  return {
    version: 1,
    probe: {
      copies: Math.max(1, num(probe.copies, 1)),
      currency: str(probe.currency, "USD", 3).toUpperCase() || "USD",
      env: probe.env === "live" ? "live" : "sandbox",
    },
    products,
    sweptAt: num(c.sweptAt),
  };
}

/**
 * This format's coverage by country, or `undefined` when it was never swept.
 *
 * The distinction is the whole contract. `undefined` means "we haven't asked",
 * and every caller must fall back to the country-level sweep rather than treat
 * it as "ships nowhere" — a product added between two sweeps would otherwise
 * vanish from the storefront the moment it was activated. An EMPTY map, by
 * contrast, is a real (if useless) answer.
 */
export function coverageFor(
  config: ProductCapabilityConfig,
  sku: string,
): ReadonlyMap<string, MarketCapability> | undefined {
  const code = (sku ?? "").trim().toUpperCase();
  const coverage = config.products.find((p) => p.sku === code);
  if (!coverage) return undefined;
  return new Map(coverage.countries.map((c) => [c.country, c]));
}

/** Every format's coverage, indexed for a projection that walks the catalog. */
export function productCapabilityIndex(
  config: ProductCapabilityConfig,
): ReadonlyMap<string, ReadonlyMap<string, MarketCapability>> {
  return new Map(
    config.products.map((p) => [
      p.sku,
      new Map(p.countries.map((c) => [c.country, c])) as ReadonlyMap<string, MarketCapability>,
    ]),
  );
}

/** What the admin's "re-check formats" button gets back from the sweep. */
export interface ProductSweepSummary {
  capability: ProductCapabilityConfig;
  /** Formats covered by this run. */
  formats: number;
  /** Cells (format × country) actually probed. */
  probed: number;
  available: number;
  refused: number;
  unknown: number;
  throttled: boolean;
  message?: string;
}
