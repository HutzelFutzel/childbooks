/**
 * Admin-configurable model configuration (the `appConfig/models` document).
 *
 * Two stages:
 *   1. SLOTS — for each provider and modality, named speed tiers map to a
 *      concrete model id (text: ultrafast/fast/slow, image: fast/slow).
 *   2. BINDINGS — each LLM action (see `core/ai/actions`) points at one slot.
 *
 * The action→model resolver reads a binding, then the slot, then returns the
 * concrete `{provider, id}`. Changing a slot's model updates every action bound
 * to it. Resolution degrades gracefully when the bound provider is unavailable
 * or a slot is unset, so a half-configured app still runs.
 */
import { z } from "zod";
import { ALL_PROVIDERS } from "../providers";
import type { ProviderId } from "./options";
import type { ModelSelection } from "../types";
import { FALLBACK_MODELS } from "../models/catalog";
import type { ImageActionId, TextActionId } from "../ai/actions";
import { costKey, type ModelCostTable } from "./modelCosts";

export type TextSpeed = "ultrafast" | "fast" | "slow";
export type ImageSpeed = "fast" | "slow";

export const TEXT_SPEEDS: TextSpeed[] = ["ultrafast", "fast", "slow"];
export const IMAGE_SPEEDS: ImageSpeed[] = ["fast", "slow"];

export const TEXT_SPEED_LABELS: Record<TextSpeed, string> = {
  ultrafast: "Ultra-fast",
  fast: "Fast",
  slow: "Slow / quality",
};
export const IMAGE_SPEED_LABELS: Record<ImageSpeed, string> = {
  fast: "Fast",
  slow: "Slow / quality",
};

/** Stage 1: per-provider speed slots, each holding a concrete model id ("" = unset). */
export interface ModelSlots {
  text: Record<ProviderId, Record<TextSpeed, string>>;
  image: Record<ProviderId, Record<ImageSpeed, string>>;
}

export interface TextSlotRef {
  provider: ProviderId;
  speed: TextSpeed;
}
export interface ImageSlotRef {
  provider: ProviderId;
  speed: ImageSpeed;
}

/** The full configuration document. `version` allows future migrations. */
export interface ModelConfig {
  version: 1;
  slots: ModelSlots;
  textBindings: Record<TextActionId, TextSlotRef>;
  imageBindings: Record<ImageActionId, ImageSlotRef>;
}

/** Look up a model id in a provider's catalog fallback for a given modality+economy. */
function fallbackId(provider: ProviderId, modality: "text" | "image", economy: boolean): string {
  const tier = economy ? "economy" : "premium";
  const m =
    FALLBACK_MODELS[provider].find((x) => x.modality === modality && x.tier === tier) ??
    FALLBACK_MODELS[provider].find((x) => x.modality === modality);
  return m?.id ?? "";
}

/** Default slots seeded from the catalog fallbacks (admin overrides via the UI). */
export function createDefaultSlots(): ModelSlots {
  const text = {} as ModelSlots["text"];
  const image = {} as ModelSlots["image"];
  for (const p of ALL_PROVIDERS) {
    const premiumText = fallbackId(p, "text", false);
    const economyText = fallbackId(p, "text", true);
    text[p] = { ultrafast: economyText, fast: economyText, slow: premiumText };
    image[p] = { fast: fallbackId(p, "image", true), slow: fallbackId(p, "image", false) };
  }
  return { text, image };
}

/**
 * Default action bindings, mirroring the previous auto-selection heuristics:
 * text leans on Google's fast model; page/cover images on OpenAI's quality
 * model; anchor sheets on Google's fast image model.
 */
export function createDefaultModelConfig(): ModelConfig {
  return {
    version: 1,
    slots: createDefaultSlots(),
    textBindings: {
      storyAnalysis: { provider: "google", speed: "fast" },
      anchorDescription: { provider: "google", speed: "fast" },
      screenplay: { provider: "google", speed: "slow" },
      localize: { provider: "google", speed: "fast" },
    },
    imageBindings: {
      anchorImage: { provider: "google", speed: "fast" },
      pageIllustration: { provider: "openai", speed: "slow" },
      coverIllustration: { provider: "openai", speed: "slow" },
    },
  };
}

/** True when a slot holds a usable model id. */
function slotFilled(id: string | undefined): id is string {
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * Resolve a text action to a concrete model. Prefers the bound provider/speed,
 * then the other provider at the same speed, then any filled text slot.
 * `isAvailable` (optional) skips providers the server has no key for.
 */
export function resolveTextModel(
  cfg: ModelConfig,
  action: TextActionId,
  isAvailable?: (p: ProviderId) => boolean,
): ModelSelection | null {
  const ref = cfg.textBindings[action];
  const ok = (p: ProviderId) => (isAvailable ? isAvailable(p) : true);
  const ordered: ProviderId[] = [ref.provider, ...ALL_PROVIDERS.filter((p) => p !== ref.provider)];
  // First pass: honor the bound speed across providers.
  for (const p of ordered) {
    if (ok(p) && slotFilled(cfg.slots.text[p]?.[ref.speed])) {
      return { provider: p, id: cfg.slots.text[p][ref.speed] };
    }
  }
  // Second pass: any filled text slot on an available provider.
  for (const p of ordered) {
    if (!ok(p)) continue;
    for (const s of TEXT_SPEEDS) {
      if (slotFilled(cfg.slots.text[p]?.[s])) return { provider: p, id: cfg.slots.text[p][s] };
    }
  }
  return null;
}

/** Resolve an image action to a concrete model (same fallback strategy as text). */
export function resolveImageModel(
  cfg: ModelConfig,
  action: ImageActionId,
  isAvailable?: (p: ProviderId) => boolean,
): ModelSelection | null {
  const ref = cfg.imageBindings[action];
  const ok = (p: ProviderId) => (isAvailable ? isAvailable(p) : true);
  const ordered: ProviderId[] = [ref.provider, ...ALL_PROVIDERS.filter((p) => p !== ref.provider)];
  for (const p of ordered) {
    if (ok(p) && slotFilled(cfg.slots.image[p]?.[ref.speed])) {
      return { provider: p, id: cfg.slots.image[p][ref.speed] };
    }
  }
  for (const p of ordered) {
    if (!ok(p)) continue;
    for (const s of IMAGE_SPEEDS) {
      if (slotFilled(cfg.slots.image[p]?.[s])) return { provider: p, id: cfg.slots.image[p][s] };
    }
  }
  return null;
}

/** A concrete model id referenced by the slots, with the modality it's used for. */
export interface ConfiguredModelRef {
  provider: ProviderId;
  modelId: string;
  modality: "text" | "image";
}

/** Distinct, non-empty model ids referenced by the slots (deduped by provider+id). */
export function configuredModels(cfg: ModelConfig): ConfiguredModelRef[] {
  const seen = new Set<string>();
  const out: ConfiguredModelRef[] = [];
  const add = (provider: ProviderId, raw: string, modality: "text" | "image") => {
    const modelId = raw.trim();
    if (!modelId) return;
    const key = `${provider}:${modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ provider, modelId, modality });
  };
  for (const p of ALL_PROVIDERS) {
    for (const s of TEXT_SPEEDS) add(p, cfg.slots.text[p][s], "text");
    for (const s of IMAGE_SPEEDS) add(p, cfg.slots.image[p][s], "image");
  }
  return out;
}

/** Configured models that have no entry in the cost table (so cost is untracked). */
export function modelsMissingCost(cfg: ModelConfig, costs: ModelCostTable): ConfiguredModelRef[] {
  return configuredModels(cfg).filter((m) => !costs.models[costKey(m.provider, m.modelId)]);
}

/** Merge a stored (possibly partial / older) config onto current defaults. */
export function normalizeModelConfig(input: unknown): ModelConfig {
  const def = createDefaultModelConfig();
  const stored = (input ?? {}) as Partial<ModelConfig>;
  const slots = stored.slots ?? def.slots;
  const text = {} as ModelSlots["text"];
  const image = {} as ModelSlots["image"];
  for (const p of ALL_PROVIDERS) {
    text[p] = { ...def.slots.text[p], ...slots.text?.[p] };
    image[p] = { ...def.slots.image[p], ...slots.image?.[p] };
  }
  return {
    version: 1,
    slots: { text, image },
    textBindings: { ...def.textBindings, ...stored.textBindings },
    imageBindings: { ...def.imageBindings, ...stored.imageBindings },
  };
}

// ---- Validation (used by the backend before persisting) --------------------

const providerEnum = z.enum(["openai", "google"]);
const textSpeedEnum = z.enum(["ultrafast", "fast", "slow"]);
const imageSpeedEnum = z.enum(["fast", "slow"]);

const perProviderText = z.object({
  ultrafast: z.string(),
  fast: z.string(),
  slow: z.string(),
});
const perProviderImage = z.object({
  fast: z.string(),
  slow: z.string(),
});

const recordOf = <V extends z.ZodTypeAny>(value: V) =>
  z.object({ openai: value, google: value });

const textSlotRefSchema = z.object({ provider: providerEnum, speed: textSpeedEnum });
const imageSlotRefSchema = z.object({ provider: providerEnum, speed: imageSpeedEnum });

export const modelConfigSchema = z.object({
  version: z.literal(1),
  slots: z.object({
    text: recordOf(perProviderText),
    image: recordOf(perProviderImage),
  }),
  // Bindings are validated as records of valid slot refs; `normalizeModelConfig`
  // fills in any missing action so the fixed key set stays authoritative.
  textBindings: z.record(z.string(), textSlotRefSchema),
  imageBindings: z.record(z.string(), imageSlotRefSchema),
});
