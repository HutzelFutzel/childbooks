/**
 * What each image model can actually do.
 *
 * Model behaviour is knowledge that changes faster than deploys, so the shipped
 * table is only a default: an admin can correct any entry from the model config
 * without waiting for a release. Code asks this module rather than testing the
 * provider id, which is how `provider === "openai"` checks scattered through the
 * pipeline become one auditable table.
 */
import { z } from "zod";
import type { ProviderId } from "./options";
import type { ModelSelection } from "../types";

export interface ImageModelCapabilities {
  /** Accepts an alignment mask, so a region can be edited in place. */
  maskEditing: boolean;
  /** How many reference images can be attached to one request. */
  maxReferenceImages: number;
  /** Honours an exact pixel size (vs. snapping to an aspect-ratio bucket). */
  exactPixelSize: boolean;
  /**
   * Aspect ratios the model can actually produce. OpenAI accepts three fixed
   * canvas sizes; Gemini snaps to nine ratio buckets — which means the cheaper
   * model can fit an unusual art rectangle *more* closely than the premium one.
   */
  aspectRatios: number[];
  /**
   * How reliably the model honours "keep this region calm". `weak` models get
   * the deterministic post-processed treatment instead of the painted one.
   */
  negativeSpaceControl: "weak" | "strong";
  /** How well it renders legible words (only matters for baked cover text). */
  textRendering: "none" | "weak" | "strong";
}

const OPENAI_RATIOS = [1024 / 1536, 1, 1536 / 1024];
const GEMINI_RATIOS = [21 / 9, 16 / 9, 3 / 2, 4 / 3, 5 / 4, 1, 4 / 5, 3 / 4, 2 / 3, 9 / 16];

/** Per-provider baseline, used when no model-specific entry matches. */
const PROVIDER_DEFAULTS: Record<ProviderId, ImageModelCapabilities> = {
  openai: {
    maskEditing: true,
    maxReferenceImages: 8,
    exactPixelSize: true,
    aspectRatios: OPENAI_RATIOS,
    negativeSpaceControl: "strong",
    textRendering: "strong",
  },
  google: {
    // The Gemini image endpoint takes no mask; regional edits are done by
    // regenerating the frame and compositing the region ourselves.
    maskEditing: false,
    maxReferenceImages: 8,
    exactPixelSize: false,
    aspectRatios: GEMINI_RATIOS,
    negativeSpaceControl: "weak",
    textRendering: "weak",
  },
};

/** Model-id substring → overrides on top of the provider baseline. */
const MODEL_OVERRIDES: { provider: ProviderId; match: string; caps: Partial<ImageModelCapabilities> }[] = [
  // The mini tier trades instruction-following for speed and cost.
  { provider: "openai", match: "mini", caps: { negativeSpaceControl: "weak", textRendering: "weak" } },
  { provider: "google", match: "pro", caps: { negativeSpaceControl: "strong" } },
];

/** Key an admin override is stored under. */
export function capabilityKey(provider: ProviderId, modelId: string): string {
  return `${provider}:${modelId}`;
}

export type CapabilityOverrides = Record<string, Partial<ImageModelCapabilities>>;

/**
 * Resolve a model's capabilities: provider baseline, then any shipped
 * model-specific correction, then the admin override for that exact model.
 */
export function capabilitiesFor(
  selection: ModelSelection | null | undefined,
  overrides?: CapabilityOverrides,
): ImageModelCapabilities {
  const provider: ProviderId = selection?.provider ?? "openai";
  const base = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openai;
  const id = (selection?.id ?? "").toLowerCase();
  let caps: ImageModelCapabilities = { ...base };
  for (const o of MODEL_OVERRIDES) {
    if (o.provider === provider && id.includes(o.match)) caps = { ...caps, ...o.caps };
  }
  const admin = selection ? overrides?.[capabilityKey(provider, selection.id)] : undefined;
  return admin ? { ...caps, ...admin } : caps;
}

/** The closest aspect ratio a model can produce, and how far off it is. */
export function nearestAspect(
  caps: ImageModelCapabilities,
  target: number,
): { ratio: number; error: number } {
  let best = caps.aspectRatios[0] ?? 1;
  for (const r of caps.aspectRatios) {
    if (Math.abs(r - target) < Math.abs(best - target)) best = r;
  }
  return { ratio: best, error: Math.abs(best - target) / target };
}

export const imageCapabilitiesSchema = z
  .object({
    maskEditing: z.boolean(),
    maxReferenceImages: z.number().int().min(1).max(32),
    exactPixelSize: z.boolean(),
    aspectRatios: z.array(z.number().positive().max(10)).min(1).max(24),
    negativeSpaceControl: z.enum(["weak", "strong"]),
    textRendering: z.enum(["none", "weak", "strong"]),
  })
  .partial();
