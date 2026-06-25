import { useMemo } from "react";
import { selectModels, type ResolvedModels } from "../../core/models/registry";
import { hasKey } from "../../core/settings";
import { useSettingsStore } from "../../state/settingsStore";

/**
 * The models the system has chosen automatically for the current keys, or null
 * when no usable provider key is configured. Reactive to settings + discovery.
 */
export function useResolvedModels(): ResolvedModels | null {
  const settings = useSettingsStore((s) => s.settings);
  const discovery = useSettingsStore((s) => s.discovery);
  return useMemo(
    () => selectModels(discovery, (p) => hasKey(settings, p)),
    [discovery, settings],
  );
}
