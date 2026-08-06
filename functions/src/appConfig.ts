/**
 * Server-side access to the global, admin-managed configuration documents
 * (`appConfig/models`, `appConfig/artStyles`, `appConfig/modelCosts`).
 *
 * Reads go through the Admin SDK with a short in-memory cache (the docs are tiny
 * and change rarely). Writes are validated and performed here, used only by the
 * admin routes (which are already gated by `requireAdmin`).
 */
import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import {
  ensureAdmin,
  deletePublicObject,
  downloadPublicBase64,
  fetchPublicBytes,
  uploadQrCode,
  uploadQrLogo,
} from "./storage";
import { renderQrCode } from "./qrcode";
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
  createDefaultStoryCraftConfig,
  normalizeStoryCraftConfig,
  storyCraftConfigSchema,
  type StoryCraftConfig,
} from "../../books-frontend/src/core/config/storyCraft";
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
  BRAND_ASSET_SLOTS,
  createDefaultBrandingConfig,
  normalizeBrandingConfig,
  type BrandAsset,
  type BrandAssetSlot,
  type BrandingConfig,
  type BrandingWatermark,
} from "../../books-frontend/src/core/config/branding";
import {
  findQrCode,
  normalizeQrCodesConfig,
  QR_LOGO_QUIET_COLOR_DEFAULT,
  QR_LOGO_QUIET_DEFAULT,
  QR_LOGO_QUIET_MAX,
  QR_LOGO_QUIET_MIN,
  type QrCode,
  type QrCodesConfig,
  type QrCornerStyle,
  type QrDotStyle,
  type QrErrorCorrectionLevel,
  type QrFormat,
  type QrLogo,
  type QrRender,
} from "../../books-frontend/src/core/config/qrCodes";
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
import {
  normalizeCatalogMediaConfig,
  photosFor,
  type CatalogMediaConfig,
  type CatalogPhoto,
} from "../../books-frontend/src/core/config/catalogMedia";
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
import {
  announcementsConfigSchema,
  createDefaultAnnouncementsConfig,
  normalizeAnnouncementsConfig,
  type AnnouncementsConfig,
} from "../../books-frontend/src/core/config/announcements";
import {
  normalizeReferralConfig,
  referralConfigFromLegacy,
  referralConfigSchema,
  type ReferralConfig,
} from "../../books-frontend/src/core/config/referral";
import {
  affiliateConfigSchema,
  createDefaultAffiliateConfig,
  normalizeAffiliateConfig,
  type AffiliateConfig,
} from "../../books-frontend/src/core/config/affiliates";
import {
  layoutsConfigSchema,
  normalizeLayoutsConfig,
  type LayoutExample,
  type LayoutsConfig,
} from "../../books-frontend/src/core/config/layouts";
import type { CapabilityOverrides } from "../../books-frontend/src/core/config/modelCapabilities";

const MODELS_DOC = "appConfig/models";
const ART_STYLES_DOC = "appConfig/artStyles";
const LAYOUTS_DOC = "appConfig/layouts";
const AGE_WRITING_DOC = "appConfig/ageWriting";
const STORY_CRAFT_DOC = "appConfig/storyCraft";
const TYPOGRAPHY_DOC = "appConfig/typography";
const MODEL_COSTS_DOC = "appConfig/modelCosts";
const MODEL_COSTS_PUBLIC_DOC = "appConfig/modelCostsPublic";
const PRICING_SETTINGS_DOC = "appConfig/pricingSettings";
const SPARKS_DOC = "appConfig/sparks";
const REFERRAL_DOC = "appConfig/referral";
const BRANDING_DOC = "appConfig/branding";
const QR_CODES_DOC = "appConfig/qrCodes";
const SEO_DOC = "appConfig/seo";
const SITE_IMAGES_DOC = "appConfig/siteImages";
const CATALOG_MEDIA_DOC = "appConfig/catalogMedia";
const SITE_CONTENT_DOC = "appConfig/siteContent";
const PROMPTS_DOC = "appConfig/prompts";
const IMAGE_COST_STATS_DOC = "appConfig/imageCostStats";
const LATENCY_STATS_DOC = "appConfig/latencyStats";
// NOT under `appConfig/*`: that namespace is world-readable, and this doc holds
// the support inbox, the contact recipient and every sender identity. See
// `getEmailConfig` for the one-time migration off the old public path.
const EMAIL_CONFIG_DOC = "adminSettings/emailConfig";
const LEGACY_EMAIL_CONFIG_DOC = "appConfig/emailConfig";
const EMAIL_STATS_DOC = "appConfig/emailStats";
// Also NOT under `appConfig/*`: the affiliate scope map names our Rewardful
// campaigns and singles out individual affiliates by id. None of it is a secret,
// but the client has no use for it either, and a world-readable copy would
// publish the commercial shape of the partner program to anyone who asks.
const AFFILIATE_CONFIG_DOC = "adminSettings/affiliates";
const SLACK_CONFIG_DOC = "appConfig/slackConfig";
const LEGAL_DOC = "appConfig/legal";
const COOKIE_CONFIG_DOC = "appConfig/cookieConfig";
const ANNOUNCEMENTS_DOC = "appConfig/announcements";

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
export function getLayoutsConfig(): Promise<LayoutsConfig> {
  return readDoc(LAYOUTS_DOC, normalizeLayoutsConfig);
}
export function getAgeWritingConfig(): Promise<AgeWritingConfig> {
  return readDoc(AGE_WRITING_DOC, normalizeAgeWritingConfig);
}
export function getStoryCraftConfig(): Promise<StoryCraftConfig> {
  return readDoc(STORY_CRAFT_DOC, normalizeStoryCraftConfig);
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

/**
 * The referral program config. Deployments that configured the OLD payment-gated
 * referral (`sparks.referral`) before the rules engine existed have no
 * `appConfig/referral` doc yet — those keep paying exactly the rewards they were
 * configured for, projected onto an equivalent single-rule program, until an
 * admin saves the new one.
 */
export async function getReferralConfig(): Promise<ReferralConfig> {
  const stored = await readDoc(REFERRAL_DOC, (raw) => (raw === undefined ? null : normalizeReferralConfig(raw)));
  if (stored) return stored;
  const sparks = await getSparksConfig();
  return referralConfigFromLegacy(sparks.referral);
}
export function getBrandingConfig(): Promise<BrandingConfig> {
  return readDoc(BRANDING_DOC, normalizeBrandingConfig);
}
export function getQrCodesConfig(): Promise<QrCodesConfig> {
  return readDoc(QR_CODES_DOC, normalizeQrCodesConfig);
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
export function getCatalogMediaConfig(): Promise<CatalogMediaConfig> {
  return readDoc(CATALOG_MEDIA_DOC, normalizeCatalogMediaConfig);
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

/** Once-per-instance guard for the legacy-path migration below. */
let emailConfigMigrated = false;

/**
 * Move the email config off the world-readable `appConfig/emailConfig` path.
 *
 * Any deployment configured before the move still has its real addresses in the
 * public doc, so copy them across (only if the private doc doesn't exist yet —
 * a later admin save must win) and delete the public copy. Best-effort and once
 * per instance: a failure here leaves the old doc in place, and the next cold
 * start retries.
 */
async function migrateEmailConfigOffPublicPath(): Promise<void> {
  ensureAdmin();
  const db = getFirestore();
  const legacy = await db.doc(LEGACY_EMAIL_CONFIG_DOC).get();
  if (!legacy.exists) return;
  const current = await db.doc(EMAIL_CONFIG_DOC).get();
  if (!current.exists) {
    await writeDoc(EMAIL_CONFIG_DOC, normalizeEmailConfig(legacy.data()));
  }
  await db.doc(LEGACY_EMAIL_CONFIG_DOC).delete();
}

export async function getEmailConfig(): Promise<EmailConfig> {
  if (!emailConfigMigrated) {
    emailConfigMigrated = true;
    await migrateEmailConfigOffPublicPath().catch(() => {
      emailConfigMigrated = false; // retry on the next call
    });
  }
  return readDoc(EMAIL_CONFIG_DOC, normalizeEmailConfig);
}

export function getEmailStats(): Promise<EmailStats> {
  return readDoc(EMAIL_STATS_DOC, normalizeEmailStats);
}

export function defaultEmailConfig(): EmailConfig {
  return createDefaultEmailConfig();
}

/** Validate + persist the email config (admin-only doc; never client-readable). */
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

// ---- Marketing announcements ------------------------------------------------

export function getAnnouncementsConfig(): Promise<AnnouncementsConfig> {
  return readDoc(ANNOUNCEMENTS_DOC, normalizeAnnouncementsConfig);
}

export function defaultAnnouncementsConfig(): AnnouncementsConfig {
  return createDefaultAnnouncementsConfig();
}

/** Validate + persist the announcement banners (world-readable appConfig doc). */
export async function saveAnnouncementsConfig(input: unknown): Promise<AnnouncementsConfig> {
  const parsed = announcementsConfigSchema.parse(input);
  const normalized = normalizeAnnouncementsConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(ANNOUNCEMENTS_DOC, normalized);
  return normalized;
}

// ---- Affiliate program -----------------------------------------------------

export function getAffiliateConfig(): Promise<AffiliateConfig> {
  return readDoc(AFFILIATE_CONFIG_DOC, normalizeAffiliateConfig);
}

export function defaultAffiliateConfig(): AffiliateConfig {
  return createDefaultAffiliateConfig();
}

/** Validate + persist the affiliate scope map (admin-only doc). */
export async function saveAffiliateConfig(input: unknown): Promise<AffiliateConfig> {
  const parsed = affiliateConfigSchema.parse(input);
  const normalized = normalizeAffiliateConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(AFFILIATE_CONFIG_DOC, normalized);
  return normalized;
}

/**
 * Admin corrections to the shipped image-model capability table. Lives on the
 * layouts doc because that's where the model-behaviour knowledge is curated.
 */
export async function loadModelCapabilities(): Promise<CapabilityOverrides> {
  return (await getLayoutsConfig()).capabilities ?? {};
}

/** Admin-managed prompt overlays used by text and image pipelines. */
export async function loadPromptContext(): Promise<PromptContext> {
  const [artStyles, ageWriting, storyCraft, templates] = await Promise.all([
    getArtStylesConfig(),
    getAgeWritingConfig(),
    getStoryCraftConfig(),
    getPromptsConfig(),
  ]);
  return { artStyles, ageWriting, storyCraft, templates };
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

/** Validate + persist the referral program (world-readable appConfig doc). */
export async function saveReferralConfig(input: unknown): Promise<ReferralConfig> {
  const parsed = referralConfigSchema.parse(input);
  const normalized = normalizeReferralConfig(parsed);
  await writeDoc(REFERRAL_DOC, normalized);
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

export async function saveLayoutsConfig(input: unknown): Promise<LayoutsConfig> {
  const parsed = layoutsConfigSchema.parse(input);
  const normalized = normalizeLayoutsConfig(parsed);
  await writeDoc(LAYOUTS_DOC, normalized);
  return normalized;
}

export async function saveAgeWritingConfig(input: unknown): Promise<AgeWritingConfig> {
  const parsed = ageWritingConfigSchema.parse(input);
  const normalized = normalizeAgeWritingConfig(parsed);
  await writeDoc(AGE_WRITING_DOC, normalized);
  return normalized;
}

export function defaultStoryCraftConfig(): StoryCraftConfig {
  return createDefaultStoryCraftConfig();
}

export async function saveStoryCraftConfig(input: unknown): Promise<StoryCraftConfig> {
  const parsed = storyCraftConfigSchema.parse(input);
  const normalized = normalizeStoryCraftConfig({ ...parsed, updatedAt: Date.now() });
  await writeDoc(STORY_CRAFT_DOC, normalized);
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

// ---- QR code library ------------------------------------------------------

/**
 * What the admin route hands in for a logo — bytes it just uploaded, a pointer
 * to an existing branding asset to copy from, or "keep" (an update that leaves
 * an already-saved logo untouched, so editing an unrelated field never forces
 * re-picking the file).
 */
export type QrLogoInput =
  | { source: "keep"; sizePct: number; quietPct: number; quietColor: string }
  | {
      source: "upload";
      base64: string;
      mimeType: string;
      sizePct: number;
      quietPct: number;
      quietColor: string;
    }
  | {
      source: "brandingAsset";
      brandingSlot: BrandAssetSlot;
      sizePct: number;
      quietPct: number;
      quietColor: string;
    };

export interface QrCodeSaveInput {
  /** Present ⇒ update that code; absent ⇒ create a new one. */
  id?: string;
  name: string;
  data: string;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  margin: number;
  scalePx: number;
  colorDark: string;
  colorLight: string;
  format: QrFormat;
  version: number | null;
  maskPattern: number | null;
  dotsStyle: QrDotStyle;
  cornerSquareStyle: QrCornerStyle | null;
  cornerDotStyle: QrCornerStyle | null;
  logo: QrLogoInput | null;
}

/**
 * Validate/clamp the scalar fields of a QR code by round-tripping a draft
 * through the same normalizer the stored doc is kept in — one source of truth
 * for "what's a legal value here", shared by reads and writes.
 */
function draftQrCode(input: QrCodeSaveInput, id: string, createdAt?: number): QrCode {
  const draft = normalizeQrCodesConfig({
    codes: [
      {
        ...input,
        id,
        logo: null,
        rendered: null,
        history: [],
        createdAt,
        updatedAt: Date.now(),
      },
    ],
  }).codes[0];
  if (!draft) throw new Error("A QR code needs something to encode.");
  return draft;
}

/**
 * Load bytes for a stored public asset. Prefer the Admin SDK path (talks to
 * whichever bucket the functions runtime is wired to — real or emulator)
 * over an HTTP fetch of `imageUrl`, which can 404 when Firestore still has
 * a stale emulator URL after Storage data was lost.
 */
async function loadPublicAssetBytes(asset: {
  storagePath?: string;
  imageUrl: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
  if (asset.storagePath) {
    try {
      const { base64, mimeType } = await downloadPublicBase64(asset.storagePath);
      return { buffer: Buffer.from(base64, "base64"), contentType: mimeType };
    } catch {
      // Fall through to the public URL — covers the rare case where the
      // Admin SDK can't see the object but the HTTP endpoint still can.
    }
  }
  return fetchPublicBytes(asset.imageUrl);
}

/**
 * Resolve a logo's source bytes: either the upload the admin just sent, or a
 * fresh copy of an existing branding asset.
 */
export async function resolveQrLogoSource(
  logo: Exclude<QrLogoInput, { source: "keep" }>,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (logo.source === "brandingAsset") {
    if (!BRAND_ASSET_SLOTS.includes(logo.brandingSlot)) {
      throw new Error("A valid branding asset slot is required.");
    }
    const branding = await getBrandingConfig();
    const asset = branding[logo.brandingSlot];
    if (!asset?.imageUrl) throw new Error("That branding asset isn't set yet.");
    try {
      return await loadPublicAssetBytes(asset);
    } catch (err) {
      // The config still points at it, but the file itself is gone from
      // Storage (e.g. local emulator data drifted from Firestore's after an
      // unclean restart) — say so plainly rather than surfacing a bare URL.
      throw new Error(
        `That branding asset's file is missing from Storage (it's still set in Marketing → Branding, but the ` +
          `underlying image is gone). Re-upload it there, then try again. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  return { buffer: Buffer.from(logo.base64, "base64"), contentType: logo.mimeType };
}

function clampLogoSizePct(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(0.3, Math.max(0.1, n)) : 0.2;
}

function clampLogoQuietPct(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.min(QR_LOGO_QUIET_MAX, Math.max(QR_LOGO_QUIET_MIN, n))
    : QR_LOGO_QUIET_DEFAULT;
}

function normalizeLogoQuietColor(n: unknown): string {
  return typeof n === "string" && /^#[0-9a-fA-F]{3,8}$/.test(n) ? n : QR_LOGO_QUIET_COLOR_DEFAULT;
}

/**
 * The logo bytes to actually render with: "keep" reuses an existing code's
 * already-stored logo (no re-fetch of the branding asset, no new copy), an
 * upload/brandingAsset request resolves fresh bytes, and no logo means none.
 */
async function resolveLogoBufferForRender(
  logo: QrLogoInput | null,
  existing: QrCode | undefined,
): Promise<Buffer | undefined> {
  if (!logo) return undefined;
  if (logo.source === "keep") {
    if (!existing?.logo) return undefined;
    try {
      return (await loadPublicAssetBytes(existing.logo.asset)).buffer;
    } catch {
      return undefined;
    }
  }
  return (await resolveQrLogoSource(logo)).buffer;
}

/**
 * Render a QR code for preview only — resolves the logo (if any) in memory but
 * never touches Storage or Firestore, so the admin UI can re-render on every
 * slider tweak without piling up files or history entries.
 */
export async function previewQrCode(
  input: QrCodeSaveInput,
): Promise<{ contentType: string; base64: string }> {
  const draft = draftQrCode(input, "preview");
  const existing = input.id ? findQrCode(await getQrCodesConfig(), input.id) : undefined;
  const logoBuffer = await resolveLogoBufferForRender(input.logo, existing);
  const rendered = await renderQrCode({
    data: draft.data,
    format: draft.format,
    errorCorrectionLevel: draft.errorCorrectionLevel,
    margin: draft.margin,
    scalePx: draft.scalePx,
    colorDark: draft.colorDark,
    colorLight: draft.colorLight,
    version: draft.version,
    maskPattern: draft.maskPattern,
    dotsStyle: draft.dotsStyle,
    cornerSquareStyle: draft.cornerSquareStyle,
    cornerDotStyle: draft.cornerDotStyle,
    logoBuffer,
    logoSizePct: input.logo ? clampLogoSizePct(input.logo.sizePct) : undefined,
    logoQuietPct: input.logo ? clampLogoQuietPct(input.logo.quietPct) : undefined,
    logoQuietColor: input.logo ? normalizeLogoQuietColor(input.logo.quietColor) : undefined,
  });
  return { contentType: rendered.contentType, base64: rendered.buffer.toString("base64") };
}

/**
 * Create or update a QR code, rendering it fresh every time. There is no
 * "draft" state to persist without a render — a saved code with nothing
 * generated for it yet isn't useful to anything that would reference it.
 */
export async function saveQrCode(input: QrCodeSaveInput): Promise<QrCodesConfig> {
  const current = await getQrCodesConfig();
  const existing = input.id ? findQrCode(current, input.id) : undefined;
  const id = existing?.id ?? input.id ?? randomUUID();
  const draft = draftQrCode(input, id, existing?.createdAt);

  // The logo is stored as its own independent copy — a branding asset picked
  // today can change or disappear later without retroactively changing a code
  // that already referenced it. "keep" reuses the existing copy untouched
  // (no re-fetch, no new file) so editing an unrelated field never disturbs it.
  let logo: QrLogo | null = null;
  // Bytes to composite with, kept in memory rather than re-fetched over HTTP
  // wherever we already have them — a fresh upload/branding-asset copy is
  // right here; only "keep" (reusing a copy from a previous save) has to go
  // back to Storage for it.
  let logoBuffer: Buffer | undefined;
  if (input.logo?.source === "keep") {
    logo = existing?.logo
      ? {
          ...existing.logo,
          sizePct: clampLogoSizePct(input.logo.sizePct),
          quietPct: clampLogoQuietPct(input.logo.quietPct),
          quietColor: normalizeLogoQuietColor(input.logo.quietColor),
        }
      : null;
    logoBuffer = logo ? (await loadPublicAssetBytes(logo.asset)).buffer : undefined;
  } else if (input.logo) {
    const { buffer, contentType } = await resolveQrLogoSource(input.logo);
    const { storagePath, publicUrl } = await uploadQrLogo(id, buffer, contentType);
    logo = {
      source: input.logo.source,
      ...(input.logo.source === "brandingAsset" ? { brandingSlot: input.logo.brandingSlot } : {}),
      asset: { imageUrl: publicUrl, storagePath, updatedAt: Date.now() },
      sizePct: clampLogoSizePct(input.logo.sizePct),
      quietPct: clampLogoQuietPct(input.logo.quietPct),
      quietColor: normalizeLogoQuietColor(input.logo.quietColor),
    };
    logoBuffer = buffer;
  }

  const rendered = await renderQrCode({
    data: draft.data,
    format: draft.format,
    errorCorrectionLevel: draft.errorCorrectionLevel,
    margin: draft.margin,
    scalePx: draft.scalePx,
    colorDark: draft.colorDark,
    colorLight: draft.colorLight,
    version: draft.version,
    maskPattern: draft.maskPattern,
    dotsStyle: draft.dotsStyle,
    cornerSquareStyle: draft.cornerSquareStyle,
    cornerDotStyle: draft.cornerDotStyle,
    logoBuffer,
    logoSizePct: logo?.sizePct,
    logoQuietPct: logo?.quietPct,
    logoQuietColor: logo?.quietColor,
  });
  const { storagePath, publicUrl } = await uploadQrCode(id, rendered.buffer, rendered.contentType);
  const renderRecord: QrRender = { imageUrl: publicUrl, storagePath, updatedAt: Date.now() };
  const history = existing?.rendered
    ? computeHistory(existing.rendered, renderRecord, existing.history)
    : (existing?.history ?? []);

  const nextCode: QrCode = {
    ...draft,
    format: rendered.format,
    errorCorrectionLevel: rendered.errorCorrectionLevel,
    logo,
    rendered: renderRecord,
    history,
  };

  const codes = existing
    ? current.codes.map((c) => (c.id === id ? nextCode : c))
    : [...current.codes, nextCode];
  const next = normalizeQrCodesConfig({ ...current, codes });
  await writeDoc(QR_CODES_DOC, next);
  return next;
}

/** Delete a QR code entirely. Unlike a branding slot (whose history exists so
 *  a replaced image can be restored), a deleted CODE has nothing left to
 *  restore it onto, so its rendered files (current + history + logo) are
 *  cleaned up too, best-effort. */
export async function deleteQrCode(id: string): Promise<QrCodesConfig> {
  const current = await getQrCodesConfig();
  const target = findQrCode(current, id);
  const codes = current.codes.filter((c) => c.id !== id);
  const next = normalizeQrCodesConfig({ ...current, codes });
  await writeDoc(QR_CODES_DOC, next);
  if (target) {
    const paths = [
      target.rendered?.storagePath,
      target.logo?.asset.storagePath,
      ...target.history.map((h) => h.storagePath),
    ].filter((p): p is string => Boolean(p));
    await Promise.all(paths.map((p) => deletePublicObject(p)));
  }
  return next;
}

/** Restore a previous render by its storage path (makes it current again — no
 *  re-render, the file already exists). */
export async function restoreQrCodeVersion(id: string, storagePath: string): Promise<QrCodesConfig> {
  const current = await getQrCodesConfig();
  const target = findQrCode(current, id);
  if (!target) throw new Error("QR code not found.");
  const version = target.history.find((h) => h.storagePath === storagePath);
  if (!version) throw new Error("That version was not found.");
  const history = computeHistory(target.rendered, version, target.history);
  const nextCode: QrCode = {
    ...target,
    rendered: { ...version, updatedAt: Date.now() },
    history,
    updatedAt: Date.now(),
  };
  const codes = current.codes.map((c) => (c.id === id ? nextCode : c));
  const next = normalizeQrCodesConfig({ ...current, codes });
  await writeDoc(QR_CODES_DOC, next);
  return next;
}

/** Remove one historical render from a code's history (the route deletes the
 *  stored file itself, mirroring the branding asset/watermark routes). */
export async function deleteQrCodeVersion(id: string, storagePath: string): Promise<QrCodesConfig> {
  const current = await getQrCodesConfig();
  const target = findQrCode(current, id);
  if (!target) throw new Error("QR code not found.");
  const nextCode: QrCode = { ...target, history: target.history.filter((h) => h.storagePath !== storagePath) };
  const codes = current.codes.map((c) => (c.id === id ? nextCode : c));
  const next = normalizeQrCodesConfig({ ...current, codes });
  await writeDoc(QR_CODES_DOC, next);
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

// ---- Catalog pictures ------------------------------------------------------

/**
 * Persist a key's picture list. Order in the array IS the order shown, so it's
 * reindexed on every write and the first entry is the item's thumbnail.
 * Writing an empty list drops the key rather than leaving an empty array.
 */
async function writeCatalogPhotos(
  current: CatalogMediaConfig,
  key: string,
  list: CatalogPhoto[],
): Promise<CatalogMediaConfig> {
  const photos = { ...current.photos };
  if (list.length > 0) photos[key] = list.map((p, i) => ({ ...p, sortOrder: i }));
  else delete photos[key];
  const next = normalizeCatalogMediaConfig({ ...current, photos });
  await writeDoc(CATALOG_MEDIA_DOC, next);
  return next;
}

/** Add a freshly uploaded picture to a key (active, shown last). */
export async function addCatalogPhoto(
  key: string,
  photo: { imageUrl: string; storagePath: string; alt: string; caption?: string },
): Promise<CatalogMediaConfig> {
  const current = await getCatalogMediaConfig();
  const list = photosFor(current, key);
  const added: CatalogPhoto = { ...photo, active: true, sortOrder: list.length, updatedAt: Date.now() };
  return writeCatalogPhotos(current, key, [...list, added]);
}

/**
 * Edit one picture: retire or reinstate it, fix its alt text or caption, or
 * promote it to the item's thumbnail. Retiring keeps the record and the file
 * — that's the history — so nothing here deletes anything.
 */
export async function patchCatalogPhoto(
  key: string,
  storagePath: string,
  patch: { active?: boolean; alt?: string; caption?: string; makePrimary?: boolean },
): Promise<CatalogMediaConfig> {
  const current = await getCatalogMediaConfig();
  const list = photosFor(current, key);
  const target = list.find((p) => p.storagePath === storagePath);
  if (!target) throw new Error("Photo not found.");
  const updated: CatalogPhoto = {
    ...target,
    ...(typeof patch.active === "boolean" ? { active: patch.active } : {}),
    ...(typeof patch.alt === "string" ? { alt: patch.alt } : {}),
    ...(typeof patch.caption === "string" ? { caption: patch.caption } : {}),
    updatedAt: Date.now(),
  };
  // A retired picture can't stand in for the item, so promotion implies active.
  const promote = patch.makePrimary && updated.active;
  const next = promote
    ? [updated, ...list.filter((p) => p.storagePath !== storagePath)]
    : list.map((p) => (p.storagePath === storagePath ? updated : p));
  return writeCatalogPhotos(current, key, next);
}

/** Forget a picture entirely (the route deletes the stored file). */
export async function removeCatalogPhoto(
  key: string,
  storagePath: string,
): Promise<CatalogMediaConfig> {
  const current = await getCatalogMediaConfig();
  const list = photosFor(current, key).filter((p) => p.storagePath !== storagePath);
  return writeCatalogPhotos(current, key, list);
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

/** Append a showcase image to a layout (used by the image-upload route). */
export async function addLayoutExample(
  layoutId: string,
  example: Omit<LayoutExample, "order">,
): Promise<LayoutsConfig> {
  const current = await getLayoutsConfig();
  const override = current.overrides[layoutId] ?? {};
  const examples = [...(override.examples ?? [])];
  const order = examples.reduce((max, e) => Math.max(max, e.order), -1) + 1;
  examples.push({ ...example, order });
  const next = normalizeLayoutsConfig({
    ...current,
    overrides: { ...current.overrides, [layoutId]: { ...override, examples } },
  });
  await writeDoc(LAYOUTS_DOC, next);
  return next;
}

/** Remove one showcase image from a layout by its storage path. */
export async function removeLayoutExample(
  layoutId: string,
  storagePath: string,
): Promise<LayoutsConfig> {
  const current = await getLayoutsConfig();
  const override = current.overrides[layoutId];
  if (!override?.examples) return current;
  const examples = override.examples
    .filter((e) => e.storagePath !== storagePath)
    // Keep `order` dense so the admin list can't develop gaps over time.
    .map((e, i) => ({ ...e, order: i }));
  const next = normalizeLayoutsConfig({
    ...current,
    overrides: { ...current.overrides, [layoutId]: { ...override, examples } },
  });
  await writeDoc(LAYOUTS_DOC, next);
  return next;
}
