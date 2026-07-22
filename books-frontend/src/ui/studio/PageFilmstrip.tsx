/**
 * The left-hand page rail — the primary way to move around the book. It
 * replaces the old scroll/grid view toggle: there's only ever one view now
 * (a big single spread in the main stage), and this rail is how you jump
 * between pages, see at a glance what still needs art, reorder by dragging,
 * and insert new pages.
 */
import { useState } from "react";
import { BookOpen, GripVertical, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Popover } from "../components/Popover";
import { cn } from "../lib/cn";
import {
  contentSpreadIds,
  SpreadThumbnail,
  useDisplayStatus,
  type DisplaySpread,
} from "./SpreadEditor";
import { insertSpreadAt, moveSpreadBefore } from "./pageOps";

export function PageFilmstrip({
  displays,
  activeId,
  onSelect,
  stale,
}: {
  displays: DisplaySpread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  stale: (pageId: string) => boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function cellIdAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest("[data-filmstrip-id]") as HTMLElement | null;
    return cell?.getAttribute("data-filmstrip-id") ?? null;
  }

  function handleMove(x: number, y: number) {
    if (!dragId) return;
    const id = cellIdAt(x, y);
    setOverId(id && id !== dragId ? id : null);
  }

  function handleUp(x: number, y: number) {
    if (dragId) {
      const dragged = displays.find((d) => d.id === dragId);
      const ids = dragged ? contentSpreadIds(dragged) : [];
      if (ids.length > 0) {
        const targetId = cellIdAt(x, y);
        const targetDisp = targetId ? displays.find((d) => d.id === targetId) ?? null : null;
        const beforeId = targetDisp ? contentSpreadIds(targetDisp)[0] ?? null : null;
        if (!ids.includes(beforeId ?? "")) moveSpreadBefore(ids, beforeId);
      }
    }
    setDragId(null);
    setOverId(null);
  }

  const lastInsert = displays.length ? displays[displays.length - 1].endInsertIndex : 0;

  return (
    <div className="flex h-full w-36 shrink-0 flex-col border-r border-ink-100 bg-white sm:w-44">
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 py-3">
        {displays.length === 0 && <InsertRow at={0} />}
        {displays.map((disp) => {
          const reorderable = contentSpreadIds(disp).length > 0;
          return (
            <FilmstripCell
              key={disp.id}
              disp={disp}
              active={disp.id === activeId}
              stale={stale}
              reorderable={reorderable}
              dragging={dragId === disp.id}
              dropBefore={overId === disp.id && dragId !== null && dragId !== disp.id}
              onSelect={() => onSelect(disp.id)}
              onGrabStart={() => reorderable && setDragId(disp.id)}
              onGrabMove={handleMove}
              onGrabEnd={handleUp}
              onGrabCancel={() => {
                setDragId(null);
                setOverId(null);
              }}
            />
          );
        })}
        {displays.length > 0 && <InsertRow at={lastInsert} />}
      </div>
    </div>
  );
}

function InsertRow({ at }: { at: number }) {
  return (
    <div className="group relative flex h-4 items-center justify-center">
      <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-ink-100" />
      <Popover
        align="center"
        trigger={
          <span className="relative z-10 flex size-5 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-400 shadow-soft transition hover:border-brand-300 hover:text-brand-600">
            <Plus className="size-3" />
          </span>
        }
        panelClassName="w-44"
      >
        {(close) => (
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => {
                insertSpreadAt(at);
                close();
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-ink-600 transition hover:bg-ink-50"
            >
              <Plus className="size-3.5" /> New page
            </button>
            <button
              onClick={() => {
                insertSpreadAt(at, { blankCanvas: true });
                close();
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-ink-600 transition hover:bg-ink-50"
            >
              <BookOpen className="size-3.5" /> Blank page
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}

function FilmstripCell({
  disp,
  active,
  stale,
  reorderable,
  dragging,
  dropBefore,
  onSelect,
  onGrabStart,
  onGrabMove,
  onGrabEnd,
  onGrabCancel,
}: {
  disp: DisplaySpread;
  active: boolean;
  stale: (pageId: string) => boolean;
  reorderable: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onGrabStart: () => void;
  onGrabMove: (x: number, y: number) => void;
  onGrabEnd: (x: number, y: number) => void;
  onGrabCancel: () => void;
}) {
  const status = useDisplayStatus(disp, stale);
  return (
    <div data-filmstrip-id={disp.id} className={cn("relative transition", dragging && "opacity-40")}>
      {dropBefore && (
        <span className="pointer-events-none absolute inset-x-1 -top-1 z-20 h-1 rounded-full bg-brand-500" />
      )}
      <button
        onClick={onSelect}
        title={disp.label}
        className={cn(
          "group relative block w-full overflow-hidden rounded-lg bg-white ring-2 transition",
          active ? "ring-brand-500" : "ring-ink-200 hover:ring-brand-300",
        )}
      >
        <div className="pointer-events-none">
          <SpreadThumbnail disp={disp} />
        </div>
        <StatusDot status={status} />
      </button>
      <p className="mt-0.5 truncate text-center text-[11px] font-medium text-ink-400">{disp.label}</p>
      {reorderable && (
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            onGrabStart();
          }}
          onPointerMove={(e) => {
            if (dragging) onGrabMove(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            if (dragging) onGrabEnd(e.clientX, e.clientY);
          }}
          onPointerCancel={onGrabCancel}
          title="Drag to reorder"
          className="absolute right-0.5 top-0.5 z-10 flex touch-none cursor-grab items-center rounded-md bg-white/90 p-1 text-ink-400 opacity-0 shadow-soft backdrop-blur transition hover:text-brand-600 active:cursor-grabbing group-hover:opacity-100"
        >
          <GripVertical className="size-3" />
        </button>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ReturnType<typeof useDisplayStatus> }) {
  if (status === "empty" || status === "ready") return null;
  const meta = {
    missing: { icon: Sparkles, cls: "bg-brand-500" },
    stale: { icon: RefreshCw, cls: "bg-accent-500" },
    generating: { icon: Loader2, cls: "bg-brand-500" },
  }[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "absolute right-1 top-1 flex size-4 items-center justify-center rounded-full text-white shadow-soft",
        meta.cls,
      )}
    >
      <Icon className={cn("size-2.5", status === "generating" && "animate-spin")} />
    </span>
  );
}