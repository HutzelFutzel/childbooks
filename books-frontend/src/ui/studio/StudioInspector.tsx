import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Keyboard,
  Lock,
  MousePointerClick,
  Shapes,
  Type,
  Unlock,
} from "lucide-react";
import { textFromParagraphs } from "../../core/design";
import { bookProductForConfig } from "../../core/book";
import { cn } from "../lib/cn";
import { AnchorEditor } from "../anchors/AnchorEditor";
import { ColorField } from "../design/ColorPicker";
import { Inspector } from "../design/Inspector";
import { ImageInspector } from "../design/ImageInspector";
import { ShapeInspector } from "../design/ShapeInspector";
import { PatternPicker } from "../design/PatternPicker";
import { SHAPE_DEFS, shapePath } from "../design/shapes";
import { useStudio } from "./StudioContext";
import { useDragSource, type DragItem } from "./StudioDnd";

export function StudioInspector() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ElementPalette />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InspectorBody />
      </div>
    </div>
  );
}

/** Draggable building blocks: drag onto any page, or click to drop on the active page. */
function ElementPalette() {
  const { pages, selection, addBox, addShape } = useStudio();
  const selectedPageId =
    selection.kind === "page" ||
    selection.kind === "box" ||
    selection.kind === "shape" ||
    selection.kind === "image"
      ? selection.pageId
      : undefined;
  const fallbackPageId = selectedPageId ?? pages[0]?.id;

  return (
    <section className="border-b border-ink-100 p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        Add elements
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        <PaletteTile
          getItem={() => ({ type: "text", label: "Text" })}
          onClick={fallbackPageId ? () => addBox(fallbackPageId) : undefined}
          label="Text"
        >
          <Type className="size-4 text-ink-500" />
        </PaletteTile>
        {SHAPE_DEFS.map((def) => (
          <PaletteTile
            key={def.id}
            getItem={() => ({ type: "shape", kind: def.id, label: def.label })}
            onClick={fallbackPageId ? () => addShape(fallbackPageId, def.id) : undefined}
            label={def.label}
          >
            <svg width={20} height={20} viewBox="0 0 20 20" style={{ overflow: "visible" }}>
              <path
                d={shapePath(def.id, 16, 16, { corner: 0.18, points: 5, tailX: 0.3, tailY: 1.12 })}
                transform="translate(2 2)"
                fill="rgba(71,85,105,0.85)"
              />
            </svg>
          </PaletteTile>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-400">Drag onto a page, or click to drop it in.</p>
      <ShortcutsHint />
    </section>
  );
}

function PaletteTile({
  getItem,
  onClick,
  label,
  children,
}: {
  getItem: () => DragItem;
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const drag = useDragSource(getItem, onClick);
  return (
    <button
      {...drag}
      title={label}
      className="flex aspect-square cursor-grab touch-none items-center justify-center rounded-lg border border-ink-200 bg-white transition hover:border-brand-300 hover:bg-brand-50 active:cursor-grabbing"
    >
      {children}
    </button>
  );
}

function ShortcutsHint() {
  const rows: [string, string][] = [
    ["Copy / paste", "⌘C  ⌘V"],
    ["Cut / duplicate", "⌘X  ⌘D"],
    ["Delete", "⌫"],
    ["Nudge (large)", "↑↓←→  ⇧"],
    ["Send back / forward", "[  ]"],
    ["Undo / redo", "⌘Z  ⇧⌘Z"],
    ["Deselect", "Esc"],
  ];
  return (
    <details className="mt-3 rounded-lg bg-ink-50 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-ink-500">
        <Keyboard className="size-3.5" /> Keyboard shortcuts
      </summary>
      <ul className="mt-2 space-y-1">
        {rows.map(([label, keys]) => (
          <li
            key={label}
            className="flex items-center justify-between gap-3 text-[11px] text-ink-500"
          >
            <span>{label}</span>
            <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-600 ring-1 ring-inset ring-ink-200">
              {keys}
            </kbd>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The contextual editor for whatever is currently selected. */
function InspectorBody() {
  const studio = useStudio();
  const { selection, project } = studio;

  if (selection.kind === "box" && studio.selectedBox) {
    const box = studio.selectedBox;
    const pageId = selection.pageId;
    const trim = bookProductForConfig(project.config).trim;
    return (
      <Inspector
        box={box}
        selectedSpan={selection.span}
        pageWidthIn={trim.widthIn}
        pageHeightIn={trim.heightIn}
        onChange={(patch) => studio.patchBox(pageId, box.id, patch)}
        onChangeSpan={(ref, patch) => studio.patchSpan(pageId, box.id, ref, patch)}
        onDelete={() => studio.deleteBox(pageId, box.id)}
        onDuplicate={() => studio.duplicateBox(pageId, box.id)}
        onAlign={(edge) => studio.alignBox(pageId, box.id, edge)}
        onFitText={() => studio.fitTextToBox(pageId, box.id)}
        onFitBox={() => studio.fitBoxToText(pageId, box.id)}
        onToggleAutoFit={() => studio.toggleAutoFit(pageId, box.id)}
        onToggleAutoFitGrow={() => studio.toggleAutoFitGrow(pageId, box.id)}
      />
    );
  }

  if (selection.kind === "shape" && studio.selectedShape) {
    const shape = studio.selectedShape;
    const pageId = selection.pageId;
    return (
      <ShapeInspector
        shape={shape}
        onChange={(patch) => studio.patchShape(pageId, shape.id, patch)}
        onDelete={() => studio.deleteShape(pageId, shape.id)}
        onDuplicate={() => studio.duplicateShape(pageId, shape.id)}
        onAlign={(edge) => studio.alignShape(pageId, shape.id, edge)}
      />
    );
  }

  if (selection.kind === "image" && studio.selectedImage) {
    const image = studio.selectedImage;
    const pageId = selection.pageId;
    return (
      <ImageInspector
        image={image}
        onChange={(patch) => studio.patchImage(pageId, image.id, patch)}
        onDelete={() => studio.deleteImage(pageId, image.id)}
        onDuplicate={() => studio.duplicateImage(pageId, image.id)}
        onAlign={(edge) => studio.alignImage(pageId, image.id, edge)}
      />
    );
  }

  if (selection.kind === "anchor") {
    const anchor = project.anchors?.find((a) => a.id === selection.anchorId);
    if (!anchor) return <EmptyInspector />;
    return (
      <div className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-900">
          <ImageIcon className="size-4 text-brand-500" /> {anchor.name}
        </h3>
        <AnchorEditor
          anchor={anchor}
          generating={studio.generatingAnchors.has(anchor.id)}
          setGenerating={(v) => studio.setAnchorGenerating(anchor.id, v)}
        />
      </div>
    );
  }

  if (selection.kind === "page") {
    const pd = studio.pageDesign(selection.pageId);
    const page = studio.pages.find((p) => p.id === selection.pageId);
    const hasIllustrationEl = (pd.images ?? []).some((im) => im.kind === "illustration");
    return (
      <div className="space-y-5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
          <Type className="size-4 text-brand-500" /> {page?.label ?? "Page"}
        </h3>
        <p className="text-xs text-ink-400">
          Click a text box on the page to style it, or add one from the page's toolbar.
        </p>

        {page?.blobId && !hasIllustrationEl && (
          <button
            onClick={() => studio.makeIllustrationEditable(selection.pageId)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-xs font-medium text-ink-600 transition hover:border-brand-300 hover:bg-brand-50"
          >
            <ImageIcon className="size-4" /> Reposition / resize illustration
          </button>
        )}

        <LayersPanel pageId={selection.pageId} />

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Page background
          </p>
          <ColorField
            label="Fill"
            value={pd.background?.color ?? "rgba(255,255,255,0)"}
            onChange={(color) => studio.setPageBackground(selection.pageId, { color })}
          />
          <div className="mt-2">
            <PatternPicker
              value={pd.background?.pattern}
              onChange={(pattern) => studio.setPageBackground(selection.pageId, { pattern })}
            />
          </div>
        </div>
      </div>
    );
  }

  return <EmptyInspector />;
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

  if (rows.length === 0) return null;

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

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Layers</p>
      <div className="space-y-1">
        {rows.map((row) => {
          const RowIcon = Icon[row.kind];
          return (
            <div
              key={row.id}
              className={cn(
                "group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition",
                selectedId === row.id
                  ? "border-brand-300 bg-brand-50"
                  : "border-ink-100 hover:bg-ink-50",
              )}
            >
              <button
                onClick={() => selectRow(row)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
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
              <button
                title="Bring forward"
                onClick={() => studio.moveLayer(pageId, row.id, 1)}
                className="rounded p-0.5 text-ink-400 transition hover:text-ink-700"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                title="Send back"
                onClick={() => studio.moveLayer(pageId, row.id, -1)}
                className="rounded p-0.5 text-ink-400 transition hover:text-ink-700"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <BookOpen className="size-6" />
      </span>
      <p className="text-sm font-semibold text-ink-700">Design everything in one place</p>
      <p className="max-w-60 text-xs leading-relaxed text-ink-400">
        <MousePointerClick className="mr-1 inline size-3.5" />
        Drag an element above onto a page, pick a character in the left sidebar to refine its look,
        or click a page to lay out its text, shapes and background.
      </p>
    </div>
  );
}
