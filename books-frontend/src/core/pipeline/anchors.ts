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
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderSinglePrompt } from "../prompts/render";
import type { Anchor, ArtStyleSelection } from "../types";
import { withRetry } from "./retry";

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
  /**
   * Optional resolved statement per related anchor id — a full, side-independent
   * sentence naming both parties (e.g. "Dad has lighter hair than Mom") so the
   * model knows exactly how the resemblance/connection works from THIS anchor's
   * point of view, without having to invert the phrasing.
   */
  relatedNotes?: Record<string, string>;
  /**
   * Anchors the EDIT TEXT refers to ("make him the same age as Amanda"),
   * detected by the mention resolver — no user tagging required. Injected as
   * text context so the model can interpret the request; never drawn.
   */
  mentionedAnchors?: Anchor[];
  /** Optional extra instruction for an iteration (e.g. "make her smile"). */
  edit?: string;
  /**
   * True when the anchor's own current image is supplied as the edit base (so
   * we frame the prompt as a minimal edit of that image rather than rebuilding
   * the description from scratch — which would re-assert removed features).
   */
  editFromImage?: boolean;
  /**
   * Whether an art-style exemplar is passed as the FIRST reference image (match
   * its rendering style only, never its subjects/layout). Not used for
   * edit-from-image, which preserves the existing sheet's style.
   */
  hasStyleRef?: boolean;
  /**
   * Ordered legend of the attached reference images, e.g.
   * `(1) an art-style reference…, (2) Hospital bed (must match…)`. Lets models
   * without per-image labels (OpenAI) bind each image to its purpose.
   */
  legend?: string;
  /** Admin prompt overlays (art-style descriptions). */
  prompts?: PromptContext;
}

/** Build the base prompt for an anchor reference sheet. */
export function buildAnchorPrompt(input: BuildAnchorPromptInput): string {
  const {
    anchor,
    artStyle,
    containedAnchors = [],
    relatedAnchors = [],
    relatedNotes,
    mentionedAnchors = [],
    edit,
    editFromImage = false,
    hasStyleRef = false,
    legend,
    prompts,
  } = input;
  const config = resolvePromptsConfig(prompts);
  const isEdit = Boolean(edit?.trim());
  const listOf = (arr: Anchor[]) => arr.map((r) => `${r.name} (${r.description})`).join("; ");
  // Related anchors additionally carry the resolved statement on HOW they
  // relate (a full sentence naming both, e.g. "Dad has lighter hair than Mom")
  // right alongside the description, so the model doesn't have to invent what
  // the resemblance means.
  const listRelated = (arr: Anchor[]) =>
    arr
      .map((r) => {
        const note = relatedNotes?.[r.id]?.trim();
        return `${r.name} (${r.description}${note ? `; ${note}` : ""})`;
      })
      .join("; ");

  // Edit-from-image: keep the current image as the source of truth and apply
  // ONLY the requested change. We deliberately omit the full description and
  // style text (both are already baked into the provided image) so they can't
  // reintroduce features the user just removed. Mentioned anchors ARE included
  // (as text) — the change itself may depend on them ("same age as Amanda").
  if (isEdit && editFromImage) {
    const identity =
      anchor.type === "character"
        ? "the same character — identical face, hair, body, colors and outfit"
        : "the same item — identical shapes, proportions, materials, markings and colors";
    return renderSinglePrompt(config, "anchorImage/editFromImage", {
      vars: {
        anchorName: anchor.name,
        edit: edit!.trim(),
        identity,
        mentionedList: listOf(mentionedAnchors),
      },
      flags: { hasMentioned: mentionedAnchors.length > 0 },
    });
  }

  const styleText = resolveArtStyleText(artStyle, prompts);
  // A character can't physically "contain" another anchor. Contained subjects
  // are drawn; related subjects are context only (links are user-declared).
  const contained = anchor.type === "character" ? [] : containedAnchors;
  // Mentioned anchors already covered by an explicit relation would be
  // duplicated context — only inject the untagged ones.
  const covered = new Set([...contained, ...relatedAnchors].map((a) => a.id));
  const mentioned = mentionedAnchors.filter((a) => !covered.has(a.id));

  return renderSinglePrompt(config, "anchorImage/default", {
    vars: {
      anchorName: anchor.name,
      anchorType: anchor.type,
      description: anchor.description.trim(),
      userGuidance: anchor.userGuidance?.trim() ?? "",
      containedList: listOf(contained),
      relatedList: listRelated(relatedAnchors),
      mentionedList: listOf(mentioned),
      artStyle: styleText,
      edit: edit?.trim() ?? "",
      legend: legend ?? "",
    },
    flags: {
      isCharacter: anchor.type === "character",
      isPlace: anchor.type === "place",
      isObject: anchor.type === "object",
      hasUserGuidance: Boolean(anchor.userGuidance?.trim()),
      hasContained: contained.length > 0,
      hasRelated: relatedAnchors.length > 0,
      hasMentioned: mentioned.length > 0,
      hasStyleRef,
      hasEdit: isEdit,
      hasLegend: Boolean(legend?.trim()),
    },
  });
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
  // One retry only — see generateIllustrationImage for the rationale.
  return withRetry(
    () =>
      provider.generateImage(creds, {
        model,
        prompt,
        size: "1024x1024",
        references,
        signal,
      }),
    { retries: 1, signal },
  );
}
