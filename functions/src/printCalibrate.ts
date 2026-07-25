/**
 * Derive a product's cost model from the provider instead of typing it in.
 *
 * Measured against Lulu, print cost is linear in page count to within a cent:
 * every binding charges the same ~$0.2148 per page and differs only in the
 * per-unit base (casewrap $10.98, perfect-bound $2.16, saddle-stitch $4.37). So
 * two probes determine the line and a third checks it — if the midpoint misses,
 * the provider isn't pricing linearly any more and we refuse to write a table
 * that would quietly misstate margin.
 *
 * The result is a baseline, not a replacement for live quotes. It's what backs
 * offline projections, the margin/break-even guardrails, and pricing when a
 * live quote can't be fetched.
 */
import {
  normalizeProduct,
  type ProductCostModel,
  type ProductDefinition,
  type ProductsConfig,
} from "../../books-frontend/src/core/config/products";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { mapLimit } from "./concurrency";
import { probeSku, REFERENCE_DESTINATION, type SkuProbe } from "./printProbe";
import { getProductsConfig, saveProductsConfig } from "./products";

/** How far the midpoint may miss the fitted line before we distrust it. */
const FIT_TOLERANCE = 0.05;

/** Quantity probed for the shipping fallback — see `shippingFallback` below. */
const FALLBACK_SHIPPING_COPIES = 3;

/** A quantity break is only real if it beats the unit price by this much. */
const MIN_BREAK_PCT = 0.5;

export interface CostSample {
  pages: number;
  copies: number;
  unitCost: number;
}

export interface CalibrationResult {
  ok: boolean;
  /** Why calibration failed, or what to be aware of when it succeeded. */
  message?: string;
  env: FulfillmentEnv;
  /** The currency the provider quoted in — becomes the cost currency. */
  currency?: string;
  /** The derived table, ready to drop into `cost.table`. */
  table?: ProductCostModel["table"];
  /**
   * A stand-in for provider shipping when a live quote can't be fetched, probed
   * at a small multi-copy order rather than one copy: it's an outage fallback,
   * and overcharging ourselves is safer than undercharging the customer.
   */
  shippingFallback?: number;
  /** Page bounds the provider itself reported, when it volunteered them. */
  discoveredPages?: { min: number; max: number };
  /** Every probe taken, so the admin can see the evidence. */
  samples: CostSample[];
  /** How far the midpoint sample missed the fitted line. */
  fitResidual?: number;
}

/**
 * Lulu names the valid range when a page count is out of bounds ("page_count
 * must be in range 24-800"). Probing an absurd count is therefore the cheapest
 * way to discover a SKU's real limits — far better than trusting a hand-typed
 * number that only fails once a customer hits it.
 */
export function parsePageRange(message: string | undefined): { min: number; max: number } | undefined {
  const m = message?.match(/page_count must be in range\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (!m) return undefined;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : undefined;
}

/** Ask the provider for a SKU's true page bounds. */
export async function discoverPageRange(
  env: FulfillmentEnv,
  sku: string,
): Promise<{ min: number; max: number } | undefined> {
  const probe = await probeSku({ env, sku, pages: 100_000 });
  return parsePageRange(probe.message);
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

export interface CalibrateRequest {
  product: ProductDefinition;
  env: FulfillmentEnv;
}

export async function calibrateCost(req: CalibrateRequest): Promise<CalibrationResult> {
  const { product, env } = req;
  const sku = product.provider.sku?.trim();
  const base: CalibrationResult = { ok: false, env, samples: [] };

  if (product.provider.id !== "lulu" || !sku) {
    return { ...base, message: "Only print-provider products can be calibrated." };
  }

  // Prefer the provider's own bounds over the configured ones: calibrating
  // across a range the SKU doesn't support would just fail at the endpoints.
  const discovered = await discoverPageRange(env, sku);
  const range = discovered ?? product.conditions.pages;
  if (!(range.max > range.min)) {
    return { ...base, message: "Page range must span more than one value to fit a cost line." };
  }
  const mid = Math.round((range.min + range.max) / 2);

  const at = async (pages: number, copies = 1): Promise<SkuProbe> =>
    probeSku({ env, sku, pages, copies, destination: REFERENCE_DESTINATION });

  const [low, high] = [await at(range.min), await at(range.max)];
  for (const [probe, pages] of [
    [low, range.min],
    [high, range.max],
  ] as const) {
    if (probe.outcome !== "ok") {
      return {
        ...base,
        discoveredPages: discovered,
        message:
          probe.outcome === "rejected"
            ? `Provider rejected ${pages} pages: ${probe.message ?? "no reason given"}`
            : `Couldn't reach the provider: ${probe.message ?? "unknown error"}`,
      };
    }
  }

  const samples: CostSample[] = [
    { pages: range.min, copies: 1, unitCost: low.unitCost! },
    { pages: range.max, copies: 1, unitCost: high.unitCost! },
  ];

  const perPage = (high.unitCost! - low.unitCost!) / (range.max - range.min);
  const basePerUnit = low.unitCost! - perPage * range.min;
  if (perPage < 0 || basePerUnit < 0) {
    return { ...base, samples, message: "Provider costs don't form a sane line (negative base or per-page)." };
  }

  // The check that keeps this honest: a two-point fit ALWAYS passes through
  // both points, so only a third sample can tell us the relationship is really
  // linear.
  const midProbe = await at(mid);
  let fitResidual: number | undefined;
  if (midProbe.outcome === "ok") {
    samples.push({ pages: mid, copies: 1, unitCost: midProbe.unitCost! });
    fitResidual = Math.abs(basePerUnit + perPage * mid - midProbe.unitCost!);
    if (fitResidual > FIT_TOLERANCE) {
      return {
        ...base,
        samples,
        fitResidual,
        currency: low.currency,
        discoveredPages: discovered,
        message: `Cost isn't linear in page count (midpoint is off by ${fitResidual.toFixed(2)}). Enter the cost table by hand.`,
      };
    }
  }

  // Quantity breaks, only when the provider actually gives one.
  const quantityBreaks: ProductCostModel["table"]["quantityBreaks"] = [];
  const bulk = await at(mid, 10);
  if (bulk.outcome === "ok" && midProbe.outcome === "ok") {
    samples.push({ pages: mid, copies: 10, unitCost: bulk.unitCost! });
    const discountPct = ((midProbe.unitCost! - bulk.unitCost!) / midProbe.unitCost!) * 100;
    if (discountPct >= MIN_BREAK_PCT) {
      quantityBreaks.push({ minQty: 10, unitDiscountPct: round(discountPct, 2) });
    }
  }

  const shippingProbe = await at(mid, FALLBACK_SHIPPING_COPIES);
  const shippingFallback =
    shippingProbe.outcome === "ok" && shippingProbe.shippingCost
      ? round(shippingProbe.shippingCost, 2)
      : undefined;

  return {
    ok: true,
    env,
    currency: low.currency,
    table: { basePerUnit: round(basePerUnit, 4), perPage: round(perPage, 5), quantityBreaks },
    shippingFallback,
    discoveredPages: discovered,
    samples,
    fitResidual,
    message:
      discovered && (discovered.min !== product.conditions.pages.min || discovered.max !== product.conditions.pages.max)
        ? `Provider allows ${discovered.min}–${discovered.max} pages; this product is set to ${product.conditions.pages.min}–${product.conditions.pages.max}.`
        : undefined,
  };
}

/** Fold a successful calibration into a product, leaving everything else alone. */
export function withCalibration(
  product: ProductDefinition,
  result: CalibrationResult,
): ProductDefinition {
  if (!result.ok || !result.table) return product;
  const shipping =
    product.shipping.pricing.mode === "passthrough" && result.shippingFallback
      ? {
          ...product.shipping,
          pricing: { ...product.shipping.pricing, fallbackCost: result.shippingFallback },
        }
      : product.shipping;
  return normalizeProduct({
    ...product,
    cost: {
      ...product.cost,
      // The probe's currency IS the cost currency — anything else would make the
      // derived numbers mean something different from what they measure.
      currency: result.currency ?? product.cost.currency,
      table: result.table,
    },
    shipping,
  });
}

export interface CalibrationOutcome {
  result: CalibrationResult;
  /** The catalog after a successful calibration was persisted. */
  config: ProductsConfig;
}

/** Calibrate one product against `env` and persist the result when it succeeds. */
export async function calibrateAndSave(
  productId: string,
  env: FulfillmentEnv,
): Promise<CalibrationOutcome> {
  const config = await getProductsConfig();
  const product = config.products.find((p) => p.id === productId);
  if (!product) {
    return { result: { ok: false, env, samples: [], message: "Product not found." }, config };
  }

  const result = await calibrateCost({ product, env });
  if (!result.ok) return { result, config };

  const products = config.products.map((p) => (p.id === productId ? withCalibration(p, result) : p));
  return { result, config: await saveProductsConfig({ version: 1, products }) };
}

export interface CatalogCalibrationRun {
  productId: string;
  name: string;
  sku: string;
  ok: boolean;
  message?: string;
  currency?: string;
  /** The cost line before and after, so the admin can see what moved. */
  before: { basePerUnit: number; perPage: number };
  after?: { basePerUnit: number; perPage: number };
}

export interface CatalogCalibrationSummary {
  env: FulfillmentEnv;
  runs: CatalogCalibrationRun[];
  ok: number;
  failed: number;
  config: ProductsConfig;
}

/**
 * Re-measure every print product's cost in one pass.
 *
 * Each product costs ~6 provider round trips, so this runs three products wide:
 * enough to finish a catalog inside the function timeout without stacking up
 * requests the provider will start refusing. Failures are reported per product
 * and change nothing — a partial catalog of measured costs beats an aborted run.
 */
export async function calibrateCatalog(
  env: FulfillmentEnv,
  productId?: string,
): Promise<CatalogCalibrationSummary> {
  const config = await getProductsConfig();
  const targets = config.products.filter(
    (p) => p.provider.id === "lulu" && p.provider.sku.trim() && (!productId || p.id === productId),
  );

  const outcomes = await mapLimit(targets, 3, async (product) => ({
    product,
    result: await calibrateCost({ product, env }),
  }));

  const runs: CatalogCalibrationRun[] = outcomes.map(({ product, result }) => ({
    productId: product.id,
    name: product.presentation.name,
    sku: product.provider.sku,
    ok: result.ok,
    message: result.message,
    currency: result.currency,
    before: { basePerUnit: product.cost.table.basePerUnit, perPage: product.cost.table.perPage },
    after: result.table
      ? { basePerUnit: result.table.basePerUnit, perPage: result.table.perPage }
      : undefined,
  }));

  const byId = new Map(outcomes.filter((o) => o.result.ok).map((o) => [o.product.id, o.result]));
  const products = config.products.map((p) => {
    const result = byId.get(p.id);
    return result ? withCalibration(p, result) : p;
  });
  const saved = byId.size > 0 ? await saveProductsConfig({ version: 1, products }) : config;

  return {
    env,
    runs,
    ok: runs.filter((r) => r.ok).length,
    failed: runs.filter((r) => !r.ok).length,
    config: saved,
  };
}
