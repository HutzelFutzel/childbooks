/**
 * Client-side, config-driven model resolution.
 *
 * Resolution is authoritative on the SERVER; this mirror exists so the UI can
 * (a) gate generation behind "is a usable model configured + available?" and
 * (b) stamp the intended model onto job tasks (the worker re-resolves anyway).
 * It reads the live admin model config (`appConfigStore`) and which providers
 * the backend has keys for (`settingsStore`).
 */
import {
  DEFAULT_IMAGE_TIER,
  resolveImageModel,
  resolveTextModel,
  type ImageTier,
} from "../core/config/modelConfig";
import type { ImageActionId, TextActionId } from "../core/ai/actions";
import type { ResolvedModels } from "../core/models/registry";
import type { ProviderId } from "../core/config/options";
import type { ModelSelection } from "../core/types";
import { useAppConfigStore } from "../state/appConfigStore";
import { useSettingsStore } from "../state/settingsStore";

function availability(): (p: ProviderId) => boolean {
  const avail = useSettingsStore.getState().providerAvailable;
  return (p) => Boolean(avail[p]);
}

export function resolveTextModelClient(action: TextActionId): ModelSelection | null {
  const cfg = useAppConfigStore.getState().modelConfig;
  return resolveTextModel(cfg, action, availability());
}

export function resolveImageModelClient(
  action: ImageActionId,
  tier: ImageTier = DEFAULT_IMAGE_TIER,
): ModelSelection | null {
  const cfg = useAppConfigStore.getState().modelConfig;
  return resolveImageModel(cfg, action, tier, availability());
}

/**
 * Build the `ResolvedModels` triple (text/image/anchor) used to gate the UI and
 * to fill job payloads for the given quality tier. Returns null when no usable
 * text+image model is configured for an available provider.
 */
export function resolveModelsClient(tier: ImageTier = DEFAULT_IMAGE_TIER): ResolvedModels | null {
  const cfg = useAppConfigStore.getState().modelConfig;
  const avail = availability();
  const textModel = resolveTextModel(cfg, "screenplay", avail);
  const imageModel = resolveImageModel(cfg, "pageIllustration", tier, avail);
  if (!textModel || !imageModel) return null;
  const anchorImageModel = resolveImageModel(cfg, "anchorImage", tier, avail) ?? imageModel;
  return { textModel, imageModel, anchorImageModel };
}
