/**
 * Server-side access to the admin-managed **product catalog**.
 *
 * Two documents:
 *   - PRIVATE `adminSettings/products` — the full {@link ProductsConfig} incl.
 *     cost / fee / margin internals. Backend-only (Firestore rules deny clients).
 *   - PUBLIC  `appConfig/products` — a derived {@link PublicProductsConfig}
 *     projection (resolved prices, no internals) the wizard + checkout read live.
 *
 * Every write validates with the shared Zod schema, persists the private doc, and
 * regenerates the public projection in lock-step. Reads use a short in-memory
 * cache like the rest of `appConfig`.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getPricingSettings } from "./appConfig";
import {
  createDefaultProductsConfig,
  normalizeProduct,
  normalizeProductsConfig,
  productSchema,
  productsConfigSchema,
  seedProductsFromCatalog,
  type PricingSettings,
  type ProductDefinition,
  type ProductsConfig,
  type ProviderEnv,
  type PublicProductsConfig,
} from "../../books-frontend/src/core/config/products";
import {
  toPublicProduct,
  type PrintDiscountPlan,
} from "../../books-frontend/src/core/config/productMath";
import { isOfferable } from "../../books-frontend/src/core/config/productValidation";
import type { MarketRegistry } from "../../books-frontend/src/core/config/markets";
import type { MarketCapability } from "../../books-frontend/src/core/config/marketCapability";
import { productCapabilityIndex } from "../../books-frontend/src/core/config/productCapability";
import type { ShippingSettings } from "../../books-frontend/src/core/config/shipping";
import { getPlansConfig } from "./plans";
import { getMarketCapability, getMarketRegistry } from "./markets";
import { getProductCapability } from "./productCapability";
import { getShippingSettings } from "./shipping";
import { serverConfig } from "./config";

const PRIVATE_DOC = "adminSettings/products";
const PUBLIC_DOC = "appConfig/products";

const CACHE_TTL_MS = 30_000;
let cache: { value: ProductsConfig; at: number } | null = null;

async function readConfig(): Promise<ProductsConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  ensureAdmin();
  let raw: unknown = undefined;
  try {
    const snap = await getFirestore().doc(PRIVATE_DOC).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    // fall back to defaults
  }
  const value = normalizeProductsConfig(raw);
  cache = { value, at: Date.now() };
  return value;
}

/** The provider environment currently being served (runtime override aware). */
function activeEnv(): ProviderEnv {
  return serverConfig().fulfillment.lulu.env;
}

/**
 * Build the public projection (resolved prices, internals stripped).
 *
 * Draft products are projected too — the storefront needs them to explain a
 * format it can't sell yet — but each carries an `offerable` verdict decided
 * here, against the environment we're actually serving. Only the storefront's
 * offerable filter decides what a customer can pick.
 *
 * `plans` feeds the per-plan print discount, which is clamped to break-even
 * during projection because the clamp needs the cost table and the storefront
 * must never see it (see `toPublicProduct`).
 */
function projectPublic(config: ProductsConfig, inputs: ProjectionInputs): PublicProductsConfig {
  const env = activeEnv();
  const { settings, plans, registry, shipping, capabilityFor } = inputs;
  return {
    version: 1,
    products: config.products
      .filter((p) => p.status !== "retired")
      .map((p) => {
        const capability = capabilityFor(p.provider.sku);
        return toPublicProduct(p, settings, {
          offerable: isOfferable(p, settings, { env, registry, shipping, capability }),
          plans,
          registry,
          shipping,
          capability,
        });
      })
      .sort((a, b) => a.sortOrder - b.sortOrder),
    projectedAt: Date.now(),
  };
}

/**
 * Everything the projection is derived from.
 *
 * Gathered in one place because the two callers used to fetch them separately
 * and had already drifted by one argument — a projection built by the save path
 * and one built by the reproject path could disagree about the same catalog,
 * which is the one thing a derived document must never do.
 */
interface ProjectionInputs {
  settings: PricingSettings;
  plans: readonly PrintDiscountPlan[];
  registry: MarketRegistry;
  shipping: ShippingSettings;
  /**
   * Coverage for one format, preferring what was measured for that format and
   * falling back to the country-level sweep.
   *
   * A function rather than a map because the answer is now per product: a
   * hardcover and a paperback reach the same country by different carriers, on
   * different service levels. See {@link coverageForSku}.
   */
  capabilityFor: (sku: string) => ReadonlyMap<string, MarketCapability>;
}

async function projectionInputs(): Promise<ProjectionInputs> {
  const [settings, plans, registry, shipping, capability, productCapability] = await Promise.all([
    getPricingSettings(),
    printDiscountPlans(),
    getMarketRegistry(),
    getShippingSettings(),
    getMarketCapability(),
    getProductCapability(),
  ]);
  const env = activeEnv();
  // Sandbox and live are different Lulu catalogs. Evidence collected in one
  // environment must never govern the other after a runtime switch.
  const countryLevel = new Map(
    (capability.probe.env === env ? capability.countries : []).map((c) => [c.country, c]),
  );
  const perFormat =
    productCapability.probe.env === env
      ? productCapabilityIndex(productCapability)
      : new Map<string, ReadonlyMap<string, MarketCapability>>();
  return {
    settings,
    plans,
    registry,
    shipping,
    // Falls back rather than failing closed: a format added between two sweeps
    // has no rows of its own, and treating that as "reaches nowhere" would
    // withdraw it from the storefront the moment an admin activated it.
    capabilityFor: (sku) => perFormat.get(sku.trim().toUpperCase()) ?? countryLevel,
  };
}

/**
 * The active plans' print discounts, for the projection's break-even clamp.
 *
 * Only ACTIVE plans: a retired or draft plan grants nobody anything, and letting
 * one publish a discount would advertise a perk that can't be bought. Failures
 * are swallowed to no discounts — the safe direction, since the storefront then
 * shows list prices rather than a discount checkout might not honour.
 */
async function printDiscountPlans(): Promise<PrintDiscountPlan[]> {
  try {
    const { plans } = await getPlansConfig();
    return plans
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p.id, printDiscountPct: p.entitlements.printDiscountPct }));
  } catch {
    return [];
  }
}

/** Deep-strip `undefined` values (Firestore rejects them) without touching arrays' shape. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeConfig(config: ProductsConfig): Promise<ProductsConfig> {
  ensureAdmin();
  const db = getFirestore();
  const inputs = await projectionInputs();
  await db.doc(PRIVATE_DOC).set(stripUndefined(config) as unknown as Record<string, unknown>, { merge: false });
  await db
    .doc(PUBLIC_DOC)
    .set(stripUndefined(projectPublic(config, inputs)) as unknown as Record<string, unknown>, {
      merge: false,
    });
  cache = { value: config, at: Date.now() };
  return config;
}

/**
 * Regenerate the public projection from the current catalog + settings.
 *
 * Must be called after ANY of the projection's inputs change, because the
 * storefront reads only the projection and will otherwise keep advertising the
 * previous answer indefinitely:
 *   - pricing settings (currencies, tax, fees resolve into prices),
 *   - a plan's print discount (published pre-clamped per plan),
 *   - the sandbox↔live toggle (SKU verification, and so offerability, is
 *     per-environment and the two catalogs don't agree),
 *   - markets opened or closed (which countries a product reaches),
 *   - the shipping policy (which speeds are sold, and at what markup),
 *   - a coverage sweep (which speeds the provider actually runs where).
 */
export async function reprojectPublicProducts(): Promise<void> {
  const [config, inputs] = await Promise.all([readConfig(), projectionInputs()]);
  const db = getFirestore();
  await db
    .doc(PUBLIC_DOC)
    .set(stripUndefined(projectPublic(config, inputs)) as unknown as Record<string, unknown>, {
      merge: false,
    });
}

export function getProductsConfig(): Promise<ProductsConfig> {
  return readConfig();
}

export function defaultProductsConfig(): ProductsConfig {
  return createDefaultProductsConfig();
}

/** Replace the entire catalog (validated). */
export async function saveProductsConfig(input: unknown): Promise<ProductsConfig> {
  const parsed = productsConfigSchema.parse(input);
  return writeConfig(normalizeProductsConfig(parsed));
}

/** Create or update a single product (validated), keyed by `id`. */
export async function upsertProduct(input: unknown, uid?: string): Promise<ProductDefinition> {
  const parsed = productSchema.parse(input);
  const product = normalizeProduct({ ...parsed, updatedAt: Date.now(), updatedBy: uid });
  const current = await readConfig();
  const idx = current.products.findIndex((p) => p.id === product.id);
  const products =
    idx === -1
      ? [...current.products, product]
      : current.products.map((p) => (p.id === product.id ? product : p));
  await writeConfig({ version: 1, products });
  return product;
}

export async function deleteProduct(id: string): Promise<ProductsConfig> {
  const current = await readConfig();
  const products = current.products.filter((p) => p.id !== id);
  return writeConfig({ version: 1, products });
}

/**
 * Seed the catalog from the curated provider catalog. Skips products whose SKU
 * already exists so it's safe to call more than once. Also backfills an empty
 * variant policy from the curated format when a product matches a seed SKU —
 * so re-seeding after the variants model landed opens the measured options on
 * formats that were already in the catalog.
 */
export async function seedProducts(): Promise<ProductsConfig> {
  const current = await readConfig();
  const seeds = seedProductsFromCatalog();
  const seedBySku = new Map(seeds.map((s) => [s.provider.sku, s]));
  const existingSkus = new Set(current.products.map((p) => p.provider.sku));

  let changed = false;
  const products = current.products.map((p) => {
    const seed = seedBySku.get(p.provider.sku);
    if (!seed) return p;
    const hasOptions = Object.values(p.variants.options).some((list) => list.length > 0);
    if (hasOptions) return p;
    changed = true;
    return { ...p, variants: seed.variants, updatedAt: Date.now() };
  });

  const newcomers = seeds.filter((p) => !existingSkus.has(p.provider.sku));
  if (!changed && newcomers.length === 0) return current;
  return writeConfig({ version: 1, products: [...products, ...newcomers] });
}
