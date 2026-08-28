/**
 * Discover which formats the print provider will actually make for each market.
 *
 * The country sweep (`marketDiscovery.ts`) answers a question about a
 * DESTINATION and can afford to ask it about the whole world, because one
 * reference book speaks for all of them. This sweep answers a question about a
 * FORMAT in a destination, which the reference book cannot speak for:
 *
 *   8.5×8.5 paperback → AU   Australia Post,  MAIL + EXPRESS,           $8.34
 *   8.5×8.5 hardcover → AU   FedEx Intl,      MAIL + EXPEDITED + EXPRESS, $15.74
 *   11×8.5  hardcover → DE   loses GROUND, gains EXPEDITED
 *
 * Hardcovers aren't bound in every facility, so where one isn't produced
 * locally the book is printed elsewhere and imported — which changes the
 * carrier, roughly doubles the shipping, and changes WHICH SERVICE LEVELS
 * EXIST. That last part is the one that breaks orders: quoting a level the
 * provider doesn't run for that format to that country is a hard refusal, and
 * without this document we'd only find out after the customer had paid.
 *
 * SCOPE IS DELIBERATELY SMALL: active formats × OPEN markets. The full cross
 * product against every country would multiply the weekly world sweep by the
 * size of the catalog to answer questions about countries nobody can order
 * from. A dozen formats across six markets is well under a hundred requests,
 * which fits comfortably beside the existing sweep.
 *
 * The two rules from the country sweep carry over unchanged, and for the same
 * reasons: a refusal and a failure are different, and a throttled probe must
 * never overwrite a settled verdict.
 */
import type {
  ProductCapabilityConfig,
  ProductCoverage,
} from "../../books-frontend/src/core/config/productCapability";
import { normalizeProductCapability } from "../../books-frontend/src/core/config/productCapability";
import type { MarketCapability } from "../../books-frontend/src/core/config/marketCapability";
import { SANCTIONS_DENYLIST } from "../../books-frontend/src/core/config/countries";
import type {
  ProductDefinition,
  ProviderEnv,
} from "../../books-frontend/src/core/config/products";
import { enabledMarkets } from "../../books-frontend/src/core/config/markets";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { mapLimit } from "./concurrency";
import { luluCredentialsPresent } from "./lulu";
import { probeCountry } from "./marketDiscovery";
import { getMarketRegistry } from "./markets";
import { getProductCapability, saveProductCapability } from "./productCapability";
import { getProductsConfig } from "./products";
import { serverConfig } from "./config";

/**
 * Concurrent probes. Same ceiling as the country sweep and for the same reason:
 * the provider's limiter is shared with checkout quoting, and a sweep that
 * throttles itself manufactures the `unknown` rows it exists to eliminate.
 */
const CONCURRENCY = 4;

/** Bound one invocation, so a large catalog can't run past the timeout. */
const DEFAULT_MAX_CELLS = 400;

const PROBE_CURRENCY = "USD";

/**
 * The page count to probe a format at.
 *
 * Formats accept wildly different ranges (saddle stitch stops at 48 where
 * casewrap runs to 800), so there is no single valid number. The midpoint of
 * the product's OWN configured range is representative of what people order and
 * is guaranteed to be inside the range the provider will price.
 */
function probePageCount(product: ProductDefinition): number {
  const { min, max } = product.conditions.pages;
  const mid = Math.round((min + Math.min(max, min * 3)) / 2);
  return Math.max(min, Math.min(max, mid));
}

export interface ProductSweepRequest {
  env: FulfillmentEnv;
  products: readonly ProductDefinition[];
  countries: readonly string[];
  previous?: ProductCapabilityConfig;
  /** Re-probe cells that already have a settled verdict. */
  force?: boolean;
  maxCells?: number;
}

export interface ProductSweepResult {
  config: ProductCapabilityConfig;
  formats: number;
  probed: number;
  available: number;
  refused: number;
  unknown: number;
  throttled: boolean;
  message?: string;
}

/** A verdict worth skipping on a resumed run — anything but "we failed to ask". */
function settled(prev: MarketCapability | undefined): boolean {
  return prev != null && prev.status !== "unknown";
}

/**
 * The formats worth probing: ones the provider actually prints, that aren't
 * retired, and that carry a SKU.
 *
 * Retired products are excluded because measuring a book nobody can buy spends
 * the same provider budget as measuring one they can. Drafts are NOT excluded —
 * an admin activating a format needs its coverage to already be on record, or
 * the storefront hides it until the next sweep.
 */
function sweepableProducts(products: readonly ProductDefinition[]): ProductDefinition[] {
  return products.filter(
    (p) => p.provider.id === "lulu" && p.provider.sku.trim() && p.status !== "retired",
  );
}

export async function sweepProductCapability(
  req: ProductSweepRequest,
): Promise<ProductSweepResult> {
  const previous = req.previous ? normalizeProductCapability(req.previous) : undefined;
  const sameProbe = previous?.probe.env === req.env;
  const prior = new Map<string, ProductCoverage>(
    (sameProbe ? (previous?.products ?? []) : []).map((p) => [p.sku, p]),
  );

  const base: ProductCapabilityConfig = {
    version: 1,
    probe: { copies: 1, currency: PROBE_CURRENCY, env: req.env as ProviderEnv },
    products: previous?.products ?? [],
    sweptAt: previous?.sweptAt ?? 0,
  };

  const targets = sweepableProducts(req.products);
  if (targets.length === 0) {
    return { ...empty(base), message: "No print formats to measure." };
  }
  if (!luluCredentialsPresent(req.env)) {
    return { ...empty(base), message: `No print-provider credentials for ${req.env}.` };
  }

  // A sanctioned destination's coverage is not a fact we need — payment is
  // declined there regardless of what the printer would carry.
  const countries = [...new Set(req.countries.map((c) => c.trim().toUpperCase()))].filter(
    (c) => c.length === 2 && !SANCTIONS_DENYLIST.has(c),
  );
  if (countries.length === 0) {
    return { ...empty(base), message: "No open markets to measure against." };
  }

  // Flatten to cells so the concurrency limit and the per-invocation budget
  // apply across the whole sweep rather than per product — a catalog of twelve
  // formats probed six countries at a time would serialize into twelve batches.
  interface Cell {
    sku: string;
    pageCount: number;
    country: string;
  }
  const cells: Cell[] = [];
  for (const product of targets) {
    const sku = product.provider.sku.trim().toUpperCase();
    const pageCount = probePageCount(product);
    const prev = prior.get(sku);
    // A different page count invalidates the stored costs (shipping is priced
    // by weight), so those cells are re-asked even on a resumed run.
    const pageChanged = prev != null && prev.pageCount !== pageCount;
    const priorByCountry = new Map((prev?.countries ?? []).map((c) => [c.country, c]));
    for (const country of countries) {
      if (!req.force && !pageChanged && settled(priorByCountry.get(country))) continue;
      cells.push({ sku, pageCount, country });
    }
  }

  const budget = req.maxCells ?? DEFAULT_MAX_CELLS;
  const batch = cells.slice(0, budget);
  const results = await mapLimit(batch, CONCURRENCY, async (cell) => ({
    ...cell,
    capability: await probeCountry(req.env, cell.sku, cell.pageCount, cell.country),
  }));

  // Merge onto the prior sweep: a partial run must add knowledge rather than
  // replace the matrix with only the cells this run managed to reach.
  const merged = new Map<string, Map<string, MarketCapability>>();
  const pageCounts = new Map<string, number>();
  for (const product of targets) {
    const sku = product.provider.sku.trim().toUpperCase();
    pageCounts.set(sku, probePageCount(product));
    const prev = prior.get(sku);
    merged.set(sku, new Map((prev?.countries ?? []).map((c) => [c.country, c])));
  }
  for (const r of results) {
    const byCountry = merged.get(r.sku);
    if (!byCountry) continue;
    // An `unknown` must never overwrite a settled verdict — the entire reason
    // failures are distinguished from refusals.
    if (r.capability.status === "unknown" && settled(byCountry.get(r.country))) continue;
    byCountry.set(r.country, r.capability);
  }

  const products: ProductCoverage[] = [...merged.entries()]
    .map(([sku, byCountry]) => ({
      sku,
      pageCount: pageCounts.get(sku) ?? 0,
      countries: [...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country)),
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const config = normalizeProductCapability({
    version: 1,
    probe: base.probe,
    products,
    sweptAt: Date.now(),
  });

  const cellsOf = (status: MarketCapability["status"]) =>
    products.reduce((n, p) => n + p.countries.filter((c) => c.status === status).length, 0);
  const throttled = results.some(
    (r) => r.capability.status === "unknown" && /rate|429|throttl/i.test(r.capability.message ?? ""),
  );
  const incomplete = cells.length > batch.length;
  return {
    config,
    formats: products.length,
    probed: batch.length,
    available: cellsOf("available"),
    refused: cellsOf("refused"),
    unknown: cellsOf("unknown"),
    throttled,
    ...(throttled
      ? { message: "Some probes were rate-limited. Run the sweep again to fill the gaps." }
      : incomplete
        ? { message: `Stopped after ${batch.length} of ${cells.length} checks. Run it again to continue.` }
        : {}),
  };
}

function empty(config: ProductCapabilityConfig): ProductSweepResult {
  return {
    config,
    formats: config.products.length,
    probed: 0,
    available: 0,
    refused: 0,
    unknown: 0,
    throttled: false,
  };
}

/**
 * Read the catalog and the open markets, probe, persist. The whole operation,
 * so the admin button and the scheduled refresh can't drift apart.
 *
 * Nothing is written when nothing was probed: a run with no work to do (or one
 * that couldn't authenticate) must not stamp a fresh `sweptAt` on stale
 * evidence and make the staleness warning disappear without new knowledge.
 */
export async function runProductSweep(
  opts: { force?: boolean; maxCells?: number } = {},
): Promise<ProductSweepResult> {
  const env = serverConfig().fulfillment.lulu.env;
  const [catalog, registry, previous] = await Promise.all([
    getProductsConfig(),
    getMarketRegistry(),
    getProductCapability(),
  ]);
  const result = await sweepProductCapability({
    env,
    products: catalog.products,
    countries: enabledMarkets(registry),
    previous,
    force: opts.force,
    maxCells: opts.maxCells,
  });
  if (result.probed > 0) {
    return { ...result, config: await saveProductCapability(result.config) };
  }
  return result;
}
