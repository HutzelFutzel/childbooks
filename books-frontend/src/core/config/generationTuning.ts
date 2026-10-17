/**
 * Operational image-generation controls managed from the admin dashboard.
 *
 * These are product policy, not model capability facts: capability discovery
 * says what a model accepts; this config says how much latency and fidelity the
 * product chooses to spend. The writable source lives at
 * `adminSettings/generationTuning`; a read-only public projection lets the
 * studio calculate the same estimate profile as the server.
 */
import { z } from "zod";
import { ALL_IMAGE_ACTION_IDS, type ImageActionId } from "../ai/actions";
import {
  IMAGE_FORMATS,
  IMAGE_QUALITIES,
  type ImageFormat,
  type ImageModelCapabilities,
  type ImageQuality,
} from "./modelCapabilities";
import type { ImageGenerationIntent } from "./imageGeneration";

export const PROVIDER_DEFAULT = "provider-default" as const;

export type ImageQualitySetting = ImageQuality | typeof PROVIDER_DEFAULT;
export type ImageFormatSetting = ImageFormat | typeof PROVIDER_DEFAULT;

export interface ActionGenerationTuning {
  quality: ImageQualitySetting;
  outputFormat: ImageFormatSetting;
  /** JPEG/WebP output compression. Null leaves the provider default untouched. */
  outputCompression: number | null;
  /** Number of retries after the first image request fails. */
  retries: number;
  references: {
    maxImages: number;
    maxDimension: number;
    encodingQuality: number;
  };
  qualityControl: {
    /** Total wall-clock budget for optional post-render checks and repairs. */
    budgetMs: number;
    /** Maximum post-render provider attempts; vision checks do not consume this cap. */
    maxImageCalls: number;
    bindingPass: boolean;
    duplicateRepairLimit: number;
    embeddedRepairLimit: number;
    gridCheck: boolean;
    /** Inspect a finished portrait and redraw once when identity, style or composition clearly misses. */
    portraitCheck: boolean;
    flattenBackground: boolean;
    repairQuality: ImageQuality;
  };
}

export interface GenerationTuningConfig {
  version: 1;
  actions: Record<ImageActionId, ActionGenerationTuning>;
  execution: {
    /** Parallelism for independent surgical operations on different subjects. */
    surgicalConcurrency: number;
  };
}

const referenceSchema = z.object({
  maxImages: z.number().int().min(0).max(64),
  maxDimension: z.number().int().min(256).max(4096),
  encodingQuality: z.number().int().min(40).max(100),
});

const qualityControlSchema = z.object({
  budgetMs: z.number().int().min(0).max(180_000),
  maxImageCalls: z.number().int().min(0).max(12),
  bindingPass: z.boolean(),
  duplicateRepairLimit: z.number().int().min(0).max(8),
  embeddedRepairLimit: z.number().int().min(0).max(8),
  gridCheck: z.boolean(),
  portraitCheck: z.boolean(),
  flattenBackground: z.boolean(),
  repairQuality: z.enum(IMAGE_QUALITIES),
});

export const actionGenerationTuningSchema = z.object({
  quality: z.enum([PROVIDER_DEFAULT, ...IMAGE_QUALITIES]),
  outputFormat: z.enum([PROVIDER_DEFAULT, ...IMAGE_FORMATS]),
  outputCompression: z.number().int().min(0).max(100).nullable(),
  retries: z.number().int().min(0).max(2),
  references: referenceSchema,
  qualityControl: qualityControlSchema,
}).superRefine((config, ctx) => {
  if (
    config.outputCompression !== null &&
    config.outputFormat !== "jpeg" &&
    config.outputFormat !== "webp"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["outputCompression"],
      message: "Output compression requires an explicit JPEG or WebP format.",
    });
  }
});

export const generationTuningConfigSchema = z.object({
  version: z.literal(1),
  actions: z.object({
    anchorImage: actionGenerationTuningSchema,
    pageIllustration: actionGenerationTuningSchema,
    coverIllustration: actionGenerationTuningSchema,
    portrait: actionGenerationTuningSchema,
  }),
  execution: z.object({
    surgicalConcurrency: z.number().int().min(1).max(6),
  }),
}).superRefine((config, ctx) => {
  for (const action of ["pageIllustration", "coverIllustration"] as const) {
    const qc = config.actions[action].qualityControl;
    if (!qc.bindingPass && (qc.duplicateRepairLimit > 0 || qc.embeddedRepairLimit > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["actions", action, "qualityControl", "bindingPass"],
        message: "Subject binding must be enabled before page or cover cleanup can run.",
      });
    }
  }
});

/**
 * Most reference images a front or back cover sends. A cover shows its few main
 * characters and one place, and every extra sheet slows the painting that the
 * lettering check may ask to be repeated. Applied to stored settings too, so an
 * old "send everything" value can't slow covers down.
 */
export const COVER_MAX_REFERENCE_IMAGES = 6;

function actionDefaults(
  action: ImageActionId,
): ActionGenerationTuning {
  const anchor = action === "anchorImage";
  const cover = action === "coverIllustration";
  const portrait = action === "portrait";
  return {
    quality: PROVIDER_DEFAULT,
    outputFormat: PROVIDER_DEFAULT,
    outputCompression: null,
    retries: 1,
    references: {
      maxImages: cover ? COVER_MAX_REFERENCE_IMAGES : 64,
      maxDimension: 1024,
      encodingQuality: 80,
    },
    qualityControl: {
      // Optional QC must not be allowed to consume the worker's entire
      // four-minute request budget after the primary image already exists.
      budgetMs: anchor ? 60_000 : 45_000,
      maxImageCalls: 2,
      bindingPass: !anchor && !portrait,
      duplicateRepairLimit: anchor || portrait ? 0 : cover ? 1 : 2,
      embeddedRepairLimit: portrait ? 0 : 1,
      gridCheck: anchor,
      portraitCheck: portrait,
      flattenBackground: anchor,
      repairQuality: "low",
    },
  };
}

export function createDefaultGenerationTuningConfig(): GenerationTuningConfig {
  return {
    version: 1,
    actions: {
      anchorImage: actionDefaults("anchorImage"),
      pageIllustration: actionDefaults("pageIllustration"),
      coverIllustration: actionDefaults("coverIllustration"),
      portrait: actionDefaults("portrait"),
    },
    execution: { surgicalConcurrency: 3 },
  };
}

/** Merge older/partial stored documents onto current safe defaults. */
export function normalizeGenerationTuningConfig(
  input: unknown,
): GenerationTuningConfig {
  const defaults = createDefaultGenerationTuningConfig();
  const raw = input && typeof input === "object"
    ? input as Partial<GenerationTuningConfig>
    : {};
  const rawActions =
    (raw.actions as Partial<Record<ImageActionId, Partial<ActionGenerationTuning>>> | undefined) ??
    {};
  const actions = {} as Record<ImageActionId, ActionGenerationTuning>;

  for (const action of ALL_IMAGE_ACTION_IDS) {
    const base = defaults.actions[action];
    const stored = rawActions[action] as Partial<ActionGenerationTuning> | undefined;
    actions[action] = {
      ...base,
      ...stored,
      references: { ...base.references, ...(stored?.references ?? {}) },
      qualityControl: {
        ...base.qualityControl,
        ...(stored?.qualityControl ?? {}),
      },
    };
    if (action === "coverIllustration") {
      actions[action].references.maxImages = Math.min(
        actions[action].references.maxImages,
        COVER_MAX_REFERENCE_IMAGES,
      );
    }
  }

  const parsed = generationTuningConfigSchema.safeParse({
    version: 1,
    actions,
    execution: { ...defaults.execution, ...(raw.execution ?? {}) },
  });
  return parsed.success ? parsed.data : defaults;
}

export function generationTuningFor(
  config: GenerationTuningConfig | undefined,
  action: ImageActionId,
): ActionGenerationTuning {
  return (config ?? createDefaultGenerationTuningConfig()).actions[action];
}

export function configuredQuality(
  value: ImageQualitySetting,
): ImageQuality | undefined {
  return value === PROVIDER_DEFAULT ? undefined : value;
}

export function configuredFormat(
  value: ImageFormatSetting,
): ImageFormat | undefined {
  return value === PROVIDER_DEFAULT ? undefined : value;
}

export function generationIntentFor(
  tuning: ActionGenerationTuning,
): ImageGenerationIntent {
  return {
    quality: configuredQuality(tuning.quality),
    format: configuredFormat(tuning.outputFormat),
    ...(tuning.outputCompression === null
      ? {}
      : { outputCompression: tuning.outputCompression }),
  };
}

/**
 * What the admin may pick for an action: only what the model it draws with
 * accepts. `null` means no model is bound yet, so nothing can be ruled out.
 */
export function tuningChoicesFor(capabilities: ImageModelCapabilities | null): {
  qualities: ImageQuality[];
  formats: ImageFormat[];
  compression: boolean;
} {
  return capabilities
    ? {
        qualities: [...capabilities.outputs.qualityLevels],
        formats: [...capabilities.outputs.formats],
        compression: capabilities.outputs.compression,
      }
    : { qualities: [...IMAGE_QUALITIES], formats: [...IMAGE_FORMATS], compression: true };
}

/**
 * Put back to the provider default anything the model cannot take, so a model
 * change or an old saved value never leaves an invalid setting in place.
 * `reset` names each setting that changed, for the admin to see.
 */
export function clampTuningToModel(
  tuning: ActionGenerationTuning,
  capabilities: ImageModelCapabilities | null,
): { tuning: ActionGenerationTuning; reset: string[] } {
  if (!capabilities) return { tuning, reset: [] };
  const choices = tuningChoicesFor(capabilities);
  const reset: string[] = [];
  const next: ActionGenerationTuning = {
    ...tuning,
    qualityControl: { ...tuning.qualityControl },
  };
  if (next.quality !== PROVIDER_DEFAULT && !choices.qualities.includes(next.quality)) {
    reset.push(`Image quality (${next.quality})`);
    next.quality = PROVIDER_DEFAULT;
  }
  if (next.outputFormat !== PROVIDER_DEFAULT && !choices.formats.includes(next.outputFormat)) {
    reset.push(`Output format (${next.outputFormat})`);
    next.outputFormat = PROVIDER_DEFAULT;
    next.outputCompression = null;
  }
  if (next.outputCompression !== null && !choices.compression) {
    reset.push("Lossy compression");
    next.outputCompression = null;
  }
  const repair = next.qualityControl.repairQuality;
  if (choices.qualities.length > 0 && !choices.qualities.includes(repair)) {
    reset.push(`Repair quality (${repair})`);
    next.qualityControl.repairQuality = choices.qualities.includes("low") ? "low" : choices.qualities[0];
  }
  return { tuning: reset.length > 0 ? next : tuning, reset };
}
