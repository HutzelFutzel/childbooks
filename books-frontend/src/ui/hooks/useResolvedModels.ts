import { useMemo } from "react";
import {
  DEFAULT_IMAGE_TIER,
  resolveImageModel,
  resolveTextModel,
} from "../../core/config/modelConfig";
import type { ResolvedModels } from "../../core/models/registry";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSettingsStore } from "../../state/settingsStore";

/**
 * The models resolved from the admin config for the providers the backend is
 * configured for, or null when none is usable. Reactive to availability + the
 * live admin model config. Resolution is authoritative on the server; this is
 * the client mirror used to gate generation UI. Uses the "quick" tier for
 * gating (with cross-tier fallback), so the UI unlocks whenever ANY image model
 * is configured for an available provider.
 */
export function useResolvedModels(): ResolvedModels | null {
  const providerAvailable = useSettingsStore((s) => s.providerAvailable);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  return useMemo(() => {
    const avail = (p: "openai" | "google") => Boolean(providerAvailable[p]);
    const textModel = resolveTextModel(modelConfig, "screenplay", avail);
    const imageModel = resolveImageModel(modelConfig, "pageIllustration", DEFAULT_IMAGE_TIER, avail);
    if (!textModel || !imageModel) return null;
    const anchorImageModel =
      resolveImageModel(modelConfig, "anchorImage", DEFAULT_IMAGE_TIER, avail) ?? imageModel;
    return { textModel, imageModel, anchorImageModel };
  }, [modelConfig, providerAvailable]);
}
