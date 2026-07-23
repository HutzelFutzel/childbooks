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
  createDefaultAgeWritingConfig,
  normalizeAgeWritingConfig,
  type AgeWritingConfig,
} from "../core/config/ageWriting";
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
  type ProductImage,
  type ProductsConfig,
  type PublicProductsConfig,
} from "../core/config/products";
import type { MarginBreakdown } from "../core/config/productMath";
import {
  createDefaultSparksConfig,
  normalizeSparksConfig,
  type SparksConfig,
} from "../core/config/sparks";
import {
  normalizePublicPlansConfig,
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
import type { SlackChannel } from "../core/notify/registry";
import type { EmailTemplateId } from "../core/email/types";
import type { ActionCostReport, CostGranularity } from "../core/analytics/types";

/** Result of a live margin preview (server fetches a provider quote when able). */
export interface MarginPreview {
  breakdown: MarginBreakdown;
  live: boolean;
  quoteError?: string;
}

interface AppConfigState {
  modelConfig: ModelConfig;
  artStyles: ArtStylesConfig;
  ageWriting: AgeWritingConfig;
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
  /** Public subscription plans (storefront-facing; no Stripe internals). */
  plans: PublicPlansConfig;
  /** Global branding (the share watermark asset + appearance). */
  branding: BrandingConfig;
  /** Marketing SEO config (landing-page metadata + structured data). */
  seo: SeoConfig;
  /** Landing-page illustrations (inline drag-&-drop editor). */
  siteImages: SiteImagesConfig;
  /** Landing-page copy overrides (inline text editor). */
  siteContent: SiteContentConfig;
  /** Admin-editable LLM prompt templates. */
  prompts: PromptsConfig;
  /** System + marketing email config (senders, toggles, footer). */
  emailConfig: EmailConfig;
  /** Aggregate email delivery statistics (sent/delivered/opened/bounced…). */
  emailStats: EmailStats;
  /** Per-message Slack notification toggles. */
  slackConfig: SlackConfig;
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
  saveAgeWriting: (config: AgeWritingConfig) => Promise<void>;
  saveTypography: (config: TypographyConfig) => Promise<void>;
  saveModelCosts: (table: ModelCostTable) => Promise<void>;
  savePricingSettings: (settings: PricingSettings) => Promise<void>;
  saveSparksConfig: (config: SparksConfig) => Promise<void>;
  saveSeoConfig: (config: SeoConfig) => Promise<void>;
  savePrompts: (config: PromptsConfig) => Promise<void>;
  saveEmailConfig: (config: EmailConfig) => Promise<void>;
  /** Send a template with its sample vars to a test recipient (admin by default). */
  sendTestEmail: (templateId: EmailTemplateId, to?: string) => Promise<void>;
  saveSlackConfig: (config: SlackConfig) => Promise<void>;
  /** Post a real test notification to a Slack channel to verify the webhook. */
  sendTestSlack: (channel: SlackChannel) => Promise<void>;
  uploadArtStyleImage: (styleId: string, base64: string, mimeType: string) => Promise<void>;

  // Landing-page inline editing (admin, gated in the UI; enforced server-side).
  uploadSiteImage: (slot: SiteImageSlot, base64: string, mimeType: string, alt?: string) => Promise<void>;
  removeSiteImage: (slot: SiteImageSlot) => Promise<void>;
  restoreSiteImage: (slot: SiteImageSlot, storagePath: string) => Promise<void>;
  deleteSiteImageVersion: (slot: SiteImageSlot, storagePath: string) => Promise<void>;
  saveSiteText: (slot: SiteTextSlot, value: string) => Promise<void>;
  resetSiteText: (slot: SiteTextSlot) => Promise<void>;

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

  // Subscription plans (admin). The PUBLIC projection lives in `plans`; the full
  // config (incl. Stripe ids) is fetched on demand from the backend.
  loadAdminPlans: () => Promise<PlansConfig>;
  savePlan: (plan: PlanDefinition) => Promise<PlanDefinition>;
  savePlansConfig: (config: PlansConfig) => Promise<PlansConfig>;
  deletePlanById: (id: string) => Promise<PlansConfig>;
  syncPlans: () => Promise<PlansConfig>;

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
  uploadProductImage: (
    productId: string,
    base64: string,
    mimeType: string,
    role: ProductImage["role"],
    alt?: string,
  ) => Promise<ProductImage>;
  previewMargin: (
    product: ProductDefinition,
    scenario: { pages: number; copies: number; currency: string; country?: string; region?: string },
  ) => Promise<MarginPreview>;

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
  ageWriting: createDefaultAgeWritingConfig(),
  typography: createDefaultTypographyConfig(),
  modelCosts: createDefaultModelCostTable(),
  adminModelCosts: createDefaultModelCostTable(),
  imageCostStats: createDefaultImageCostStats(),
  latencyStats: createDefaultLatencyStats(),
  products: { version: 1, products: [] },
  pricingSettings: createDefaultPricingSettings(),
  sparks: createDefaultSparksConfig(),
  plans: { version: 1, plans: [] },
  branding: createDefaultBrandingConfig(),
  seo: createDefaultSeoConfig(),
  siteImages: createDefaultSiteImagesConfig(),
  siteContent: createDefaultSiteContentConfig(),
  prompts: createDefaultPromptsConfig(),
  emailConfig: createDefaultEmailConfig(),
  emailStats: createDefaultEmailStats(),
  slackConfig: createDefaultSlackConfig(),
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
      onSnapshot(doc(db, "appConfig", "ageWriting"), (snap) => {
        set({ ageWriting: normalizeAgeWritingConfig(snap.exists() ? snap.data() : undefined) });
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
        set({ sparks: normalizeSparksConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "plans"), (snap) => {
        set({ plans: normalizePublicPlansConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "branding"), (snap) => {
        set({ branding: normalizeBrandingConfig(snap.exists() ? snap.data() : undefined) });
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
      onSnapshot(doc(db, "appConfig", "prompts"), (snap) => {
        set({ prompts: normalizePromptsConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "emailConfig"), (snap) => {
        set({ emailConfig: normalizeEmailConfig(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "emailStats"), (snap) => {
        set({ emailStats: normalizeEmailStats(snap.exists() ? snap.data() : undefined) });
      }),
      onSnapshot(doc(db, "appConfig", "slackConfig"), (snap) => {
        set({ slackConfig: normalizeSlackConfig(snap.exists() ? snap.data() : undefined) });
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

  async saveAgeWriting(config) {
    await putJson("/admin/config/age-writing", config);
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

  async saveSeoConfig(config) {
    set({ seo: normalizeSeoConfig(await putJson("/admin/config/seo", config)) });
  },

  async savePrompts(config) {
    set({ prompts: normalizePromptsConfig(await putJson("/admin/config/prompts", config)) });
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

  async syncPlans() {
    const res = await backendFetch("/admin/config/plans/sync", { method: "POST" });
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

  async uploadProductImage(productId, base64, mimeType, role, alt) {
    const res = await backendFetch(`/admin/config/products/${encodeURIComponent(productId)}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType, role, alt }),
    });
    if (!res.ok) throw new Error((await safeError(res)) ?? "Upload failed.");
    return (await res.json()) as ProductImage;
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
}));
