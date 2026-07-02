/**
 * Admin overlay for art-style presets (the `appConfig/artStyles` document).
 *
 * The base presets stay in `core/config/options` (`ART_STYLE_PRESETS`); this
 * document attaches an example image and optional prompt overrides by preset id.
 * The setup wizard shows the image when present and falls back to the gradient
 * swatch otherwise.
 */
import { z } from "zod";

export interface ArtStyleExample {
  /** Public URL of the uploaded example image. */
  imageUrl: string;
  /** Storage path (so the backend can replace/delete it). */
  storagePath?: string;
  updatedAt: number;
}

export interface ArtStylePromptDescription {
  text: string;
  updatedAt: number;
}

export interface ArtStylesConfig {
  version: 1;
  /** Keyed by ART_STYLE_PRESETS[].id. */
  examples: Record<string, ArtStyleExample>;
  /** Admin overrides for the full image-generation style description. */
  promptDescriptions: Record<string, ArtStylePromptDescription>;
}

export function createDefaultArtStylesConfig(): ArtStylesConfig {
  return { version: 1, examples: {}, promptDescriptions: {} };
}

export function normalizeArtStylesConfig(input: unknown): ArtStylesConfig {
  const stored = (input ?? {}) as Partial<ArtStylesConfig>;
  return {
    version: 1,
    examples: stored.examples ?? {},
    promptDescriptions: stored.promptDescriptions ?? {},
  };
}

export const artStylesConfigSchema = z.object({
  version: z.literal(1),
  examples: z.record(
    z.string(),
    z.object({
      imageUrl: z.string().url(),
      storagePath: z.string().optional(),
      updatedAt: z.number(),
    }),
  ),
  promptDescriptions: z.record(
    z.string(),
    z.object({
      text: z.string().min(1).max(8000),
      updatedAt: z.number(),
    }),
  ),
});
