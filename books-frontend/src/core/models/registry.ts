/**
 * Model registry: combines live discovery with the keyword/capability
 * classifier to surface, per provider and modality, an economy and a premium
 * variant. New models are picked up automatically with no code changes.
 */
import { ALL_PROVIDERS, getTextProvider } from "../providers";
import type { Modality, ModelTier, ProviderId } from "../config/options";
import type { ProviderCredentials, RawModel } from "../providers/types";
import type { ModelInfo, ModelSelection } from "../types";
import {
  classifyModel,
  FALLBACK_MODELS,
  prettifyModelId,
  type ClassifiedModel,
} from "./catalog";

/** Parse the numeric version components of an id for "newest" comparison. */
function versionScore(id: string): number[] {
  const matches = id.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches.flatMap((m) => m.split(".").map((n) => Number(n)));
}

/** Returns true if model `a` should rank ahead of `b` (newer / more stable). */
function ranksAhead(a: ClassifiedModel, b: ClassifiedModel): boolean {
  const va = versionScore(a.id);
  const vb = versionScore(b.id);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const da = va[i] ?? 0;
    const db = vb[i] ?? 0;
    if (da !== db) return da > db;
  }
  if (a.stability !== b.stability) return a.stability > b.stability;
  // Tie-break: prefer the shorter id (usually the stable alias).
  return a.id.length < b.id.length;
}

const MODALITIES: Modality[] = ["text", "image"];
const TIERS: ModelTier[] = ["economy", "premium"];

/**
 * Build the selectable model options for a provider from its discovered list.
 * Returns the newest model per (modality, tier) bucket. Falls back to minimal
 * current defaults only when discovery produced nothing usable.
 */
export function buildModelOptions(
  provider: ProviderId,
  discovered: RawModel[],
): ModelInfo[] {
  const classified = (discovered ?? [])
    .map((m) => classifyModel(provider, m))
    .filter((m): m is ClassifiedModel => m !== null);

  if (classified.length === 0) {
    return FALLBACK_MODELS[provider];
  }

  const out: ModelInfo[] = [];
  for (const modality of MODALITIES) {
    let hasAny = false;
    for (const tier of TIERS) {
      const bucket = classified.filter(
        (c) => c.modality === modality && c.tier === tier,
      );
      if (bucket.length === 0) continue;
      hasAny = true;
      const best = bucket.reduce((a, b) => (ranksAhead(a, b) ? a : b));
      out.push({
        provider,
        id: best.id,
        displayName: prettifyModelId(best.id),
        modality,
        tier,
        supportsReferenceImages: best.supportsReferenceImages,
        discovered: true,
      });
    }
    // If discovery yielded no models at all for this modality, supplement with
    // the fallback entries for it so the user still has a choice.
    if (!hasAny) {
      out.push(...FALLBACK_MODELS[provider].filter((m) => m.modality === modality));
    }
  }
  return out;
}

export interface ProviderDiscovery {
  provider: ProviderId;
  models: RawModel[];
  error?: string;
}

/** Fetch the raw model list for a provider; never throws. */
export async function discoverProvider(
  provider: ProviderId,
  creds: ProviderCredentials,
  signal?: AbortSignal,
): Promise<ProviderDiscovery> {
  try {
    const models = await getTextProvider(provider).listModels(creds, signal);
    return { provider, models };
  } catch (err) {
    return {
      provider,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function filterByModality(models: ModelInfo[], modality: Modality): ModelInfo[] {
  return models.filter((m) => m.modality === modality);
}

/** Catalog-only options (no discovery), used as an immediate default in the UI. */
export function catalogModelOptions(provider: ProviderId): ModelInfo[] {
  return buildModelOptions(provider, []);
}

/** The models the system will use, chosen automatically (no user selection). */
export interface ResolvedModels {
  textModel: ModelSelection;
  imageModel: ModelSelection;
  anchorImageModel: ModelSelection;
}

const sel = (m: ModelInfo): ModelSelection => ({ provider: m.provider, id: m.id });

/** Best text model for story analysis / screenplay (quality-leaning, with fallback). */
function bestTextModel(options: ModelInfo[]): ModelInfo | undefined {
  return (
    options.find((m) => m.provider === "google" && /gemini-3\.5-flash/i.test(m.id)) ??
    options.find((m) => m.provider === "google" && /flash/i.test(m.id)) ??
    options.find((m) => m.tier === "premium") ??
    options[0]
  );
}

/** Best page/cover image model — prefer GPT Image for precise edits & masks. */
function bestPageImageModel(options: ModelInfo[]): ModelInfo | undefined {
  return (
    options.find((m) => m.provider === "openai" && /gpt-image-2/i.test(m.id)) ??
    options.find((m) => m.provider === "openai" && /image/i.test(m.id)) ??
    options.find((m) => m.tier === "premium") ??
    options[0]
  );
}

/** Best anchor reference model — prefer a fast/cheap Gemini Flash image model. */
function bestAnchorImageModel(
  options: ModelInfo[],
  page: ModelInfo | undefined,
): ModelInfo | undefined {
  return (
    options.find(
      (m) => m.provider === "google" && /flash.*image|image.*flash|3\.1-flash-image/i.test(m.id),
    ) ??
    options.find((m) => m.provider === "google" && m.tier === "economy" && /image/i.test(m.id)) ??
    page
  );
}

/**
 * Resolve the best models for every role from the providers the user has keyed,
 * so the app never asks the user to pick a model. Returns null only when no
 * usable text + image model can be found across the keyed providers.
 */
export function selectModels(
  discovery: Partial<Record<ProviderId, { models: RawModel[] }>>,
  hasKeyFor: (provider: ProviderId) => boolean,
): ResolvedModels | null {
  const text: ModelInfo[] = [];
  const image: ModelInfo[] = [];
  for (const p of ALL_PROVIDERS) {
    if (!hasKeyFor(p)) continue;
    const opts = buildModelOptions(p, discovery[p]?.models ?? []);
    text.push(...filterByModality(opts, "text"));
    image.push(...filterByModality(opts, "image"));
  }
  const textModel = bestTextModel(text);
  const imageModel = bestPageImageModel(image);
  if (!textModel || !imageModel) return null;
  const anchorImageModel = bestAnchorImageModel(image, imageModel) ?? imageModel;
  return {
    textModel: sel(textModel),
    imageModel: sel(imageModel),
    anchorImageModel: sel(anchorImageModel),
  };
}
