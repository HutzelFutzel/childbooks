/** Resolves the user's art-style selection into a prompt fragment. */
import { ART_STYLE_PRESETS } from "../config/options";
import type { ArtStyleSelection } from "../types";

export function resolveArtStyleText(style: ArtStyleSelection): string {
  const preset = style.presetId
    ? ART_STYLE_PRESETS.find((p) => p.id === style.presetId)
    : undefined;
  const parts: string[] = [];
  if (preset) parts.push(preset.promptHint);
  if (style.customDescription?.trim()) parts.push(style.customDescription.trim());
  if (parts.length === 0) parts.push("charming children's book illustration");
  return parts.join(", ");
}
