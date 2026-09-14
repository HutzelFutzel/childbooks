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
  quality?: ImageQuality;
  format?: ImageFormat;
  inputFidelity?: "low" | "high";
  outputCompression?: number;
}

export const imageGenerationHintsSchema = z.object({
  background: z
    .enum(["default", "prefer-transparent"])
    .optional(),
  quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).optional(),
  format: z.enum(["png", "webp", "jpeg"]).optional(),
  inputFidelity: z.enum(["low", "high"]).optional(),
  outputCompression: z.number().int().min(0).max(100).optional(),
});

export type ImageGenerationIntent = ImageGenerationHints;

export interface ResolvedImageGenerationOptions {
  requested: ImageGenerationIntent;
  applied: {
    background?: "transparent";
    format?: ImageFormat;
    quality?: ImageQuality;
    inputFidelity?: "low" | "high";
    outputCompression?: number;
  };
  skipped: Array<
    "transparent-background" |
    "output-format" |
    "quality" |
    "input-fidelity" |
    "output-compression"
  >;
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

  if (intent.inputFidelity) {
    if (capabilities.inputs.inputFidelityLevels.includes(intent.inputFidelity)) {
      applied.inputFidelity = intent.inputFidelity;
    } else {
      skipped.push("input-fidelity");
    }
  }

  if (intent.outputCompression !== undefined) {
    if (
      capabilities.outputs.compression &&
      (applied.format === "jpeg" || applied.format === "webp")
    ) {
      applied.outputCompression = intent.outputCompression;
    } else {
      skipped.push("output-compression");
    }
  }

  return { requested: intent, applied, skipped };
}
