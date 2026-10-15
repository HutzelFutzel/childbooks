/**
 * Opening a market must be one click and nothing else.
 *
 * Enabling a country only records intent. For customers to actually be able to
 * order there, four more things have to be true — and used to be the admin's
 * job to remember:
 *
 *   1. the provider ships to the country at all        (country sweep)
 *   2. it makes each of OUR formats for that country   (per-format sweep)
 *   3. we know what shipping costs per format          (measured rate rows)
 *   4. the storefront catalog reflects the above       (re-projection)
 *
 * {@link onboardMarket} does all four for one country and reports, per product,
 * whether it is sellable there. Products are never edited to "enable" them: a
 * product is sellable in a market exactly when its destination policy allows
 * the country and the provider was observed to make it there, so a format that
 * the provider refuses is simply not offered and one it supports becomes
 * available automatically. A product with its own destination allowlist stays
 * limited to that list — narrowing is a deliberate choice and is reported, not
 * overridden.
 *
 * {@link findMarketsNeedingOnboarding} is the same question asked of the whole
 * registry, so a scheduled job can finish what an interrupted admin session
 * started. Nothing here requires the admin to stay on the page.
 */
import { logger } from "firebase-functions/v2";
import {
  offeredMethodsFor,
  destinationPolicyFor,
  isDestinationAllowed,
  shippingRowFor,
} from "../../books-frontend/src/core/config/productMath";
import { coverageFor } from "../../books-frontend/src/core/config/productCapability";
import { enabledMarkets, type MarketRegistry } from "../../books-frontend/src/core/config/markets";
import type { MarketCapability } from "../../books-frontend/src/core/config/marketCapability";
import type {
  MarketOnboardingReport,
  MarketOnboardingState,
  ProductMarketRow,
} from "../../books-frontend/src/core/config/marketOnboarding";
import type { ProductDefinition } from "../../books-frontend/src/core/config/products";
import type { ShippingMethod } from "../../books-frontend/src/core/fulfillment/types";
import { SANCTIONS_DENYLIST } from "../../books-frontend/src/core/config/countries";
import { raiseAlert, resolveAlert } from "./alerts";
import { luluCredentialsPresent } from "./lulu";
import { runMarketSweep } from "./marketDiscovery";
import { runProductSweep } from "./productDiscovery";
import { getMarketCapability, getMarketRegistry } from "./markets";
import { getProductCapability } from "./productCapability";
import { getProductsConfig, reprojectPublicProducts } from "./products";
import { getShippingSettings } from "./shipping";
import { measureShippingForCountries } from "./printCalibrate";
import { serverConfig } from "./config";

function activeEnv() {
  return serverConfig().fulfillment.lulu.env;
}

function isLive(p: ProductDefinition): boolean {
  return p.status === "active";
}

/** One product in one market, judged exactly as the storefront projection does. */
function judge(
  product: ProductDefinition,
  country: string,
  registry: MarketRegistry,
  settings: Awaited<ReturnType<typeof getShippingSettings>>,
  countryCap: MarketCapability | undefined,
  formatCap: ReadonlyMap<string, MarketCapability> | undefined,
): ProductMarketRow {
  const base = { productId: product.id, name: product.presentation.name };
  const priced = (["Budget", "StandardPlus", "Standard", "Express", "Overnight"] as ShippingMethod[]).some(
    (m) => shippingRowFor(product.shipping, country, m)?.available,
  );
  const policy = destinationPolicyFor(settings, product.shipping);
  if (!isDestinationAllowed(registry, policy, { country })) {
    return { ...base, state: "excluded", methods: [], priced, message: "Limited by this product's own destinations." };
  }
  // A format's own cell beats the country-level one — it is the more specific
  // evidence, and the projection reads them in the same order.
  const cap = formatCap?.get(country) ?? countryCap;
  if (cap?.status === "refused") {
    return { ...base, state: "refused", methods: [], priced, message: cap.message };
  }
  if (!cap || cap.status === "unknown") {
    return { ...base, state: "unknown", methods: [], priced, message: cap?.message };
  }
  const methods = offeredMethodsFor(settings, cap, product.shipping, country);
  if (methods.length === 0) {
    return {
      ...base,
      state: "refused",
      methods,
      priced,
      message: "None of the shipping speeds we offer are available for this format here.",
    };
  }
  return { ...base, state: isLive(product) ? "sellable" : "draft", methods, priced };
}

/** Read the current evidence and describe markets. No provider calls. */
export async function describeMarkets(countries: readonly string[]): Promise<MarketOnboardingReport[]> {
  const [catalog, registry, settings, countryCaps, formatCaps] = await Promise.all([
    getProductsConfig(),
    getMarketRegistry(),
    getShippingSettings(),
    getMarketCapability(),
    getProductCapability(),
  ]);
  const env = activeEnv();
  // Evidence recorded against the other environment says nothing about this one.
  const countryEvidence = countryCaps.probe.env === env ? countryCaps.countries : [];
  const sameEnvFormats = formatCaps.probe.env === env;
  const printProducts = catalog.products.filter((p) => p.provider.id === "lulu" && p.status !== "retired");

  return countries.map((country) => {
    const code = country.trim().toUpperCase();
    const countryCap = countryEvidence.find((c) => c.country === code);
    const products = printProducts.map((p) =>
      judge(
        p,
        code,
        registry,
        settings,
        countryCap,
        sameEnvFormats ? coverageFor(formatCaps, p.provider.sku) : undefined,
      ),
    );
    const live = products.filter((p) => printProducts.find((x) => x.id === p.productId)?.status === "active");
    const notes: string[] = [];
    let state: MarketOnboardingState;
    if (countryCap?.status === "refused") {
      state = "unreachable";
      notes.push(countryCap.message ?? "The print provider doesn't ship to this country.");
    } else if (live.some((p) => p.state === "sellable")) {
      state = "ready";
    } else if (live.length > 0 && live.every((p) => p.state === "refused" || p.state === "excluded")) {
      state = "nothing_sellable";
      notes.push("The provider ships here, but none of the live formats can be sold in this market.");
    } else {
      state = "pending";
    }
    if (live.some((p) => p.state === "sellable" && !p.priced)) {
      notes.push("Some formats have no measured shipping rate yet; they price from live quotes until it's measured.");
    }
    return {
      country: code,
      state,
      coverage: countryCap?.status ?? "unprobed",
      products,
      throttled: false,
      notes,
      at: Date.now(),
    };
  });
}

export async function describeMarket(country: string): Promise<MarketOnboardingReport> {
  return (await describeMarkets([country]))[0];
}

/**
 * Run the whole pipeline for one market and report the outcome.
 *
 * Each step is independent and resumable: a failure or a throttle in one leaves
 * the others' results intact and shows up as `unknown`, which the scheduled
 * job then retries. Nothing here throws on provider trouble.
 */
export async function onboardMarket(country: string): Promise<MarketOnboardingReport> {
  const code = country.trim().toUpperCase();
  const env = activeEnv();
  const notes: string[] = [];
  let throttled = false;

  const registry = await getMarketRegistry();
  if (!registry.enabled.has(code)) {
    throw new Error(`${code} is not an open market.`);
  }
  if (SANCTIONS_DENYLIST.has(code)) {
    throw new Error(`${code} can't be sold to.`);
  }

  if (!luluCredentialsPresent(env)) {
    const report = await describeMarket(code);
    return {
      ...report,
      notes: [`No print-provider credentials for ${env}, so coverage couldn't be checked.`, ...report.notes],
    };
  }

  try {
    const countrySweep = await runMarketSweep({ countries: [code] });
    throttled ||= countrySweep.throttled;
    if (countrySweep.message) notes.push(countrySweep.message);
  } catch (err) {
    logger.error(`[onboarding] country sweep failed for ${code}`, err);
    notes.push("Couldn't check country coverage; it will be retried automatically.");
  }

  try {
    const formatSweep = await runProductSweep();
    throttled ||= formatSweep.throttled;
    if (formatSweep.message) notes.push(formatSweep.message);
  } catch (err) {
    logger.error(`[onboarding] format sweep failed for ${code}`, err);
    notes.push("Couldn't check per-format coverage; it will be retried automatically.");
  }

  // Shipping rates only make sense where the provider ships; skip the (costly)
  // measurement for a country already known to be unreachable.
  const interim = await describeMarket(code);
  if (interim.state !== "unreachable") {
    try {
      const runs = await measureShippingForCountries(env, [code]);
      throttled ||= runs.some((r) => r.throttled);
    } catch (err) {
      logger.error(`[onboarding] shipping measurement failed for ${code}`, err);
      notes.push("Couldn't measure shipping rates; it will be retried automatically.");
    }
  }

  try {
    await reprojectPublicProducts();
  } catch (err) {
    logger.error(`[onboarding] reprojection failed for ${code}`, err);
    notes.push("Couldn't publish the updated catalog; use \"Rebuild catalog\" to retry.");
  }

  const report = await describeMarket(code);
  await settleMarketAlert(report);
  return { ...report, throttled, notes: [...notes, ...report.notes] };
}

/**
 * An open market where customers can't buy anything is a silent revenue hole:
 * the picker offers the country and every product vanishes. Raise it once the
 * evidence is settled (not while we're merely waiting on the provider), and
 * close it when it stops being true.
 */
async function settleMarketAlert(report: MarketOnboardingReport): Promise<void> {
  const ref = `market_${report.country}`;
  try {
    if (report.state === "nothing_sellable" || report.state === "unreachable") {
      await raiseAlert({
        severity: "critical",
        kind: "market_unsellable",
        ref,
        message:
          report.state === "unreachable"
            ? `Market ${report.country} is open but the print provider doesn't ship there. Close it under Configuration → Markets.`
            : `Market ${report.country} is open but no live product can be sold there. Close it, or check the formats' destinations.`,
        meta: { country: report.country, state: report.state },
      });
    } else if (report.state === "ready") {
      await resolveAlert(`market_unsellable_${ref}`);
    }
  } catch (err) {
    logger.warn(`[onboarding] alert update failed for ${report.country}`, err);
  }
}

/**
 * Open markets whose evidence is incomplete: no settled country verdict, or a
 * live product with no settled answer or no measured shipping rate for them.
 */
export async function findMarketsNeedingOnboarding(): Promise<string[]> {
  const [catalog, registry, countryCaps, formatCaps] = await Promise.all([
    getProductsConfig(),
    getMarketRegistry(),
    getMarketCapability(),
    getProductCapability(),
  ]);
  const env = activeEnv();
  const countryOk = countryCaps.probe.env === env;
  const formatsOk = formatCaps.probe.env === env;
  const products = catalog.products.filter(
    (p) => p.provider.id === "lulu" && p.provider.sku.trim() && p.status === "active",
  );

  const out: string[] = [];
  for (const country of enabledMarkets(registry)) {
    if (SANCTIONS_DENYLIST.has(country)) continue;
    const cap = countryOk ? countryCaps.countries.find((c) => c.country === country) : undefined;
    if (!cap || cap.status === "unknown") {
      out.push(country);
      continue;
    }
    // Known unreachable: nothing further to learn, and re-probing each run
    // would just spend the provider's rate budget.
    if (cap.status === "refused") continue;
    const needs = products.some((p) => {
      const cell = formatsOk ? coverageFor(formatCaps, p.provider.sku)?.get(country) : undefined;
      if (!cell || cell.status === "unknown") return true;
      if (cell.status === "refused") return false;
      const hasRow = ["Budget", "StandardPlus", "Standard", "Express", "Overnight"].some(
        (m) => shippingRowFor(p.shipping, country, m as ShippingMethod) != null,
      );
      return !hasRow;
    });
    if (needs) out.push(country);
  }
  return out;
}

/**
 * Finish onboarding for markets that need it, a few at a time so one run stays
 * inside the function timeout. Returns the countries it worked on.
 */
export async function onboardPendingMarkets(maxMarkets = 3): Promise<MarketOnboardingReport[]> {
  const pending = (await findMarketsNeedingOnboarding()).slice(0, maxMarkets);
  const reports: MarketOnboardingReport[] = [];
  for (const country of pending) {
    reports.push(await onboardMarket(country));
  }
  return reports;
}

/**
 * Re-evaluate every open market and raise/close the "nothing sellable" alert.
 * Cheap (stored evidence only), so it runs after every sweep and every
 * onboarding pass — a market that silently lost coverage is found within the
 * hour rather than by a customer.
 */
export async function auditOpenMarkets(): Promise<MarketOnboardingReport[]> {
  const registry = await getMarketRegistry();
  const reports = await describeMarkets(enabledMarkets(registry));
  for (const report of reports) await settleMarketAlert(report);
  return reports;
}
