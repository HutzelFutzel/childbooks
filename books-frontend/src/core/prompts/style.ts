/** Resolves the user's art-style selection into a prompt fragment. */
import {
  resolveArtStyle,
  type ArtStylesConfig,
} from "../config/artStyles";
import type { ArtStyleSelection, ImageRenderRecord } from "../types";
import { customStyleKeyOf } from "../config/customArtStyles";
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
 * Admin wording changes do not invalidate art, but replacing the snapshotted
 * generation exemplar does.
 */
export function artStyleKey(style: ArtStyleSelection | undefined): string {
  // A saved custom style IS its record: one revision is one look, whatever
  // wording a client holds next to the pointer.
  if (style?.customStyle) return customStyleKeyOf(style.customStyle);
  const preset = style?.presetId ?? "custom";
  const custom = (style?.customDescription ?? "").trim();
  const references = (style?.referenceArt ?? [])
    .map((image) => image.blobId)
    .join(",");
  const generationReference = style?.generationReference
    ? `${style.generationReference.storagePath}@${style.generationReference.updatedAt}`
    : "";
  return [preset, custom, references, generationReference].filter(Boolean).join("|");
}

/** The look a picture is being drawn in, as it is recorded on the picture. */
export function styleStampOf(
  style: ArtStyleSelection | undefined,
): NonNullable<ImageRenderRecord["style"]> {
  return {
    presetId: style?.presetId ?? null,
    ...(style?.customStyle
      ? { customStyleId: style.customStyle.id, customStyleRevision: style.customStyle.revision }
      : {}),
    ...(style?.origin ? { origin: style.origin } : {}),
    key: artStyleKey(style),
  };
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
