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
import { bookProductForConfig, formatCapabilitiesForProject } from "../../core/book";
import { computePageGuides } from "../../core/book/format";
import { getCursor } from "../../core/versioning";
import { defaultIllustrationFocus } from "../design/designInit";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { FastDraftBadge } from "../components/FastDraftBadge";
import { useJobsStore } from "../../state/jobsStore";
import { PageStage, type ElementKind as StageElementKind, type GeomPatch } from "../design/PageStage";
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

/** Keep a combined-space rect inside its owner half (page art can't cross the fold). */
function clampCombinedRectToHalf(rect: NormRect, ownerIsRight: boolean): NormRect {
  const minX = ownerIsRight ? 0.5 : 0;
  const maxX = ownerIsRight ? 1 : 0.5;
  const maxW = maxX - minX;
  const w = Math.min(rect.w, maxW);
  const x = Math.max(minX, Math.min(maxX - w, rect.x));
  return { x, y: rect.y, w, h: rect.h };
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
    selectIllustration,
    pendingReframeImageId,
    clearPendingReframe,
    moveElementToPage,
    duplicateBox,
    deleteBox,
    duplicateImage,
    deleteImage,
    copyBoxStyle,
    pasteBoxStyle,
    hasCopiedBoxStyle,
    endHistoryGesture,
    undo,
    redo,
    snap,
    grid,
    guides,
    generatingPages,
  } = useStudio();
  const trim = bookProductForConfig(project.config).trim;

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
  const leftRefCount =
    (left.subject.kind === "spread" ? left.subject.spread.anchorIds : left.subject.cover.anchorIds)
      ?.length ?? 0;
  const rightRefCount =
    (right.subject.kind === "spread" ? right.subject.spread.anchorIds : right.subject.cover.anchorIds)
      ?.length ?? 0;

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
      overlay={
        leftCursor?.imageTier === "quick" || rightCursor?.imageTier === "quick" ? (
          <>
            {leftCursor?.imageTier === "quick" && <FastDraftBadge />}
            {rightCursor?.imageTier === "quick" && (
              <FastDraftBadge className="left-[calc(50%+0.5rem)]" />
            )}
          </>
        ) : undefined
      }
      fillParent
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
          const ownerIsRight = ownerId === right.page.id;

          // Page AI art stays on its page — clamp to the owner half instead of
          // reassigning ownership (which swapped bitmaps / left ghosts).
          if (destId !== ownerId && modelKind === "image") {
            const im = pageDesign(ownerId).images?.find((x) => x.id === id);
            if (im?.kind === "illustration") {
              const clamped = clampCombinedRectToHalf(patch.rect, ownerIsRight);
              applyPatch(ownerId, id, modelKind, {
                ...patch,
                rect: fromCombinedRect(clamped, ownerIsRight),
              });
              return;
            }
          }

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
      onReframeImage={(id, patch) => {
        const ownerId = elementOwner.get(id) ?? left.page.id;
        if (!patch.rect) {
          patchImage(ownerId, id, patch);
          return;
        }
        // Overlay works in combined stage space; store page-local rects.
        const ownerIsRight = ownerId === right.page.id;
        const clamped = clampCombinedRectToHalf(patch.rect, ownerIsRight);
        patchImage(ownerId, id, {
          ...patch,
          rect: fromCombinedRect(clamped, ownerIsRight),
        });
      }}
      onSelectArt={(side) => selectIllustration(side === "right" ? right.page.id : left.page.id)}
      onAdjustArt={(side) =>
        selectIllustration(side === "right" ? right.page.id : left.page.id, {
          enterReframe: true,
        })
      }
      autoReframeId={pendingReframeImageId}
      onAutoReframeConsumed={clearPendingReframe}
      onEditText={(id, value) =>
        patchBox(elementOwner.get(id) ?? left.page.id, id, { paragraphs: wordParagraphs(value) })
      }
      onEditRichText={(id, paragraphs) =>
        patchBox(elementOwner.get(id) ?? left.page.id, id, { paragraphs })
      }
      onStyleBox={(id, patch, opts) =>
        patchBox(elementOwner.get(id) ?? left.page.id, id, patch, opts)
      }
      textToolbar={{
        pageWidthIn: trim.widthIn,
        pageHeightIn: trim.heightIn,
        ageRangeId: project.config.ageRangeId,
        readingModeId: project.config.readingModeId,
        onDuplicate: (boxId) => duplicateBox(elementOwner.get(boxId) ?? left.page.id, boxId),
        onDelete: (boxId) => deleteBox(elementOwner.get(boxId) ?? left.page.id, boxId),
        onToggleLock: (boxId) => {
          const pageId = elementOwner.get(boxId) ?? left.page.id;
          const box = pageDesign(pageId).textBoxes.find((b) => b.id === boxId);
          if (box) patchBox(pageId, boxId, { locked: !box.locked });
        },
        onCopyStyle: (boxId) => copyBoxStyle(elementOwner.get(boxId) ?? left.page.id, boxId),
        onPasteStyle: (boxId) => pasteBoxStyle(elementOwner.get(boxId) ?? left.page.id, boxId),
        canPasteStyle: hasCopiedBoxStyle,
        onGestureEnd: endHistoryGesture,
        onDiscardEdit: () => {
          undo();
          endHistoryGesture();
        },
        undo,
        redo,
      }}
      imageToolbar={{
        pageIdForImage: (imageId) => elementOwner.get(imageId) ?? left.page.id,
        onPatch: (imageId, patch, opts) =>
          patchImage(elementOwner.get(imageId) ?? left.page.id, imageId, patch, opts),
        onDuplicate: (imageId) =>
          duplicateImage(elementOwner.get(imageId) ?? left.page.id, imageId),
        onDelete: (imageId) => deleteImage(elementOwner.get(imageId) ?? left.page.id, imageId),
        onToggleLock: (imageId) => {
          const pageId = elementOwner.get(imageId) ?? left.page.id;
          const im = pageDesign(pageId).images?.find((x) => x.id === imageId);
          if (im) patchImage(pageId, imageId, { locked: !im.locked });
        },
      }}
      selectedSpan={selectedSpan}
      onSelectSpan={(ref: SpanRef | null) => {
        if (selection.kind === "box" && onEitherPage) {
          select({ kind: "box", pageId: selection.pageId, boxId: selection.boxId, span: ref });
        }
      }}
      artBusy={{
        ...(leftGenerating
          ? {
              left: {
                action: "pageIllustration" as const,
                refCount: leftRefCount,
                illustrationId: left.page.id,
              },
            }
          : {}),
        ...(rightGenerating
          ? {
              right: {
                action: "pageIllustration" as const,
                refCount: rightRefCount,
                illustrationId: right.page.id,
              },
            }
          : {}),
      }}
    />
  );
}
