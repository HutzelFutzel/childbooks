/**
 * Admin overlay for structural page layouts (the `appConfig/layouts` document).
 *
 * The layouts themselves stay in code (`core/book/layouts`) — geometry is an
 * algorithm, not an opinion. This document carries everything *around* them:
 * titles, showcase images, which book sizes and quality tiers they're offered
 * on, which composition modes are allowed, and the tuning for the calm-region
 * check. Every field is optional and merged over the shipped defaults, so a
 * deployment that never opens the tab behaves exactly as shipped.
 *
 * The one rule that keeps this configurable rather than misconfigurable: admins
 * adjust *policy* (what is offered, what it's called, what it looks like), never
 * *geometry* (where the text sits), because geometry is what the image prompt is
 * compiled from and hand-editing it reintroduces the drift the compiler exists
 * to prevent.
 */
import { z } from "zod";
import type { BookSize } from "./options";
import type { ImageTier, ImageSlotRef } from "./modelConfig";
import type { CompositionMode, PageSide } from "../book/layouts";
import { capabilityOverridesSchema, type CapabilityOverrides } from "./modelCapabilities";
import {
  imageGenerationHintsSchema,
  type ImageGenerationHints,
} from "./imageGeneration";

/**
 * A showcase image for the layout picker.
 *
 * Tagged by shape and side because a layout genuinely looks different on a
 * portrait page than a landscape one, and different again on a left page than a
 * right one — and the book's size is already chosen by the time the picker is
 * shown, so the matching shot can be the one on screen.
 */
export interface LayoutExample {
  imageUrl: string;
  /** Storage path, so replacing an image can delete the old object. */
  storagePath?: string;
  alt?: string;
  shape?: BookSize;
  side?: PageSide;
  order: number;
  updatedAt: number;
}

export interface LayoutSizeRule {
  shapes?: BookSize[];
  trims?: { allow?: string[]; deny?: string[] };
}

export interface LayoutSlotOverride {
  /** Text preset id (see `ui/design/presets`). */
  presetId?: string;
  /** Region treatment id (see `core/book/treatments`). */
  treatmentId?: string;
}

export interface LayoutOverride {
  enabled?: boolean;
  label?: string;
  description?: string;
  /** Sort order in the picker (lower first); unset sorts last. */
  order?: number;
  sizes?: LayoutSizeRule;
  /** Force a layout off for a quality tier even when the model supports it. */
  tiers?: Partial<Record<ImageTier, boolean>>;
  modes?: { allowed?: CompositionMode[]; default?: CompositionMode };
  /**
   * Width of a new story text box as a share of the slot this layout reserves
   * for it (0.4..1). Unset uses the book-wide default. The slot itself, and so
   * the calm area the picture is asked for, is unchanged.
   */
  textWidth?: number;
  /** Per-slot visual defaults, keyed by `LayoutSlot.id`. */
  slots?: Record<string, LayoutSlotOverride>;
  /** Pin this layout to a specific model, falling back to the action binding. */
  imageBinding?: Partial<Record<ImageTier, ImageSlotRef>>;
  /** Best-effort provider-neutral output preferences for this layout. */
  imageGeneration?: ImageGenerationHints;
  examples?: LayoutExample[];
}

/** Tuning for the post-generation calm-region check. */
export interface LayoutQualityConfig {
  /**
   * How much visual busyness is tolerated where text sits, 0..1. Measured as
   * normalized luminance variance plus edge density over the text rectangle.
   */
  maxTextRegionBusyness?: number;
  /**
   * What to do when a region comes back busier than that:
   *   - `ignore`     — nothing.
   *   - `warn`       — record the measurement on the render only.
   *   - `scrim`      — lay the treatment's deterministic fallback under the text.
   *   - `retry-once` — redraw once with a larger calm area; if that is still
   *                    too busy, keep the calmer render and add the scrim.
   */
  onFail?: "ignore" | "warn" | "scrim" | "retry-once";
}

/**
 * Where the important subjects of a generated picture may go. Frames and print
 * trimming cut into the outer edge of the art, so a head drawn there is lost.
 */
export interface LayoutCompositionConfig {
  /** Share of each edge (0..0.25) kept free of faces and important subjects. */
  subjectSafeInset?: number;
  /**
   * Widen that margin to clear the book's frame — or, before a frame is chosen,
   * the widest frame a new book can be given — up to {@link maxSafeInset}.
   */
  frameAware?: boolean;
  /** Ceiling for a frame-derived margin, so one ornate frame can't shrink every picture. */
  maxSafeInset?: number;
  /**
   * How much larger than the text box (share of the page, 0..0.2) the calm area
   * is asked to be on the first attempt. Models undershoot reserved space.
   */
  calmOvershoot?: number;
  /** The same, for the one redraw after a failed calm-region check. */
  retryCalmOvershoot?: number;
  /**
   * How big the picture is on an interior page, as a share of the page
   * (0.7..1). 1 fills the page edge to edge; 0.95 shrinks it evenly about the
   * page centre so a thin strip of the page color shows on every side. Scaled
   * uniformly, so the picture is never cropped. Covers are always full size.
   */
  pictureScale?: number;
  /**
   * How wide a new story text box is, as a share of the area its layout
   * reserves for it (0.4..1). A layout can override this
   * ({@link LayoutOverride.textWidth}). Only boxes created from now on.
   */
  textWidth?: number;
}

export interface LayoutsConfig {
  version: 1;
  /** Keyed by `BOOK_LAYOUTS[].id`. */
  overrides: Record<string, LayoutOverride>;
  quality?: LayoutQualityConfig;
  composition?: LayoutCompositionConfig;
  /** Admin corrections to shipped image-model capabilities. */
  capabilities?: CapabilityOverrides;
}

export const DEFAULT_LAYOUT_QUALITY: Required<LayoutQualityConfig> = {
  maxTextRegionBusyness: 0.38,
  onFail: "retry-once",
};

export const DEFAULT_LAYOUT_COMPOSITION: Required<LayoutCompositionConfig> = {
  subjectSafeInset: 0.05,
  frameAware: true,
  maxSafeInset: 0.15,
  calmOvershoot: 0.04,
  retryCalmOvershoot: 0.12,
  pictureScale: 0.95,
  textWidth: 0.8,
};

/** Bounds the admin form and the resolvers share. */
export const PICTURE_SCALE_RANGE = { min: 0.7, max: 1 } as const;
export const TEXT_WIDTH_RANGE = { min: 0.4, max: 1 } as const;

export function createDefaultLayoutsConfig(): LayoutsConfig {
  return { version: 1, overrides: {} };
}

export function normalizeLayoutsConfig(input: unknown): LayoutsConfig {
  const stored = (input ?? {}) as Partial<LayoutsConfig>;
  return {
    version: 1,
    overrides: stored.overrides ?? {},
    ...(stored.quality ? { quality: stored.quality } : {}),
    ...(stored.composition ? { composition: stored.composition } : {}),
    ...(stored.capabilities ? { capabilities: stored.capabilities } : {}),
  };
}

export function resolveLayoutQuality(config?: LayoutsConfig | null): Required<LayoutQualityConfig> {
  return { ...DEFAULT_LAYOUT_QUALITY, ...(config?.quality ?? {}) };
}

const clampTo = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function resolveLayoutComposition(config?: LayoutsConfig | null): Required<LayoutCompositionConfig> {
  const c = config?.composition ?? {};
  const d = DEFAULT_LAYOUT_COMPOSITION;
  const subjectSafeInset = clampTo(c.subjectSafeInset, 0, 0.25, d.subjectSafeInset);
  return {
    subjectSafeInset,
    frameAware: typeof c.frameAware === "boolean" ? c.frameAware : d.frameAware,
    maxSafeInset: Math.max(subjectSafeInset, clampTo(c.maxSafeInset, 0, 0.3, d.maxSafeInset)),
    calmOvershoot: clampTo(c.calmOvershoot, 0, 0.2, d.calmOvershoot),
    retryCalmOvershoot: clampTo(c.retryCalmOvershoot, 0, 0.3, d.retryCalmOvershoot),
    pictureScale: clampTo(c.pictureScale, PICTURE_SCALE_RANGE.min, PICTURE_SCALE_RANGE.max, d.pictureScale),
    textWidth: clampTo(c.textWidth, TEXT_WIDTH_RANGE.min, TEXT_WIDTH_RANGE.max, d.textWidth),
  };
}

/** Width of a new story text box, as a share of its slot, for one layout. */
export function resolveTextWidth(config: LayoutsConfig | null | undefined, layoutId: string): number {
  const own = config?.overrides[layoutId]?.textWidth;
  if (typeof own === "number" && Number.isFinite(own)) {
    return Math.min(TEXT_WIDTH_RANGE.max, Math.max(TEXT_WIDTH_RANGE.min, own));
  }
  return resolveLayoutComposition(config).textWidth;
}

/** Showcase images for a layout, best match for the page shape first. */
export function examplesForLayout(
  config: LayoutsConfig | null | undefined,
  layoutId: string,
  shape?: BookSize,
): LayoutExample[] {
  const all = [...(config?.overrides[layoutId]?.examples ?? [])].sort((a, b) => a.order - b.order);
  if (!shape) return all;
  const matching = all.filter((e) => !e.shape || e.shape === shape);
  return matching.length > 0 ? matching : all;
}

// ---- Validation ------------------------------------------------------------

const bookSizeEnum = z.enum(["square", "landscape", "portrait"]);
const pageSideEnum = z.enum(["left", "right", "spread"]);
const compositionModeEnum = z.enum(["full-bleed", "inset-art"]);
const imageSlotRefSchema = z.object({
  provider: z.enum(["openai", "google"]),
  speed: z.enum(["fast", "slow"]),
});

const layoutExampleSchema = z.object({
  imageUrl: z.string().url(),
  storagePath: z.string().optional(),
  alt: z.string().max(300).optional(),
  shape: bookSizeEnum.optional(),
  side: pageSideEnum.optional(),
  order: z.number().int().min(0).max(999),
  updatedAt: z.number(),
});

const layoutOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(600).optional(),
  order: z.number().int().min(0).max(999).optional(),
  sizes: z
    .object({
      shapes: z.array(bookSizeEnum).optional(),
      trims: z
        .object({
          allow: z.array(z.string().max(40)).optional(),
          deny: z.array(z.string().max(40)).optional(),
        })
        .optional(),
    })
    .optional(),
  tiers: z.record(z.enum(["quick", "premium"]), z.boolean()).optional(),
  textWidth: z.number().min(0.4).max(1).optional(),
  modes: z
    .object({
      allowed: z.array(compositionModeEnum).min(1).optional(),
      default: compositionModeEnum.optional(),
    })
    .optional(),
  slots: z
    .record(
      z.string().max(60),
      z.object({ presetId: z.string().max(60).optional(), treatmentId: z.string().max(60).optional() }),
    )
    .optional(),
  imageBinding: z.record(z.enum(["quick", "premium"]), imageSlotRefSchema).optional(),
  imageGeneration: imageGenerationHintsSchema.optional(),
  examples: z.array(layoutExampleSchema).max(24).optional(),
});

export const layoutsConfigSchema = z.object({
  version: z.literal(1),
  overrides: z.record(z.string().max(60), layoutOverrideSchema),
  quality: z
    .object({
      maxTextRegionBusyness: z.number().min(0).max(1).optional(),
      onFail: z.enum(["ignore", "warn", "scrim", "retry-once"]).optional(),
    })
    .optional(),
  composition: z
    .object({
      subjectSafeInset: z.number().min(0).max(0.25).optional(),
      frameAware: z.boolean().optional(),
      maxSafeInset: z.number().min(0).max(0.3).optional(),
      calmOvershoot: z.number().min(0).max(0.2).optional(),
      retryCalmOvershoot: z.number().min(0).max(0.3).optional(),
      pictureScale: z.number().min(0.7).max(1).optional(),
      textWidth: z.number().min(0.4).max(1).optional(),
    })
    .optional(),
  // Owned by `modelCapabilities.ts`, which is the only module that knows what
  // an image model can do — restating its fields here is how the two drifted.
  capabilities: capabilityOverridesSchema.optional(),
});
