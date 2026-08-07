/**
 * Admin configuration endpoints. Mounted under `/admin`, which `app.ts` guards
 * with `requireVerified` + `requireAdmin`, so every handler here can assume an
 * authenticated admin caller. All global config writes go through these routes
 * (clients never write the config docs directly — the rules deny it).
 */
import express, { type Express, type Request, type Response } from "express";
import sharp from "sharp";
import { ZodError } from "zod";
import type { AuthedRequest } from "./auth";
import {
  getArtStylesConfig,
  getBrandingConfig,
  getModelConfig,
  getModelCostTable,
  getPricingSettings,
  getSeoConfig,
  getSparksConfig,
  getReferralConfig,
  saveReferralConfig,
  getAffiliateConfig,
  saveAffiliateConfig,
  getEmailConfig,
  saveEmailConfig,
  getSlackConfig,
  saveSlackConfig,
  getLegalConfig,
  saveLegalConfig,
  getCookieConfig,
  saveCookieConfig,
  getAnnouncementsConfig,
  saveAnnouncementsConfig,
  getCampaignsConfig,
  saveCampaignsConfig,
  getSurveysConfig,
  saveSurveysConfig,
  deleteBrandingAssetVersion,
  deleteWatermarkVersion,
  restoreBrandingAsset,
  restoreWatermark,
  saveArtStylesConfig,
  saveLayoutsConfig,
  addLayoutExample,
  removeLayoutExample,
  saveAgeWritingConfig,
  saveStoryCraftConfig,
  saveTypographyConfig,
  saveBrandingInfo,
  saveModelConfig,
  saveModelCostTable,
  savePricingSettings,
  saveSeoConfig,
  saveSparksConfig,
  savePromptsConfig,
  setArtStyleExample,
  setBrandingAsset,
  setBrandingWatermark,
  getQrCodesConfig,
  saveQrCode,
  deleteQrCode,
  restoreQrCodeVersion,
  deleteQrCodeVersion,
  previewQrCode,
  type QrCodeSaveInput,
  type QrLogoInput,
  getSiteImagesConfig,
  getSiteContentConfig,
  setSiteImage,
  restoreSiteImage,
  deleteSiteImageVersion,
  setSiteText,
  isKnownTextSlot,
  getCatalogMediaConfig,
  addCatalogPhoto,
  patchCatalogPhoto,
  removeCatalogPhoto,
} from "./appConfig";
import { deletePlan, getPlansConfig, savePlansConfig, syncAllPlansToStripe, upsertPlan } from "./plans";
import {
  blockInvitation,
  referralStatsSummary,
  releaseReward,
  voidHeldReward,
  voidUnacceptedInvitations,
} from "./referrals";
import {
  campaignReport,
  listRedemptionsByStatus,
  releaseRedemption,
  simulateCampaign,
  voidRedemption,
} from "./campaigns";
import { surveyReport, surveyReports } from "./surveys/report";
import {
  normalizeCampaignsConfig,
  type CampaignTrigger,
  type HeldRedemptionView,
} from "../../books-frontend/src/core/config/campaigns";
import type { DiscountItemType } from "../../books-frontend/src/core/config/discountImpact";
import type { BillingEnv } from "../../books-frontend/src/core/config/plans";
import {
  deletePublicObject,
  uploadArtStyleImage,
  uploadLayoutImage,
  uploadBrandingAsset,
  uploadBrandingWatermark,
  uploadCatalogPhoto,
  uploadSiteImage,
} from "./storage";
import {
  isCatalogMediaKey,
  parseCatalogMediaKey,
} from "../../books-frontend/src/core/config/catalogMedia";
import {
  BRAND_ASSET_SLOTS,
  type BrandAsset,
  type BrandAssetSlot,
} from "../../books-frontend/src/core/config/branding";
import {
  isSiteImageSlot,
  type SiteImageSlot,
} from "../../books-frontend/src/core/config/siteImages";
import {
  QR_CORNER_STYLES,
  QR_DOT_STYLES,
  type QrCornerStyle,
  type QrDotStyle,
} from "../../books-frontend/src/core/config/qrCodes";
import {
  deleteProduct,
  getProductsConfig,
  reprojectPublicProducts,
  saveProductsConfig,
  seedProducts,
  upsertProduct,
} from "./products";
import { fetchLiveCost, productionCostSource } from "./printCost";
import { verifyCatalog } from "./printVerify";
import { calibrateAndSave, calibrateCatalog } from "./printCalibrate";
import { checkSku, readSkuMatrix } from "./printSkuMatrix";
import { serverConfig } from "./config";
import type { FulfillmentEnv } from "../../books-frontend/src/core/settings";
import { computeMargin } from "../../books-frontend/src/core/config/productMath";
import { isVariantSelection } from "../../books-frontend/src/core/config/variants";
import { skuForVariant } from "../../books-frontend/src/core/fulfillment/lulu/skuAxes";
import type { ProductDefinition } from "../../books-frontend/src/core/config/products";
import { apiKeyFor, resolveSuggestionModel } from "./modelResolve";
import { recordUsage, withUsage } from "./usage";
import { getTextProvider } from "../../books-frontend/src/core/providers";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import {
  batchCostSuggestionSchema,
  suggestionToModelCost,
  type CostSuggestionResult,
  type RawBatchCostItem,
} from "../../books-frontend/src/core/config/costSuggestion";
import { getAuth } from "firebase-admin/auth";
import { recipientForUid, sendTemplatedEmail } from "./email/service";
import { emailConfigured } from "./email/sender";
import { legalLinkByRole, type LegalRole } from "../../books-frontend/src/core/config/legal";
import { isKnownLayoutId } from "../../books-frontend/src/core/book/layouts";
import {
  EMAIL_TEMPLATE_REGISTRY,
} from "../../books-frontend/src/core/email/registry";
import { isEmailTemplateId } from "../../books-frontend/src/core/email/types";
import { notifySlack } from "./notify";
import {
  SLACK_MESSAGE_REGISTRY,
  type SlackChannel,
} from "../../books-frontend/src/core/notify/registry";

/** Official pricing pages. Overridable via env so a page move needs no code change. */
const PRICING_URLS: Record<ProviderId, string> = {
  google: process.env.GOOGLE_PRICING_URL || "https://ai.google.dev/gemini-api/docs/pricing",
  openai: process.env.OPENAI_PRICING_URL || "https://developers.openai.com/api/docs/pricing",
};

// Pricing pages change rarely. Cache per warm instance so repeated suggestions
// (per-row and bulk) don't re-download the same multi-hundred-KB page.
const PAGE_TTL_MS = 10 * 60 * 1000;
const pageCache = new Map<string, { text: string; expires: number }>();

async function fetchPricingPage(url: string): Promise<string> {
  const hit = pageCache.get(url);
  if (hit && hit.expires > Date.now()) return hit.text;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "childbooks-admin cost-suggester" },
    });
    if (!res.ok) throw new Error(`Pricing page returned ${res.status}.`);
    const text = await res.text();
    pageCache.set(url, { text, expires: Date.now() + PAGE_TTL_MS });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collect windows around every occurrence of every requested id, merge
 * overlapping ranges (so shared table context isn't duplicated), and cap the
 * total — keeps one batch prompt small even for many models.
 */
function focusExcerptMany(text: string, needles: string[], radius = 1200, maxTotal = 60000): string {
  const lc = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const needle of needles) {
    const n = needle.toLowerCase().trim();
    if (!n) continue;
    let idx = lc.indexOf(n);
    while (idx !== -1) {
      ranges.push([Math.max(0, idx - radius), Math.min(text.length, idx + needle.length + radius)]);
      idx = lc.indexOf(n, idx + 1);
    }
  }
  if (ranges.length === 0) return text.slice(0, maxTotal);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const parts: string[] = [];
  let total = 0;
  for (const [start, end] of merged) {
    if (total >= maxTotal) break;
    const clipped = Math.min(end, start + (maxTotal - total));
    parts.push(text.slice(start, clipped));
    total += clipped - start;
  }
  return parts.join("\n…\n");
}

/**
 * Extract costs for a set of model ids from one provider in a SINGLE LLM call.
 * Returns one result per requested id (found=false when absent) plus the metered
 * usage events for the caller to record.
 */
async function extractCostsForProvider(
  provider: ProviderId,
  ids: string[],
): Promise<{ results: CostSuggestionResult[]; events: Awaited<ReturnType<typeof withUsage>>["events"] }> {
  const page = await fetchPricingPage(PRICING_URLS[provider]);
  const excerpt = focusExcerptMany(page, ids);
  const model = await resolveSuggestionModel();

  const columnHint =
    provider === "openai"
      ? "OpenAI pricing tables appear in the page source as arrays with column order [modelId, inputPer1M, cachedInputPer1M, outputPer1M]; a missing/empty cached value means 0."
      : "Gemini pricing is shown as labeled tables (Input price, Output price, Context caching), sometimes split by modality and by prompt size (≤200k vs >200k tokens).";
  const sys =
    "You extract official API pricing into a strict schema. Use ONLY the provided excerpt — never prior knowledge. " +
    "Return exactly one entry in `models` for EACH requested id, in the same order, echoing it in `requestedModelId`. " +
    "Rates are USD; token rates are per 1,000,000 tokens. Use the STANDARD service tier (ignore Batch/Flex/Priority). " +
    "Use 0 for any field that does not apply. For text models set kind=text. For image-generation models set kind=image and pick the output billing: " +
    "perMillionTokens when output is billed per 1M image tokens (e.g. Gemini image output), perImage for a flat per-image price, or perImageBySize when it depends on output resolution. " +
    "If a model charges higher rates above an input-token threshold (e.g. > 200k tokens), set text.largePrompt.enabled=true with that threshold and the higher rates. " +
    "Matching rules: prefer an EXACT id match (found=true, approximate=false). " +
    "If the exact id is absent but the SAME model appears under a close variant — differing only by a `-preview`/`-latest`/`-exp` suffix, a trailing date or version number (e.g. `-001`, `-2024-xx`), or being the base family of a size/tier suffix — use that variant's rates and set found=true, approximate=true, canonicalModelId=the variant id you used, and explain the substitution in notes. " +
    "Do NOT substitute across clearly different models or size tiers (e.g. do not price a `-mini` from the full model, or vice versa). " +
    "Only set found=false (approximate=false) when no exact id and no close same-model variant exists in the excerpt. " +
    "Always put the verbatim line(s) you used in sourceQuote.";
  const user = `Provider: ${provider}\n${columnHint}\n\nRequested model ids:\n${ids
    .map((id) => `- ${id}`)
    .join("\n")}\n\nPricing excerpt:\n${excerpt}`;

  const { value, events } = await withUsage(() =>
    getTextProvider(model.provider).generateStructured(
      { apiKey: apiKeyFor(model.provider) },
      {
        model: model.id,
        temperature: 0,
        schema: batchCostSuggestionSchema,
        schemaName: "ModelCostSuggestions",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      },
    ),
  );

  // Index extracted rows by requested id (fall back to canonical id) so we can
  // return results in the caller's requested order, regardless of LLM ordering.
  const byId = new Map<string, RawBatchCostItem>();
  for (const m of value.models) {
    if (m.requestedModelId) byId.set(m.requestedModelId.trim(), m);
    if (m.canonicalModelId) byId.set(m.canonicalModelId.trim(), m);
  }

  const results: CostSuggestionResult[] = ids.map((id) => {
    const raw = byId.get(id);
    if (!raw || !raw.found) {
      return {
        provider,
        requestedModelId: id,
        found: false,
        approximate: false,
        modelCost: null,
        canonicalModelId: raw?.canonicalModelId ?? "",
        sourceQuote: raw?.sourceQuote ?? "",
        notes: raw?.notes ?? "",
      };
    }
    return {
      provider,
      requestedModelId: id,
      found: true,
      approximate: raw.approximate === true,
      modelCost: suggestionToModelCost(raw),
      canonicalModelId: raw.canonicalModelId,
      sourceQuote: raw.sourceQuote,
      notes: raw.notes,
    };
  });

  return { results, events };
}

/** The provider environment currently being served (runtime override aware). */
function activeEnv(): FulfillmentEnv {
  return serverConfig().fulfillment.lulu.env;
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: "Invalid configuration.", issues: err.issues } });
    return;
  }
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

/**
 * Refresh the public product projection after a plan changes.
 *
 * The projection publishes each plan's print discount already clamped to
 * break-even, so a plan edit that nothing re-projected would leave the storefront
 * quoting the old perk. Done here rather than inside `savePlansConfig` so the
 * plans module doesn't have to import the products module (and vice versa).
 *
 * Best-effort: the plan itself is already saved, and failing the request would
 * report a successful edit as an error. The next product save or settings change
 * re-projects anyway.
 */
async function refreshProductsForPlans(): Promise<void> {
  try {
    await reprojectPublicProducts();
  } catch (err) {
    console.error("[admin] plan saved but the public product projection is stale:", err);
  }
}

export function registerAdminRoutes(app: Express): void {
  const json = express.json({ limit: "25mb" });

  app.get("/admin/me", (_req, res) => {
    res.json({ admin: true });
  });

  // Snapshot of all config (the client normally reads these live from Firestore,
  // but this is handy for tooling / first paint).
  app.get("/admin/config", async (_req, res) => {
    try {
      const [models, artStyles, modelCosts] = await Promise.all([
        getModelConfig(),
        getArtStylesConfig(),
        getModelCostTable(),
      ]);
      res.json({ models, artStyles, modelCosts });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/models", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveModelConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/art-styles", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveArtStylesConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/layouts", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveLayoutsConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/age-writing", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveAgeWritingConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/story-craft", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveStoryCraftConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/typography", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveTypographyConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/prompts", json, async (req: Request, res: Response) => {
    try {
      res.json(await savePromptsConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/model-costs", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveModelCostTable(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Suggest a single model's cost by reading the provider's official pricing page
  // with a cheap text model. Returns a suggestion to review — never saves.
  app.post("/admin/suggest-cost", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { provider, modelId } = (req.body ?? {}) as { provider?: string; modelId?: string };
      if ((provider !== "openai" && provider !== "google") || !modelId?.trim()) {
        res.status(400).json({ error: { message: "provider and modelId are required." } });
        return;
      }
      const { results, events } = await extractCostsForProvider(provider as ProviderId, [modelId.trim()]);
      await recordUsage(req.uid!, "costSuggestion", events);
      res.json(results[0]);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Batch variant: suggest costs for many models at once. Models are grouped by
  // provider so each provider needs only ONE page fetch + ONE LLM call, and the
  // providers run in parallel. Body: { items: [{ provider, modelId }] }.
  app.post("/admin/suggest-costs", json, async (req: AuthedRequest, res: Response) => {
    try {
      const raw = (req.body?.items ?? []) as Array<{ provider?: string; modelId?: string }>;
      const byProvider: Record<string, string[]> = {};
      const seen = new Set<string>();
      for (const item of raw) {
        if ((item.provider !== "openai" && item.provider !== "google") || !item.modelId?.trim()) continue;
        const id = item.modelId.trim();
        const k = `${item.provider}:${id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        (byProvider[item.provider] ??= []).push(id);
      }
      const groups = Object.entries(byProvider) as Array<[ProviderId, string[]]>;
      if (groups.length === 0) {
        res.status(400).json({ error: { message: "items must include at least one {provider, modelId}." } });
        return;
      }

      // One provider failing (e.g. a docs 503) shouldn't sink the rest — degrade
      // those ids to found=false with the error as a note.
      const perProvider = await Promise.all(
        groups.map(async ([provider, ids]) => {
          try {
            const { results, events } = await extractCostsForProvider(provider, ids);
            await recordUsage(req.uid!, "costSuggestion", events);
            return results;
          } catch (err) {
            const message = err instanceof Error ? err.message : "Suggestion failed.";
            return ids.map<CostSuggestionResult>((id) => ({
              provider,
              requestedModelId: id,
              found: false,
              approximate: false,
              modelCost: null,
              canonicalModelId: "",
              sourceQuote: "",
              notes: message,
            }));
          }
        }),
      );

      res.json({ results: perProvider.flat() });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload (replace) an art-style example image. Body: { base64, mimeType }.
  app.post("/admin/art-styles/:styleId/image", json, async (req: Request, res: Response) => {
    try {
      const styleId = String(req.params.styleId);
      const { base64, mimeType } = (req.body ?? {}) as { base64?: string; mimeType?: string };
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      // Remove the previous image for this style, if any.
      const current = await getArtStylesConfig();
      const prev = current.examples[styleId];
      if (prev?.storagePath) await deletePublicObject(prev.storagePath);

      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadArtStyleImage(styleId, buf, mimeType);
      const config = await setArtStyleExample(styleId, {
        imageUrl: publicUrl,
        storagePath,
        updatedAt: Date.now(),
      });
      res.json(config);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Page layouts --------------------------------------------------------

  // Add a showcase image for a layout. Body: { base64, mimeType, shape?, side?, alt? }.
  app.post("/admin/layouts/:layoutId/image", json, async (req: Request, res: Response) => {
    try {
      const layoutId = String(req.params.layoutId);
      if (!isKnownLayoutId(layoutId)) {
        res.status(400).json({ error: { message: `Unknown layout "${layoutId}".` } });
        return;
      }
      const { base64, mimeType, shape, side, alt } = (req.body ?? {}) as {
        base64?: string;
        mimeType?: string;
        shape?: string;
        side?: string;
        alt?: string;
      };
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadLayoutImage(layoutId, buf, mimeType);
      const config = await addLayoutExample(layoutId, {
        imageUrl: publicUrl,
        storagePath,
        updatedAt: Date.now(),
        ...(shape === "square" || shape === "landscape" || shape === "portrait" ? { shape } : {}),
        ...(side === "left" || side === "right" || side === "spread" ? { side } : {}),
        ...(alt ? { alt: alt.slice(0, 300) } : {}),
      });
      res.json(config);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/layouts/:layoutId/image", json, async (req: Request, res: Response) => {
    try {
      const layoutId = String(req.params.layoutId);
      const storagePath = String((req.body ?? {}).storagePath ?? "");
      if (!storagePath) {
        res.status(400).json({ error: { message: "storagePath is required." } });
        return;
      }
      await deletePublicObject(storagePath);
      res.json(await removeLayoutExample(layoutId, storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Branding (share watermark) ------------------------------------------

  app.get("/admin/branding", async (_req: Request, res: Response) => {
    try {
      res.json(await getBrandingConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Save brand identity (name / tagline / colors). Assets are preserved.
  app.put("/admin/branding", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveBrandingInfo(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload (replace) a single brand image asset.
  // Body: { slot, base64, mimeType, alt? } where slot is any of BRAND_ASSET_SLOTS
  // (logo/icon/favicon/social image, the default covers, and the permanent
  // backcover logo — see `core/config/branding.ts`).
  app.post("/admin/branding/asset", json, async (req: Request, res: Response) => {
    try {
      const { slot, base64, mimeType, alt } = (req.body ?? {}) as {
        slot?: string;
        base64?: string;
        mimeType?: string;
        alt?: string;
      };
      if (!slot || !BRAND_ASSET_SLOTS.includes(slot as BrandAssetSlot)) {
        res.status(400).json({ error: { message: "A valid asset slot is required." } });
        return;
      }
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      // The previous asset is NOT deleted — it moves into the slot's version
      // history (see setBrandingAsset) so it can be restored later.
      const current = await getBrandingConfig();
      const existing = current[slot as BrandAssetSlot];
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadBrandingAsset(slot, buf, mimeType);
      const asset: BrandAsset = { imageUrl: publicUrl, storagePath, updatedAt: Date.now() };
      const nextAlt = typeof alt === "string" ? alt : existing?.alt;
      if (typeof nextAlt === "string") asset.alt = nextAlt;
      // Persist the file's own height÷width so the studio's backcover-logo print
      // guide (and anything else that needs the true shape) doesn't have to
      // re-download the image just to measure it.
      try {
        const meta = await sharp(buf).metadata();
        if (meta.width && meta.height && meta.width > 0) {
          asset.aspect = meta.height / meta.width;
        }
      } catch {
        // SVGs and odd formats sometimes can't be measured — the guide falls
        // back to a default wide shape in that case.
      }
      res.json(await setBrandingAsset(slot as BrandAssetSlot, asset));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Restore a previous version of a slot (makes it current; old current is kept).
  app.post("/admin/branding/asset/restore", json, async (req: Request, res: Response) => {
    try {
      const { slot, storagePath } = (req.body ?? {}) as { slot?: string; storagePath?: string };
      if (!slot || !BRAND_ASSET_SLOTS.includes(slot as BrandAssetSlot) || !storagePath) {
        res.status(400).json({ error: { message: "A valid slot and storagePath are required." } });
        return;
      }
      res.json(await restoreBrandingAsset(slot as BrandAssetSlot, storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Permanently delete one historical version of a slot (removes the file too).
  app.post("/admin/branding/asset/version/delete", json, async (req: Request, res: Response) => {
    try {
      const { slot, storagePath } = (req.body ?? {}) as { slot?: string; storagePath?: string };
      if (!slot || !BRAND_ASSET_SLOTS.includes(slot as BrandAssetSlot) || !storagePath) {
        res.status(400).json({ error: { message: "A valid slot and storagePath are required." } });
        return;
      }
      await deletePublicObject(storagePath);
      res.json(await deleteBrandingAssetVersion(slot as BrandAssetSlot, storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Remove the current brand image asset (kept in history, file NOT deleted).
  app.delete("/admin/branding/asset/:slot", async (req: Request, res: Response) => {
    try {
      const slot = String(req.params.slot);
      if (!BRAND_ASSET_SLOTS.includes(slot as BrandAssetSlot)) {
        res.status(400).json({ error: { message: "Unknown asset slot." } });
        return;
      }
      res.json(await setBrandingAsset(slot as BrandAssetSlot, null));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload (replace) the share watermark. Body: { base64, mimeType, opacity?, scale? }.
  app.post("/admin/branding/watermark", json, async (req: Request, res: Response) => {
    try {
      const { base64, mimeType, opacity, scale } = (req.body ?? {}) as {
        base64?: string;
        mimeType?: string;
        opacity?: number;
        scale?: number;
      };
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      // The previous watermark is retained in history (not deleted from storage).
      const current = await getBrandingConfig();
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadBrandingWatermark(buf, mimeType);
      const config = await setBrandingWatermark({
        imageUrl: publicUrl,
        storagePath,
        opacity: typeof opacity === "number" ? opacity : (current.watermark?.opacity ?? 0.5),
        scale: typeof scale === "number" ? scale : (current.watermark?.scale ?? 0.25),
        updatedAt: Date.now(),
      });
      res.json(config);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Update only the watermark appearance (opacity/scale) without re-uploading.
  app.put("/admin/branding/watermark", json, async (req: Request, res: Response) => {
    try {
      const current = await getBrandingConfig();
      if (!current.watermark) {
        res.status(404).json({ error: { message: "No watermark to update." } });
        return;
      }
      const { opacity, scale } = (req.body ?? {}) as { opacity?: number; scale?: number };
      const config = await setBrandingWatermark({
        ...current.watermark,
        opacity: typeof opacity === "number" ? opacity : current.watermark.opacity,
        scale: typeof scale === "number" ? scale : current.watermark.scale,
        updatedAt: Date.now(),
      });
      res.json(config);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Remove the current watermark (kept in history, file NOT deleted).
  app.delete("/admin/branding/watermark", async (_req: Request, res: Response) => {
    try {
      res.json(await setBrandingWatermark(null));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Restore a previous watermark version by its storage path.
  app.post("/admin/branding/watermark/restore", json, async (req: Request, res: Response) => {
    try {
      const { storagePath } = (req.body ?? {}) as { storagePath?: string };
      if (!storagePath) {
        res.status(400).json({ error: { message: "storagePath is required." } });
        return;
      }
      res.json(await restoreWatermark(storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Permanently delete one historical watermark version (removes the file too).
  app.post("/admin/branding/watermark/version/delete", json, async (req: Request, res: Response) => {
    try {
      const { storagePath } = (req.body ?? {}) as { storagePath?: string };
      if (!storagePath) {
        res.status(400).json({ error: { message: "storagePath is required." } });
        return;
      }
      await deletePublicObject(storagePath);
      res.json(await deleteWatermarkVersion(storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- QR code library (Marketing → QR codes) -------------------------------

  app.get("/admin/qrcodes", async (_req: Request, res: Response) => {
    try {
      res.json(await getQrCodesConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Everything but `data` falls back to a sane default, so a partial body from
  // an older client still renders something rather than 500ing outright.
  function parseQrCodeSaveInput(body: unknown): QrCodeSaveInput {
    const b = (body ?? {}) as Record<string, unknown>;
    const data = typeof b.data === "string" ? b.data.trim() : "";
    if (!data) throw new Error("Enter a URL or text to encode.");
    const rawLogo = b.logo;
    let logo: QrLogoInput | null = null;
    if (rawLogo && typeof rawLogo === "object") {
      const l = rawLogo as Record<string, unknown>;
      const sizePct = typeof l.sizePct === "number" ? l.sizePct : 0.2;
      const quietPct = typeof l.quietPct === "number" ? l.quietPct : 0.22;
      const quietColor = typeof l.quietColor === "string" && l.quietColor ? l.quietColor : "#ffffff";
      if (l.source === "keep") {
        logo = { source: "keep", sizePct, quietPct, quietColor };
      } else if (l.source === "brandingAsset") {
        if (typeof l.brandingSlot !== "string" || !l.brandingSlot) {
          throw new Error("A branding-asset logo needs a slot to copy from.");
        }
        logo = {
          source: "brandingAsset",
          brandingSlot: l.brandingSlot as BrandAssetSlot,
          sizePct,
          quietPct,
          quietColor,
        };
      } else if (l.source === "upload") {
        if (typeof l.base64 !== "string" || !l.base64 || typeof l.mimeType !== "string" || !l.mimeType) {
          throw new Error("A logo upload needs base64 and mimeType.");
        }
        logo = {
          source: "upload",
          base64: l.base64,
          mimeType: l.mimeType,
          sizePct,
          quietPct,
          quietColor,
        };
      } else {
        throw new Error('A logo needs a valid source ("upload", "brandingAsset", or "keep").');
      }
    }
    return {
      id: typeof b.id === "string" && b.id ? b.id : undefined,
      name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Untitled QR code",
      data,
      errorCorrectionLevel: (["L", "M", "Q", "H"] as const).includes(
        b.errorCorrectionLevel as "L" | "M" | "Q" | "H",
      )
        ? (b.errorCorrectionLevel as QrCodeSaveInput["errorCorrectionLevel"])
        : "M",
      margin: typeof b.margin === "number" ? b.margin : 4,
      scalePx: typeof b.scalePx === "number" ? b.scalePx : 512,
      colorDark: typeof b.colorDark === "string" ? b.colorDark : "#000000",
      colorLight: typeof b.colorLight === "string" ? b.colorLight : "#ffffff",
      format: b.format === "svg" ? "svg" : "png",
      version: typeof b.version === "number" ? b.version : null,
      maskPattern: typeof b.maskPattern === "number" ? b.maskPattern : null,
      dotsStyle: (QR_DOT_STYLES as readonly string[]).includes(b.dotsStyle as string)
        ? (b.dotsStyle as QrDotStyle)
        : "square",
      cornerSquareStyle: (QR_CORNER_STYLES as readonly string[]).includes(b.cornerSquareStyle as string)
        ? (b.cornerSquareStyle as QrCornerStyle)
        : null,
      cornerDotStyle: (QR_CORNER_STYLES as readonly string[]).includes(b.cornerDotStyle as string)
        ? (b.cornerDotStyle as QrCornerStyle)
        : null,
      logo,
    };
  }

  // Create a new QR code (renders + uploads immediately).
  app.post("/admin/qrcodes", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveQrCode(parseQrCodeSaveInput(req.body)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Update an existing QR code's options/data and re-render it.
  app.put("/admin/qrcodes/:id", json, async (req: Request, res: Response) => {
    try {
      const input = parseQrCodeSaveInput(req.body);
      res.json(await saveQrCode({ ...input, id: String(req.params.id) }));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Render without saving — powers the live preview as controls change, with
  // no Storage write and no history entry created per keystroke.
  app.post("/admin/qrcodes/preview", json, async (req: Request, res: Response) => {
    try {
      res.json(await previewQrCode(parseQrCodeSaveInput(req.body)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Delete a QR code entirely — unlike a branding slot, there is nothing left
  // to restore it onto, so its rendered files are cleaned up too.
  app.delete("/admin/qrcodes/:id", async (req: Request, res: Response) => {
    try {
      res.json(await deleteQrCode(String(req.params.id)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Restore a previous render by its storage path (no re-render — the file
  // already exists).
  app.post("/admin/qrcodes/:id/restore", json, async (req: Request, res: Response) => {
    try {
      const { storagePath } = (req.body ?? {}) as { storagePath?: string };
      if (!storagePath) {
        res.status(400).json({ error: { message: "storagePath is required." } });
        return;
      }
      res.json(await restoreQrCodeVersion(String(req.params.id), storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Permanently delete one historical render (removes the file too).
  app.post("/admin/qrcodes/:id/version/delete", json, async (req: Request, res: Response) => {
    try {
      const { storagePath } = (req.body ?? {}) as { storagePath?: string };
      if (!storagePath) {
        res.status(400).json({ error: { message: "storagePath is required." } });
        return;
      }
      await deletePublicObject(storagePath);
      res.json(await deleteQrCodeVersion(String(req.params.id), storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Landing-page illustrations (inline drag-&-drop editor) --------------

  app.get("/admin/site-images", async (_req: Request, res: Response) => {
    try {
      res.json(await getSiteImagesConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload (replace) a single landing illustration. Body: { slot, base64, mimeType, alt? }.
  app.post("/admin/site-image", json, async (req: Request, res: Response) => {
    try {
      const { slot, base64, mimeType, alt } = (req.body ?? {}) as {
        slot?: string;
        base64?: string;
        mimeType?: string;
        alt?: string;
      };
      if (!isSiteImageSlot(slot)) {
        res.status(400).json({ error: { message: "A valid image slot is required." } });
        return;
      }
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      // The previous image is NOT deleted — it moves into the slot's version
      // history (see setSiteImage) so it can be restored later.
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadSiteImage(slot, buf, mimeType);
      const asset: BrandAsset = { imageUrl: publicUrl, storagePath, updatedAt: Date.now() };
      if (typeof alt === "string") asset.alt = alt;
      res.json(await setSiteImage(slot as SiteImageSlot, asset));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Restore a previous version of a slot (makes it current; old current is kept).
  app.post("/admin/site-image/restore", json, async (req: Request, res: Response) => {
    try {
      const { slot, storagePath } = (req.body ?? {}) as { slot?: string; storagePath?: string };
      if (!isSiteImageSlot(slot) || !storagePath) {
        res.status(400).json({ error: { message: "A valid slot and storagePath are required." } });
        return;
      }
      res.json(await restoreSiteImage(slot as SiteImageSlot, storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Permanently delete one historical version of a slot (removes the file too).
  app.post("/admin/site-image/version/delete", json, async (req: Request, res: Response) => {
    try {
      const { slot, storagePath } = (req.body ?? {}) as { slot?: string; storagePath?: string };
      if (!isSiteImageSlot(slot) || !storagePath) {
        res.status(400).json({ error: { message: "A valid slot and storagePath are required." } });
        return;
      }
      await deletePublicObject(storagePath);
      res.json(await deleteSiteImageVersion(slot as SiteImageSlot, storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Remove the current illustration for a slot (kept in history, file NOT deleted).
  app.delete("/admin/site-image/:slot", async (req: Request, res: Response) => {
    try {
      const slot = String(req.params.slot);
      if (!isSiteImageSlot(slot)) {
        res.status(400).json({ error: { message: "Unknown image slot." } });
        return;
      }
      res.json(await setSiteImage(slot as SiteImageSlot, null));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Catalog pictures ----------------------------------------------------
  //
  // Pictures of what a binding looks like, what a book looks like on a shelf,
  // what a Spark pack looks like — filed under a `scope/id` key rather than on a
  // product record, because one photo of a coil binding serves every coil-bound
  // book and a `book/default` set stands in for any book without its own.
  // Retiring a picture keeps both the record and the file; only the delete route
  // removes anything.

  app.get("/admin/catalog/media", async (_req: Request, res: Response) => {
    try {
      res.json(await getCatalogMediaConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Body: { key, base64, mimeType, alt, caption? }.
  app.post("/admin/catalog/media", json, async (req: Request, res: Response) => {
    try {
      const { key, base64, mimeType, alt, caption } = (req.body ?? {}) as {
        key?: string;
        base64?: string;
        mimeType?: string;
        alt?: string;
        caption?: string;
      };
      const parsed = typeof key === "string" ? parseCatalogMediaKey(key) : null;
      if (!parsed) {
        res.status(400).json({ error: { message: "A valid catalog media key is required." } });
        return;
      }
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      // Customers see these, so a description isn't optional.
      if (!alt?.trim()) {
        res.status(400).json({ error: { message: "Describe the picture (alt text) so it's accessible." } });
        return;
      }
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadCatalogPhoto(
        parsed.scope,
        parsed.segments,
        buf,
        mimeType,
      );
      res.json(
        await addCatalogPhoto(key as string, {
          imageUrl: publicUrl,
          storagePath,
          alt: alt.trim(),
          ...(typeof caption === "string" ? { caption } : {}),
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // Retire / reinstate / retitle / promote. Body: { key, storagePath, ...patch }.
  app.post("/admin/catalog/media/update", json, async (req: Request, res: Response) => {
    try {
      const { key, storagePath, active, alt, caption, makePrimary } = (req.body ?? {}) as {
        key?: string;
        storagePath?: string;
        active?: boolean;
        alt?: string;
        caption?: string;
        makePrimary?: boolean;
      };
      if (!isCatalogMediaKey(key) || !storagePath) {
        res.status(400).json({ error: { message: "A valid key and storagePath are required." } });
        return;
      }
      res.json(await patchCatalogPhoto(key, storagePath, { active, alt, caption, makePrimary }));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Permanently forget a picture AND delete the file. Body: { key, storagePath }.
  app.post("/admin/catalog/media/delete", json, async (req: Request, res: Response) => {
    try {
      const { key, storagePath } = (req.body ?? {}) as { key?: string; storagePath?: string };
      if (!isCatalogMediaKey(key) || !storagePath) {
        res.status(400).json({ error: { message: "A valid key and storagePath are required." } });
        return;
      }
      await deletePublicObject(storagePath);
      res.json(await removeCatalogPhoto(key, storagePath));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Landing-page copy (inline text editor) ------------------------------

  app.get("/admin/site-content", async (_req: Request, res: Response) => {
    try {
      res.json(await getSiteContentConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Set (or clear, with an empty value) a single copy override. Body: { slot, value }.
  app.put("/admin/site-content", json, async (req: Request, res: Response) => {
    try {
      const { slot, value } = (req.body ?? {}) as { slot?: string; value?: string };
      if (!isKnownTextSlot(slot)) {
        res.status(400).json({ error: { message: "Unknown text slot." } });
        return;
      }
      res.json(await setSiteText(slot, typeof value === "string" ? value : null));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Reset a copy override back to the code default.
  app.delete("/admin/site-content/:slot", async (req: Request, res: Response) => {
    try {
      const slot = String(req.params.slot);
      if (!isKnownTextSlot(slot)) {
        res.status(400).json({ error: { message: "Unknown text slot." } });
        return;
      }
      res.json(await setSiteText(slot, null));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Pricing settings (catalog-wide economics) ---------------------------

  app.get("/admin/config/pricing-settings", async (_req, res) => {
    try {
      res.json(await getPricingSettings());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/pricing-settings", json, async (req: Request, res: Response) => {
    try {
      const saved = await savePricingSettings(req.body);
      // Currencies / tax / rounding change resolved storefront prices.
      await reprojectPublicProducts();
      res.json(saved);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Product catalog ------------------------------------------------------

  app.get("/admin/config/products", async (_req, res) => {
    try {
      res.json(await getProductsConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Replace the whole catalog (used for reordering / bulk edits).
  app.put("/admin/config/products", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveProductsConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Create or update a single product.
  app.post("/admin/config/products", json, async (req: AuthedRequest, res: Response) => {
    try {
      res.json(await upsertProduct(req.body, req.uid));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Seed the catalog from the curated provider catalog (idempotent by SKU).
  app.post("/admin/config/products/seed", json, async (_req: Request, res: Response) => {
    try {
      res.json(await seedProducts());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Verify SKUs against a provider environment (defaults to the active one) and
  // persist the per-env verdicts. `?id=` limits it to one product.
  // Verifying LIVE while still serving sandbox is the point: it's how you prove
  // the catalog is ready before flipping.
  app.post("/admin/config/products/verify", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { env?: string; id?: string };
      const env: FulfillmentEnv = body.env === "live" ? "live" : body.env === "sandbox" ? "sandbox" : activeEnv();
      res.json(await verifyCatalog(env, body.id?.trim() || undefined));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Ask the provider whether an assembled SKU exists (and what page counts it
  // takes). Backs the SKU builder; answers accumulate in the learned matrix.
  app.post("/admin/print/sku/check", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { sku?: string; pages?: number; env?: string; refresh?: boolean };
      if (!body.sku?.trim()) {
        res.status(400).json({ error: { message: "sku is required." } });
        return;
      }
      const env: FulfillmentEnv = body.env === "live" ? "live" : body.env === "sandbox" ? "sandbox" : activeEnv();
      res.json(await checkSku({ env, sku: body.sku, pages: body.pages, refresh: body.refresh }));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/admin/print/sku/matrix", async (_req: Request, res: Response) => {
    try {
      res.json({ entries: Object.values(await readSkuMatrix()) });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Derive the cost table + shipping fallback from real provider quotes instead
  // of hand-entry. Persists only when the fit is trustworthy.
  app.post("/admin/config/products/:id/calibrate", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { env?: string };
      const env: FulfillmentEnv = body.env === "live" ? "live" : body.env === "sandbox" ? "sandbox" : activeEnv();
      res.json(await calibrateAndSave(String(req.params.id), env));
    } catch (err) {
      handleError(res, err);
    }
  });

  // The same measurement across the whole catalog. Overwrites cost tables, so
  // the UI confirms first; failures are reported per product and write nothing.
  app.post("/admin/config/products/calibrate", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { env?: string; id?: string };
      const env: FulfillmentEnv = body.env === "live" ? "live" : body.env === "sandbox" ? "sandbox" : activeEnv();
      res.json(await calibrateCatalog(env, body.id?.trim() || undefined));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/config/products/:id", async (req: Request, res: Response) => {
    try {
      res.json(await deleteProduct(String(req.params.id)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Sparks economy -------------------------------------------------------

  app.get("/admin/config/sparks", async (_req, res) => {
    try {
      res.json(await getSparksConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/sparks", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveSparksConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Referral program -----------------------------------------------------

  app.get("/admin/config/referral", async (_req, res) => {
    try {
      res.json(await getReferralConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/referral", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveReferralConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Affiliate program ----------------------------------------------------

  // Which purchase kinds each Rewardful campaign may pay a commission on. Rates,
  // caps and payouts are Rewardful's; this is the one part it can't express.
  app.get("/admin/config/affiliates", async (_req, res) => {
    try {
      res.json(await getAffiliateConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/affiliates", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveAffiliateConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // The funnel report. Defaults to the last 30 days, which is what the dashboard
  // opens on.
  app.get("/admin/referrals/stats", async (req: Request, res: Response) => {
    try {
      const to = Number(req.query.to) || Date.now();
      const from = Number(req.query.from) || to - 30 * 86_400_000;
      res.json(await referralStatsSummary(from, to));
    } catch (err) {
      handleError(res, err);
    }
  });

  // The abuse lever: void an invitation and reverse whatever it paid out.
  app.post("/admin/referrals/invitations/:id/block", json, async (req: Request, res: Response) => {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "blocked by admin";
      await blockInvitation(String(req.params.id), reason);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // The held-payout queue's two verdicts. A reward parked by the lifetime cap or
  // the daily budget is waiting on a human decision, so both of them have to be
  // reachable — otherwise "held for review" is just a slower "lost".
  app.post("/admin/referrals/rewards/:id/release", json, async (req: Request, res: Response) => {
    try {
      const outcome = await releaseReward(String(req.params.id));
      if (outcome === "not_found") {
        res.status(404).json({ error: { message: "That reward no longer exists." } });
        return;
      }
      if (outcome === "not_held") {
        res.status(400).json({ error: { message: "That reward isn't waiting for review." } });
        return;
      }
      res.json({ ok: outcome === "granted", outcome });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/referrals/rewards/:id/decline", json, async (req: Request, res: Response) => {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "declined by admin";
      const outcome = await voidHeldReward(String(req.params.id), reason);
      if (outcome === "not_found") {
        res.status(404).json({ error: { message: "That reward no longer exists." } });
        return;
      }
      if (outcome === "not_held") {
        res.status(400).json({ error: { message: "That reward isn't waiting for review." } });
        return;
      }
      res.json({ ok: true, outcome });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Misconfiguration emergency: void every still-unaccepted invitation so the
  // frozen (wrong) terms stop being claimable. Accepted ones stay honored.
  app.post("/admin/referrals/void-unaccepted", json, async (req: Request, res: Response) => {
    try {
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "voided by admin";
      const voided = await voidUnacceptedInvitations(reason);
      res.json({ ok: true, voided });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Marketing SEO (landing-page metadata + structured data) -------------

  app.get("/admin/config/seo", async (_req, res) => {
    try {
      res.json(await getSeoConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/seo", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveSeoConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Email (system + marketing) ------------------------------------------

  app.get("/admin/config/email", async (_req, res) => {
    try {
      res.json({ config: await getEmailConfig(), configured: emailConfigured() });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/email", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveEmailConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Send a template (with its built-in sample vars) to a test recipient — the
  // admin's own email by default. Bypasses the enabled/cap checks.
  app.post("/admin/email/test", json, async (req: AuthedRequest, res: Response) => {
    try {
      const { templateId, to } = (req.body ?? {}) as { templateId?: string; to?: string };
      if (!isEmailTemplateId(templateId)) {
        res.status(400).json({ error: { message: "A valid templateId is required." } });
        return;
      }
      const recipient = (typeof to === "string" && to.trim()) || req.authToken?.email || "";
      if (!recipient) {
        res.status(400).json({ error: { message: "No recipient email available." } });
        return;
      }
      const result = await sendTemplatedEmail({
        templateId,
        to: recipient,
        vars: EMAIL_TEMPLATE_REGISTRY[templateId].sample,
        isTest: true,
      });
      if (!result.ok) {
        res.status(502).json({
          error: {
            message:
              result.skipped === "not_configured"
                ? "Email isn't configured — set the ZEPTOMAIL_TOKEN secret first."
                : (result.error ?? "Test send failed."),
          },
        });
        return;
      }
      res.json({ ok: true, to: recipient });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Slack notifications --------------------------------------------------

  app.put("/admin/config/slack", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveSlackConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Post a real test notification to a channel to verify the webhook is wired.
  // Bypasses the emulator guard, per-message toggles, and idempotency markers.
  app.post("/admin/slack/test", json, async (req: AuthedRequest, res: Response) => {
    try {
      const channel = ((req.body ?? {}) as { channel?: string }).channel;
      const target: SlackChannel =
        channel === "ops" ? "ops" : channel === "contact" ? "contact" : "growth";
      const who = req.authToken?.email ?? req.uid ?? "an admin";
      const result = await notifySlack({
        channel: target,
        force: true,
        text: `🔔 Test notification — Slack is wired up correctly (sent from the admin dashboard by ${who}).`,
      });
      if (!result.sent) {
        const secretName: Record<SlackChannel, string> = {
          growth: "SLACK_WEBHOOK_URL",
          ops: "SLACK_OPS_WEBHOOK_URL",
          contact: "SLACK_CONTACT_WEBHOOK_URL",
        };
        res.status(502).json({
          error: {
            message:
              result.reason === "not_configured"
                ? `No webhook is configured for #${target}. Set the ${secretName[target]} secret and deploy.`
                : `Slack test failed (${result.reason}).`,
          },
        });
        return;
      }
      res.json({ ok: true, channel: target });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Expose the message registry so the admin UI can render toggles without
  // duplicating the catalogue (labels/descriptions/channels live in one place).
  app.get("/admin/config/slack", async (_req, res) => {
    try {
      res.json({ config: await getSlackConfig(), registry: SLACK_MESSAGE_REGISTRY });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Legal documents ------------------------------------------------------

  app.get("/admin/config/legal", async (_req, res) => {
    try {
      res.json(await getLegalConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/legal", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveLegalConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Notify every user by email about a material change to a legal document.
   * A deliberate bulk send — sends the `policy_update` transactional template to
   * all accounts, deduped per uid + policy + version so re-triggering is safe.
   * Body: { role } (a well-known legal role, e.g. "privacy" | "terms").
   */
  app.post("/admin/legal/notify", json, async (req: Request, res: Response) => {
    try {
      const role = ((req.body ?? {}) as { role?: string }).role as LegalRole | undefined;
      const config = await getLegalConfig();
      const link = role ? legalLinkByRole(config, role) : undefined;
      if (!link) {
        res.status(400).json({ error: { message: "Unknown or unset legal document." } });
        return;
      }

      let recipients = 0;
      let sent = 0;
      let pageToken: string | undefined;
      do {
        const page = await getAuth().listUsers(1000, pageToken);
        for (const user of page.users) {
          const email = user.email;
          // Real, non-anonymous accounts with an email only.
          if (!email || (user.providerData ?? []).length === 0) continue;
          recipients++;
          const result = await sendTemplatedEmail({
            templateId: "policy_update",
            to: email,
            vars: {
              name: user.displayName ?? undefined,
              policyName: link.label,
              effectiveDate: link.effectiveDate || undefined,
              documentUrl: link.url,
            },
            // Once per user per policy version.
            dedupeKey: `${link.id}_v${link.version}_${user.uid}`,
          });
          if (result.ok && result.skipped !== "duplicate") sent++;
        }
        pageToken = page.pageToken;
      } while (pageToken);

      res.json({ ok: true, recipients, sent, policy: link.label, version: link.version });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Cookie consent -------------------------------------------------------

  app.get("/admin/config/cookies", async (_req, res) => {
    try {
      res.json(await getCookieConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/cookies", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveCookieConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Marketing announcements -----------------------------------------------

  app.get("/admin/config/announcements", async (_req, res) => {
    try {
      res.json(await getAnnouncementsConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/announcements", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveAnnouncementsConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Marketing campaigns ---------------------------------------------------

  app.get("/admin/config/campaigns", async (_req, res) => {
    try {
      res.json(await getCampaignsConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/campaigns", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveCampaignsConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Project a campaign over real accounts before it ships. Takes the campaign in
   * the request body rather than an id, so a DRAFT the admin is still editing can
   * be costed — which is the only moment the number is any use.
   */
  app.post("/admin/campaigns/simulate", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const config = normalizeCampaignsConfig({ version: 1, enabled: true, campaigns: [body.campaign] });
      const campaign = config.campaigns[0];
      if (!campaign) {
        res.status(400).json({ error: { message: "A campaign is required." } });
        return;
      }
      const event = (body.event ?? {}) as Record<string, unknown>;
      res.json(
        await simulateCampaign(campaign, {
          trigger: (event.trigger as CampaignTrigger) ?? "purchase",
          itemType: event.itemType as DiscountItemType | undefined,
          amount: typeof event.amount === "number" ? event.amount : undefined,
          projectId: typeof event.projectId === "string" ? event.projectId : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  /** The daily series + derived lift for one campaign. */
  app.get("/admin/campaigns/:id/report", async (req: Request, res: Response) => {
    try {
      const to = Number(req.query.to) || Date.now();
      const from = Number(req.query.from) || to - 30 * 86_400_000;
      res.json(await campaignReport(req.params.id, from, to));
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Payouts waiting on a human decision, oldest first. */
  app.get("/admin/campaigns/held", async (_req, res) => {
    try {
      const [review, stuck] = await Promise.all([
        listRedemptionsByStatus("review", 100),
        listRedemptionsByStatus("pending", 100),
      ]);
      // A `pending` redemption is normal for the second between claim and
      // delivery; only one that STAYED that way is actually stuck.
      const cutoff = Date.now() - 5 * 60_000;
      const queue = [...review, ...stuck.filter((r) => r.createdAt < cutoff)].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      // Emails are resolved for the queue only. Whoever is deciding needs to see
      // who they're paying, and the queue is bounded at 200 by the query above.
      const held: HeldRedemptionView[] = await Promise.all(
        queue.map(async (r) => ({
          id: r.id,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          ruleId: r.ruleId,
          uid: r.uid,
          email: (await recipientForUid(r.uid)).email,
          status: r.status,
          summary: r.summary,
          unlocks: r.unlocks,
          cost: r.cost,
          sparks: r.sparks,
          createdAt: r.createdAt,
          note: r.note,
        })),
      );
      res.json({ held });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/campaigns/redemptions/:id/release", json, async (req: Request, res: Response) => {
    try {
      res.json({ outcome: await releaseRedemption(req.params.id) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/admin/campaigns/redemptions/:id/void", json, async (req: Request, res: Response) => {
    try {
      const reason = String((req.body as { reason?: unknown })?.reason ?? "").slice(0, 500);
      res.json({ outcome: await voidRedemption(req.params.id, reason || "no reason given") });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Profiling surveys -----------------------------------------------------

  app.get("/admin/config/surveys", async (_req, res) => {
    try {
      res.json(await getSurveysConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/admin/config/surveys", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveSurveysConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Answers cross-tabulated against lifetime revenue — one survey, or all of them.
   *
   * Every report in one response because there are at most a handful of surveys
   * and the analysis tab shows them together; a per-survey round trip would just
   * re-scan the same cached payment table each time.
   */
  app.get("/admin/surveys/report", async (req: Request, res: Response) => {
    try {
      const id = typeof req.query.surveyId === "string" ? req.query.surveyId : "";
      if (id) {
        const report = await surveyReport(id);
        res.json({ reports: report ? [report] : [] });
        return;
      }
      res.json({ reports: await surveyReports() });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Send a sample contact-form message to the configured contact inbox — proves
  // the whole delivery chain (sender identity → ZeptoMail → inbox) end to end.
  app.post("/admin/contact/test", json, async (_req: Request, res: Response) => {
    try {
      const config = await getEmailConfig();
      const recipient = config.global.contactRecipient || config.global.supportEmail;
      if (!recipient) {
        res.status(400).json({ error: { message: "Set a contact recipient first." } });
        return;
      }
      const result = await sendTemplatedEmail({
        templateId: "contact_form",
        to: recipient,
        replyTo: config.senders.replyTo || undefined,
        isTest: true,
        vars: EMAIL_TEMPLATE_REGISTRY.contact_form.sample,
      });
      if (!result.ok) {
        res
          .status(500)
          .json({ error: { message: result.error ?? "Test send failed — check email setup." } });
        return;
      }
      res.json({ ok: true, recipient });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ---- Subscription plans (admin-configured, Stripe-synced) ----------------

  app.get("/admin/config/plans", async (_req, res) => {
    try {
      res.json(await getPlansConfig());
    } catch (err) {
      handleError(res, err);
    }
  });

  // Replace the whole plans config (reorder / bulk edits; no Stripe sync).
  app.put("/admin/config/plans", json, async (req: Request, res: Response) => {
    try {
      const saved = await savePlansConfig(req.body);
      await refreshProductsForPlans();
      res.json(saved);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Create or update a single plan, reconciling it into Stripe (product+prices).
  app.post("/admin/config/plans", json, async (req: AuthedRequest, res: Response) => {
    try {
      const saved = await upsertPlan(req.body, req.uid);
      await refreshProductsForPlans();
      res.json(saved);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/config/plans/:id", async (req: Request, res: Response) => {
    try {
      const saved = await deletePlan(String(req.params.id));
      await refreshProductsForPlans();
      res.json(saved);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Re-sync every plan to Stripe (drift repair / "Sync now"). Returns the
  // config. `env` (optional; "sandbox" | "live") targets a SPECIFIC Stripe
  // environment regardless of which one the sandbox↔live toggle currently has
  // active — this is how you create live prices before flipping to live (the
  // same "prove it before you switch" pattern as `/admin/config/products/verify`).
  app.post("/admin/config/plans/sync", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { env?: string };
      const targetEnv: BillingEnv | undefined =
        body.env === "live" ? "live" : body.env === "sandbox" ? "sandbox" : undefined;
      res.json(await syncAllPlansToStripe(targetEnv));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Live margin preview for one product + scenario. Fetches a real provider
  // quote when the product is provider-live so the admin sees true economics.
  // Body: { product, scenario: { pages, copies, currency, country, region? } }.
  app.post("/admin/config/products/margin-preview", json, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        product?: ProductDefinition;
        scenario?: {
          pages: number;
          copies: number;
          currency: string;
          country?: string;
          region?: string;
          variant?: unknown;
        };
      };
      const product = body.product;
      const sc = body.scenario;
      if (!product || !sc) {
        res.status(400).json({ error: { message: "product and scenario are required." } });
        return;
      }

      const settings = await getPricingSettings();
      // Variants change both sides of the preview: a different SKU to quote, and
      // a different sticker. Quoting the base while pricing a variant would show
      // a margin no order can produce.
      const variant = isVariantSelection(sc.variant) ? sc.variant : undefined;
      // Same resolver checkout uses, so the preview can never drift from what a
      // customer is actually charged against. No shippingMethod is pinned here:
      // an admin preview wants the cheapest available tier.
      const live = await fetchLiveCost({
        product,
        settings,
        sku: variant ? (skuForVariant(product.provider.sku, variant) ?? undefined) : undefined,
        pages: sc.pages,
        copies: Math.max(1, sc.copies),
        destinationCountry: sc.country || "US",
        destinationState: sc.region,
      });

      const breakdown = computeMargin(
        product,
        {
          currency: sc.currency,
          pages: sc.pages,
          copies: sc.copies,
          variant,
          liveUnitCost: live.unitCost,
          liveShippingCost: live.shippingCost,
        },
        settings,
      );
      res.json({
        breakdown,
        live: productionCostSource(product, live) === "live",
        quoteError: live.error,
      });
    } catch (err) {
      handleError(res, err);
    }
  });
}
