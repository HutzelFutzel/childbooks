/**
 * Global, admin-managed **branding** — currently the share watermark.
 *
 * The watermark is a single SVG (or image) uploaded to public storage and
 * referenced here by URL, so it can be replaced at any time from the admin UI
 * without a deploy. Stored at the world-readable `appConfig/branding` doc and
 * read live by the client + the public book viewer.
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

export interface BrandingConfig {
  version: 1;
  /** The share watermark, or null when none is configured. */
  watermark: BrandingWatermark | null;
}

export function createDefaultBrandingConfig(): BrandingConfig {
  return { version: 1, watermark: null };
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normalizeBrandingConfig(input: unknown): BrandingConfig {
  const b = (input ?? {}) as Partial<BrandingConfig>;
  const w = b.watermark as Partial<BrandingWatermark> | null | undefined;
  if (!w || typeof w.imageUrl !== "string" || !w.imageUrl) {
    return { version: 1, watermark: null };
  }
  return {
    version: 1,
    watermark: {
      imageUrl: w.imageUrl,
      storagePath: typeof w.storagePath === "string" ? w.storagePath : undefined,
      opacity: clamp(w.opacity, 0, 1, 0.5),
      scale: clamp(w.scale, 0.05, 1, 0.25),
      updatedAt: typeof w.updatedAt === "number" ? w.updatedAt : Date.now(),
    },
  };
}
