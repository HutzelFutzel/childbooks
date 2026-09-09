/**
 * Reusable, admin-managed image shapes.
 *
 * Each upload is immutable: its id identifies one exact SVG forever. Renaming
 * or archiving only changes catalog presentation, so an existing book cannot
 * silently change when an admin curates the picker.
 */
import { z } from "zod";

export interface ImageMaskAsset {
  /** Immutable revision id, stored on ImageElement. */
  id: string;
  name: string;
  /** Public URL of the alpha-normalized mask compiled from the uploaded SVG. */
  imageUrl: string;
  storagePath: string;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ImageMasksConfig {
  version: 1;
  assets: ImageMaskAsset[];
}

export function createDefaultImageMasksConfig(): ImageMasksConfig {
  return { version: 1, assets: [] };
}

export function normalizeImageMasksConfig(input: unknown): ImageMasksConfig {
  const stored = (input ?? {}) as Partial<ImageMasksConfig>;
  const seen = new Set<string>();
  const assets = (Array.isArray(stored.assets) ? stored.assets : [])
    .filter((asset): asset is ImageMaskAsset => {
      if (!asset || typeof asset.id !== "string" || seen.has(asset.id)) return false;
      if (typeof asset.name !== "string" || typeof asset.imageUrl !== "string") return false;
      if (typeof asset.storagePath !== "string") return false;
      seen.add(asset.id);
      return true;
    })
    .slice(0, 200)
    .sort((a, b) => a.createdAt - b.createdAt);
  return { version: 1, assets };
}

export function activeImageMasks(config: ImageMasksConfig): ImageMaskAsset[] {
  return config.assets.filter((asset) => !asset.archived);
}

export function imageMaskById(
  config: ImageMasksConfig,
  id: string | undefined,
): ImageMaskAsset | undefined {
  return id ? config.assets.find((asset) => asset.id === id) : undefined;
}

/** One active catalog frame, or undefined when none are configured. */
export function pickRandomActiveMaskId(config: ImageMasksConfig): string | undefined {
  const active = activeImageMasks(config);
  if (active.length === 0) return undefined;
  return active[Math.floor(Math.random() * active.length)].id;
}

const imageMaskAssetSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  imageUrl: z.string().url(),
  storagePath: z.string().min(1).max(500),
  archived: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const imageMasksConfigSchema = z.object({
  version: z.literal(1),
  assets: z.array(imageMaskAssetSchema).max(200),
});
