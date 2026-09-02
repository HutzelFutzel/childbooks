/**
 * Illustration generation: builds a per-page image prompt from the screenplay
 * spread + book settings, picks a fitting canvas size, and renders the image
 * using the chosen anchors as reference images for visual consistency.
 */
import { bookProductForConfig } from "../book";
import { getImageProvider } from "../providers";
import type { ProviderId } from "../config/options";
import type {
  ImageResult,
  ProviderCredentials,
  ReferenceImage,
} from "../providers/types";
import { resolveArtStyleText } from "../prompts/style";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderSinglePrompt } from "../prompts/render";
import type { Anchor, BookConfig, ScreenplaySpread } from "../types";
import { layoutPromptFacts, type LayoutPlan } from "../book/layouts";
import { relativeHeightsText } from "../book/anchorScale";
import { withRetry } from "./retry";

/** Canvas sizes the OpenAI image endpoint accepts, with their aspect ratios. */
const OPENAI_SIZES: [string, number][] = [
  ["1024x1536", 1024 / 1536],
  ["1024x1024", 1],
  ["1536x1024", 1536 / 1024],
];

function nearestSize(options: [string, number][], target: number): string {
  let best = options[0];
  for (const opt of options) {
    if (Math.abs(opt[1] - target) < Math.abs(best[1] - target)) best = opt;
  }
  return best[0];
}

/** A "WxH" whose ratio is exactly `aspect` (Gemini reads the ratio, not the px). */
function exactRatioSize(aspect: number): string {
  const base = 1024;
  return aspect >= 1
    ? `${Math.round(base * aspect)}x${base}`
    : `${base}x${Math.round(base / aspect)}`;
}

/**
 * The aspect the generated artwork should have: the page surface for full-bleed
 * art, or the art rectangle's own shape when the layout places art beside the
 * text. Derived from the plan rather than hardcoded per page shape, so a new
 * layout gets correctly-shaped art with no change here.
 */
export function renderAspect(
  kind: ScreenplaySpread["kind"],
  config: Pick<BookConfig, "bookSize" | "productSku">,
  plan?: LayoutPlan | null,
): number {
  const pageAspect = bookProductForConfig(config).aspect;
  const surface = kind === "spread" ? pageAspect * 2 : pageAspect;
  if (plan?.mode === "inset-art") {
    return (plan.artRect.w * surface) / plan.artRect.h;
  }
  return surface;
}

/**
 * Choose a provider-friendly canvas size for a page/spread.
 *
 * OpenAI accepts three fixed sizes, so the target is snapped to the nearest.
 * Gemini reads only an aspect ratio and snaps to its own finer set of nine, so
 * it is handed the true ratio instead of one pre-rounded to a page shape — which
 * means the fast model can actually fit an unusual art rectangle more closely
 * than the premium one.
 */
export function chooseImageSize(
  kind: ScreenplaySpread["kind"],
  config: Pick<BookConfig, "bookSize" | "productSku">,
  plan?: LayoutPlan | null,
  provider?: ProviderId,
): string {
  const target = renderAspect(kind, config, plan);
  if (provider === "google") return exactRatioSize(target);
  return nearestSize(OPENAI_SIZES, target);
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
   * Subjects newly toggled onto this page since the previous version — on a
   * composition-preserving regeneration they must be ADDED to the scene.
   */
  addedAnchors?: Anchor[];
  /**
   * Subjects that are UNCHANGED since the previous version — already correct in
   * the composition reference, so their sheets are NOT re-sent. The prompt
   * locks them in place instead ("keep exactly as drawn").
   */
  keptAnchors?: Anchor[];
  /**
   * Parent→child containment pairs active on this page (e.g. a specific bed
   * inside a room), so the model draws the child once, inside its parent,
   * matching the child's own reference.
   */
  embeddedPairs?: { parent: Anchor; child: Anchor }[];
  /**
   * Whether an art-style exemplar is passed as the FIRST reference image (its
   * rendering style should be matched, but never its subjects/composition).
   */
  hasStyleRef?: boolean;
  /** A relative-size chart was prepended to the references. */
  hasScaleChart?: boolean;
  /**
   * Whether the current page illustration is appended as the FINAL reference
   * image (used for edits, to preserve composition).
   */
  hasCompositionRef?: boolean;
  /** Whether an inpainting mask is supplied (restrict change to masked area). */
  maskMode?: boolean;
  /**
   * Art-style transfer: re-render the page's existing artwork in the book's new
   * style, keeping the scene identical. Selects a dedicated template — the
   * normal refresh tail explicitly forbids restyling, which is exactly wrong
   * here.
   */
  restyle?: boolean;
  /**
   * Cover-only: render the title/subtitle/author typography INTO the artwork
   * (typographic cover) instead of reserving clean space for overlay text.
   */
  bakeText?: boolean;
  /** Title text to bake into the cover art (when `bakeText`). */
  coverTitle?: string;
  /** Subtitle text to bake into the cover art (optional). */
  coverSubtitle?: string;
  /** Author line to bake into the cover art (optional). */
  coverAuthor?: string;
  /**
   * Whether this render is a front/back cover — adds a strong "no barcode / QR /
   * logo / badge" negative (image models tend to invent one on covers, and it's
   * not allowed on the printed cover). Applies in both plain and baked modes.
   */
  isCover?: boolean;
  /** Optional revision instruction for an iteration. */
  edit?: string;
  /** Admin prompt overlays (art-style descriptions). */
  prompts?: PromptContext;
  /**
   * The active layout's resolved plan for this page. Everything the prompt says
   * about where text sits is compiled from its geometry, so the instruction can
   * never drift from the rectangle the editor actually uses. Undefined (e.g.
   * covers) skips the layout guidance.
   */
  layoutPlan?: LayoutPlan | null;
}

export function buildIllustrationPrompt(input: BuildIllustrationPromptInput): string {
  const {
    spread,
    config,
    referencedAnchors,
    describedAnchors = [],
    removedAnchors = [],
    refreshAnchors = [],
    addedAnchors = [],
    keptAnchors = [],
    embeddedPairs = [],
    hasStyleRef = false,
    hasScaleChart = false,
    hasCompositionRef = false,
    maskMode = false,
    restyle = false,
    bakeText = false,
    coverTitle,
    coverSubtitle,
    coverAuthor,
    isCover = false,
    edit,
    prompts,
    layoutPlan,
  } = input;
  const styleText = resolveArtStyleText(config.artStyle, prompts);

  if (restyle) {
    const restyleLegend = [
      ...(hasStyleRef ? ["an art-style reference (match its style only, not its content)"] : []),
      ...referencedAnchors.map((a) => a.name),
      "the page being re-rendered",
    ]
      .map((name, i) => `(${i + 1}) ${name}`)
      .join(", ");
    return renderSinglePrompt(resolvePromptsConfig(prompts), "pageIllustration/restyle", {
      vars: {
        charactersList: referencedAnchors
          .map(
            (a) =>
              `${a.name} (${[
                a.ageYears !== undefined ? `${a.ageYears} years old` : "",
                a.description,
              ].filter(Boolean).join("; ")})`,
          )
          .join("; "),
        legend: restyleLegend,
        artStyle: styleText,
      },
      flags: {
        hasStyleRef,
        hasReferenced: referencedAnchors.length > 0,
        bakeText: Boolean(bakeText && (coverTitle ?? "").trim()),
      },
    });
  }

  // Assemble the human-readable typography instruction when baking cover text.
  const bakeParts: string[] = [];
  if (bakeText && (coverTitle ?? "").trim()) {
    bakeParts.push(`the title "${coverTitle!.trim()}"`);
    if ((coverSubtitle ?? "").trim()) bakeParts.push(`the subtitle "${coverSubtitle!.trim()}"`);
    if ((coverAuthor ?? "").trim()) bakeParts.push(`the author line "${coverAuthor!.trim()}"`);
  }
  const bakeTextActive = bakeParts.length > 0;
  const bakeTextInstruction = bakeParts.join(", ");

  // Structural layout facts are COMPILED from the plan's rectangles (see
  // `layoutPromptFacts`) rather than written by hand, so widening a text column
  // rewrites the instruction automatically. Baking cover text replaces the
  // reserve-space instruction entirely, so it suppresses these.
  const facts = layoutPlan ? layoutPromptFacts(layoutPlan, renderAspect(spread.kind, config)) : null;
  const pageNote = spread.layoutNote.trim();
  const listOf = (arr: Anchor[]) =>
    arr
      .map(
        (a) =>
          `${a.name} (${[
            a.ageYears !== undefined ? `${a.ageYears} years old` : "",
            a.description,
          ].filter(Boolean).join("; ")})`,
      )
      .join("; ");

  const characters = referencedAnchors.filter((a) => a.type === "character");
  const settings = referencedAnchors.filter((a) => a.type !== "character");

  // Everyone on the page, whether they arrive as a reference sheet, a kept
  // subject or a description — they all get drawn, so they all need to be the
  // right size relative to each other.
  const heightsList = relativeHeightsText([
    ...referencedAnchors,
    ...keptAnchors,
    ...describedAnchors,
  ]);

  // Reference-image legend: the provider receives images in a fixed order (an
  // optional art-style exemplar first, then each named subject, then the page
  // image). Spelling out that order lets the model bind each reference to the
  // right subject. MUST mirror the order references are assembled in
  // `renderIllustration`.
  const legendNames: string[] = [];
  if (hasStyleRef) legendNames.push("an art-style reference (match its style only, not its content)");
  if (hasScaleChart) {
    legendNames.push(
      "a size chart showing the characters side by side on one ground line at their correct relative heights (copy those proportions; ignore its poses, spacing and blank background)",
    );
  }
  legendNames.push(...referencedAnchors.map((a) => a.name));
  if (hasCompositionRef) {
    legendNames.push(maskMode ? "the page being edited" : "the current page of this book");
  }
  const legend = legendNames.map((name, i) => `(${i + 1}) ${name}`).join(", ");

  // Kept subjects stay part of the allowed cast even though no sheet is sent.
  const castNames = [...referencedAnchors, ...keptAnchors, ...describedAnchors].map((a) => a.name);

  // Tail-branch selection mirrors the original if/else-if chain exactly.
  const hasEdit = Boolean(edit?.trim());
  const tailMaskEdit = maskMode && hasEdit;
  const tailCompositionEdit = !tailMaskEdit && hasCompositionRef && hasEdit;
  const tailCompositionRefresh = !tailMaskEdit && hasCompositionRef && !hasEdit;
  const tailPlainEdit = !tailMaskEdit && !hasCompositionRef && hasEdit;

  const refreshNames = refreshAnchors.map((a) => a.name).join(", ");
  const refreshClause =
    refreshAnchors.length > 0
      ? ` Also update these characters/places to match their new reference images above — their design changed since this page was made: ${refreshNames}.`
      : "";
  const changedClause =
    refreshAnchors.length > 0
      ? ` These subjects changed since this page was made and MUST be redrawn to match their NEW reference images above — replace their outdated look entirely: ${refreshNames}.`
      : "";
  const addedClause =
    addedAnchors.length > 0
      ? ` Additionally, ADD these subjects to the scene, matching their reference images above: ${addedAnchors.map((a) => a.name).join(", ")}.`
      : "";
  const embeddedList = embeddedPairs
    .map((p) => `${p.child.name} appears INSIDE ${p.parent.name}`)
    .join("; ");
  const keptList = keptAnchors.map((a) => a.name).join(", ");

  return renderSinglePrompt(resolvePromptsConfig(prompts), "pageIllustration/default", {
    vars: {
      illustrationBrief: spread.illustration.trim(),
      charactersList: listOf(characters),
      settingsList: listOf(settings),
      heightsList,
      describedList: listOf(describedAnchors),
      embeddedList,
      legend,
      castNames: castNames.join(", "),
      removedList: removedAnchors.map((a) => a.name).join(", "),
      layoutNote: pageNote,
      calmRegions: facts?.calmRegions ?? "",
      focalRegion: facts?.focalRegion ?? "",
      regionTreatment: facts?.treatmentInstruction ?? "",
      artAspect: facts?.artAspectLabel ?? "",
      artStyle: styleText,
      bakeTextInstruction,
      edit: edit?.trim() ?? "",
      refreshClause,
      changedClause,
      addedClause,
      keptList,
    },
    flags: {
      isSpread: spread.kind === "spread",
      hasStyleRef,
      hasCharacters: characters.length > 0,
      hasSettings: settings.length > 0,
      hasHeights: Boolean(heightsList),
      hasDescribed: describedAnchors.length > 0,
      hasEmbedded: embeddedPairs.length > 0,
      hasReferenced: referencedAnchors.length > 0,
      hasCast: castNames.length > 0,
      hasRemoved: removedAnchors.length > 0,
      hasKept: keptAnchors.length > 0,
      // When baking cover text, suppress the "leave clean negative space" +
      // "no text" clauses and instead instruct the model to render typography.
      hasLayoutNote: Boolean(pageNote) && !bakeTextActive,
      layoutGeneric: !facts && !pageNote && !bakeTextActive,
      // Keep a calm band for overlay text (full-bleed art), or compose the art
      // to fill its own frame (inset art) — never both.
      layoutCalmBand: Boolean(facts?.hasCalmBand) && !bakeTextActive,
      hasRegionTreatment: Boolean(facts?.treatmentInstruction) && !bakeTextActive,
      layoutInsetArt: Boolean(facts?.isInsetArt) && !bakeTextActive,
      bakeText: bakeTextActive,
      isCover,
      tailMaskEdit,
      tailCompositionEdit,
      tailCompositionRefresh,
      tailPlainEdit,
    },
  });
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
  prompts?: PromptContext;
}): string {
  const { anchor, config, maskMode, prompts } = input;
  const styleText = resolveArtStyleText(config.artStyle, prompts);
  const isChar = anchor.type === "character";
  const region = maskMode
    ? "the transparent (masked) region"
    : "only the area currently showing this subject";
  const identity = isChar
    ? "face, hair, skin, colors, outfit and overall design"
    : "shape, proportions, materials, markings, colors and design";
  return renderSinglePrompt(resolvePromptsConfig(prompts), "pageIllustration/anchorSwap", {
    vars: {
      anchorName: anchor.name,
      description: anchor.description,
      region,
      identity,
      artStyle: styleText,
    },
  });
}

/**
 * Prompt for a targeted attribute modification of one subject ("make Arthur's
 * hair blue"): the FIRST image is the current page; the SECOND (optional) is
 * the subject's reference sheet for identity. Used with a mask so only the
 * subject's region changes.
 */
export function buildModifySubjectPrompt(input: {
  anchor: Anchor;
  instruction: string;
  config: BookConfig;
  /** Whether a mask constrains the change to a region. */
  maskMode: boolean;
  /** Whether the subject's reference sheet is attached as the second image. */
  hasSheetRef: boolean;
  prompts?: PromptContext;
}): string {
  const { anchor, instruction, config, maskMode, hasSheetRef, prompts } = input;
  const styleText = resolveArtStyleText(config.artStyle, prompts);
  const region = maskMode
    ? "the transparent (masked) region"
    : "only the area currently showing this subject";
  return renderSinglePrompt(resolvePromptsConfig(prompts), "pageIllustration/modifySubject", {
    vars: {
      anchorName: anchor.name,
      description: anchor.description,
      region,
      instruction,
      artStyle: styleText,
    },
    flags: { hasSheetRef },
  });
}

/**
 * Prompt for removing a DUPLICATE subject occurrence in place: the region (a
 * mask on OpenAI, or "the area showing the duplicate" on Gemini) is erased and
 * filled with matching background, leaving exactly one instance of the subject.
 */
export function buildRemoveRegionPrompt(input: {
  subjectName: string;
  config: BookConfig;
  maskMode: boolean;
  prompts?: PromptContext;
}): string {
  const { subjectName, config, maskMode, prompts } = input;
  const styleText = resolveArtStyleText(config.artStyle, prompts);
  const region = maskMode
    ? "the transparent (masked) region"
    : "the area currently showing the duplicate";
  return renderSinglePrompt(resolvePromptsConfig(prompts), "pageIllustration/removeRegion", {
    vars: { subjectName, region, artStyle: styleText },
  });
}

/**
 * Prompt for the back-cover-continuation outpaint (see `renderCoverContinuation`
 * in `illustrationRun.ts`). The ONLY reference image is a seed canvas that
 * already contains a strip of the FRONT cover's real edge pixels, pasted flush
 * against the seam side of an otherwise-blank canvas, with a mask protecting
 * that strip. This asks the model to extend it into the rest of the (masked)
 * frame as one continuous scene.
 */
export function buildCoverContinuationPrompt(input: {
  config: BookConfig;
  prompts?: PromptContext;
}): string {
  const { config, prompts } = input;
  const styleText = resolveArtStyleText(config.artStyle, prompts);
  return renderSinglePrompt(resolvePromptsConfig(prompts), "pageIllustration/coverContinuation", {
    vars: { artStyle: styleText },
  });
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
  /** Cover typography is being rendered into the art — keep text allowed. */
  allowText?: boolean;
  signal?: AbortSignal;
}): Promise<ImageResult> {
  const { prompt, size, creds, model, providerId, references, mask, quality, allowText, signal } =
    input;
  const provider = getImageProvider(providerId);
  // Image calls are the slow, user-visible ones: one retry only, so a stalled
  // provider fails the render in bounded time instead of silently burning
  // minutes across 4 attempts. Text/vision calls keep the default 3 retries.
  return withRetry(
    () =>
      provider.generateImage(creds, {
        model,
        prompt,
        size,
        references,
        mask,
        quality,
        allowText,
        signal,
      }),
    { retries: 1, signal },
  );
}
