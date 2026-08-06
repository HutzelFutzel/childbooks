import { useMemo, useState } from "react";
import {
  Copy,
  MoreHorizontal,
  MoveDown,
  MoveUp,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import type { Anchor, CoverSpec, ScreenplaySpread } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { wordParagraphs } from "../../core/design";
import { bookProductForConfig, formatCapabilitiesForProject } from "../../core/book";
import {
  computeBackCoverLogoZone,
  computePageGuides,
  type BindingSide,
} from "../../core/book/format";
import { getCursor } from "../../core/versioning";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useJobsStore } from "../../state/jobsStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Popover } from "../components/Popover";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";
import { PageStage } from "../design/PageStage";
import {
  defaultIllustrationFocus,
  type DesignPage,
} from "../design/designInit";
import type { SpanRef } from "../design/TextBoxView";
import { useStudio } from "./StudioContext";
import { useStudioPanelStore } from "./studioPanelStore";
import { coverSpread } from "./studioGen";
import { duplicateSpread, moveSpread, removeSpread } from "./pageOps";

export type PageSubject =
  | { kind: "spread"; spread: ScreenplaySpread }
  | { kind: "cover"; coverId: string; cover: CoverSpec };

/** Derived per-page values shared by the stage and the controls. */
function genSpreadFor(subject: PageSubject): ScreenplaySpread {
  return subject.kind === "spread"
    ? subject.spread
    : coverSpread(subject.coverId, subject.cover);
}

/**
 * The interactive page surface only: image + overlay (text/shapes), with inline
 * text editing (double-click) and drop-target wiring. No chrome of its own when
 * `chromeless`, so a wrapper can frame two facing pages as one spread.
 */
export function PageStagePanel({
  page,
  subject,
  chromeless = false,
  bindingSide,
  fitParent = false,
  fillParent = false,
}: {
  page: DesignPage;
  subject: PageSubject;
  chromeless?: boolean;
  /** Which edge binds into the spine (for the gutter guide on single pages). */
  bindingSide?: BindingSide;
  /** Contain within the stage host (single pages). */
  fitParent?: boolean;
  /** Fill a pre-sized chrome box (facing halves). */
  fillParent?: boolean;
}) {
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

  const coverMode = subject.kind === "cover";
  const blank = subject.kind === "spread" && !!subject.spread.blankCanvas;
  const genSpread = genSpreadFor(subject);
  const isSpread = !coverMode && genSpread.kind === "spread";

  // Mirror the generation state used by the controls so the page surface itself
  // shows the rich, time-estimated progress overlay while it's rendering.
  const jobActive = useJobsStore((s) => s.activeUnitIds.has(genSpread.id));
  const generating = generatingPages.has(page.id) || jobActive;
  const subjectRefCount =
    (subject.kind === "spread" ? subject.spread.anchorIds : subject.cover.anchorIds)?.length ?? 0;

  const caps = useMemo(() => formatCapabilitiesForProject(project), [project]);
  const isBackCover =
    coverMode && subject.kind === "cover" && subject.coverId === COVER_BACK_ID;
  // Stored on the brand asset at upload (height÷width). Falls back to a default
  // wide shape inside computeBackCoverLogoZone when none is configured yet —
  // the reserved box always shows under Print guides, like the barcode zone.
  const backCoverLogoAspect = useAppConfigStore((s) => s.branding.backCoverLogo?.aspect ?? null);
  // Covers have no gutter; interior single pages bind on `bindingSide` (falling
  // back to "center", which suppresses the gutter when the side is unknown).
  const printGuides =
    guides && !blank
      ? {
          ...computePageGuides({
            caps,
            spread: isSpread,
            bindingSide: coverMode ? "center" : bindingSide ?? "center",
          }),
          // Backcover logo reserved zone only. Barcode area is temporarily
          // disabled — re-enable with `computeBarcodeZone(caps)` when ready.
          barcode: null,
          logo: isBackCover ? computeBackCoverLogoZone(caps, backCoverLogoAspect) : null,
        }
      : null;

  const tree = project.illustrations?.[page.id];
  const cursor = tree ? getCursor(tree).content : null;
  const url = useBlobUrl(cursor?.blobId ?? page.blobId);

  const pd = pageDesign(page.id);
  const onThisPage =
    (selection.kind === "box" || selection.kind === "shape" || selection.kind === "image") &&
    selection.pageId === page.id;
  const selectedElementId = onThisPage
    ? selection.kind === "box"
      ? selection.boxId
      : selection.kind === "shape"
        ? selection.shapeId
        : selection.imageId
    : null;
  const selectedSpan = selection.kind === "box" && onThisPage ? selection.span : null;

  return (
    <PageStage
      pageDesign={pd}
      imageUrl={blank ? undefined : url ?? undefined}
      aspect={page.aspect}
      illustrationFocus={defaultIllustrationFocus(page)}
      dropId={page.id}
      chromeless={chromeless}
      fitParent={fitParent}
      fillParent={fillParent}
      snap={snap}
      grid={grid}
      showGutter={isSpread}
      printGuides={printGuides}
      selectedId={selectedElementId}
      onSelectElement={(ref) => {
        if (!ref) {
          select({ kind: "page", pageId: page.id });
        } else if (ref.kind === "text") {
          select({ kind: "box", pageId: page.id, boxId: ref.id, span: null });
        } else if (ref.kind === "shape") {
          select({ kind: "shape", pageId: page.id, shapeId: ref.id });
        } else {
          select({ kind: "image", pageId: page.id, imageId: ref.id });
        }
      }}
      onChangeElement={(id, kind, patch) =>
        kind === "text"
          ? patchBox(page.id, id, patch)
          : kind === "shape"
            ? patchShape(page.id, id, patch)
            : patchImage(page.id, id, patch)
      }
      onReframeImage={(id, patch) => patchImage(page.id, id, patch)}
      onSelectArt={() => selectIllustration(page.id)}
      onAdjustArt={() => selectIllustration(page.id, { enterReframe: true })}
      autoReframeId={pendingReframeImageId}
      onAutoReframeConsumed={clearPendingReframe}
      onEditText={(id, value) =>
        patchBox(page.id, id, { paragraphs: wordParagraphs(value) })
      }
      onEditRichText={(id, paragraphs) => patchBox(page.id, id, { paragraphs })}
      onStyleBox={(id, patch, opts) => patchBox(page.id, id, patch, opts)}
      textToolbar={{
        pageWidthIn: trim.widthIn,
        pageHeightIn: trim.heightIn,
        ageRangeId: project.config.ageRangeId,
        readingModeId: project.config.readingModeId,
        onDuplicate: (boxId) => duplicateBox(page.id, boxId),
        onDelete: (boxId) => deleteBox(page.id, boxId),
        onToggleLock: (boxId) => {
          const box = pageDesign(page.id).textBoxes.find((b) => b.id === boxId);
          if (box) patchBox(page.id, boxId, { locked: !box.locked });
        },
        onCopyStyle: (boxId) => copyBoxStyle(page.id, boxId),
        onPasteStyle: (boxId) => pasteBoxStyle(page.id, boxId),
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
        pageIdForImage: () => page.id,
        onPatch: (imageId, patch, opts) => patchImage(page.id, imageId, patch, opts),
        onDuplicate: (imageId) => duplicateImage(page.id, imageId),
        onDelete: (imageId) => deleteImage(page.id, imageId),
        onToggleLock: (imageId) => {
          const im = pageDesign(page.id).images?.find((x) => x.id === imageId);
          if (im) patchImage(page.id, imageId, { locked: !im.locked });
        },
      }}
      selectedSpan={selectedSpan}
      onSelectSpan={(ref: SpanRef | null) => {
        if (selection.kind === "box" && onThisPage)
          select({ kind: "box", pageId: page.id, boxId: selection.boxId, span: ref });
      }}
      artBusy={
        generating && !blank
          ? {
              left: {
                action: coverMode ? "coverIllustration" : "pageIllustration",
                refCount: subjectRefCount,
                compact: chromeless,
                illustrationId: page.id,
              },
            }
          : undefined
      }
    />
  );
}

/**
 * Legacy drawer shell for page illustration tools. Prefer the Canva-style
 * floating ImageStyleBar + docked ImageEditPanel opened from the canvas.
 * Kept as a compact fallback that jumps into that flow.
 */
export function PageControls({
  page,
  label,
}: {
  page: DesignPage;
  subject: PageSubject;
  anchors: Anchor[];
  stale: boolean;
  label?: string;
}) {
  const { selection, selectIllustration } = useStudio();
  const imageEditSection = useStudioPanelStore((s) => s.imageEditSection);
  const openImageEdit = useStudioPanelStore((s) => s.openImageEdit);
  const closeImageEdit = useStudioPanelStore((s) => s.closeImageEdit);

  function toggleIllustrationTools(section: "refine" | "characters" | "scene") {
    const alreadyOpen =
      (selection.kind === "image" || selection.kind === "page") &&
      selection.pageId === page.id &&
      imageEditSection === section;
    if (alreadyOpen) {
      closeImageEdit();
      return;
    }
    // No art → page selection only (no empty illustration frame).
    selectIllustration(page.id);
    openImageEdit(section);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-1">
      <p className="text-sm font-semibold text-ink-800">{label ?? page.label}</p>
      <p className="text-xs leading-relaxed text-ink-500">
        Select the illustration on the page to edit it — use the floating bar for
        Position, Edit, and who’s in the picture. Deep controls open beside the canvas.
      </p>
      <Button
        className="w-full"
        leftIcon={<Wand2 className="size-4" />}
        onClick={() => toggleIllustrationTools("refine")}
      >
        Open illustration tools
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          leftIcon={<Users className="size-4" />}
          onClick={() => toggleIllustrationTools("characters")}
        >
          In this picture
        </Button>
        <Button
          variant="secondary"
          leftIcon={<Sparkles className="size-4" />}
          onClick={() => toggleIllustrationTools("scene")}
        >
          Scene
        </Button>
      </div>
    </div>
  );
}

/** Per-page actions: move, duplicate, delete. Portaled so it isn't buried under the canvas. */
export function PageMenu({ spreadId }: { spreadId: string }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <>
      <Popover
        side="bottom"
        align="end"
        panelClassName="w-40 p-1"
        trigger={
          <span
            title="Page options"
            className="inline-flex rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <MoreHorizontal className="size-4" />
          </span>
        }
      >
        {(close) => (
          <div className="flex flex-col">
            <MenuItem
              icon={<MoveUp className="size-4" />}
              onClick={() => {
                moveSpread(spreadId, -1);
                close();
              }}
            >
              Move up
            </MenuItem>
            <MenuItem
              icon={<MoveDown className="size-4" />}
              onClick={() => {
                moveSpread(spreadId, 1);
                close();
              }}
            >
              Move down
            </MenuItem>
            <MenuItem
              icon={<Copy className="size-4" />}
              onClick={() => {
                duplicateSpread(spreadId);
                close();
              }}
            >
              Duplicate
            </MenuItem>
            <MenuItem
              icon={<Trash2 className="size-4" />}
              danger
              onClick={() => {
                setConfirmingDelete(true);
                close();
              }}
            >
              Delete
            </MenuItem>
          </div>
        )}
      </Popover>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this page?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmingDelete(false);
                removeSpread(spreadId);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This removes the page and its generated art from the book. You can undo
          if you change your mind.
        </p>
      </Modal>
    </>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-ink-50",
        danger ? "text-red-600 hover:bg-red-50" : "text-ink-600",
      )}
    >
      {icon} {children}
    </button>
  );
}

