/**
 * Docked contextual panel for shapes, Arrange (layers), and Canva-style
 * sheets for text/images. Sits as a layout sibling of the stage so the canvas
 * shrinks instead of the panel covering page chips. Everyday styling stays on
 * the floating bars.
 */
import { useState } from "react";
import {
  Blend,
  BringToFront,
  Check,
  ChevronDown,
  ChevronUp,
  Crop,
  Eye,
  EyeOff,
  Grid3x3,
  GripVertical,
  History,
  Image as ImageIcon,
  Layers as LayersIcon,
  LayoutTemplate,
  Lock,
  Magnet,
  SendToBack,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareDashed,
  Type,
  Unlock,
  Users,
  Wand2,
  X,
} from "lucide-react";
import type { PageDesign } from "../../core/types";
import { textFromParagraphs } from "../../core/design";
import { cn } from "../lib/cn";
import { ImageEditPanel, type ImageEditSection } from "../design/ImageEditPanel";
import { ShapeInspector } from "../design/ShapeInspector";
import { TextEditPanel, type TextEditSection } from "../design/TextEditPanel";
import { DockSetupPanel } from "./DockSetupPanel";
import { useStudio, type Selection } from "./StudioContext";
import { useStudioPanelStore, type StudioToolPanel } from "./studioPanelStore";
import { subjectForPage } from "./usePageIllustration";

const TEXT_SECTION_META: Record<
  TextEditSection,
  { title: string; icon: React.ReactNode }
> = {
  effects: { title: "Effects", icon: <Blend className="size-4" /> },
  background: { title: "Background", icon: <Square className="size-4" /> },
};

const IMAGE_SECTION_META: Record<
  ImageEditSection,
  { title: string; icon: React.ReactNode }
> = {
  refine: { title: "Edit illustration", icon: <Sparkles className="size-4" /> },
  characters: { title: "In this picture", icon: <Users className="size-4" /> },
  scene: { title: "Scene", icon: <Wand2 className="size-4" /> },
  versions: { title: "Versions", icon: <History className="size-4" /> },
  effects: { title: "Effects", icon: <Blend className="size-4" /> },
  frame: { title: "Frame & position", icon: <Crop className="size-4" /> },
};

/** Cover pages get cover-specific sheet titles (not page-illustration wording). */
const COVER_SECTION_META: Partial<
  Record<ImageEditSection, { title: string; icon: React.ReactNode }>
> = {
  refine: { title: "Edit cover", icon: <Sparkles className="size-4" /> },
  characters: { title: "On this cover", icon: <Users className="size-4" /> },
  scene: { title: "Cover scene", icon: <Wand2 className="size-4" /> },
  versions: { title: "Cover versions", icon: <History className="size-4" /> },
};

/** Card shell shared by every mode: header with an icon/title + close, then content. */
function PanelShell({
  icon,
  title,
  subtitle,
  onClose,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white"
      data-floating-bar-obstacle
    >
      <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          {icon}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-ink-800">{title}</p>
          {subtitle && <p className="truncate text-[11px] text-ink-400">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          title="Close"
          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * The docked inspector. Renders nothing when there's no element selected and
 * layers weren't explicitly requested — callers should skip mounting it in
 * that case (see `elementPanelHasContent`), but it's defensive either way.
 */
export type ArrangePageRef = { id: string; label: string };

export function ElementPanel({
  toolPanel,
  arrangePages,
  onClose,
}: {
  /** Docked tool opened from the Add dock (arrange / view / setup). */
  toolPanel: StudioToolPanel | null;
  /** Every live page on the current canvas (1–2), for the Arrange panel. */
  arrangePages: ArrangePageRef[];
  onClose: () => void;
}) {
  const studio = useStudio();
  const { selection } = studio;
  const textEditSection = useStudioPanelStore((s) => s.textEditSection);
  const imageEditSection = useStudioPanelStore((s) => s.imageEditSection);
  const closeTextEdit = useStudioPanelStore((s) => s.closeTextEdit);
  const closeImageEdit = useStudioPanelStore((s) => s.closeImageEdit);

  // Closing an element's inspector always dismisses the whole floating panel
  // (not just the element) — deselect AND clear any pending layers request, so
  // the X button never surprises you by falling back to a different view.
  const dismiss = (pageId: string) => {
    studio.select({ kind: "page", pageId });
    onClose();
  };

  // Tool panels win over edit sheets so docked tools stay reachable.
  if (toolPanel === "layers" && arrangePages.length > 0) {
    return (
      <PanelShell
        icon={<LayersIcon className="size-4" />}
        title="Arrange"
        subtitle={
          arrangePages.length > 1
            ? "Pages on this canvas"
            : arrangePages[0]?.label
        }
        onClose={onClose}
      >
        <div className="p-4">
          <ArrangePanel pages={arrangePages} />
        </div>
      </PanelShell>
    );
  }

  if (toolPanel === "view") {
    return (
      <PanelShell
        icon={<SlidersHorizontal className="size-4" />}
        title="View"
        subtitle="Snap, grid & print guides"
        onClose={onClose}
      >
        <ViewPanel />
      </PanelShell>
    );
  }

  if (toolPanel === "setup") {
    return (
      <PanelShell
        icon={<LayoutTemplate className="size-4" />}
        title="Book setup"
        subtitle="Size & layout"
        onClose={onClose}
      >
        <DockSetupPanel />
      </PanelShell>
    );
  }

  // Text edit sheet: opened from the floating toolbar (Effects / Background)
  // so deep controls sit beside the canvas, never over the selected text.
  if (selection.kind === "box" && studio.selectedBox && textEditSection) {
    const box = studio.selectedBox;
    const pageId = selection.pageId;
    const meta = TEXT_SECTION_META[textEditSection];
    return (
      <PanelShell
        icon={meta.icon}
        title={meta.title}
        subtitle={studio.pages.find((p) => p.id === pageId)?.label}
        onClose={closeTextEdit}
      >
        <TextEditPanel
          box={box}
          section={textEditSection}
          onPatch={(patch, opts) => studio.patchBox(pageId, box.id, patch, opts)}
          onGestureEnd={studio.endHistoryGesture}
        />
      </PanelShell>
    );
  }

  // Illustration tools can open on a page before any art/frame exists (Generate).
  if (
    imageEditSection &&
    (selection.kind === "image" || selection.kind === "page") &&
    "pageId" in selection
  ) {
    const pageId = selection.pageId;
    const image =
      selection.kind === "image"
        ? studio.selectedImage
        : (studio.pageDesign(pageId).images ?? []).find((im) => im.kind === "illustration") ??
          null;
    const needsFrame = imageEditSection === "effects" || imageEditSection === "frame";
    if (!needsFrame || image) {
      const coverMode = subjectForPage(pageId, studio.project)?.kind === "cover";
      const meta =
        (coverMode ? COVER_SECTION_META[imageEditSection] : null) ??
        IMAGE_SECTION_META[imageEditSection];
      return (
        <PanelShell
          icon={meta.icon}
          title={meta.title}
          subtitle={studio.pages.find((p) => p.id === pageId)?.label}
          onClose={closeImageEdit}
        >
          <ImageEditPanel
            pageId={pageId}
            image={image}
            section={imageEditSection}
            onPatch={(patch, opts) => {
              if (!image) return;
              studio.patchImage(pageId, image.id, patch, opts);
            }}
            onGestureEnd={studio.endHistoryGesture}
            onAlign={(edge) => {
              if (!image) return;
              studio.alignImage(pageId, image.id, edge);
            }}
          />
        </PanelShell>
      );
    }
  }

  if (selection.kind === "shape" && studio.selectedShape) {
    const shape = studio.selectedShape;
    const pageId = selection.pageId;
    return (
      <PanelShell
        icon={<Shapes className="size-4" />}
        title="Shape"
        subtitle={studio.pages.find((p) => p.id === pageId)?.label}
        onClose={() => dismiss(pageId)}
      >
        <ShapeInspector
          shape={shape}
          onChange={(patch, opts) => studio.patchShape(pageId, shape.id, patch, opts)}
          onGestureEnd={studio.endHistoryGesture}
          onDelete={() => studio.deleteShape(pageId, shape.id)}
          onDuplicate={() => studio.duplicateShape(pageId, shape.id)}
          onAlign={(edge) => studio.alignShape(pageId, shape.id, edge)}
        />
      </PanelShell>
    );
  }

  return null;
}

interface LayerRow {
  id: string;
  kind: "text" | "shape" | "image";
  z: number;
  label: string;
  hidden?: boolean;
  locked?: boolean;
  /** Page AI art — typically kept at the back like Canva's background photo. */
  pageArt?: boolean;
}

function layerRowsForPage(pd: PageDesign): LayerRow[] {
  return [
    ...pd.textBoxes.map((b) => ({
      id: b.id,
      kind: "text" as const,
      z: b.z,
      label: b.name?.trim() || textFromParagraphs(b.paragraphs).trim() || "Text",
      hidden: b.hidden,
      locked: b.locked,
    })),
    ...(pd.shapes ?? []).map((s) => ({
      id: s.id,
      kind: "shape" as const,
      z: s.z,
      label: s.name?.trim() || s.kind,
      hidden: s.hidden,
      locked: s.locked,
    })),
    ...(pd.images ?? []).map((im) => ({
      id: im.id,
      kind: "image" as const,
      z: im.z,
      label:
        im.name?.trim() ||
        (im.kind === "illustration" ? "Page art" : "Image"),
      hidden: im.hidden,
      locked: im.locked,
      pageArt: im.kind === "illustration",
    })),
  ].sort((a, b) => b.z - a.z);
}

/**
 * Arrange stack for every page on the current canvas. Facing pages appear as
 * separate sections — stacking is per-page (not across the fold).
 */
function ArrangePanel({ pages }: { pages: ArrangePageRef[] }) {
  const multi = pages.length > 1;
  return (
    <div className="space-y-4">
      <p className="px-0.5 text-[11px] leading-snug text-ink-400">
        Top of each list is in front.
        {multi ? " Reorder within a page — not across pages." : " Drag to reorder."}
      </p>
      {pages.map((p) => (
        <PageLayerSection key={p.id} pageId={p.id} label={p.label} showHeader={multi} />
      ))}
    </div>
  );
}

/** Reorderable list for one page (top of stack first). */
function PageLayerSection({
  pageId,
  label,
  showHeader,
}: {
  pageId: string;
  label: string;
  showHeader: boolean;
}) {
  const studio = useStudio();
  const pd = studio.pageDesign(pageId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const rows = layerRowsForPage(pd);

  const sel = studio.selection;
  const selectedOnThisPage =
    (sel.kind === "box" || sel.kind === "shape" || sel.kind === "image") && sel.pageId === pageId;

  const selectedId =
    selectedOnThisPage && sel.kind === "box"
      ? sel.boxId
      : selectedOnThisPage && sel.kind === "shape"
        ? sel.shapeId
        : selectedOnThisPage && sel.kind === "image"
          ? sel.imageId
          : null;

  const selectedIdx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
  const sectionActive = selectedOnThisPage;

  function selectRow(row: LayerRow) {
    if (row.kind === "text") studio.select({ kind: "box", pageId, boxId: row.id, span: null });
    else if (row.kind === "shape") studio.select({ kind: "shape", pageId, shapeId: row.id });
    else studio.select({ kind: "image", pageId, imageId: row.id });
  }

  const Icon = { text: Type, shape: Shapes, image: ImageIcon };

  function rowIdAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest(`[data-layer-page="${pageId}"][data-layer-id]`) as HTMLElement | null;
    return cell?.getAttribute("data-layer-id") ?? null;
  }

  function handleMove(x: number, y: number) {
    if (!dragId) return;
    const id = rowIdAt(x, y);
    setOverId(id && id !== dragId ? id : null);
  }

  function handleUp(x: number, y: number) {
    if (dragId) {
      const targetId = rowIdAt(x, y);
      if (targetId && targetId !== dragId) {
        const order = rows.map((r) => r.id);
        const from = order.indexOf(dragId);
        if (from !== -1) {
          order.splice(from, 1);
          const insertAt = order.indexOf(targetId);
          if (insertAt !== -1) {
            order.splice(insertAt, 0, dragId);
            studio.setLayerOrder(pageId, order);
          }
        }
      }
    }
    setDragId(null);
    setOverId(null);
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl",
        showHeader && sectionActive && "bg-brand-50/40 ring-1 ring-brand-100",
        showHeader && "p-2",
      )}
    >
      {showHeader && (
        <p
          className={cn(
            "px-1 text-xs font-semibold",
            sectionActive ? "text-brand-800" : "text-ink-600",
          )}
        >
          {label}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-1 text-[11px] leading-relaxed text-ink-400">Nothing on this page yet.</p>
      ) : (
        <>
          {selectedId && selectedIdx >= 0 && (
            <div className="flex items-center gap-0.5 rounded-lg border border-ink-100 bg-ink-50/80 p-0.5">
              <LayerOrderBtn
                title="Bring to front"
                disabled={selectedIdx === 0}
                onClick={() => studio.sendLayerToEdge(pageId, selectedId, "front")}
              >
                <BringToFront className="size-3.5" />
              </LayerOrderBtn>
              <LayerOrderBtn
                title="Bring forward"
                disabled={selectedIdx === 0}
                onClick={() => studio.moveLayer(pageId, selectedId, 1)}
              >
                <ChevronUp className="size-3.5" />
              </LayerOrderBtn>
              <LayerOrderBtn
                title="Send backward"
                disabled={selectedIdx === rows.length - 1}
                onClick={() => studio.moveLayer(pageId, selectedId, -1)}
              >
                <ChevronDown className="size-3.5" />
              </LayerOrderBtn>
              <LayerOrderBtn
                title="Send to back"
                disabled={selectedIdx === rows.length - 1}
                onClick={() => studio.sendLayerToEdge(pageId, selectedId, "back")}
              >
                <SendToBack className="size-3.5" />
              </LayerOrderBtn>
            </div>
          )}

          <div className="space-y-1">
            {rows.map((row) => {
              const RowIcon = Icon[row.kind];
              const selected = selectedId === row.id;
              return (
                <div
                  key={row.id}
                  data-layer-page={pageId}
                  data-layer-id={row.id}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDragId(row.id);
                    selectRow(row);
                  }}
                  onPointerMove={(e) => handleMove(e.clientX, e.clientY)}
                  onPointerUp={(e) => handleUp(e.clientX, e.clientY)}
                  onPointerCancel={(e) => handleUp(e.clientX, e.clientY)}
                  className={cn(
                    "flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition active:cursor-grabbing",
                    selected ? "bg-brand-50 text-brand-800" : "text-ink-600 hover:bg-ink-50",
                    overId === row.id && "ring-2 ring-brand-300",
                    dragId === row.id && "opacity-60",
                    row.hidden && "opacity-50",
                  )}
                >
                  <GripVertical className="size-3.5 shrink-0 text-ink-300" />
                  <RowIcon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">
                    {row.label}
                    {row.pageArt && (
                      <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                        Art
                      </span>
                    )}
                  </span>
                  <button
                    title={row.hidden ? "Show" : "Hide"}
                    onClick={(e) => {
                      e.stopPropagation();
                      studio.setLayerHidden(pageId, row.id, !row.hidden);
                    }}
                    className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                  >
                    {row.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                  <button
                    title={row.locked ? "Unlock" : "Lock"}
                    onClick={(e) => {
                      e.stopPropagation();
                      studio.setLayerLocked(pageId, row.id, !row.locked);
                    }}
                    className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                  >
                    {row.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function LayerOrderBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex flex-1 items-center justify-center rounded-md px-1.5 py-1.5 text-ink-600 transition hover:bg-white hover:text-ink-800 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Whether the floating panel has anything to show right now. */
export function elementPanelHasContent(
  selection: Selection,
  toolPanel: StudioToolPanel | null,
  textEditOpen = false,
  imageEditOpen = false,
): boolean {
  if (toolPanel) return true;
  if (selection.kind === "box" && textEditOpen) return true;
  if (selection.kind === "image" && imageEditOpen) return true;
  // Generate / cast tools before any illustration frame exists.
  if (selection.kind === "page" && imageEditOpen) return true;
  return selection.kind === "shape";
}

function ViewPanel() {
  const { snap, grid, guides, toggleSnap, toggleGrid, toggleGuides } = useStudio();
  return (
    <div className="flex flex-col gap-0.5 p-2">
      <ViewRow
        icon={<Magnet className="size-4" />}
        label="Snap to guides"
        active={snap}
        onClick={toggleSnap}
      />
      <ViewRow icon={<Grid3x3 className="size-4" />} label="Grid" active={grid} onClick={toggleGrid} />
      <ViewRow
        icon={<SquareDashed className="size-4" />}
        label="Print guides"
        hint="Safe area + gutter"
        active={guides}
        onClick={toggleGuides}
      />
    </div>
  );
}

function ViewRow({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-ink-50"
    >
      <span className="text-ink-400">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-sm font-medium text-ink-700">{label}</span>
        {hint && <span className="block text-[11px] text-ink-400">{hint}</span>}
      </span>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border transition",
          active ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300 text-transparent",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}

