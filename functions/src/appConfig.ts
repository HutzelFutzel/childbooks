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
  normalizeTypographyConfig,
  typographyConfigSchema,
  type TypographyConfig,
} from "../../books-frontend/src/core/config/typography";
import {
  createDefaultModelCostTable,
  modelCostTableSchema,
  normalizeModelCostTable,
  publicModelCostProjection,
  type ModelCostTable,
} from "../../books-frontend/src/core/config/modelCosts";
import {
  appendCostSample,
  normalizeImageCostStats,
  type ImageCostStats,
} from "../../books-frontend/src/core/config/imageCostStats";
import {
  appendLatencySample,
  normalizeLatencyStats,
  type LatencyStats,
} from "../../books-frontend/src/core/config/latencyStats";
import type { ImageActionId } from "../../books-frontend/src/core/ai/actions";
import type { ImageTier } from "../../books-frontend/src/core/config/modelConfig";
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
import {
  createDefaultPromptsConfig,
  lintPromptsConfig,
  normalizePromptsConfig,
  promptsConfigSchema,
  type PromptsConfig,
} from "../../books-frontend/src/core/config/prompts";
import {
  createDefaultEmailConfig,
  emailConfigSchema,
  normalizeEmailConfig,
  type EmailConfig,
} from "../../books-frontend/src/core/config/emailConfig";
import {
  appendEmailEvent,
  normalizeEmailStats,
  type EmailEventInput,
  type EmailStats,
} from "../../books-frontend/src/core/config/emailStats";
import {
  createDefaultSlackConfig,
  normalizeSlackConfig,
  slackConfigSchema,
  type SlackConfig,
} from "../../books-frontend/src/core/config/slackConfig";
import {
  createDefaultLegalConfig,
  legalConfigSchema,
  normalizeLegalConfig,
  type LegalConfig,
} from "../../books-frontend/src/core/config/legal";
import {
  cookieConfigSchema,
  createDefaultCookieConfig,
  normalizeCookieConfig,
  type CookieConfig,
} from "../../books-frontend/src/core/config/cookieConfig";

const MODELS_DOC = "appConfig/models";
const ART_STYLES_DOC = "appConfig/artStyles";
const AGE_WRITING_DOC = "appConfig/ageWriting";
const TYPOGRAPHY_DOC = "appConfig/typography";
const MODEL_COSTS_DOC = "appConfig/modelCosts";
const MODEL_COSTS_PUBLIC_DOC = "appConfig/modelCostsPublic";
const PRICING_SETTINGS_DOC = "appConfig/pricingSettings";
const SPARKS_DOC = "appConfig/sparks";
const BRANDING_DOC = "appConfig/branding";
const SEO_DOC = "appConfig/seo";
const SITE_IMAGES_DOC = "appConfig/siteImages";
const SITE_CONTENT_DOC = "appConfig/siteContent";
const PROMPTS_DOC = "appConfig/prompts";
const IMAGE_COST_STATS_DOC = "appConfig/imageCostStats";
const LATENCY_STATS_DOC = "appConfig/latencyStats";
const EMAIL_CONFIG_DOC = "appConfig/emailConfig";
const EMAIL_STATS_DOC = "appConfig/emailStats";
const SLACK_CONFIG_DOC = "appConfig/slackConfig";
const LEGAL_DOC = "appConfig/legal";
const COOKIE_CONFIG_DOC = "appConfig/cookieConfig";

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
/** Once-per-instance guard for the projection backfill below. */
let modelCostsProjectionEnsured = false;

export async function getModelCostTable(): Promise<ModelCostTable> {
  const table = await readDoc(MODEL_COSTS_DOC, normalizeModelCostTable);
  // Backfill the world-readable projection for deployments that populated the
  // cost table before the projection existed (it's normally written on every
  // admin save). Once per instance, best-effort.
  if (!modelCostsProjectionEnsured) {
    modelCostsProjectionEnsured = true;
    try {
      const snap = await getFirestore().doc(MODEL_COSTS_PUBLIC_DOC).get();
      if (!snap.exists) await writeDoc(MODEL_COSTS_PUBLIC_DOC, publicModelCostProjection(table));
    } catch {
      // Non-fatal — the next admin save writes it.
    }
  }
  return table;
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
export function getPromptsConfig(): Promise<PromptsConfig> {
  return readDoc(PROMPTS_DOC, normalizePromptsConfig);
}
export function getImageCostStats(): Promise<ImageCostStats> {
  return readDoc(IMAGE_COST_STATS_DOC, normalizeImageCostStats);
}

export function getLatencyStats(): Promise<LatencyStats> {
  return readDoc(LATENCY_STATS_DOC, normalizeLatencyStats);
}

/**
 * Append measured durations to the world-readable rolling window that powers
 * client time estimates. One transaction for the whole batch (a task usually
 * records its fine bucket + the coarse fallback bucket together). Best-effort
 * at the call site — telemetry must never break or slow generation.
 */
export async function recordLatencySamples(
  entries: { key: string; ms: number }[],
): Promise<void> {
  const valid = entries.filter((e) => Number.isFinite(e.ms) && e.ms >= 0);
  if (valid.length === 0) return;
  ensureAdmin();
  const db = getFirestore();
  const ref = db.doc(LATENCY_STATS_DOC);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let current = normalizeLatencyStats(snap.exists ? snap.data() : undefined);
    for (const { key, ms } of valid) current = appendLatencySample(current, key, ms);
    tx.set(ref, current, { merge: false });
  });
  cache.delete(LATENCY_STATS_DOC);
}

/**
 * Append one measured call cost to the world-readable rolling window used for
 * Spark estimate ranges. Transactional so concurrent renders can't clobber the
 * window; best-effort at the call site (never blocks generation).
 */
export async function recordImageCostSample(
  action: ImageActionId,
  tier: ImageTier,
  costUsd: number,
  modelKey?: string,
): Promise<void> {
  ensureAdmin();
  const db = getFirestore();
  const ref = db.doc(IMAGE_COST_STATS_DOC);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeImageCostStats(snap.exists ? snap.data() : undefined);
    tx.set(ref, appendCostSample(current, action, tier, costUsd, modelKey), { merge: false });
  });
  cache.delete(IMAGE_COST_STATS_DOC);
}

// ---- Email (system + marketing) --------------------------------------------

export function getEmailConfig(): Promise<EmailConfig> {
  return readDoc(EMAIL_CONFIG_DOC, normalizeEmailConfig);
}

export function getEmailStats(): Promise<EmailStats> {
  return readDoc(EMAIL_STATS_DOC, normalizeEmailStats);
}

export function defaultEmailConfig(): EmailConfig {
  return createDefaultEmailConfig();
}

/** Validate + persist the email config (world-readable appConfig doc). */
export async function saveEmailConfig(input: unknown): Promise<EmailConfig> {
  const parsed = emailConfigSchema.parse(input);
  const normalized = normalizeEmailConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(EMAIL_CONFIG_DOC, normalized);
  return normalized;
}

/**
 * Append one or more delivery events to the world-readable email stats window.
 * One transaction for the whole batch. Best-effort at the call site — email
 * telemetry must never break a send or a webhook ack.
 */
export async function recordEmailEvents(entries: EmailEventInput[]): Promise<void> {
  if (entries.length === 0) return;
  ensureAdmin();
  const db = getFirestore();
  const ref = db.doc(EMAIL_STATS_DOC);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let current = normalizeEmailStats(snap.exists ? snap.data() : undefined);
    for (const e of entries) current = appendEmailEvent(current, e);
    tx.set(ref, current, { merge: false });
  });
  cache.delete(EMAIL_STATS_DOC);
}

// ---- Slack notifications ---------------------------------------------------

export function getSlackConfig(): Promise<SlackConfig> {
  return readDoc(SLACK_CONFIG_DOC, normalizeSlackConfig);
}

export function defaultSlackConfig(): SlackConfig {
  return createDefaultSlackConfig();
}

/** Validate + persist the Slack config (world-readable appConfig doc). */
export async function saveSlackConfig(input: unknown): Promise<SlackConfig> {
  const parsed = slackConfigSchema.parse(input);
  const normalized = normalizeSlackConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(SLACK_CONFIG_DOC, normalized);
  return normalized;
}

// ---- Legal documents -------------------------------------------------------

export function getLegalConfig(): Promise<LegalConfig> {
  return readDoc(LEGAL_DOC, normalizeLegalConfig);
}

export function defaultLegalConfig(): LegalConfig {
  return createDefaultLegalConfig();
}

/** Validate + persist the legal documents config (world-readable appConfig doc). */
export async function saveLegalConfig(input: unknown): Promise<LegalConfig> {
  const parsed = legalConfigSchema.parse(input);
  const normalized = normalizeLegalConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(LEGAL_DOC, normalized);
  return normalized;
}

// ---- Cookie consent --------------------------------------------------------

export function getCookieConfig(): Promise<CookieConfig> {
  return readDoc(COOKIE_CONFIG_DOC, normalizeCookieConfig);
}

export function defaultCookieConfig(): CookieConfig {
  return createDefaultCookieConfig();
}

/** Validate + persist the cookie consent config (world-readable appConfig doc). */
export async function saveCookieConfig(input: unknown): Promise<CookieConfig> {
  const parsed = cookieConfigSchema.parse(input);
  const normalized = normalizeCookieConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(COOKIE_CONFIG_DOC, normalized);
  return normalized;
}

/** Admin-managed prompt overlays used by text and image pipelines. */
export async function loadPromptContext(): Promise<PromptContext> {
  const [artStyles, ageWriting, templates] = await Promise.all([
    getArtStylesConfig(),
    getAgeWritingConfig(),
    getPromptsConfig(),
  ]);
  return { artStyles, ageWriting, templates };
}

/** Validate + persist the prompt templates (world-readable appConfig doc). */
export async function savePromptsConfig(input: unknown): Promise<PromptsConfig> {
  const parsed = promptsConfigSchema.parse(input);
  const normalized = normalizePromptsConfig(parsed);
  lintPromptsConfig(normalized);
  await writeDoc(PROMPTS_DOC, normalized);
  return normalized;
}

export function defaultPromptsConfig(): PromptsConfig {
  return createDefaultPromptsConfig();
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

export async function saveTypographyConfig(input: unknown): Promise<TypographyConfig> {
  const parsed = typographyConfigSchema.parse(input);
  const normalized = normalizeTypographyConfig(parsed);
  await writeDoc(TYPOGRAPHY_DOC, normalized);
  return normalized;
}

export async function saveModelCostTable(input: unknown): Promise<ModelCostTable> {
  const parsed = modelCostTableSchema.parse(input);
  await writeDoc(MODEL_COSTS_DOC, parsed);
  // The full rate table is admin-only (Firestore rules). Storefront Spark
  // estimates read this derived, world-readable projection instead — one flat
  // per-image rate per image model, nothing else.
  await writeDoc(MODEL_COSTS_PUBLIC_DOC, publicModelCostProjection(parsed));
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
