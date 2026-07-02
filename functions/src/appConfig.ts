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
  ageWritingConfigSchema,
  createDefaultAgeWritingConfig,
  normalizeAgeWritingConfig,
  type AgeWritingConfig,
} from "../../books-frontend/src/core/config/ageWriting";
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
  type BrandAsset,
  type BrandAssetSlot,
  type BrandingConfig,
  type BrandingWatermark,
} from "../../books-frontend/src/core/config/branding";
import { z } from "zod";
import {
  createDefaultSeoConfig,
  normalizeSeoConfig,
  seoConfigSchema,
  type SeoConfig,
} from "../../books-frontend/src/core/config/seo";
import {
  createDefaultSiteImagesConfig,
  normalizeSiteImagesConfig,
  type SiteImageSlot,
  type SiteImagesConfig,
} from "../../books-frontend/src/core/config/siteImages";
import {
  createDefaultSiteContentConfig,
  isSiteTextSlot,
  normalizeSiteContentConfig,
  type SiteContentConfig,
  type SiteTextSlot,
} from "../../books-frontend/src/core/config/siteContent";
import type { PromptContext } from "../../books-frontend/src/core/prompts/context";

const MODELS_DOC = "appConfig/models";
const ART_STYLES_DOC = "appConfig/artStyles";
const AGE_WRITING_DOC = "appConfig/ageWriting";
const MODEL_COSTS_DOC = "appConfig/modelCosts";
const PRICING_SETTINGS_DOC = "appConfig/pricingSettings";
const SPARKS_DOC = "appConfig/sparks";
const BRANDING_DOC = "appConfig/branding";
const SEO_DOC = "appConfig/seo";
const SITE_IMAGES_DOC = "appConfig/siteImages";
const SITE_CONTENT_DOC = "appConfig/siteContent";

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
export function getAgeWritingConfig(): Promise<AgeWritingConfig> {
  return readDoc(AGE_WRITING_DOC, normalizeAgeWritingConfig);
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
export function getSeoConfig(): Promise<SeoConfig> {
  return readDoc(SEO_DOC, normalizeSeoConfig);
}
export function getSiteImagesConfig(): Promise<SiteImagesConfig> {
  return readDoc(SITE_IMAGES_DOC, normalizeSiteImagesConfig);
}
export function getSiteContentConfig(): Promise<SiteContentConfig> {
  return readDoc(SITE_CONTENT_DOC, normalizeSiteContentConfig);
}

/** Admin-managed prompt overlays used by text and image pipelines. */
export async function loadPromptContext(): Promise<PromptContext> {
  const [artStyles, ageWriting] = await Promise.all([
    getArtStylesConfig(),
    getAgeWritingConfig(),
  ]);
  return { artStyles, ageWriting };
}

export function defaultModelConfig(): ModelConfig {
  return createDefaultModelConfig();
}
export function defaultArtStylesConfig(): ArtStylesConfig {
  return createDefaultArtStylesConfig();
}
export function defaultAgeWritingConfig(): AgeWritingConfig {
  return createDefaultAgeWritingConfig();
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
export function defaultSeoConfig(): SeoConfig {
  return createDefaultSeoConfig();
}

/** Validate + persist the marketing SEO config (world-readable appConfig doc). */
export async function saveSeoConfig(input: unknown): Promise<SeoConfig> {
  const parsed = seoConfigSchema.parse(input);
  const normalized = normalizeSeoConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(SEO_DOC, normalized);
  return normalized;
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
  const normalized = normalizeArtStylesConfig(parsed);
  await writeDoc(ART_STYLES_DOC, normalized);
  return normalized;
}

export async function saveAgeWritingConfig(input: unknown): Promise<AgeWritingConfig> {
  const parsed = ageWritingConfigSchema.parse(input);
  const normalized = normalizeAgeWritingConfig(parsed);
  await writeDoc(AGE_WRITING_DOC, normalized);
  return normalized;
}

export async function saveModelCostTable(input: unknown): Promise<ModelCostTable> {
  const parsed = modelCostTableSchema.parse(input);
  await writeDoc(MODEL_COSTS_DOC, parsed);
  return parsed;
}

export function defaultBrandingConfig(): BrandingConfig {
  return createDefaultBrandingConfig();
}

const MAX_HISTORY = 20;

/**
 * Recompute a version history list when the current asset changes. The previous
 * asset is retained (never deleted from storage) so it can be restored; the
 * newly-current asset (e.g. on restore) is removed from the history. De-duped by
 * storagePath, newest first, capped.
 */
function computeHistory<T extends { storagePath?: string }>(
  prev: T | null,
  desired: T | null,
  history: T[],
): T[] {
  let next = history.slice();
  if (prev?.storagePath && (!desired || desired.storagePath !== prev.storagePath)) {
    next = [prev, ...next];
  }
  if (desired?.storagePath) next = next.filter((h) => h.storagePath !== desired.storagePath);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of next) {
    if (!h.storagePath || seen.has(h.storagePath)) continue;
    seen.add(h.storagePath);
    out.push(h);
    if (out.length >= MAX_HISTORY) break;
  }
  return out;
}

/** Set (or clear, with null) the branding watermark, preserving all other
 *  brand fields and retaining the previous version in history. */
export async function setBrandingWatermark(
  watermark: BrandingWatermark | null,
): Promise<BrandingConfig> {
  const current = await getBrandingConfig();
  const watermarkHistory = computeHistory(current.watermark, watermark, current.watermarkHistory);
  const next = normalizeBrandingConfig({ ...current, watermark, watermarkHistory });
  await writeDoc(BRANDING_DOC, next);
  return next;
}

/** Restore a previous watermark version by its storage path. */
export async function restoreWatermark(storagePath: string): Promise<BrandingConfig> {
  const current = await getBrandingConfig();
  const target = current.watermarkHistory.find((h) => h.storagePath === storagePath);
  if (!target) throw new Error("Watermark version not found.");
  return setBrandingWatermark({ ...target, updatedAt: Date.now() });
}

/** Remove a watermark version from history (storage object deleted by the route). */
export async function deleteWatermarkVersion(storagePath: string): Promise<BrandingConfig> {
  const current = await getBrandingConfig();
  const watermarkHistory = current.watermarkHistory.filter((h) => h.storagePath !== storagePath);
  const next = normalizeBrandingConfig({ ...current, watermarkHistory });
  await writeDoc(BRANDING_DOC, next);
  return next;
}

/** Savable brand identity fields (name, tagline, colors) — assets have their
 *  own upload/remove routes and are preserved by this save. */
export const brandingInfoSchema = z.object({
  brandName: z.string().max(200).optional(),
  tagline: z.string().max(200).optional(),
  colors: z
    .object({ primary: z.string().max(30), accent: z.string().max(30) })
    .partial()
    .optional(),
});

/** Merge-save the brand identity (name/tagline/colors), preserving all assets. */
export async function saveBrandingInfo(input: unknown): Promise<BrandingConfig> {
  const parsed = brandingInfoSchema.parse(input);
  const current = await getBrandingConfig();
  const next = normalizeBrandingConfig({
    ...current,
    ...(parsed.brandName !== undefined ? { brandName: parsed.brandName } : {}),
    ...(parsed.tagline !== undefined ? { tagline: parsed.tagline } : {}),
    colors: { ...current.colors, ...(parsed.colors ?? {}) },
  });
  await writeDoc(BRANDING_DOC, next);
  return next;
}

/** Set (or clear, with null) a single brand image asset, preserving the rest
 *  and retaining the previous version in that slot's history. */
export async function setBrandingAsset(
  slot: BrandAssetSlot,
  asset: BrandAsset | null,
): Promise<BrandingConfig> {
  const current = await getBrandingConfig();
  const history = computeHistory(current[slot], asset, current.assetHistory[slot] ?? []);
  const next = normalizeBrandingConfig({
    ...current,
    [slot]: asset,
    assetHistory: { ...current.assetHistory, [slot]: history },
  });
  await writeDoc(BRANDING_DOC, next);
  return next;
}

/** Restore a previous version of a slot by its storage path (makes it current). */
export async function restoreBrandingAsset(
  slot: BrandAssetSlot,
  storagePath: string,
): Promise<BrandingConfig> {
  const current = await getBrandingConfig();
  const target = (current.assetHistory[slot] ?? []).find((h) => h.storagePath === storagePath);
  if (!target) throw new Error("Asset version not found.");
  return setBrandingAsset(slot, { ...target, updatedAt: Date.now() });
}

/** Remove a version from a slot's history (storage object deleted by the route). */
export async function deleteBrandingAssetVersion(
  slot: BrandAssetSlot,
  storagePath: string,
): Promise<BrandingConfig> {
  const current = await getBrandingConfig();
  const list = (current.assetHistory[slot] ?? []).filter((h) => h.storagePath !== storagePath);
  const next = normalizeBrandingConfig({
    ...current,
    assetHistory: { ...current.assetHistory, [slot]: list },
  });
  await writeDoc(BRANDING_DOC, next);
  return next;
}

export function defaultSiteImagesConfig(): SiteImagesConfig {
  return createDefaultSiteImagesConfig();
}
export function defaultSiteContentConfig(): SiteContentConfig {
  return createDefaultSiteContentConfig();
}

/** Set (or clear, with null) a single landing-page illustration, preserving the
 *  rest and retaining the previous version in that slot's history. */
export async function setSiteImage(
  slot: SiteImageSlot,
  asset: BrandAsset | null,
): Promise<SiteImagesConfig> {
  const current = await getSiteImagesConfig();
  const history = computeHistory(current.images[slot] ?? null, asset, current.history[slot] ?? []);
  const images = { ...current.images };
  if (asset) images[slot] = asset;
  else delete images[slot];
  const next = normalizeSiteImagesConfig({
    ...current,
    images,
    history: { ...current.history, [slot]: history },
  });
  await writeDoc(SITE_IMAGES_DOC, next);
  return next;
}

/** Restore a previous version of a slot by its storage path (makes it current). */
export async function restoreSiteImage(
  slot: SiteImageSlot,
  storagePath: string,
): Promise<SiteImagesConfig> {
  const current = await getSiteImagesConfig();
  const target = (current.history[slot] ?? []).find((h) => h.storagePath === storagePath);
  if (!target) throw new Error("Image version not found.");
  return setSiteImage(slot, { ...target, updatedAt: Date.now() });
}

/** Remove a version from a slot's history (storage object deleted by the route). */
export async function deleteSiteImageVersion(
  slot: SiteImageSlot,
  storagePath: string,
): Promise<SiteImagesConfig> {
  const current = await getSiteImagesConfig();
  const list = (current.history[slot] ?? []).filter((h) => h.storagePath !== storagePath);
  const next = normalizeSiteImagesConfig({
    ...current,
    history: { ...current.history, [slot]: list },
  });
  await writeDoc(SITE_IMAGES_DOC, next);
  return next;
}

/** Set (or clear, with empty/undefined) a single landing-copy override. */
export async function setSiteText(slot: SiteTextSlot, value: string | null): Promise<SiteContentConfig> {
  const current = await getSiteContentConfig();
  const text = { ...current.text };
  if (typeof value === "string" && value.length > 0) text[slot] = value;
  else delete text[slot];
  const next = normalizeSiteContentConfig({ ...current, text });
  await writeDoc(SITE_CONTENT_DOC, next);
  return next;
}

/** Guard: is this a known editable text slot? (re-exported for the route). */
export function isKnownTextSlot(slot: unknown): slot is SiteTextSlot {
  return isSiteTextSlot(slot);
}

/** Patch a single art-style example (used by the image-upload route). */
export async function setArtStyleExample(
  styleId: string,
  example: ArtStylesConfig["examples"][string],
): Promise<ArtStylesConfig> {
  const current = await getArtStylesConfig();
  const next = normalizeArtStylesConfig({
    ...current,
    examples: { ...current.examples, [styleId]: example },
  });
  await writeDoc(ART_STYLES_DOC, next);
  return next;
}
