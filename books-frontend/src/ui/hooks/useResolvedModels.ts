import { useMemo } from "react";
import {
  CUSTOMER_IMAGE_TIER,
  resolveBoundImageModel,
  resolveTextModel,
} from "../../core/config/modelConfig";
import type { ResolvedModels } from "../../core/models/registry";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useSettingsStore } from "../../state/settingsStore";

/**
 * The models resolved from the admin config for the providers the backend is
 * configured for, or null when none is usable. Reactive to availability + the
 * live admin model config. Resolution is authoritative on the server; this
 * mirror gates generation only when the production-quality binding is usable.
 */
export function useResolvedModels(): ResolvedModels | null {
  const providerAvailable = useSettingsStore((s) => s.providerAvailable);
  const modelConfig = useAppConfigStore((s) => s.modelConfig);
  return useMemo(() => {
    const avail = (p: "openai" | "google") => Boolean(providerAvailable[p]);
    const textModel = resolveTextModel(modelConfig, "screenplay", avail);
    const imageModel = resolveBoundImageModel(
      modelConfig,
      "pageIllustration",
      CUSTOMER_IMAGE_TIER,
      avail,
    );
    if (!textModel || !imageModel) return null;
    const anchorImageModel =
      resolveBoundImageModel(modelConfig, "anchorImage", CUSTOMER_IMAGE_TIER, avail) ?? imageModel;
    return { textModel, imageModel, anchorImageModel };
  }, [modelConfig, providerAvailable]);
}
