/** Shared prompt overlays loaded from admin `appConfig/*` documents. */
import type { ArtStylesConfig } from "../config/artStyles";
import type { AgeWritingConfig } from "../config/ageWriting";
import type { AudienceConfig } from "../config/audience";
import type { StoryCraftConfig } from "../config/storyCraft";
import type { PromptsConfig } from "../config/prompts";
import { createDefaultPromptsConfig } from "./registry";

export interface PromptContext {
  artStyles?: ArtStylesConfig | null;
  /**
   * Age bands and every editorial rule attached to them
   * (`appConfig/audience`). The source of truth for age guidance.
   */
  audience?: AudienceConfig | null;
  /**
   * LEGACY age guidance (`appConfig/ageWriting`), merged underneath `audience`
   * so a deployment that customised it before the migration keeps its wording.
   */
  ageWriting?: AgeWritingConfig | null;
  /** Per-age-band themes, devices and settings (`appConfig/storyCraft`). */
  storyCraft?: StoryCraftConfig | null;
  /** Admin-editable prompt templates (`appConfig/prompts`). */
  templates?: PromptsConfig | null;
}

/** The prompt templates from a context, falling back to the shipped defaults. */
export function resolvePromptsConfig(
  ctx?: Pick<PromptContext, "templates"> | PromptsConfig | null,
): PromptsConfig {
  if (!ctx) return createDefaultPromptsConfig();
  // A PromptsConfig has its own `version`/`partials`; a PromptContext only carries
  // the templates on a `templates` field.
  if ("version" in ctx && "partials" in ctx) return ctx as PromptsConfig;
  return (ctx as PromptContext).templates ?? createDefaultPromptsConfig();
}
