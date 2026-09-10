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
 * `PageStage`. Page backgrounds stay per-leaf via `rightSurface`. Generated
 * page art may overflow the fold like any overlay, but it stays bound to its
 * owner leaf (bitmap + ownership) — only placed overlays reassign when their
 * center crosses x=0.5 (`moveElementToPage`).
 */
import { useMemo } from "react";
import type { PageDesign } from "../../core/types";
import { wordParagraphs } from "../../core/design";
import {
  fromCombinedRect,
  mergePairDesign,
  pairElementOwners,
} from "../../core/book/pairSurface";
import { lastTextPaintFor, patchedShapeText, shapeTextForNew } from "../design/lastPaint";
import { bookProductForConfig, formatCapabilitiesForProject } from "../../core/book";
import { computePageGuides } from "../../core/book/format";
import { getCursor } from "../../core/versioning";
import { defaultIllustrationFocus } from "../design/designInit";
import { useBlobUrl } from "../hooks/useBlobUrl";
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

export function PairPageStagePanel({ left, right }: { left: Entry; right: Entry }) {
  const {
    project,
    design,
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
    duplicateShape,
    deleteShape,
    copyBoxStyle,
    pasteBoxStyle,
    hasCopiedBoxStyle,
    textStyleScope,
    applyTextStyleToScope,
    endHistoryGesture,
    undo,
    redo,
    snap,
    grid,
    guides,
    bleedVisible,
    bleedMode,
    generatingPages,
  } = useStudio();
  const product = bookProductForConfig(project.config);
  const trim = product.trim;

  const leftPd = pageDesign(left.page.id);
  const rightPd = pageDesign(right.page.id);
  const leftBlank = isBlankEntry(left);
  const rightBlank = isBlankEntry(right);

  const merged: PageDesign = useMemo(() => mergePairDesign(leftPd, rightPd), [leftPd, rightPd]);

  const elementOwner = useMemo(
    () => pairElementOwners(leftPd, rightPd, left.page.id, right.page.id),
    [leftPd, rightPd, left.page.id, right.page.id],
  );

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
      fillParent
      snap={snap}
      grid={grid}
      printGuides={leftGuides}
      printBleed={{
        visible: bleedVisible,
        mode: bleedMode,
        sizeIn: product.bleedIn,
        trimWidthIn: trim.widthIn * 2,
        trimHeightIn: trim.heightIn,
      }}
      selectedId={selectedElementId}
      onSelectSurface={(side) =>
        select({
          kind: "page",
          pageId: side === "right" ? right.page.id : left.page.id,
        })
      }
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
          const ownerIsRight = ownerId === right.page.id;
          if (modelKind === "image") {
            const im = pageDesign(ownerId).images?.find((x) => x.id === id);
            // Page AI art stays on its owner leaf; the frame may cross the fold.
            if (im?.kind === "illustration") {
              applyPatch(ownerId, id, modelKind, {
                ...patch,
                rect: fromCombinedRect(patch.rect, ownerIsRight),
              });
              return;
            }
          }

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
      onReframeImage={(id, patch) => {
        const ownerId = elementOwner.get(id) ?? left.page.id;
        if (!patch.rect) {
          patchImage(ownerId, id, patch);
          return;
        }
        // Combined stage space → page-local, including overflow past the fold.
        const ownerIsRight = ownerId === right.page.id;
        patchImage(ownerId, id, {
          ...patch,
          rect: fromCombinedRect(patch.rect, ownerIsRight),
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
      onEditText={(id, value) => {
        const pageId = elementOwner.get(id) ?? left.page.id;
        const paragraphs = wordParagraphs(value);
        const shape = pageDesign(pageId).shapes?.find((s) => s.id === id);
        if (shape) {
          patchShape(pageId, id, {
            text: patchedShapeText(
              shape,
              { paragraphs },
              {
                fontFamily: design.defaultFontFamily,
                fontSizePct: design.defaultFontSizePct,
              },
              lastTextPaintFor(design, shape),
            ),
          });
          return;
        }
        patchBox(pageId, id, { paragraphs });
      }}
      onEditRichText={(id, paragraphs) => {
        const pageId = elementOwner.get(id) ?? left.page.id;
        const shape = pageDesign(pageId).shapes?.find((s) => s.id === id);
        if (shape) {
          patchShape(pageId, id, {
            text: patchedShapeText(
              shape,
              { paragraphs },
              {
                fontFamily: design.defaultFontFamily,
                fontSizePct: design.defaultFontSizePct,
              },
              lastTextPaintFor(design, shape),
            ),
          });
          return;
        }
        patchBox(pageId, id, { paragraphs });
      }}
      onStyleBox={(id, patch, opts) => {
        const pageId = elementOwner.get(id) ?? left.page.id;
        const shape = pageDesign(pageId).shapes?.find((s) => s.id === id);
        if (shape) {
          patchShape(
            pageId,
            id,
            {
              text: patchedShapeText(
                shape,
                patch,
                {
                  fontFamily: design.defaultFontFamily,
                  fontSizePct: design.defaultFontSizePct,
                },
                lastTextPaintFor(design, shape),
              ),
            },
            opts,
          );
          return;
        }
        patchBox(pageId, id, patch, opts);
      }}
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
        styleScope: (boxId) =>
          textStyleScope(elementOwner.get(boxId) ?? left.page.id, boxId),
        onApplyStyleToScope: (boxId) =>
          applyTextStyleToScope(elementOwner.get(boxId) ?? left.page.id, boxId),
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
      shapeToolbar={{
        onPatch: (shapeId, patch, opts) =>
          patchShape(elementOwner.get(shapeId) ?? left.page.id, shapeId, patch, opts),
        onDuplicate: (shapeId) =>
          duplicateShape(elementOwner.get(shapeId) ?? left.page.id, shapeId),
        onDelete: (shapeId) => deleteShape(elementOwner.get(shapeId) ?? left.page.id, shapeId),
        onToggleLock: (shapeId) => {
          const pageId = elementOwner.get(shapeId) ?? left.page.id;
          const shape = pageDesign(pageId).shapes?.find((x) => x.id === shapeId);
          if (shape) patchShape(pageId, shapeId, { locked: !shape.locked });
        },
        onGestureEnd: endHistoryGesture,
        newText: (shape) =>
          shapeTextForNew(
            shape,
            {
              fontFamily: design.defaultFontFamily,
              fontSizePct: design.defaultFontSizePct,
            },
            lastTextPaintFor(design, shape),
          ),
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
