/**
 * Shared state for the unified Studio workspace: the designable page list, the
 * app-owned design layer (text boxes / patterns) with undo-redo, the current
 * selection (which drives the contextual inspector), and per-item generation
 * progress. One provider wraps the sidebar, the book canvas and the inspector.
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
import {
  COVER_FRONT_ID,
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
import {
  buildDesignPages,
  defaultDesign,
  defaultIllustrationFocus,
  newImageId,
  newTextBoxId,
  seedPageDesign,
  type DesignPage,
} from "../design/designInit";
import { getPreset } from "../design/presets";
import { newShapeId, shapeStyleDefaults } from "../design/shapes";
import { fitBoxHeightPct, fitFontSizePct } from "../design/textFit";
import type { SpanRef } from "../design/TextBoxView";
import { notify } from "../lib/notify";
import { computeProgress, type StudioStep } from "./studioSteps";

export type Selection =
  | { kind: "none" }
  | { kind: "page"; pageId: string }
  | { kind: "box"; pageId: string; boxId: string; span: SpanRef | null }
  | { kind: "shape"; pageId: string; shapeId: string }
  | { kind: "image"; pageId: string; imageId: string }
  | { kind: "anchor"; anchorId: string };

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

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
   * The display-spread id currently open in the Design stage's main canvas —
   * i.e. page navigation. Only one spread is ever mounted as a live Konva
   * editor at a time; every other page is just a static filmstrip thumbnail.
   */
  editingDispId: string | null;
  setEditingDisp: (id: string | null) => void;

  // design ops (page-scoped)
  undo: () => void;
  redo: () => void;
  addBox: (pageId: string, center?: Point) => void;
  patchBox: (pageId: string, boxId: string, patch: Partial<TextBox>) => void;
  patchSpan: (pageId: string, boxId: string, ref: SpanRef, patch: Partial<TextSpan>) => void;
  deleteBox: (pageId: string, boxId: string) => void;
  duplicateBox: (pageId: string, boxId: string) => void;
  reorderBox: (pageId: string, boxId: string, dir: -1 | 1) => void;
  alignBox: (pageId: string, boxId: string, edge: AlignEdge) => void;

  // shape ops (page-scoped)
  addShape: (pageId: string, kind: ShapeKind, center?: Point) => void;
  patchShape: (pageId: string, shapeId: string, patch: Partial<ShapeElement>) => void;
  deleteShape: (pageId: string, shapeId: string) => void;
  duplicateShape: (pageId: string, shapeId: string) => void;
  reorderShape: (pageId: string, shapeId: string, dir: -1 | 1) => void;
  alignShape: (pageId: string, shapeId: string, edge: AlignEdge) => void;

  // image ops (page-scoped)
  addAssetImage: (pageId: string, asset: AssetItem, center?: Point) => void;
  patchImage: (pageId: string, imageId: string, patch: Partial<ImageElement>) => void;
  deleteImage: (pageId: string, imageId: string) => void;
  duplicateImage: (pageId: string, imageId: string) => void;
  alignImage: (pageId: string, imageId: string, edge: AlignEdge) => void;
  /** Turn the page's generated illustration into a movable/scalable element. */
  makeIllustrationEditable: (pageId: string) => void;

  // layers (page-scoped, across all element kinds)
  moveLayer: (pageId: string, id: string, dir: -1 | 1) => void;
  /** Reassign the whole stack from a top-first ordering (drag-to-reorder). */
  setLayerOrder: (pageId: string, orderedIdsTopFirst: string[]) => void;
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
  copySelection: () => void;
  cutSelection: () => void;
  pasteAt: (target: { pageId: string; point: Point } | null) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  reorderSelected: (dir: -1 | 1) => void;
  nudgeSelected: (dx: number, dy: number) => void;

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
   * Whether the Design step is showing its book-setup flow (size/format/layout)
   * rather than the canvas. It opens automatically the first time (until the
   * reader confirms), and can be reopened from the canvas as a summary.
   */
  designSetupOpen: boolean;
  openDesignSetup: () => void;
  closeDesignSetup: () => void;

  /**
   * Whether the dedicated Cover Studio (front + back cover, shown together as a
   * wrap) is open over the main canvas. Opened from a cover cell in the rail or
   * the toolbar "Covers" action.
   */
  coverStudioOpen: boolean;
  openCoverStudio: () => void;
  closeCoverStudio: () => void;
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

type ClipboardEntry =
  | { kind: "box"; pageId: string; box: TextBox }
  | { kind: "shape"; pageId: string; shape: ShapeElement }
  | { kind: "image"; pageId: string; image: ImageElement };

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
  const [editingDispId, setEditingDispId] = useState<string | null>(null);
  const [generatingAnchors, setGA] = useState<Set<string>>(new Set());
  const [generatingPages, setGP] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [step, setStepRaw] = useState<StudioStep>(initialStep);
  const [designSetupOpen, setDesignSetupOpen] = useState(false);
  const [coverStudioOpen, setCoverStudioOpen] = useState(false);
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(false);
  const [guides, setGuides] = useState(true);
  const history = useRef<{ past: BookDesign[]; future: BookDesign[] }>({ past: [], future: [] });
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

  // Ensure a design layer exists, then seed any unseeded pages once so every
  // page starts with its narrative text laid out (design-everything-at-once).
  useEffect(() => {
    if (!design) {
      void setDesign(defaultDesign(project));
      return;
    }
    const missing = pages.filter((p) => !design.pages[p.id]);
    if (missing.length === 0) return;
    const nextPages = { ...design.pages };
    for (const p of missing) nextPages[p.id] = seedPageDesign(design, p);
    void setDesign({ ...design, pages: nextPages });
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
          // Setup is done but the screenplay hasn't finished auto-drafting.
          notify.info("Your pages are still being written", "Give it a moment, then try again.");
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
  const openDesignSetup = useCallback(() => setDesignSetupOpen(true), []);
  const closeDesignSetup = useCallback(() => setDesignSetupOpen(false), []);
  const openCoverStudio = useCallback(() => setCoverStudioOpen(true), []);
  const closeCoverStudio = useCallback(() => setCoverStudioOpen(false), []);

  const select = useCallback((sel: Selection) => setSelection(sel), []);

  // Entering/leaving focused edit clears element selection so the inspector
  // never shows controls for an element whose editor is no longer on screen.
  const setEditingDisp = useCallback((id: string | null) => {
    setEditingDispId(id);
    setSelection({ kind: "none" });
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

  const commit = useCallback(
    (mutate: (d: BookDesign) => BookDesign) => {
      const cur = useProjectsStore.getState().current()?.design;
      if (!cur) return;
      history.current.past.push(cur);
      if (history.current.past.length > 80) history.current.past.shift();
      history.current.future = [];
      void setDesign(mutate(structuredClone(cur)));
    },
    [setDesign],
  );

  const undo = useCallback(() => {
    const cur = useProjectsStore.getState().current()?.design;
    const past = history.current.past;
    if (!cur || past.length === 0) return;
    history.current.future.push(cur);
    void setDesign(past.pop()!);
  }, [setDesign]);

  const redo = useCallback(() => {
    const cur = useProjectsStore.getState().current()?.design;
    const future = history.current.future;
    if (!cur || future.length === 0) return;
    history.current.past.push(cur);
    void setDesign(future.pop()!);
  }, [setDesign]);

  const mutatePage = useCallback(
    (d: BookDesign, pageId: string, fn: (pd: PageDesign) => PageDesign): BookDesign => {
      const pd = d.pages[pageId] ?? { textBoxes: [] };
      d.pages[pageId] = fn(pd);
      return d;
    },
    [],
  );

  const patchBox = useCallback(
    (pageId: string, boxId: string, patch: Partial<TextBox>) => {
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
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          textBoxes: pd.textBoxes.map((b) => {
            if (b.id !== boxId) return b;
            let next = { ...b, ...patch };
            // Auto-height boxes render at max(target floor, content height): they
            // grow as text is added and can never be shorter than the text, but a
            // larger user-set target (minHeightPct) leaves room to breathe.
            if (next.autoHeight && affectsHeight && aspect) {
              const contentH = fitBoxHeightPct(next, aspect);
              const h = Math.max(contentH, next.minHeightPct ?? 0);
              const y = Math.max(0, Math.min(1 - h, next.rect.y));
              next = { ...next, rect: { ...next.rect, h, y } };
            }
            return next;
          }),
        })),
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
    (pageId: string, center?: Point) => {
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
        paragraphs: wordParagraphs("New text"),
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

  const deleteBox = useCallback(
    (pageId: string, boxId: string) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          textBoxes: pd.textBoxes.filter((b) => b.id !== boxId),
        })),
      );
      setSelection({ kind: "page", pageId });
    },
    [commit, mutatePage],
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
    (pageId: string, shapeId: string, patch: Partial<ShapeElement>) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          shapes: (pd.shapes ?? []).map((s) => (s.id === shapeId ? { ...s, ...patch } : s)),
        })),
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
    (pageId: string, imageId: string, patch: Partial<ImageElement>) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          images: (pd.images ?? []).map((im) => (im.id === imageId ? { ...im, ...patch } : im)),
        })),
      );
    },
    [commit, mutatePage],
  );

  const deleteImage = useCallback(
    (pageId: string, imageId: string) => {
      commit((d) =>
        mutatePage(d, pageId, (pd) => ({
          ...pd,
          images: (pd.images ?? []).filter((im) => im.id !== imageId),
        })),
      );
      setSelection({ kind: "page", pageId });
    },
    [commit, mutatePage],
  );

  const duplicateImage = useCallback(
    (pageId: string, imageId: string) => {
      const src = design?.pages[pageId]?.images?.find((im) => im.id === imageId);
      if (!src) return;
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

  const makeIllustrationEditable = useCallback(
    (pageId: string) => {
      if (!design) return;
      const pd = design.pages[pageId];
      if (pd?.images?.some((im) => im.kind === "illustration")) return;
      // Start the movable illustration from the same crop the passive full-bleed
      // used (top-biased on covers), so "Adjust art" doesn't jump the framing.
      const page = pages.find((p) => p.id === pageId);
      const focus = page ? defaultIllustrationFocus(page) : undefined;
      const img: ImageElement = {
        id: newImageId(),
        kind: "illustration",
        rect: { x: 0, y: 0, w: 1, h: 1 },
        z: bottomZ(pd) - 1,
        fit: "cover",
        ...(focus ? { focus } : {}),
        name: "Illustration",
      };
      commit((d) => mutatePage(d, pageId, (p) => ({ ...p, images: [...(p.images ?? []), img] })));
      setSelection({ kind: "image", pageId, imageId: img.id });
    },
    [commit, design, mutatePage, pages],
  );

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

  const copySelection = useCallback(() => {
    if (selection.kind === "box") {
      const b = design?.pages[selection.pageId]?.textBoxes.find((x) => x.id === selection.boxId);
      if (b) clipboard.current = { kind: "box", pageId: selection.pageId, box: structuredClone(b) };
    } else if (selection.kind === "shape") {
      const s = design?.pages[selection.pageId]?.shapes?.find((x) => x.id === selection.shapeId);
      if (s) clipboard.current = { kind: "shape", pageId: selection.pageId, shape: structuredClone(s) };
    } else if (selection.kind === "image") {
      const im = design?.pages[selection.pageId]?.images?.find((x) => x.id === selection.imageId);
      if (im) clipboard.current = { kind: "image", pageId: selection.pageId, image: structuredClone(im) };
    }
  }, [selection, design]);

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

  const pasteAt = useCallback(
    (target: { pageId: string; point: Point } | null) => {
      const entry = clipboard.current;
      if (!entry || !design) return;
      const pageId = target?.pageId ?? entry.pageId;
      if (entry.kind === "box") {
        const src = entry.box;
        const copy: TextBox = {
          ...structuredClone(src),
          id: newTextBoxId(),
          rect: target ? centeredRect(src.rect.w, src.rect.h, target.point) : offsetRect(src.rect),
          z: topZ(design.pages[pageId]) + 1,
        };
        commit((d) => mutatePage(d, pageId, (pd) => ({ ...pd, textBoxes: [...pd.textBoxes, copy] })));
        setSelection({ kind: "box", pageId, boxId: copy.id, span: null });
      } else if (entry.kind === "shape") {
        const src = entry.shape;
        const copy: ShapeElement = {
          ...structuredClone(src),
          id: newShapeId(),
          rect: target ? centeredRect(src.rect.w, src.rect.h, target.point) : offsetRect(src.rect),
          z: topZ(design.pages[pageId]) + 1,
        };
        commit((d) =>
          mutatePage(d, pageId, (pd) => ({ ...pd, shapes: [...(pd.shapes ?? []), copy] })),
        );
        setSelection({ kind: "shape", pageId, shapeId: copy.id });
      } else {
        const src = entry.image;
        const copy: ImageElement = {
          ...structuredClone(src),
          id: newImageId(),
          rect: target ? centeredRect(src.rect.w, src.rect.h, target.point) : offsetRect(src.rect),
          z: topZ(design.pages[pageId]) + 1,
        };
        commit((d) =>
          mutatePage(d, pageId, (pd) => ({ ...pd, images: [...(pd.images ?? []), copy] })),
        );
        setSelection({ kind: "image", pageId, imageId: copy.id });
      }
    },
    [design, commit, mutatePage],
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
        editingDispId,
        setEditingDisp,
        undo,
        redo,
        addBox,
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
        pasteAt,
        deleteSelected,
        duplicateSelected,
        reorderSelected,
        nudgeSelected,
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
        coverStudioOpen,
        openCoverStudio,
        closeCoverStudio,
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
