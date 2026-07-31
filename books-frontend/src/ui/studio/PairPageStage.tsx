/**
 * Two facing single pages, sharing ONE interactive Konva canvas instead of two
 * independent stages — so an element can be dragged straight across the fold
 * (e.g. page 4 → page 5 on the same sheet) instead of stopping dead at the
 * page edge. Used by `BookCanvas.tsx`'s live editor for any "pair" display
 * spread whose both sides are ordinary content pages (see `isPlainPagePair`);
 * covers and blank fillers keep the simpler independent-stage `HalfFrame`.
 *
 * Approach: flatten both pages' elements into one *virtual* combined
 * `PageDesign` (each page's normalized rect halved into its own half of the
 * surface) and feed that into the unmodified element-rendering half of
 * `PageStage`; only the background/illustration paint (which can't be
 * flattened, since each side has its own art) uses `PageStage`'s
 * `rightSurface` prop to draw two independent halves. Every element callback
 * is routed back to whichever real page currently owns that id — and, when a
 * drag/resize moves an element's center across the x=0.5 fold, ownership is
 * reassigned (`moveElementToPage`) and its rect is re-expressed in the new
 * owner's own normalized space.
 */
import { useMemo } from "react";
import type { NormRect, PageDesign } from "../../core/types";
import { wordParagraphs } from "../../core/design";
import { formatCapabilitiesForProject } from "../../core/book";
import { computePageGuides } from "../../core/book/format";
import { getCursor } from "../../core/versioning";
import { defaultIllustrationFocus } from "../design/designInit";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useJobsStore } from "../../state/jobsStore";
import { PageStage, type ElementKind as StageElementKind, type GeomPatch } from "../design/PageStage";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import type { SpanRef } from "../design/TextBoxView";
import { useStudio } from "./StudioContext";
import { pairDropId } from "./StudioDnd";
import { isBlankEntry, type Entry } from "./spreadModel";

type ModelKind = "box" | "shape" | "image";

function toModelKind(kind: StageElementKind): ModelKind {
  return kind === "text" ? "box" : kind;
}

/** Map a page-local (0..1) rect into its half of the combined double-wide surface. */
function toCombinedRect(rect: NormRect, isRight: boolean): NormRect {
  return { x: (isRight ? 0.5 : 0) + rect.x / 2, y: rect.y, w: rect.w / 2, h: rect.h };
}

/** Inverse of {@link toCombinedRect} — combined-space rect back to page-local. */
function fromCombinedRect(rect: NormRect, isRight: boolean): NormRect {
  return { x: (rect.x - (isRight ? 0.5 : 0)) * 2, y: rect.y, w: rect.w * 2, h: rect.h };
}

function mapElements<T extends { rect: NormRect }>(list: T[], isRight: boolean): T[] {
  return list.map((el) => ({ ...el, rect: toCombinedRect(el.rect, isRight) }));
}

export function PairPageStagePanel({ left, right }: { left: Entry; right: Entry }) {
  const {
    project,
    selection,
    select,
    pageDesign,
    patchBox,
    patchShape,
    patchImage,
    makeIllustrationEditable,
    moveElementToPage,
    snap,
    grid,
    guides,
    generatingPages,
  } = useStudio();

  const leftPd = pageDesign(left.page.id);
  const rightPd = pageDesign(right.page.id);
  const leftBlank = isBlankEntry(left);
  const rightBlank = isBlankEntry(right);

  const merged: PageDesign = useMemo(
    () => ({
      // The left page's background paints as the stage's "primary" surface;
      // the right page's own background comes through `rightSurface` below.
      background: leftPd.background,
      textBoxes: [...mapElements(leftPd.textBoxes, false), ...mapElements(rightPd.textBoxes, true)],
      shapes: [...mapElements(leftPd.shapes ?? [], false), ...mapElements(rightPd.shapes ?? [], true)],
      images: [...mapElements(leftPd.images ?? [], false), ...mapElements(rightPd.images ?? [], true)],
    }),
    [leftPd, rightPd],
  );

  const elementOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of leftPd.textBoxes) map.set(b.id, left.page.id);
    for (const s of leftPd.shapes ?? []) map.set(s.id, left.page.id);
    for (const im of leftPd.images ?? []) map.set(im.id, left.page.id);
    for (const b of rightPd.textBoxes) map.set(b.id, right.page.id);
    for (const s of rightPd.shapes ?? []) map.set(s.id, right.page.id);
    for (const im of rightPd.images ?? []) map.set(im.id, right.page.id);
    return map;
  }, [leftPd, rightPd, left.page.id, right.page.id]);

  const leftTree = project.illustrations?.[left.page.id];
  const leftCursor = leftTree ? getCursor(leftTree).content : null;
  const leftUrl = useBlobUrl(leftCursor?.blobId ?? left.page.blobId);

  const rightTree = project.illustrations?.[right.page.id];
  const rightCursor = rightTree ? getCursor(rightTree).content : null;
  const rightUrl = useBlobUrl(rightCursor?.blobId ?? right.page.blobId);

  const caps = useMemo(() => formatCapabilitiesForProject(project), [project]);
  // A left page's inner (spine-facing) edge is on its right, and vice versa —
  // same convention `HalfFrame` uses for the independent-stage case.
  const leftGuides =
    guides && !leftBlank ? computePageGuides({ caps, spread: false, bindingSide: "right" }) : null;
  const rightGuides =
    guides && !rightBlank ? computePageGuides({ caps, spread: false, bindingSide: "left" }) : null;

  const leftJobActive = useJobsStore((s) => s.activeUnitIds.has(left.page.id));
  const rightJobActive = useJobsStore((s) => s.activeUnitIds.has(right.page.id));
  const leftGenerating = (generatingPages.has(left.page.id) || leftJobActive) && !leftBlank;
  const rightGenerating = (generatingPages.has(right.page.id) || rightJobActive) && !rightBlank;
  const overlayEntry = leftGenerating ? left : rightGenerating ? right : null;

  const onEitherPage =
    (selection.kind === "box" || selection.kind === "shape" || selection.kind === "image") &&
    (selection.pageId === left.page.id || selection.pageId === right.page.id);
  const selectedElementId = onEitherPage
    ? selection.kind === "box"
      ? selection.boxId
      : selection.kind === "shape"
        ? selection.shapeId
        : selection.imageId
    : null;
  const selectedSpan = selection.kind === "box" && onEitherPage ? selection.span : null;

  function applyPatch(pageId: string, id: string, kind: ModelKind, patch: GeomPatch) {
    if (kind === "box") patchBox(pageId, id, patch);
    else if (kind === "shape") patchShape(pageId, id, patch);
    else patchImage(pageId, id, patch);
  }

  const aspect = left.page.aspect || right.page.aspect || 1;

  return (
    <PageStage
      pageDesign={merged}
      imageUrl={leftBlank ? undefined : leftUrl ?? undefined}
      aspect={aspect * 2}
      illustrationFocus={defaultIllustrationFocus(left.page)}
      rightSurface={{
        imageUrl: rightBlank ? undefined : rightUrl ?? undefined,
        illustrationFocus: defaultIllustrationFocus(right.page),
        background: rightPd.background,
        printGuides: rightGuides,
      }}
      dropId={pairDropId(left.page.id, right.page.id)}
      snap={snap}
      grid={grid}
      printGuides={leftGuides}
      selectedId={selectedElementId}
      onSelectElement={(ref) => {
        if (!ref) {
          select({ kind: "page", pageId: left.page.id });
          return;
        }
        const ownerId = elementOwner.get(ref.id) ?? left.page.id;
        const kind = toModelKind(ref.kind);
        if (kind === "box") select({ kind: "box", pageId: ownerId, boxId: ref.id, span: null });
        else if (kind === "shape") select({ kind: "shape", pageId: ownerId, shapeId: ref.id });
        else select({ kind: "image", pageId: ownerId, imageId: ref.id });
      }}
      onChangeElement={(id, kind, patch) => {
        const ownerId = elementOwner.get(id) ?? left.page.id;
        const modelKind = toModelKind(kind);
        if (patch.rect) {
          const centerX = patch.rect.x + patch.rect.w / 2;
          const isRight = centerX >= 0.5;
          const destId = isRight ? right.page.id : left.page.id;
          const localRect = fromCombinedRect(patch.rect, isRight);
          if (destId === ownerId) {
            // No crossing: one normal patch (keeps rotation/minHeightPct, if
            // any, in the same undo step as the rect change).
            applyPatch(ownerId, id, modelKind, { ...patch, rect: localRect });
            return;
          }
          moveElementToPage(modelKind, ownerId, destId, id, localRect);
          const { rect: _rect, ...rest } = patch;
          if (Object.keys(rest).length > 0) applyPatch(destId, id, modelKind, rest);
          return;
        }
        applyPatch(ownerId, id, modelKind, patch);
      }}
      onReframeImage={(id, patch) => patchImage(elementOwner.get(id) ?? left.page.id, id, patch)}
      onAdjustArt={(side) => makeIllustrationEditable(side === "right" ? right.page.id : left.page.id)}
      onEditText={(id, value) =>
        patchBox(elementOwner.get(id) ?? left.page.id, id, { paragraphs: wordParagraphs(value) })
      }
      onEditRichText={(id, paragraphs) =>
        patchBox(elementOwner.get(id) ?? left.page.id, id, { paragraphs })
      }
      onStyleBox={(id, patch) => patchBox(elementOwner.get(id) ?? left.page.id, id, patch)}
      selectedSpan={selectedSpan}
      onSelectSpan={(ref: SpanRef | null) => {
        if (selection.kind === "box" && onEitherPage) {
          select({ kind: "box", pageId: selection.pageId, boxId: selection.boxId, span: ref });
        }
      }}
      overlay={
        overlayEntry ? (
          <GenerationOverlay
            action="pageIllustration"
            refCount={
              (overlayEntry.subject.kind === "spread" ? overlayEntry.subject.spread.anchorIds : undefined)
                ?.length ?? 0
            }
            className="rounded-xl"
          />
        ) : undefined
      }
    />
  );
}
