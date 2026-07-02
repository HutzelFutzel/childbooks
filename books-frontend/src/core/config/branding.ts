/**
 * Global, admin-managed **branding** — the brand kit for the whole product.
 *
 * Owns the visual identity that appears across the marketing site, the studio
 * top bar, public share pages, and social/SEO metadata: the brand name +
 * tagline, the logo set (light/dark), the square icon, the favicon source, the
 * social share (OG) image, the brand colors, and the share watermark.
 *
 * Every image asset is uploaded to world-readable public storage and referenced
 * here by URL, so any of them can be swapped from the admin UI without a deploy.
 * Stored at the world-readable `appConfig/branding` doc and read live by the
 * client, the studio, and the server (landing metadata + favicon + JSON-LD).
 *
 * Whether a given shared book actually shows the watermark is a per-book flag
 * denormalized at publish time from the publisher's plan entitlement
 * (`removeWatermark`); this config only owns the asset + its appearance.
 */
export interface BrandingWatermark {
  /** Public URL of the uploaded watermark asset (SVG preferred). */
  imageUrl: string;
  /** Storage path, so the backend can replace/delete the old file. */
  storagePath?: string;
  /** Overlay opacity, 0..1. */
  opacity: number;
  /** Fraction of the page width the mark spans, 0.05..1. */
  scale: number;
  updatedAt: number;
}

/** A single uploaded brand image (logo, icon, favicon, social image, …). */
export interface BrandAsset {
  /** Public URL of the uploaded asset. */
  imageUrl: string;
  /** Storage path, so the backend can replace/delete the old file. */
  storagePath?: string;
  /** Alt/description text (used for the social image + accessibility). */
  alt?: string;
  updatedAt: number;
}

/** The uploadable brand-image slots (everything except the watermark, which
 *  has its own appearance controls). */
export type BrandAssetSlot = "logo" | "logoDark" | "icon" | "favicon" | "ogImage";

export const BRAND_ASSET_SLOTS: BrandAssetSlot[] = ["logo", "logoDark", "icon", "favicon", "ogImage"];

/** Brand colors (hex). `primary` also drives the browser theme color. */
export interface BrandColors {
  primary: string;
  accent: string;
}

export interface BrandingConfig {
  version: 1;
  /** Brand / product name shown in the nav, top bar, footer, and metadata. */
  brandName: string;
  /** Short tagline shown under the name in the top bar. */
  tagline: string;
  /** Primary logo for light backgrounds (nav / top bar / footer). */
  logo: BrandAsset | null;
  /** Logo variant for dark backgrounds (e.g. the CTA band). */
  logoDark: BrandAsset | null;
  /** Square mark / app icon. */
  icon: BrandAsset | null;
  /** Favicon source (SVG or a 512px PNG); referenced by the metadata `icons`. */
  favicon: BrandAsset | null;
  /** Social share (Open Graph / Twitter) image, ~1200×630. */
  ogImage: BrandAsset | null;
  /** Brand colors. */
  colors: BrandColors;
  /** The share watermark, or null when none is configured. */
  watermark: BrandingWatermark | null;
  /** Previous versions of each image asset (newest first). Uploaded files are
   *  never deleted on replace — the old one moves here so it can be restored. */
  assetHistory: Partial<Record<BrandAssetSlot, BrandAsset[]>>;
  /** Previous watermark versions (newest first). */
  watermarkHistory: BrandingWatermark[];
}

/** Max retained previous versions per slot. */
export const MAX_ASSET_HISTORY = 20;

export function createDefaultBrandingConfig(): BrandingConfig {
  return {
    version: 1,
    brandName: "Childbook Studio",
    tagline: "AI picture-book generator",
    logo: null,
    logoDark: null,
    icon: null,
    favicon: null,
    ogImage: null,
    colors: { primary: "#7c3aed", accent: "#f97316" },
    watermark: null,
    assetHistory: {},
    watermarkHistory: [],
  };
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

// Firestore rejects `undefined` field values, so optional fields are only
// included when actually present (never written as `undefined`).
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

function normalizeWatermark(input: unknown): BrandingWatermark | null {
  const w = input as Partial<BrandingWatermark> | null | undefined;
  if (!w || typeof w.imageUrl !== "string" || !w.imageUrl) return null;
  const mark: BrandingWatermark = {
    imageUrl: w.imageUrl,
    opacity: clamp(w.opacity, 0, 1, 0.5),
    scale: clamp(w.scale, 0.05, 1, 0.25),
    updatedAt: typeof w.updatedAt === "number" ? w.updatedAt : Date.now(),
  };
  if (typeof w.storagePath === "string") mark.storagePath = w.storagePath;
  return mark;
}

/** Normalize a version list: drop invalid/duplicate (by storagePath) entries, cap length. */
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

function normalizeAssetHistory(input: unknown): Partial<Record<BrandAssetSlot, BrandAsset[]>> {
  const out: Partial<Record<BrandAssetSlot, BrandAsset[]>> = {};
  if (!input || typeof input !== "object") return out;
  const rec = input as Record<string, unknown>;
  for (const slot of BRAND_ASSET_SLOTS) {
    const list = normalizeAssetList(rec[slot]);
    if (list.length > 0) out[slot] = list;
  }
  return out;
}

function normalizeWatermarkList(input: unknown): BrandingWatermark[] {
  if (!Array.isArray(input)) return [];
  const out: BrandingWatermark[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const w = normalizeWatermark(item);
    if (!w?.storagePath || seen.has(w.storagePath)) continue;
    seen.add(w.storagePath);
    out.push(w);
    if (out.length >= MAX_ASSET_HISTORY) break;
  }
  return out;
}

export function normalizeBrandingConfig(input: unknown): BrandingConfig {
  const d = createDefaultBrandingConfig();
  const b = (input ?? {}) as Partial<BrandingConfig>;
  const colors = (b.colors ?? {}) as Partial<BrandColors>;
  return {
    version: 1,
    brandName: str(b.brandName, d.brandName, 200),
    tagline: str(b.tagline, d.tagline, 200),
    logo: normalizeAsset(b.logo),
    logoDark: normalizeAsset(b.logoDark),
    icon: normalizeAsset(b.icon),
    favicon: normalizeAsset(b.favicon),
    ogImage: normalizeAsset(b.ogImage),
    colors: {
      primary: hex(colors.primary, d.colors.primary),
      accent: hex(colors.accent, d.colors.accent),
    },
    watermark: normalizeWatermark(b.watermark),
    assetHistory: normalizeAssetHistory(b.assetHistory),
    watermarkHistory: normalizeWatermarkList(b.watermarkHistory),
  };
}
