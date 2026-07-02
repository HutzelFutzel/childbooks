/**
 * Global, admin-managed **landing-page illustrations**.
 *
 * These are the marketing site's editorial images (hero spread, sample page
 * cards, how-it-works spots) — distinct from the brand kit (`branding.ts`),
 * which owns identity assets (logo/favicon/OG). Each slot is uploaded to
 * world-readable public storage and referenced here by URL, so an admin can
 * swap them inline on the landing page (drag & drop) without a deploy.
 *
 * Stored at the world-readable `appConfig/siteImages` doc; previous uploads are
 * retained per slot (never deleted on replace) so they can be restored.
 */
import { MAX_ASSET_HISTORY, type BrandAsset } from "./branding";

/** The editable illustration slots on the landing page. */
export type SiteImageSlot =
  | "hero.main"
  | "hero.card1"
  | "hero.card2"
  | "how.step1"
  | "how.step2"
  | "how.step3";

export const SITE_IMAGE_SLOTS: SiteImageSlot[] = [
  "hero.main",
  "hero.card1",
  "hero.card2",
  "how.step1",
  "how.step2",
  "how.step3",
];

export function isSiteImageSlot(v: unknown): v is SiteImageSlot {
  return typeof v === "string" && (SITE_IMAGE_SLOTS as string[]).includes(v);
}

export interface SiteImagesConfig {
  version: 1;
  /** slotId → current image. */
  images: Partial<Record<SiteImageSlot, BrandAsset>>;
  /** slotId → previous versions (newest first). */
  history: Partial<Record<SiteImageSlot, BrandAsset[]>>;
}

export function createDefaultSiteImagesConfig(): SiteImagesConfig {
  return { version: 1, images: {}, history: {} };
}

// Firestore rejects `undefined` field values, so optional fields are only
// included when actually present (mirrors branding's normalizeAsset).
function normalizeAsset(input: unknown): BrandAsset | null {
  const a = input as Partial<BrandAsset> | null | undefined;
  if (!a || typeof a.imageUrl !== "string" || !a.imageUrl) return null;
  const asset: BrandAsset = {
    imageUrl: a.imageUrl,
    updatedAt: typeof a.updatedAt === "number" ? a.updatedAt : Date.now(),
  };
  if (typeof a.storagePath === "string") asset.storagePath = a.storagePath;
  if (typeof a.alt === "string") asset.alt = a.alt.slice(0, 300);
  return asset;
}

function normalizeAssetList(input: unknown): BrandAsset[] {
  if (!Array.isArray(input)) return [];
  const out: BrandAsset[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const a = normalizeAsset(item);
    if (!a?.storagePath || seen.has(a.storagePath)) continue;
    seen.add(a.storagePath);
    out.push(a);
    if (out.length >= MAX_ASSET_HISTORY) break;
  }
  return out;
}

export function normalizeSiteImagesConfig(input: unknown): SiteImagesConfig {
  const out = createDefaultSiteImagesConfig();
  if (!input || typeof input !== "object") return out;
  const cfg = input as Partial<SiteImagesConfig>;
  const images = (cfg.images ?? {}) as Record<string, unknown>;
  const history = (cfg.history ?? {}) as Record<string, unknown>;
  for (const slot of SITE_IMAGE_SLOTS) {
    const asset = normalizeAsset(images[slot]);
    if (asset) out.images[slot] = asset;
    const list = normalizeAssetList(history[slot]);
    if (list.length > 0) out.history[slot] = list;
  }
  return out;
}
