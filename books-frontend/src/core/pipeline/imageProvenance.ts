/**
 * Stamp the quality tier + concrete model onto a render before it is folded
 * into a version tree. Kept at the host boundary (AI endpoints / job workers)
 * so every return path from the pipeline inherits provenance without touching
 * each surgical render branch.
 */
import type { ImageTier } from "../config/modelConfig";
import type { ModelSelection } from "../types";

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
