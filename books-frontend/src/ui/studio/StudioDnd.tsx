/**
 * Pointer-based drag-and-drop for the sidebar "element pool". Palette items
 * (shapes, text, characters & places) can be dragged onto any page surface
 * (marked with `data-page-drop="<pageId>"` by PageStage). We use raw pointer
 * events rather than HTML5 DnD because the drop targets are Konva <canvas>
 * elements, which HTML5 drag handles unreliably.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ShapeKind } from "../../core/types";
import type { AssetItem } from "../../core/settings";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { getCursor, updateNodeContent } from "../../core/versioning";
import { useProjectsStore } from "../../state/projectsStore";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { notify } from "../lib/notify";
import { shapePath } from "../design/shapes";
import { useStudio, type Point } from "./StudioContext";

export type DragItem =
  | { type: "shape"; kind: ShapeKind; label: string }
  | { type: "text"; label: string }
  | { type: "asset"; asset: AssetItem; label: string }
  | { type: "anchor"; anchorId: string; label: string; blobId?: string };

interface DndValue {
  dragging: boolean;
  begin: (item: DragItem, clientX: number, clientY: number) => void;
}

const Ctx = createContext<DndValue | null>(null);

export function useDnd(): DndValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDnd must be used inside <StudioDndProvider>");
  return ctx;
}

const DRAG_THRESHOLD = 6;

/**
 * Hit-test a viewport point against the page surfaces (`data-page-drop`) and
 * return the page id plus the normalized (0..1) point within it. Shared by the
 * drag layer and the paste-at-cursor shortcut. Pure DOM — no provider needed.
 */
export function pageDropTargetAt(x: number, y: number): { pageId: string; point: Point } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el instanceof HTMLElement && el.dataset.pageDrop) {
      const r = el.getBoundingClientRect();
      return {
        pageId: el.dataset.pageDrop,
        point: {
          x: Math.max(0, Math.min(1, (x - r.left) / r.width)),
          y: Math.max(0, Math.min(1, (y - r.top) / r.height)),
        },
      };
    }
  }
  return null;
}

/**
 * Wires a palette element as a drag source. Returns an `onPointerDown` handler
 * that distinguishes a click (fires `onClick`) from a drag (starts the drag
 * once the pointer moves past a small threshold).
 */
export function useDragSource(getItem: () => DragItem, onClick?: () => void) {
  const { begin } = useDnd();
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      const move = (ev: PointerEvent) => {
        if (started) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD) {
          started = true;
          cleanup();
          begin(getItem(), ev.clientX, ev.clientY);
        }
      };
      const up = () => {
        cleanup();
        if (!started) onClick?.();
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
  };
}

export function StudioDndProvider({ children }: { children: React.ReactNode }) {
  const { addShape, addBox, addAssetImage } = useStudio();
  const [item, setItem] = useState<DragItem | null>(null);
  const [pos, setPos] = useState<Point & { px: number; py: number }>({ x: 0, y: 0, px: 0, py: 0 });
  const hovered = useRef<HTMLElement | null>(null);

  const setHover = useCallback((el: HTMLElement | null) => {
    if (hovered.current === el) return;
    if (hovered.current) {
      hovered.current.style.outline = "";
      hovered.current.style.outlineOffset = "";
    }
    if (el) {
      el.style.outline = "3px solid rgba(99,102,241,0.7)";
      el.style.outlineOffset = "2px";
    }
    hovered.current = el;
  }, []);

  const dropTargetAt = useCallback((x: number, y: number): HTMLElement | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLElement && el.dataset.pageDrop) return el;
    }
    return null;
  }, []);

  const finishDrop = useCallback(
    (dragItem: DragItem, x: number, y: number) => {
      const target = pageDropTargetAt(x, y);
      if (!target) return;
      const { pageId, point } = target;
      if (dragItem.type === "shape") addShape(pageId, dragItem.kind, point);
      else if (dragItem.type === "text") addBox(pageId, point);
      else if (dragItem.type === "asset") addAssetImage(pageId, dragItem.asset, point);
      else addAnchorToPage(pageId, dragItem.anchorId, dragItem.label);
    },
    [addBox, addShape, addAssetImage],
  );

  const begin = useCallback(
    (dragItem: DragItem, clientX: number, clientY: number) => {
      setItem(dragItem);
      setPos({ x: clientX, y: clientY, px: clientX, py: clientY });
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";

      const move = (ev: PointerEvent) => {
        setPos((p) => ({ ...p, px: ev.clientX, py: ev.clientY }));
        setHover(dropTargetAt(ev.clientX, ev.clientY));
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setHover(null);
        finishDrop(dragItem, ev.clientX, ev.clientY);
        setItem(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [dropTargetAt, finishDrop, setHover],
  );

  return (
    <Ctx.Provider value={{ dragging: item !== null, begin }}>
      {children}
      {item &&
        createPortal(
          <div
            className="pointer-events-none fixed z-70 -translate-x-1/2 -translate-y-1/2"
            style={{ left: pos.px, top: pos.py }}
          >
            <DragGhost item={item} />
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/** Append an anchor to a content spread or cover. */
function addAnchorToPage(pageId: string, anchorId: string, label: string) {
  const store = useProjectsStore.getState();
  const p = store.current();
  if (!p?.screenplay) return;
  const tree = p.screenplay;
  const doc = getCursor(tree).content;

  const spread = doc.spreads.find((s) => s.id === pageId);
  if (spread) {
    if (spread.anchorIds.includes(anchorId)) return;
    void store.updateSpread(pageId, { anchorIds: [...spread.anchorIds, anchorId] });
    notify.success("Added to page", `${label} will appear here. Regenerate to include it.`);
    return;
  }

  if (pageId === COVER_FRONT_ID || pageId === COVER_BACK_ID) {
    const key = pageId === COVER_FRONT_ID ? "frontCover" : "backCover";
    const cloned = structuredClone(doc);
    const cover = cloned[key];
    if (!cover || cover.anchorIds.includes(anchorId)) return;
    cover.anchorIds = [...cover.anchorIds, anchorId];
    void store.setScreenplay(updateNodeContent(tree, tree.cursorId, cloned));
    notify.success("Added to cover", `${label} will appear here. Regenerate to include it.`);
  }
}

function DragGhost({ item }: { item: DragItem }) {
  if (item.type === "anchor") return <AnchorGhost blobId={item.blobId} label={item.label} />;
  if (item.type === "asset") return <AnchorGhost blobId={item.asset.blobId} label={item.label} />;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-brand-300 bg-white/95 px-3 py-2 shadow-lifted">
      {item.type === "shape" ? (
        <svg width={26} height={26} viewBox="0 0 26 26" style={{ overflow: "visible" }}>
          <path
            d={shapePath(item.kind, 22, 22, { corner: 0.18, points: 5, tailX: 0.3, tailY: 1.12 })}
            transform="translate(2 2)"
            fill="rgba(99,102,241,0.9)"
          />
        </svg>
      ) : (
        <span className="flex size-6 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-700">
          T
        </span>
      )}
      <span className="text-xs font-medium text-ink-700">{item.label}</span>
    </div>
  );
}

function AnchorGhost({ blobId, label }: { blobId?: string; label: string }) {
  const url = useBlobUrl(blobId);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-brand-300 bg-white/95 px-2.5 py-2 shadow-lifted">
      <span className="size-7 overflow-hidden rounded-md bg-ink-100 ring-1 ring-inset ring-ink-200">
        {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      </span>
      <span className="text-xs font-medium text-ink-700">{label}</span>
    </div>
  );
}
