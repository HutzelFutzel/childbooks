/**
 * Admin configuration endpoints. Mounted under `/admin`, which `app.ts` guards
 * with `requireVerified` + `requireAdmin`, so every handler here can assume an
 * authenticated admin caller. All global config writes go through these routes
 * (clients never write the config docs directly — the rules deny it).
 */
import express, { type Express, type Request, type Response } from "express";
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
  deleteBrandingAssetVersion,
  deleteWatermarkVersion,
  restoreBrandingAsset,
  restoreWatermark,
  saveArtStylesConfig,
  saveAgeWritingConfig,
  saveBrandingInfo,
  saveModelConfig,
  saveModelCostTable,
  savePricingSettings,
  saveSeoConfig,
  saveSparksConfig,
  setArtStyleExample,
  setBrandingAsset,
  setBrandingWatermark,
  getSiteImagesConfig,
  getSiteContentConfig,
  setSiteImage,
  restoreSiteImage,
  deleteSiteImageVersion,
  setSiteText,
  isKnownTextSlot,
} from "./appConfig";
import { deletePlan, getPlansConfig, savePlansConfig, syncPlanToStripe, upsertPlan } from "./plans";
import { normalizePlan } from "../../books-frontend/src/core/config/plans";
import {
  deletePublicObject,
  uploadArtStyleImage,
  uploadBrandingAsset,
  uploadBrandingWatermark,
  uploadProductImage,
  uploadSiteImage,
} from "./storage";
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
  deleteProduct,
  getProductsConfig,
  reprojectPublicProducts,
  saveProductsConfig,
  seedProducts,
  upsertProduct,
} from "./products";
import { fulfillmentProvider } from "./lulu";
import { computeMargin } from "../../books-frontend/src/core/config/productMath";
import type {
  ProductDefinition,
  ProductImage,
} from "../../books-frontend/src/core/config/products";
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
    "Set canonicalModelId to the exact id shown in the docs, found=false if the model isn't present, and put the verbatim line(s) you used in sourceQuote.";
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
      modelCost: suggestionToModelCost(raw),
      canonicalModelId: raw.canonicalModelId,
      sourceQuote: raw.sourceQuote,
      notes: raw.notes,
    };
  });

  return { results, events };
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { message: "Invalid configuration.", issues: err.issues } });
    return;
  }
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
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

  app.put("/admin/config/age-writing", json, async (req: Request, res: Response) => {
    try {
      res.json(await saveAgeWritingConfig(req.body));
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
  // Body: { slot, base64, mimeType, alt? } where slot ∈ logo|logoDark|icon|favicon|ogImage.
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

  app.delete("/admin/config/products/:id", async (req: Request, res: Response) => {
    try {
      res.json(await deleteProduct(String(req.params.id)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Upload (append) a product image. Body: { base64, mimeType, role?, alt? }.
  app.post("/admin/config/products/:id/image", json, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { base64, mimeType, role, alt } = (req.body ?? {}) as {
        base64?: string;
        mimeType?: string;
        role?: ProductImage["role"];
        alt?: string;
      };
      if (!base64 || !mimeType) {
        res.status(400).json({ error: { message: "base64 and mimeType are required." } });
        return;
      }
      const buf = Buffer.from(base64, "base64");
      const { storagePath, publicUrl } = await uploadProductImage(id, buf, mimeType);
      const image: ProductImage = { url: publicUrl, storagePath, role: role ?? "gallery", alt };
      res.json(image);
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
      res.json(await savePlansConfig(req.body));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Create or update a single plan, reconciling it into Stripe (product+prices).
  app.post("/admin/config/plans", json, async (req: AuthedRequest, res: Response) => {
    try {
      res.json(await upsertPlan(req.body, req.uid));
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/admin/config/plans/:id", async (req: Request, res: Response) => {
    try {
      res.json(await deletePlan(String(req.params.id)));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Re-sync every plan to Stripe (drift repair / "Sync now"). Returns the config.
  app.post("/admin/config/plans/sync", json, async (_req: Request, res: Response) => {
    try {
      const config = await getPlansConfig();
      const synced = await Promise.all(config.plans.map((p) => syncPlanToStripe(normalizePlan(p))));
      res.json(await savePlansConfig({ version: 1, plans: synced }));
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
        scenario?: { pages: number; copies: number; currency: string; country?: string; region?: string };
      };
      const product = body.product;
      const sc = body.scenario;
      if (!product || !sc) {
        res.status(400).json({ error: { message: "product and scenario are required." } });
        return;
      }

      let liveUnitCost: number | undefined;
      let liveShippingCost: number | undefined;
      let quoteError: string | undefined;

      if (product.provider.id === "lulu" && product.cost.source === "providerLive" && product.provider.sku) {
        try {
          const quotes = await fulfillmentProvider().quote({
            productSku: product.provider.sku,
            copies: Math.max(1, sc.copies),
            destinationCountry: sc.country || "US",
            destinationState: sc.region,
            pageCount: sc.pages,
          });
          const cheapest = quotes
            .map((q) => ({ items: Number(q.items.amount) || 0, ship: Number(q.shipping.amount) || 0 }))
            .sort((a, b) => a.ship - b.ship)[0];
          if (cheapest) {
            liveUnitCost = cheapest.items / Math.max(1, sc.copies);
            liveShippingCost = cheapest.ship;
          }
        } catch (err) {
          quoteError = err instanceof Error ? err.message : "Live quote failed; used the cost table.";
        }
      }

      const settings = await getPricingSettings();
      const breakdown = computeMargin(
        product,
        {
          currency: sc.currency,
          pages: sc.pages,
          copies: sc.copies,
          liveUnitCost,
          liveShippingCost,
        },
        settings,
      );
      res.json({ breakdown, live: liveUnitCost != null, quoteError });
    } catch (err) {
      handleError(res, err);
    }
  });
}
