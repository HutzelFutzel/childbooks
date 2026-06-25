/**
 * Illustration generation: builds a per-page image prompt from the screenplay
 * spread + book settings, picks a fitting canvas size, and renders the image
 * using the chosen anchors as reference images for visual consistency.
 */
import type { BookSize } from "../config/options";
import { getImageProvider } from "../providers";
import type {
  ImageResult,
  ProviderCredentials,
  ReferenceImage,
} from "../providers/types";
import { resolveArtStyleText } from "../prompts/style";
import type { Anchor, BookConfig, ScreenplaySpread } from "../types";
import { withRetry } from "./retry";

/** Choose a provider-friendly canvas size for a page/spread. */
export function chooseImageSize(
  kind: ScreenplaySpread["kind"],
  bookSize: BookSize,
): string {
  if (kind === "spread") return "1536x1024"; // wide double-page
  switch (bookSize) {
    case "portrait":
      return "1024x1536";
    case "landscape":
      return "1536x1024";
    default:
      return "1024x1024";
  }
}

export interface BuildIllustrationPromptInput {
  spread: ScreenplaySpread;
  config: BookConfig;
  /**
   * Anchors that have reference images. Each is also passed to the model as a
   * labeled reference image so the model maps it to the correct named subject.
   */
  referencedAnchors: Anchor[];
  /** Anchors without an image yet — mentioned by description only. */
  describedAnchors?: Anchor[];
  /**
   * Subjects that were present in the previous version but are no longer active
   * on this page — they must be removed from the regenerated image.
   */
  removedAnchors?: Anchor[];
  /**
   * Subjects whose design changed since this page was last generated, so an
   * edit should ALSO refresh them to their new reference (not just apply the
   * textual change). Names not already mentioned by the edit.
   */
  refreshAnchors?: Anchor[];
  /**
   * Whether the current page illustration is appended as the FINAL reference
   * image (used for edits, to preserve composition).
   */
  hasCompositionRef?: boolean;
  /** Whether an inpainting mask is supplied (restrict change to masked area). */
  maskMode?: boolean;
  /** Optional revision instruction for an iteration. */
  edit?: string;
}

export function buildIllustrationPrompt(input: BuildIllustrationPromptInput): string {
  const {
    spread,
    config,
    referencedAnchors,
    describedAnchors = [],
    removedAnchors = [],
    refreshAnchors = [],
    hasCompositionRef = false,
    maskMode = false,
    edit,
  } = input;
  const styleText = resolveArtStyleText(config.artStyle);

  const parts: string[] = [];

  parts.push(
    spread.kind === "spread"
      ? "Full double-page spread illustration: ONE single continuous wide scene that spans both facing pages. Do NOT split it into two panels, do NOT mirror, tile, or duplicate the scene, and do NOT place a divider or seam down the center. Each character and object appears exactly once."
      : "Single-page illustration.",
  );

  parts.push(spread.illustration.trim());

  // Subjects with a reference image — bind by name (each image is also labeled
  // with this name when sent to the model). Instructions differ by type:
  // characters keep their identity but may re-pose; places/objects are locked.
  if (referencedAnchors.length > 0) {
    const characters = referencedAnchors.filter((a) => a.type === "character");
    const settings = referencedAnchors.filter((a) => a.type !== "character");
    if (characters.length > 0) {
      parts.push(
        `Keep these characters looking exactly like their provided reference images — ${characters
          .map((a) => `${a.name} (${a.description})`)
          .join(
            "; ",
          )}. Match each one's face, hair, colors, outfit and overall design to its own reference image; only their pose, expression and camera angle may change to fit the scene.`,
      );
    }
    if (settings.length > 0) {
      parts.push(
        `These places/objects must match their reference images EXACTLY — ${settings
          .map((a) => `${a.name} (${a.description})`)
          .join(
            "; ",
          )}. Keep the same architecture, layout, furniture, props, materials and colors; only the camera angle or viewpoint may change. Do not redesign, rearrange, add or remove their elements unless this page's description explicitly says the setting changed.`,
      );
    }
  }

  if (describedAnchors.length > 0) {
    parts.push(
      "Also feature these subjects: " +
        describedAnchors.map((a) => `${a.name} (${a.description})`).join("; ") +
        ".",
    );
  }

  // Reference-image legend: the provider receives images in a fixed order
  // (each named subject first, then the page image). Spelling out that order
  // lets the model bind each reference to the right subject — critical when
  // several characters/places changed and must ALL be updated, not just one.
  if (referencedAnchors.length > 0) {
    const legend = referencedAnchors.map((a) => a.name);
    if (hasCompositionRef) {
      legend.push(maskMode ? "the page being edited" : "the current page of this book");
    }
    parts.push(
      `The reference images are provided in this exact order: ${legend
        .map((name, i) => `(${i + 1}) ${name}`)
        .join(", ")}. Use each reference image ONLY for its matching item above, and update every one of the named subjects to match its own reference.`,
    );
  }

  // Closed cast + single-instance rule: prevent invented or duplicated subjects.
  const castNames = [...referencedAnchors, ...describedAnchors].map((a) => a.name);
  if (castNames.length > 0) {
    parts.push(
      `The only named subjects that may appear are: ${castNames.join(", ")}. Do NOT invent or add any other named characters or people. Each named subject must appear EXACTLY ONCE — never draw two copies of the same character. If the requested change involves a subject already in the scene, reposition or adjust that same existing subject instead of adding another.`,
    );
  }

  if (removedAnchors.length > 0) {
    parts.push(
      `Remove these subjects entirely — they must NOT appear in the image: ${removedAnchors
        .map((a) => a.name)
        .join(", ")}.`,
    );
  }

  // Text is always handled by the app as a separate editable overlay — never
  // baked into the artwork.
  parts.push("Do NOT render any text, letters, captions, words, or numbers in the image.");
  if (spread.layoutNote.trim()) {
    parts.push(
      `Leave clean, uncluttered negative space for a separate text block: ${spread.layoutNote.trim()}.`,
    );
  } else {
    parts.push("Leave some clean negative space where a text block can be placed.");
  }

  parts.push(`Art style: ${styleText}.`);
  parts.push("Children's picture-book illustration, cohesive composition, no watermark.");

  if (maskMode && edit?.trim()) {
    parts.push(
      `Inpainting edit: only modify the transparent (masked) region of the LAST reference image — apply this change there: ${edit.trim()}. Keep every pixel outside the mask exactly identical (same characters, colors, lighting, and composition).`,
    );
  } else if (hasCompositionRef) {
    // The composition reference is ALWAYS explained, even when there is no edit,
    // so the model never silently copies outdated subject appearances from it.
    if (edit?.trim()) {
      const refresh =
        refreshAnchors.length > 0
          ? ` Also update these characters/places to match their new reference images above — their design changed since this page was made: ${refreshAnchors
              .map((a) => a.name)
              .join(", ")}.`
          : "";
      parts.push(
        `The LAST image is the CURRENT version of this page. Reproduce it faithfully — keep the exact composition, layout, poses, positions, scale, framing, background, lighting and colors. Apply this change: ${edit.trim()}.${refresh} For any named subject that has its own reference image above, match that subject's appearance to its reference while keeping its position and pose. Do not move, add, or remove anything else.`,
      );
    } else {
      const changed =
        refreshAnchors.length > 0
          ? ` These subjects changed since this page was made and MUST be redrawn to match their NEW reference images above — replace their outdated look entirely: ${refreshAnchors
              .map((a) => a.name)
              .join(", ")}.`
          : "";
      parts.push(
        `The LAST image is the PREVIOUS version of this page. Reproduce it faithfully — keep the exact composition, poses, positions, framing, background and colors. The ONLY allowed change: update each named subject's appearance to match its own labeled reference image above (e.g. an updated character design).${changed} Do NOT copy outdated character or color details from the last image, and do not re-pose, move, add, or remove anything else.`,
      );
    }
  } else if (edit?.trim()) {
    parts.push(`Revision: ${edit.trim()}.`);
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Prompt for a targeted single-subject update: the FIRST image is the current
 * page, the SECOND is the subject's NEW reference. Used with a mask (OpenAI) or
 * full-frame + client compositing (Gemini) so only this subject changes.
 */
export function buildAnchorSwapPrompt(input: {
  anchor: Anchor;
  config: BookConfig;
  /** Whether a mask constrains the change to a region. */
  maskMode: boolean;
}): string {
  const { anchor, config, maskMode } = input;
  const styleText = resolveArtStyleText(config.artStyle);
  const isChar = anchor.type === "character";
  const region = maskMode
    ? "the transparent (masked) region"
    : "only the area currently showing this subject";
  const identity = isChar
    ? "face, hair, skin, colors, outfit and overall design"
    : "shape, proportions, materials, markings, colors and design";
  return [
    "You are updating ONE subject in an existing children's-book illustration.",
    `The FIRST image is the current page. The SECOND image is the NEW reference for "${anchor.name}" (${anchor.description}).`,
    `Redraw ${anchor.name} inside ${region} so it matches the NEW reference exactly — ${identity}. Keep its existing position, pose, scale and camera angle from the current page; only its appearance changes.`,
    "Keep EVERYTHING else pixel-identical: the background, any other characters, lighting, colors, composition and framing. Do not move, add, remove, recolor or restyle anything else.",
    "Do NOT render any text, letters, captions, words, numbers or watermark.",
    `Art style: ${styleText}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function generateIllustrationImage(input: {
  prompt: string;
  size: string;
  creds: ProviderCredentials;
  model: string;
  providerId: Parameters<typeof getImageProvider>[0];
  references?: ReferenceImage[];
  mask?: ReferenceImage;
  quality?: "low" | "medium" | "high" | "auto";
  signal?: AbortSignal;
}): Promise<ImageResult> {
  const { prompt, size, creds, model, providerId, references, mask, quality, signal } = input;
  const provider = getImageProvider(providerId);
  return withRetry(
    () =>
      provider.generateImage(creds, {
        model,
        prompt,
        size,
        references,
        mask,
        quality,
        signal,
      }),
    { signal },
  );
}
