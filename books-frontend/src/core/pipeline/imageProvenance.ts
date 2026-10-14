/**
 * Stamp the quality tier + concrete model onto a render before it is folded
 * into a version tree. Kept at the host boundary (AI endpoints / job workers)
 * so every return path from the pipeline inherits provenance without touching
 * each surgical render branch.
 */
import type { ImageTier } from "../config/modelConfig";
import type { ResolvedImageGenerationOptions } from "../config/imageGeneration";
import { styleStampOf } from "../prompts/style";
import type {
  ArtStyleSelection,
  ImageInputReference,
  ImageRenderRecord,
  ModelSelection,
} from "../types";

export type ImageProvenance = {
  imageTier: ImageTier;
  imageModel: ModelSelection;
};

/** Attach tier + model to a render (or blob-only result). Pure. */
export function stampImageProvenance<T extends object>(
  render: T,
  tier: ImageTier,
  model: ModelSelection,
): T & ImageProvenance {
  return {
    ...render,
    imageTier: tier,
    imageModel: { provider: model.provider, id: model.id },
  };
}

/**
 * The record kept on a picture: the look, canvas, applied options and the
 * pictures sent along with the prompt. Only what was actually used goes in, so
 * a reader can trace a picture and a later feature can repeat it.
 */
export function buildRenderRecord(args: {
  artStyle: ArtStyleSelection | undefined;
  action: string;
  outputSize?: string;
  generation?: ResolvedImageGenerationOptions;
  inputReferences?: readonly ImageInputReference[];
  prompt?: string;
  renderedAt?: number;
}): ImageRenderRecord {
  return {
    style: styleStampOf(args.artStyle),
    action: args.action,
    ...(args.outputSize ? { outputSize: args.outputSize } : {}),
    ...(args.generation ? { generation: args.generation } : {}),
    ...(args.inputReferences && args.inputReferences.length > 0
      ? { inputReferences: args.inputReferences.map((reference) => ({ ...reference })) }
      : {}),
    ...(args.prompt ? { prompt: args.prompt } : {}),
    renderedAt: args.renderedAt ?? Date.now(),
  };
}
