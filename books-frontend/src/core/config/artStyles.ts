/**
 * Admin-managed art-style catalog (`appConfig/artStyles`).
 *
 * The shipped presets seed a new installation, but the stored catalog is the
 * source of truth: admins may add, order, hide and restore styles without a
 * deploy. Hidden definitions remain resolvable so existing books never lose
 * the look they were created with.
 */
import { z } from "zod";
import { ART_STYLE_PRESETS, type ArtStylePreset } from "./options";
import {
  imageGenerationHintsSchema,
  type ImageGenerationHints,
} from "./imageGeneration";

export interface ArtStyleExample {
  /** Public customer-facing preview. It is never sent to an image model. */
  imageUrl: string;
  /** Storage path, used as the stable key and for deletion. */
  storagePath?: string;
  order: number;
  updatedAt: number;
}

export interface ArtStyleDefinition {
  /** Stable project-facing identifier. Never recycle an id for another look. */
  id: string;
  label: string;
  /** Short customer-facing description of visible qualities. */
  description: string;
  /** Detailed text sent to image generation. Preview images are UI-only. */
  promptDescription: string;
  /** Hidden styles disappear for new choices but remain valid for old books. */
  enabled: boolean;
  order: number;
  examples: ArtStyleExample[];
  /** Best-effort provider-neutral output preferences for this style. */
  generationHints: ImageGenerationHints;
  createdAt: number;
  updatedAt: number;
}

export interface ArtStylesConfig {
  version: 2;
  styles: ArtStyleDefinition[];
}

function definitionFromPreset(
  preset: ArtStylePreset,
  order: number,
  now = 0,
): ArtStyleDefinition {
  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    promptDescription: preset.promptDescription || preset.promptHint,
    enabled: true,
    order,
    examples: [],
    generationHints: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultArtStylesConfig(): ArtStylesConfig {
  return {
    version: 2,
    styles: ART_STYLE_PRESETS.map((preset, order) =>
      definitionFromPreset(preset, order),
    ),
  };
}

type LegacyArtStylesConfig = {
  examples?: Record<string, Omit<ArtStyleExample, "order">>;
  promptDescriptions?: Record<string, { text?: string; updatedAt?: number }>;
  labels?: Record<string, { text?: string; updatedAt?: number }>;
  generationHints?: Record<string, ImageGenerationHints>;
};

function fromLegacy(stored: LegacyArtStylesConfig): ArtStylesConfig {
  return {
    version: 2,
    styles: ART_STYLE_PRESETS.map((preset, order) => {
      const example = stored.examples?.[preset.id];
      const label = stored.labels?.[preset.id];
      const prompt = stored.promptDescriptions?.[preset.id];
      const updatedAt = Math.max(
        example?.updatedAt ?? 0,
        label?.updatedAt ?? 0,
        prompt?.updatedAt ?? 0,
      );
      return {
        ...definitionFromPreset(preset, order),
        label: label?.text?.trim() || preset.label,
        promptDescription:
          prompt?.text?.trim() || preset.promptDescription || preset.promptHint,
        examples: example ? [{ ...example, order: 0 }] : [],
        generationHints: stored.generationHints?.[preset.id] ?? {},
        updatedAt,
      };
    }),
  };
}

export function normalizeArtStylesConfig(input: unknown): ArtStylesConfig {
  if (!input || typeof input !== "object") return createDefaultArtStylesConfig();
  const stored = input as Partial<ArtStylesConfig> & LegacyArtStylesConfig;
  if (!Array.isArray(stored.styles)) return fromLegacy(stored);

  const seen = new Set<string>();
  const styles = stored.styles.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const id = String(raw.id ?? "").trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const fallback = ART_STYLE_PRESETS.find((preset) => preset.id === id);
    const examples = Array.isArray(raw.examples)
      ? raw.examples
          .filter((example) => Boolean(example?.imageUrl))
          .map((example, exampleIndex) => ({
            imageUrl: String(example.imageUrl),
            ...(example.storagePath
              ? { storagePath: String(example.storagePath) }
              : {}),
            order: Number.isFinite(example.order) ? example.order : exampleIndex,
            updatedAt: Number.isFinite(example.updatedAt)
              ? example.updatedAt
              : 0,
          }))
          .sort((a, b) => a.order - b.order)
      : [];
    return [{
      id,
      label: String(raw.label ?? fallback?.label ?? id),
      description: String(raw.description ?? fallback?.description ?? ""),
      promptDescription: String(
        raw.promptDescription ??
          fallback?.promptDescription ??
          fallback?.promptHint ??
          "",
      ),
      enabled: raw.enabled !== false,
      order: Number.isFinite(raw.order) ? raw.order : index,
      examples,
      generationHints: raw.generationHints ?? {},
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    }];
  });
  // A later release may ship another starter style after an installation has
  // already saved its v2 catalog. Add only missing shipped ids at the end;
  // existing rows keep their admin-managed order and enabled state.
  for (const preset of ART_STYLE_PRESETS) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    styles.push(definitionFromPreset(preset, styles.length));
  }

  return {
    version: 2,
    styles: styles.sort((a, b) => a.order - b.order),
  };
}

export function resolveArtStyles(
  config?: ArtStylesConfig | null,
  options: { includeDisabled?: boolean } = {},
): ArtStyleDefinition[] {
  const styles = (config ?? createDefaultArtStylesConfig()).styles;
  return styles
    .filter((style) => options.includeDisabled || style.enabled)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** Resolve hidden/legacy ids too, so existing projects keep a usable style. */
export function resolveArtStyle(
  presetId: string,
  config?: ArtStylesConfig | null,
): ArtStyleDefinition | undefined {
  const configured = config?.styles.find((style) => style.id === presetId);
  if (configured) return configured;
  const preset = ART_STYLE_PRESETS.find((style) => style.id === presetId);
  return preset
    ? definitionFromPreset(preset, ART_STYLE_PRESETS.indexOf(preset))
    : undefined;
}

const exampleSchema = z.object({
  imageUrl: z.string().url(),
  storagePath: z.string().optional(),
  order: z.number().int().min(0),
  updatedAt: z.number(),
});

export const artStylesConfigSchema = z.object({
  version: z.literal(2),
  styles: z.array(
    z.object({
      id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
      label: z.string().min(1).max(120),
      description: z.string().max(300),
      promptDescription: z.string().min(1).max(8000),
      enabled: z.boolean(),
      order: z.number().int().min(0),
      examples: z.array(exampleSchema).max(12),
      generationHints: imageGenerationHintsSchema,
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ).max(100),
}).superRefine((config, ctx) => {
  const ids = new Set<string>();
  config.styles.forEach((style, index) => {
    if (ids.has(style.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate art style id "${style.id}".`,
        path: ["styles", index, "id"],
      });
    }
    ids.add(style.id);
  });
});
