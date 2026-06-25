/**
 * Anchor image generation: builds consistency-oriented prompts and renders
 * multi-angle reference sheets on a plain white background, with optional
 * reference images for iterative edits ("make him smile", branch, etc.).
 */
import type { ProviderId } from "../config/options";
import { getImageProvider } from "../providers";
import type {
  ImageResult,
  ProviderCredentials,
  ReferenceImage,
} from "../providers/types";
import { resolveArtStyleText } from "../prompts/style";
import type { Anchor, ArtStyleSelection } from "../types";
import { withRetry } from "./retry";

const ANGLE_HINT: Record<Anchor["type"], string> = {
  character:
    "full-body character reference sheet showing the same character from multiple angles (front, three-quarter, side, and back), consistent proportions and design",
  place:
    "environment reference sheet showing the SAME location from a few key viewpoints (wide establishing view and one or two closer angles). Every viewpoint must show the IDENTICAL space — identical architecture, furniture, wall décor, props, layout and color palette. Only the camera angle changes between views; never add, remove, move or alter any element from one view to another",
  object:
    "object reference sheet showing the SAME item from multiple angles (front, side, three-quarter). Keep identical shape, proportions, materials, markings and colors across every angle; only the viewpoint changes",
};

export interface BuildAnchorPromptInput {
  anchor: Anchor;
  artStyle: ArtStyleSelection;
  /**
   * Anchors explicitly CONTAINED in this one (place/object): drawn into the
   * sheet and matched exactly to their own reference images.
   */
  containedAnchors?: Anchor[];
  /**
   * Anchors this one RELATES to / resembles: context only (e.g. family traits),
   * never drawn as separate figures here.
   */
  relatedAnchors?: Anchor[];
  /** Optional extra instruction for an iteration (e.g. "make her smile"). */
  edit?: string;
  /**
   * True when the anchor's own current image is supplied as the edit base (so
   * we frame the prompt as a minimal edit of that image rather than rebuilding
   * the description from scratch — which would re-assert removed features).
   */
  editFromImage?: boolean;
}

/** Build the base prompt for an anchor reference sheet. */
export function buildAnchorPrompt(input: BuildAnchorPromptInput): string {
  const {
    anchor,
    artStyle,
    containedAnchors = [],
    relatedAnchors = [],
    edit,
    editFromImage = false,
  } = input;

  // Edit-from-image: keep the current image as the source of truth and apply
  // ONLY the requested change. We deliberately omit the full description and
  // style text (both are already baked into the provided image) so they can't
  // reintroduce features the user just removed.
  if (edit?.trim() && editFromImage) {
    const identity =
      anchor.type === "character"
        ? "the same character — identical face, hair, body, colors and outfit"
        : "the same item — identical shapes, proportions, materials, markings and colors";
    const parts = [
      `Edit the provided reference sheet image of "${anchor.name}".`,
      `Apply ONLY this change: ${edit.trim()}.`,
      `Keep everything else exactly the same: ${identity}, the multi-angle layout, framing, lighting and the plain white background. Do not add, remove, restyle or redesign anything the change does not explicitly require.`,
      "No text, labels or watermark.",
    ];
    return parts.filter(Boolean).join(" ");
  }

  const styleText = resolveArtStyleText(artStyle);
  const parts = [
    `${ANGLE_HINT[anchor.type]} of "${anchor.name}".`,
    anchor.description.trim(),
  ];
  if (anchor.userGuidance?.trim()) parts.push(anchor.userGuidance.trim());

  // Explicit relationship handling (links are user-declared by id, not inferred
  // from text). Contained subjects are drawn; related subjects are context only.
  const contained =
    anchor.type === "character"
      ? [] // a character can't physically "contain" another anchor
      : containedAnchors;
  if (contained.length > 0) {
    parts.push(
      `This ${anchor.type} contains the following, which must look EXACTLY like their reference images (same shape, materials, colors and details): ` +
        contained.map((r) => `${r.name} (${r.description})`).join("; ") +
        ".",
    );
  }
  if (relatedAnchors.length > 0) {
    parts.push(
      "Related subjects for resemblance/context only — match the described relationships (e.g. family traits) but do NOT draw them as separate figures in this sheet: " +
        relatedAnchors.map((r) => `${r.name} (${r.description})`).join("; ") +
        ".",
    );
  }

  parts.push(`Art style: ${styleText}.`);
  parts.push(
    "Plain pure-white seamless background, even soft studio lighting, no text, no labels, no watermark, clearly separated angles.",
  );
  if (edit?.trim()) parts.push(`Revision: ${edit.trim()}.`);
  return parts.filter(Boolean).join(" ");
}

export interface GenerateAnchorImageInput {
  prompt: string;
  creds: ProviderCredentials;
  model: string;
  references?: ReferenceImage[];
  signal?: AbortSignal;
  providerId: ProviderId;
}

/** Generate one anchor image with retry. */
export async function generateAnchorImage(
  input: GenerateAnchorImageInput,
): Promise<ImageResult> {
  const { prompt, creds, model, references, signal, providerId } = input;
  const provider = getImageProvider(providerId);
  return withRetry(
    () =>
      provider.generateImage(creds, {
        model,
        prompt,
        size: "1024x1024",
        references,
        signal,
      }),
    { signal },
  );
}
