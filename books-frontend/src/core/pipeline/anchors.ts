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
import type { Anchor, AnchorSheetLayout, ArtStyleSelection } from "../types";
import {
  ANCHOR_SHEET_SIZE,
  gridShapeText,
  sheetSpecFor,
  viewListText,
} from "./anchorLayout";
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
   * Art-style transfer: re-render the existing sheet in the book's new style,
   * keeping identity, grid and poses byte-for-byte identical in intent. Uses a
   * dedicated template — the edit template preserves the old style, and the
   * default one rebuilds the sheet from the description (losing the design).
   */
  restyle?: boolean;
  /**
   * Grid recorded on the sheet being restyled. Preferred over this anchor
   * type's current spec, which may describe a different grid than the base
   * image actually has.
   */
  baseLayout?: AnchorSheetLayout;
  /**
   * Ordered legend of the attached reference images, e.g.
   * `(1) an art-style reference…, (2) Hospital bed (must match…)`. Lets models
   * without per-image labels (OpenAI) bind each image to its purpose.
   */
  legend?: string;
  /**
   * Set on a repair retry: how many panels the PREVIOUS attempt actually drew
   * (per {@link countSheetPanels}), when it didn't match the requested grid.
   * Naming the actual miss is far more corrective than repeating the same
   * instruction verbatim a second time.
   */
  actualPanelCount?: number;
  /** Admin prompt overlays (art-style descriptions). */
  prompts?: PromptContext;
}

/** Build the base prompt for an anchor reference sheet. */
export function buildAnchorPrompt(input: BuildAnchorPromptInput): string {
  const {
    anchor,
    artStyle,
    containedAnchors = [],
    mentionedAnchors = [],
    edit,
    editFromImage = false,
    hasStyleRef = false,
    restyle = false,
    baseLayout,
    legend,
    actualPanelCount,
    prompts,
  } = input;
  const config = resolvePromptsConfig(prompts);
  const isEdit = Boolean(edit?.trim());

  if (restyle) {
    const spec = sheetSpecFor(anchor);
    const columns = baseLayout?.columns ?? spec.columns;
    const rows = baseLayout?.rows ?? spec.rows;
    return renderSinglePrompt(config, "anchorImage/restyle", {
      vars: {
        anchorName: anchor.name,
        cellCount: String(columns * rows),
        gridShape: gridShapeText({ ...spec, columns, rows }),
        artStyle: resolveArtStyleText(artStyle, prompts),
      },
      flags: { hasStyleRef },
    });
  }
  const listOf = (arr: Anchor[]) => arr.map((r) => `${r.name} (${r.description})`).join("; ");
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
  // Mentioned anchors already embedded in this sheet would be duplicate context.
  const covered = new Set(contained.map((a) => a.id));
  const mentioned = mentionedAnchors.filter((a) => !covered.has(a.id));
  const spec = sheetSpecFor(anchor);

  return renderSinglePrompt(config, "anchorImage/default", {
    vars: {
      anchorName: anchor.name,
      anchorType: anchor.type,
      cellCount: String(spec.views.length),
      gridShape: gridShapeText(spec),
      viewList: viewListText(spec),
      description: anchor.description.trim(),
      age: anchor.ageYears !== undefined ? `${anchor.ageYears} years old` : "",
      userGuidance: anchor.userGuidance?.trim() ?? "",
      containedList: listOf(contained),
      mentionedList: listOf(mentioned),
      artStyle: styleText,
      edit: edit?.trim() ?? "",
      legend: legend ?? "",
      actualPanelCount: String(actualPanelCount ?? ""),
    },
    flags: {
      isCharacter: anchor.type === "character",
      isPlace: anchor.type === "place",
      isObject: anchor.type === "object",
      hasUserGuidance: Boolean(anchor.userGuidance?.trim()),
      hasAge: anchor.type === "character" && anchor.ageYears !== undefined,
      hasContained: contained.length > 0,
      hasMentioned: mentioned.length > 0,
      hasStyleRef,
      hasEdit: isEdit,
      hasLegend: Boolean(legend?.trim()),
      hasGridRepair: typeof actualPanelCount === "number",
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
  /**
   * Canvas for the sheet, from the layout spec. A six-cell grid on a square
   * canvas leaves each figure too few pixels for the one job the sheet has, so
   * the canvas follows the grid rather than being fixed at 1024x1024.
   */
  size?: string;
}

/** Generate one anchor image with retry. */
export async function generateAnchorImage(
  input: GenerateAnchorImageInput,
): Promise<ImageResult> {
  const { prompt, creds, model, references, signal, providerId, size } = input;
  const provider = getImageProvider(providerId);
  // One retry only — see generateIllustrationImage for the rationale.
  return withRetry(
    () =>
      provider.generateImage(creds, {
        model,
        prompt,
        size: size ?? ANCHOR_SHEET_SIZE,
        references,
        signal,
      }),
    { retries: 1, signal },
  );
}
