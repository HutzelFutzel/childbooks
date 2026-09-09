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

/**
 * Internal image model tiers. Customer generation always uses
 * {@link CUSTOMER_IMAGE_TIER}; both values remain in the config so historical
 * jobs keep their provenance and admins can retain an economy binding for
 * internal tooling or a future, explicitly separate preview product.
 */
export type ImageTier = "quick" | "premium";
export const IMAGE_TIERS: ImageTier[] = ["quick", "premium"];

/**
 * The quality bar for every customer-facing image. Provider/model selection is
 * still configurable behind this binding, but guests and full accounts receive
 * the same finished-art experience.
 */
export const CUSTOMER_IMAGE_TIER = "premium" as const satisfies ImageTier;

/** Legacy/internal display names retained for admin and historical records. */
export const DEFAULT_IMAGE_TIER_LABELS: Record<ImageTier, string> = {
  quick: "Economy (internal)",
  premium: "Production",
};

export interface ImageTierUiCopy {
  /** Legacy one-line tier explanation retained for stored admin config. */
  description: string;
  /** Legacy generated-image notice retained for stored admin config. */
  generatedImageNotice: string;
}

/** Fallback copy until an admin saves custom tier presentation. */
export const DEFAULT_IMAGE_TIER_UI: Record<ImageTier, ImageTierUiCopy> = {
  quick: {
    description:
      "Internal economy binding retained for historical jobs and future tooling.",
    generatedImageNotice:
      "Created with the legacy economy binding.",
  },
  premium: {
    description:
      "Production artwork binding used for every customer generation.",
    generatedImageNotice:
      "Created with the production artwork binding.",
  },
};

/** An untrusted value as a tier, or null when it isn't an explicit choice. */
export function parseImageTier(value: unknown): ImageTier | null {
  return value === "premium" || value === "quick" ? value : null;
}

/**
 * Coerce an untrusted value to a valid tier for historical display paths.
 * Missing new values resolve to the customer production tier.
 */
export function normalizeImageTier(value: unknown): ImageTier {
  return parseImageTier(value) ?? CUSTOMER_IMAGE_TIER;
}

/**
 * Is any image model configured for an available provider (regardless of tier)?
 * Internal/admin compatibility helper; customer gates use the strict production
 * binding through `resolveBoundImageModel`.
 */
export function resolveAnyImageModel(
  cfg: ModelConfig,
  action: ImageActionId,
  isAvailable?: (p: ProviderId) => boolean,
): ModelSelection | null {
  for (const tier of IMAGE_TIERS) {
    const sel = resolveImageModel(cfg, action, tier, isAvailable);
    if (sel) return sel;
  }
  return null;
}

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

/** Per-tier image slot references for one image action. */
export type ImageTierBindings = Record<ImageTier, ImageSlotRef>;

/** The full configuration document. `version` allows future migrations. */
export interface ModelConfig {
  version: 1;
  slots: ModelSlots;
  textBindings: Record<TextActionId, TextSlotRef>;
  /** Each image action binds one slot per internal model tier. */
  imageBindings: Record<ImageActionId, ImageTierBindings>;
  /** Legacy/admin display labels for internal tiers. */
  imageTierLabels: Record<ImageTier, string>;
  /** Legacy/admin presentation metadata retained for config compatibility. */
  imageTierUi: Record<ImageTier, ImageTierUiCopy>;
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
  // Every image action shares the same default tier mapping: the cheaper/faster
  // Google model for "quick", the higher-fidelity OpenAI model for "premium".
  const defaultImageTiers = (): ImageTierBindings => ({
    quick: { provider: "google", speed: "fast" },
    premium: { provider: "openai", speed: "slow" },
  });
  return {
    version: 1,
    slots: createDefaultSlots(),
    textBindings: {
      storyDraft: { provider: "google", speed: "slow" },
      storyEdit: { provider: "google", speed: "slow" },
      storyCheck: { provider: "google", speed: "fast" },
      storyAnalysis: { provider: "google", speed: "fast" },
      anchorDescription: { provider: "google", speed: "fast" },
      screenplay: { provider: "google", speed: "slow" },
      localize: { provider: "google", speed: "fast" },
      bindingPass: { provider: "google", speed: "fast" },
      editIntent: { provider: "google", speed: "fast" },
      extractArtStyle: { provider: "google", speed: "fast" },
      extractArtLook: { provider: "google", speed: "fast" },
      // Release notes read a whole diff in one call and are written for humans
      // to read verbatim, so they default to the quality slot rather than fast.
      releaseNotes: { provider: "google", speed: "slow" },
    },
    imageBindings: {
      anchorImage: defaultImageTiers(),
      pageIllustration: defaultImageTiers(),
      coverIllustration: defaultImageTiers(),
    },
    imageTierLabels: { ...DEFAULT_IMAGE_TIER_LABELS },
    imageTierUi: {
      quick: { ...DEFAULT_IMAGE_TIER_UI.quick },
      premium: { ...DEFAULT_IMAGE_TIER_UI.premium },
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

/** Resolve only the requested tier's bound quality class across providers. */
export function resolveBoundImageModel(
  cfg: ModelConfig,
  action: ImageActionId,
  tier: ImageTier,
  isAvailable?: (p: ProviderId) => boolean,
): ModelSelection | null {
  const ok = (p: ProviderId) => (isAvailable ? isAvailable(p) : true);
  const ref = cfg.imageBindings[action]?.[tier];
  if (!ref) return null;
  const ordered: ProviderId[] = [
    ref.provider,
    ...ALL_PROVIDERS.filter((p) => p !== ref.provider),
  ];
  for (const p of ordered) {
    if (ok(p) && slotFilled(cfg.slots.image[p]?.[ref.speed])) {
      return { provider: p, id: cfg.slots.image[p][ref.speed] };
    }
  }
  return null;
}

/**
 * Tolerant internal resolver. Prefers the requested tier's binding, then the
 * other tier and finally any configured image model. Customer generation uses
 * {@link resolveBoundImageModel} so an outage cannot silently lower quality.
 */
export function resolveImageModel(
  cfg: ModelConfig,
  action: ImageActionId,
  tier: ImageTier,
  isAvailable?: (p: ProviderId) => boolean,
): ModelSelection | null {
  const ok = (p: ProviderId) => (isAvailable ? isAvailable(p) : true);
  const bound = resolveBoundImageModel(cfg, action, tier, isAvailable);
  if (bound) return bound;
  const tierOrder: ImageTier[] = [tier, ...IMAGE_TIERS.filter((t) => t !== tier)];
  // The requested tier was checked strictly above; try internal fallbacks.
  for (const t of tierOrder.slice(1)) {
    const ref = cfg.imageBindings[action]?.[t];
    if (!ref) continue;
    const ordered: ProviderId[] = [ref.provider, ...ALL_PROVIDERS.filter((p) => p !== ref.provider)];
    for (const p of ordered) {
      if (ok(p) && slotFilled(cfg.slots.image[p]?.[ref.speed])) {
        return { provider: p, id: cfg.slots.image[p][ref.speed] };
      }
    }
  }
  // Last resort: any filled image slot on an available provider.
  const first = cfg.imageBindings[action]?.[tier];
  const ordered: ProviderId[] = first
    ? [first.provider, ...ALL_PROVIDERS.filter((p) => p !== first.provider)]
    : [...ALL_PROVIDERS];
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

/**
 * Concrete models currently reachable from customer-facing action bindings.
 * Unused slots and the legacy economy image tier are deliberately excluded:
 * they are safe drafts and must not block publishing an otherwise valid setup.
 */
export function activeModels(cfg: ModelConfig): ConfiguredModelRef[] {
  const seen = new Set<string>();
  const out: ConfiguredModelRef[] = [];
  const add = (provider: ProviderId, modelId: string, modality: "text" | "image") => {
    const id = modelId.trim();
    const key = `${provider}:${id}:${modality}`;
    if (!id || seen.has(key)) return;
    seen.add(key);
    out.push({ provider, modelId: id, modality });
  };
  for (const binding of Object.values(cfg.textBindings)) {
    add(binding.provider, cfg.slots.text[binding.provider][binding.speed], "text");
  }
  for (const tiers of Object.values(cfg.imageBindings)) {
    const binding = tiers[CUSTOMER_IMAGE_TIER];
    add(binding.provider, cfg.slots.image[binding.provider][binding.speed], "image");
  }
  return out;
}

/** Configured models that have no entry in the cost table (so cost is untracked). */
export function modelsMissingCost(cfg: ModelConfig, costs: ModelCostTable): ConfiguredModelRef[] {
  return configuredModels(cfg).filter((m) => !costs.models[costKey(m.provider, m.modelId)]);
}

/** A raw stored image slot ref (tolerant of missing fields). */
function coerceImageSlotRef(raw: unknown, fallback: ImageSlotRef): ImageSlotRef {
  const r = (raw ?? {}) as Partial<ImageSlotRef>;
  const provider: ProviderId = r.provider === "openai" || r.provider === "google" ? r.provider : fallback.provider;
  const speed: ImageSpeed = r.speed === "fast" || r.speed === "slow" ? r.speed : fallback.speed;
  return { provider, speed };
}

/**
 * Coerce one action's image binding to the per-tier shape. Handles migration
 * from the legacy single-binding shape (`{provider, speed}`), which we map to
 * BOTH tiers so existing installs keep working until an admin differentiates.
 */
function coerceImageTierBindings(raw: unknown, fallback: ImageTierBindings): ImageTierBindings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const isLegacySingle = "provider" in r || "speed" in r;
  if (isLegacySingle) {
    const single = coerceImageSlotRef(r, fallback.premium);
    return { quick: single, premium: single };
  }
  return {
    quick: coerceImageSlotRef(r.quick, fallback.quick),
    premium: coerceImageSlotRef(r.premium, fallback.premium),
  };
}

/** Merge a stored (possibly partial / older) config onto current defaults. */
export function normalizeModelConfig(input: unknown): ModelConfig {
  const def = createDefaultModelConfig();
  const stored = (input ?? {}) as Partial<ModelConfig> & {
    imageBindings?: Record<string, unknown>;
    imageTierLabels?: Partial<Record<ImageTier, string>>;
    imageTierUi?: Partial<Record<ImageTier, Partial<ImageTierUiCopy>>>;
  };
  const slots = stored.slots ?? def.slots;
  const text = {} as ModelSlots["text"];
  const image = {} as ModelSlots["image"];
  for (const p of ALL_PROVIDERS) {
    text[p] = { ...def.slots.text[p], ...slots.text?.[p] };
    image[p] = { ...def.slots.image[p], ...slots.image?.[p] };
  }
  const imageBindings = {} as Record<ImageActionId, ImageTierBindings>;
  for (const id of Object.keys(def.imageBindings) as ImageActionId[]) {
    imageBindings[id] = coerceImageTierBindings(stored.imageBindings?.[id], def.imageBindings[id]);
  }
  const labels: Partial<Record<ImageTier, string>> = stored.imageTierLabels ?? {};
  const ui: Partial<Record<ImageTier, Partial<ImageTierUiCopy>>> =
    stored.imageTierUi ?? {};
  return {
    version: 1,
    slots: { text, image },
    textBindings: { ...def.textBindings, ...stored.textBindings },
    imageBindings,
    imageTierLabels: {
      quick: typeof labels.quick === "string" && labels.quick.trim() ? labels.quick : def.imageTierLabels.quick,
      premium:
        typeof labels.premium === "string" && labels.premium.trim() ? labels.premium : def.imageTierLabels.premium,
    },
    imageTierUi: {
      quick: {
        description:
          typeof ui.quick?.description === "string" && ui.quick.description.trim()
            ? ui.quick.description.trim()
            : def.imageTierUi.quick.description,
        generatedImageNotice:
          typeof ui.quick?.generatedImageNotice === "string" &&
          ui.quick.generatedImageNotice.trim()
            ? ui.quick.generatedImageNotice.trim()
            : def.imageTierUi.quick.generatedImageNotice,
      },
      premium: {
        description:
          typeof ui.premium?.description === "string" && ui.premium.description.trim()
            ? ui.premium.description.trim()
            : def.imageTierUi.premium.description,
        generatedImageNotice:
          typeof ui.premium?.generatedImageNotice === "string" &&
          ui.premium.generatedImageNotice.trim()
            ? ui.premium.generatedImageNotice.trim()
            : def.imageTierUi.premium.generatedImageNotice,
      },
    },
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
const imageTierBindingsSchema = z.object({
  quick: imageSlotRefSchema,
  premium: imageSlotRefSchema,
});

export const modelConfigSchema = z.object({
  version: z.literal(1),
  slots: z.object({
    text: recordOf(perProviderText),
    image: recordOf(perProviderImage),
  }),
  // Bindings are validated as records of valid slot refs; `normalizeModelConfig`
  // fills in any missing action so the fixed key set stays authoritative.
  textBindings: z.record(z.string(), textSlotRefSchema),
  imageBindings: z.record(z.string(), imageTierBindingsSchema),
  imageTierLabels: z.record(z.string(), z.string()).optional(),
  imageTierUi: z
    .record(
      z.string(),
      z.object({
        description: z.string().min(1),
        generatedImageNotice: z.string().min(1),
      }),
    )
    .optional(),
});
