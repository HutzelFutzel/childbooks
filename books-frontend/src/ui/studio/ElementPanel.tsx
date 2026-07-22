/**
 * The floating contextual panel that replaces the old permanent right
 * sidebar. It only exists on screen when there's something to say: selecting
 * a text box / shape / image pops it open with that element's styling
 * controls, and it closes the moment you deselect. It never reserves layout
 * space — it's an overlay anchored near the canvas, not a docked pane.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Layers as LayersIcon,
  Lock,
  Shapes,
  Type,
  Unlock,
  X,
} from "lucide-react";
import { textFromParagraphs } from "../../core/design";
import { bookProductForConfig } from "../../core/book";
import { cn } from "../lib/cn";
import { popIn } from "../lib/motion";
import { Inspector } from "../design/Inspector";
import { ImageInspector } from "../design/ImageInspector";
import { ShapeInspector } from "../design/ShapeInspector";
import { useStudio, type Selection } from "./StudioContext";

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
    <motion.div
      variants={popIn}
      initial="hidden"
      animate="show"
      exit="exit"
      className="pointer-events-auto flex max-h-[70vh] w-full flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white/98 shadow-lifted backdrop-blur-sm sm:w-80"
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
    </motion.div>
  );
}

/**
 * The floating panel itself. Renders nothing when there's no element selected
 * and layers weren't explicitly requested — callers should skip mounting it
 * in that case (see `usePanelMode`), but it's defensive either way.
 */
export function ElementPanel({
  wantLayers,
  activePageId,
  onClose,
}: {
  /** True when the caller toggled the Layers button (with no element selected). */
  wantLayers: boolean;
  /** Page whose layers to show when in layers mode. */
  activePageId?: string;
  onClose: () => void;
}) {
  const studio = useStudio();
  const { selection, project } = studio;

  // Closing an element's inspector always dismisses the whole floating panel
  // (not just the element) — deselect AND clear any pending layers request, so
  // the X button never surprises you by falling back to a different view.
  const dismiss = (pageId: string) => {
    studio.select({ kind: "page", pageId });
    onClose();
  };

  if (selection.kind === "box" && studio.selectedBox) {
    const box = studio.selectedBox;
    const pageId = selection.pageId;
    const trim = bookProductForConfig(project.config).trim;
    return (
      <PanelShell
        icon={<Type className="size-4" />}
        title="Text box"
        subtitle={studio.pages.find((p) => p.id === pageId)?.label}
        onClose={() => dismiss(pageId)}
      >
        <Inspector
          box={box}
          pageWidthIn={trim.widthIn}
          pageHeightIn={trim.heightIn}
          ageRangeId={project.config.ageRangeId}
          readingModeId={project.config.readingModeId}
          onChange={(patch) => studio.patchBox(pageId, box.id, patch)}
          onDelete={() => studio.deleteBox(pageId, box.id)}
          onDuplicate={() => studio.duplicateBox(pageId, box.id)}
        />
      </PanelShell>
    );
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
          onChange={(patch) => studio.patchShape(pageId, shape.id, patch)}
          onDelete={() => studio.deleteShape(pageId, shape.id)}
          onDuplicate={() => studio.duplicateShape(pageId, shape.id)}
          onAlign={(edge) => studio.alignShape(pageId, shape.id, edge)}
        />
      </PanelShell>
    );
  }

  if (selection.kind === "image" && studio.selectedImage) {
    const image = studio.selectedImage;
    const pageId = selection.pageId;
    return (
      <PanelShell
        icon={<ImageIcon className="size-4" />}
        title={image.kind === "illustration" ? "Illustration" : "Image"}
        subtitle={studio.pages.find((p) => p.id === pageId)?.label}
        onClose={() => dismiss(pageId)}
      >
        <ImageInspector
          image={image}
          onChange={(patch) => studio.patchImage(pageId, image.id, patch)}
          onDelete={() => studio.deleteImage(pageId, image.id)}
          onDuplicate={() => studio.duplicateImage(pageId, image.id)}
          onAlign={(edge) => studio.alignImage(pageId, image.id, edge)}
        />
      </PanelShell>
    );
  }

  if (wantLayers && activePageId) {
    return (
      <PanelShell
        icon={<LayersIcon className="size-4" />}
        title="Layers"
        subtitle={studio.pages.find((p) => p.id === activePageId)?.label}
        onClose={onClose}
      >
        <div className="p-4">
          <LayersPanel pageId={activePageId} />
        </div>
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
}

/** Reorderable list of all elements on the page (top of stack first). */
function LayersPanel({ pageId }: { pageId: string }) {
  const studio = useStudio();
  const pd = studio.pageDesign(pageId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const rows: LayerRow[] = [
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
      label: im.name?.trim() || (im.kind === "illustration" ? "Illustration" : "Image"),
      hidden: im.hidden,
      locked: im.locked,
    })),
  ].sort((a, b) => b.z - a.z);

  if (rows.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-ink-400">
        Nothing on this page yet — add text from the toolbar above the page.
      </p>
    );
  }

  const selectedId =
    studio.selection.kind === "box"
      ? studio.selection.boxId
      : studio.selection.kind === "shape"
        ? studio.selection.shapeId
        : studio.selection.kind === "image"
          ? studio.selection.imageId
          : null;

  function selectRow(row: LayerRow) {
    if (row.kind === "text") studio.select({ kind: "box", pageId, boxId: row.id, span: null });
    else if (row.kind === "shape") studio.select({ kind: "shape", pageId, shapeId: row.id });
    else studio.select({ kind: "image", pageId, imageId: row.id });
  }

  const Icon = { text: Type, shape: Shapes, image: ImageIcon };

  function rowIdAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest("[data-layer-id]") as HTMLElement | null;
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
    <div className="space-y-1">
      {rows.length > 1 && (
        <p className="px-0.5 pb-1 text-[11px] text-ink-400">Drag to reorder — the top item sits in front.</p>
      )}
      {rows.map((row) => {
        const RowIcon = Icon[row.kind];
        const dragging = dragId === row.id;
        return (
          <div key={row.id} data-layer-id={row.id} className={cn("relative transition", dragging && "opacity-40")}>
            {overId === row.id && dragId && (
              <span className="pointer-events-none absolute inset-x-1 -top-0.5 z-10 h-0.5 rounded-full bg-brand-500" />
            )}
            <div
              className={cn(
                "group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 text-xs transition",
                selectedId === row.id ? "border-brand-300 bg-brand-50" : "border-ink-100 hover:bg-ink-50",
              )}
            >
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragId(row.id);
                }}
                onPointerMove={(e) => dragging && handleMove(e.clientX, e.clientY)}
                onPointerUp={(e) => dragging && handleUp(e.clientX, e.clientY)}
                onPointerCancel={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                title="Drag to reorder"
                className="shrink-0 cursor-grab touch-none rounded p-0.5 text-ink-300 transition hover:text-ink-600 active:cursor-grabbing"
              >
                <GripVertical className="size-3.5" />
              </button>
              <button onClick={() => selectRow(row)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                <RowIcon className="size-3.5 shrink-0 text-ink-400" />
                <span className={cn("truncate", row.hidden ? "text-ink-300 line-through" : "text-ink-700")}>
                  {row.label}
                </span>
              </button>
              <button
                title={row.hidden ? "Show" : "Hide"}
                onClick={() => studio.setLayerHidden(pageId, row.id, !row.hidden)}
                className="rounded p-0.5 text-ink-400 transition hover:text-ink-700"
              >
                {row.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              <button
                title={row.locked ? "Unlock" : "Lock"}
                onClick={() => studio.setLayerLocked(pageId, row.id, !row.locked)}
                className="rounded p-0.5 text-ink-400 transition hover:text-ink-700"
              >
                {row.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Whether the floating panel has anything to show right now. */
export function elementPanelHasContent(selection: Selection, wantLayers: boolean): boolean {
  return selection.kind === "box" || selection.kind === "shape" || selection.kind === "image" || wantLayers;
}
