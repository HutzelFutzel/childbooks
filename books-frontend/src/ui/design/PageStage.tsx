import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus as PlusIcon } from "lucide-react";
import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type {
  ImageElement,
  NormRect,
  PageDesign,
  ShapeElement,
  TextBox,
  TextParagraph,
} from "../../core/types";
import { fontStack, loadFont } from "../typography/fonts";
import { cn } from "../lib/cn";
import { TextStyleBar, type TextStyleKey } from "./TextStyleBar";
import {
  applyInlineColor,
  applyInlineCommand,
  editorToParagraphs,
  paragraphsToHtml,
} from "./richText";
import { KonvaTextBox } from "./konva/KonvaTextBox";
import { KonvaImageElement } from "./konva/KonvaImageElement";
import { KonvaShape } from "./ShapeRender";
import { useImage } from "./konva/useImage";
import { usePatternImage } from "./konva/usePatternImage";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { getPreset } from "./presets";
import { effectiveBaseSize, fitBoxHeightPct, minContentWidthPct } from "./textFit";
import { isBubble } from "./shapes";
import type { SpanRef } from "./TextBoxView";

const MIN_PX = 16;
const SNAP_PX = 6;
/** Rotation raster: snap to every 15° (0,15,…,345) when snapping is on. */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

export type ElementKind = "text" | "shape" | "image";
export interface ElementRef {
  id: string;
  kind: ElementKind;
}
export interface GeomPatch {
  rect?: NormRect;
  rotation?: number;
  /** Speech-bubble tail target (shape elements only). */
  tailX?: number;
  tailY?: number;
  /** New target/min height for auto-height text boxes (set on resize). */
  minHeightPct?: number;
}

interface StageElement {
  id: string;
  kind: ElementKind;
  z: number;
  rect: NormRect;
  rotation?: number;
  locked?: boolean;
  hidden?: boolean;
  box?: TextBox;
  shape?: ShapeElement;
  image?: ImageElement;
}

/** Interactive, scaled page surface (Konva): image + pattern + shapes + text. */
export function PageStage({
  pageDesign,
  imageUrl,
  aspect,
  illustrationFocus,
  selectedId,
  onSelectElement,
  onChangeElement,
  onReframeImage,
  onAdjustArt,
  selectedSpan,
  onSelectSpan,
  onEditText,
  onEditRichText,
  onStyleBox,
  editable = true,
  dropId,
  showGutter = false,
  printGuides = null,
  chromeless = false,
  snap = true,
  grid = false,
  gridSize = 0.05,
  overlay,
}: {
  pageDesign: PageDesign;
  imageUrl?: string;
  aspect: number;
  /**
   * Focal point (0..1) for the full-bleed illustration's `cover` crop when the
   * generated art overflows the frame. Covers pass a top-biased focus so a
   * baked-in title near the top edge survives; defaults to centre otherwise.
   */
  illustrationFocus?: { x: number; y: number };
  selectedId: string | null;
  onSelectElement: (ref: ElementRef | null) => void;
  onChangeElement: (id: string, kind: ElementKind, patch: GeomPatch) => void;
  /**
   * Commit a non-destructive reframe (zoom + focal point) for an image element.
   * Driven by double-click "reframe" mode, which shows the hidden overflow and
   * lets the user drag to pan / scroll to zoom.
   */
  onReframeImage?: (id: string, patch: { zoom?: number; focus?: { x: number; y: number } }) => void;
  /**
   * Turn the page's full-bleed illustration into a movable element so it can be
   * repositioned. Invoked when the user double-clicks the background art (no
   * illustration element yet); the stage then auto-enters reframe on the new
   * element so "reposition the art" is a single gesture.
   */
  onAdjustArt?: () => void;
  selectedSpan?: SpanRef | null;
  onSelectSpan?: (ref: SpanRef | null) => void;
  /** Commit new plain text for a text box (double-click to edit in place). */
  onEditText?: (id: string, value: string) => void;
  /** Commit styled paragraphs (preferred; preserves per-range styling). */
  onEditRichText?: (id: string, paragraphs: TextParagraph[]) => void;
  /** Apply a whole-box style patch (used by the floating character toolbar). */
  onStyleBox?: (id: string, patch: Partial<TextBox>) => void;
  editable?: boolean;
  /** Marks the sized page surface as a drop target for the sidebar element pool. */
  dropId?: string;
  /** Draw a center fold guide (double-page spreads) so the page edge is visible. */
  showGutter?: boolean;
  /**
   * Print-safety guides: a dashed safe-area rectangle (keep text/important art
   * inside), an optional translucent gutter band on the binding side, and an
   * optional reserved barcode zone (back cover). Normalized to the page surface
   * (0..1). Null hides them.
   */
  printGuides?: {
    safe: NormRect;
    gutter: { x: number; w: number } | null;
    barcode?: NormRect | null;
  } | null;
  /** Drop the page's own frame chrome (rounding/ring/shadow) so a wrapper can
   * provide a single shared frame (e.g. two facing pages in one spread). */
  chromeless?: boolean;
  /** Snap to page/element edges & centers while dragging. */
  snap?: boolean;
  /** Show an alignment grid and snap to it. */
  grid?: boolean;
  /** Grid spacing as a fraction of page width. */
  gridSize?: number;
  /** Optional overlay rendered over the sized page surface (e.g. a generation
   *  progress overlay while the illustration is rendering). */
  overlay?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setFontTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reframeId, setReframeId] = useState<string | null>(null);
  // Screen position for the whole-box character toolbar (recomputed on scroll).
  const [boxBarPos, setBoxBarPos] = useState<{ x: number; y: number } | null>(null);
  const [liveResize, setLiveResize] = useState<{ id: string; sx: number; sy: number } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const groupRefs = useRef<Map<string, Konva.Group>>(new Map());
  const trRef = useRef<Konva.Transformer>(null);

  const image = useImage(imageUrl);
  const bgPattern = usePatternImage(pageDesign.background?.pattern);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Redraw once webfonts finish loading so glyph metrics are correct.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    const bump = () => setFontTick((t) => t + 1);
    fonts.addEventListener?.("loadingdone", bump);
    void fonts.ready?.then(bump);
    return () => fonts.removeEventListener?.("loadingdone", bump);
  }, []);

  const { w: W, h: H } = size;

  // Text boxes, shapes and images share one z-stack so they interleave naturally.
  const elements: StageElement[] = [
    ...pageDesign.textBoxes.map((b) => ({
      id: b.id,
      kind: "text" as const,
      z: b.z,
      rect: b.rect,
      rotation: b.rotation,
      locked: b.locked,
      hidden: b.hidden,
      box: b,
    })),
    ...(pageDesign.shapes ?? []).map((s) => ({
      id: s.id,
      kind: "shape" as const,
      z: s.z,
      rect: s.rect,
      rotation: s.rotation,
      locked: s.locked,
      hidden: s.hidden,
      shape: s,
    })),
    ...(pageDesign.images ?? []).map((im) => ({
      id: im.id,
      kind: "image" as const,
      z: im.z,
      rect: im.rect,
      rotation: im.rotation,
      locked: im.locked,
      hidden: im.hidden,
      image: im,
    })),
  ]
    .filter((el) => !el.hidden)
    .sort((a, b) => a.z - b.z);

  // When the generated illustration has been turned into a movable element,
  // suppress the full-bleed background so it isn't drawn twice.
  const hasIllustrationEl = (pageDesign.images ?? []).some((im) => im.kind === "illustration");

  // Keep the transformer attached to (and synced with) the selected element's
  // group. Re-running on any design change also refreshes the handle box after
  // inspector-driven edits (align/resize/rotate).
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      editable && selectedId && selectedId !== editingId && selectedId !== reframeId
        ? groupRefs.current.get(selectedId) ?? null
        : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [editable, selectedId, editingId, reframeId, W, H, pageDesign]);

  // Leaving a page / losing edit rights cancels any in-progress reframe.
  useEffect(() => {
    if (!editable) setReframeId(null);
  }, [editable]);

  // Double-clicking the background art asks the host to materialize the
  // illustration as a movable element; once it appears we auto-enter reframe so
  // repositioning the art is a single gesture rather than a multi-step flow.
  const pendingReframe = useRef(false);
  function requestAdjustArt() {
    if (!editable || !onAdjustArt || !imageUrl || hasIllustrationEl) return;
    pendingReframe.current = true;
    onAdjustArt();
  }
  useEffect(() => {
    if (!pendingReframe.current) return;
    const illus = (pageDesign.images ?? []).find((im) => im.kind === "illustration");
    if (illus && illus.fit !== "contain") {
      pendingReframe.current = false;
      setReframeId(illus.id);
    }
  }, [pageDesign]);

  // Preload fonts used anywhere on the page.
  useEffect(() => {
    for (const b of pageDesign.textBoxes) {
      loadFont(b.fontFamily);
      b.paragraphs.forEach((p) => p.spans.forEach((s) => s.fontFamily && loadFont(s.fontFamily)));
    }
  }, [pageDesign.textBoxes]);

  const imageCrop = image
    ? coverCrop(
        image.naturalWidth || image.width,
        image.naturalHeight || image.height,
        W,
        H,
        illustrationFocus,
      )
    : undefined;

  function clearSelection() {
    onSelectElement(null);
    onSelectSpan?.(null);
  }

  const editingBox = editingId
    ? pageDesign.textBoxes.find((b) => b.id === editingId)
    : undefined;

  // Minimum width (px) the selected text box may be resized to before words start
  // clipping — keeps resize from squeezing a box narrower than its content.
  const selectedTextBox =
    editable && selectedId ? pageDesign.textBoxes.find((b) => b.id === selectedId) : undefined;
  const selMinWidthPx =
    selectedTextBox && W > 0 ? minContentWidthPct(selectedTextBox, aspect) * W : 0;
  // Auto-height boxes can't be dragged shorter than their text — the min height
  // is the content height at the current font.
  const selMinHeightPx =
    selectedTextBox?.autoHeight && H > 0 ? fitBoxHeightPct(selectedTextBox, aspect) * H : 0;

  // The whole-box character toolbar shows whenever a text box is selected but
  // not being edited in place (editing shows the word-level toolbar instead).
  const showBoxBar = Boolean(
    editable && selectedTextBox && onStyleBox && editingId !== selectedId,
  );
  const boxBarId = showBoxBar ? selectedId : null;
  useEffect(() => {
    if (!boxBarId) {
      setBoxBarPos(null);
      return;
    }
    const update = () => {
      const container = containerRef.current;
      const node = groupRefs.current.get(boxBarId);
      const stage = node?.getStage();
      if (!container || !node || !stage) {
        setBoxBarPos(null);
        return;
      }
      const b = node.getClientRect({ relativeTo: stage });
      const r = container.getBoundingClientRect();
      setBoxBarPos({ x: r.left + b.x + b.width / 2, y: r.top + b.y });
    };
    update();
    // Scroll events don't bubble, so listen in the capture phase to catch the
    // canvas scroller (and any ancestor) without wiring each one up manually.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [boxBarId, W, H, pageDesign]);

  // Style state for the whole-box toolbar: a mark is "active" only when every
  // span carries it, "mixed" when some do — mirroring word processors.
  const boxSpans = (selectedTextBox?.paragraphs.flatMap((p) => p.spans) ?? []).filter(
    (s) => s.text.length > 0,
  );
  const spanAll = (fn: (s: (typeof boxSpans)[number]) => boolean) =>
    boxSpans.length > 0 && boxSpans.every(fn);
  const spanSome = (fn: (s: (typeof boxSpans)[number]) => boolean) =>
    boxSpans.some(fn);
  const boxHasWordOverrides = boxSpans.some(
    (s) => s.color !== undefined || (s.sizeMul !== undefined && s.sizeMul !== 1),
  );

  const toggleBoxStyle = (key: TextStyleKey) => {
    if (!selectedTextBox || !onStyleBox) return;
    const next = !spanAll((s) => Boolean(s[key]));
    onStyleBox(selectedTextBox.id, {
      paragraphs: selectedTextBox.paragraphs.map((p) => ({
        ...p,
        spans: p.spans.map((s) => ({ ...s, [key]: next })),
      })),
    });
  };
  const setBoxColor = (color: string) => {
    if (!selectedTextBox || !onStyleBox) return;
    // Box colour is authoritative: clear per-word colours so it applies evenly.
    onStyleBox(selectedTextBox.id, {
      color,
      paragraphs: selectedTextBox.paragraphs.map((p) => ({
        ...p,
        spans: p.spans.map((s) => ({ ...s, color: undefined })),
      })),
    });
  };
  const resetBoxWordStyles = () => {
    if (!selectedTextBox || !onStyleBox) return;
    onStyleBox(selectedTextBox.id, {
      paragraphs: selectedTextBox.paragraphs.map((p) => ({
        ...p,
        spans: p.spans.map((s) => ({ ...s, color: undefined, sizeMul: undefined })),
      })),
    });
  };

  const reframeEl = reframeId
    ? (pageDesign.images ?? []).find((im) => im.id === reframeId)
    : undefined;

  /**
   * Snap a dragged element's center (px) to the page's edges/center, the grid,
   * or sibling edges/centers. Returns the adjusted center plus guide lines to
   * draw. Rotation is ignored for snapping (axis-aligned bounds).
   */
  function snapDrag(el: StageElement, cx: number, cy: number) {
    const wPx = el.rect.w * W;
    const hPx = el.rect.h * H;
    let nx = cx;
    let ny = cy;
    const gx: number[] = [];
    const gy: number[] = [];

    if (grid) {
      const stepX = gridSize * W;
      const stepY = gridSize * W; // square cells
      nx = Math.round((cx - wPx / 2) / stepX) * stepX + wPx / 2;
      ny = Math.round((cy - hPx / 2) / stepY) * stepY + hPx / 2;
      return { x: nx, y: ny, gx, gy };
    }
    if (!snap) return { x: cx, y: cy, gx, gy };

    const targetsX = [0, W / 2, W];
    const targetsY = [0, H / 2, H];
    for (const other of elements) {
      if (other.id === el.id) continue;
      const ow = other.rect.w * W;
      const oh = other.rect.h * H;
      const ocx = (other.rect.x + other.rect.w / 2) * W;
      const ocy = (other.rect.y + other.rect.h / 2) * H;
      targetsX.push(ocx - ow / 2, ocx, ocx + ow / 2);
      targetsY.push(ocy - oh / 2, ocy, ocy + oh / 2);
    }

    let bestX = SNAP_PX + 1;
    for (const edge of [-wPx / 2, 0, wPx / 2]) {
      for (const t of targetsX) {
        const d = t - (cx + edge);
        if (Math.abs(d) < Math.abs(bestX)) {
          bestX = d;
          gx[0] = t;
        }
      }
    }
    if (Math.abs(bestX) <= SNAP_PX) nx = cx + bestX;
    else gx.length = 0;

    let bestY = SNAP_PX + 1;
    for (const edge of [-hPx / 2, 0, hPx / 2]) {
      for (const t of targetsY) {
        const d = t - (cy + edge);
        if (Math.abs(d) < Math.abs(bestY)) {
          bestY = d;
          gy[0] = t;
        }
      }
    }
    if (Math.abs(bestY) <= SNAP_PX) ny = cy + bestY;
    else gy.length = 0;

    return { x: nx, y: ny, gx, gy };
  }

  return (
    <div className="flex w-full items-center justify-center">
      <div
        ref={containerRef}
        data-page-drop={dropId}
        data-editor-surface=""
        className={cn(
          "relative max-h-[70vh] w-full overflow-hidden bg-white",
          !chromeless && "rounded-xl shadow-soft ring-1 ring-ink-200",
        )}
        style={{ aspectRatio: String(aspect) }}
      >
        {W > 0 && H > 0 && (
          <Stage
            width={W}
            height={H}
            onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
              if (e.target === e.target.getStage()) clearSelection();
            }}
            onTouchStart={(e: KonvaEventObject<TouchEvent>) => {
              if (e.target === e.target.getStage()) clearSelection();
            }}
            onDblClick={(e: KonvaEventObject<MouseEvent>) => {
              if (e.target === e.target.getStage()) requestAdjustArt();
            }}
            onDblTap={(e: KonvaEventObject<Event>) => {
              if (e.target === e.target.getStage()) requestAdjustArt();
            }}
          >
            <Layer>
              {pageDesign.background?.color && (
                <Rect width={W} height={H} fill={pageDesign.background.color} listening={false} />
              )}
              {pageDesign.background?.pattern && bgPattern && (
                <Rect
                  width={W}
                  height={H}
                  fillPatternImage={bgPattern.image}
                  fillPatternRepeat="repeat"
                  fillPatternScale={{
                    x: pageDesign.background.pattern.scale || 1,
                    y: pageDesign.background.pattern.scale || 1,
                  }}
                  fillPatternRotation={pageDesign.background.pattern.rotation || 0}
                  opacity={pageDesign.background.pattern.opacity ?? 1}
                  listening={false}
                />
              )}
              {image && imageCrop && !hasIllustrationEl && (
                <KonvaImage image={image} width={W} height={H} crop={imageCrop} listening={false} />
              )}

              {grid &&
                gridLines(W, H, gridSize).map((ln, i) => (
                  <Line
                    key={`grid-${i}`}
                    points={ln}
                    stroke="rgba(99,102,241,0.12)"
                    strokeWidth={1}
                    listening={false}
                  />
                ))}

              {elements.map((el) => {
                const rect = el.rect;
                const w = rect.w * W;
                const h = rect.h * H;
                const opacity =
                  el.kind === "text"
                    ? el.box?.effects?.opacity ?? 1
                    : el.kind === "image"
                      ? el.image?.opacity ?? el.image?.effects?.opacity ?? 1
                      : 1;
                const select = () => {
                  if (selectedId !== el.id) onSelectSpan?.(null);
                  onSelectElement({ id: el.id, kind: el.kind });
                };
                return (
                  <Group
                    key={el.id}
                    ref={(node) => {
                      if (node) groupRefs.current.set(el.id, node);
                      else groupRefs.current.delete(el.id);
                    }}
                    x={(rect.x + rect.w / 2) * W}
                    y={(rect.y + rect.h / 2) * H}
                    offsetX={w / 2}
                    offsetY={h / 2}
                    rotation={el.rotation ?? 0}
                    opacity={opacity}
                    draggable={editable && !el.locked && reframeId !== el.id}
                    onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
                      e.cancelBubble = true;
                      select();
                    }}
                    onTap={(e: KonvaEventObject<Event>) => {
                      e.cancelBubble = true;
                      select();
                    }}
                    onDblClick={(e: KonvaEventObject<MouseEvent>) => {
                      if (el.locked || !editable) return;
                      if (el.image && el.image.fit !== "contain" && onReframeImage) {
                        e.cancelBubble = true;
                        select();
                        setReframeId(el.id);
                        return;
                      }
                      if (!el.box || !(onEditText || onEditRichText)) return;
                      e.cancelBubble = true;
                      select();
                      setEditingId(el.id);
                    }}
                    onDblTap={(e: KonvaEventObject<Event>) => {
                      if (el.locked || !editable) return;
                      if (el.image && el.image.fit !== "contain" && onReframeImage) {
                        e.cancelBubble = true;
                        select();
                        setReframeId(el.id);
                        return;
                      }
                      if (!el.box || !(onEditText || onEditRichText)) return;
                      e.cancelBubble = true;
                      select();
                      setEditingId(el.id);
                    }}
                    onDragMove={(e: KonvaEventObject<DragEvent>) => {
                      if (!editable) return;
                      const node = e.target;
                      const { x, y, gx, gy } = snapDrag(el, node.x(), node.y());
                      node.x(x);
                      node.y(y);
                      setGuides({ x: gx, y: gy });
                    }}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                      const node = e.target;
                      setGuides({ x: [], y: [] });
                      onChangeElement(el.id, el.kind, {
                        rect: {
                          ...rect,
                          x: node.x() / W - rect.w / 2,
                          y: node.y() / H - rect.h / 2,
                        },
                      });
                    }}
                    onTransform={(e: KonvaEventObject<Event>) => {
                      // While *resizing* a text box, capture the live scale so the
                      // words reflow at constant size against the new box (handled
                      // by KonvaTextBox's counter-scale). We never touch the node's
                      // transform here, so the Transformer keeps owning position +
                      // scale and there's no jitter. Pure rotation (scale == 1) is
                      // ignored to avoid needless re-renders mid-rotation.
                      if (el.kind !== "text") return;
                      const node = e.target as Konva.Group;
                      const sx = node.scaleX();
                      const sy = node.scaleY();
                      if (sx === 1 && sy === 1) return;
                      setLiveResize((prev) =>
                        prev && prev.id === el.id && prev.sx === sx && prev.sy === sy
                          ? prev
                          : { id: el.id, sx, sy },
                      );
                    }}
                    onTransformEnd={(e: KonvaEventObject<Event>) => {
                      // The transformer scales the node; convert that scale into a
                      // new normalized rect and reset the node scale to 1. Text then
                      // reflows at a constant font size (size is page-relative, not
                      // scaled), while shapes/images keep their new dimensions.
                      setLiveResize(null);
                      const node = e.target as Konva.Group;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      const newW = Math.max(MIN_PX, rect.w * W * scaleX);
                      const newH = Math.max(MIN_PX, rect.h * H * scaleY);
                      node.scaleX(1);
                      node.scaleY(1);
                      onChangeElement(el.id, el.kind, {
                        rotation: node.rotation(),
                        rect: {
                          x: node.x() / W - newW / W / 2,
                          y: node.y() / H - newH / H / 2,
                          w: newW / W,
                          h: newH / H,
                        },
                        // For auto-height boxes a *vertical* drag sets the new target
                        // floor (room to breathe); patchBox keeps the rendered height
                        // at max(target, content). Width-only drags leave the floor
                        // alone so re-wrapping can still shrink the box to its text.
                        ...(el.box?.autoHeight && scaleY !== 1
                          ? { minHeightPct: newH / H }
                          : {}),
                      });
                    }}
                  >
                    {el.box ? (
                      (() => {
                        const live = liveResize?.id === el.id ? liveResize : null;
                        const sx = live ? live.sx : 1;
                        const sy = live ? live.sy : 1;
                        // During a live resize, fit against the visual (scaled)
                        // box so auto-fit grows/shrinks the font in real time.
                        const fitBox = live
                          ? { ...el.box, rect: { ...el.box.rect, w: el.box.rect.w * sx, h: el.box.rect.h * sy } }
                          : el.box;
                        return (
                          <KonvaTextBox
                            box={el.box}
                            w={w}
                            h={h}
                            baseSize={effectiveBaseSize(fitBox, aspect, H)}
                            pageHeight={H}
                            hideText={editable && editingId === el.id}
                            showOverflow={editable}
                            liveScaleX={sx}
                            liveScaleY={sy}
                            selectedSpan={selectedId === el.id ? selectedSpan : null}
                          />
                        );
                      })()
                    ) : el.shape ? (
                      <KonvaShape shape={el.shape} w={w} h={h} pageHeight={H} />
                    ) : el.image ? (
                      <KonvaImageElement
                        el={el.image}
                        w={w}
                        h={h}
                        pageHeight={H}
                        illustrationUrl={imageUrl}
                      />
                    ) : null}

                    {editable &&
                      !el.locked &&
                      selectedId === el.id &&
                      el.shape &&
                      isBubble(el.shape.kind) && (
                        <Circle
                          x={(el.shape.tailX ?? 0.3) * w}
                          y={(el.shape.tailY ?? 1.32) * h}
                          radius={7}
                          fill="#fff"
                          stroke="rgba(99,102,241,0.95)"
                          strokeWidth={2}
                          shadowColor="black"
                          shadowOpacity={0.25}
                          shadowBlur={4}
                          draggable
                          onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
                            e.cancelBubble = true;
                          }}
                          onDragStart={(e: KonvaEventObject<DragEvent>) => {
                            e.cancelBubble = true;
                          }}
                          onDragMove={(e: KonvaEventObject<DragEvent>) => {
                            e.cancelBubble = true;
                            const node = e.target;
                            onChangeElement(el.id, "shape", {
                              tailX: node.x() / w,
                              tailY: node.y() / h,
                            });
                          }}
                          onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                            e.cancelBubble = true;
                          }}
                        />
                      )}
                  </Group>
                );
              })}

              {(guides.x.length > 0 || guides.y.length > 0) && (
                <>
                  {guides.x.map((gx, i) => (
                    <Line
                      key={`gx-${i}`}
                      points={[gx, 0, gx, H]}
                      stroke="rgba(236,72,153,0.9)"
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                  {guides.y.map((gy, i) => (
                    <Line
                      key={`gy-${i}`}
                      points={[0, gy, W, gy]}
                      stroke="rgba(236,72,153,0.9)"
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                </>
              )}

              {printGuides && W > 0 && H > 0 && (
                <>
                  {printGuides.gutter && (
                    <Rect
                      x={printGuides.gutter.x * W}
                      y={0}
                      width={printGuides.gutter.w * W}
                      height={H}
                      fill="rgba(244,63,94,0.10)"
                      listening={false}
                    />
                  )}
                  <Rect
                    x={printGuides.safe.x * W}
                    y={printGuides.safe.y * H}
                    width={printGuides.safe.w * W}
                    height={printGuides.safe.h * H}
                    stroke="rgba(16,185,129,0.85)"
                    strokeWidth={1}
                    dash={[6, 5]}
                    listening={false}
                  />
                  {printGuides.barcode && (
                    <>
                      <Rect
                        x={printGuides.barcode.x * W}
                        y={printGuides.barcode.y * H}
                        width={printGuides.barcode.w * W}
                        height={printGuides.barcode.h * H}
                        fill="rgba(15,23,42,0.06)"
                        stroke="rgba(15,23,42,0.45)"
                        strokeWidth={1}
                        dash={[4, 4]}
                        listening={false}
                      />
                      <Text
                        x={printGuides.barcode.x * W}
                        y={printGuides.barcode.y * H}
                        width={printGuides.barcode.w * W}
                        height={printGuides.barcode.h * H}
                        text={"Barcode area\n(reserved)"}
                        align="center"
                        verticalAlign="middle"
                        fontSize={11}
                        fill="rgba(15,23,42,0.55)"
                        listening={false}
                      />
                    </>
                  )}
                </>
              )}

              {showGutter && W > 0 && H > 0 && (
                <>
                  <Line
                    points={[W / 2, 0, W / 2, H]}
                    stroke="rgba(255,255,255,0.65)"
                    strokeWidth={2}
                    listening={false}
                  />
                  <Line
                    points={[W / 2, 0, W / 2, H]}
                    stroke="rgba(15,23,42,0.45)"
                    strokeWidth={1}
                    dash={[7, 7]}
                    listening={false}
                  />
                </>
              )}

              {editable && (
                <Transformer
                  ref={trRef}
                  rotateEnabled
                  // Snap rotation to 15° increments while snapping is enabled;
                  // values near a multiple of 15 within the tolerance lock on,
                  // anything else rotates freely.
                  rotationSnaps={snap ? ROTATION_SNAPS : []}
                  rotationSnapTolerance={7}
                  keepRatio={false}
                  flipEnabled={false}
                  ignoreStroke
                  anchorSize={9}
                  anchorCornerRadius={2}
                  borderStroke="rgba(99,102,241,0.9)"
                  anchorStroke="rgba(99,102,241,0.9)"
                  boundBoxFunc={(oldBox, newBox) => {
                    const minW = Math.max(MIN_PX, selMinWidthPx);
                    const minH = Math.max(MIN_PX, selMinHeightPx);
                    if (newBox.width < minW || newBox.height < minH) return oldBox;
                    return newBox;
                  }}
                />
              )}
            </Layer>
          </Stage>
        )}

        {editable && editingBox && W > 0 && H > 0 && (
          <InlineTextEditor
            box={editingBox}
            W={W}
            H={H}
            baseSize={effectiveBaseSize(editingBox, aspect, H)}
            onCommit={(paragraphs) => {
              if (onEditRichText) onEditRichText(editingBox.id, paragraphs);
              else onEditText?.(editingBox.id, paragraphs.map((p) => p.spans.map((s) => s.text).join("")).join("\n\n"));
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
          />
        )}

        {editable && reframeEl && onReframeImage && W > 0 && H > 0 && (
          <ReframeOverlay
            el={reframeEl}
            W={W}
            H={H}
            illustrationUrl={imageUrl}
            onChange={(patch) => onReframeImage(reframeEl.id, patch)}
            onDone={() => setReframeId(null)}
          />
        )}

        {overlay}
      </div>

      {showBoxBar && boxBarPos && selectedTextBox && (
        <TextStyleBar
          x={boxBarPos.x}
          y={boxBarPos.y}
          scopeLabel="Whole text box"
          bold={spanAll((s) => Boolean(s.bold))}
          italic={spanAll((s) => Boolean(s.italic))}
          underline={spanAll((s) => Boolean(s.underline))}
          boldMixed={spanSome((s) => Boolean(s.bold)) && !spanAll((s) => Boolean(s.bold))}
          italicMixed={spanSome((s) => Boolean(s.italic)) && !spanAll((s) => Boolean(s.italic))}
          underlineMixed={
            spanSome((s) => Boolean(s.underline)) && !spanAll((s) => Boolean(s.underline))
          }
          color={selectedTextBox.color}
          onToggle={toggleBoxStyle}
          onColor={setBoxColor}
          onReset={boxHasWordOverrides ? resetBoxWordStyles : undefined}
        />
      )}
    </div>
  );
}

/**
 * In-place text editor that renders with the *exact* same styling as the result
 * renderer (chrome stays on the canvas behind it; this only owns the words), so
 * editing is true WYSIWYG: same font, size, color, alignment, padding and
 * preset text style as the printed page.
 */
function InlineTextEditor({
  box,
  W,
  H,
  baseSize,
  onCommit,
  onCancel,
}: {
  box: TextBox;
  W: number;
  H: number;
  baseSize: number;
  onCommit: (paragraphs: TextParagraph[]) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [toolbar, setToolbar] = useState<{
    x: number;
    y: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
  } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = paragraphsToHtml(box.paragraphs);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show a formatting toolbar above any non-collapsed selection in the editor.
  useEffect(() => {
    const onSel = () => {
      const el = ref.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setToolbar(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        setToolbar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setToolbar({
        x: rect.left + rect.width / 2,
        y: rect.top,
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    if (commit && ref.current) onCommit(editorToParagraphs(ref.current));
    else onCancel();
  }

  const preset = getPreset(box.presetId);
  const colors = {
    fill: box.fill ?? preset.defaults.fill,
    stroke: box.stroke ?? preset.defaults.stroke,
    text: box.color,
  };
  const boxW = box.rect.w * W;
  const boxH = box.rect.h * H;
  const pad = (box.padding ?? preset.padding) * Math.min(boxW, boxH);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.rect.x * W,
          top: box.rect.y * H,
          width: box.rect.w * W,
          height: box.rect.h * H,
          transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
          transformOrigin: "center center",
          boxShadow: "0 0 0 2px rgba(99,102,241,0.9)",
          borderRadius: 4,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent:
              box.vAlign === "top" ? "flex-start" : box.vAlign === "bottom" ? "flex-end" : "center",
            alignItems:
              box.align === "left" ? "flex-start" : box.align === "right" ? "flex-end" : "center",
            padding: pad,
            overflow: "hidden",
          }}
        >
          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
                ref.current?.blur();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                finish(true);
                ref.current?.blur();
              }
              e.stopPropagation();
            }}
            style={{
              width: "100%",
              margin: 0,
              outline: "none",
              textAlign: box.align,
              color: colors.text,
              fontFamily: fontStack(box.fontFamily),
              fontSize: baseSize,
              lineHeight: String(box.lineHeight),
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              cursor: "text",
              caretColor: colors.text,
              ...(preset.textStyle?.(colors) ?? {}),
            }}
          />
        </div>
      </div>
      {toolbar && (
        <TextStyleBar
          x={toolbar.x}
          y={toolbar.y}
          scopeLabel="Selected words"
          bold={toolbar.bold}
          italic={toolbar.italic}
          underline={toolbar.underline}
          color={box.color}
          onToggle={(key) => {
            applyInlineCommand(key);
            ref.current?.focus();
          }}
          onColor={(c) => {
            applyInlineColor(c);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}

/**
 * Drag-to-reframe overlay for a "Fill" image: renders the full bitmap ghosted
 * so the user can see what's cropped, with the in-frame slice at full opacity.
 * Drag pans the focal point; the wheel (or the on-screen buttons) zooms. This is
 * a non-destructive crop — only `zoom`/`focus` change, never the rect.
 */
function ReframeOverlay({
  el,
  W,
  H,
  illustrationUrl,
  onChange,
  onDone,
}: {
  el: ImageElement;
  W: number;
  H: number;
  illustrationUrl?: string;
  onChange: (patch: { zoom?: number; focus?: { x: number; y: number } }) => void;
  onDone: () => void;
}) {
  const assetUrl = useBlobUrl(el.kind === "asset" ? el.blobId : undefined);
  const url = el.kind === "illustration" ? illustrationUrl : assetUrl ?? undefined;
  const image = useImage(url);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onDone();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDone]);

  const fx = el.focus?.x ?? 0.5;
  const fy = el.focus?.y ?? 0.5;
  const zoom = Math.max(1, el.zoom ?? 1);

  // Frame rect in stage px.
  const fw = el.rect.w * W;
  const fh = el.rect.h * H;
  const fl = el.rect.x * W;
  const ft = el.rect.y * H;

  const iw = image ? image.naturalWidth || image.width : 0;
  const ih = image ? image.naturalHeight || image.height : 0;
  const coverScale = iw && ih ? Math.max(fw / iw, fh / ih) : 1;
  const scale = coverScale * zoom;
  const dw = iw * scale; // displayed (ghost) bitmap size in px
  const dh = ih * scale;
  // Crop origin in image px, then convert to a ghost offset so the crop aligns
  // with the frame's top-left.
  const cropW = fw / scale;
  const cropH = fh / scale;
  const cx = clampN(fx * iw - cropW / 2, 0, Math.max(0, iw - cropW));
  const cy = clampN(fy * ih - cropH / 2, 0, Math.max(0, ih - cropH));
  const offX = -cx * scale;
  const offY = -cy * scale;

  function setZoom(next: number) {
    onChange({ zoom: next <= 1.001 ? undefined : Number(next.toFixed(3)) });
  }

  return (
    <>
      {/* Dim backdrop; clicking it (outside the frame) finishes. */}
      <div
        className="absolute inset-0 z-20 bg-ink-900/40"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onDone();
        }}
      />
      <div
        className="absolute z-30 cursor-move select-none overflow-visible ring-2 ring-brand-400"
        style={{ left: fl, top: ft, width: fw, height: fh, borderRadius: (el.corner ?? 0) * Math.min(fw, fh) }}
        onWheel={(e) => {
          e.preventDefault();
          const next = clampN(zoom * (1 - e.deltaY * 0.0015), 1, 4);
          setZoom(next);
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, fx, fy };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !dw || !dh) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          onChange({
            focus: {
              x: clampN(d.fx - dx / dw, 0, 1),
              y: clampN(d.fy - dy / dh, 0, 1),
            },
          });
        }}
        onPointerUp={(e) => {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
          drag.current = null;
        }}
      >
        {/* Ghosted full bitmap (shows the hidden overflow). */}
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none opacity-35"
            style={{ left: offX, top: offY, width: dw, height: dh }}
          />
        )}
        {/* In-frame slice at full opacity. */}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit" }}>
          {url && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: offX, top: offY, width: dw, height: dh }}
            />
          )}
        </div>
      </div>
      {/* Floating controls under the frame. */}
      <div
        className="absolute z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-ink-200 bg-white/95 px-1.5 py-1 shadow-lifted"
        style={{ left: fl + fw / 2, top: ft + fh + 8 }}
      >
        <button
          title="Zoom out"
          className="flex size-7 items-center justify-center rounded-full text-ink-600 hover:bg-ink-100"
          onClick={() => setZoom(clampN(zoom - 0.2, 1, 4))}
        >
          <Minus className="size-4" />
        </button>
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-28"
        />
        <button
          title="Zoom in"
          className="flex size-7 items-center justify-center rounded-full text-ink-600 hover:bg-ink-100"
          onClick={() => setZoom(clampN(zoom + 0.2, 1, 4))}
        >
          <PlusIcon className="size-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-ink-200" />
        <button
          className="rounded-full px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </>
  );
}

function clampN(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Vertical + horizontal grid line point arrays for the given spacing. */
function gridLines(W: number, H: number, gridSize: number): number[][] {
  const step = Math.max(8, gridSize * W);
  const lines: number[][] = [];
  for (let x = step; x < W; x += step) lines.push([x, 0, x, H]);
  for (let y = step; y < H; y += step) lines.push([0, y, W, y]);
  return lines;
}

/**
 * Compute a Konva `crop` rect that emulates CSS `object-fit: cover`. The focal
 * point (0..1, defaults to centre) picks which part survives when the source
 * overflows the frame — covers pass a top-biased focus so a baked-in title near
 * the top edge is never clipped.
 */
function coverCrop(
  iw: number,
  ih: number,
  W: number,
  H: number,
  focus?: { x: number; y: number },
) {
  if (!iw || !ih || !W || !H) return { x: 0, y: 0, width: iw, height: ih };
  const scale = Math.max(W / iw, H / ih);
  const cropW = W / scale;
  const cropH = H / scale;
  const fx = focus?.x ?? 0.5;
  const fy = focus?.y ?? 0.5;
  const x = clampN((iw - cropW) * fx, 0, Math.max(0, iw - cropW));
  const y = clampN((ih - cropH) * fy, 0, Math.max(0, ih - cropH));
  return { x, y, width: cropW, height: cropH };
}
