/**
 * Provider-neutral image-generation intent.
 *
 * Product surfaces describe what they would like; the server intersects that
 * intent with the concrete model's capabilities before an adapter sees it.
 * This keeps layouts and art styles independent from provider request shapes.
 */
import type {
  ImageFormat,
  ImageModelCapabilities,
  ImageQuality,
} from "./modelCapabilities";
import { z } from "zod";

export type ImageBackgroundIntent =
  | "default"
  | "prefer-transparent";

export interface ImageGenerationHints {
  background?: ImageBackgroundIntent;
}

export const imageGenerationHintsSchema = z.object({
  background: z
    .enum(["default", "prefer-transparent"])
    .optional(),
});

export interface ImageGenerationIntent extends ImageGenerationHints {
  quality?: ImageQuality;
  format?: ImageFormat;
}

export interface ResolvedImageGenerationOptions {
  requested: ImageGenerationIntent;
  applied: {
    background?: "transparent";
    format?: ImageFormat;
    quality?: ImageQuality;
  };
  skipped: Array<"transparent-background" | "output-format" | "quality">;
}

/** Merge broad defaults first and the more specific surface last. */
export function mergeImageGenerationHints(
  ...hints: Array<ImageGenerationHints | null | undefined>
): ImageGenerationHints {
  return hints.reduce<ImageGenerationHints>(
    (resolved, hint) => ({ ...resolved, ...(hint ?? {}) }),
    {},
  );
}

/**
 * Turn a best-effort product intent into options an adapter may safely send.
 * Unsupported preferences are omitted, never translated into prompt text:
 * asking an opaque-only model for "transparency" often draws a checkerboard.
 */
export function resolveImageGenerationOptions(
  capabilities: ImageModelCapabilities,
  intent: ImageGenerationIntent = {},
): ResolvedImageGenerationOptions {
  const applied: ResolvedImageGenerationOptions["applied"] = {};
  const skipped: ResolvedImageGenerationOptions["skipped"] = [];
  const background = intent.background ?? "default";

  if (background !== "default") {
    const transparentFormat =
      intent.format &&
      intent.format !== "jpeg" &&
      capabilities.outputs.formats.includes(intent.format)
        ? intent.format
        : capabilities.outputs.formats.includes("png")
          ? "png"
          : capabilities.outputs.formats.includes("webp")
            ? "webp"
            : undefined;
    if (
      capabilities.outputs.backgrounds.includes("transparent") &&
      transparentFormat
    ) {
      applied.background = "transparent";
      applied.format = transparentFormat;
    } else {
      skipped.push("transparent-background");
    }
  }

  if (!applied.format && intent.format) {
    if (capabilities.outputs.formats.includes(intent.format)) {
      applied.format = intent.format;
    } else {
      skipped.push("output-format");
    }
  }

  if (intent.quality) {
    if (capabilities.outputs.qualityLevels.includes(intent.quality)) {
      applied.quality = intent.quality;
    } else {
      skipped.push("quality");
    }
  }

  return { requested: intent, applied, skipped };
}
