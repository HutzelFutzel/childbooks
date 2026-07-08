/** Shared prompt overlays loaded from admin `appConfig/*` documents. */
import type { ArtStylesConfig } from "../config/artStyles";
import type { AgeWritingConfig } from "../config/ageWriting";
import type { PromptsConfig } from "../config/prompts";
import { createDefaultPromptsConfig } from "./registry";

export interface PromptContext {
  artStyles?: ArtStylesConfig | null;
  ageWriting?: AgeWritingConfig | null;
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
