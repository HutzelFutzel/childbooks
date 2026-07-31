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
import type { CapabilityOverrides } from "./modelCapabilities";

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
  /** Per-slot visual defaults, keyed by `LayoutSlot.id`. */
  slots?: Record<string, LayoutSlotOverride>;
  /** Pin this layout to a specific model, falling back to the action binding. */
  imageBinding?: Partial<Record<ImageTier, ImageSlotRef>>;
  examples?: LayoutExample[];
}

/** Tuning for the post-generation calm-region check. */
export interface LayoutQualityConfig {
  /**
   * How much visual busyness is tolerated where text sits, 0..1. Measured as
   * normalized luminance variance plus edge density over the text rectangle.
   */
  maxTextRegionBusyness?: number;
  /** What to do when a region comes back busier than that. */
  onFail?: "ignore" | "warn" | "scrim" | "retry-once";
}

export interface LayoutsConfig {
  version: 1;
  /** Keyed by `BOOK_LAYOUTS[].id`. */
  overrides: Record<string, LayoutOverride>;
  quality?: LayoutQualityConfig;
  /** Admin corrections to shipped image-model capabilities. */
  capabilities?: CapabilityOverrides;
}

export const DEFAULT_LAYOUT_QUALITY: Required<LayoutQualityConfig> = {
  maxTextRegionBusyness: 0.38,
  onFail: "warn",
};

export function createDefaultLayoutsConfig(): LayoutsConfig {
  return { version: 1, overrides: {} };
}

export function normalizeLayoutsConfig(input: unknown): LayoutsConfig {
  const stored = (input ?? {}) as Partial<LayoutsConfig>;
  return {
    version: 1,
    overrides: stored.overrides ?? {},
    ...(stored.quality ? { quality: stored.quality } : {}),
    ...(stored.capabilities ? { capabilities: stored.capabilities } : {}),
  };
}

export function resolveLayoutQuality(config?: LayoutsConfig | null): Required<LayoutQualityConfig> {
  return { ...DEFAULT_LAYOUT_QUALITY, ...(config?.quality ?? {}) };
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
  capabilities: z
    .record(
      z.string().max(120),
      z.object({
        maskEditing: z.boolean().optional(),
        maxReferenceImages: z.number().int().min(1).max(32).optional(),
        exactPixelSize: z.boolean().optional(),
        aspectRatios: z.array(z.number().positive().max(10)).min(1).max(24).optional(),
        negativeSpaceControl: z.enum(["weak", "strong"]).optional(),
        textRendering: z.enum(["none", "weak", "strong"]).optional(),
      }),
    )
    .optional(),
});
