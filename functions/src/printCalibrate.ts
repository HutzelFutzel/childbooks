/**
 * Derive a product's cost model from the provider instead of typing it in.
 *
 * Print cost is `base + perPage × pages`, and the two halves belong to
 * different things. The base pays for the cover and the binding, so it is a
 * property of the FORMAT and is shared by every variant of it. The per-page
 * rate pays for ink and paper, so it belongs to the VARIANT and swings by more
 * than an order of magnitude between premium colour on coated stock and
 * standard black & white on uncoated. Measuring one line for the whole product
 * therefore prices exactly one variant correctly and overstates all the rest.
 *
 * So the fit is CONSTRAINED to that shape: one intercept for the product, one
 * slope per variant, and the intercept re-derived from every sample rather than
 * from the two endpoints of one of them. That is both more accurate and cheaper
 * than fitting each variant independently — and it stops the base cost drifting
 * between variants, which would be fitting noise and calling it a price.
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
  type ProviderEnv,
  type ShippingFallbackRow,
} from "../../books-frontend/src/core/config/products";
import { isDestinationAllowed } from "../../books-frontend/src/core/config/productMath";
import {
  costVariantKey,
  enumerateVariants,
  variantSummary,
  type VariantSelection,
} from "../../books-frontend/src/core/config/variants";
import { skuForVariant, variantFromSku } from "../../books-frontend/src/core/fulfillment/lulu/skuAxes";
import type { ShippingMethod } from "../../books-frontend/src/core/fulfillment/types";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { mapLimit } from "./concurrency";
import {
  probeShippingTiers,
  probeSku,
  REFERENCE_DESTINATION,
  type ProbeDestination,
  type SkuProbe,
} from "./printProbe";
import { getProductsConfig, saveProductsConfig } from "./products";

/** How far a sample may miss the fitted line before we distrust the fit. */
const FIT_TOLERANCE = 0.05;

/** A quantity break is only real if it beats the unit price by this much. */
const MIN_BREAK_PCT = 0.5;

/**
 * Quantities probed for volume discounts. A children's-book order is usually
 * one or two copies, so the ladder exists for the school and gift-set orders
 * that aren't — and one probe at ten copies, which is what this used to do,
 * finds nothing when the provider's first break is higher than that.
 */
const QUANTITY_LADDER = [5, 10, 20, 50];

/**
 * Copy counts the shipping fit uses. Two points determine the line; they are
 * deliberately small and realistic, because the fit is extrapolated to whatever
 * a customer actually orders and accuracy in the 1–5 range is what matters.
 */
const SHIPPING_COPY_POINTS = [1, 4];

/**
 * Destinations the shipping matrix is measured against.
 *
 * Not a sample of everywhere we sell — a representative one per shipping
 * region, because carrier pricing and tier availability change by region far
 * more than by country within one. The US row also serves as the catch-all when
 * an order goes somewhere unmeasured.
 */
const SHIPPING_ZONES: ProbeDestination[] = [
  REFERENCE_DESTINATION,
  { country: "GB", city: "London", postalCode: "SW1A 1AA", line1: "1 High St" },
  { country: "DE", city: "Berlin", postalCode: "10115", line1: "Hauptstr 1" },
  { country: "AU", state: "NSW", city: "Sydney", postalCode: "2000", line1: "1 George St" },
  { country: "CA", state: "ON", city: "Toronto", postalCode: "M5H 2N2", line1: "1 King St" },
];

export interface CostSample {
  pages: number;
  copies: number;
  unitCost: number;
  /** Which variant was priced (`print/paper`); absent ⇒ the base variant. */
  variant?: string;
}

/** One variant's measured per-page rate, and how well it fitted. */
export interface VariantCostSample {
  key: string;
  label: string;
  perPage: number;
  /** How far the worst sample missed this variant's fitted line. */
  residual: number;
}

export interface CalibrationResult {
  ok: boolean;
  /** Why calibration failed, or what to be aware of when it succeeded. */
  message?: string;
  /**
   * Set when the cost fit succeeded but the shipping sweep did not. The cost
   * table is still worth writing, but a passthrough product remains unsellable
   * until shipping is measured — so this must be reported rather than folded
   * into a green "measured" and discovered later at checkout.
   */
  shippingMessage?: string;
  env: FulfillmentEnv;
  /** The currency the provider quoted in — becomes the cost currency. */
  currency?: string;
  /** The derived table, ready to drop into `cost.table`. */
  table?: ProductCostModel["table"];
  /** Per-page cost for each measured variant, keyed by `costVariantKey`. */
  variantPerPage?: Record<string, number>;
  /** What each variant measured, for showing the evidence. */
  variants: VariantCostSample[];
  /**
   * Some part of this run was rate-limited rather than answered.
   *
   * Kept distinct from `ok`, because the numbers we DID get are still good and
   * worth keeping — but the gaps are ours, not the provider's, and a run in
   * this state must not be presented as a complete picture of the catalog.
   */
  throttled?: boolean;
  /** How many variants went unmeasured because we were throttled. */
  variantsThrottled?: number;
  /** Measured provider shipping: cost per country + tier, and availability. */
  shippingRows?: ShippingFallbackRow[];
  /**
   * The worst measured shipping cost at a small order, kept as the scalar
   * catch-all for destinations the sweep never visited. Overcharging ourselves
   * on an unmeasured route is safer than shipping it for free.
   */
  shippingFallback?: number;
  /** Page bounds the provider itself reported, when it volunteered them. */
  discoveredPages?: { min: number; max: number };
  /** Every probe taken, so the admin can see the evidence. */
  samples: CostSample[];
  /** How far the worst sample missed the fitted line. */
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

/**
 * Fit `base + perPage × pages` to two points, then snap both numbers to
 * plausible precision and re-derive the base from every sample.
 *
 * The raw intercept of a two-point fit is an extrapolation to a zero-page book,
 * carrying the provider's cent-rounding on both endpoints — which is how a real
 * $2.16 base cost comes out as `2.1562` and reads like false precision. Taking
 * the MEDIAN residual across samples recovers the number the provider is
 * actually charging, and snapping it to whole cents makes it a price rather
 * than an artifact. The slope keeps five decimals because it is multiplied by
 * up to 800 pages: rounding $0.2148 to $0.21 would lose nearly four dollars on
 * a long book.
 */
export function fitCostLine(samples: { pages: number; unitCost: number }[]): {
  basePerUnit: number;
  perPage: number;
  residual: number;
} | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a.pages - b.pages);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (high.pages <= low.pages) return null;

  const perPage = round((high.unitCost - low.unitCost) / (high.pages - low.pages), 5);
  const intercepts = sorted.map((s) => s.unitCost - perPage * s.pages).sort((a, b) => a - b);
  const mid = Math.floor(intercepts.length / 2);
  const median =
    intercepts.length % 2 === 1 ? intercepts[mid] : (intercepts[mid - 1] + intercepts[mid]) / 2;
  const basePerUnit = round(median, 2);
  if (perPage < 0 || basePerUnit < 0) return null;

  const residual = Math.max(
    ...sorted.map((s) => Math.abs(basePerUnit + perPage * s.pages - s.unitCost)),
  );
  return { basePerUnit, perPage, residual };
}

export interface CalibrateRequest {
  product: ProductDefinition;
  env: FulfillmentEnv;
}

/** Cost-distinct variants this product offers, one per `print/paper` pair. */
function costVariants(product: ProductDefinition): { key: string; selection: VariantSelection }[] {
  const seen = new Map<string, VariantSelection>();
  for (const variant of enumerateVariants(product.variants)) {
    const key = costVariantKey(variant);
    if (!seen.has(key)) seen.set(key, variant);
  }
  return [...seen].map(([key, selection]) => ({ key, selection }));
}

export async function calibrateCost(req: CalibrateRequest): Promise<CalibrationResult> {
  const { product, env } = req;
  const sku = product.provider.sku?.trim();
  const base: CalibrationResult = { ok: false, env, samples: [], variants: [] };

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
  const pagePoints = [range.min, mid, range.max];

  const at = async (pages: number, copies = 1, forSku = sku): Promise<SkuProbe> =>
    probeSku({ env, sku: forSku, pages, copies, destination: REFERENCE_DESTINATION });

  // ---- The base variant's line, from three points -------------------------
  const baseProbes = await Promise.all(pagePoints.map((pages) => at(pages)));
  const samples: CostSample[] = [];
  for (const [i, probe] of baseProbes.entries()) {
    if (probe.outcome !== "ok") {
      return {
        ...base,
        discoveredPages: discovered,
        throttled: probe.throttled,
        message: probe.throttled
          ? "The provider rate-limited us before it priced anything. Nothing is wrong with this product — try again in a minute."
          : probe.outcome === "rejected"
            ? `Provider rejected ${pagePoints[i]} pages: ${probe.message ?? "no reason given"}`
            : `Couldn't reach the provider: ${probe.message ?? "unknown error"}`,
      };
    }
    samples.push({ pages: pagePoints[i], copies: 1, unitCost: probe.unitCost! });
  }

  const fit = fitCostLine(samples);
  if (!fit) {
    return { ...base, samples, message: "Provider costs don't form a sane line (negative base or per-page)." };
  }
  // Three points through a two-point fit: the middle one is the only thing that
  // can tell us the relationship really is linear, so a miss is disqualifying.
  if (fit.residual > FIT_TOLERANCE) {
    return {
      ...base,
      samples,
      fitResidual: fit.residual,
      currency: baseProbes[0].currency,
      discoveredPages: discovered,
      message: `Cost isn't linear in page count (off by ${fit.residual.toFixed(2)} at worst). Enter the cost table by hand.`,
    };
  }

  // ---- One slope per variant, sharing that intercept ----------------------
  const baseVariant = variantFromSku(sku);
  const baseKey = baseVariant ? costVariantKey(baseVariant) : null;
  const variantPerPage: Record<string, number> = {};
  const variantSamples: VariantCostSample[] = [];
  let worstResidual = fit.residual;

  const others = costVariants(product).filter((v) => v.key !== baseKey);
  if (baseKey) {
    const baseSelection = costVariants(product).find((v) => v.key === baseKey)?.selection;
    variantPerPage[baseKey] = fit.perPage;
    variantSamples.push({
      key: baseKey,
      label: baseSelection ? `${variantSummary(baseSelection)} (base)` : "base",
      perPage: fit.perPage,
      residual: fit.residual,
    });
  }

  // Two points per variant suffice: the intercept is the format's, already
  // measured above. The endpoints are used because the widest span gives the
  // slope the most signal against the provider's cent rounding.
  const variantProbes = await mapLimit(others, 3, async ({ key, selection }) => {
    const variantSku = skuForVariant(sku, selection);
    if (!variantSku) return { key, selection, skipped: "unsupported" as const };
    const [low, high] = await Promise.all([at(range.min, 1, variantSku), at(range.max, 1, variantSku)]);
    if (low.outcome !== "ok" || high.outcome !== "ok") {
      // Throttled is NOT the same as unavailable. Both leave the variant
      // unmeasured, but only one of them is a fact about the catalog, and a
      // report that conflates them presents an outage as a finding.
      const throttled = low.throttled || high.throttled;
      return { key, selection, skipped: throttled ? ("throttled" as const) : ("refused" as const) };
    }
    return { key, selection, low, high };
  });

  let variantsThrottled = 0;
  for (const probe of variantProbes) {
    if ("skipped" in probe) {
      if (probe.skipped === "throttled") variantsThrottled += 1;
      continue;
    }
    const { key, selection, low, high } = probe;
    samples.push(
      { pages: range.min, copies: 1, unitCost: low.unitCost!, variant: key },
      { pages: range.max, copies: 1, unitCost: high.unitCost!, variant: key },
    );
    const perPage = round((high.unitCost! - low.unitCost!) / (range.max - range.min), 5);
    if (perPage < 0) continue;
    // Measured against the SHARED base: a variant whose samples only fit with a
    // different base cost isn't a cheaper interior, it's a bad measurement.
    const residual = Math.max(
      Math.abs(fit.basePerUnit + perPage * range.min - low.unitCost!),
      Math.abs(fit.basePerUnit + perPage * range.max - high.unitCost!),
    );
    if (residual > FIT_TOLERANCE) continue;
    variantPerPage[key] = perPage;
    variantSamples.push({ key, label: variantSummary(selection), perPage, residual });
    worstResidual = Math.max(worstResidual, residual);
  }

  // ---- Volume discounts ---------------------------------------------------
  const quantityBreaks: ProductCostModel["table"]["quantityBreaks"] = [];
  const unitAtMid = samples.find((s) => s.pages === mid && s.copies === 1 && !s.variant)?.unitCost;
  if (unitAtMid) {
    const ladder = QUANTITY_LADDER.filter((q) => q <= Math.max(1, product.conditions.copies.max));
    const bulk = await Promise.all(ladder.map((copies) => at(mid, copies)));
    for (const [i, probe] of bulk.entries()) {
      if (probe.outcome !== "ok") continue;
      samples.push({ pages: mid, copies: ladder[i], unitCost: probe.unitCost! });
      const discountPct = ((unitAtMid - probe.unitCost!) / unitAtMid) * 100;
      // Only record a step that beats the one below it, so a flat run of
      // quantities doesn't become four identical rows.
      const previous = quantityBreaks[quantityBreaks.length - 1]?.unitDiscountPct ?? 0;
      if (discountPct >= MIN_BREAK_PCT && discountPct > previous + MIN_BREAK_PCT / 2) {
        quantityBreaks.push({ minQty: ladder[i], unitDiscountPct: round(discountPct, 2) });
      }
    }
  }

  // ---- Shipping ------------------------------------------------------------
  const shipping = await measureShipping(env, sku, product);

  const pageNote =
    discovered && (discovered.min !== product.conditions.pages.min || discovered.max !== product.conditions.pages.max)
      ? `Provider allows ${discovered.min}–${discovered.max} pages; this product is set to ${product.conditions.pages.min}–${product.conditions.pages.max}.`
      : undefined;
  const throttleNote =
    variantsThrottled > 0
      ? `${variantsThrottled} variant${variantsThrottled === 1 ? " was" : "s were"} skipped because the provider rate-limited us — they're not unavailable, just unmeasured. Re-run to fill them in.`
      : undefined;

  return {
    ok: true,
    env,
    currency: baseProbes[0].currency,
    table: { basePerUnit: fit.basePerUnit, perPage: fit.perPage, quantityBreaks },
    variantPerPage,
    variants: variantSamples,
    variantsThrottled,
    throttled: variantsThrottled > 0 || shipping.throttled === true,
    shippingRows: shipping.rows,
    shippingFallback: shipping.fallback,
    shippingMessage: shipping.message,
    discoveredPages: discovered,
    samples,
    fitResidual: worstResidual,
    message: [throttleNote, pageNote].filter(Boolean).join(" ") || undefined,
  };
}

/**
 * Sweep shipping across destinations and tiers.
 *
 * The expensive half of a calibration by some margin — the provider prices one
 * speed per request, so this is (zones × copy points × speeds) round trips —
 * which is why the zones are a handful of representatives rather than every
 * country we sell to, and why the whole thing runs at bounded concurrency.
 *
 * Two copy points, not one, because a passthrough product BILLS this number to
 * the customer when a live quote fails. Fitting `base + perCopy × copies` means
 * the person buying one copy isn't charged what three would cost.
 *
 * A tier missing from a zone's response is recorded as unavailable, which is
 * the part that can't be guessed — the provider doesn't run GROUND to the US or
 * EXPEDITED outside it, and offering one anyway fails the order after the
 * customer has typed their address.
 */
async function measureShipping(
  env: FulfillmentEnv,
  sku: string,
  product: ProductDefinition,
): Promise<{
  rows?: ShippingFallbackRow[];
  fallback?: number;
  throttled?: boolean;
  message?: string;
}> {
  // Measured at the length the product is normally sold at, not the midpoint of
  // its allowed range — shipping is priced by weight, and the midpoint of
  // 24–800 pages is a book nobody orders.
  const pages = Math.min(
    Math.max(product.pricing.displayPages ?? product.conditions.pages.min, product.conditions.pages.min),
    product.conditions.pages.max,
  );

  const zones = SHIPPING_ZONES.filter((z) => sellsTo(product, z.country));
  if (zones.length === 0) return { message: "No measurable destination is allowed by the geo policy." };

  const results = await mapLimit(zones, 3, async (zone) => ({
    zone,
    probes: await Promise.all(
      SHIPPING_COPY_POINTS.map((copies) =>
        probeShippingTiers({ env, sku, pages, copies, destination: zone }),
      ),
    ),
  }));

  const rows: ShippingFallbackRow[] = [];
  const failures: string[] = [];
  const undetermined: string[] = [];
  let throttled = false;
  for (const { zone, probes } of results) {
    const [one, many] = probes;
    // Read before the early return: a zone can answer while individual speeds
    // within it were throttled, and those gaps are ours rather than the
    // provider's just the same.
    if (one.throttled || many.throttled) throttled = true;
    if (one.outcome !== "ok" || many.outcome !== "ok") {
      failures.push(`${zone.country} (${one.message ?? many.message ?? "no quote"})`);
      continue;
    }
    for (const method of ALL_METHODS) {
      const a = one.tiers.find((t) => t.method === method);
      const b = many.tiers.find((t) => t.method === method);
      if (a && b) {
        const span = SHIPPING_COPY_POINTS[1] - SHIPPING_COPY_POINTS[0];
        const perCopy = Math.max(0, round((b.shippingCost - a.shippingCost) / span, 2));
        const base = Math.max(0, round(a.shippingCost - perCopy * SHIPPING_COPY_POINTS[0], 2));
        rows.push({ country: zone.country, method, available: true, base, perCopy });
        continue;
      }
      // Refused at EITHER order size is a real gap: a speed the provider won't
      // run to four copies would fail that customer's order at checkout just as
      // surely as one it won't run at all.
      if (one.refused.includes(method) || many.refused.includes(method)) {
        rows.push({ country: zone.country, method, available: false, base: 0, perCopy: 0 });
        continue;
      }
      // Neither priced nor refused — we simply didn't find out. Writing no row
      // is the honest record: an absent row means "unknown" and falls through to
      // the scalar, where `available: false` would be a standing claim that this
      // speed doesn't reach this country, blocking saves until someone re-ran a
      // measurement they had no reason to suspect.
      undetermined.push(`${zone.country} ${method}`);
    }
  }

  if (rows.length === 0) {
    return {
      throttled,
      message: throttled
        ? "Couldn't measure shipping: the provider rate-limited us. Nothing is wrong with the product — re-run in a minute."
        : `Couldn't measure shipping: ${failures.join("; ") || "no quotes returned"}.`,
    };
  }

  // The scalar catch-all is the dearest single-copy route we saw, and it is
  // ONLY written when every zone answered.
  //
  // It's charged to customers whose destination we never measured, so deriving
  // it from a partial sweep bills them whatever the surviving zones happened to
  // be: a run where only Canada answered would quote a Canadian rate to a UK
  // buyer. A partial sweep still yields useful per-country rows — those are
  // measurements of the zones they name — but it must not be generalized into
  // a number that stands in for the zones it missed.
  const complete = failures.length === 0 && undetermined.length === 0;
  const singles = rows.filter((r) => r.available).map((r) => r.base + r.perCopy);
  const fallback = complete && singles.length > 0 ? round(Math.max(...singles), 2) : undefined;

  const measured = [...new Set(rows.map((r) => r.country))].join(", ");
  let note: string | undefined;
  if (throttled && undetermined.length > 0 && failures.length === 0) {
    note = `Couldn't determine ${undetermined.join(", ")} — the provider rate-limited those requests, so they're recorded as unknown rather than unavailable. Re-run in a minute to settle them.`;
  } else if (throttled) {
    note = `Shipping was only measured for ${measured} — the provider rate-limited the rest, so no catch-all rate was set. Re-run to complete it.`;
  } else if (failures.length > 0) {
    note = `Some destinations couldn't be measured: ${failures.join("; ")}. No catch-all shipping rate was set, because one derived from the destinations that did answer would be charged to the ones that didn't.`;
  } else if (undetermined.length > 0) {
    // Named individually rather than counted: which speed to which country is
    // exactly what the admin needs to judge whether it's worth re-running.
    note = `Couldn't determine ${undetermined.join(", ")} — those requests failed rather than being refused, so they're recorded as unknown rather than unavailable. Re-run to settle them.`;
  }

  return { rows, fallback, throttled, message: note };
}

const ALL_METHODS: ShippingMethod[] = ["Budget", "Standard", "StandardPlus", "Express", "Overnight"];

/**
 * Whether we sell this product to a country at all.
 *
 * Delegates rather than reimplementing: this was a third copy of the geo rule,
 * and a sweep that measured a market the order path refuses (or skipped one it
 * accepts) would leave the cost table and checkout disagreeing about where we
 * ship.
 */
function sellsTo(product: ProductDefinition, country: string): boolean {
  return isDestinationAllowed(product.shipping.destinations, { country });
}

/** Fold a successful calibration into a product, leaving everything else alone. */
export function withCalibration(
  product: ProductDefinition,
  result: CalibrationResult,
): ProductDefinition {
  if (!result.ok || !result.table) return product;

  const shipping = { ...product.shipping };
  if (result.shippingRows && result.shippingRows.length > 0) {
    shipping.fallback = result.shippingRows;
    shipping.fallbackMeasuredAt = Date.now();
  }
  if (shipping.pricing.mode === "passthrough" && result.shippingFallback) {
    shipping.pricing = { ...shipping.pricing, fallbackCost: result.shippingFallback };
  }

  const offered = new Set(
    enumerateVariants(product.variants).map((v) => costVariantKey(v)),
  );
  return normalizeProduct({
    ...product,
    cost: {
      ...product.cost,
      // The probe's currency IS the cost currency — anything else would make the
      // derived numbers mean something different from what they measure.
      currency: result.currency ?? product.cost.currency,
      table: result.table,
      variantPerPage: result.variantPerPage,
      measurement: {
        at: Date.now(),
        env: result.env as ProviderEnv,
        destination: `${REFERENCE_DESTINATION.country}/${REFERENCE_DESTINATION.postalCode}`,
        fitResidual: result.fitResidual,
        variantsMeasured: Object.keys(result.variantPerPage ?? {}).length,
        variantsOffered: offered.size,
      },
    },
    shipping,
  });
}

export interface CalibrationOutcome {
  result: CalibrationResult;
  /** The catalog after a successful calibration was persisted. */
  config: ProductsConfig;
  /**
   * This product's row for a catalog-wide report. Returned from the single
   * product endpoint because the admin measures the catalog by calling it in a
   * loop — the client would otherwise have to reconstruct the before/after
   * itself from state it may already have replaced.
   */
  run?: CatalogCalibrationRun;
}

/** Calibrate one product against `env` and persist the result when it succeeds. */
export async function calibrateAndSave(
  productId: string,
  env: FulfillmentEnv,
): Promise<CalibrationOutcome> {
  const config = await getProductsConfig();
  const product = config.products.find((p) => p.id === productId);
  if (!product) {
    return {
      result: { ok: false, env, samples: [], variants: [], message: "Product not found." },
      config,
    };
  }

  const result = await calibrateCost({ product, env });
  const run = summarizeRun(product, result);
  if (!result.ok) return { result, config, run };

  const products = config.products.map((p) => (p.id === productId ? withCalibration(p, result) : p));
  return { result, run, config: await saveProductsConfig({ version: 1, products }) };
}

export interface CatalogCalibrationRun {
  productId: string;
  name: string;
  sku: string;
  ok: boolean;
  message?: string;
  /** Shipping couldn't be measured even though the cost fit worked. */
  shippingMessage?: string;
  /**
   * The provider rate-limited part (or all) of this run.
   *
   * Reported per product AND counted across the catalog, because the fix
   * differs from every other failure here: nothing is misconfigured, and the
   * answer is to wait and re-run rather than to go and change something.
   */
  throttled?: boolean;
  currency?: string;
  /** The cost line before and after, so the admin can see what moved. */
  before: { basePerUnit: number; perPage: number };
  after?: { basePerUnit: number; perPage: number };
  /** How many cost-distinct variants were measured, of how many offered. */
  variants?: { measured: number; offered: number };
  /** Of the unmeasured variants, how many were throttled rather than refused. */
  variantsThrottled?: number;
}

/** One product's measurement, summarized for the catalog-wide report. */
export function summarizeRun(
  product: ProductDefinition,
  result: CalibrationResult,
): CatalogCalibrationRun {
  const offered = new Set(enumerateVariants(product.variants).map((v) => costVariantKey(v)));
  return {
    productId: product.id,
    name: product.presentation.name,
    sku: product.provider.sku,
    ok: result.ok,
    message: result.message,
    shippingMessage: result.shippingMessage,
    // A run that failed outright because we were throttled reports it too — the
    // outcome is the same as a bad SKU, but the remedy is the opposite.
    throttled: result.throttled || (!result.ok && /rate-limited/i.test(result.message ?? "")),
    currency: result.currency,
    before: { basePerUnit: product.cost.table.basePerUnit, perPage: product.cost.table.perPage },
    after: result.table
      ? { basePerUnit: result.table.basePerUnit, perPage: result.table.perPage }
      : undefined,
    variants: result.ok
      ? { measured: Object.keys(result.variantPerPage ?? {}).length, offered: offered.size }
      : undefined,
    variantsThrottled: result.variantsThrottled,
  };
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
 * Kept for scripted/one-off use. The admin UI drives the per-product endpoint
 * in a loop instead: a full catalog is now ~35 provider round trips per product,
 * which would not finish inside the function timeout, and per-product calls
 * persist as they go so a late failure doesn't discard earlier work.
 */
export async function calibrateCatalog(
  env: FulfillmentEnv,
  productId?: string,
): Promise<CatalogCalibrationSummary> {
  const config = await getProductsConfig();
  const targets = config.products.filter(
    (p) => p.provider.id === "lulu" && p.provider.sku.trim() && (!productId || p.id === productId),
  );

  const outcomes = await mapLimit(targets, 2, async (product) => ({
    product,
    result: await calibrateCost({ product, env }),
  }));

  const runs = outcomes.map(({ product, result }) => summarizeRun(product, result));
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
