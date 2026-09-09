/**
 * What each image model can actually do — and, for output geometry, the single
 * place that decides it.
 *
 * Model behaviour is knowledge that changes faster than deploys, so the shipped
 * table is only a default: an admin can correct any entry from the model config
 * without waiting for a release. Code asks this module rather than testing the
 * provider id, which is how `provider === "openai"` checks scattered through the
 * pipeline become one auditable table.
 *
 * Output geometry gets special treatment here because it used to live in four
 * places at once — a size list in the illustration pipeline, a ratio list in
 * this table, a third list inside the Gemini adapter, and a fixed anchor-sheet
 * canvas — with only the second of them admin-editable. Correcting a model's
 * ratios therefore changed which layouts were OFFERED without changing what was
 * GENERATED. {@link ImageSizing} is now the only description of a model's output
 * geometry: layout gating asks it via {@link aspectFit}, generation asks it via
 * {@link resolveImageSize}, the worker re-checks a client-supplied canvas
 * against it via {@link sanitizeImageSize}, and the adapters read the ratio back
 * off the canvas it produced.
 */
import { z } from "zod";
import type { ProviderId } from "./options";
import type { ModelSelection } from "../types";

/**
 * One aspect ratio a model offers, as the provider names it.
 *
 * The token is carried, not derived, because provider enums are not in lowest
 * terms: Gemini accepts `"21:9"` and reducing it to the numerically identical
 * `"7:3"` is a 400.
 */
export interface AspectRatioOption {
  token: string;
  /** width ÷ height. */
  ratio: number;
}

/**
 * How a model lets us ask for a shape.
 *
 * - `ratioBuckets` — the endpoint takes an aspect ratio and picks the pixels
 *   (Gemini). The canvas we compute is only a carrier for the ratio.
 * - `fixedSizes` — a short enum of `WxH` strings and nothing else (the GPT
 *   image models before `gpt-image-2`).
 * - `arbitrary` — any `WxH` inside a set of numeric constraints
 *   (`gpt-image-2`), which is the only mode that can hit an exact book shape.
 */
export type ImageSizing =
  | {
      mode: "ratioBuckets";
      ratios: AspectRatioOption[];
      /**
       * Short edge of the canvas we synthesize. The provider reads the ratio,
       * not these pixels — but the cover-continuation seed is built at this
       * size, so it has to be a sane image dimension rather than a token.
       */
      shortEdge: number;
    }
  | { mode: "fixedSizes"; sizes: string[] }
  | {
      mode: "arbitrary";
      /** Both edges must be a multiple of this. */
      multipleOf: number;
      /** Hard ceiling on either edge. */
      maxEdge: number;
      minPixels: number;
      maxPixels: number;
      /** Long ÷ short edge ceiling. */
      maxRatio: number;
      /**
       * Total pixels to aim for. The lever that trades print resolution against
       * cost and reliability: image tokens scale with area, and `gpt-image-2`
       * calls its own output above ~3.7 MP experimental.
       */
      pixelBudget: number;
    };

export const IMAGE_FORMATS = ["png", "webp", "jpeg"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const IMAGE_QUALITIES = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const CAPABILITY_RATINGS = ["none", "weak", "strong"] as const;
export type CapabilityRating = (typeof CAPABILITY_RATINGS)[number];

export interface ImageModelCapabilities {
  /** Code-level wire strategy. Admin overrides cannot invent a transport. */
  transport: "openai-images" | "google-generate-content";
  /** Stable shipped profile name, shown as provenance in the admin. */
  profile: string;
  operations: {
    generate: boolean;
    referenceEditing: boolean;
    /** Accepts an alignment mask, so a region can be edited in place. */
    maskEditing: boolean;
    outpainting: boolean;
    /** Conversational edit state, when the implemented transport supports it. */
    multiTurnEditing: boolean;
  };
  inputs: {
    /** How many reference images can be attached to one request. */
    maxReferenceImages: number;
    /** Optional provider limits by semantic reference role. */
    roleLimits?: Partial<Record<"subject" | "object" | "style", number>>;
    formats: ImageFormat[];
    referenceBinding: "ordered" | "labeled";
    inputFidelityLevels: Array<"low" | "high">;
  };
  /** The only description of what shapes and sizes this model can return. */
  sizing: ImageSizing;
  outputs: {
    formats: ImageFormat[];
    backgrounds: Array<"opaque" | "transparent" | "auto">;
    qualityLevels: ImageQuality[];
    /** Provider-named resolution tiers, independent from aspect ratio. */
    resolutions: string[];
    compression: boolean;
    partialImageStreaming: boolean;
    maxImagesPerRequest: number;
  };
  traits: {
    /** How reliably the model honours "keep this region calm". */
    negativeSpaceControl: "weak" | "strong";
    /** How well it renders legible words in baked cover art. */
    textRendering: CapabilityRating;
    promptAdherence: CapabilityRating;
    referenceConsistency: CapabilityRating;
    editingPrecision: CapabilityRating;
    latency: "fast" | "balanced" | "slow";
  };
}

/**
 * How far a layout's ideal art shape may miss the nearest shape the model can
 * produce before the layout is refused, as a fraction of the target.
 *
 * The overflow is cropped, so this is "how much of the frame are we willing to
 * throw away" — past a quarter, the composition the model was asked for is not
 * the composition that reaches the page.
 */
export const MAX_ASPECT_MISMATCH = 0.25;

// ---- Ratio vocabulary ------------------------------------------------------

function ratio(token: string): AspectRatioOption {
  const [w, h] = token.split(":").map(Number);
  return { token, ratio: w / h };
}

/**
 * Tokens any provider might name a ratio with. Used to turn a bare number
 * (a legacy admin override) back into a token a provider will accept, and as
 * the source the per-provider lists are drawn from — one definition, several
 * readers, no second copy.
 */
export const RATIO_VOCABULARY: AspectRatioOption[] = [
  "8:1",
  "4:1",
  "3:1",
  "21:9",
  "2:1",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "1:2",
  "1:3",
  "1:4",
  "1:8",
].map(ratio);

function vocabulary(...tokens: string[]): AspectRatioOption[] {
  return tokens.map((t) => {
    const known = RATIO_VOCABULARY.find((r) => r.token === t);
    if (!known) throw new Error(`Ratio "${t}" is not in RATIO_VOCABULARY.`);
    return known;
  });
}

/** The standard buckets current Gemini image models accept. */
const GEMINI_RATIOS = vocabulary(
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
);

/** Panorama/skyscraper buckets added by the 3.1 Flash Image generation. */
const GEMINI_EXTREME_RATIOS = vocabulary("8:1", "4:1", "1:4", "1:8");

/** The three canvases every GPT image model before `gpt-image-2` accepts. */
const OPENAI_FIXED_SIZES = ["1024x1536", "1024x1024", "1536x1024"];

/**
 * `gpt-image-2`'s documented constraints.
 *
 * `maxEdge` is 3824 rather than 3840 because the reference says "maximum
 * supported resolution 3840x2160" while the prompting guide says the max edge
 * must be *less than* 3840; 3824 is the largest multiple of 16 that satisfies
 * both readings. `pixelBudget` sits at the 2560x1440 mark the same guide calls
 * the upper reliability boundary — high enough to roughly double today's print
 * resolution, low enough to stay out of the experimental range.
 */
const OPENAI_ARBITRARY: ImageSizing = {
  mode: "arbitrary",
  multipleOf: 16,
  maxEdge: 3824,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxRatio: 3,
  pixelBudget: 2560 * 1440,
};

/** Per-provider baseline, used when no model-specific entry matches. */
const PROVIDER_DEFAULTS: Record<ProviderId, ImageModelCapabilities> = {
  openai: {
    transport: "openai-images",
    profile: "openai-images-default",
    operations: {
      generate: true,
      referenceEditing: true,
      maskEditing: true,
      outpainting: true,
      multiTurnEditing: false,
    },
    inputs: {
      maxReferenceImages: 16,
      formats: ["png", "webp", "jpeg"],
      referenceBinding: "ordered",
      inputFidelityLevels: [],
    },
    // Conservative: the fixed trio is what every GPT image model takes, and
    // `gpt-image-2` widens it below.
    sizing: { mode: "fixedSizes", sizes: OPENAI_FIXED_SIZES },
    outputs: {
      formats: ["png", "webp", "jpeg"],
      backgrounds: ["opaque", "auto"],
      qualityLevels: ["low", "medium", "high", "auto"],
      resolutions: [],
      compression: true,
      partialImageStreaming: false,
      maxImagesPerRequest: 1,
    },
    traits: {
      negativeSpaceControl: "strong",
      textRendering: "strong",
      promptAdherence: "strong",
      referenceConsistency: "strong",
      editingPrecision: "strong",
      latency: "balanced",
    },
  },
  google: {
    transport: "google-generate-content",
    profile: "google-image-default",
    operations: {
      generate: true,
      referenceEditing: true,
      // Gemini takes no alignment mask; regional edits regenerate the frame.
      maskEditing: false,
      outpainting: false,
      multiTurnEditing: false,
    },
    inputs: {
      maxReferenceImages: 8,
      formats: ["png", "webp", "jpeg"],
      referenceBinding: "labeled",
      inputFidelityLevels: [],
    },
    sizing: { mode: "ratioBuckets", ratios: GEMINI_RATIOS, shortEdge: 1024 },
    outputs: {
      formats: ["png"],
      backgrounds: ["opaque"],
      qualityLevels: [],
      resolutions: ["1K"],
      compression: false,
      partialImageStreaming: false,
      maxImagesPerRequest: 1,
    },
    traits: {
      negativeSpaceControl: "weak",
      textRendering: "weak",
      promptAdherence: "strong",
      referenceConsistency: "strong",
      editingPrecision: "weak",
      latency: "balanced",
    },
  },
};

type CapabilityPatch = {
  profile?: string;
  transport?: ImageModelCapabilities["transport"];
  operations?: Partial<ImageModelCapabilities["operations"]>;
  inputs?: Partial<ImageModelCapabilities["inputs"]>;
  sizing?: ImageSizing;
  outputs?: Partial<ImageModelCapabilities["outputs"]>;
  traits?: Partial<ImageModelCapabilities["traits"]>;
};

/**
 * Model-family profiles. Broad matches apply first; specific profiles layer on
 * top, so dated snapshots inherit their family's behavior without becoming a
 * new code path.
 */
const MODEL_PROFILES: {
  provider: ProviderId;
  match: RegExp;
  priority: number;
  caps: CapabilityPatch;
}[] = [
  {
    provider: "openai",
    match: /^gpt-image-.*mini(?:$|-)/,
    priority: 50,
    caps: {
      profile: "openai-images-mini",
      traits: {
        negativeSpaceControl: "weak",
        textRendering: "weak",
        promptAdherence: "weak",
        referenceConsistency: "weak",
        editingPrecision: "weak",
        latency: "fast",
      },
    },
  },
  {
    provider: "openai",
    match: /^gpt-image-2(?:\.\d+)?(?:$|-)/,
    priority: 20,
    caps: {
      profile: "openai-images-v2",
      sizing: OPENAI_ARBITRARY,
      inputs: { inputFidelityLevels: ["low", "high"] },
      outputs: { backgrounds: ["opaque", "transparent", "auto"] },
    },
  },
  {
    provider: "openai",
    match: /^gpt-image-2\.5-(?:flare|sunburst)(?:$|-)/,
    priority: 30,
    caps: {
      profile: "openai-images-v2.5",
      outputs: {
        qualityLevels: ["low", "medium", "high", "xhigh", "max", "auto"],
      },
    },
  },
  {
    provider: "openai",
    match: /^gpt-image-2\.5-flare(?:$|-)/,
    priority: 40,
    caps: { profile: "openai-images-v2.5-flare", traits: { latency: "fast" } },
  },
  {
    provider: "openai",
    match: /^gpt-image-2\.5-sunburst(?:$|-)/,
    priority: 40,
    caps: {
      profile: "openai-images-v2.5-sunburst",
      traits: { editingPrecision: "strong", latency: "slow" },
    },
  },
  {
    provider: "google",
    match: /^gemini-3-pro-image(?:$|-)/,
    priority: 20,
    caps: {
      profile: "gemini-3-pro-image",
      inputs: {
        maxReferenceImages: 14,
        roleLimits: { object: 6, subject: 5, style: 3 },
      },
      sizing: {
        mode: "ratioBuckets",
        ratios: [...GEMINI_RATIOS, ...GEMINI_EXTREME_RATIOS],
        shortEdge: 1024,
      },
      outputs: { resolutions: ["1K", "2K", "4K"] },
      traits: {
        negativeSpaceControl: "strong",
        textRendering: "strong",
        promptAdherence: "strong",
        referenceConsistency: "strong",
        editingPrecision: "strong",
        latency: "slow",
      },
    },
  },
  {
    provider: "google",
    match: /^gemini-3\.1-flash-image(?:$|-)/,
    priority: 20,
    caps: {
      profile: "gemini-3.1-flash-image",
      inputs: {
        maxReferenceImages: 14,
        roleLimits: { object: 10, subject: 4 },
      },
      sizing: {
        mode: "ratioBuckets",
        ratios: [...GEMINI_RATIOS, ...GEMINI_EXTREME_RATIOS],
        shortEdge: 1024,
      },
      outputs: { resolutions: ["512", "1K", "2K", "4K"] },
      traits: { textRendering: "strong", latency: "fast" },
    },
  },
];

function mergeCapabilities(
  base: ImageModelCapabilities,
  patch: CapabilityPatch,
): ImageModelCapabilities {
  return {
    ...base,
    ...patch,
    operations: { ...base.operations, ...(patch.operations ?? {}) },
    inputs: { ...base.inputs, ...(patch.inputs ?? {}) },
    outputs: { ...base.outputs, ...(patch.outputs ?? {}) },
    traits: { ...base.traits, ...(patch.traits ?? {}) },
  };
}

function enforceCapabilityInvariants(
  capabilities: ImageModelCapabilities,
): ImageModelCapabilities {
  const referenceEditing =
    capabilities.operations.generate &&
    capabilities.operations.referenceEditing &&
    capabilities.inputs.maxReferenceImages > 0;
  const maskEditing =
    referenceEditing && capabilities.operations.maskEditing;
  return {
    ...capabilities,
    operations: {
      ...capabilities.operations,
      referenceEditing,
      maskEditing,
      outpainting: maskEditing && capabilities.operations.outpainting,
    },
  };
}

/** Key an admin override is stored under. */
export function capabilityKey(provider: ProviderId, modelId: string): string {
  return `${provider}:${modelId.trim().toLowerCase()}`;
}

export type CapabilityOverrides = Record<string, CapabilityOverride>;

/**
 * Resolve a model's capabilities: provider baseline, then any shipped
 * model-specific correction, then the admin override for that exact model.
 */
export function capabilitiesFor(
  selection: ModelSelection | null | undefined,
  overrides?: CapabilityOverrides,
): ImageModelCapabilities {
  const provider: ProviderId = selection?.provider ?? "openai";
  const base = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openai;
  const id = (selection?.id ?? "").toLowerCase();
  let caps: ImageModelCapabilities = mergeCapabilities(base, {});
  for (const profile of [...MODEL_PROFILES].sort((a, b) => a.priority - b.priority)) {
    if (profile.provider === provider && profile.match.test(id)) {
      caps = mergeCapabilities(caps, profile.caps);
    }
  }
  const admin = selection ? overrides?.[capabilityKey(provider, selection.id)] : undefined;
  return enforceCapabilityInvariants(admin ? applyOverride(caps, admin) : caps);
}

// ---- Aspect fit ------------------------------------------------------------

function relativeError(achieved: number, target: number): number {
  return target > 0 ? Math.abs(achieved - target) / target : 0;
}

/** The ratios a bucketed model offers, or null for the continuous modes. */
function bucketsOf(sizing: ImageSizing): AspectRatioOption[] | null {
  if (sizing.mode === "ratioBuckets") return sizing.ratios;
  if (sizing.mode === "fixedSizes") {
    return sizing.sizes
      .map((s) => {
        const dims = parseSize(s);
        return dims ? { token: s, ratio: dims.width / dims.height } : null;
      })
      .filter((r): r is AspectRatioOption => r !== null);
  }
  return null;
}

/**
 * The closest shape this model can produce, and how far off it is.
 *
 * Bucketed models snap to their nearest offering; `arbitrary` models hit the
 * target exactly unless it exceeds their long-to-short ceiling, in which case
 * the error reported is the real one — a 4:1 band asked of a 3:1 model gets
 * cropped, and gating needs to know that.
 */
export function aspectFit(
  caps: ImageModelCapabilities,
  target: number,
): { ratio: number; error: number } {
  const sizing = caps.sizing;
  if (sizing.mode === "arbitrary") {
    const min = 1 / sizing.maxRatio;
    const clamped = Math.min(sizing.maxRatio, Math.max(min, target));
    return { ratio: clamped, error: relativeError(clamped, target) };
  }
  const buckets = bucketsOf(sizing) ?? [];
  if (buckets.length === 0) return { ratio: target, error: 0 };
  let best = buckets[0];
  for (const option of buckets) {
    if (relativeError(option.ratio, target) < relativeError(best.ratio, target)) best = option;
  }
  return { ratio: best.ratio, error: relativeError(best.ratio, target) };
}

/** Whether the model can produce this shape closely enough to be worth using. */
export function aspectIsProducible(caps: ImageModelCapabilities, target: number): boolean {
  return aspectFit(caps, target).error <= MAX_ASPECT_MISMATCH;
}

// ---- Size resolution -------------------------------------------------------

export interface ResolvedImageSize {
  /** `WxH`, ready for {@link ImageRequest.size}. */
  size: string;
  /** The aspect actually being asked for. */
  ratio: number;
  /** How far `ratio` misses the requested target, as a fraction of it. */
  error: number;
}

export function parseSize(size: string): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  return { width, height };
}

function formatSize(width: number, height: number): string {
  return `${Math.round(width)}x${Math.round(height)}`;
}

/** Round to the nearest multiple of `step`, never below one step. */
function toMultiple(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

type Arbitrary = Extract<ImageSizing, { mode: "arbitrary" }>;

interface Canvas {
  width: number;
  height: number;
}

/** Every constraint the endpoint actually enforces, in one predicate. */
function satisfiesConstraints(canvas: Canvas, sizing: Arbitrary): boolean {
  const { width, height } = canvas;
  if (width % sizing.multipleOf !== 0 || height % sizing.multipleOf !== 0) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long > sizing.maxEdge) return false;
  if (long / short > sizing.maxRatio + 1e-9) return false;
  const pixels = width * height;
  return pixels >= sizing.minPixels && pixels <= sizing.maxPixels;
}

/**
 * The best legal canvas near a pixel budget, for a model that takes arbitrary
 * dimensions.
 *
 * Searched rather than computed because the constraints interact: rounding both
 * edges to a multiple of 16 perturbs the ratio, and the perturbation can push a
 * 3:1 request past a 3:1 ceiling. Scoring the neighbourhood of the ideal
 * dimensions and keeping the closest legal one is both more accurate than
 * rounding (0.1% off a book's shape rather than 1.3%) and — because a canvas
 * that already has the requested ratio scores a perfect zero — a fixed point,
 * which is what lets the worker re-derive a client's canvas and land on the
 * same answer instead of a slightly different one.
 */
function bestCanvas(sizing: Arbitrary, ratio: number, budget: number): Canvas | null {
  const step = sizing.multipleOf;
  const idealWidth = Math.sqrt(budget * ratio) / step;
  const idealHeight = Math.sqrt(budget / ratio) / step;

  let best: Canvas | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestSlack = Number.POSITIVE_INFINITY;

  for (let dw = -1; dw <= 1; dw++) {
    for (let dh = -1; dh <= 1; dh++) {
      const width = Math.max(1, Math.round(idealWidth) + dw) * step;
      const height = Math.max(1, Math.round(idealHeight) + dh) * step;
      const candidate = { width, height };
      if (!satisfiesConstraints(candidate, sizing)) continue;
      // Shape first — it is the thing the page cannot compensate for. Area is
      // only the tie-break between two equally well-shaped canvases.
      const score = relativeError(width / height, ratio);
      const slack = Math.abs(width * height - budget);
      if (score < bestScore - 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && slack < bestSlack)) {
        best = candidate;
        bestScore = score;
        bestSlack = slack;
      }
    }
  }
  return best;
}

/**
 * A canvas at (or as near as the constraints allow to) `target`.
 *
 * The budget is walked toward the legal range when the first neighbourhood has
 * nothing in it — a pixel ceiling and an edge ceiling can each rule out the
 * ideal size — and a clamped, guaranteed-legal fallback closes the loop so this
 * never returns a size the endpoint would reject.
 */
function resolveArbitrary(sizing: Arbitrary, target: number): ResolvedImageSize {
  const floorRatio = 1 / sizing.maxRatio;
  const ratio = Math.min(sizing.maxRatio, Math.max(floorRatio, target));
  const budget = Math.min(sizing.maxPixels, Math.max(sizing.minPixels, sizing.pixelBudget));

  let canvas: Canvas | null = null;
  // Halving and doubling around the budget covers both failure directions in a
  // few steps without a solver.
  for (const scale of [1, 0.9, 1.1, 0.75, 1.35, 0.5, 1.8]) {
    const scaled = Math.min(sizing.maxPixels, Math.max(sizing.minPixels, budget * scale));
    canvas = bestCanvas(sizing, ratio, scaled);
    if (canvas) break;
  }

  if (!canvas) {
    // Nothing in the neighbourhood was legal, so build a canvas that is legal
    // by construction: a square inside every ceiling.
    const step = sizing.multipleOf;
    const maxSquare = Math.floor(sizing.maxEdge / step) * step;
    const wanted = toMultiple(Math.sqrt(budget), step);
    const edge = Math.min(maxSquare, wanted);
    canvas = { width: edge, height: edge };
  }

  const achieved = canvas.width / canvas.height;
  return {
    size: formatSize(canvas.width, canvas.height),
    ratio: achieved,
    error: relativeError(achieved, target),
  };
}

/**
 * The canvas to ask this model for, given the shape the page actually wants.
 *
 * `target` is width ÷ height of the region being illustrated — for a full-bleed
 * page that is the page (or spread) aspect; for art beside text it is the art
 * rectangle's own shape. See `core/book/grid.ts` for how a region becomes one.
 */
export function resolveImageSize(
  caps: ImageModelCapabilities,
  target: number,
): ResolvedImageSize {
  const wanted = Number.isFinite(target) && target > 0 ? target : 1;
  const sizing = caps.sizing;

  if (sizing.mode === "arbitrary") return resolveArbitrary(sizing, wanted);

  if (sizing.mode === "fixedSizes") {
    const sizes = sizing.sizes.length > 0 ? sizing.sizes : OPENAI_FIXED_SIZES;
    let best = sizes[0];
    let bestRatio = parseSize(best)?.width ?? 1;
    let bestError = Number.POSITIVE_INFINITY;
    for (const candidate of sizes) {
      const dims = parseSize(candidate);
      if (!dims) continue;
      const r = dims.width / dims.height;
      const error = relativeError(r, wanted);
      if (error < bestError) {
        best = candidate;
        bestRatio = r;
        bestError = error;
      }
    }
    return { size: best, ratio: bestRatio, error: bestError };
  }

  // Ratio buckets: snap to the nearest offered ratio and synthesize a canvas
  // that carries it exactly, so the adapter can read the token back off it.
  const { ratio: snapped, error } = aspectFit(caps, wanted);
  const edge = Math.max(64, Math.round(sizing.shortEdge));
  const size =
    snapped >= 1
      ? formatSize(Math.round(edge * snapped), edge)
      : formatSize(edge, Math.round(edge / snapped));
  return { size, ratio: snapped, error };
}

/**
 * Re-derive a canvas the model definitely accepts from one we were handed.
 *
 * The studio pre-assembles image tasks client-side, so `size` on a queued task
 * is user-supplied input: it may name a canvas the server-resolved model can't
 * produce, or an 8 MP one chosen to burn somebody's Sparks (image tokens scale
 * with area). The worker therefore keeps only the SHAPE of the request and
 * re-resolves the pixels through the same policy the pipeline uses.
 */
export function sanitizeImageSize(
  caps: ImageModelCapabilities,
  requested: string | undefined,
): string | undefined {
  if (!requested) return undefined;
  const dims = parseSize(requested);
  if (!dims) return undefined;
  return resolveImageSize(caps, dims.width / dims.height).size;
}

/**
 * The provider's own name for a canvas's ratio, for endpoints that take a token
 * instead of pixels.
 *
 * Recovering the token here — rather than threading it through every layer of
 * the pipeline that passes a `size` along — works because
 * {@link resolveImageSize} only ever emits a canvas whose ratio IS one of the
 * model's buckets, so the nearest match is the exact one. A legacy job payload
 * carrying an unrelated size still lands on its closest bucket, which is what
 * the adapter used to do for every request.
 */
export function ratioTokenForSize(
  caps: ImageModelCapabilities,
  size: string | undefined,
): string | undefined {
  if (!size) return undefined;
  const dims = parseSize(size);
  if (!dims) return undefined;
  // Only a bucketed model has provider-named ratios. The other modes' "tokens"
  // are pixel sizes, and handing one to a ratio parameter is a 400.
  if (caps.sizing.mode !== "ratioBuckets") return undefined;
  const buckets = caps.sizing.ratios;
  if (buckets.length === 0) return undefined;
  const target = dims.width / dims.height;
  let best = buckets[0];
  for (const option of buckets) {
    if (relativeError(option.ratio, target) < relativeError(best.ratio, target)) best = option;
  }
  return best.token;
}

// ---- Reporting -------------------------------------------------------------

/** A surface to preview the sizing policy against. */
export interface SizingSurface {
  label: string;
  /** Width ÷ height of the region a picture would fill. */
  aspect: number;
  /** Printed width, when the resulting resolution is worth showing. */
  widthIn?: number;
}

export interface SizingReportRow extends ResolvedImageSize {
  label: string;
  /** The shape the surface wanted. */
  target: number;
  width: number;
  height: number;
  /**
   * The provider's ratio token, for a model we ask by shape rather than by
   * pixels. Present means `size` is only a carrier for this and says nothing
   * about the resolution that comes back.
   */
  token?: string;
  /**
   * Pixels per printed inch — only when we actually choose the pixels. A
   * bucketed model picks its own resolution from the ratio, so quoting a DPI
   * for one would be inventing a number.
   */
  dpi?: number;
  /** Whether the miss is inside {@link MAX_ASPECT_MISMATCH}. */
  producible: boolean;
}

/**
 * What this model would actually be asked for, surface by surface.
 *
 * The projection the admin screen renders. It lives here rather than in the
 * component for the same reason the policy does: a panel that recomputed "which
 * canvas would we ask for" from the capability fields would be a fourth opinion
 * about output geometry, and could reassure an admin about a size the pipeline
 * never requests.
 */
export function sizingReport(
  caps: ImageModelCapabilities,
  surfaces: SizingSurface[],
): SizingReportRow[] {
  const nominalPixels = caps.sizing.mode === "ratioBuckets";
  return surfaces.map((surface) => {
    const resolved = resolveImageSize(caps, surface.aspect);
    const dims = parseSize(resolved.size);
    const width = dims?.width ?? 0;
    const height = dims?.height ?? 0;
    const token = ratioTokenForSize(caps, resolved.size);
    return {
      ...resolved,
      label: surface.label,
      target: surface.aspect,
      width,
      height,
      ...(token ? { token } : {}),
      ...(surface.widthIn && !nominalPixels
        ? { dpi: Math.round(width / surface.widthIn) }
        : {}),
      producible: resolved.error <= MAX_ASPECT_MISMATCH,
    };
  });
}

/** One line describing what shapes and sizes this model offers. */
export function sizingSummary(caps: ImageModelCapabilities): string {
  const sizing = caps.sizing;
  if (sizing.mode === "arbitrary") {
    const mp = (sizing.pixelBudget / 1_000_000).toFixed(1);
    return `Any shape up to ${sizing.maxRatio}:1, in multiples of ${sizing.multipleOf}px, generated at about ${mp} MP.`;
  }
  if (sizing.mode === "fixedSizes") {
    return `${sizing.sizes.length} fixed canvases: ${sizing.sizes.join(", ")}.`;
  }
  return (
    `Asked by shape, not by pixels — the provider chooses the resolution. ` +
    `${sizing.ratios.length} shapes: ${sizing.ratios.map((r) => r.token).join(", ")}.`
  );
}

/** Human label for the sizing mode, for a badge. */
export function sizingModeLabel(caps: ImageModelCapabilities): string {
  switch (caps.sizing.mode) {
    case "arbitrary":
      return "Any size";
    case "fixedSizes":
      return "Fixed sizes";
    default:
      return "Aspect ratios";
  }
}

/**
 * A token for a bare ratio, so a numeric admin override can still be sent to a
 * provider that only speaks tokens. Prefers the shared vocabulary and falls
 * back to a small-denominator rational.
 */
export function tokenForRatio(value: number): string {
  const known = RATIO_VOCABULARY.find((r) => relativeError(r.ratio, value) <= 0.01);
  if (known) return known.token;
  let bestNum = 1;
  let bestDen = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let den = 1; den <= 32; den++) {
    const num = Math.max(1, Math.round(value * den));
    const error = relativeError(num / den, value);
    if (error < bestError) {
      bestError = error;
      bestNum = num;
      bestDen = den;
    }
  }
  return `${bestNum}:${bestDen}`;
}

// ---- Admin overrides -------------------------------------------------------

const aspectRatioOptionSchema = z.object({
  token: z.string().min(3).max(12),
  ratio: z.number().positive().max(12),
});

const imageSizingSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ratioBuckets"),
    ratios: z.array(aspectRatioOptionSchema).min(1).max(24),
    shortEdge: z.number().int().min(64).max(4096),
  }),
  z.object({
    mode: z.literal("fixedSizes"),
    sizes: z.array(z.string().regex(/^\d+x\d+$/)).min(1).max(24),
  }),
  z.object({
    mode: z.literal("arbitrary"),
    multipleOf: z.number().int().min(1).max(64),
    maxEdge: z.number().int().min(256).max(8192),
    minPixels: z.number().int().min(1),
    maxPixels: z.number().int().min(1),
    maxRatio: z.number().min(1).max(12),
    pixelBudget: z.number().int().min(1),
  }),
]);

/**
 * What an admin may correct, in the shape they'd want to type it.
 *
 * Nested groups replace only the facts an admin explicitly corrected.
 * Geometry keeps two shorthand controls — `ratios` and `maxPixels` — because
 * they are the common operational corrections and should not require an admin
 * to restate the model's entire sizing contract.
 */
export const imageCapabilitiesSchema = z
  .object({
    operations: z
      .object({
        referenceEditing: z.boolean(),
        maskEditing: z.boolean(),
        outpainting: z.boolean(),
      })
      .partial(),
    inputs: z
      .object({
        maxReferenceImages: z.number().int().min(0).max(64),
        roleLimits: z
          .object({
            subject: z.number().int().min(0).max(64),
            object: z.number().int().min(0).max(64),
            style: z.number().int().min(0).max(64),
          })
          .partial(),
        formats: z.array(z.enum(IMAGE_FORMATS)).min(1),
        referenceBinding: z.enum(["ordered", "labeled"]),
        inputFidelityLevels: z.array(z.enum(["low", "high"])),
      })
      .partial(),
    outputs: z
      .object({
        formats: z.array(z.enum(IMAGE_FORMATS)).min(1),
        backgrounds: z.array(z.enum(["opaque", "transparent", "auto"])).min(1),
        qualityLevels: z.array(z.enum(IMAGE_QUALITIES)),
        resolutions: z.array(z.string().min(1).max(20)).max(12),
        compression: z.boolean(),
      })
      .partial(),
    traits: z
      .object({
        negativeSpaceControl: z.enum(["weak", "strong"]),
        textRendering: z.enum(CAPABILITY_RATINGS),
        promptAdherence: z.enum(CAPABILITY_RATINGS),
        referenceConsistency: z.enum(CAPABILITY_RATINGS),
        editingPrecision: z.enum(CAPABILITY_RATINGS),
        latency: z.enum(["fast", "balanced", "slow"]),
      })
      .partial(),
    // Legacy flat fields remain readable so existing Firestore overrides migrate
    // without changing behavior. New admin writes use the nested groups above.
    maskEditing: z.boolean(),
    maxReferenceImages: z.number().int().min(1).max(32),
    negativeSpaceControl: z.enum(["weak", "strong"]),
    textRendering: z.enum(["none", "weak", "strong"]),
    sizing: imageSizingSchema,
    /** Restrict output to these ratio tokens, e.g. `["1:1", "4:3"]`. */
    ratios: z.array(z.string().regex(/^\d+:\d+$/)).min(1).max(24),
    /** Resolution ceiling, in total pixels. */
    maxPixels: z.number().int().min(65_536).max(33_177_600),
    /** Legacy numeric form of `ratios`, kept so stored configs keep loading. */
    aspectRatios: z.array(z.number().positive().max(12)).min(1).max(24),
  })
  .partial();

export type CapabilityOverride = z.infer<typeof imageCapabilitiesSchema>;

export const capabilityOverridesSchema = z.record(
  z.string().max(120),
  imageCapabilitiesSchema,
);

/** Turn the sugar forms into a concrete {@link ImageSizing}. */
function sizingFromOverride(
  base: ImageSizing,
  override: CapabilityOverride,
): ImageSizing {
  let sizing: ImageSizing = override.sizing ?? base;

  const tokens =
    override.ratios ?? override.aspectRatios?.map((r) => tokenForRatio(r));
  if (tokens && tokens.length > 0) {
    const ratios = tokens.map((token) => {
      const known = RATIO_VOCABULARY.find((r) => r.token === token);
      if (known) return known;
      const [w, h] = token.split(":").map(Number);
      return { token, ratio: w / h };
    });
    // Restricting the shapes means the model is bucketed now, whatever it was:
    // an admin listing three ratios does not want arbitrary sizing honoured.
    sizing = {
      mode: "ratioBuckets",
      ratios,
      shortEdge: sizing.mode === "ratioBuckets" ? sizing.shortEdge : 1024,
    };
  }

  if (override.maxPixels != null && sizing.mode === "arbitrary") {
    // The chosen resolution, not merely a ceiling on the shipped one: an admin
    // raising this wants more pixels on the page (print DPI), and one lowering
    // it wants a cheaper image. Clamped to the constraints the endpoint itself
    // enforces, so no value here can make the constraint set unsatisfiable.
    const chosen = Math.min(sizing.maxPixels, Math.max(sizing.minPixels, override.maxPixels));
    sizing = { ...sizing, maxPixels: chosen, pixelBudget: chosen };
  }

  return sizing;
}

function applyOverride(
  base: ImageModelCapabilities,
  override: CapabilityOverride,
): ImageModelCapabilities {
  const nested = mergeCapabilities(base, {
    operations: {
      ...override.operations,
      ...(override.maskEditing !== undefined
        ? { maskEditing: override.maskEditing }
        : {}),
    },
    inputs: {
      ...override.inputs,
      ...(override.maxReferenceImages !== undefined
        ? { maxReferenceImages: override.maxReferenceImages }
        : {}),
    },
    outputs: override.outputs,
    traits: {
      ...override.traits,
      ...(override.negativeSpaceControl !== undefined
        ? { negativeSpaceControl: override.negativeSpaceControl }
        : {}),
      ...(override.textRendering !== undefined
        ? { textRendering: override.textRendering }
        : {}),
    },
  });
  return {
    ...nested,
    sizing: sizingFromOverride(base.sizing, override),
  };
}
