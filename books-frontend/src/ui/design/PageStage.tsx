import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Crop, Minus, Plus as PlusIcon } from "lucide-react";
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
import type { ImageActionId } from "../../core/ai/actions";
import { fontStack, loadFont } from "../typography/fonts";
import { cn } from "../lib/cn";
import { TextStyleBar, type TextBoxToolbarChrome, type TextStyleKey } from "./TextStyleBar";
import { ImageStyleBar, type ImageToolbarChrome } from "./ImageStyleBar";
import {
  placeFloatingBar,
  queryFloatingBarObstacles,
  floatingBarPortalProps,
  type FloatingBarPlacement,
} from "./floatingBarPlacement";
import type { ReadingModeId } from "../../core/config/ageWritingCatalog";
import {
  applyInlineColor,
  applyInlineCommand,
  editorToParagraphs,
  paragraphsToHtml,
} from "./richText";
import { KonvaTextBox, type KonvaTextBoxHandle } from "./konva/KonvaTextBox";
import { KonvaImageElement } from "./konva/KonvaImageElement";
import { KonvaArtBusyVeil } from "./konva/KonvaArtBusyVeil";
import { KonvaShape } from "./ShapeRender";
import { useImage } from "./konva/useImage";
import { usePatternImage } from "./konva/usePatternImage";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { getPreset } from "./presets";
import { effectiveBaseSize, minContentWidthPct } from "./textFit";
import { isBubble } from "./shapes";
import type { SpanRef } from "./TextBoxView";

const MIN_PX = 16;
const SNAP_PX = 6;
/** Rotation raster: snap to every 15° (0,15,…,345) when snapping is on. */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

/** Busy-state for one illustration surface (left page / right half). */
export type ArtBusySpec = {
  action: ImageActionId;
  refCount?: number;
  compact?: boolean;
  /** Durable slot id (job task / illustrations tree key). Defaults to page id. */
  illustrationId?: string;
};

/**
 * Konva Groups size themselves from their children, and `getClientRect` ignores
 * clipping — so overflowing text inflates the Transformer far beyond the box.
 * Mirror Shape.getClientRect: local rect is `{0,0,width,height}`. Critical:
 * honour `skipTransform` — the Transformer requests the local rect and applies
 * absolute transform + offset itself; transforming here too double-counts
 * offset and shifts the handles away from the text (and can NaN mid-drag).
 */
function pinGroupClientRect(node: Konva.Group) {
  if ((node as Konva.Group & { __clientRectPinned?: boolean }).__clientRectPinned) return;
  (node as Konva.Group & { __clientRectPinned?: boolean }).__clientRectPinned = true;
  node.getClientRect = function getPinnedClientRect(config: { skipTransform?: boolean; relativeTo?: Konva.Node } = {}) {
    const width = this.width();
    const height = this.height();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const rect = { x: 0, y: 0, width, height };
    if (config.skipTransform) return rect;
    return this._transformedRect(rect, config.relativeTo);
  };
}

function finiteOr(n: number, fallback: number) {
  return Number.isFinite(n) ? n : fallback;
}

/** Recover from a corrupt rect (e.g. NaNs written by a bad transform). */
function sanitizeRect(rect: NormRect): NormRect {
  const x = finiteOr(rect.x, 0.1);
  const y = finiteOr(rect.y, 0.1);
  const w = Math.max(0.05, finiteOr(rect.w, 0.4));
  const h = Math.max(0.05, finiteOr(rect.h, 0.2));
  if (x === rect.x && y === rect.y && w === rect.w && h === rect.h) return rect;
  return { x, y, w, h };
}

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
  /**
   * Text boxes only: dragging a box's *height* is an explicit "this box is this
   * tall" instruction, so the box stops hugging its text and starts fitting the
   * text into the box instead (see the resize handling in `onTransformEnd`).
   */
  autoHeight?: boolean;
  autoFit?: boolean;
}

/**
 * A second independent background/illustration surface, drawn in the right
 * half of the stage when present — for the merged two-page editor
 * (`PairPageStage.tsx`), where two facing single pages share one canvas but
 * each still has its own art/background. Absent, the stage behaves exactly as
 * a normal single-surface page.
 */
export interface SecondSurface {
  imageUrl?: string;
  illustrationFocus?: { x: number; y: number };
  background?: PageDesign["background"];
  printGuides?: {
    safe: NormRect;
    gutter: { x: number; w: number } | null;
    barcode?: NormRect | null;
  } | null;
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
  onSelectArt,
  autoReframeId,
  onAutoReframeConsumed,
  selectedSpan,
  onSelectSpan,
  onEditText,
  onEditRichText,
  onStyleBox,
  textToolbar,
  imageToolbar,
  editable = true,
  dropId,
  showGutter = false,
  printGuides = null,
  rightSurface,
  chromeless = false,
  /**
   * Size the page to contain within `[data-stage-fit]` (Canva-style stage fit).
   * Use for single pages in the live studio.
   */
  fitParent = false,
  /** Fill a parent that already has an explicit size (facing-page chrome). */
  fillParent = false,
  snap = true,
  grid = false,
  gridSize = 0.05,
  overlay,
  artBusy,
  emptyArt,
  emptyArtRight,
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
   * Commit crop/reframe for an image: zoom + focal point and/or the frame rect.
   * Driven by double-click crop mode (corner resize, pan, scroll zoom).
   */
  onReframeImage?: (
    id: string,
    patch: { zoom?: number; focus?: { x: number; y: number }; rect?: NormRect },
  ) => void;
  /**
   * Turn the page's full-bleed illustration into a movable element so it can be
   * repositioned. Invoked when the user double-clicks the background art (no
   * illustration element yet); the stage then auto-enters reframe on the new
   * element so "reposition the art" is a single gesture. `side` is which half
   * was clicked ("left" always, when there's no `rightSurface`).
   */
  onAdjustArt?: (side: "left" | "right") => void;
  /**
   * Single-click the background art: materialize (if needed) and select the
   * page illustration so the floating ImageStyleBar appears — Canva-style.
   */
  onSelectArt?: (side: "left" | "right") => void;
  /** One-shot: enter reframe for this image id when it exists on the stage. */
  autoReframeId?: string | null;
  onAutoReframeConsumed?: () => void;
  /**
   * Canva-style whole-image chrome. When provided, selecting an image shows
   * the floating ImageStyleBar instead of dumping framing into a side panel.
   */
  imageToolbar?: {
    pageIdForImage: (imageId: string) => string;
    onPatch: (
      imageId: string,
      patch: Partial<ImageElement>,
      opts?: { coalesce?: string },
    ) => void;
    onDuplicate: (imageId: string) => void;
    onDelete: (imageId: string) => void;
    onToggleLock: (imageId: string) => void;
  };
  /** Empty-state CTA when the (left) page has no illustration yet. */
  emptyArt?: React.ReactNode;
  /** Pair stages: empty-state CTA for the right half. */
  emptyArtRight?: React.ReactNode;
  /**
   * In-flight AI art for one or both halves. Non-blocking veil clipped to the
   * illustration element (or the full half/page when no element exists yet).
   */
  artBusy?: {
    left?: ArtBusySpec;
    right?: ArtBusySpec;
  };
  selectedSpan?: SpanRef | null;
  onSelectSpan?: (ref: SpanRef | null) => void;
  /** Commit new plain text for a text box (double-click to edit in place). */
  onEditText?: (id: string, value: string) => void;
  /** Commit styled paragraphs (preferred; preserves per-range styling). */
  onEditRichText?: (id: string, paragraphs: TextParagraph[]) => void;
  /** Apply a whole-box style patch (used by the floating character toolbar). */
  onStyleBox?: (
    id: string,
    patch: Partial<TextBox>,
    opts?: { coalesce?: string },
  ) => void;
  /**
   * Canva-style whole-box chrome (font/size/align/⋯ More). When provided with
   * `onStyleBox`, the floating bar becomes the primary text editor — no side
   * inspector needed for everyday styling.
   */
  textToolbar?: {
    pageWidthIn: number;
    pageHeightIn: number;
    ageRangeId?: string;
    readingModeId?: ReadingModeId | null;
    onDuplicate: (boxId: string) => void;
    onDelete: (boxId: string) => void;
    onToggleLock: (boxId: string) => void;
    onCopyStyle: (boxId: string) => void;
    onPasteStyle: (boxId: string) => void;
    canPasteStyle: boolean;
    /** Close a coalesced undo gesture (slider drag / colour scrub). */
    onGestureEnd: () => void;
    /**
     * Discard an in-progress inline edit session that was live-synced into
     * history (one undo step).
     */
    onDiscardEdit: () => void;
    undo: () => void;
    redo: () => void;
  };
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
  /**
   * A second background/illustration surface drawn in the right half of the
   * stage — two facing single pages sharing one canvas (see `SecondSurface`).
   * `aspect` must already be doubled (two page-widths) when this is set.
   */
  rightSurface?: SecondSurface;
  /** Drop the page's own frame chrome (rounding/ring/shadow) so a wrapper can
   * provide a single shared frame (e.g. two facing pages in one spread). */
  chromeless?: boolean;
  /** Contain within `[data-stage-fit]` (studio stage). Off for width-sized thumbs. */
  fitParent?: boolean;
  /** Fill a parent that already has an explicit pixel size. */
  fillParent?: boolean;
  /** Snap to page/element edges & centers while dragging. */
  snap?: boolean;
  /** Show an alignment grid and snap to it. */
  grid?: boolean;
  /** Grid spacing as a fraction of page width. */
  gridSize?: number;
  /** Optional misc overlay over the sized page surface. Prefer {@link artBusy}. */
  overlay?: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setFontTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reframeId, setReframeId] = useState<string | null>(null);
  // Screen placement for selection toolbars (recomputed on scroll/resize).
  const [boxBarPos, setBoxBarPos] = useState<FloatingBarPlacement | null>(null);
  const [imageBarPos, setImageBarPos] = useState<FloatingBarPlacement | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const groupRefs = useRef<Map<string, Konva.Group>>(new Map());
  const textBoxRefs = useRef<Map<string, KonvaTextBoxHandle>>(new Map());
  const trRef = useRef<Konva.Transformer>(null);
  /**
   * Id of the element whose Transformer is currently active. Kept in a ref
   * (not state) so transform frames never re-render React — re-rendering mid-
   * drag was resetting the group's centre from the pre-drag rect and making
   * the opposite corner jump instead of the box resizing.
   */
  const transformingIdRef = useRef<string | null>(null);

  const image = useImage(imageUrl);
  const bgPattern = usePatternImage(pageDesign.background?.pattern);
  const rightImage = useImage(rightSurface?.imageUrl);
  const rightBgPattern = usePatternImage(rightSurface?.background?.pattern);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (fitParent) {
      const frame =
        (wrapRef.current?.closest("[data-stage-fit]") as HTMLElement | null) ??
        wrapRef.current?.parentElement;
      if (!frame) return;
      const update = () => {
        const pw = frame.clientWidth;
        const ph = frame.clientHeight;
        if (pw <= 0) {
          setSize({ w: 0, h: 0 });
          return;
        }
        const safeAspect = aspect > 0 ? aspect : 1;
        let w = pw;
        let h = w / safeAspect;
        if (ph > 0 && h > ph) {
          h = ph;
          w = h * safeAspect;
        }
        w = Math.max(1, Math.floor(w));
        h = Math.max(1, Math.floor(h));
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        setSize({ w, h });
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(frame);
      return () => {
        ro.disconnect();
        el.style.width = "";
        el.style.height = "";
      };
    }

    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, fitParent]);

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
    ...pageDesign.textBoxes.map((b) => {
      const rect = sanitizeRect(b.rect);
      return {
        id: b.id,
        kind: "text" as const,
        z: b.z,
        rect,
        rotation: Number.isFinite(b.rotation) ? b.rotation : 0,
        locked: b.locked,
        hidden: b.hidden,
        box: rect === b.rect ? b : { ...b, rect },
      };
    }),
    ...(pageDesign.shapes ?? []).map((s) => {
      const rect = sanitizeRect(s.rect);
      return {
        id: s.id,
        kind: "shape" as const,
        z: s.z,
        rect,
        rotation: Number.isFinite(s.rotation) ? s.rotation : 0,
        locked: s.locked,
        hidden: s.hidden,
        shape: rect === s.rect ? s : { ...s, rect },
      };
    }),
    ...(pageDesign.images ?? []).map((im) => {
      const rect = sanitizeRect(im.rect);
      return {
        id: im.id,
        kind: "image" as const,
        z: im.z,
        rect,
        rotation: Number.isFinite(im.rotation) ? im.rotation : 0,
        locked: im.locked,
        hidden: im.hidden,
        image: rect === im.rect ? im : { ...im, rect },
      };
    }),
  ]
    .filter((el) => !el.hidden)
    .sort((a, b) => a.z - b.z);

  // When the generated illustration has been turned into a movable element,
  // suppress the full-bleed background so it isn't drawn twice. With a
  // `rightSurface`, `pageDesign` holds BOTH halves' elements (merged into one
  // combined space), so each half's flag is scoped by which half the movable
  // illustration's rect center actually sits in.
  const hasIllustrationEl = (pageDesign.images ?? []).some(
    (im) =>
      im.kind === "illustration" && (!rightSurface || im.rect.x + im.rect.w / 2 < 0.5),
  );
  const hasIllustrationElRight = rightSurface
    ? (pageDesign.images ?? []).some(
        (im) => im.kind === "illustration" && im.rect.x + im.rect.w / 2 >= 0.5,
      )
    : false;

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
    if (node) pinGroupClientRect(node);
    tr.nodes(node ? [node] : []);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [editable, selectedId, editingId, reframeId, W, H, pageDesign]);

  // Leaving a page / losing edit rights cancels any in-progress reframe.
  useEffect(() => {
    if (!editable) setReframeId(null);
  }, [editable]);

  // Double-clicking the background art asks the host to materialize the
  // illustration as a movable element; once it appears we auto-enter reframe so
  // repositioning the art is a single gesture rather than a multi-step flow.
  // `side` tracks WHICH half was double-clicked so, with a `rightSurface`, the
  // right art (which may already have its own movable element) isn't confused
  // with the left one once both exist.
  const pendingReframe = useRef<"left" | "right" | false>(false);
  function sideFromX(xFrac: number): "left" | "right" {
    return Boolean(rightSurface) && xFrac >= 0.5 ? "right" : "left";
  }
  function artPresent(side: "left" | "right") {
    return Boolean(side === "right" ? rightSurface?.imageUrl : imageUrl);
  }
  function hasArtElement(side: "left" | "right") {
    return side === "right" ? hasIllustrationElRight : hasIllustrationEl;
  }
  /** First click on passive full-bleed art: materialize + select (once). */
  function requestSelectArt(xFrac: number) {
    const side = sideFromX(xFrac);
    if (!editable || !artPresent(side) || hasArtElement(side)) return;
    if (onSelectArt) onSelectArt(side);
    else if (onAdjustArt) onAdjustArt(side);
  }
  /** Double-click passive full-bleed: materialize and enter reframe. */
  function requestAdjustArt(xFrac: number) {
    const side = sideFromX(xFrac);
    if (!editable || !artPresent(side)) return;
    // Element already exists — reframe is handled by the element's own dblclick.
    if (hasArtElement(side)) return;
    pendingReframe.current = side;
    if (onAdjustArt) onAdjustArt(side);
    else if (onSelectArt) onSelectArt(side);
  }
  useEffect(() => {
    if (!pendingReframe.current) return;
    const side = pendingReframe.current;
    const illus = (pageDesign.images ?? []).find(
      (im) =>
        im.kind === "illustration" &&
        im.fit !== "contain" &&
        (side === "right") === (Boolean(rightSurface) && im.rect.x + im.rect.w / 2 >= 0.5),
    );
    if (illus) {
      pendingReframe.current = false;
      setReframeId(illus.id);
    }
  }, [pageDesign, rightSurface]);

  // Host-requested reframe (Crop button / selectIllustration enterReframe).
  useEffect(() => {
    if (!autoReframeId) return;
    const exists = (pageDesign.images ?? []).some((im) => im.id === autoReframeId);
    if (!exists) return;
    setReframeId(autoReframeId);
    onAutoReframeConsumed?.();
  }, [autoReframeId, pageDesign, onAutoReframeConsumed]);

  // Preload fonts used anywhere on the page.
  useEffect(() => {
    for (const b of pageDesign.textBoxes) {
      loadFont(b.fontFamily);
      b.paragraphs.forEach((p) => p.spans.forEach((s) => s.fontFamily && loadFont(s.fontFamily)));
    }
  }, [pageDesign.textBoxes]);

  // With a `rightSurface`, each half's own "cover" crop is computed against
  // its OWN width (half the stage), not the full combined width.
  const surfaceW = rightSurface ? W / 2 : W;
  const imageCrop = image
    ? coverCrop(image.naturalWidth || image.width, image.naturalHeight || image.height, surfaceW, H, illustrationFocus)
    : undefined;
  const rightImageCrop = rightImage
    ? coverCrop(
        rightImage.naturalWidth || rightImage.width,
        rightImage.naturalHeight || rightImage.height,
        surfaceW,
        H,
        rightSurface?.illustrationFocus,
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

  // Same Canva toolbar whether the box is selected or being edited — editing
  // owns its own bar instance so character styles can target the live selection.
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
      setBoxBarPos(
        placeFloatingBar({
          anchor: {
            left: r.left + b.x,
            top: r.top + b.y,
            right: r.left + b.x + b.width,
            bottom: r.top + b.y + b.height,
          },
          obstacles: queryFloatingBarObstacles(),
        }),
      );
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

  const selectedImageEl =
    editable && selectedId && imageToolbar
      ? (pageDesign.images ?? []).find((im) => im.id === selectedId)
      : undefined;
  const showImageBar = Boolean(
    selectedImageEl && imageToolbar && selectedId !== reframeId,
  );
  const imageBarId = showImageBar ? selectedId : null;
  useEffect(() => {
    if (!imageBarId) {
      setImageBarPos(null);
      return;
    }
    const update = () => {
      const container = containerRef.current;
      const node = groupRefs.current.get(imageBarId);
      const stage = node?.getStage();
      const obstacles = queryFloatingBarObstacles();
      if (!container || !node || !stage) {
        // Full-bleed art may not have a group node yet on the first frame —
        // fall back to a thin strip at the page top so placement can flip.
        if (container) {
          const r = container.getBoundingClientRect();
          setImageBarPos(
            placeFloatingBar({
              anchor: {
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.top + 24,
              },
              obstacles,
            }),
          );
        } else {
          setImageBarPos(null);
        }
        return;
      }
      const b = node.getClientRect({ relativeTo: stage });
      const r = container.getBoundingClientRect();
      setImageBarPos(
        placeFloatingBar({
          anchor: {
            left: r.left + b.x,
            top: r.top + b.y,
            right: r.left + b.x + b.width,
            bottom: r.top + b.y + b.height,
          },
          obstacles,
        }),
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [imageBarId, W, H, pageDesign]);

  const imageChrome: ImageToolbarChrome | undefined =
    selectedImageEl && imageToolbar
      ? {
          image: selectedImageEl,
          pageId: imageToolbar.pageIdForImage(selectedImageEl.id),
          onPatch: (patch, opts) => imageToolbar.onPatch(selectedImageEl.id, patch, opts),
          onCrop: () => setReframeId(selectedImageEl.id),
          onDuplicate: () => imageToolbar.onDuplicate(selectedImageEl.id),
          onDelete: () => imageToolbar.onDelete(selectedImageEl.id),
          onToggleLock: () => imageToolbar.onToggleLock(selectedImageEl.id),
        }
      : undefined;

  // Character marks are active when every non-empty span carries them — the
  // selected box *is* the selection in Canva terms.
  const boxSpans = (selectedTextBox?.paragraphs.flatMap((p) => p.spans) ?? []).filter(
    (s) => s.text.length > 0,
  );
  const spanAll = (fn: (s: (typeof boxSpans)[number]) => boolean) =>
    boxSpans.length > 0 && boxSpans.every(fn);

  const mapSpans = (fn: (s: (typeof boxSpans)[number]) => (typeof boxSpans)[number]) =>
    selectedTextBox!.paragraphs.map((p) => ({
      ...p,
      spans: p.spans.map(fn),
    }));

  const toggleBoxStyle = (key: TextStyleKey) => {
    if (!selectedTextBox || !onStyleBox) return;
    const next = !spanAll((s) => Boolean(s[key]));
    onStyleBox(selectedTextBox.id, {
      paragraphs: mapSpans((s) => ({ ...s, [key]: next })),
    });
  };
  const setBoxColor = (color: string) => {
    if (!selectedTextBox || !onStyleBox) return;
    // Uniform colour for the selection (whole box): drop span colour overrides.
    onStyleBox(selectedTextBox.id, {
      color,
      paragraphs: mapSpans((s) => ({ ...s, color: undefined })),
    });
  };

  /** Box chrome patches; size changes also clear leftover per-span size multipliers. */
  const patchSelectedBox = (patch: Partial<TextBox>, opts?: { coalesce?: string }) => {
    if (!selectedTextBox || !onStyleBox) return;
    if (patch.fontSizePct !== undefined) {
      onStyleBox(
        selectedTextBox.id,
        {
          ...patch,
          paragraphs: mapSpans((s) => ({ ...s, sizeMul: undefined })),
        },
        opts,
      );
      return;
    }
    onStyleBox(selectedTextBox.id, patch, opts);
  };

  const boxChrome: TextBoxToolbarChrome | undefined =
    selectedTextBox && textToolbar && onStyleBox
      ? {
          box: selectedTextBox,
          pageWidthIn: textToolbar.pageWidthIn,
          pageHeightIn: textToolbar.pageHeightIn,
          surfaceAspect: aspect,
          ageRangeId: textToolbar.ageRangeId,
          readingModeId: textToolbar.readingModeId,
          onPatch: patchSelectedBox,
          onGestureEnd: textToolbar.onGestureEnd,
          onDuplicate: () => textToolbar.onDuplicate(selectedTextBox.id),
          onDelete: () => textToolbar.onDelete(selectedTextBox.id),
          onToggleLock: () => textToolbar.onToggleLock(selectedTextBox.id),
          onCopyStyle: () => textToolbar.onCopyStyle(selectedTextBox.id),
          onPasteStyle: () => textToolbar.onPasteStyle(selectedTextBox.id),
          canPasteStyle: textToolbar.canPasteStyle,
        }
      : undefined;

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
    <div
      ref={wrapRef}
      className={cn(
        "flex w-full items-center justify-center",
        (fitParent || fillParent) && "h-full min-h-0 max-h-full",
      )}
    >
      <div
        ref={containerRef}
        data-page-drop={dropId}
        data-editor-surface=""
        className={cn(
          "relative overflow-hidden bg-white",
          fitParent && "max-h-full max-w-full",
          fillParent && "h-full w-full",
          !fitParent && !fillParent && "h-auto max-h-[70vh] w-full",
          !chromeless && "shadow-soft ring-1 ring-ink-200",
        )}
        style={fitParent || fillParent ? undefined : { aspectRatio: String(aspect) }}
      >
        {W > 0 && H > 0 && (
          <Stage
            width={W}
            height={H}
            onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
              // Empty-stage click: materialize passive art once, otherwise deselect.
              // Never re-select an existing illustration element from the stage —
              // that made resized art feel "sticky" and raced double-creates.
              if (e.target !== e.target.getStage()) return;
              const stage = e.target.getStage();
              const pos = stage?.getPointerPosition();
              const xFrac = pos && W > 0 ? pos.x / W : 0;
              const side = sideFromX(xFrac);
              if (artPresent(side) && !hasArtElement(side) && (onSelectArt || onAdjustArt)) {
                requestSelectArt(xFrac);
                return;
              }
              clearSelection();
            }}
            onTouchStart={(e: KonvaEventObject<TouchEvent>) => {
              if (e.target !== e.target.getStage()) return;
              const stage = e.target.getStage();
              const pos = stage?.getPointerPosition();
              const xFrac = pos && W > 0 ? pos.x / W : 0;
              const side = sideFromX(xFrac);
              if (artPresent(side) && !hasArtElement(side) && (onSelectArt || onAdjustArt)) {
                requestSelectArt(xFrac);
                return;
              }
              clearSelection();
            }}
            onDblClick={(e: KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (e.target !== stage) return;
              const pos = stage?.getPointerPosition();
              requestAdjustArt(pos && W > 0 ? pos.x / W : 0);
            }}
            onDblTap={(e: KonvaEventObject<Event>) => {
              const stage = e.target.getStage();
              if (e.target !== stage) return;
              const pos = stage?.getPointerPosition();
              requestAdjustArt(pos && W > 0 ? pos.x / W : 0);
            }}
          >
            <Layer>
              {pageDesign.background?.color && (
                <Rect x={0} y={0} width={surfaceW} height={H} fill={pageDesign.background.color} listening={false} />
              )}
              {pageDesign.background?.pattern && bgPattern && (
                <Rect
                  x={0}
                  y={0}
                  width={surfaceW}
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
              {/* Legacy full-bleed paint for previews only. In the editor, a
                  missing illustration frame means cleared/empty — never a ghost. */}
              {image && imageCrop && !hasIllustrationEl && !editable && (
                <KonvaImage image={image} x={0} y={0} width={surfaceW} height={H} crop={imageCrop} listening={false} />
              )}
              {/* Busy veil under the element stack when page art isn't a layer yet. */}
              {artBusy?.left && !hasIllustrationEl && (
                <KonvaArtBusyVeil
                  x={0}
                  y={0}
                  w={surfaceW}
                  h={H}
                  action={artBusy.left.action}
                  refCount={artBusy.left.refCount}
                  compact={artBusy.left.compact}
                />
              )}

              {rightSurface && (
                <>
                  {rightSurface.background?.color && (
                    <Rect
                      x={surfaceW}
                      y={0}
                      width={surfaceW}
                      height={H}
                      fill={rightSurface.background.color}
                      listening={false}
                    />
                  )}
                  {rightSurface.background?.pattern && rightBgPattern && (
                    <Rect
                      x={surfaceW}
                      y={0}
                      width={surfaceW}
                      height={H}
                      fillPatternImage={rightBgPattern.image}
                      fillPatternRepeat="repeat"
                      fillPatternScale={{
                        x: rightSurface.background.pattern.scale || 1,
                        y: rightSurface.background.pattern.scale || 1,
                      }}
                      fillPatternRotation={rightSurface.background.pattern.rotation || 0}
                      opacity={rightSurface.background.pattern.opacity ?? 1}
                      listening={false}
                    />
                  )}
                  {rightImage && rightImageCrop && !hasIllustrationElRight && !editable && (
                    <KonvaImage
                      image={rightImage}
                      x={surfaceW}
                      y={0}
                      width={surfaceW}
                      height={H}
                      crop={rightImageCrop}
                      listening={false}
                    />
                  )}
                  {artBusy?.right && !hasIllustrationElRight && (
                    <KonvaArtBusyVeil
                      x={surfaceW}
                      y={0}
                      w={surfaceW}
                      h={H}
                      action={artBusy.right.action}
                      refCount={artBusy.right.refCount}
                      compact={artBusy.right.compact}
                    />
                  )}
                </>
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
                // If something else re-renders the stage mid-transform, keep
                // reading the live node attrs so we don't stomp the Transformer.
                const node = groupRefs.current.get(el.id);
                const liveSx = node ? node.scaleX() : 1;
                const liveSy = node ? node.scaleY() : 1;
                const transforming =
                  transformingIdRef.current === el.id &&
                  !!node &&
                  Number.isFinite(liveSx) &&
                  Number.isFinite(liveSy) &&
                  (Math.abs(liveSx - 1) > 1e-6 || Math.abs(liveSy - 1) > 1e-6);
                const restX = (rect.x + rect.w / 2) * W;
                const restY = (rect.y + rect.h / 2) * H;
                const restRot = el.rotation ?? 0;
                const artBusySpec = el.image
                  ? imageElementBusySpec(el.image, artBusy, Boolean(rightSurface))
                  : null;
                return (
                  <Group
                    key={el.id}
                    ref={(n) => {
                      if (n) {
                        groupRefs.current.set(el.id, n);
                        pinGroupClientRect(n);
                      } else {
                        groupRefs.current.delete(el.id);
                      }
                    }}
                    x={finiteOr(transforming && node ? node.x() : restX, restX)}
                    y={finiteOr(transforming && node ? node.y() : restY, restY)}
                    width={finiteOr(w, 0)}
                    height={finiteOr(h, 0)}
                    offsetX={finiteOr(w / 2, 0)}
                    offsetY={finiteOr(h / 2, 0)}
                    rotation={finiteOr(transforming && node ? node.rotation() : restRot, restRot)}
                    scaleX={finiteOr(transforming && node ? liveSx : 1, 1)}
                    scaleY={finiteOr(transforming && node ? liveSy : 1, 1)}
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
                      // Mark only — never setState here. Mid-drag React updates
                      // fight the Transformer (resetting the centre) and make the
                      // opposite corner jump instead of the box resizing.
                      transformingIdRef.current = el.id;
                      // Counter-scale the words imperatively so glyphs aren't
                      // stretched with the Transformer's non-uniform scale.
                      if (el.kind !== "text") return;
                      const n = e.target as Konva.Group;
                      textBoxRefs.current.get(el.id)?.setLiveScale(n.scaleX(), n.scaleY());
                    }}
                    onTransformEnd={(e: KonvaEventObject<Event>) => {
                      // The transformer scales the node; convert that scale into a
                      // new normalized rect and reset the node scale to 1.
                      const n = e.target as Konva.Group;
                      const scaleX = n.scaleX();
                      const scaleY = n.scaleY();
                      // Clear the live counter-scale before baking size — text
                      // will reflow at identity scale under the new rect.
                      textBoxRefs.current.get(el.id)?.setLiveScale(1, 1);
                      // Stage not measured yet, or a bad transform produced NaNs —
                      // reset scale and bail rather than writing Infinity/NaN.
                      if (
                        !(W > 0 && H > 0) ||
                        !Number.isFinite(scaleX) ||
                        !Number.isFinite(scaleY) ||
                        !Number.isFinite(n.x()) ||
                        !Number.isFinite(n.y())
                      ) {
                        n.scaleX(1);
                        n.scaleY(1);
                        transformingIdRef.current = null;
                        return;
                      }
                      const newW = Math.max(MIN_PX, rect.w * W * scaleX);
                      const newH = Math.max(MIN_PX, rect.h * H * scaleY);
                      const nextRect = {
                        x: n.x() / W - newW / W / 2,
                        y: n.y() / H - newH / H / 2,
                        w: newW / W,
                        h: newH / H,
                      };
                      // Bake size into the node BEFORE clearing scale, so there's
                      // no frame where scale=1 still has the old width/height at
                      // the new centre (that flash is the "text offset" / jump).
                      n.width(newW);
                      n.height(newH);
                      n.offsetX(newW / 2);
                      n.offsetY(newH / 2);
                      n.scaleX(1);
                      n.scaleY(1);
                      transformingIdRef.current = null;
                      trRef.current?.forceUpdate();
                      if (
                        !Number.isFinite(nextRect.x) ||
                        !Number.isFinite(nextRect.y) ||
                        !Number.isFinite(nextRect.w) ||
                        !Number.isFinite(nextRect.h)
                      ) {
                        return;
                      }
                      const resized =
                        Math.abs(scaleX - 1) > 1e-6 || Math.abs(scaleY - 1) > 1e-6;
                      onChangeElement(el.id, el.kind, {
                        rotation: finiteOr(n.rotation(), el.rotation ?? 0),
                        rect: nextRect,
                        // Any manual resize of a text box means "this box is this
                        // size": stop auto-height from restoring content height
                        // (which moves the opposite edge) and fit the font into
                        // the new box instead — same as Canva / PowerPoint.
                        ...(el.kind === "text" && resized
                          ? { autoHeight: false, autoFit: true }
                          : {}),
                      });
                    }}
                  >
                    {el.box ? (
                      <KonvaTextBox
                        ref={(handle) => {
                          if (handle) textBoxRefs.current.set(el.id, handle);
                          else textBoxRefs.current.delete(el.id);
                        }}
                        box={el.box}
                        w={w}
                        h={h}
                        baseSize={effectiveBaseSize(el.box, aspect, H)}
                        pageHeight={H}
                        pageAspect={aspect}
                        hideText={editable && editingId === el.id}
                        showOverflow={editable}
                        selectedSpan={selectedId === el.id ? selectedSpan : null}
                      />
                    ) : el.shape ? (
                      <KonvaShape shape={el.shape} w={w} h={h} pageHeight={H} />
                    ) : el.image ? (
                      <KonvaImageElement
                        el={el.image}
                        w={w}
                        h={h}
                        pageHeight={H}
                        illustrationUrl={
                          // Pair stages: each half has its own AI art. Pick URL by
                          // which half the element's center sits in — never feed
                          // the left page's bitmap to a right-page illustration.
                          rightSurface && el.image.rect.x + el.image.rect.w / 2 >= 0.5
                            ? rightSurface.imageUrl
                            : imageUrl
                        }
                        generating={!!artBusySpec}
                        busyAction={artBusySpec?.action}
                        busyRefCount={artBusySpec?.refCount}
                        busyCompact={artBusySpec?.compact}
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

              {W > 0 &&
                H > 0 &&
                [printGuides ? { g: printGuides, x0: 0 } : null, rightSurface?.printGuides ? { g: rightSurface.printGuides, x0: surfaceW } : null]
                  .filter((entry): entry is { g: NonNullable<typeof printGuides>; x0: number } => entry !== null)
                  .map(({ g, x0 }, i) => (
                    <Fragment key={i}>
                      {g.gutter && (
                        <Rect
                          x={x0 + g.gutter.x * surfaceW}
                          y={0}
                          width={g.gutter.w * surfaceW}
                          height={H}
                          fill="rgba(244,63,94,0.10)"
                          listening={false}
                        />
                      )}
                      <Rect
                        x={x0 + g.safe.x * surfaceW}
                        y={g.safe.y * H}
                        width={g.safe.w * surfaceW}
                        height={g.safe.h * H}
                        stroke="rgba(16,185,129,0.85)"
                        strokeWidth={1}
                        dash={[6, 5]}
                        listening={false}
                      />
                      {g.barcode && (
                        <>
                          <Rect
                            x={x0 + g.barcode.x * surfaceW}
                            y={g.barcode.y * H}
                            width={g.barcode.w * surfaceW}
                            height={g.barcode.h * H}
                            fill="rgba(15,23,42,0.06)"
                            stroke="rgba(15,23,42,0.45)"
                            strokeWidth={1}
                            dash={[4, 4]}
                            listening={false}
                          />
                          <Text
                            x={x0 + g.barcode.x * surfaceW}
                            y={g.barcode.y * H}
                            width={g.barcode.w * surfaceW}
                            height={g.barcode.h * H}
                            text={"Barcode area\n(reserved)"}
                            align="center"
                            verticalAlign="middle"
                            fontSize={11}
                            fill="rgba(15,23,42,0.55)"
                            listening={false}
                          />
                        </>
                      )}
                    </Fragment>
                  ))}

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
                    // Height is never floored for text: shrinking a box vertically
                    // is how you shrink its text (the font auto-fits). Width still
                    // stops at the widest word so nothing gets sliced in half.
                    // Clamp axes independently — returning `oldBox` wholesale when
                    // only width undershoots would also reject a valid height
                    // change (corner drags), which feels like the box refusing to
                    // resize at all.
                    const minW = Math.max(MIN_PX, selMinWidthPx);
                    let { x, y, width, height } = newBox;
                    if (width < minW) {
                      // Keep the edge that didn't move planted: if the left edge
                      // shifted (dragging left/ corners), pin the right edge;
                      // otherwise pin the left.
                      if (Math.abs(x - oldBox.x) > Math.abs(x + width - (oldBox.x + oldBox.width))) {
                        x = oldBox.x + oldBox.width - minW;
                      }
                      width = minW;
                    }
                    if (height < MIN_PX) {
                      if (Math.abs(y - oldBox.y) > Math.abs(y + height - (oldBox.y + oldBox.height))) {
                        y = oldBox.y + oldBox.height - MIN_PX;
                      }
                      height = MIN_PX;
                    }
                    return { ...newBox, x, y, width, height };
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
            chrome={
              textToolbar && onStyleBox
                ? {
                    box: editingBox,
                    pageWidthIn: textToolbar.pageWidthIn,
                    pageHeightIn: textToolbar.pageHeightIn,
                    surfaceAspect: aspect,
                    ageRangeId: textToolbar.ageRangeId,
                    readingModeId: textToolbar.readingModeId,
                    onPatch: (patch, opts) => {
                      if (patch.fontSizePct !== undefined) {
                        onStyleBox(
                          editingBox.id,
                          {
                            ...patch,
                            paragraphs: editingBox.paragraphs.map((p) => ({
                              ...p,
                              spans: p.spans.map((s) => ({ ...s, sizeMul: undefined })),
                            })),
                          },
                          opts,
                        );
                        return;
                      }
                      onStyleBox(editingBox.id, patch, opts);
                    },
                    onGestureEnd: textToolbar.onGestureEnd,
                    onDuplicate: () => textToolbar.onDuplicate(editingBox.id),
                    onDelete: () => {
                      textToolbar.onDelete(editingBox.id);
                      setEditingId(null);
                    },
                    onToggleLock: () => textToolbar.onToggleLock(editingBox.id),
                    onCopyStyle: () => textToolbar.onCopyStyle(editingBox.id),
                    onPasteStyle: () => textToolbar.onPasteStyle(editingBox.id),
                    canPasteStyle: textToolbar.canPasteStyle,
                  }
                : undefined
            }
            onLiveSync={
              onStyleBox
                ? (paragraphs) =>
                    onStyleBox(editingBox.id, { paragraphs }, { coalesce: `edit-${editingBox.id}` })
                : undefined
            }
            onCommit={() => {
              textToolbar?.onGestureEnd();
              setEditingId(null);
            }}
            onCancel={(discarded) => {
              if (discarded) textToolbar?.onDiscardEdit();
              else textToolbar?.onGestureEnd();
              setEditingId(null);
            }}
            onUndo={() => textToolbar?.undo()}
            onRedo={() => textToolbar?.redo()}
          />
        )}

        {editable && reframeEl && onReframeImage && W > 0 && H > 0 && (
          <ReframeOverlay
            el={reframeEl}
            W={W}
            H={H}
            containerEl={containerRef.current}
            illustrationUrl={
              rightSurface && reframeEl.rect.x + reframeEl.rect.w / 2 >= 0.5
                ? rightSurface.imageUrl
                : imageUrl
            }
            onChange={(patch) => onReframeImage(reframeEl.id, patch)}
            onDone={() => setReframeId(null)}
          />
        )}

        {overlay}

        {/* Empty CTA when there's no illustration frame — including after Clear
            art (version history may still exist). */}
        {editable && emptyArt && !hasIllustrationEl && !artBusy?.left && emptyArt}
        {editable &&
          emptyArtRight &&
          rightSurface &&
          !hasIllustrationElRight &&
          !artBusy?.right && (
            <div className="absolute inset-0 left-1/2 z-20">{emptyArtRight}</div>
          )}
      </div>

      {showBoxBar && boxBarPos && selectedTextBox && (
        <TextStyleBar
          placement={boxBarPos}
          bold={spanAll((s) => Boolean(s.bold))}
          italic={spanAll((s) => Boolean(s.italic))}
          underline={spanAll((s) => Boolean(s.underline))}
          color={selectedTextBox.color}
          onToggle={toggleBoxStyle}
          onColor={setBoxColor}
          chrome={boxChrome}
        />
      )}

      {showImageBar && imageBarPos && imageChrome && (
        <ImageStyleBar placement={imageBarPos} chrome={imageChrome} />
      )}
    </div>
  );
}

/**
 * In-place text editor that renders with the *exact* same styling as the result
 * renderer (chrome stays on the canvas behind it; this only owns the words), so
 * editing is true WYSIWYG: same font, size, color, alignment, padding and
 * preset text style as the printed page.
 *
 * Live-syncs into design history (one coalesced undo step for the session) so
 * B/I/U/colour/typing are undoable. Escape discards that step.
 */
function InlineTextEditor({
  box,
  W,
  H,
  baseSize,
  chrome,
  onLiveSync,
  onCommit,
  onCancel,
  onUndo,
  onRedo,
}: {
  box: TextBox;
  W: number;
  H: number;
  baseSize: number;
  chrome?: TextBoxToolbarChrome;
  /** Push current editor paragraphs into the design (coalesced undo). */
  onLiveSync?: (paragraphs: TextParagraph[]) => void;
  onCommit: () => void;
  /** `discarded` true when the user cancelled a dirty session (Escape). */
  onCancel: (discarded: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const dirty = useRef(false);
  const [marks, setMarks] = useState({ bold: false, italic: false, underline: false });
  const [barPos, setBarPos] = useState<FloatingBarPlacement | null>(null);

  const syncLive = () => {
    if (!ref.current || !onLiveSync) return;
    dirty.current = true;
    onLiveSync(editorToParagraphs(ref.current));
  };

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

  // Pin the toolbar to the text box (Canva), flipping below page chips / dock.
  useEffect(() => {
    const update = () => {
      const wrap = wrapRef.current;
      if (!wrap) {
        setBarPos(null);
        return;
      }
      const r = wrap.getBoundingClientRect();
      setBarPos(
        placeFloatingBar({
          anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          obstacles: queryFloatingBarObstacles(),
        }),
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [box.rect.x, box.rect.y, box.rect.w, box.rect.h, W, H]);

  // Keep B/I/U toggles in sync with the current selection / typing state.
  useEffect(() => {
    const onSel = () => {
      const el = ref.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return;
      if (!el.contains(sel.anchorNode) && !el.contains(sel.focusNode)) return;
      setMarks({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
      });
    };
    document.addEventListener("selectionchange", onSel);
    onSel();
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    if (save) {
      // Flush final DOM into the coalesced step only when the session changed.
      if (dirty.current && ref.current && onLiveSync) {
        onLiveSync(editorToParagraphs(ref.current));
      }
      onCommit();
    } else {
      onCancel(dirty.current);
    }
  }

  // ⌘Z / ⌘⇧Z → design undo/redo (not the browser's contentEditable stack).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (!isUndo && !isRedo) return;
      const el = ref.current;
      if (!el || (e.target !== el && !el.contains(e.target as Node))) return;
      e.preventDefault();
      e.stopPropagation();
      if (done.current) return;
      if (isUndo) {
        if (dirty.current) finish(false);
        else {
          finish(true);
          onUndo?.();
        }
      } else {
        finish(true);
        onRedo?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = getPreset(box.presetId);
  const colors = {
    fill: box.fill ?? preset.defaults.fill,
    stroke: box.stroke ?? preset.defaults.stroke,
    text: box.color,
  };
  const boxW = box.rect.w * W;
  const boxH = box.rect.h * H;
  const pad = (box.padding ?? preset.padding) * Math.min(boxW, boxH);

  // While editing, chrome must reflect the live box; keep onPatch bound to the
  // latest box identity from the parent-built chrome object.
  const liveChrome = chrome ? { ...chrome, box } : undefined;

  return (
    <>
      <div
        ref={wrapRef}
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
              box.align === "left"
                ? "flex-start"
                : box.align === "right"
                  ? "flex-end"
                  : box.align === "justify"
                    ? "stretch"
                    : "center",
            padding: pad,
            overflow: "hidden",
          }}
        >
          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={syncLive}
            onBlur={(e) => {
              // Keep editing alive when the floating toolbar (portaled) is clicked.
              const next = e.relatedTarget as Node | null;
              if (next && document.body.contains(next)) {
                const bar = (next as HTMLElement).closest?.("[data-text-style-bar]");
                if (bar) {
                  ref.current?.focus();
                  return;
                }
              }
              finish(true);
            }}
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
      {barPos && (
        <TextStyleBar
          placement={barPos}
          bold={marks.bold}
          italic={marks.italic}
          underline={marks.underline}
          color={box.color}
          onToggle={(key) => {
            applyInlineCommand(key);
            ref.current?.focus();
            setMarks({
              bold: document.queryCommandState("bold"),
              italic: document.queryCommandState("italic"),
              underline: document.queryCommandState("underline"),
            });
            syncLive();
          }}
          onColor={(c) => {
            applyInlineColor(c);
            ref.current?.focus();
            syncLive();
          }}
          chrome={liveChrome}
        />
      )}
    </>
  );
}

type ReframePatch = {
  zoom?: number;
  focus?: { x: number; y: number };
  rect?: NormRect;
};

type CropCorner = "tl" | "tr" | "bl" | "br";

/** Minimum crop frame size (normalized + px floor). */
const CROP_MIN_NORM = 0.08;
const CROP_MIN_PX = 48;

/**
 * Crop / reframe overlay for a "Fill" image:
 * - Corner handles resize the frame (`rect`)
 * - Drag inside pans the focal point; wheel / slider zooms
 * - Ghosted overflow shows what's outside the frame
 *
 * The Konva transformer is hidden while this is open. A portaled crop bar
 * replaces it so selection never feels gone (and survives overflow:hidden).
 */
function ReframeOverlay({
  el,
  W,
  H,
  containerEl,
  illustrationUrl,
  onChange,
  onDone,
}: {
  el: ImageElement;
  W: number;
  H: number;
  /** Page surface element — used to place the portaled crop bar in viewport space. */
  containerEl: HTMLElement | null;
  illustrationUrl?: string;
  onChange: (patch: ReframePatch) => void;
  onDone: () => void;
}) {
  const assetUrl = useBlobUrl(el.kind === "asset" ? el.blobId : undefined);
  const url = el.kind === "illustration" ? illustrationUrl : assetUrl ?? undefined;
  const image = useImage(url);
  const panDrag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const resizeDrag = useRef<{
    corner: CropCorner;
    startX: number;
    startY: number;
    origin: NormRect;
  } | null>(null);
  const [barPos, setBarPos] = useState<FloatingBarPlacement | null>(null);

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

  // Keep the crop bar pinned to the frame in viewport coords (survives
  // overflow:hidden on the page surface + scroll of the canvas). Flips below
  // when page chips / dock would collide.
  useEffect(() => {
    const update = () => {
      if (!containerEl) {
        setBarPos(null);
        return;
      }
      const r = containerEl.getBoundingClientRect();
      const fl = el.rect.x * W;
      const ft = el.rect.y * H;
      const fw = el.rect.w * W;
      const fh = el.rect.h * H;
      setBarPos(
        placeFloatingBar({
          anchor: {
            left: r.left + fl,
            top: r.top + ft,
            right: r.left + fl + fw,
            bottom: r.top + ft + fh,
          },
          barHeight: 48,
          obstacles: queryFloatingBarObstacles(),
        }),
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [containerEl, el.rect.x, el.rect.y, el.rect.w, el.rect.h, W, H]);

  const fx = el.focus?.x ?? 0.5;
  const fy = el.focus?.y ?? 0.5;
  const zoom = Math.max(1, el.zoom ?? 1);

  // Frame rect in stage px.
  const fw = el.rect.w * W;
  const fh = el.rect.h * H;
  const fl = el.rect.x * W;
  const ft = el.rect.y * H;
  const radius = (el.corner ?? 0) * Math.min(fw, fh);

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

  function resizeFromCorner(corner: CropCorner, clientX: number, clientY: number, origin: NormRect) {
    if (!containerEl || W <= 0 || H <= 0) return;
    const bounds = containerEl.getBoundingClientRect();
    // Pointer in normalized stage space.
    const px = clampN((clientX - bounds.left) / W, 0, 1);
    const py = clampN((clientY - bounds.top) / H, 0, 1);
    const minW = Math.max(CROP_MIN_NORM, CROP_MIN_PX / W);
    const minH = Math.max(CROP_MIN_NORM, CROP_MIN_PX / H);

    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.w;
    let bottom = origin.y + origin.h;

    if (corner.includes("l")) left = Math.min(px, right - minW);
    if (corner.includes("r")) right = Math.max(px, left + minW);
    if (corner.includes("t")) top = Math.min(py, bottom - minH);
    if (corner.includes("b")) bottom = Math.max(py, top + minH);

    left = clampN(left, 0, 1 - minW);
    top = clampN(top, 0, 1 - minH);
    right = clampN(right, left + minW, 1);
    bottom = clampN(bottom, top + minH, 1);

    onChange({
      rect: {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
      },
    });
  }

  function startResize(corner: CropCorner, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeDrag.current = {
      corner,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...el.rect },
    };
  }

  const handleClass = (pos: CropCorner) => {
    const base =
      "absolute z-40 size-4 rounded-sm border-[3px] border-brand-500 bg-white shadow-sm touch-none";
    if (pos === "tl") return cn(base, "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize");
    if (pos === "tr") return cn(base, "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize");
    if (pos === "bl") return cn(base, "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize");
    return cn(base, "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize");
  };

  const cropBarPortal = barPos ? floatingBarPortalProps(barPos) : null;

  return (
    <>
      {/* Dim backdrop; clicking it (outside the frame) finishes. */}
      <div
        className="absolute inset-0 z-20 bg-ink-900/45"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onDone();
        }}
      />
      <div
        className="absolute z-30 cursor-move select-none overflow-visible shadow-[0_0_0_2px_rgba(255,255,255,0.95),0_0_0_4px_rgb(99_102_241)]"
        style={{ left: fl, top: ft, width: fw, height: fh, borderRadius: radius }}
        onWheel={(e) => {
          e.preventDefault();
          const next = clampN(zoom * (1 - e.deltaY * 0.0015), 1, 4);
          setZoom(next);
        }}
        onPointerDown={(e) => {
          // Corner handles stopPropagation; anything else pans content.
          if (resizeDrag.current) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          panDrag.current = { x: e.clientX, y: e.clientY, fx, fy };
        }}
        onPointerMove={(e) => {
          const resize = resizeDrag.current;
          if (resize) {
            resizeFromCorner(resize.corner, e.clientX, e.clientY, resize.origin);
            return;
          }
          const d = panDrag.current;
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
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* not capturing */
          }
          panDrag.current = null;
          resizeDrag.current = null;
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
        {(["tl", "tr", "bl", "br"] as CropCorner[]).map((pos) => (
          <button
            key={pos}
            type="button"
            aria-label={`Resize ${pos}`}
            title="Drag to resize crop"
            className={handleClass(pos)}
            onPointerDown={(e) => startResize(pos, e)}
            onPointerMove={(e) => {
              const resize = resizeDrag.current;
              if (!resize || resize.corner !== pos) return;
              resizeFromCorner(resize.corner, e.clientX, e.clientY, resize.origin);
            }}
            onPointerUp={(e) => {
              try {
                (e.target as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* not capturing */
              }
              resizeDrag.current = null;
            }}
          />
        ))}
      </div>

      {cropBarPortal &&
        createPortal(
          <div
            data-image-crop-bar
            className={cropBarPortal.className}
            style={cropBarPortal.style}
            onMouseDown={(e) => {
              // Don't block range-slider / button interaction (preventDefault on
              // the wrapper was killing scrubbing).
              if ((e.target as HTMLElement).closest("input, button, select, textarea, a")) return;
              e.preventDefault();
            }}
          >
            <div className="flex items-center gap-1 rounded-xl border border-brand-200 bg-white/98 p-1 shadow-lifted backdrop-blur">
              <span className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700">
                <Crop className="size-3.5" />
                Cropping
              </span>
              <span className="hidden px-1 text-[11px] text-ink-400 sm:inline">
                Corners resize · drag to pan · Esc
              </span>
              <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
              <button
                type="button"
                title="Zoom out"
                className="flex size-8 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
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
                title={`${zoom.toFixed(1)}×`}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-24"
              />
              <button
                type="button"
                title="Zoom in"
                className="flex size-8 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
                onClick={() => setZoom(clampN(zoom + 0.2, 1, 4))}
              >
                <PlusIcon className="size-4" />
              </button>
              <span className="w-8 text-center text-[11px] font-medium tabular-nums text-ink-500">
                {zoom.toFixed(1)}×
              </span>
              <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-200" />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                onClick={onDone}
              >
                <Check className="size-3.5" />
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
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

/** Busy spec for an illustration element, if that slot is generating. */
function imageElementBusySpec(
  im: ImageElement,
  artBusy: { left?: ArtBusySpec; right?: ArtBusySpec } | undefined,
  paired: boolean,
): ArtBusySpec | null {
  if (!artBusy || im.kind !== "illustration") return null;
  const onRight = paired && im.rect.x + im.rect.w / 2 >= 0.5;
  const spec = onRight ? artBusy.right : artBusy.left;
  if (!spec) return null;
  // Prefer durable slot match; legacy elements without illustrationId follow the half.
  if (spec.illustrationId && im.illustrationId) {
    return im.illustrationId === spec.illustrationId ? spec : null;
  }
  return spec;
}
