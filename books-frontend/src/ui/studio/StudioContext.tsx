/**
 * Shared state for the unified Studio workspace: the designable page list, the
 * app-owned design layer (text boxes / patterns) with undo-redo (shared with
 * page add/remove/move/duplicate), the current selection (which drives the
 * contextual inspector), and per-item generation progress. One provider wraps
 * the sidebar, the book canvas and the inspector.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { textFromParagraphs, wordParagraphs } from "../../core/design";
import type { PageSide } from "../../core/book/layouts";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  DESIGN_VERSION,
  type BookDesign,
  type ImageElement,
  type PageDesign,
  type Project,
  type ShapeElement,
  type ShapeKind,
  type TextBox,
  type TextSpan,
} from "../../core/types";
import type { AssetItem } from "../../core/settings";
import { useProjectsStore } from "../../state/projectsStore";
import { getCursor } from "../../core/versioning";
import {
  buildDesignPages,
  defaultDesign,
  defaultIllustrationFocus,
  newImageId,
  newTextBoxId,
  pagesNeedingRelayout,
  relayoutPageDesign,
  seedPageDesign,
  type DesignPage,
} from "../design/designInit";
import { getPreset } from "../design/presets";
import { newShapeId, shapeStyleDefaults } from "../design/shapes";
import { fitBoxHeightPct, fitFontSizePct } from "../design/textFit";
import type { TextEditSection } from "../design/TextEditPanel";
import type { ImageEditSection } from "../design/ImageEditPanel";
import type { SpanRef } from "../design/TextBoxView";
import { notify, toast } from "../lib/notify";
import { buildDisplaySpreads, type DisplaySpread, type Entry, type SpreadSide } from "./spreadModel";
import type { PageSubject } from "./PageEditorCard";
import { computeProgress, type StudioStep } from "./studioSteps";
import {
  applyStudioSnapshot,
  bindStudioProjectCommit,
  takeStudioSnapshot,
  type StudioSnapshot,
} from "./studioUndo";

export type { TextEditSection } from "../design/TextEditPanel";
export type { ImageEditSection } from "../design/ImageEditPanel";

/** Docked tools opened from the Add dock (mutually exclusive). */
export type StudioToolPanel = "layers" | "view" | "setup";

export type Selection =
  | { kind: "none" }
  | { kind: "page"; pageId: string }
  | { kind: "box"; pageId: string; boxId: string; span: SpanRef | null }
  | { kind: "shape"; pageId: string; shapeId: string }
  | { kind: "image"; pageId: string; imageId: string }
  | { kind: "anchor"; anchorId: string };

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Options for design mutations that participate in undo/redo. */
export type HistoryOpts = {
  /**
   * When set, consecutive mutations with the same key merge into one undo step
   * (slider drags, an inline text-edit session). Cleared by {@link endHistoryGesture}
   * or by any mutation without a matching key.
   */
  coalesce?: string;
};

/** A normalized point on a page (0..1 in each axis). */
export interface Point {
  x: number;
  y: number;
}

/** Center a w×h rect on a normalized point, clamped to the page. */
function centeredRect(w: number, h: number, center?: Point): NRect {
  const cx = center?.x ?? 0.5;
  const cy = center?.y ?? 0.5;
  return {
    x: Math.max(0, Math.min(1 - w, cx - w / 2)),
    y: Math.max(0, Math.min(1 - h, cy - h / 2)),
    w,
    h,
  };
}

/** Prefer the largest / lowest-z illustration when deduping ghost copies. */
function pickCanonicalIllustration(illus: ImageElement[]): ImageElement {
  return [...illus].sort((a, b) => {
    const area = (im: ImageElement) => im.rect.w * im.rect.h;
    const d = area(b) - area(a);
    return d !== 0 ? d : a.z - b.z;
  })[0];
}

interface StudioContextValue {
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
  pageDesign: (pageId: string) => PageDesign;

  selection: Selection;
  select: (sel: Selection) => void;
  selectedBox: TextBox | null;
  selectedShape: ShapeElement | null;
  selectedImage: ImageElement | null;

  /**
   * Canva-style docked edit panel for text boxes (Effects / Background / More).
   * Opened from the floating toolbar so controls never cover the selection.
   */
  textEditSection: TextEditSection | null;
  openTextEdit: (section: TextEditSection) => void;
  /** Open section, or close the dock if that section is already open. */
  toggleTextEdit: (section: TextEditSection) => void;
  closeTextEdit: () => void;

  /**
   * Canva-style docked edit panel for images / page illustrations (Refine,
   * Characters, Scene, Versions, Effects, Frame). Opened from ImageStyleBar.
   */
  imageEditSection: ImageEditSection | null;
  openImageEdit: (section: ImageEditSection) => void;
  /** Open section, or close the dock if that section is already open. */
  toggleImageEdit: (section: ImageEditSection) => void;
  closeImageEdit: () => void;
  /**
   * Optional blocker for leaving the image edit sheet (e.g. dirty cast draft).
   * Return true to allow immediately; return false and call `proceed` later
   * after confirm. Pass null to clear.
   */
  setImageEditCloseGuard: (
    guard: ((proceed: () => void) => boolean) | null,
  ) => void;

  /**
   * Docked tool panel from the Add dock (Arrange / View / Setup). Opening one
   * dismisses edit sheets so the tool stays reachable; selection is kept.
   */
  toolPanel: StudioToolPanel | null;
  openToolPanel: (panel: StudioToolPanel) => void;
  closeToolPanel: () => void;
  toggleToolPanel: (panel: StudioToolPanel) => void;
  /** Convenience: open the Arrange (layers) panel. */
  openLayersPanel: () => void;

  /**
   * Ensure the page's full-bleed AI art is a selectable ImageElement and select
   * it. Optionally enter crop/reframe (used by double-click / Crop).
   */
  selectIllustration: (pageId: string, opts?: { enterReframe?: boolean }) => void;
  /** Image id the stage should auto-enter reframe for (one-shot). */
  pendingReframeImageId: string | null;
  clearPendingReframe: () => void;

  /**
   * The display-spread id currently open in the Design stage's main canvas —
   * i.e. page navigation. Only one spread is ever mounted as a live Konva
   * editor at a time; every other page is just a static filmstrip thumbnail.
   */
  editingDispId: string | null;
  setEditingDisp: (id: string | null) => void;

  // design ops (page-scoped)
  undo: () => void;
  redo: () => void;
  /**
   * End a coalesced history gesture (slider drag, inline edit session). The next
   * mutation starts a fresh undo step.
   */
  endHistoryGesture: () => void;
  addBox: (pageId: string, center?: Point) => void;
  /**
   * Smart Text dock action: on an empty page prefer screenplay story text, then
   * a recently removed box; otherwise a blank text box.
   */
  addText: (pageId: string, center?: Point) => void;
  patchBox: (
    pageId: string,
    boxId: string,
    patch: Partial<TextBox>,
    opts?: HistoryOpts,
  ) => void;
  patchSpan: (pageId: string, boxId: string, ref: SpanRef, patch: Partial<TextSpan>) => void;
  deleteBox: (pageId: string, boxId: string) => void;
  duplicateBox: (pageId: string, boxId: string) => void;
  reorderBox: (pageId: string, boxId: string, dir: -1 | 1) => void;
  alignBox: (pageId: string, boxId: string, edge: AlignEdge) => void;

  // shape ops (page-scoped)
  addShape: (pageId: string, kind: ShapeKind, center?: Point) => void;
  patchShape: (
    pageId: string,
    shapeId: string,
    patch: Partial<ShapeElement>,
    opts?: HistoryOpts,
  ) => void;
  deleteShape: (pageId: string, shapeId: string) => void;
  duplicateShape: (pageId: string, shapeId: string) => void;
  reorderShape: (pageId: string, shapeId: string, dir: -1 | 1) => void;
  alignShape: (pageId: string, shapeId: string, edge: AlignEdge) => void;

  // image ops (page-scoped)
  addAssetImage: (pageId: string, asset: AssetItem, center?: Point) => void;
  patchImage: (
    pageId: string,
    imageId: string,
    patch: Partial<ImageElement>,
    opts?: HistoryOpts,
  ) => void;
  deleteImage: (pageId: string, imageId: string) => void;
  duplicateImage: (pageId: string, imageId: string) => void;
  alignImage: (pageId: string, imageId: string, edge: AlignEdge) => void;
  /** Turn the page's generated illustration into a movable/scalable element. */
  makeIllustrationEditable: (pageId: string, opts?: { enterReframe?: boolean }) => void;

  // layers (page-scoped, across all element kinds)
  moveLayer: (pageId: string, id: string, dir: -1 | 1) => void;
  /** Reassign the whole stack from a top-first ordering (drag-to-reorder). */
  setLayerOrder: (pageId: string, orderedIdsTopFirst: string[]) => void;
  /** Pin a layer to the front (top) or back (bottom) of the stack. */
  sendLayerToEdge: (pageId: string, id: string, edge: "front" | "back") => void;
  setLayerHidden: (pageId: string, id: string, hidden: boolean) => void;
  setLayerLocked: (pageId: string, id: string, locked: boolean) => void;

  // text quick actions
  fitTextToBox: (pageId: string, boxId: string) => void;
  fitBoxToText: (pageId: string, boxId: string) => void;
  toggleAutoFit: (pageId: string, boxId: string) => void;
  toggleAutoFitGrow: (pageId: string, boxId: string) => void;

  // canvas helpers
  snap: boolean;
  grid: boolean;
  /** Show print-safety guides (safe margin + gutter) on the page surfaces. */
  guides: boolean;
  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleGuides: () => void;

  // selection-scoped helpers (drive keyboard shortcuts + copy/paste)
  /** Any element kind (text box, shape, image) can be copied/cut/pasted. */
  copySelection: () => void;
  cutSelection: () => void;
  /**
   * Paste the clipboard "in place": onto the currently visible page that sits
   * on the same physical side (left/right) it was copied from, at the exact
   * same position — or, when pasted back onto its own page, at a small offset
   * so the copy doesn't sit exactly on top of the original.
   */
  pasteSelection: () => void;
  hasClipboard: boolean;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  reorderSelected: (dir: -1 | 1) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  /**
   * Reassigns one element from one page to another, with `rect` already
   * expressed in the destination page's own normalized space. Used by the
   * merged two-page editor when a drag crosses the fold between two facing
   * single pages.
   */
  moveElementToPage: (
    kind: "box" | "shape" | "image",
    fromPageId: string,
    toPageId: string,
    elementId: string,
    rect: NRect,
  ) => void;

  /**
   * "Format painter" for text boxes: copies one box's styling (font, colors,
   * fill/stroke, effects, alignment, …) — everything except its content,
   * position and identity — onto another box.
   */
  copyBoxStyle: (pageId: string, boxId: string) => void;
  pasteBoxStyle: (pageId: string, boxId: string) => void;
  /** Whether a box style is currently on the clipboard, ready to paste. */
  hasCopiedBoxStyle: boolean;

  setPageBackground: (pageId: string, patch: Partial<NonNullable<PageDesign["background"]>>) => void;

  // generation progress (namespaced sets)
  generatingAnchors: Set<string>;
  generatingPages: Set<string>;
  setAnchorGenerating: (id: string, on: boolean) => void;
  setPageGenerating: (id: string, on: boolean) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  /** Begin a cancellable batch generation; returns its abort signal. */
  startGeneration: () => AbortSignal;
  /** Cancel the in-flight batch generation (if any). */
  cancelGeneration: () => void;

  // guided flow (Story → Anchors → Edit → Order)
  step: StudioStep;
  setStep: (step: StudioStep) => void;
  /** Jump to the Story step (used by "Edit story" affordances). */
  openSetup: () => void;

  /**
   * Whether the Design step is showing its first-time book-setup gate rather
   * than the canvas. After designReady, Setup reopens as a docked side panel.
   */
  designSetupOpen: boolean;
  openDesignSetup: () => void;
  closeDesignSetup: () => void;
}

/** Highest z across all elements on a page (text boxes + shapes + images). */
function topZ(pd: PageDesign | undefined): number {
  if (!pd) return 0;
  let max = 0;
  for (const b of pd.textBoxes) max = Math.max(max, b.z);
  for (const s of pd.shapes ?? []) max = Math.max(max, s.z);
  for (const im of pd.images ?? []) max = Math.max(max, im.z);
  return max;
}

/** Lowest z across all elements on a page (used to send to back). */
function bottomZ(pd: PageDesign | undefined): number {
  if (!pd) return 0;
  let min = 0;
  for (const b of pd.textBoxes) min = Math.min(min, b.z);
  for (const s of pd.shapes ?? []) min = Math.min(min, s.z);
  for (const im of pd.images ?? []) min = Math.min(min, im.z);
  return min;
}

type NRect = { x: number; y: number; w: number; h: number };
function alignRect(rect: NRect, edge: AlignEdge): NRect {
  const r = { ...rect };
  if (edge === "left") r.x = 0.02;
  if (edge === "right") r.x = 1 - rect.w - 0.02;
  if (edge === "hcenter") r.x = (1 - rect.w) / 2;
  if (edge === "top") r.y = 0.02;
  if (edge === "bottom") r.y = 1 - rect.h - 0.02;
  if (edge === "vcenter") r.y = (1 - rect.h) / 2;
  return r;
}

/** Shift a rect by a normalized delta, clamped to the page. */
function nudgeRect(rect: NRect, dx: number, dy: number): NRect {
  return {
    ...rect,
    x: Math.max(0, Math.min(1 - rect.w, rect.x + dx)),
    y: Math.max(0, Math.min(1 - rect.h, rect.y + dy)),
  };
}

/** Nudge a rect by a small fixed offset (used when pasting onto its own page). */
function offsetRect(rect: NRect): NRect {
  return {
    ...rect,
    x: Math.min(1 - rect.w, rect.x + 0.03),
    y: Math.min(1 - rect.h, rect.y + 0.03),
  };
}

/**
 * Per-kind array accessors for every element that can live on a page. Every
 * selection-scoped operation (copy, paste, cross-page drag, …) is written
 * once against this table instead of once per kind — adding a future element
 * kind is then a matter of adding one entry here, not touching every
 * operation that already works for text boxes, shapes and images.
 */
const ELEMENT_KINDS = {
  box: {
    list: (pd: PageDesign): TextBox[] => pd.textBoxes,
    withList: (pd: PageDesign, list: TextBox[]): PageDesign => ({ ...pd, textBoxes: list }),
    newId: newTextBoxId,
  },
  shape: {
    list: (pd: PageDesign): ShapeElement[] => pd.shapes ?? [],
    withList: (pd: PageDesign, list: ShapeElement[]): PageDesign => ({ ...pd, shapes: list }),
    newId: newShapeId,
  },
  image: {
    list: (pd: PageDesign): ImageElement[] => pd.images ?? [],
    withList: (pd: PageDesign, list: ImageElement[]): PageDesign => ({ ...pd, images: list }),
    newId: newImageId,
  },
} as const;

type ElementKind = keyof typeof ELEMENT_KINDS;
type ElementOf<K extends ElementKind> = ReturnType<(typeof ELEMENT_KINDS)[K]["list"]>[number];

function elementsOfKind<K extends ElementKind>(pd: PageDesign, kind: K): ElementOf<K>[] {
  return ELEMENT_KINDS[kind].list(pd) as ElementOf<K>[];
}

function withElementsOfKind<K extends ElementKind>(
  pd: PageDesign,
  kind: K,
  list: ElementOf<K>[],
): PageDesign {
  const withList = ELEMENT_KINDS[kind].withList as (pd: PageDesign, list: unknown[]) => PageDesign;
  return withList(pd, list);
}

function newIdFor(kind: ElementKind): string {
  return ELEMENT_KINDS[kind].newId();
}

/** A selection that refers to a copyable/pastable element on a page. */
type ElementSelection = Extract<Selection, { kind: "box" | "shape" | "image" }>;

function isElementSelection(sel: Selection): sel is ElementSelection {
  return sel.kind === "box" || sel.kind === "shape" || sel.kind === "image";
}

function selectionElementId(sel: ElementSelection): string {
  return sel.kind === "box" ? sel.boxId : sel.kind === "shape" ? sel.shapeId : sel.imageId;
}

type ClipboardEntry = {
  [K in ElementKind]: { kind: K; pageId: string; side: PageSide; element: ElementOf<K> };
}[ElementKind];

/**
 * The subset of `TextBox` that makes up its *style* rather than its content,
 * position or identity — what "copy style / paste style" carries over.
 * Deliberately excludes: id, rect, z (geometry/identity), paragraphs
 * (content), locked/hidden (per-box state), name/role/slotId (identity /
 * data bindings that shouldn't jump to another box).
 */
type TextBoxStyle = Omit<
  TextBox,
  "id" | "rect" | "z" | "paragraphs" | "locked" | "name" | "role" | "slotId" | "hidden"
>;

function styleOf(box: TextBox): TextBoxStyle {
  const { id, rect, z, paragraphs, locked, name, role, slotId, hidden, ...style } =
    structuredClone(box);
  return style;
}

const Ctx = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}

export function StudioProvider({
  project,
  initialStep,
  children,
}: {
  project: Project;
  initialStep: StudioStep;
  children: React.ReactNode;
}) {
  const setDesign = useProjectsStore((s) => s.setDesign);

  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [textEditSection, setTextEditSection] = useState<TextEditSection | null>(null);
  const [imageEditSection, setImageEditSection] = useState<ImageEditSection | null>(null);
  const [toolPanel, setToolPanel] = useState<StudioToolPanel | null>(null);
  /** When set, PageStage should auto-enter reframe for this illustration image id. */
  const [pendingReframeImageId, setPendingReframeImageId] = useState<string | null>(null);
  /**
   * Per-page lock so click + dblclick (or two rapid selects) can't each create
   * an illustration ImageElement before the store re-render lands.
   */
  const illustrationEnsureLock = useRef<Map<string, string>>(new Map());
  /** Soft-deleted text boxes per page (most recent last), for Undo / Add text. */
  const textTrash = useRef<Map<string, TextBox[]>>(new Map());
  const [editingDispId, setEditingDispId] = useState<string | null>(null);
  const [generatingAnchors, setGA] = useState<Set<string>>(new Set());
  const [generatingPages, setGP] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [step, setStepRaw] = useState<StudioStep>(initialStep);
  const [designSetupOpen, setDesignSetupOpen] = useState(false);
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(false);
  const [guides, setGuides] = useState(true);
  const history = useRef<{ past: StudioSnapshot[]; future: StudioSnapshot[] }>({
    past: [],
    future: [],
  });
  /** Active coalesce key — see {@link HistoryOpts.coalesce}. */
  const coalesceKey = useRef<string | null>(null);
  const genAbort = useRef<AbortController | null>(null);

  const startGeneration = useCallback(() => {
    genAbort.current?.abort();
    genAbort.current = new AbortController();
    return genAbort.current.signal;
  }, []);
  const cancelGeneration = useCallback(() => {
    genAbort.current?.abort();
  }, []);

  // Abort any in-flight generation when the studio unmounts (e.g. the user goes
  // back to the library or switches books), so it can't keep running against a
  // project that's no longer active and spam errors.
  useEffect(() => () => genAbort.current?.abort(), []);

  const pages = useMemo(() => buildDesignPages(project), [project]);
  const design = project.design ?? null;

  // --- "what's on screen" resolution (drives paste-in-place) --------------
  //
  // Mirrors `BookCanvas.tsx`'s own entries/display-spread build so the
  // provider can answer "which page is currently showing on the left/right"
  // without any UI component needing to hand it that information explicitly.
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;

  const entries = useMemo<Entry[]>(() => {
    if (!doc) return [];
    const spreadById = new Map(doc.spreads.map((s) => [s.id, s]));
    const out: Entry[] = [];
    for (const page of pages) {
      let subject: PageSubject | undefined;
      if (page.id === COVER_FRONT_ID && doc.frontCover) {
        subject = { kind: "cover", coverId: COVER_FRONT_ID, cover: doc.frontCover };
      } else if (page.id === COVER_BACK_ID && doc.backCover) {
        subject = { kind: "cover", coverId: COVER_BACK_ID, cover: doc.backCover };
      } else {
        const spread = spreadById.get(page.id);
        if (spread) subject = { kind: "spread", spread };
      }
      if (subject) out.push({ page, subject });
    }
    return out;
  }, [doc, pages]);

  const displays = useMemo<DisplaySpread[]>(
    () => (doc ? buildDisplaySpreads(doc, entries) : []),
    [doc, entries],
  );

  const activeDisp = useMemo<DisplaySpread | null>(
    () => displays.find((d) => d.id === editingDispId) ?? displays[0] ?? null,
    [displays, editingDispId],
  );

  /**
   * The page id currently showing on a given physical side of the open
   * spread — used to paste an element onto "the same side" it was copied
   * from. Falls back to whichever page IS showing when there's no exact
   * side match (e.g. the open spread is a single lone page).
   */
  const pageIdForSide = useCallback(
    (side: PageSide): string | undefined => {
      if (!activeDisp) return undefined;
      if (activeDisp.kind === "full") return activeDisp.entry.page.id;
      const pageOf = (s: SpreadSide) => (s.kind === "page" ? s.entry.page : undefined);
      const left = pageOf(activeDisp.left);
      const right = pageOf(activeDisp.right);
      if (side === "left") return left?.id ?? right?.id;
      if (side === "right") return right?.id ?? left?.id;
      return left?.id ?? right?.id;
    },
    [activeDisp],
  );

  // Ensure a design layer exists, then seed any unseeded pages so every page
  // starts with its narrative text laid out (design-everything-at-once), and
  // re-flow any page still laid out for a layout the book has since left.
  //
  // Re-layout only moves boxes tagged with the slot they were seeded from;
  // anything the reader added themselves is left exactly where they put it.
  useEffect(() => {
    if (!design) {
      void setDesign(defaultDesign(project));
      return;
    }
    const missing = pages.filter((p) => !design.pages[p.id]);
    const stale = pagesNeedingRelayout(design, pages);
    const needsVersion = design.version !== DESIGN_VERSION;
    if (missing.length === 0 && stale.length === 0 && !needsVersion) return;

    const nextPages = { ...design.pages };
    for (const p of missing) nextPages[p.id] = seedPageDesign(design, p);
    for (const p of stale) {
      const current = nextPages[p.id];
      if (current) nextPages[p.id] = relayoutPageDesign(design, p, current);
    }
    void setDesign({ ...design, version: DESIGN_VERSION, pages: nextPages });
  }, [design, pages, project, setDesign]);

  // The project title is the single source of truth for the front cover: keep
  // the linked "book-title" overlay box mirroring it, so the title on the cover
  // can never drift from the book's real title.
  useEffect(() => {
    if (!design) return;
    const page = design.pages[COVER_FRONT_ID];
    if (!page) return;
    let changed = false;
    const textBoxes = page.textBoxes.map((b) => {
      if (b.role !== "book-title") return b;
      if (textFromParagraphs(b.paragraphs) === project.title) return b;
      changed = true;
      return { ...b, paragraphs: wordParagraphs(project.title) };
    });
    if (changed) {
      void setDesign({
        ...design,
        pages: { ...design.pages, [COVER_FRONT_ID]: { ...page, textBoxes } },
      });
    }
  }, [design, project.title, setDesign]);

  // Guarded step navigation: EVERY "go to step X" affordance (the rail, the
  // canvas "Order & print" button, the anchors "Design the pages" button, …)
  // goes through this one gate, so nothing can jump past the rail's own locks.
  // A blocked jump explains what's still missing instead of silently failing.
  const setStep = useCallback(
    (next: StudioStep) => {
      // Read the LIVE project from the store (not the render-time prop): the
      // story step advances the stage and navigates in the same tick, so the
      // captured prop can be one update behind.
      const live =
        useProjectsStore.getState().projects.find((p) => p.id === project.id) ?? project;
      const progress = computeProgress(live);
      if (!progress[next].unlocked) {
        if (next === "order") {
          notify.info(
            "Almost there!",
            progress.pagesTotal > 0
              ? `Every page needs its artwork before you can order — ${progress.pagesReady} of ${progress.pagesTotal} ready.`
              : "Design your pages before ordering a printed book.",
          );
        } else if (next === "edit" && live.stage === "studio") {
          if (!progress.anchors.done) {
            notify.info(
              "Finish the cast first",
              "Create reference looks for your characters and places, then design the pages.",
            );
          } else {
            // Cast is done but the screenplay hasn't finished auto-drafting.
            notify.info("Your pages are still being written", "Give it a moment, then try again.");
          }
        } else {
          notify.info("One step at a time", "Finish the Story step first.");
        }
        return;
      }
      setStepRaw(next);
    },
    [project],
  );

  const openSetup = useCallback(() => setStep("story"), [setStep]);
  const closeDesignSetup = useCallback(() => setDesignSetupOpen(false), []);

  const select = useCallback((sel: Selection) => {
    setSelection(sel);
    if (sel.kind !== "box") setTextEditSection(null);
    if (sel.kind !== "image") setImageEditSection(null);
  }, []);

  const openTextEdit = useCallback((section: TextEditSection) => {
    setTextEditSection(section);
    setImageEditSection(null);
    setToolPanel(null);
  }, []);
  const closeTextEdit = useCallback(() => setTextEditSection(null), []);
  const toggleTextEdit = useCallback(
    (section: TextEditSection) => {
      if (textEditSection === section) {
        setTextEditSection(null);
        return;
      }
      openTextEdit(section);
    },
    [textEditSection, openTextEdit],
  );

  const imageEditCloseGuard = useRef<((proceed: () => void) => boolean) | null>(null);
  const setImageEditCloseGuard = useCallback(
    (guard: ((proceed: () => void) => boolean) | null) => {
      imageEditCloseGuard.current = guard;
    },
    [],
  );

  const runWithImageEditGuard = useCallback((proceed: () => void) => {
    const guard = imageEditCloseGuard.current;
    if (guard && !guard(proceed)) return;
    proceed();
  }, []);

  const openImageEdit = useCallback(
    (section: ImageEditSection) => {
      // Re-selecting the open section is a no-op (don't trip the dirty guard).
      if (imageEditSection === section) return;
      runWithImageEditGuard(() => {
        setImageEditSection(section);
        setTextEditSection(null);
        setToolPanel(null);
      });
    },
    [runWithImageEditGuard, imageEditSection],
  );
  const closeImageEdit = useCallback(() => {
    runWithImageEditGuard(() => setImageEditSection(null));
  }, [runWithImageEditGuard]);
  const toggleImageEdit = useCallback(
    (section: ImageEditSection) => {
      if (imageEditSection === section) {
        closeImageEdit();
        return;
      }
      openImageEdit(section);
    },
    [imageEditSection, closeImageEdit, openImageEdit],
  );

  const openToolPanel = useCallback(
    (panel: StudioToolPanel) => {
      runWithImageEditGuard(() => {
        setToolPanel(panel);
        setTextEditSection(null);
        setImageEditSection(null);
      });
    },
    [runWithImageEditGuard],
  );
  const closeToolPanel = useCallback(() => setToolPanel(null), []);
  const toggleToolPanel = useCallback(
    (panel: StudioToolPanel) => {
      if (toolPanel === panel) {
        setToolPanel(null);
        return;
      }
      openToolPanel(panel);
    },
    [toolPanel, openToolPanel],
  );
  const openLayersPanel = useCallback(() => openToolPanel("layers"), [openToolPanel]);

  /**
   * First-time gate uses the full-page flow; later visits toggle the docked
   * Setup panel (same control opens and closes).
   */
  const openDesignSetup = useCallback(() => {
    const ready =
      useProjectsStore.getState().projects.find((p) => p.id === project.id)?.config.designReady ??
      project.config.designReady;
    if (!ready) {
      setDesignSetupOpen(true);
      return;
    }
    toggleToolPanel("setup");
  }, [project.id, project.config.designReady, toggleToolPanel]);

  // Entering/leaving focused edit clears element selection so the inspector
  // never shows controls for an element whose editor is no longer on screen.
  const setEditingDisp = useCallback((id: string | null) => {
    setEditingDispId(id);
    setSelection({ kind: "none" });
    setTextEditSection(null);
    setImageEditSection(null);
    setToolPanel(null);
  }, []);

  const setAnchorGenerating = useCallback((id: string, on: boolean) => {
    setGA((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const setPageGenerating = useCallback((id: string, on: boolean) => {
    setGP((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const endHistoryGesture = useCallback(() => {
    coalesceKey.current = null;
  }, []);

  const pushHistory = useCallback((p: Project) => {
    history.current.past.push(takeStudioSnapshot(p));
    if (history.current.past.length > 80) history.current.past.shift();
    history.current.future = [];
  }, []);

  /** Clear selection when its page no longer exists after undo/redo. */
  const sanitizeSelection = useCallback((p: Project) => {
    setSelection((sel) => {
      if (sel.kind === "none" || sel.kind === "anchor") return sel;
      const pageId = sel.pageId;
      const spreads = p.screenplay ? getCursor(p.screenplay).content.spreads : [];
      const known = new Set<string>([
        ...spreads.map((s) => s.id),
        COVER_FRONT_ID,
        COVER_BACK_ID,
      ]);
      if (known.has(pageId)) return sel;
      return { kind: "none" };
    });
  }, []);

  const commit = useCallback(
    (mutate: (d: BookDesign) => BookDesign, opts?: HistoryOpts) => {
      const p = useProjectsStore.getState().current();
      if (!p?.design) return;
      const key = opts?.coalesce;
      const merging = key != null && key === coalesceKey.current;
      if (!merging) pushHistory(p);
      coalesceKey.current = key ?? null;
      void setDesign(mutate(structuredClone(p.design)));
    },
    [pushHistory, setDesign],
  );

  /**
   * Full-project mutation as one undo step (page add/remove/move/duplicate).
   * Snapshots design + screenplay + illustrations together.
   */
  const commitProject = useCallback(
    (mutate: (p: Project) => Project) => {
      const p = useProjectsStore.getState().current();
      if (!p) return;
      pushHistory(p);
      coalesceKey.current = null;
      void useProjectsStore.getState().patchCurrent(mutate);
    },
    [pushHistory],
  );

  // Let pageOps (and other non-React callers) share this undo stack.
  useEffect(() => bindStudioProjectCommit(commitProject), [commitProject]);

  const undo = useCallback(() => {
    const p = useProjectsStore.getState().current();
    const past = history.current.past;
    if (!p || past.length === 0) return;
    coalesceKey.current = null;
    history.current.future.push(takeStudioSnapshot(p));
    const snap = past.pop()!;
    void useProjectsStore
      .getState()
      .patchCurrent((cur) => applyStudioSnapshot(cur, snap))
      .then(() => {
        const next = useProjectsStore.getState().current();
        if (next) sanitizeSelection(next);
      });
  }, [sanitizeSelection]);

  const redo = useCallback(() => {
    const p = useProjectsStore.getState().current();
    const future = history.current.future;
    if (!p || future.length === 0) return;
    coalesceKey.current = null;
    history.current.past.push(takeStudioSnapshot(p));
    const snap = future.pop()!;
    void useProjectsStore
      .getState()
      .patchCurrent((cur) => applyStudioSnapshot(cur, snap))
      .then(() => {
        const next = useProjectsStore.getState().current();
        if (next) sanitizeSelection(next);
      });
  }, [sanitizeSelection]);

  const mutatePage = useCallback(
    (d: BookDesign, pageId: string, fn: (pd: PageDesign) => PageDesign): BookDesign => {
      const pd = d.pages[pageId] ?? { textBoxes: [] };
      d.pages[pageId] = fn(pd);
      return d;
    },
    [],
  );

  const patchBox = useCallback(
    (pageId: string, boxId: string, patch: Partial<TextBox>, opts?: HistoryOpts) => {
      const aspect = pages.find((p) => p.id === pageId)?.aspect;
      // Fields whose change alters how tall the text lays out.
      const affectsHeight =
        "paragraphs" in patch ||
        "fontSizePct" in patch ||
        "padding" in patch ||
        "lineHeight" in patch ||
        "fontFamily" in patch ||
        "minHeightPct" in patch ||
        "rect" in patch;
      commit(
        (d) =>
          mutatePage(d, pageId, (pd) => ({
            ...pd,
            textBoxes: pd.textBoxes.map((b) => {
              if (b.id !== boxId) return b;
              let next = { ...b, ...patch };
              // Auto-height boxes render at max(target floor, content height): they
              // grow as text is added and can never be shorter than the text, but a
              // larger user-set target (minHeightPct) leaves room to breathe.
              // Skip when the patch itself turns auto-height off (a manual resize)
              // — otherwise we'd restore content height and the opposite edge of
              // the box would jump instead of the font shrinking to fit.
              if (
                next.autoHeight &&
                patch.autoHeight !== false &&
                affectsHeight &&
                aspect
              ) {
                const contentH = fitBoxHeightPct(next, aspect);
                const h = Math.max(contentH, next.minHeightPct ?? 0);
                const y = Math.max(0, Math.min(1 - h, next.rect.y));
                next = { ...next, rect: { ...next.rect, h, y } };
              }
              return next;
            }),
          })),
        opts,
      );
    },
    [commit, mutatePage, pages],
  );

  const patchSpan = useCallback(
    (pageId: string, boxId: string, ref: SpanRef, patch: Partial<TextSpan>) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          textBoxes: pd.textBoxes.map((b) => {
            if (b.id !== boxId) return b;
            const paragraphs = b.paragraphs.map((p, pi) =>
              pi !== ref.p
                ? p
                : { ...p, spans: p.spans.map((s, si) => (si === ref.i ? { ...s, ...patch } : s)) },
            );
            return { ...b, paragraphs };
          }),
        })),
      );
    },
    [commit, mutatePage],
  );

  const addBox = useCallback(
    (pageId: string, center?: Point, text = "New text") => {
      if (!design) return;
      const preset = getPreset("card");
      const box: TextBox = {
        id: newTextBoxId(),
        rect: centeredRect(0.4, 0.2, center),
        z: topZ(design.pages[pageId]) + 1,
        presetId: "card",
        fontFamily: design.defaultFontFamily,
        fontSizePct: design.defaultFontSizePct,
        color: preset.defaults.text,
        align: "center",
        vAlign: "center",
        lineHeight: 1.25,
        paragraphs: wordParagraphs(text),
        fill: preset.defaults.fill,
        stroke: preset.defaults.stroke,
        padding: preset.padding,
        // Auto-height keeps the box hugging its text (grows as you type, never
        // shrinks below content). Font size stays exactly what the user sets —
        // no surprise re-fitting — so we leave auto-fit off.
        autoHeight: true,
        autoFit: false,
      };
      const page = pages.find((p) => p.id === pageId);
      if (page) box.rect = { ...box.rect, h: fitBoxHeightPct(box, page.aspect) };
      commit((d) => mutatePage(d, pageId, (pd) => ({ ...pd, textBoxes: [...pd.textBoxes, box] })));
      setSelection({ kind: "box", pageId, boxId: box.id, span: null });
    },
    [commit, design, mutatePage, pages],
  );

  const restoreDeletedBox = useCallback(
    (pageId: string, boxId?: string) => {
      const list = textTrash.current.get(pageId) ?? [];
      if (list.length === 0) return false;
      const idx = boxId ? list.findIndex((b) => b.id === boxId) : list.length - 1;
      if (idx < 0) return false;
      const box = list[idx];
      const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
      if (next.length === 0) textTrash.current.delete(pageId);
      else textTrash.current.set(pageId, next);
      commit((d) => {
        const pd = d.pages[pageId] ?? { textBoxes: [] };
        // Skip if an undo already put it back.
        if (pd.textBoxes.some((b) => b.id === box.id)) return d;
        return mutatePage(d, pageId, (p) => ({
          ...p,
          textBoxes: [...p.textBoxes, { ...box, z: topZ(p) + 1 }],
        }));
      });
      setSelection({ kind: "box", pageId, boxId: box.id, span: null });
      return true;
    },
    [commit, mutatePage],
  );

  const addText = useCallback(
    (pageId: string, center?: Point) => {
      if (!design) return;
      const pd = design.pages[pageId] ?? { textBoxes: [] };
      const page = pages.find((p) => p.id === pageId);
      const seed = page?.seedText?.trim() ?? "";
      const storyOnPage =
        !!seed &&
        pd.textBoxes.some((b) => {
          const t = textFromParagraphs(b.paragraphs).trim();
          return Boolean(b.slotId) || t === seed;
        });

      // Prefer screenplay text when it's missing; else recently removed on an
      // empty page; else a blank box.
      if (seed && !storyOnPage) {
        addBox(pageId, center, seed);
        return;
      }
      if (pd.textBoxes.length === 0 && restoreDeletedBox(pageId)) return;
      addBox(pageId, center);
    },
    [addBox, design, pages, restoreDeletedBox],
  );

  const deleteBox = useCallback(
    (pageId: string, boxId: string) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!box) return;
      const list = textTrash.current.get(pageId) ?? [];
      textTrash.current.set(pageId, [...list, structuredClone(box)].slice(-10));
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          textBoxes: pd.textBoxes.filter((b) => b.id !== boxId),
        })),
      );
      setSelection({ kind: "page", pageId });
      toast("Text removed", {
        description: "You can bring it back anytime.",
        action: {
          label: "Undo",
          onClick: () => {
            restoreDeletedBox(pageId, boxId);
          },
        },
      });
    },
    [commit, design, mutatePage, restoreDeletedBox],
  );

  const duplicateBox = useCallback(
    (pageId: string, boxId: string) => {
      const src = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!src) return;
      const copy: TextBox = {
        ...structuredClone(src),
        id: newTextBoxId(),
        rect: {
          ...src.rect,
          x: Math.min(0.9, src.rect.x + 0.03),
          y: Math.min(0.9, src.rect.y + 0.03),
        },
        z: topZ(design!.pages[pageId]) + 1,
      };
      commit((d) => mutatePage(d, pageId, (pd) => ({ ...pd, textBoxes: [...pd.textBoxes, copy] })));
      setSelection({ kind: "box", pageId, boxId: copy.id, span: null });
    },
    [commit, design, mutatePage],
  );

  const reorderBox = useCallback(
    (pageId: string, boxId: string, dir: -1 | 1) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!box) return;
      patchBox(pageId, boxId, { z: box.z + dir });
    },
    [design, patchBox],
  );

  const alignBox = useCallback(
    (pageId: string, boxId: string, edge: AlignEdge) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!box) return;
      patchBox(pageId, boxId, { rect: alignRect(box.rect, edge) });
    },
    [design, patchBox],
  );

  const addShape = useCallback(
    (pageId: string, kind: ShapeKind, center?: Point) => {
      if (!design) return;
      const page = pages.find((p) => p.id === pageId);
      const aspect = page?.aspect ?? 1;
      // Default to a pleasant size that reads square-ish in page pixels.
      const h = 0.32;
      const w = Math.min(0.6, h / aspect);
      const pd = design.pages[pageId];
      const top = topZ(pd);
      const shape: ShapeElement = {
        id: newShapeId(),
        kind,
        rect: centeredRect(w, h, center),
        z: top + 1,
        ...shapeStyleDefaults(kind),
      };
      commit((d) =>
        mutatePage(d, pageId, (pdraft) => ({ ...pdraft, shapes: [...(pdraft.shapes ?? []), shape] })),
      );
      setSelection({ kind: "shape", pageId, shapeId: shape.id });
    },
    [commit, design, mutatePage, pages],
  );

  const patchShape = useCallback(
    (pageId: string, shapeId: string, patch: Partial<ShapeElement>, opts?: HistoryOpts) => {
      commit(
        (d) =>
          mutatePage(d, pageId, (pd) => ({
            ...pd,
            shapes: (pd.shapes ?? []).map((s) => (s.id === shapeId ? { ...s, ...patch } : s)),
          })),
        opts,
      );
    },
    [commit, mutatePage],
  );

  const deleteShape = useCallback(
    (pageId: string, shapeId: string) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          shapes: (pd.shapes ?? []).filter((s) => s.id !== shapeId),
        })),
      );
      setSelection({ kind: "page", pageId });
    },
    [commit, mutatePage],
  );

  const duplicateShape = useCallback(
    (pageId: string, shapeId: string) => {
      const src = design?.pages[pageId]?.shapes?.find((s) => s.id === shapeId);
      if (!src) return;
      const copy: ShapeElement = {
        ...structuredClone(src),
        id: newShapeId(),
        rect: {
          ...src.rect,
          x: Math.min(0.9, src.rect.x + 0.03),
          y: Math.min(0.9, src.rect.y + 0.03),
        },
        z: topZ(design!.pages[pageId]) + 1,
      };
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({ ...pd, shapes: [...(pd.shapes ?? []), copy] })),
      );
      setSelection({ kind: "shape", pageId, shapeId: copy.id });
    },
    [commit, design, mutatePage],
  );

  const reorderShape = useCallback(
    (pageId: string, shapeId: string, dir: -1 | 1) => {
      const shape = design?.pages[pageId]?.shapes?.find((s) => s.id === shapeId);
      if (!shape) return;
      patchShape(pageId, shapeId, { z: shape.z + dir });
    },
    [design, patchShape],
  );

  const alignShape = useCallback(
    (pageId: string, shapeId: string, edge: AlignEdge) => {
      const shape = design?.pages[pageId]?.shapes?.find((s) => s.id === shapeId);
      if (!shape) return;
      patchShape(pageId, shapeId, { rect: alignRect(shape.rect, edge) });
    },
    [design, patchShape],
  );

  // --- image elements -----------------------------------------------------

  const addAssetImage = useCallback(
    (pageId: string, asset: AssetItem, center?: Point) => {
      if (!design) return;
      const page = pages.find((p) => p.id === pageId);
      const pageAspect = page?.aspect ?? 1;
      const a = asset.aspect ?? 1;
      // Fit a comfortable default size keeping the image's aspect on the page.
      let w = 0.5;
      let h = (w * pageAspect) / a;
      if (h > 0.6) {
        h = 0.6;
        w = (h * a) / pageAspect;
      }
      const img: ImageElement = {
        id: newImageId(),
        kind: "asset",
        blobId: asset.blobId,
        rect: centeredRect(w, h, center),
        z: topZ(design.pages[pageId]) + 1,
        fit: "contain",
        name: asset.name,
      };
      commit((d) => mutatePage(d, pageId, (pd) => ({ ...pd, images: [...(pd.images ?? []), img] })));
      setSelection({ kind: "image", pageId, imageId: img.id });
    },
    [commit, design, mutatePage, pages],
  );

  const patchImage = useCallback(
    (pageId: string, imageId: string, patch: Partial<ImageElement>, opts?: HistoryOpts) => {
      commit(
        (d) =>
          mutatePage(d, pageId, (pd) => ({
            ...pd,
            images: (pd.images ?? []).map((im) => (im.id === imageId ? { ...im, ...patch } : im)),
          })),
        opts,
      );
    },
    [commit, mutatePage],
  );

  const deleteImage = useCallback(
    (pageId: string, imageId: string) => {
      const im = design?.pages[pageId]?.images?.find((x) => x.id === imageId);
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          images: (pd.images ?? []).filter((x) => x.id !== imageId),
        })),
      );
      // Allow a fresh materialize after the page-art frame is removed.
      illustrationEnsureLock.current.delete(pageId);
      setSelection({ kind: "page", pageId });
      // Clearing page art keeps the illustrations version tree for Restore.
      if (im?.kind === "illustration") {
        const hasHistory = Boolean(useProjectsStore.getState().current()?.illustrations?.[pageId]);
        notify.info(
          "Art cleared from page",
          hasHistory ? "Earlier versions are still saved — Restore anytime." : undefined,
        );
      }
    },
    [commit, design, mutatePage],
  );

  const duplicateImage = useCallback(
    (pageId: string, imageId: string) => {
      const src = design?.pages[pageId]?.images?.find((im) => im.id === imageId);
      if (!src) return;
      // Page AI art is a singleton per page — duplicating it stacks ghost copies
      // of the same bitmap. Use Edit / New version instead.
      if (src.kind === "illustration") {
        notify.info("Can't duplicate page art", "Use Edit or New version instead.");
        return;
      }
      const copy: ImageElement = {
        ...structuredClone(src),
        id: newImageId(),
        rect: offsetRect(src.rect),
        z: topZ(design!.pages[pageId]) + 1,
      };
      commit((d) => mutatePage(d, pageId, (pd) => ({ ...pd, images: [...(pd.images ?? []), copy] })));
      setSelection({ kind: "image", pageId, imageId: copy.id });
    },
    [commit, design, mutatePage],
  );

  const alignImage = useCallback(
    (pageId: string, imageId: string, edge: AlignEdge) => {
      const im = design?.pages[pageId]?.images?.find((x) => x.id === imageId);
      if (!im) return;
      patchImage(pageId, imageId, { rect: alignRect(im.rect, edge) });
    },
    [design, patchImage],
  );

  /**
   * Ensure exactly one selectable illustration ImageElement on the page and
   * select it. Uses a per-page lock + store-latest read inside `commit` so
   * click/dblclick races can't create stacked ghost copies.
   * Never changes `z` on an existing frame (generation must not reshuffle layers).
   * New frames are created at the back (`bottomZ - 1`) under text/shapes.
   */
  const makeIllustrationEditable = useCallback(
    (pageId: string, opts?: { enterReframe?: boolean }) => {
      const finish = (imageId: string) => {
        illustrationEnsureLock.current.set(pageId, imageId);
        setSelection({ kind: "image", pageId, imageId });
        setTextEditSection(null);
        if (opts?.enterReframe) setPendingReframeImageId(imageId);
      };

      const lockedId = illustrationEnsureLock.current.get(pageId);
      if (lockedId) {
        finish(lockedId);
        // Still dedupe if older ghosts linger in the store.
        commit((d) => {
          const illus = (d.pages[pageId]?.images ?? []).filter((im) => im.kind === "illustration");
          if (illus.length <= 1) return d;
          const keep = illus.find((im) => im.id === lockedId) ?? pickCanonicalIllustration(illus);
          return mutatePage(d, pageId, (p) => ({
            ...p,
            images: (p.images ?? []).filter(
              (im) => im.kind !== "illustration" || im.id === keep.id,
            ),
          }));
        });
        return;
      }

      // Reserve the lock before commit so a nested/rapid second call can't
      // also decide to create.
      const latest = useProjectsStore.getState().current()?.design?.pages[pageId];
      const existing = (latest?.images ?? []).filter((im) => im.kind === "illustration");
      if (existing.length > 0) {
        const keep = pickCanonicalIllustration(existing);
        finish(keep.id);
        // Dedupe ghosts + backfill durable slot id on legacy elements.
        if (existing.length > 1 || !keep.illustrationId) {
          commit((d) =>
            mutatePage(d, pageId, (p) => ({
              ...p,
              images: (p.images ?? [])
                .filter((im) => im.kind !== "illustration" || im.id === keep.id)
                .map((im) =>
                  im.id === keep.id && im.kind === "illustration" && !im.illustrationId
                    ? { ...im, illustrationId: pageId }
                    : im,
                ),
            })),
          );
        }
        return;
      }

      if (!useProjectsStore.getState().current()?.design) return;

      const page = pages.find((p) => p.id === pageId);
      const focus = page ? defaultIllustrationFocus(page) : undefined;
      const img: ImageElement = {
        id: newImageId(),
        kind: "illustration",
        // Primary slot == page/spread id (job task + illustrations tree key).
        illustrationId: pageId,
        rect: { x: 0, y: 0, w: 1, h: 1 },
        z: bottomZ(latest) - 1,
        fit: "cover",
        ...(focus ? { focus } : {}),
        name: "Illustration",
      };
      // Lock with the new id before the async store write lands.
      finish(img.id);
      commit((d) => {
        const pd = d.pages[pageId] ?? { textBoxes: [] };
        const illus = (pd.images ?? []).filter((im) => im.kind === "illustration");
        // Another writer won the race — keep theirs, drop our provisional id.
        if (illus.length > 0) {
          const keep = pickCanonicalIllustration(illus);
          illustrationEnsureLock.current.set(pageId, keep.id);
          setSelection({ kind: "image", pageId, imageId: keep.id });
          return mutatePage(d, pageId, (p) => ({
            ...p,
            images: (p.images ?? []).filter(
              (im) => im.kind !== "illustration" || im.id === keep.id,
            ),
          }));
        }
        return mutatePage(d, pageId, (p) => ({
          ...p,
          images: [...(p.images ?? []), img],
        }));
      });
    },
    [commit, mutatePage, pages],
  );

  const selectIllustration = useCallback(
    (pageId: string, opts?: { enterReframe?: boolean }) => {
      makeIllustrationEditable(pageId, opts);
    },
    [makeIllustrationEditable],
  );

  const clearPendingReframe = useCallback(() => setPendingReframeImageId(null), []);

  // --- layers (across all element kinds) ----------------------------------

  const moveLayer = useCallback(
    (pageId: string, id: string, dir: -1 | 1) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => {
          const items = [
            ...pd.textBoxes.map((b) => ({ id: b.id, z: b.z })),
            ...(pd.shapes ?? []).map((s) => ({ id: s.id, z: s.z })),
            ...(pd.images ?? []).map((im) => ({ id: im.id, z: im.z })),
          ].sort((a, b) => a.z - b.z);
          const idx = items.findIndex((it) => it.id === id);
          const j = idx + dir;
          if (idx < 0 || j < 0 || j >= items.length) return pd;
          [items[idx], items[j]] = [items[j], items[idx]];
          const zById = new Map<string, number>();
          items.forEach((it, i) => zById.set(it.id, i + 1));
          return {
            ...pd,
            textBoxes: pd.textBoxes.map((b) => ({ ...b, z: zById.get(b.id) ?? b.z })),
            shapes: (pd.shapes ?? []).map((s) => ({ ...s, z: zById.get(s.id) ?? s.z })),
            images: (pd.images ?? []).map((im) => ({ ...im, z: zById.get(im.id) ?? im.z })),
          };
        }),
      );
    },
    [commit, mutatePage],
  );

  const setLayerOrder = useCallback(
    (pageId: string, orderedIdsTopFirst: string[]) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => {
          // The panel lists top-of-stack first; z ascends from the bottom, so
          // reverse before assigning z = 1..N. Any id not in the list keeps a
          // stable relative order below the reordered set (defensive).
          const bottomFirst = [...orderedIdsTopFirst].reverse();
          const zById = new Map<string, number>();
          bottomFirst.forEach((id, i) => zById.set(id, i + 1));
          return {
            ...pd,
            textBoxes: pd.textBoxes.map((b) => ({ ...b, z: zById.get(b.id) ?? b.z })),
            shapes: (pd.shapes ?? []).map((s) => ({ ...s, z: zById.get(s.id) ?? s.z })),
            images: (pd.images ?? []).map((im) => ({ ...im, z: zById.get(im.id) ?? im.z })),
          };
        }),
      );
    },
    [commit, mutatePage],
  );

  const sendLayerToEdge = useCallback(
    (pageId: string, id: string, edge: "front" | "back") => {
      const pd = design?.pages[pageId];
      if (!pd) return;
      const order = [
        ...pd.textBoxes.map((b) => ({ id: b.id, z: b.z })),
        ...(pd.shapes ?? []).map((s) => ({ id: s.id, z: s.z })),
        ...(pd.images ?? []).map((im) => ({ id: im.id, z: im.z })),
      ]
        .sort((a, b) => b.z - a.z)
        .map((r) => r.id);
      const from = order.indexOf(id);
      if (from < 0) return;
      order.splice(from, 1);
      if (edge === "front") order.unshift(id);
      else order.push(id);
      setLayerOrder(pageId, order);
    },
    [design, setLayerOrder],
  );

  const patchAnyById = useCallback(
    (pageId: string, id: string, patch: { hidden?: boolean; locked?: boolean; name?: string }) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          textBoxes: pd.textBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)),
          shapes: (pd.shapes ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
          images: (pd.images ?? []).map((im) => (im.id === id ? { ...im, ...patch } : im)),
        })),
      );
    },
    [commit, mutatePage],
  );

  const setLayerHidden = useCallback(
    (pageId: string, id: string, hidden: boolean) => patchAnyById(pageId, id, { hidden }),
    [patchAnyById],
  );
  const setLayerLocked = useCallback(
    (pageId: string, id: string, locked: boolean) => patchAnyById(pageId, id, { locked }),
    [patchAnyById],
  );

  // --- text quick actions -------------------------------------------------

  const fitTextToBox = useCallback(
    (pageId: string, boxId: string) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      const page = pages.find((p) => p.id === pageId);
      if (!box || !page) return;
      patchBox(pageId, boxId, { fontSizePct: fitFontSizePct(box, page.aspect), autoFit: false });
    },
    [design, pages, patchBox],
  );

  const fitBoxToText = useCallback(
    (pageId: string, boxId: string) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      const page = pages.find((p) => p.id === pageId);
      if (!box || !page) return;
      const h = fitBoxHeightPct(box, page.aspect);
      const y = Math.max(0, Math.min(1 - h, box.rect.y));
      patchBox(pageId, boxId, { rect: { ...box.rect, h, y } });
    },
    [design, pages, patchBox],
  );

  const toggleAutoFit = useCallback(
    (pageId: string, boxId: string) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!box) return;
      patchBox(pageId, boxId, { autoFit: !box.autoFit });
    },
    [design, patchBox],
  );

  const toggleAutoFitGrow = useCallback(
    (pageId: string, boxId: string) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!box) return;
      // Turning on "grow to fill" implies auto-fit is on.
      const grow = !box.autoFitGrow;
      patchBox(pageId, boxId, { autoFitGrow: grow, autoFit: grow ? true : box.autoFit });
    },
    [design, patchBox],
  );

  const setPageBackground = useCallback(
    (pageId: string, patch: Partial<NonNullable<PageDesign["background"]>>) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({ ...pd, background: { ...pd.background, ...patch } })),
      );
    },
    [commit, mutatePage],
  );

  // --- selection-scoped helpers & clipboard -------------------------------

  const clipboard = useRef<ClipboardEntry | null>(null);
  const boxStyleClipboard = useRef<TextBoxStyle | null>(null);
  const [hasCopiedBoxStyle, setHasCopiedBoxStyle] = useState(false);

  const copyBoxStyle = useCallback(
    (pageId: string, boxId: string) => {
      const box = design?.pages[pageId]?.textBoxes.find((b) => b.id === boxId);
      if (!box) return;
      boxStyleClipboard.current = styleOf(box);
      setHasCopiedBoxStyle(true);
      notify.info("Style copied", "Select another text box and paste the style onto it.");
    },
    [design],
  );

  const pasteBoxStyle = useCallback(
    (pageId: string, boxId: string) => {
      const style = boxStyleClipboard.current;
      if (!style) return;
      patchBox(pageId, boxId, structuredClone(style));
    },
    [patchBox],
  );

  const [hasClipboard, setHasClipboard] = useState(false);

  const copySelection = useCallback(() => {
    if (!isElementSelection(selection)) return;
    const { kind, pageId } = selection;
    const id = selectionElementId(selection);
    const pd = design?.pages[pageId];
    const el = pd ? elementsOfKind(pd, kind).find((e) => e.id === id) : undefined;
    if (!el) return;
    if (kind === "image" && (el as ImageElement).kind === "illustration") {
      notify.info("Can't copy page art", "Page illustrations stay on their page.");
      return;
    }
    const side: PageSide = pages.find((p) => p.id === pageId)?.outerSide ?? "spread";
    clipboard.current = { kind, pageId, side, element: structuredClone(el) } as ClipboardEntry;
    setHasClipboard(true);
  }, [selection, design, pages]);

  const deleteSelected = useCallback(() => {
    if (selection.kind === "box") deleteBox(selection.pageId, selection.boxId);
    else if (selection.kind === "shape") deleteShape(selection.pageId, selection.shapeId);
    else if (selection.kind === "image") deleteImage(selection.pageId, selection.imageId);
  }, [selection, deleteBox, deleteShape, deleteImage]);

  const cutSelection = useCallback(() => {
    copySelection();
    deleteSelected();
  }, [copySelection, deleteSelected]);

  const duplicateSelected = useCallback(() => {
    if (selection.kind === "box") duplicateBox(selection.pageId, selection.boxId);
    else if (selection.kind === "shape") duplicateShape(selection.pageId, selection.shapeId);
    else if (selection.kind === "image") duplicateImage(selection.pageId, selection.imageId);
  }, [selection, duplicateBox, duplicateShape, duplicateImage]);

  const reorderSelected = useCallback(
    (dir: -1 | 1) => {
      if (selection.kind === "box") moveLayer(selection.pageId, selection.boxId, dir);
      else if (selection.kind === "shape") moveLayer(selection.pageId, selection.shapeId, dir);
      else if (selection.kind === "image") moveLayer(selection.pageId, selection.imageId, dir);
    },
    [selection, moveLayer],
  );

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (selection.kind === "box") {
        const b = design?.pages[selection.pageId]?.textBoxes.find((x) => x.id === selection.boxId);
        if (b) patchBox(selection.pageId, selection.boxId, { rect: nudgeRect(b.rect, dx, dy) });
      } else if (selection.kind === "shape") {
        const s = design?.pages[selection.pageId]?.shapes?.find((x) => x.id === selection.shapeId);
        if (s) patchShape(selection.pageId, selection.shapeId, { rect: nudgeRect(s.rect, dx, dy) });
      } else if (selection.kind === "image") {
        const im = design?.pages[selection.pageId]?.images?.find((x) => x.id === selection.imageId);
        if (im) patchImage(selection.pageId, selection.imageId, { rect: nudgeRect(im.rect, dx, dy) });
      }
    },
    [selection, design, patchBox, patchShape, patchImage],
  );

  const pasteSelection = useCallback(() => {
    const entry = clipboard.current;
    if (!entry || !design) return;
    if (entry.kind === "image" && (entry.element as ImageElement).kind === "illustration") {
      notify.info("Can't paste page art", "Page illustrations stay on their page.");
      return;
    }
    // Land on the page currently showing on the same physical side it was
    // copied from — falling back to whichever page is showing, and finally to
    // the source page itself (e.g. pasting back into an unrelated project
    // state) — so paste always has *some* destination.
    const targetPageId = pageIdForSide(entry.side) ?? entry.pageId;
    const samePage = targetPageId === entry.pageId;
    const rect = samePage ? offsetRect(entry.element.rect) : entry.element.rect;
    const id = newIdFor(entry.kind);
    const copy = { ...structuredClone(entry.element), id, rect, z: topZ(design.pages[targetPageId]) + 1 };
    commit((d) =>
      mutatePage(d, targetPageId, (pd) =>
        withElementsOfKind(pd, entry.kind, [...elementsOfKind(pd, entry.kind), copy]),
      ),
    );
    if (entry.kind === "box") setSelection({ kind: "box", pageId: targetPageId, boxId: id, span: null });
    else if (entry.kind === "shape") setSelection({ kind: "shape", pageId: targetPageId, shapeId: id });
    else setSelection({ kind: "image", pageId: targetPageId, imageId: id });
  }, [design, commit, mutatePage, pageIdForSide]);

  const moveElementToPage = useCallback(
    (kind: ElementKind, fromPageId: string, toPageId: string, elementId: string, rect: NRect) => {
      if (fromPageId === toPageId) {
        // Staying on the same page is just a normal rect patch — route through
        // the per-kind patcher so kind-specific logic (e.g. a text box's
        // auto-height re-clamp) stays centralized in one place.
        if (kind === "box") patchBox(fromPageId, elementId, { rect });
        else if (kind === "shape") patchShape(fromPageId, elementId, { rect });
        else patchImage(fromPageId, elementId, { rect });
        return;
      }
      // Page AI art is bound to its illustration unit — never migrate across
      // facing pages (that swapped art / left ghost copies on pair stages).
      // PairPageStage clamps the drag on its side; this is the safety net.
      if (kind === "image") {
        const fromPd = useProjectsStore.getState().current()?.design?.pages[fromPageId];
        const el = fromPd?.images?.find((im) => im.id === elementId);
        if (el?.kind === "illustration") return;
      }
      commit((d) => {
        const fromPd = d.pages[fromPageId] ?? { textBoxes: [] };
        const list = elementsOfKind(fromPd, kind);
        const el = list.find((e) => e.id === elementId);
        if (!el) return d;
        d.pages[fromPageId] = withElementsOfKind(
          fromPd,
          kind,
          list.filter((e) => e.id !== elementId),
        );
        const toPd = d.pages[toPageId] ?? { textBoxes: [] };
        d.pages[toPageId] = withElementsOfKind(toPd, kind, [
          ...elementsOfKind(toPd, kind),
          { ...el, rect, z: topZ(toPd) + 1 },
        ]);
        return d;
      });
      setSelection((sel) => {
        if (!isElementSelection(sel) || sel.kind !== kind || selectionElementId(sel) !== elementId) {
          return sel;
        }
        if (sel.kind === "box") return { kind: "box", pageId: toPageId, boxId: elementId, span: null };
        if (sel.kind === "shape") return { kind: "shape", pageId: toPageId, shapeId: elementId };
        return { kind: "image", pageId: toPageId, imageId: elementId };
      });
    },
    [commit, patchBox, patchShape, patchImage],
  );

  const pageDesign = useCallback(
    (pageId: string): PageDesign => design?.pages[pageId] ?? { textBoxes: [] },
    [design],
  );

  const selectedBox = useMemo(() => {
    if (selection.kind !== "box" || !design) return null;
    return design.pages[selection.pageId]?.textBoxes.find((b) => b.id === selection.boxId) ?? null;
  }, [selection, design]);

  const selectedShape = useMemo(() => {
    if (selection.kind !== "shape" || !design) return null;
    return design.pages[selection.pageId]?.shapes?.find((s) => s.id === selection.shapeId) ?? null;
  }, [selection, design]);

  const selectedImage = useMemo(() => {
    if (selection.kind !== "image" || !design) return null;
    return design.pages[selection.pageId]?.images?.find((im) => im.id === selection.imageId) ?? null;
  }, [selection, design]);

  const value: StudioContextValue | null = design
    ? {
        project,
        pages,
        design,
        pageDesign,
        selection,
        select,
        selectedBox,
        selectedShape,
        selectedImage,
        textEditSection,
        openTextEdit,
        toggleTextEdit,
        closeTextEdit,
        imageEditSection,
        openImageEdit,
        toggleImageEdit,
        closeImageEdit,
        setImageEditCloseGuard,
        toolPanel,
        openToolPanel,
        closeToolPanel,
        toggleToolPanel,
        openLayersPanel,
        selectIllustration,
        pendingReframeImageId,
        clearPendingReframe,
        editingDispId,
        setEditingDisp,
        undo,
        redo,
        endHistoryGesture,
        addBox,
        addText,
        patchBox,
        patchSpan,
        deleteBox,
        duplicateBox,
        reorderBox,
        alignBox,
        addShape,
        patchShape,
        deleteShape,
        duplicateShape,
        reorderShape,
        alignShape,
        addAssetImage,
        patchImage,
        deleteImage,
        duplicateImage,
        alignImage,
        makeIllustrationEditable,
        moveLayer,
        setLayerOrder,
        sendLayerToEdge,
        setLayerHidden,
        setLayerLocked,
        fitTextToBox,
        fitBoxToText,
        toggleAutoFit,
        toggleAutoFitGrow,
        snap,
        grid,
        guides,
        toggleSnap: () => setSnap((v) => !v),
        toggleGrid: () => setGrid((v) => !v),
        toggleGuides: () => setGuides((v) => !v),
        copySelection,
        cutSelection,
        pasteSelection,
        hasClipboard,
        deleteSelected,
        duplicateSelected,
        reorderSelected,
        nudgeSelected,
        moveElementToPage,
        copyBoxStyle,
        pasteBoxStyle,
        hasCopiedBoxStyle,
        setPageBackground,
        generatingAnchors,
        generatingPages,
        setAnchorGenerating,
        setPageGenerating,
        busy,
        setBusy,
        startGeneration,
        cancelGeneration,
        step,
        setStep,
        openSetup,
        designSetupOpen,
        openDesignSetup,
        closeDesignSetup,
      }
    : null;

  if (!value) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-400">
        Preparing the studio…
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
