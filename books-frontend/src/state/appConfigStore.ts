/**
 * Global, admin-managed configuration, read live from Firestore `appConfig/*`.
 *
 * Reads are public (anyone can read the model config, art-style examples and
 * model costs). Writes go exclusively through the backend `/admin/*` endpoints,
 * which enforce admin status; the live snapshot then reflects the change. The
 * client model resolver (`platform/ai/resolve`) reads `modelConfig` from here.
 */
import { create } from "zustand";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getFirebaseDb } from "../lib/firebase";
import { backendFetch } from "../platform/backend";
import {
  createDefaultModelConfig,
  normalizeModelConfig,
  type ModelConfig,
} from "../core/config/modelConfig";
import {
  createDefaultArtStylesConfig,
  normalizeArtStylesConfig,
  type ArtStylesConfig,
} from "../core/config/artStyles";
import {
  createDefaultLayoutsConfig,
  normalizeLayoutsConfig,
  type LayoutsConfig,
} from "../core/config/layouts";
import {
  createDefaultAgeWritingConfig,
  normalizeAgeWritingConfig,
  type AgeWritingConfig,
} from "../core/config/ageWriting";
import {
  createDefaultStoryCraftConfig,
  normalizeStoryCraftConfig,
  type StoryCraftConfig,
} from "../core/config/storyCraft";
import {
  createDefaultTypographyConfig,
  normalizeTypographyConfig,
  type TypographyConfig,
} from "../core/config/typography";
import {
  createDefaultModelCostTable,
  normalizeModelCostTable,
  type ModelCostTable,
} from "../core/config/modelCosts";
import {
  createDefaultImageCostStats,
  normalizeImageCostStats,
  type ImageCostStats,
} from "../core/config/imageCostStats";
import {
  createDefaultLatencyStats,
  normalizeLatencyStats,
  type LatencyStats,
} from "../core/config/latencyStats";
import type { CostSuggestionResult } from "../core/config/costSuggestion";
import type { ProviderId } from "../core/config/options";
import {
  createDefaultPricingSettings,
  normalizePricingSettings,
  normalizePublicProductsConfig,
  type PricingSettings,
  type ProductDefinition,
  type ProductsConfig,
  type ProviderEnv,
  type PublicProductsConfig,
} from "../core/config/products";
import type { MarginBreakdown } from "../core/config/productMath";
import type { VariantSelection } from "../core/config/variants";
import {
  createDefaultSparksConfig,
  normalizeSparksConfig,
  type SparksConfig,
} from "../core/config/sparks";
import {
  createDefaultReferralConfig,
  normalizeReferralConfig,
  referralConfigFromLegacy,
  type ReferralConfig,
  type ReferralStatsSummary,
} from "../core/config/referral";
import {
  createDefaultAffiliateConfig,
  normalizeAffiliateConfig,
  type AffiliateConfig,
  type AffiliateOverview,
  type AffiliateSyncStatus,
} from "../core/config/affiliates";
import {
  normalizePublicPlansConfig,
  type BillingEnv,
  type PlanDefinition,
  type PlansConfig,
  type PublicPlansConfig,
} from "../core/config/plans";
import {
  createDefaultBrandingConfig,
  normalizeBrandingConfig,
  type BrandAssetSlot,
  type BrandColors,
  type BrandingConfig,
} from "../core/config/branding";
import {
  createDefaultQrCodesConfig,
  findQrCode,
  normalizeQrCodesConfig,
  type QrCode,
  type QrCodesConfig,
  type QrCornerStyle,
  type QrDotStyle,
  type QrErrorCorrectionLevel,
  type QrFormat,
} from "../core/config/qrCodes";

/** What the admin form sends to create, update, or preview a QR code. */
export interface QrCodeInput {
  /** Present when previewing/downloading an already-saved code — lets the
   *  backend resolve a `"keep"` logo against that code's own stored copy.
   *  Ignored by create/update (those get the id from the URL instead). */
  id?: string;
  name: string;
  data: string;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  margin: number;
  scalePx: number;
  colorDark: string;
  colorLight: string;
  format: QrFormat;
  /** QR version 1..40, or null to auto-select the smallest that fits. */
  version: number | null;
  /** Mask pattern 0..7, or null to auto-select the best-scoring one. Ignored
   *  once any styling below is turned on. */
  maskPattern: number | null;
  /** Data-module ("cell") shape — "square" keeps the plain classic look. */
  dotsStyle: QrDotStyle;
  /** Outer-ring eye shape, or null to match `dotsStyle`. */
  cornerSquareStyle: QrCornerStyle | null;
  /** Inner eye-dot shape, or null to match `dotsStyle`. */
  cornerDotStyle: QrCornerStyle | null;
  logo:
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
      }
    | null;
}
import {
  createDefaultSeoConfig,
  normalizeSeoConfig,
  type SeoConfig,
} from "../core/config/seo";
import {
  createDefaultSiteImagesConfig,
  normalizeSiteImagesConfig,
  type SiteImagesConfig,
  type SiteImageSlot,
} from "../core/config/siteImages";
import {
  createDefaultSiteContentConfig,
  normalizeSiteContentConfig,
  type SiteContentConfig,
  type SiteTextSlot,
} from "../core/config/siteContent";
import {
  createDefaultCatalogMediaConfig,
  normalizeCatalogMediaConfig,
  type CatalogMediaConfig,
} from "../core/config/catalogMedia";
import {
  createDefaultPromptsConfig,
  normalizePromptsConfig,
  type PromptsConfig,
} from "../core/config/prompts";
import {
  createDefaultEmailConfig,
  normalizeEmailConfig,
  type EmailConfig,
} from "../core/config/emailConfig";
import {
  createDefaultEmailStats,
  normalizeEmailStats,
  type EmailStats,
} from "../core/config/emailStats";
import {
  createDefaultSlackConfig,
  normalizeSlackConfig,
  type SlackConfig,
} from "../core/config/slackConfig";
import {
  createDefaultLegalConfig,
  normalizeLegalConfig,
  type LegalConfig,
  type LegalRole,
} from "../core/config/legal";
import {
  createDefaultCookieConfig,
  normalizeCookieConfig,
  type CookieConfig,
} from "../core/config/cookieConfig";
import {
  createDefaultAnnouncementsConfig,
  normalizeAnnouncementsConfig,
  type AnnouncementsConfig,
} from "../core/config/announcements";
import type { BlogImage, BlogIndex, BlogPost } from "../core/config/blog";
import type { BlogStats, BlogStatsListItem } from "../core/config/blogStats";
import type { SlackChannel } from "../core/notify/registry";
import type { EmailTemplateId } from "../core/email/types";
import type { ActionCostReport, CostGranularity } from "../core/analytics/types";

/** Result of a live margin preview (server fetches a provider quote when able). */
export interface MarginPreview {
  breakdown: MarginBreakdown;
  live: boolean;
  quoteError?: string;
}

/** One SKU's verdict from probing the print provider. */
export interface SkuVerifyResult {
  productId: string;
  sku: string;
  /** "inconclusive" means the probe failed, NOT that the SKU is bad. */
  outcome: "ok" | "rejected" | "inconclusive";
  message?: string;
}

/** What the provider knows about one assembled SKU. */
export interface SkuMatrixEntry {
  sku: string;
  env: ProviderEnv;
  ok: boolean;
  at: number;
  pages?: { min: number; max: number };
  unitCost?: number;
  currency?: string;
  message?: string;
}

export interface SkuCheck {
  entry: SkuMatrixEntry;
  /** False when the answer came from the cache rather than the provider. */
  fresh: boolean;
}

/** One probe taken while measuring cost against the provider. */
export interface CostSample {
  pages: number;
  copies: number;
  unitCost: number;
  /** Which variant was priced (`print/paper`); absent ⇒ the base variant. */
  variant?: string;
}

/** One variant's measured per-page rate. */
export interface VariantCostSample {
  key: string;
  label: string;
  perPage: number;
  residual: number;
}

export interface CalibrationResult {
  ok: boolean;
  message?: string;
  /**
   * Set when the cost fit worked but shipping couldn't be measured. Reported
   * separately because a passthrough product is still unsellable in that state,
   * and folding it into `ok` is how it used to go unnoticed.
   */
  shippingMessage?: string;
  /**
   * The provider rate-limited part of this run. Distinct from failure: the
   * numbers we did get are good, but the gaps are ours, not the catalog's.
   */
  throttled?: boolean;
  /** How many variants went unmeasured because we were throttled. */
  variantsThrottled?: number;
  env: ProviderEnv;
  currency?: string;
  table?: ProductDefinition["cost"]["table"];
  variantPerPage?: Record<string, number>;
  variants: VariantCostSample[];
  shippingRows?: ProductDefinition["shipping"]["fallback"];
  shippingFallback?: number;
  /** Page bounds the provider itself reported. */
  discoveredPages?: { min: number; max: number };
  samples: CostSample[];
  /** How far the worst sample missed the fitted line. */
  fitResidual?: number;
}

export interface CalibrationOutcome {
  result: CalibrationResult;
  config: ProductsConfig;
  /** This product's row for the catalog-wide report, when it ran as part of one. */
  run?: CatalogCalibrationRun;
}

/** One product's outcome from a catalog-wide cost measurement. */
export interface CatalogCalibrationRun {
  productId: string;
  name: string;
  sku: string;
  ok: boolean;
  message?: string;
  shippingMessage?: string;
  /** The provider rate-limited this product: re-run rather than reconfigure. */
  throttled?: boolean;
  currency?: string;
  before: { basePerUnit: number; perPage: number };
  after?: { basePerUnit: number; perPage: number };
  variants?: { measured: number; offered: number };
  variantsThrottled?: number;
}

export interface SkuVerifySummary {
  env: ProviderEnv;
  results: SkuVerifyResult[];
  ok: number;
  rejected: number;
  inconclusive: number;
  /** The catalog after the verdicts were persisted. */
  config: ProductsConfig;
}

interface AppConfigState {
  modelConfig: ModelConfig;
  artStyles: ArtStylesConfig;
  /** Admin overlay for the structural page layouts (titles, sizes, showcase). */
  layouts: LayoutsConfig;
  ageWriting: AgeWritingConfig;
  /** Per-age-band story themes, stylistic devices and drafting rules. */
  storyCraft: StoryCraftConfig;
  /** Age/format-aware font-size recommendation coefficients. */
  typography: TypographyConfig;
  /**
   * PUBLIC cost projection (`appConfig/modelCostsPublic`): flat per-image
   * estimates only, derived server-side. Powers storefront Spark estimates.
   * The full provider rate table is admin-only — see `adminModelCosts`.
   */
  modelCosts: ModelCostTable;
  /**
   * Full rate table (admin-only doc). Empty until subscribeAdminModelCosts is
   * called (the admin dashboard does) and the admin-gated read succeeds.
   */
  adminModelCosts: ModelCostTable;
  /** Rolling window of recent per-call image costs (for Spark estimate ranges). */
  imageCostStats: ImageCostStats;
  /** Rolling window of recent render durations (for time estimate ranges). */
  latencyStats: LatencyStats;
  /** Public product projection (storefront-facing; resolved prices, no internals). */
  products: PublicProductsConfig;
  /** Catalog-wide pricing economics (currencies, FX, fees, tax). */
  pricingSettings: PricingSettings;
  /** The Sparks economy (world-readable; also used by the admin editor). */
  sparks: SparksConfig;
  /** The referral program (world-readable so the studio can show the live offer). */
  referral: ReferralConfig;
  /**
   * False when `appConfig/referral` hasn't been written yet, in which case
   * `referral` is the projection of the legacy `sparks.referral` settings — the
   * same fallback the backend applies.
   */
  referralDocExists: boolean;
  /**
   * The affiliate scope map. NOT a live snapshot like the rest: it lives in the
   * admin-only `adminSettings/affiliates` doc, so it's fetched through the
   * backend when the admin tab opens.
   */
  affiliates: AffiliateConfig;
  /** Public subscription plans (storefront-facing; no Stripe internals). */
  plans: PublicPlansConfig;
  /** Global branding (the share watermark asset + appearance). */
  branding: BrandingConfig;
  /** The admin-built QR code library (Marketing → QR codes). */
  qrCodes: QrCodesConfig;
  /** Marketing SEO config (landing-page metadata + structured data). */
  seo: SeoConfig;
  /** Landing-page illustrations (inline drag-&-drop editor). */
  siteImages: SiteImagesConfig;
  /** Landing-page copy overrides (inline text editor). */
  siteContent: SiteContentConfig;
  /** Catalog pictures (print options, books, the ebook, packs), by `scope/id`. */
  catalogMedia: CatalogMediaConfig;
  /** Admin-editable LLM prompt templates. */
  prompts: PromptsConfig;
  /**
   * System + marketing email config (senders, toggles, footer). Admin-only —
   * it holds the support inbox and contact recipient, so it is NOT part of the
   * public snapshot set; call {@link loadEmailConfig} to populate it.
   */
  emailConfig: EmailConfig;
  /** Aggregate email delivery statistics (sent/delivered/opened/bounced…). */
  emailStats: EmailStats;
  /** Per-message Slack notification toggles. */
  slackConfig: SlackConfig;
  /** Legal documents (dynamic URL list + roles + consent versions). */
  legal: LegalConfig;
  /** Cookie consent banner config (copy, categories, consent version). */
  cookieConfig: CookieConfig;
  /** Marketing announcement banners (Marketing → Announcements). */
  announcements: AnnouncementsConfig;
  loaded: boolean;
  unsubs: Unsubscribe[];
  adminCostsUnsub: Unsubscribe | null;

  /** Begin live subscriptions to the config docs (idempotent). */
  subscribe: () => void;
  stop: () => void;
  /**
   * Live-subscribe to the FULL rate table (admin-only Firestore doc). Called by
   * the admin dashboard; rules deny it for everyone else (state stays null).
   */
  subscribeAdminModelCosts: () => void;

  // Admin writes (enforced server-side; the snapshot reflects the result).
  saveModelConfig: (config: ModelConfig) => Promise<void>;
  saveArtStyles: (config: ArtStylesConfig) => Promise<void>;
  saveLayouts: (config: LayoutsConfig) => Promise<void>;
  /** Upload a showcase image for a layout; returns the stored example. */
  uploadLayoutImage: (
    layoutId: string,
    base64: string,
    mimeType: string,
    meta?: { shape?: string; side?: string; alt?: string },
  ) => Promise<void>;
  saveAgeWriting: (config: AgeWritingConfig) => Promise<void>;
  saveStoryCraft: (config: StoryCraftConfig) => Promise<void>;
  saveTypography: (config: TypographyConfig) => Promise<void>;
  saveModelCosts: (table: ModelCostTable) => Promise<void>;
  savePricingSettings: (settings: PricingSettings) => Promise<void>;
  saveSparksConfig: (config: SparksConfig) => Promise<void>;
  /** Authoritative config (projects legacy sparks.referral when no doc exists yet). */
  loadReferralConfig: () => Promise<ReferralConfig>;
  saveReferralConfig: (config: ReferralConfig) => Promise<void>;
  /** Funnel report for the referral program (admin-only). */
  loadReferralStats: (from?: number, to?: number) => Promise<ReferralStatsSummary>;
  /** Pay out a reward the limits held for review, or decline it for good. */
  resolveHeldReward: (rewardId: string, verdict: "release" | "decline") => Promise<void>;
  /** Void every still-unaccepted invitation (misconfiguration emergency). */
  voidUnacceptedInvitations: (reason?: string) => Promise<number>;
  /** The affiliate scope map (admin-only doc, so an explicit fetch). */
  loadAffiliateConfig: () => Promise<AffiliateConfig>;
  saveAffiliateConfig: (config: AffiliateConfig) => Promise<void>;
  /** Everything the affiliate dashboard shows, read from the local mirror. */
  loadAffiliateOverview: (ping?: boolean) => Promise<AffiliateOverview>;
  /** Pull Rewardful now instead of waiting for tonight's reconcile. */
  syncAffiliates: (prune?: boolean) => Promise<AffiliateSyncStatus>;
  saveSeoConfig: (config: SeoConfig) => Promise<void>;
  savePrompts: (config: PromptsConfig) => Promise<void>;
  /**
   * Fetch the admin-only email config. Also reports whether the ZeptoMail token
   * secret is present, so the editor can warn when sending is unconfigured.
   */
  loadEmailConfig: () => Promise<{ config: EmailConfig; configured: boolean }>;
  saveEmailConfig: (config: EmailConfig) => Promise<void>;
  /** Send a template with its sample vars to a test recipient (admin by default). */
  sendTestEmail: (templateId: EmailTemplateId, to?: string) => Promise<void>;
  saveSlackConfig: (config: SlackConfig) => Promise<void>;
  /** Post a real test notification to a Slack channel to verify the webhook. */
  sendTestSlack: (channel: SlackChannel) => Promise<void>;
  saveLegal: (config: LegalConfig) => Promise<void>;
  /** Email every user about a material change to a legal document (bulk send). */
  notifyPolicyUpdate: (role: LegalRole) => Promise<{ recipients: number; sent: number }>;
  saveCookieConfig: (config: CookieConfig) => Promise<void>;
  saveAnnouncementsConfig: (config: AnnouncementsConfig) => Promise<void>;
  /** Send a sample contact-form message to the configured contact inbox. */
  sendTestContact: () => Promise<void>;
  uploadArtStyleImage: (styleId: string, base64: string, mimeType: string) => Promise<void>;

  // Landing-page inline editing (admin, gated in the UI; enforced server-side).
  uploadSiteImage: (slot: SiteImageSlot, base64: string, mimeType: string, alt?: string) => Promise<void>;
  removeSiteImage: (slot: SiteImageSlot) => Promise<void>;
  restoreSiteImage: (slot: SiteImageSlot, storagePath: string) => Promise<void>;
  deleteSiteImageVersion: (slot: SiteImageSlot, storagePath: string) => Promise<void>;
  saveSiteText: (slot: SiteTextSlot, value: string) => Promise<void>;
  resetSiteText: (slot: SiteTextSlot) => Promise<void>;

  // Catalog pictures, keyed `scope/id` (see `catalogMedia.ts`).
  uploadCatalogPhoto: (
    key: string,
    base64: string,
    mimeType: string,
    alt: string,
    caption?: string,
  ) => Promise<void>;
  /** Retire, reinstate, retitle, or promote a picture to the item's thumbnail. */
  patchCatalogPhoto: (
    key: string,
    storagePath: string,
    patch: { active?: boolean; alt?: string; caption?: string; makePrimary?: boolean },
  ) => Promise<void>;
  /** Permanently forget a picture and delete the stored file. */
  deleteCatalogPhoto: (key: string, storagePath: string) => Promise<void>;

  // Branding — brand identity, image assets, and the share watermark.
  saveBrandingInfo: (patch: { brandName?: string; tagline?: string; colors?: Partial<BrandColors> }) => Promise<void>;
  uploadBrandingAsset: (slot: BrandAssetSlot, base64: string, mimeType: string, alt?: string) => Promise<void>;
  removeBrandingAsset: (slot: BrandAssetSlot) => Promise<void>;
  restoreBrandingAsset: (slot: BrandAssetSlot, storagePath: string) => Promise<void>;
  deleteBrandingAssetVersion: (slot: BrandAssetSlot, storagePath: string) => Promise<void>;
  uploadWatermark: (base64: string, mimeType: string, opacity?: number, scale?: number) => Promise<void>;
  updateWatermarkAppearance: (patch: { opacity?: number; scale?: number }) => Promise<void>;
  removeWatermark: () => Promise<void>;
  restoreWatermark: (storagePath: string) => Promise<void>;
  deleteWatermarkVersion: (storagePath: string) => Promise<void>;

  // QR code library (Marketing → QR codes) — a named, reusable set of QR codes
  // rendered by our own generator, any of which other features can point at by id.
  createQrCode: (input: QrCodeInput) => Promise<QrCode>;
  updateQrCode: (id: string, input: QrCodeInput) => Promise<QrCode>;
  deleteQrCode: (id: string) => Promise<void>;
  restoreQrCodeVersion: (id: string, storagePath: string) => Promise<void>;
  deleteQrCodeVersion: (id: string, storagePath: string) => Promise<void>;
  /** Render without saving — no Storage write, no history entry. */
  previewQrCode: (input: QrCodeInput) => Promise<{ contentType: string; base64: string }>;

  // Subscription plans (admin). The PUBLIC projection lives in `plans`; the full
  // config (incl. Stripe ids) is fetched on demand from the backend.
  loadAdminPlans: () => Promise<PlansConfig>;
  savePlan: (plan: PlanDefinition) => Promise<PlanDefinition>;
  savePlansConfig: (config: PlansConfig) => Promise<PlansConfig>;
  deletePlanById: (id: string) => Promise<PlansConfig>;
  /** `env` targets a specific Stripe environment (default: whichever is active). */
  syncPlans: (env?: BillingEnv) => Promise<PlansConfig>;

  /** Per-action cost intelligence (avg/high/low + frequency + realized margin + time-series). */
  loadActionCosts: (opts: {
    from: number;
    to: number;
    granularity: CostGranularity;
  }) => Promise<ActionCostReport>;

  // Product catalog (admin). The full config (incl. cost/margin) is fetched on
  // demand — the private doc is not client-readable; only the public projection
  // is in `products`.
  loadAdminProducts: () => Promise<ProductsConfig>;
  saveProduct: (product: ProductDefinition) => Promise<ProductDefinition>;
  deleteProductById: (id: string) => Promise<ProductsConfig>;
  seedProducts: () => Promise<ProductsConfig>;
  previewMargin: (
    product: ProductDefinition,
    scenario: {
      pages: number;
      copies: number;
      currency: string;
      country?: string;
      region?: string;
      /** Quote and price this variant instead of the product's base SKU. */
      variant?: VariantSelection;
    },
  ) => Promise<MarginPreview>;
  /** Probe SKUs against a provider environment and persist the verdicts. */
  verifyProducts: (opts?: { env?: ProviderEnv; id?: string }) => Promise<SkuVerifySummary>;
  /**
   * Derive a product's cost table from live provider quotes.
   *
   * Also how the catalog is measured: the admin calls this in a loop rather
   * than hitting the catalog-wide endpoint, because a full sweep is far too
   * many provider round trips to finish inside one request, and per-product
   * calls persist as they go.
   */
  calibrateProductCost: (id: string, env?: ProviderEnv) => Promise<CalibrationOutcome>;
  /** Ask the provider whether an assembled SKU exists. */
  checkSku: (sku: string, opts?: { env?: ProviderEnv; pages?: number; refresh?: boolean }) => Promise<SkuCheck>;

  // Blog / articles (admin). Full posts live in the `blog` Firestore collection
  // (not client-writable); the public projection is read server-side. These
  // admin actions go through the admin-gated backend.
  loadAdminPosts: () => Promise<BlogPost[]>;
  savePost: (post: BlogPost, originalSlug?: string) => Promise<{ post: BlogPost; index: BlogIndex }>;
  deletePost: (slug: string) => Promise<BlogIndex>;
  seedPosts: () => Promise<{ added: number; index: BlogIndex }>;
  uploadPostImage: (
    slug: string,
    base64: string,
    mimeType: string,
    alt?: string,
  ) => Promise<BlogImage>;
  /** Full analytics aggregate for one post (admin dashboard). */
  loadBlogStats: (slug: string) => Promise<BlogStats>;
  /** Lightweight per-post totals for the admin list. */
  loadAllBlogStats: () => Promise<BlogStatsListItem[]>;

  /** Ask the server to read the provider's pricing docs and suggest a cost. */
  suggestCost: (
    provider: ProviderId,
    modelId: string,
    modality: "text" | "image",
  ) => Promise<CostSuggestionResult>;

  /**
   * Batch suggest: one server call, grouped by provider (one LLM call each, run
   * in parallel). Returns one result per requested model.
   */
  suggestCosts: (
    targets: Array<{ provider: ProviderId; modelId: string }>,
  ) => Promise<CostSuggestionResult[]>;
}

async function putJson(path: string, body: unknown): Promise<unknown> {
  const res = await backendFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await safeError(res)) ?? "Request failed.");
  return res.json();
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? null;
  } catch {
    return null;
  }
}

export const useAppConfigStore = create<AppConfigState>((set, get) => ({
  modelConfig: createDefaultModelConfig(),
  artStyles: createDefaultArtStylesConfig(),
  layouts: createDefaultLayoutsConfig(),
  ageWriting: createDefaultAgeWritingConfig(),
  storyCraft: createDefaultStoryCraftConfig(),
  typography: createDefaultTypographyConfig(),
  modelCosts: createDefaultModelCostTable(),
  adminModelCosts: createDefaultModelCostTable(),
  imageCostStats: createDefaultImageCostStats(),
  latencyStats: createDefaultLatencyStats(),
  products: { version: 1, products: [] },
  pricingSettings: createDefaultPricingSettings(),
  sparks: createDefaultSparksConfig(),
  referral: createDefaultReferralConfig(),
  referralDocExists: false,
  affiliates: createDefaultAffiliateConfig(),
  plans: { version: 1, plans: [] },
  branding: createDefaultBrandingConfig(),
  qrCodes: createDefaultQrCodesConfig(),
  seo: createDefaultSeoConfig(),
  siteImages: createDefaultSiteImagesConfig(),
  siteContent: createDefaultSiteContentConfig(),
  catalogMedia: createDefaultCatalogMediaConfig(),
  prompts: createDefaultPromptsConfig(),
  emailConfig: createDefaultEmailConfig(),
  emailStats: createDefaultEmailStats(),
  slackConfig: createDefaultSlackConfig(),
  legal: createDefaultLegalConfig(),
  cookieConfig: createDefaultCookieConfig(),
  announcements: createDefaultAnnouncementsConfig(),
  loaded: false,
  unsubs: [],

  subscribe() {
    if (get().unsubs.length > 0) return;
    const db = getFirebaseDb();
    const unsubs: Unsubscribe[] = [
      onSnapshot(doc(db, "appConfig", "models"), (snap) => {
        set({ modelConfig: normalizeModelConfig(snap.exists() ? snap.data() : undefined), loaded: true });
      }, () => set({ loaded: true })),
      onSnapshot(doc(db, "appConfig", "artStyles"), (snap) => {
        set({ artStyles: normalizeArtStylesConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "layouts"), (snap) => {
        set({ layouts: normalizeLayoutsConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "ageWriting"), (snap) => {
        set({ ageWriting: normalizeAgeWritingConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "storyCraft"), (snap) => {
        set({ storyCraft: normalizeStoryCraftConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "typography"), (snap) => {
        set({ typography: normalizeTypographyConfig(snap.exists() ? snap.data() : undefined) });
      }),
      // The public projection (per-image estimates only); the raw rate table
      // is admin-only and subscribed separately via subscribeAdminModelCosts.
      onSnapshot(doc(db, "appConfig", "modelCostsPublic"), (snap) => {
        set({ modelCosts: normalizeModelCostTable(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "imageCostStats"), (snap) => {
        set({ imageCostStats: normalizeImageCostStats(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "latencyStats"), (snap) => {
        set({ latencyStats: normalizeLatencyStats(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "products"), (snap) => {
        set({ products: normalizePublicProductsConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "pricingSettings"), (snap) => {
        set({ pricingSettings: normalizePricingSettings(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "sparks"), (snap) => {
        const sparks = normalizeSparksConfig(snap.exists() ? snap.data() : undefined);
        set({ sparks });
        // The legacy projection is derived from this doc, so a Sparks change has
        // to re-derive it (either doc can arrive first).
        if (!get().referralDocExists) set({ referral: referralConfigFromLegacy(sparks.referral) });
      }),
      onSnapshot(doc(db, "appConfig", "referral"), (snap) => {
        // The backend projects the OLD `sparks.referral` settings until an admin
        // saves the new program once, so the client has to project them too —
        // otherwise the invite entry points stay hidden on a program that is
        // live server-side.
        set({ referralDocExists: snap.exists() });
        set({
          referral: snap.exists()
            ? normalizeReferralConfig(snap.data())
            : referralConfigFromLegacy(get().sparks.referral),
        });
      }),
      onSnapshot(doc(db, "appConfig", "plans"), (snap) => {
        set({ plans: normalizePublicPlansConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "branding"), (snap) => {
        set({ branding: normalizeBrandingConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "qrCodes"), (snap) => {
        set({ qrCodes: normalizeQrCodesConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "seo"), (snap) => {
        set({ seo: normalizeSeoConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "siteImages"), (snap) => {
        set({ siteImages: normalizeSiteImagesConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "siteContent"), (snap) => {
        set({ siteContent: normalizeSiteContentConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "catalogMedia"), (snap) => {
        set({
          catalogMedia: normalizeCatalogMediaConfig(snap.exists() ? snap.data() : undefined),
        });
      }),
      onSnapshot(doc(db, "appConfig", "prompts"), (snap) => {
        set({ prompts: normalizePromptsConfig(snap.exists() ? snap.data() : undefined) });
      }),
      // NOTE: `emailConfig` is deliberately NOT subscribed here. It holds the
      // support inbox, the contact recipient and every sender identity, so it
      // lives in an admin-only doc and is fetched by the admin editor via
      // `loadEmailConfig()` instead of being streamed to every visitor.
      onSnapshot(doc(db, "appConfig", "emailStats"), (snap) => {
        set({ emailStats: normalizeEmailStats(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "slackConfig"), (snap) => {
        set({ slackConfig: normalizeSlackConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "legal"), (snap) => {
        set({ legal: normalizeLegalConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "cookieConfig"), (snap) => {
        set({ cookieConfig: normalizeCookieConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "announcements"), (snap) => {
        set({ announcements: normalizeAnnouncementsConfig(snap.exists() ? snap.data() : undefined) });
      }),
    ];
    set({ unsubs });
  },

  adminCostsUnsub: null,

  stop() {
    get().unsubs.forEach((u) => u());
    get().adminCostsUnsub?.();
    set({ unsubs: [], adminCostsUnsub: null });
  },

  subscribeAdminModelCosts() {
    if (get().adminCostsUnsub) return;
    const unsub = onSnapshot(
      doc(getFirebaseDb(), "appConfig", "modelCosts"),
      (snap) => {
        set({ adminModelCosts: normalizeModelCostTable(snap.exists() ? snap.data() : undefined) });
      },
      () => {
        // Permission denied (not an admin) — the tabs that need it are behind
        // the admin gate anyway, so just leave it empty.
      },
    );
    set({ adminCostsUnsub: unsub });
  },

  async saveModelConfig(config) {
    await putJson("/admin/config/models", config);
  },

  async saveArtStyles(config) {
    await putJson("/admin/config/art-styles", config);
  },

  async saveLayouts(config) {
    await putJson("/admin/config/layouts", config);
  },

  async saveAgeWriting(config) {
    await putJson("/admin/config/age-writing", config);
  },

  async saveStoryCraft(config) {
    set({ storyCraft: normalizeStoryCraftConfig(await putJson("/admin/config/story-craft", config)) });
  },

  async saveTypography(config) {
    set({ typography: normalizeTypographyConfig(await putJson("/admin/config/typography", config)) });
  },

  async saveModelCosts(table) {
    await putJson("/admin/config/model-costs", table);
  },

  async savePricingSettings(settings) {
    await putJson("/admin/config/pricing-settings", settings);
  },

  async saveSparksConfig(config) {
    await putJson("/admin/config/sparks", config);
  },

  async loadReferralConfig() {
    const res = await backendFetch("/admin/config/referral");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load referral config.");
    const config = normalizeReferralConfig(await res.json());
    set({ referral: config });
    return config;
  },

  async saveReferralConfig(config) {
    set({
      referral: normalizeReferralConfig(await putJson("/admin/config/referral", config)),
      // The doc now exists, so the legacy projection must stop overwriting it.
      referralDocExists: true,
    });
  },

  async loadAffiliateConfig() {
    const res = await backendFetch("/admin/config/affiliates");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load the affiliate config.");
    const config = normalizeAffiliateConfig(await res.json());
    set({ affiliates: config });
    return config;
  },

  async saveAffiliateConfig(config) {
    set({ affiliates: normalizeAffiliateConfig(await putJson("/admin/config/affiliates", config)) });
  },

  async loadAffiliateOverview(ping = false) {
    const res = await backendFetch(`/admin/affiliates/overview${ping ? "?ping=1" : ""}`);
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load the affiliate overview.");
    const overview = (await res.json()) as AffiliateOverview;
    // The overview carries the authoritative config, so the editor and the
    // dashboard can never disagree about what's currently in scope.
    set({ affiliates: normalizeAffiliateConfig(overview.config) });
    return overview;
  },

  async syncAffiliates(prune = false) {
    const res = await backendFetch(`/admin/affiliates/sync${prune ? "?prune=1" : ""}`, { method: "POST" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Sync failed.");
    return (await res.json()) as AffiliateSyncStatus;
  },

  async loadReferralStats(from, to) {
    const params = new URLSearchParams();
    if (from != null) params.set("from", String(from));
    if (to != null) params.set("to", String(to));
    const qs = params.toString();
    const res = await backendFetch(`/admin/referrals/stats${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load referral stats.");
    return (await res.json()) as ReferralStatsSummary;
  },

  async resolveHeldReward(rewardId, verdict) {
    const res = await backendFetch(`/admin/referrals/rewards/${encodeURIComponent(rewardId)}/${verdict}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verdict === "decline" ? { reason: "declined from Referrals tab" } : {}),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not update this reward.");
    const json = (await res.json()) as { ok?: boolean; outcome?: string };
    // A release can come straight back as held — the reason it couldn't be
    // delivered (a cancelled membership) is on the reward for the next look.
    if (json.ok === false) {
      throw new Error(
        json.outcome === "held"
          ? "Still can't be delivered — check the note on the reward."
          : "Could not release this reward.",
      );
    }
  },

  async voidUnacceptedInvitations(reason) {
    const res = await backendFetch("/admin/referrals/void-unaccepted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? "voided by admin" }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not void invitations.");
    const json = (await res.json()) as { voided?: number };
    return json.voided ?? 0;
  },

  async saveSeoConfig(config) {
    set({ seo: normalizeSeoConfig(await putJson("/admin/config/seo", config)) });
  },

  async savePrompts(config) {
    set({ prompts: normalizePromptsConfig(await putJson("/admin/config/prompts", config)) });
  },

  async loadEmailConfig() {
    const res = await backendFetch("/admin/config/email");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load email settings.");
    const json = (await res.json()) as { config?: unknown; configured?: boolean };
    const config = normalizeEmailConfig(json.config);
    set({ emailConfig: config });
    return { config, configured: Boolean(json.configured) };
  },

  async saveEmailConfig(config) {
    set({ emailConfig: normalizeEmailConfig(await putJson("/admin/config/email", config)) });
  },

  async sendTestEmail(templateId, to) {
    const res = await backendFetch("/admin/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, to }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Test send failed.");
  },

  async saveSlackConfig(config) {
    set({ slackConfig: normalizeSlackConfig(await putJson("/admin/config/slack", config)) });
  },

  async sendTestSlack(channel) {
    const res = await backendFetch("/admin/slack/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Slack test failed.");
  },

  async saveLegal(config) {
    set({ legal: normalizeLegalConfig(await putJson("/admin/config/legal", config)) });
  },

  async notifyPolicyUpdate(role) {
    const res = await backendFetch("/admin/legal/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not send notifications.");
    const json = (await res.json()) as { recipients: number; sent: number };
    return { recipients: json.recipients, sent: json.sent };
  },

  async saveCookieConfig(config) {
    set({ cookieConfig: normalizeCookieConfig(await putJson("/admin/config/cookies", config)) });
  },

  async saveAnnouncementsConfig(config) {
    set({ announcements: normalizeAnnouncementsConfig(await putJson("/admin/config/announcements", config)) });
  },

  async sendTestContact() {
    const res = await backendFetch("/admin/contact/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Contact test failed.");
  },

  async loadAdminPlans() {
    const res = await backendFetch("/admin/config/plans");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load plans.");
    return (await res.json()) as PlansConfig;
  },

  async savePlan(plan) {
    const res = await backendFetch("/admin/config/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not save plan.");
    return (await res.json()) as PlanDefinition;
  },

  async savePlansConfig(config) {
    return (await putJson("/admin/config/plans", config)) as PlansConfig;
  },

  async deletePlanById(id) {
    const res = await backendFetch(`/admin/config/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete plan.");
    return (await res.json()) as PlansConfig;
  },

  async syncPlans(env) {
    const res = await backendFetch("/admin/config/plans/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(env ? { env } : {}),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not sync plans.");
    return (await res.json()) as PlansConfig;
  },

  async loadActionCosts({ from, to, granularity }) {
    const qs = new URLSearchParams({
      from: String(Math.round(from)),
      to: String(Math.round(to)),
      granularity,
    });
    const res = await backendFetch(`/admin/analytics/action-costs?${qs.toString()}`);
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load cost report.");
    return (await res.json()) as ActionCostReport;
  },

  async uploadArtStyleImage(styleId, base64, mimeType) {
    const res = await backendFetch(`/admin/art-styles/${encodeURIComponent(styleId)}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
  },

  async uploadLayoutImage(layoutId, base64, mimeType, meta) {
    const res = await backendFetch(`/admin/layouts/${encodeURIComponent(layoutId)}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType, ...meta }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
  },

  async uploadSiteImage(slot, base64, mimeType, alt) {
    const res = await backendFetch("/admin/site-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, base64, mimeType, alt }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
    set({ siteImages: normalizeSiteImagesConfig(await res.json()) });
  },

  async removeSiteImage(slot) {
    const res = await backendFetch(`/admin/site-image/${encodeURIComponent(slot)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not remove image.");
    set({ siteImages: normalizeSiteImagesConfig(await res.json()) });
  },

  async restoreSiteImage(slot, storagePath) {
    const res = await backendFetch("/admin/site-image/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not restore version.");
    set({ siteImages: normalizeSiteImagesConfig(await res.json()) });
  },

  async deleteSiteImageVersion(slot, storagePath) {
    const res = await backendFetch("/admin/site-image/version/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete version.");
    set({ siteImages: normalizeSiteImagesConfig(await res.json()) });
  },

  async uploadCatalogPhoto(key, base64, mimeType, alt, caption) {
    const res = await backendFetch("/admin/catalog/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, base64, mimeType, alt, caption }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
    set({ catalogMedia: normalizeCatalogMediaConfig(await res.json()) });
  },

  async patchCatalogPhoto(key, storagePath, patch) {
    const res = await backendFetch("/admin/catalog/media/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, storagePath, ...patch }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not update the picture.");
    set({ catalogMedia: normalizeCatalogMediaConfig(await res.json()) });
  },

  async deleteCatalogPhoto(key, storagePath) {
    const res = await backendFetch("/admin/catalog/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete the picture.");
    set({ catalogMedia: normalizeCatalogMediaConfig(await res.json()) });
  },

  async saveSiteText(slot, value) {
    const res = await backendFetch("/admin/site-content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, value }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not save text.");
    set({ siteContent: normalizeSiteContentConfig(await res.json()) });
  },

  async resetSiteText(slot) {
    const res = await backendFetch(`/admin/site-content/${encodeURIComponent(slot)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not reset text.");
    set({ siteContent: normalizeSiteContentConfig(await res.json()) });
  },

  async saveBrandingInfo(patch) {
    const res = await backendFetch("/admin/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not save branding.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async uploadBrandingAsset(slot, base64, mimeType, alt) {
    const res = await backendFetch("/admin/branding/asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, base64, mimeType, alt }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async removeBrandingAsset(slot) {
    const res = await backendFetch(`/admin/branding/asset/${encodeURIComponent(slot)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not remove asset.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async restoreBrandingAsset(slot, storagePath) {
    const res = await backendFetch("/admin/branding/asset/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not restore version.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async deleteBrandingAssetVersion(slot, storagePath) {
    const res = await backendFetch("/admin/branding/asset/version/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete version.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async uploadWatermark(base64, mimeType, opacity, scale) {
    const res = await backendFetch("/admin/branding/watermark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType, opacity, scale }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async updateWatermarkAppearance(patch) {
    const res = await backendFetch("/admin/branding/watermark", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Update failed.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async removeWatermark() {
    const res = await backendFetch("/admin/branding/watermark", { method: "DELETE" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not remove watermark.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async restoreWatermark(storagePath) {
    const res = await backendFetch("/admin/branding/watermark/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not restore watermark.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async deleteWatermarkVersion(storagePath) {
    const res = await backendFetch("/admin/branding/watermark/version/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete version.");
    set({ branding: normalizeBrandingConfig(await res.json()) });
  },

  async createQrCode(input) {
    const res = await backendFetch("/admin/qrcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not create the QR code.");
    const qrCodes = normalizeQrCodesConfig(await res.json());
    set({ qrCodes });
    const created = qrCodes.codes[qrCodes.codes.length - 1];
    if (!created) throw new Error("The QR code was saved but could not be found.");
    return created;
  },

  async updateQrCode(id, input) {
    const res = await backendFetch(`/admin/qrcodes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not update the QR code.");
    const qrCodes = normalizeQrCodesConfig(await res.json());
    set({ qrCodes });
    const updated = findQrCode(qrCodes, id);
    if (!updated) throw new Error("The QR code was saved but could not be found.");
    return updated;
  },

  async deleteQrCode(id) {
    const res = await backendFetch(`/admin/qrcodes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete the QR code.");
    set({ qrCodes: normalizeQrCodesConfig(await res.json()) });
  },

  async restoreQrCodeVersion(id, storagePath) {
    const res = await backendFetch(`/admin/qrcodes/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not restore that version.");
    set({ qrCodes: normalizeQrCodesConfig(await res.json()) });
  },

  async deleteQrCodeVersion(id, storagePath) {
    const res = await backendFetch(`/admin/qrcodes/${encodeURIComponent(id)}/version/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete that version.");
    set({ qrCodes: normalizeQrCodesConfig(await res.json()) });
  },

  async previewQrCode(input) {
    const res = await backendFetch("/admin/qrcodes/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not render a preview.");
    return (await res.json()) as { contentType: string; base64: string };
  },

  async loadAdminPosts() {
    const res = await backendFetch("/admin/blog");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load posts.");
    const json = (await res.json()) as { posts: BlogPost[] };
    return json.posts;
  },

  async savePost(post, originalSlug) {
    const res = await backendFetch("/admin/blog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...post, originalSlug }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not save post.");
    return (await res.json()) as { post: BlogPost; index: BlogIndex };
  },

  async deletePost(slug) {
    const res = await backendFetch(`/admin/blog/${encodeURIComponent(slug)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete post.");
    const json = (await res.json()) as { index: BlogIndex };
    return json.index;
  },

  async seedPosts() {
    const res = await backendFetch("/admin/blog/seed", { method: "POST" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not seed posts.");
    return (await res.json()) as { added: number; index: BlogIndex };
  },

  async uploadPostImage(slug, base64, mimeType, alt) {
    const res = await backendFetch(`/admin/blog/${encodeURIComponent(slug)}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType, alt }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
    return (await res.json()) as BlogImage;
  },

  async loadBlogStats(slug) {
    const res = await backendFetch(`/admin/blog/${encodeURIComponent(slug)}/stats`);
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load stats.");
    return (await res.json()) as BlogStats;
  },

  async loadAllBlogStats() {
    const res = await backendFetch("/admin/blog/stats");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load stats.");
    const json = (await res.json()) as { stats: BlogStatsListItem[] };
    return json.stats;
  },

  async suggestCost(provider, modelId, modality) {
    const res = await backendFetch("/admin/suggest-cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, modelId, modality }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Suggestion failed.");
    return (await res.json()) as CostSuggestionResult;
  },

  async suggestCosts(targets) {
    const res = await backendFetch("/admin/suggest-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: targets }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Suggestion failed.");
    const json = (await res.json()) as { results: CostSuggestionResult[] };
    return json.results;
  },

  async loadAdminProducts() {
    const res = await backendFetch("/admin/config/products");
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not load products.");
    return (await res.json()) as ProductsConfig;
  },

  async saveProduct(product) {
    const res = await backendFetch("/admin/config/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not save product.");
    return (await res.json()) as ProductDefinition;
  },

  async deleteProductById(id) {
    const res = await backendFetch(`/admin/config/products/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not delete product.");
    return (await res.json()) as ProductsConfig;
  },

  async seedProducts() {
    const res = await backendFetch("/admin/config/products/seed", { method: "POST" });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Could not seed products.");
    return (await res.json()) as ProductsConfig;
  },

  async previewMargin(product, scenario) {
    const res = await backendFetch("/admin/config/products/margin-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, scenario }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Margin preview failed.");
    return (await res.json()) as MarginPreview;
  },

  async calibrateProductCost(id, env) {
    const res = await backendFetch(`/admin/config/products/${encodeURIComponent(id)}/calibrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(env ? { env } : {}),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Calibration failed.");
    return (await res.json()) as CalibrationOutcome;
  },

  async checkSku(sku, opts) {
    const res = await backendFetch("/admin/print/sku/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, ...opts }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "SKU check failed.");
    return (await res.json()) as SkuCheck;
  },

  async verifyProducts(opts) {
    const res = await backendFetch("/admin/config/products/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Verification failed.");
    return (await res.json()) as SkuVerifySummary;
  },
}));
