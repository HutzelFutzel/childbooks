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
  Plus,
  Shapes,
  Sparkles,
  Type,
  Unlock,
  X,
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
  const { step } = useStudio();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {step === "edit" && <ElementPalette />}
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
  const targetPageId = selectedPageId ?? pages[0]?.id;
  const targetPage = pages.find((p) => p.id === targetPageId);

  return (
    <section className="border-b border-ink-100 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Add to page</p>
        {targetPage && (
          <span className="max-w-36 truncate rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-500">
            {targetPage.label}
          </span>
        )}
      </div>

      <PaletteButton
        getItem={() => ({ type: "text", label: "Text" })}
        onClick={targetPageId ? () => addBox(targetPageId) : undefined}
        icon={<Type className="size-4" />}
        label="Text box"
      />

      <p className="mb-1.5 mt-3 text-[11px] font-medium text-ink-400">Shapes &amp; bubbles</p>
      <div className="grid grid-cols-6 gap-1.5">
        {SHAPE_DEFS.map((def) => (
          <PaletteTile
            key={def.id}
            getItem={() => ({ type: "shape", kind: def.id, label: def.label })}
            onClick={targetPageId ? () => addShape(targetPageId, def.id) : undefined}
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

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-400">
        Click to drop on this page, or drag straight onto any page.
      </p>
      <ShortcutsHint />
    </section>
  );
}

/** Prominent, full-width add action (used for the primary "Text box" block). */
function PaletteButton({
  getItem,
  onClick,
  icon,
  label,
}: {
  getItem: () => DragItem;
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const drag = useDragSource(getItem, onClick);
  return (
    <button
      {...drag}
      className="flex w-full cursor-grab touch-none items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-700 shadow-soft transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 active:cursor-grabbing"
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </span>
      {label}
      <Plus className="ml-auto size-4 text-ink-300" />
    </button>
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

  const pageLabelOf = (pageId: string) =>
    studio.pages.find((p) => p.id === pageId)?.label;
  const backToPage = (pageId: string) => studio.select({ kind: "page", pageId });

  if (selection.kind === "box" && studio.selectedBox) {
    const box = studio.selectedBox;
    const pageId = selection.pageId;
    const trim = bookProductForConfig(project.config).trim;
    return (
      <>
        <ContextHeader
          icon={<Type className="size-4" />}
          title="Text box"
          subtitle={pageLabelOf(pageId)}
          onClose={() => backToPage(pageId)}
        />
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
      </>
    );
  }

  if (selection.kind === "shape" && studio.selectedShape) {
    const shape = studio.selectedShape;
    const pageId = selection.pageId;
    return (
      <>
        <ContextHeader
          icon={<Shapes className="size-4" />}
          title="Shape"
          subtitle={pageLabelOf(pageId)}
          onClose={() => backToPage(pageId)}
        />
        <ShapeInspector
          shape={shape}
          onChange={(patch) => studio.patchShape(pageId, shape.id, patch)}
          onDelete={() => studio.deleteShape(pageId, shape.id)}
          onDuplicate={() => studio.duplicateShape(pageId, shape.id)}
          onAlign={(edge) => studio.alignShape(pageId, shape.id, edge)}
        />
      </>
    );
  }

  if (selection.kind === "image" && studio.selectedImage) {
    const image = studio.selectedImage;
    const pageId = selection.pageId;
    return (
      <>
        <ContextHeader
          icon={<ImageIcon className="size-4" />}
          title={image.kind === "illustration" ? "Illustration" : "Image"}
          subtitle={pageLabelOf(pageId)}
          onClose={() => backToPage(pageId)}
        />
        <ImageInspector
          image={image}
          onChange={(patch) => studio.patchImage(pageId, image.id, patch)}
          onDelete={() => studio.deleteImage(pageId, image.id)}
          onDuplicate={() => studio.duplicateImage(pageId, image.id)}
          onAlign={(edge) => studio.alignImage(pageId, image.id, edge)}
        />
      </>
    );
  }

  if (selection.kind === "anchor") {
    const anchor = project.anchors?.find((a) => a.id === selection.anchorId);
    if (!anchor) return <EmptyInspector />;
    return (
      <>
        <ContextHeader
          icon={<ImageIcon className="size-4" />}
          title={anchor.name}
          subtitle="Character / place"
          onClose={() => studio.select({ kind: "none" })}
        />
        <div className="p-4">
          <AnchorEditor
            anchor={anchor}
            generating={studio.generatingAnchors.has(anchor.id)}
            setGenerating={(v) => studio.setAnchorGenerating(anchor.id, v)}
          />
        </div>
      </>
    );
  }

  if (selection.kind === "page") {
    const pd = studio.pageDesign(selection.pageId);
    const page = studio.pages.find((p) => p.id === selection.pageId);
    const hasIllustrationEl = (pd.images ?? []).some((im) => im.kind === "illustration");
    return (
      <>
        <ContextHeader
          icon={<BookOpen className="size-4" />}
          title={page?.label ?? "Page"}
          subtitle="Page settings"
          onClose={() => studio.select({ kind: "none" })}
        />
        <div className="space-y-5 p-4">
          <p className="text-xs leading-relaxed text-ink-400">
            Click any text box or shape on the page to style it, or add one from the panel above.
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
      </>
    );
  }

  return <EmptyInspector />;
}

/** A sticky context strip telling you what's being edited, with a way out. */
function ContextHeader({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClose?: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-ink-100 bg-white/95 px-4 py-2.5 backdrop-blur">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold text-ink-800">{title}</p>
        {subtitle && <p className="truncate text-[11px] text-ink-400">{subtitle}</p>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          title="Done"
          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
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
  const { step } = useStudio();
  if (step === "anchors") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
          <ImageIcon className="size-6" />
        </span>
        <p className="text-sm font-semibold text-ink-700">Refine a character</p>
        <p className="max-w-60 text-xs leading-relaxed text-ink-400">
          <MousePointerClick className="mr-1 inline size-3.5" />
          Pick any character or place from the gallery to generate its reference art, describe how
          it should look, or branch new versions.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <Sparkles className="size-6" />
      </span>
      <p className="text-sm font-semibold text-ink-700">Nothing selected</p>
      <p className="max-w-60 text-xs leading-relaxed text-ink-400">
        <MousePointerClick className="mr-1 inline size-3.5" />
        Click a page to set its background, tap any text or shape to style it, or add a new element
        from the panel above.
      </p>
    </div>
  );
}
