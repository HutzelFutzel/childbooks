/**
 * Server-authoritative model resolution. Both the synchronous AI endpoints and
 * the background worker resolve `action → model` from the admin
 * `appConfig/models` document here, so the client can never choose (or escalate
 * to) a more expensive model.
 */
import { serverConfig } from "./config";
import { getModelConfig } from "./appConfig";
import { ALL_PROVIDERS } from "../../books-frontend/src/core/providers";
import {
  resolveImageModel,
  resolveTextModel,
  TEXT_SPEEDS,
} from "../../books-frontend/src/core/config/modelConfig";
import type { ImageActionId, TextActionId } from "../../books-frontend/src/core/ai/actions";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import type { ModelSelection } from "../../books-frontend/src/core/types";

export class ServiceUnavailable extends Error {}

const UNAVAILABLE = "AI generation isn't available right now. It's being set up on the server.";

export function availability(): Record<ProviderId, boolean> {
  const cfg = serverConfig();
  return { openai: Boolean(cfg.openaiApiKey), google: Boolean(cfg.googleApiKey) };
}

export function apiKeyFor(provider: ProviderId): string {
  const cfg = serverConfig();
  const key = provider === "openai" ? cfg.openaiApiKey : cfg.googleApiKey;
  if (!key) throw new ServiceUnavailable(`The ${provider} provider is not configured on the server.`);
  return key;
}

export async function resolveTextAction(action: TextActionId): Promise<ModelSelection> {
  const cfg = await getModelConfig();
  const a = availability();
  const m = resolveTextModel(cfg, action, (p) => a[p]);
  if (!m) throw new ServiceUnavailable(UNAVAILABLE);
  return m;
}

/**
 * A cheap text model for utility tasks like cost extraction. Prefers Google's
 * "fast" slot, then any filled text slot on an available provider. Independent
 * of action bindings so it works even before bindings are fully configured.
 */
export async function resolveSuggestionModel(): Promise<ModelSelection> {
  const cfg = await getModelConfig();
  const a = availability();
  const googleFast = cfg.slots.text.google?.fast?.trim();
  if (a.google && googleFast) return { provider: "google", id: googleFast };
  for (const p of ALL_PROVIDERS) {
    if (!a[p]) continue;
    for (const s of TEXT_SPEEDS) {
      const id = cfg.slots.text[p]?.[s]?.trim();
      if (id) return { provider: p, id };
    }
  }
  throw new ServiceUnavailable(UNAVAILABLE);
}

/**
 * Build the `ResolvedModels` used by the image pipelines. `imageAction` selects
 * the primary image model (page vs cover); anchor sheets always use
 * `anchorImage`; `localize` provides the vision text model for in-place edits.
 */
export async function resolveImageModels(
  imageAction: ImageActionId,
): Promise<ResolvedModels> {
  const cfg = await getModelConfig();
  const a = availability();
  const avail = (p: ProviderId) => a[p];
  const image = resolveImageModel(cfg, imageAction, avail);
  const anchor = resolveImageModel(cfg, "anchorImage", avail);
  if (!image || !anchor) throw new ServiceUnavailable(UNAVAILABLE);
  const text = resolveTextModel(cfg, "localize", avail) ?? { provider: image.provider, id: image.id };
  return { textModel: text, imageModel: image, anchorImageModel: anchor };
}
