/**
 * Server-side access to the global, admin-managed configuration documents
 * (`appConfig/models`, `appConfig/artStyles`, `appConfig/modelCosts`).
 *
 * Reads go through the Admin SDK with a short in-memory cache (the docs are tiny
 * and change rarely). Writes are validated and performed here, used only by the
 * admin routes (which are already gated by `requireAdmin`).
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import {
  createDefaultModelConfig,
  modelConfigSchema,
  normalizeModelConfig,
  type ModelConfig,
} from "../../books-frontend/src/core/config/modelConfig";
import {
  artStylesConfigSchema,
  createDefaultArtStylesConfig,
  normalizeArtStylesConfig,
  type ArtStylesConfig,
} from "../../books-frontend/src/core/config/artStyles";
import {
  createDefaultModelCostTable,
  modelCostTableSchema,
  normalizeModelCostTable,
  type ModelCostTable,
} from "../../books-frontend/src/core/config/modelCosts";
import {
  createDefaultPricingSettings,
  normalizePricingSettings,
  pricingSettingsSchema,
  type PricingSettings,
} from "../../books-frontend/src/core/config/products";
import {
  createDefaultSparksConfig,
  normalizeSparksConfig,
  sparksConfigSchema,
  type SparksConfig,
} from "../../books-frontend/src/core/config/sparks";
import {
  createDefaultBrandingConfig,
  normalizeBrandingConfig,
  type BrandingConfig,
  type BrandingWatermark,
} from "../../books-frontend/src/core/config/branding";

const MODELS_DOC = "appConfig/models";
const ART_STYLES_DOC = "appConfig/artStyles";
const MODEL_COSTS_DOC = "appConfig/modelCosts";
const PRICING_SETTINGS_DOC = "appConfig/pricingSettings";
const SPARKS_DOC = "appConfig/sparks";
const BRANDING_DOC = "appConfig/branding";

const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  at: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function readDoc<T>(path: string, normalize: (raw: unknown) => T): Promise<T> {
  const hit = cache.get(path) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  ensureAdmin();
  let raw: unknown = undefined;
  try {
    const snap = await getFirestore().doc(path).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    // Fall back to defaults when the doc can't be read.
  }
  const value = normalize(raw);
  cache.set(path, { value, at: Date.now() });
  return value;
}

async function writeDoc(path: string, value: unknown): Promise<void> {
  ensureAdmin();
  await getFirestore().doc(path).set(value as Record<string, unknown>, { merge: false });
  cache.delete(path);
}

export function getModelConfig(): Promise<ModelConfig> {
  return readDoc(MODELS_DOC, normalizeModelConfig);
}
export function getArtStylesConfig(): Promise<ArtStylesConfig> {
  return readDoc(ART_STYLES_DOC, normalizeArtStylesConfig);
}
export function getModelCostTable(): Promise<ModelCostTable> {
  return readDoc(MODEL_COSTS_DOC, normalizeModelCostTable);
}
export function getPricingSettings(): Promise<PricingSettings> {
  return readDoc(PRICING_SETTINGS_DOC, normalizePricingSettings);
}
export function getSparksConfig(): Promise<SparksConfig> {
  return readDoc(SPARKS_DOC, normalizeSparksConfig);
}
export function getBrandingConfig(): Promise<BrandingConfig> {
  return readDoc(BRANDING_DOC, normalizeBrandingConfig);
}

export function defaultModelConfig(): ModelConfig {
  return createDefaultModelConfig();
}
export function defaultArtStylesConfig(): ArtStylesConfig {
  return createDefaultArtStylesConfig();
}
export function defaultModelCostTable(): ModelCostTable {
  return createDefaultModelCostTable();
}
export function defaultPricingSettings(): PricingSettings {
  return createDefaultPricingSettings();
}
export function defaultSparksConfig(): SparksConfig {
  return createDefaultSparksConfig();
}

/** Validate + persist the Sparks economy config (world-readable appConfig doc). */
export async function saveSparksConfig(input: unknown): Promise<SparksConfig> {
  const parsed = sparksConfigSchema.parse(input);
  const normalized = normalizeSparksConfig(parsed);
  await writeDoc(SPARKS_DOC, normalized);
  return normalized;
}

/** Validate + persist the catalog-wide pricing settings. */
export async function savePricingSettings(input: unknown): Promise<PricingSettings> {
  const parsed = pricingSettingsSchema.parse(input);
  const normalized = normalizePricingSettings(parsed);
  await writeDoc(PRICING_SETTINGS_DOC, normalized);
  return normalized;
}

/** Validate + persist the model config. Throws a ZodError on invalid input. */
export async function saveModelConfig(input: unknown): Promise<ModelConfig> {
  const parsed = modelConfigSchema.parse(input);
  const normalized = normalizeModelConfig(parsed);
  await writeDoc(MODELS_DOC, normalized);
  return normalized;
}

export async function saveArtStylesConfig(input: unknown): Promise<ArtStylesConfig> {
  const parsed = artStylesConfigSchema.parse(input);
  await writeDoc(ART_STYLES_DOC, parsed);
  return parsed;
}

export async function saveModelCostTable(input: unknown): Promise<ModelCostTable> {
  const parsed = modelCostTableSchema.parse(input);
  await writeDoc(MODEL_COSTS_DOC, parsed);
  return parsed;
}

export function defaultBrandingConfig(): BrandingConfig {
  return createDefaultBrandingConfig();
}

/** Set (or clear, with null) the branding watermark. Used by the upload route. */
export async function setBrandingWatermark(
  watermark: BrandingWatermark | null,
): Promise<BrandingConfig> {
  const next = normalizeBrandingConfig({ version: 1, watermark });
  await writeDoc(BRANDING_DOC, next);
  return next;
}

/** Patch a single art-style example (used by the image-upload route). */
export async function setArtStyleExample(
  styleId: string,
  example: ArtStylesConfig["examples"][string],
): Promise<ArtStylesConfig> {
  const current = await getArtStylesConfig();
  const next: ArtStylesConfig = {
    version: 1,
    examples: { ...current.examples, [styleId]: example },
  };
  await writeDoc(ART_STYLES_DOC, next);
  return next;
}
