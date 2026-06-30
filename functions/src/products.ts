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
  type PublicProductsConfig,
} from "../../books-frontend/src/core/config/products";
import { toPublicProduct } from "../../books-frontend/src/core/config/productMath";

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

/** Build the public projection (resolved prices, internals stripped). */
function projectPublic(config: ProductsConfig, settings: PricingSettings): PublicProductsConfig {
  return {
    version: 1,
    products: config.products
      .filter((p) => p.status !== "retired")
      .map((p) => toPublicProduct(p, settings))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/** Deep-strip `undefined` values (Firestore rejects them) without touching arrays' shape. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeConfig(config: ProductsConfig): Promise<ProductsConfig> {
  ensureAdmin();
  const db = getFirestore();
  const settings = await getPricingSettings();
  await db.doc(PRIVATE_DOC).set(stripUndefined(config) as unknown as Record<string, unknown>, { merge: false });
  await db
    .doc(PUBLIC_DOC)
    .set(stripUndefined(projectPublic(config, settings)) as unknown as Record<string, unknown>, { merge: false });
  cache = { value: config, at: Date.now() };
  return config;
}

/**
 * Regenerate the public projection from the current catalog + settings. Called
 * after pricing settings change (currencies/tax/fees affect resolved prices).
 */
export async function reprojectPublicProducts(): Promise<void> {
  const config = await readConfig();
  const settings = await getPricingSettings();
  const db = getFirestore();
  await db
    .doc(PUBLIC_DOC)
    .set(stripUndefined(projectPublic(config, settings)) as unknown as Record<string, unknown>, { merge: false });
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
 * already exists so it's safe to call more than once.
 */
export async function seedProducts(): Promise<ProductsConfig> {
  const current = await readConfig();
  const existingSkus = new Set(current.products.map((p) => p.provider.sku));
  const seeds = seedProductsFromCatalog().filter((p) => !existingSkus.has(p.provider.sku));
  if (seeds.length === 0) return current;
  return writeConfig({ version: 1, products: [...current.products, ...seeds] });
}
