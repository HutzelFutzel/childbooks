/** Resolves the user's art-style selection into a prompt fragment. */
import { ART_STYLE_PRESETS } from "../config/options";
import type { ArtStylesConfig } from "../config/artStyles";
import type { ArtStyleSelection } from "../types";
import type { PromptContext } from "./context";

export function resolveArtStyleText(
  style: ArtStyleSelection,
  ctx?: Pick<PromptContext, "artStyles"> | ArtStylesConfig | null,
): string {
  const artStyles =
    ctx && "artStyles" in ctx ? ctx.artStyles : (ctx as ArtStylesConfig | null | undefined);
  const preset = style.presetId
    ? ART_STYLE_PRESETS.find((p) => p.id === style.presetId)
    : undefined;
  const parts: string[] = [];

  const adminDesc =
    style.presetId && artStyles?.promptDescriptions[style.presetId]?.text?.trim();
  if (adminDesc) {
    parts.push(adminDesc);
  } else if (preset?.promptDescription?.trim()) {
    parts.push(preset.promptDescription.trim());
  } else if (preset?.promptHint) {
    parts.push(preset.promptHint);
  }

  if (style.customDescription?.trim()) parts.push(style.customDescription.trim());
  if (parts.length === 0) parts.push("charming children's book illustration");
  return parts.join(". ");
}
