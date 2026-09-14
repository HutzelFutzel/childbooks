import type { ImageActionId } from "../ai/actions";
import type { ModelSelection } from "../types";
import type { ActionGenerationTuning } from "./generationTuning";
import type { ImageTier } from "./modelConfig";

/** User-visible shapes that have materially different latency and cost. */
export type GenerationRenderKind =
  | "fresh"
  | "edit"
  | "variation"
  | "restyle"
  | "continuation";

/**
 * Configuration known before a render starts. The same shape is attached to
 * completed runs, so estimates never have to compare different quality modes.
 */
export interface GenerationEstimateProfile {
  version: 1;
  modelKey: string;
  renderKind: GenerationRenderKind;
  quality: ActionGenerationTuning["quality"];
  inputFidelity: ActionGenerationTuning["inputFidelity"];
  outputFormat: ActionGenerationTuning["outputFormat"];
  outputCompression: number | null;
  outputSize: string;
  referenceCount: string;
  billableImages: string;
  referenceEncoding: string;
  latencyPolicy: string;
}

export function generationRenderKindOf(
  options:
    | {
        restyle?: boolean;
        useReference?: boolean;
        edit?: string;
        mask?: unknown;
        continuation?: boolean;
      }
    | undefined,
): GenerationRenderKind {
  if (options?.continuation) return "continuation";
  if (options?.restyle) return "restyle";
  if (options?.mask || options?.edit?.trim()) return "edit";
  if (options?.useReference) return "variation";
  return "fresh";
}

function countBucket(value: number | undefined): string {
  if (value === undefined) return "unknown";
  if (value <= 0) return "0";
  if (value <= 2) return value === 1 ? "1" : "2";
  if (value <= 4) return "3-4";
  return "5+";
}

export function createGenerationEstimateProfile(args: {
  model: ModelSelection;
  tuning: ActionGenerationTuning;
  kind: GenerationRenderKind;
  outputSize?: string;
  referenceCount?: number;
  billableImages?: number;
}): GenerationEstimateProfile {
  const { model, tuning, kind } = args;
  const qc = tuning.qualityControl;
  return {
    version: 1,
    modelKey: `${model.provider}:${model.id}`,
    renderKind: kind,
    quality: tuning.quality,
    inputFidelity: tuning.inputFidelity,
    outputFormat: tuning.outputFormat,
    outputCompression: tuning.outputCompression,
    outputSize: args.outputSize ?? "unknown",
    referenceCount: countBucket(args.referenceCount),
    billableImages: countBucket(args.billableImages),
    referenceEncoding: `n${tuning.references.maxImages}-d${tuning.references.maxDimension}-e${tuning.references.encodingQuality}`,
    latencyPolicy: [
      `retry${tuning.retries}`,
      `budget${qc.budgetMs}`,
      `calls${qc.maxImageCalls}`,
      `bind${Number(qc.bindingPass)}`,
      `dup${qc.duplicateRepairLimit}`,
      `embed${qc.embeddedRepairLimit}`,
      `grid${Number(qc.gridCheck)}`,
      `flat${Number(qc.flattenBackground)}`,
      `repair-${qc.repairQuality}`,
    ].join("-"),
  };
}

export function completeGenerationEstimateProfile(
  profile: GenerationEstimateProfile,
  actual: {
    outputSize?: string;
    referenceCount?: number;
    billableImages?: number;
  },
): GenerationEstimateProfile {
  return {
    ...profile,
    outputSize: actual.outputSize ?? profile.outputSize,
    referenceCount: countBucket(actual.referenceCount),
    billableImages: countBucket(actual.billableImages),
  };
}

function baseProfileValue(profile: GenerationEstimateProfile): string {
  return [
    profile.modelKey,
    profile.renderKind,
    profile.quality,
    profile.inputFidelity,
    profile.outputFormat,
    profile.outputCompression ?? "default",
    profile.outputSize,
    profile.referenceCount,
    profile.billableImages,
    profile.referenceEncoding,
  ].map((part) => encodeURIComponent(String(part))).join("~");
}

/** Cost excludes QC policy because repair calls are explicitly non-billable. */
export function costProfileKey(profile: GenerationEstimateProfile): string {
  return `p1-${baseProfileValue(profile)}`;
}

/** Latency includes QC/retry policy because those steps extend wall time. */
export function latencyProfileKey(profile: GenerationEstimateProfile): string {
  return `p1-${baseProfileValue(profile)}~${encodeURIComponent(profile.latencyPolicy)}`;
}

export function estimateProfileForAction(args: {
  action: ImageActionId;
  tier: ImageTier;
  model: ModelSelection;
  tuning: ActionGenerationTuning;
  kind: GenerationRenderKind;
  outputSize?: string;
  referenceCount?: number;
  billableImages?: number;
}): GenerationEstimateProfile {
  // `action` and `tier` live in the surrounding stats key; accepting them here
  // makes accidental profile construction without those quote dimensions hard.
  void args.action;
  void args.tier;
  return createGenerationEstimateProfile(args);
}
