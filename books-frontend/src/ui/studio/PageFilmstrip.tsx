/**
 * The left-hand page rail — the primary way to move around the book. It
 * replaces the old scroll/grid view toggle: there's only ever one view now
 * (a big single spread in the main stage), and this rail is how you jump
 * between pages, see at a glance what still needs art, reorder by dragging,
 * and insert new pages.
 *
 * Width is user-resizable (drag the right edge) and persisted locally.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Popover } from "../components/Popover";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/cn";
import {
  contentSpreadIds,
  displayNeedsAttention,
  SpreadThumbnail,
  useDisplayStatuses,
  type DisplaySpread,
  type UnitStatus,
} from "./SpreadEditor";
import { insertSpreadAt, moveSpreadBefore } from "./pageOps";

const WIDTH_KEY = "childbooks.filmstripWidth";
const WIDTH_MIN = 140;
const WIDTH_MAX = 280;
const WIDTH_DEFAULT = 176;

function readStoredWidth(): number {
  if (typeof window === "undefined") return WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return WIDTH_DEFAULT;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(n)));
}

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
  const [width, setWidth] = useState(WIDTH_DEFAULT);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const resizing = useRef<{ startX: number; startW: number } | null>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const statuses = useDisplayStatuses(displays, stale);
  const attentionDisplays = useMemo(
    () => displays.filter((disp) => displayNeedsAttention(disp, stale)),
    [displays, stale],
  );
  const visibleDisplays = filter === "attention" ? attentionDisplays : displays;
  const movableDisplays = useMemo(
    () => displays.filter((disp) => contentSpreadIds(disp).length > 0),
    [displays],
  );

  useEffect(() => {
    if (
      filter !== "attention" ||
      attentionDisplays.length === 0 ||
      attentionDisplays.some((disp) => disp.id === activeId)
    ) {
      return;
    }
    onSelect(attentionDisplays[0].id);
  }, [activeId, attentionDisplays, filter, onSelect]);

  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

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

  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizing.current = { startX: e.clientX, startW: width };
  }

  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing.current) return;
    const next = Math.min(
      WIDTH_MAX,
      Math.max(WIDTH_MIN, Math.round(resizing.current.startW + (e.clientX - resizing.current.startX))),
    );
    setWidth(next);
  }

  function endResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing.current) return;
    const next = Math.min(
      WIDTH_MAX,
      Math.max(
        WIDTH_MIN,
        Math.round(resizing.current.startW + (e.clientX - resizing.current.startX)),
      ),
    );
    resizing.current = null;
    setWidth(next);
    window.localStorage.setItem(WIDTH_KEY, String(next));
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  const lastInsert = displays.length ? displays[displays.length - 1].endInsertIndex : 0;

  const list = (
    <>
      <div
        className={cn(
          "shrink-0 border-b border-ink-100",
          isMobile ? "px-2 py-1.5" : "px-2.5 py-2",
        )}
      >
        <div className={cn("grid grid-cols-2 rounded-lg bg-ink-50 p-0.5", isMobile && "max-w-56")}>
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterButton>
          <FilterButton
            active={filter === "attention"}
            count={attentionDisplays.length}
            onClick={() => setFilter("attention")}
          >
            Issues
          </FilterButton>
        </div>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1",
          isMobile
            ? "flex items-start gap-2 overflow-x-auto px-2 py-2"
            : "space-y-1.5 overflow-y-auto px-2.5 py-3",
        )}
      >
        {filter === "all" && displays.length === 0 && (
          <InsertRow at={0} horizontal={isMobile} />
        )}
        {filter === "attention" && visibleDisplays.length === 0 && (
          <div
            className={cn(
              "flex flex-col items-center gap-1.5 px-2 text-center",
              isMobile ? "min-w-full py-2" : "py-6",
            )}
          >
            <CheckCircle2 className="size-5 text-emerald-500" />
            <p className="text-xs font-semibold text-ink-600">All pages are ready</p>
            <p className="text-[11px] leading-snug text-ink-400">
              Missing or outdated pages will appear here.
            </p>
          </div>
        )}
        {visibleDisplays.map((disp) => {
          const reorderable =
            filter === "all" && contentSpreadIds(disp).length > 0;
          const moveIndex = movableDisplays.findIndex((item) => item.id === disp.id);
          const moveEarlier = () => {
            if (moveIndex <= 0) return;
            const ids = contentSpreadIds(disp);
            const beforeId = contentSpreadIds(movableDisplays[moveIndex - 1])[0] ?? null;
            moveSpreadBefore(ids, beforeId);
          };
          const moveLater = () => {
            if (moveIndex < 0 || moveIndex >= movableDisplays.length - 1) return;
            const ids = contentSpreadIds(disp);
            const afterNext = movableDisplays[moveIndex + 2];
            const beforeId = afterNext ? contentSpreadIds(afterNext)[0] ?? null : null;
            moveSpreadBefore(ids, beforeId);
          };
          return (
            <FilmstripCell
              key={disp.id}
              disp={disp}
              active={disp.id === activeId}
              status={statuses.get(disp.id) ?? "ready"}
              horizontal={isMobile}
              reorderable={reorderable}
              canMoveEarlier={reorderable && moveIndex > 0}
              canMoveLater={reorderable && moveIndex < movableDisplays.length - 1}
              onMoveEarlier={moveEarlier}
              onMoveLater={moveLater}
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
        {filter === "all" && displays.length > 0 && (
          <InsertRow at={lastInsert} horizontal={isMobile} />
        )}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-col bg-white",
        isMobile
          ? "h-28 w-full border-b border-ink-100"
          : "h-full border-r border-ink-100",
      )}
      style={isMobile ? undefined : { width }}
    >
      {list}
      {!isMobile && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuemin={WIDTH_MIN}
          aria-valuemax={WIDTH_MAX}
          aria-valuenow={width}
          aria-label="Resize page list"
          title="Drag or use arrow keys to resize"
          className="group absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          onKeyDown={(e) => {
            let next = width;
            if (e.key === "ArrowLeft") next = width - 8;
            else if (e.key === "ArrowRight") next = width + 8;
            else if (e.key === "Home") next = WIDTH_MIN;
            else if (e.key === "End") next = WIDTH_MAX;
            else return;
            e.preventDefault();
            const clamped = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, next));
            setWidth(clamped);
            window.localStorage.setItem(WIDTH_KEY, String(clamped));
          }}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <span className="w-px bg-transparent transition group-hover:bg-brand-300 group-active:bg-brand-400" />
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count?: number;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-8 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        active ? "bg-white text-brand-700 shadow-soft" : "text-ink-500 hover:text-ink-700",
      )}
    >
      {children}
      {count != null && count > 0 && (
        <span className="min-w-4 rounded-full bg-amber-100 px-1 text-center text-[10px] tabular-nums text-amber-800">
          {count}
        </span>
      )}
    </button>
  );
}

function InsertRow({ at, horizontal = false }: { at: number; horizontal?: boolean }) {
  return (
    <div
      className={cn(
        "group relative flex items-center justify-center",
        horizontal ? "h-full min-h-16 w-8 shrink-0 self-stretch" : "h-4",
      )}
    >
      <div
        className={cn(
          "absolute bg-ink-100",
          horizontal
            ? "inset-y-2 left-1/2 w-px -translate-x-1/2"
            : "inset-x-3 top-1/2 h-px -translate-y-1/2",
        )}
      />
      <Popover
        align="center"
        side={horizontal ? "bottom" : "top"}
        trigger={
          <span className="relative z-10 flex size-7 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-400 shadow-soft transition hover:border-brand-300 hover:text-brand-600 group-focus-visible:ring-2 group-focus-visible:ring-brand-400">
            <Plus className="size-3" />
            <span className="sr-only">Insert page here</span>
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
  status,
  horizontal,
  reorderable,
  canMoveEarlier,
  canMoveLater,
  dragging,
  dropBefore,
  onSelect,
  onGrabStart,
  onGrabMove,
  onGrabEnd,
  onGrabCancel,
  onMoveEarlier,
  onMoveLater,
}: {
  disp: DisplaySpread;
  active: boolean;
  status: UnitStatus;
  horizontal: boolean;
  reorderable: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onGrabStart: () => void;
  onGrabMove: (x: number, y: number) => void;
  onGrabEnd: (x: number, y: number) => void;
  onGrabCancel: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
}) {
  const statusLabel =
    status === "generating"
      ? "Generating"
      : status === "missing"
        ? "Needs illustration"
        : status === "stale"
          ? "Illustration needs updating"
          : status === "empty"
            ? "Intentionally blank"
            : "Ready";
  return (
    <div
      data-filmstrip-id={disp.id}
      className={cn(
        "group relative transition",
        horizontal && "w-16 shrink-0",
        dragging && "opacity-40",
      )}
    >
      {dropBefore && (
        <span
          className={cn(
            "pointer-events-none absolute z-20 rounded-full bg-brand-500",
            horizontal
              ? "-left-1 inset-y-1 w-1"
              : "inset-x-1 -top-1 h-1",
          )}
        />
      )}
      <button
        onClick={onSelect}
        title={disp.label}
        aria-label={`${disp.label}. ${statusLabel}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative block w-full overflow-hidden rounded-lg bg-white ring-2 transition focus-visible:outline-none focus-visible:ring-brand-500 focus-visible:ring-offset-2",
          active ? "ring-brand-500" : "ring-ink-200 hover:ring-brand-300",
        )}
      >
        <div className="pointer-events-none">
          <SpreadThumbnail disp={disp} />
        </div>
        <StatusDot status={status} />
      </button>
      <p className="mt-0.5 truncate text-center text-[11px] font-medium text-ink-400">
        {disp.label}
      </p>
      {reorderable && (
        <div
          className={cn(
            "absolute left-0.5 top-0.5 z-10",
            horizontal
              ? "opacity-100"
              : "opacity-0 transition group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          <Popover
            align="start"
            panelClassName="w-40 p-1.5"
            trigger={
              <span className="flex size-6 items-center justify-center rounded-md bg-white/90 text-ink-400 shadow-soft backdrop-blur transition hover:text-brand-600 group-focus-visible:ring-2 group-focus-visible:ring-brand-400">
                <MoreHorizontal className="size-3.5" />
                <span className="sr-only">Reorder {disp.label}</span>
              </span>
            }
          >
            {(close) => (
              <div className="space-y-0.5">
                <MoveButton
                  icon={
                    horizontal ? (
                      <ArrowLeft className="size-3.5" />
                    ) : (
                      <ArrowUp className="size-3.5" />
                    )
                  }
                  label="Move earlier"
                  disabled={!canMoveEarlier}
                  onClick={() => {
                    onMoveEarlier();
                    close();
                  }}
                />
                <MoveButton
                  icon={
                    horizontal ? (
                      <ArrowRight className="size-3.5" />
                    ) : (
                      <ArrowDown className="size-3.5" />
                    )
                  }
                  label="Move later"
                  disabled={!canMoveLater}
                  onClick={() => {
                    onMoveLater();
                    close();
                  }}
                />
              </div>
            )}
          </Popover>
        </div>
      )}
      {reorderable && !horizontal && (
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
          aria-label={`Drag ${disp.label} to reorder`}
          className={cn(
            "absolute right-0.5 top-0.5 z-10 flex min-h-6 min-w-6 touch-none cursor-grab items-center justify-center rounded-md bg-white/90 p-1 text-ink-400 shadow-soft backdrop-blur transition hover:text-brand-600 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 active:cursor-grabbing",
            horizontal ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <GripVertical className="size-3" />
        </button>
      )}
    </div>
  );
}

function MoveButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-ink-600 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-35"
    >
      {icon}
      {label}
    </button>
  );
}

function StatusDot({ status }: { status: UnitStatus }) {
  if (status === "empty" || status === "ready") return null;
  const meta = {
    missing: { icon: Sparkles, cls: "bg-brand-500" },
    stale: { icon: RefreshCw, cls: "bg-accent-500" },
    generating: { icon: Loader2, cls: "bg-brand-500" },
  }[status];
  const Icon = meta.icon;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute right-1 top-1 flex size-4 items-center justify-center rounded-full text-white shadow-soft",
        meta.cls,
      )}
    >
      <Icon className={cn("size-2.5", status === "generating" && "animate-spin")} />
    </span>
  );
}
