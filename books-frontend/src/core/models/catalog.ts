/**
 * Model classifier.
 *
 * Rather than maintaining an exact list of model ids (which goes stale every
 * time a provider ships a new model), we classify whatever the provider's
 * live `models.list` endpoint returns into:
 *   - modality: text vs image
 *   - tier: economy vs premium (inferred from keywords like mini/flash/pro)
 *   - stability: stable/latest vs preview vs experimental
 *
 * This means new models are bucketed automatically with no code changes. A tiny
 * set of current fallbacks is only used when discovery AND the cache are empty.
 */
import type { Modality, ModelTier, ProviderId } from "../config/options";
import type { ModelInfo } from "../types";
import type { RawModel } from "../providers/types";

export interface ClassifiedModel {
  id: string;
  modality: Modality;
  tier: ModelTier;
  supportsReferenceImages?: boolean;
  /** 2 = stable/latest, 1 = preview, 0 = experimental. */
  stability: number;
}

/**
 * Substrings that mark a model as something we don't use here (not a
 * text-chat or image-generation model). Note: image-generation ids such as
 * "gpt-image-2" / "gemini-3-pro-image" intentionally do NOT contain any of
 * these, while "imagen-*" (a different, deprecated image family) does.
 */
const EXCLUDE_KEYWORDS = [
  "embedding",
  "embed",
  "tts",
  "whisper",
  "transcribe",
  "audio",
  "realtime",
  "moderation",
  "deep-research",
  "computer-use",
  "codex",
  "robotics",
  "live",
  "veo",
  "lyria",
  "imagen",
  "dall-e",
  "davinci",
  "babbage",
  "instruct",
  "guard",
  "aqa",
  "learnlm",
];

const ECONOMY_KEYWORDS = ["mini", "nano", "lite", "flash"];

function hasExcluded(id: string): boolean {
  return EXCLUDE_KEYWORDS.some((k) => id.includes(k));
}

function tierFor(id: string): ModelTier {
  return ECONOMY_KEYWORDS.some((k) => id.includes(k)) ? "economy" : "premium";
}

function stabilityFor(id: string): number {
  if (id.includes("exp")) return 0;
  if (id.includes("preview")) return 1;
  return 2;
}

/** Classify a single discovered model, or return null if it isn't usable. */
export function classifyModel(
  provider: ProviderId,
  raw: RawModel,
): ClassifiedModel | null {
  const id = raw.id.toLowerCase();
  if (hasExcluded(id)) return null;

  let modality: Modality | null = null;

  if (provider === "openai") {
    if (id.includes("image")) modality = "image";
    else if (/^(gpt-|o\d)/.test(id)) modality = "text";
  } else {
    // google
    if (!id.startsWith("gemini")) return null; // skip gemma / non-gemini families
    modality = id.includes("image") ? "image" : "text";
  }

  if (!modality) return null;

  // For Google, trust the reported capabilities when present: a text model must
  // be able to generateContent; an image model must support image output.
  const methods = (raw.capabilities ?? []).map((m) => m.toLowerCase());
  if (provider === "google" && methods.length > 0) {
    const canGenerate = methods.some((m) => m.includes("generatecontent") || m.includes("predict"));
    if (!canGenerate) return null;
  }

  return {
    id: raw.id,
    modality,
    tier: tierFor(id),
    supportsReferenceImages: modality === "image" ? true : undefined,
    stability: stabilityFor(id),
  };
}

/** Minimal, current last-resort defaults (only used with no discovery + no cache). */
export const FALLBACK_MODELS: Record<ProviderId, ModelInfo[]> = {
  openai: [
    { provider: "openai", id: "gpt-5.5", displayName: "GPT-5.5", modality: "text", tier: "premium", discovered: false },
    { provider: "openai", id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", modality: "text", tier: "economy", discovered: false },
    { provider: "openai", id: "gpt-image-2", displayName: "GPT Image 2", modality: "image", tier: "premium", supportsReferenceImages: true, discovered: false },
    { provider: "openai", id: "gpt-image-2-mini", displayName: "GPT Image 2 Mini", modality: "image", tier: "economy", supportsReferenceImages: true, discovered: false },
  ],
  google: [
    { provider: "google", id: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", modality: "text", tier: "premium", discovered: false },
    { provider: "google", id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", modality: "text", tier: "economy", discovered: false },
    { provider: "google", id: "gemini-3-pro-image", displayName: "Nano Banana Pro", modality: "image", tier: "premium", supportsReferenceImages: true, discovered: false },
    { provider: "google", id: "gemini-3.1-flash-image", displayName: "Nano Banana (Flash Image)", modality: "image", tier: "economy", supportsReferenceImages: true, discovered: false },
  ],
};

/** Best-effort pretty display name from a raw model id. */
export function prettifyModelId(id: string): string {
  const cleaned = id
    .replace(/-\d{4}-\d{2}-\d{2}$/, "") // trailing date snapshot
    .replace(/-\d{3,}$/, "") // trailing build number
    .replace(/-preview|-latest|-exp(erimental)?/g, "");
  return cleaned
    .split(/[-_]/)
    .map((part) => {
      if (/^gpt$/i.test(part)) return "GPT";
      if (/^o\d$/i.test(part)) return part.toLowerCase();
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ")
    .trim();
}
