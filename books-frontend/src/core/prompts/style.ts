/** Resolves the user's art-style selection into a prompt fragment. */
import {
  resolveArtStyle,
  type ArtStylesConfig,
} from "../config/artStyles";
import type { ArtStyleSelection } from "../types";
import type { PromptContext } from "./context";

export function resolveArtStyleText(
  style: ArtStyleSelection,
  ctx?: Pick<PromptContext, "artStyles"> | ArtStylesConfig | null,
): string {
  const artStyles =
    ctx && "artStyles" in ctx ? ctx.artStyles : (ctx as ArtStylesConfig | null | undefined);
  const preset = style.presetId
    ? resolveArtStyle(style.presetId, artStyles)
    : undefined;
  const parts: string[] = [];

  if (preset?.promptDescription?.trim()) {
    parts.push(preset.promptDescription.trim());
  }

  if (style.customDescription?.trim()) parts.push(style.customDescription.trim());
  if (parts.length === 0) parts.push("charming children's book illustration");
  return parts.join(". ");
}

/** User-facing name for the current look, including artwork-derived styles. */
export function resolveArtStyleDisplayName(
  style: ArtStyleSelection | undefined,
  ctx?: Pick<PromptContext, "artStyles"> | ArtStylesConfig | null,
): string {
  if (style?.origin === "derived") return "From your character artwork";
  if (style?.presetId) return resolveArtStyleLabel(style.presetId, ctx);
  return "Custom";
}

/**
 * Stable identity of an art-style selection, stamped onto every rendered image
 * so the studio can tell which artwork is still in an older look. Compares
 * preset + custom direction only — admin wording changes don't invalidate art.
 */
export function artStyleKey(style: ArtStyleSelection | undefined): string {
  const preset = style?.presetId ?? "custom";
  const custom = (style?.customDescription ?? "").trim();
  return custom ? `${preset}|${custom}` : preset;
}

/** Resolve the display title for a configured or legacy preset. */
export function resolveArtStyleLabel(
  presetId: string,
  ctx?: Pick<PromptContext, "artStyles"> | ArtStylesConfig | null,
): string {
  const artStyles =
    ctx && "artStyles" in ctx ? ctx.artStyles : (ctx as ArtStylesConfig | null | undefined);
  const preset = resolveArtStyle(presetId, artStyles);
  return preset?.label ?? presetId;
}
