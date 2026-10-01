/**
 * How many reference images a render will send, known before it runs.
 *
 * The count moves the price (every input image is billed), so a quote prices
 * from renders that sent about as many (`priceEstimation`, reference groups).
 * The browser plans it for the button, and the server plans it again from the
 * book it receives before charging, with the same functions.
 *
 * These mirror what the renderers send (`guide/portrait`, `pipeline/anchorRun`,
 * `pipeline/illustrationRun`) on their main path. A render that ends up sending
 * a different number still records its real count, so the next price learns.
 */
import type { Anchor, Project } from "../types";
import type { ImageModelCapabilities } from "../config/modelCapabilities";
import type { ActionGenerationTuning } from "../config/generationTuning";
import { briefOf } from "../story/brief";
import { portraitReferenceCount } from "../guide/portrait";
import { containedAnchorsFor } from "../book/anchorGraph";
import { effectiveAnchorIds } from "../book/anchorRefs";
import { heightFractions } from "../book/anchorScale";
import { spreadsById } from "../book/units";
import { anchorSignature, currentAnchorImage } from "../pipeline/provenance";

export interface ReferenceLimits {
  /** The model's own ceiling. */
  maxReferenceImages: number;
  /** The action's tuning (`references.maxImages`). */
  maxImages: number;
  /** Whether the model takes reference images at all on the edit endpoint. */
  referenceEditing: boolean;
}

export function referenceLimitsFor(
  caps: Pick<ImageModelCapabilities, "inputs" | "operations">,
  tuning: Pick<ActionGenerationTuning, "references">,
): ReferenceLimits {
  return {
    maxReferenceImages: caps.inputs.maxReferenceImages,
    maxImages: tuning.references.maxImages,
    referenceEditing: caps.operations.referenceEditing,
  };
}

/**
 * The part of a planned count the render may actually send. A required image
 * (an edit's base, a photo, a reader's drawing) survives `maxImages = 0`.
 */
export function cappedReferenceCount(
  planned: number,
  limits: ReferenceLimits,
  options: { required?: boolean; needsEditing?: boolean } = {},
): number {
  if (planned <= 0) return 0;
  if (options.needsEditing && !limits.referenceEditing) return 0;
  const limit = Math.min(limits.maxReferenceImages, Math.max(limits.maxImages, options.required ? 1 : 0));
  return Math.max(0, Math.min(planned, limit));
}

/**
 * One portrait: photos, the person's drawing, the book's style reference. A
 * change to a drawn portrait sends only that portrait.
 */
export function plannedPortraitReferences(
  project: Project,
  castId: string,
  limits: ReferenceLimits,
  options: { edit?: boolean } = {},
): number {
  const member = (briefOf(project.config).cast ?? []).find((m) => m.id === castId);
  if (!member) return 0;
  if (options.edit) return cappedReferenceCount(1, limits, { required: true, needsEditing: true });
  const planned = portraitReferenceCount(project, member);
  return cappedReferenceCount(planned, limits, { required: planned > 0 });
}

export interface AnchorPlanOptions {
  edit?: string;
  useReference?: boolean;
  restyle?: boolean;
  fromNodeId?: string;
  /**
   * Whether a photo waits for this sheet. The server passes what its private
   * photo lane holds, since the book it receives carries no photo receipts.
   */
  hasPhoto?: boolean;
}

/**
 * One reference sheet: its own last sheet (edit, restyle, variation), a photo
 * or the reader's drawings on a first draw, and the sheets of what it contains.
 */
export function plannedAnchorReferences(
  project: Project,
  anchorId: string,
  options: AnchorPlanOptions,
  limits: ReferenceLimits,
): number {
  const all = project.anchors ?? [];
  const anchor = all.find((a) => a.id === anchorId);
  if (!anchor) return 0;
  const isIteration = Boolean(anchor.versions);
  const restyle = Boolean(options.restyle);
  const isEdit = !restyle && Boolean(options.edit?.trim());
  const sourceNodeId = options.fromNodeId ?? anchor.versions?.cursorId;
  const base = (options.useReference || restyle) && anchor.versions && sourceNodeId && anchor.versions.nodes[sourceNodeId] ? 1 : 0;
  if (restyle) return cappedReferenceCount(base, limits, { required: true, needsEditing: true });
  const character = anchor.type === "character";
  const likeness = character && !isIteration && (options.hasPhoto ?? Boolean(anchor.likenessPhoto)) ? 1 : 0;
  const fromScratch = !isEdit && !(isIteration && options.useReference);
  const drawings = character && fromScratch ? (anchor.sourceArt ?? []).length : 0;
  const contained = containedAnchorsFor(anchor, all).length;
  const planned = base + likeness + drawings + contained;
  return cappedReferenceCount(planned, limits, {
    required: base + likeness + drawings > 0,
    needsEditing: true,
  });
}

export interface IllustrationPlanOptions {
  edit?: string;
  useReference?: boolean;
  restyle?: boolean;
  fromNodeId?: string;
  /** A manual inpainting mask: only the page itself is sent. */
  masked?: boolean;
  /** A back cover drawn on from the front's edge: only the front is sent. */
  continuation?: boolean;
  /** Sheets this run draws before the page, counted as if already there. */
  sheetsComing?: ReadonlySet<string>;
}

/**
 * One page or cover: the sheets of who and what is on it, a size chart when
 * characters of different heights meet, and the page itself on a redraw.
 */
export function plannedIllustrationReferences(
  project: Project,
  spreadId: string,
  options: IllustrationPlanOptions,
  limits: ReferenceLimits,
): number {
  if (options.continuation) return cappedReferenceCount(1, limits, { required: true });
  const spread = spreadsById(project).get(spreadId);
  if (!spread || spread.placeholder || spread.blankCanvas || spread.completion === "text" || spread.completion === "blank") {
    return 0;
  }
  const tree = project.illustrations?.[spread.id];
  const sourceNodeId = options.fromNodeId ?? tree?.cursorId;
  const hasPage = Boolean(tree && sourceNodeId && tree.nodes[sourceNodeId]);
  if (options.masked) return cappedReferenceCount(hasPage ? 1 : 0, limits, { required: true, needsEditing: true });

  const restyle = Boolean(options.restyle);
  const composition = (options.useReference || restyle) && hasPage ? 1 : 0;
  const byId = new Map((project.anchors ?? []).map((a) => [a.id, a]));
  const anchors = effectiveAnchorIds(project.anchors, spread)
    .map((id) => byId.get(id))
    .filter((a): a is Anchor => Boolean(a));
  const drawn = (a: Anchor) => Boolean(currentAnchorImage(a)) || Boolean(options.sheetsComing?.has(a.id));
  const previous = composition && sourceNodeId ? tree!.nodes[sourceNodeId]!.content.references ?? [] : [];
  const prevById = new Map(previous.map((r) => [r.anchorId, r]));
  const edit = options.edit?.trim().toLowerCase() ?? "";
  const needsSheet = (a: Anchor): boolean => {
    if (!composition || restyle) return true;
    const prev = prevById.get(a.id);
    if (!prev) return true;
    if ((a.versions?.cursorId ?? undefined) !== prev.versionId) return true;
    if (prev.signature !== undefined && prev.signature !== anchorSignature(a)) return true;
    return Boolean(edit) && edit.includes(a.name.toLowerCase());
  };
  const sheets = anchors.filter((a) => drawn(a) && needsSheet(a)).length;

  if (!limits.referenceEditing) return 0;
  const slots = Math.min(limits.maxReferenceImages, Math.max(limits.maxImages, composition));
  const subjectSlots = Math.max(0, slots - composition);
  const sent = Math.min(sheets, subjectSlots);
  const scale = heightFractions(anchors).size >= 2 && sent >= 2 && sent < subjectSlots ? 1 : 0;
  return sent + scale + (slots > 0 ? composition : 0);
}
