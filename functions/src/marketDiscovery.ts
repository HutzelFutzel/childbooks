/**
 * Discover which countries the print provider will actually ship to.
 *
 * The provider publishes no list of served countries, so coverage has to be
 * asked for one country at a time. What makes that affordable is the shipping-
 * options endpoint: it returns EVERY service level for a destination in a
 * single call, needing only a country code — where pricing a specific order
 * needs a validated street address and one request per speed. The whole world
 * is therefore ~250 requests, not ~1,250 per product.
 *
 * Two rules this sweep exists to uphold:
 *
 *   1. A refusal and a failure are different. The provider saying "no service
 *      here" is evidence worth persisting; a rate limit or a dropped socket is
 *      our problem and must leave the previous verdict alone. Recording the
 *      second as the first is how one throttled probe permanently closes a
 *      country — the same trap `printCalibrate` documents, except this sweep
 *      makes fifty times as many calls.
 *
 *   2. Coverage is a fact about the PROVIDER, not about a product. It is swept
 *      once with a reference book and stored in its own document, so it can be
 *      re-run on a schedule without ever touching what an admin switched on.
 */
import type {
  MarketCapability,
  MarketCapabilityConfig,
} from "../../books-frontend/src/core/config/marketCapability";
import { normalizeMarketCapability } from "../../books-frontend/src/core/config/marketCapability";
import {
  PROBE_STATE,
  probeableCountries,
  SANCTIONS_DENYLIST,
} from "../../books-frontend/src/core/config/countries";
import { FulfillmentError } from "../../books-frontend/src/core/fulfillment/errors";
import {
  verificationFor,
  type ProviderEnv,
} from "../../books-frontend/src/core/config/products";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { mapLimit } from "./concurrency";
import { fulfillmentProviderFor, luluCredentialsPresent } from "./lulu";
import { getMarketCapability, saveMarketCapability } from "./markets";
import { getProductsConfig } from "./products";
import { serverConfig } from "./config";

/**
 * Concurrent probes.
 *
 * Low on purpose. The endpoint is cheap but the provider's rate limiter is
 * shared with checkout quoting, and a sweep that throttles itself produces
 * exactly the `unknown` rows it exists to avoid. Four in flight walks the world
 * in a couple of minutes, which is fast enough for something run by hand.
 */
const CONCURRENCY = 4;

/** Page count probed. Mid-range, so the answer is representative of a real book. */
const PROBE_PAGE_COUNT = 32;

/** Provider quoting currency for the indicative costs. */
const PROBE_CURRENCY = "USD";

export interface SweepRequest {
  env: FulfillmentEnv;
  /** Reference SKU to probe with — any real, verified product SKU. */
  sku: string;
  /** Restrict the sweep (used to retry only the unknowns). Defaults to the world. */
  countries?: string[];
  /** The previous sweep, so settled countries can be skipped. */
  previous?: MarketCapabilityConfig;
  /** Re-probe everything, including countries already settled. */
  force?: boolean;
  pageCount?: number;
}

export interface SweepResult {
  config: MarketCapabilityConfig;
  /** How many countries were actually asked about this run. */
  probed: number;
  available: number;
  refused: number;
  unknown: number;
  /** True when any probe was rate-limited — the run is incomplete, not final. */
  throttled: boolean;
  message?: string;
}

/**
 * Whether a country's verdict is settled enough to skip on a resumed run.
 *
 * `unknown` never is: it's the row that says we failed to ask. Everything else
 * is a real answer that a re-sweep would only confirm, which is what makes a
 * throttled sweep converge instead of restarting from zero.
 */
function settled(prev: MarketCapability | undefined): boolean {
  return prev != null && prev.status !== "unknown";
}

/** One country: ask the provider what it runs there. */
async function probeCountry(
  env: FulfillmentEnv,
  sku: string,
  pageCount: number,
  country: string,
): Promise<MarketCapability> {
  const provider = fulfillmentProviderFor(env);
  const probedAt = Date.now();
  if (!provider.shippingOptions) {
    return {
      country,
      status: "unknown",
      levels: [],
      message: "This provider cannot enumerate shipping options.",
      probedAt,
    };
  }
  try {
    const options = await provider.shippingOptions({
      productSku: sku,
      pageCount,
      copies: 1,
      destinationCountry: country,
      destinationState: PROBE_STATE[country],
      currency: PROBE_CURRENCY,
    });
    // An empty list is a real answer: the provider understood the country and
    // runs nothing to it.
    if (options.length === 0) {
      return {
        country,
        status: "refused",
        levels: [],
        message: "The provider offers no shipping service to this country.",
        probedAt,
      };
    }
    return {
      country,
      status: "available",
      levels: options.map((o) => ({
        level: o.level,
        ...(o.method ? { method: o.method } : {}),
        ...(o.transitDaysMin != null ? { transitDaysMin: o.transitDaysMin } : {}),
        ...(o.transitDaysMax != null ? { transitDaysMax: o.transitDaysMax } : {}),
        traceable: o.traceable,
        postboxOk: o.postboxOk,
        businessOnly: o.businessOnly,
        ...(o.cost ? { indicativeCost: Number(o.cost.amount) || 0 } : {}),
      })),
      probedAt,
    };
  } catch (err) {
    // Only a validation refusal is a statement about the country. Auth,
    // network, throttling and outages say nothing, and must not be written
    // down as "we don't ship there".
    const refused = err instanceof FulfillmentError && err.kind === "validation";
    return {
      country,
      status: refused ? "refused" : "unknown",
      levels: [],
      message: err instanceof Error ? err.message : "Probe failed.",
      probedAt,
    };
  }
}

export async function sweepMarketCapability(req: SweepRequest): Promise<SweepResult> {
  const sku = req.sku?.trim();
  const pageCount = req.pageCount ?? PROBE_PAGE_COUNT;
  const previous = req.previous ? normalizeMarketCapability(req.previous) : undefined;
  const prior = new Map((previous?.countries ?? []).map((c) => [c.country, c]));

  const base: MarketCapabilityConfig = {
    version: 1,
    probe: {
      sku: sku ?? "",
      pageCount,
      copies: 1,
      currency: PROBE_CURRENCY,
      env: req.env as ProviderEnv,
    },
    countries: previous?.countries ?? [],
    sweptAt: previous?.sweptAt ?? 0,
  };

  if (!sku) {
    return { config: base, probed: 0, available: 0, refused: 0, unknown: 0, throttled: false, message: "No reference SKU given." };
  }
  if (!luluCredentialsPresent(req.env)) {
    return {
      config: base,
      probed: 0,
      available: 0,
      refused: 0,
      unknown: 0,
      throttled: false,
      message: `No print-provider credentials for ${req.env}.`,
    };
  }

  // The sweep never asks about a destination we refuse on principle — a
  // sanctioned country's coverage is not a fact we need.
  const requested = (req.countries ?? probeableCountries())
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length === 2 && !SANCTIONS_DENYLIST.has(c));

  // A different reference SKU (or a fresh sweep) invalidates the old answers,
  // since coverage was measured for a different book.
  const sameProbe = previous?.probe.sku === sku && previous?.probe.env === req.env;
  const targets =
    req.force || !sameProbe ? requested : requested.filter((c) => !settled(prior.get(c)));

  const results = await mapLimit(targets, CONCURRENCY, (country) =>
    probeCountry(req.env, sku, pageCount, country),
  );

  // Merge onto the prior sweep so a partial run adds knowledge rather than
  // replacing the map with only what this run managed to reach.
  const merged = new Map(sameProbe && !req.force ? prior : []);
  for (const r of results) {
    // An `unknown` result must never overwrite a settled verdict — that is the
    // whole reason failures are distinguished from refusals.
    if (r.status === "unknown" && settled(merged.get(r.country))) continue;
    merged.set(r.country, r);
  }

  const countries = [...merged.values()].sort((a, b) => a.country.localeCompare(b.country));
  const config = normalizeMarketCapability({
    version: 1,
    probe: base.probe,
    countries,
    sweptAt: Date.now(),
  });

  const throttled = results.some((r) => r.status === "unknown" && /rate|429|throttl/i.test(r.message ?? ""));
  return {
    config,
    probed: targets.length,
    available: countries.filter((c) => c.status === "available").length,
    refused: countries.filter((c) => c.status === "refused").length,
    unknown: countries.filter((c) => c.status === "unknown").length,
    throttled,
    ...(throttled
      ? { message: "Some probes were rate-limited. Run the sweep again to fill the gaps." }
      : {}),
  };
}

/**
 * A SKU to probe country coverage with.
 *
 * Which one barely matters — the provider's shipping-options answer is about
 * the destination, not the book — but it must be a SKU the provider actually
 * recognises, or every country comes back refused for a reason that has nothing
 * to do with coverage. Prefers a product verified in the environment being
 * swept, then any print product with a SKU.
 */
export async function referenceSkuForSweep(env: FulfillmentEnv): Promise<string> {
  const { products } = await getProductsConfig();
  const printProducts = products.filter((p) => p.provider.id === "lulu" && p.provider.sku.trim());
  const verified = printProducts.find((p) => verificationFor(p.provider, env as ProviderEnv)?.ok);
  return (verified ?? printProducts[0])?.provider.sku.trim() ?? "";
}

/**
 * Read the previous sweep, probe, persist. The whole operation, so the admin
 * button and the scheduled refresh can't drift apart — one of them skipping the
 * "don't overwrite a settled verdict with a throttled unknown" merge would
 * silently close countries.
 *
 * Nothing is written when nothing was probed: a run that had no work to do (or
 * couldn't authenticate) must not stamp a fresh `sweptAt` on stale evidence and
 * make the staleness warning disappear without any new knowledge.
 */
export async function runMarketSweep(opts: {
  force?: boolean;
  sku?: string;
} = {}): Promise<SweepResult> {
  const env = serverConfig().fulfillment.lulu.env;
  const sku = opts.sku?.trim() || (await referenceSkuForSweep(env));
  const previous = await getMarketCapability();
  const result = await sweepMarketCapability({ env, sku, previous, force: opts.force });
  if (result.probed > 0) {
    return { ...result, config: await saveMarketCapability(result.config) };
  }
  return result;
}
