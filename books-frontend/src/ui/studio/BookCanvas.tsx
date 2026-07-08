import { Fragment, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  BookText,
  Eye,
  Grid3x3,
  GripVertical,
  Magnet,
  Plus,
  Redo2,
  Rows3,
  LayoutGrid,
  Share2,
  ShoppingCart,
  Sparkles,
  SquareDashed,
  Undo2,
  Users,
} from "lucide-react";
import { COVER_BACK_ID, COVER_FRONT_ID, type Anchor } from "../../core/types";
import { getCursor } from "../../core/versioning";
import { staleIllustrationSpreadIds } from "../../state/ai";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { SharePanel } from "../share/SharePanel";
import { useStudio } from "./StudioContext";
import { BookPreview } from "./BookPreview";
import { insertSpreadAt, moveSpreadBefore } from "./pageOps";
import {
  buildDisplaySpreads,
  contentSpreadIds,
  SpreadCard,
  type DisplaySpread,
  type Entry,
} from "./SpreadEditor";

type ViewMode = "scroll" | "grid";

const SCREENPLAY_PHASES: PipelinePhase[] = [
  { id: "cast", label: "Casting characters & places", icon: Users },
  { id: "write", label: "Writing the page-by-page screenplay", icon: BookText },
  { id: "pages", label: "Laying out the pages", icon: LayoutGrid },
];

export function BookCanvas() {
  const { project, pages, design, undo, redo, snap, grid, guides, toggleSnap, toggleGrid, toggleGuides, setStep } =
    useStudio();
  const models = useResolvedModels();
  const [view, setView] = useState<ViewMode>("scroll");
  const [previewing, setPreviewing] = useState(false);
  const [sharing, setSharing] = useState(false);

  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const anchors = (project.anchors ?? []).filter((a) => a.include);
  const staleIds = useMemo(() => new Set(staleIllustrationSpreadIds(project)), [project]);
  const isStale = (pageId: string) => staleIds.has(pageId);

  const entries = useMemo<Entry[]>(() => {
    if (!doc) return [];
    const spreadById = new Map(doc.spreads.map((s) => [s.id, s]));
    const out: Entry[] = [];
    for (const page of pages) {
      if (page.id === COVER_FRONT_ID && doc.frontCover) {
        out.push({ page, subject: { kind: "cover", coverId: COVER_FRONT_ID, cover: doc.frontCover } });
      } else if (page.id === COVER_BACK_ID && doc.backCover) {
        out.push({ page, subject: { kind: "cover", coverId: COVER_BACK_ID, cover: doc.backCover } });
      } else {
        const spread = spreadById.get(page.id);
        if (spread) out.push({ page, subject: { kind: "spread", spread } });
      }
    }
    return out;
  }, [doc, pages]);

  const displays = useMemo<DisplaySpread[]>(
    () => (doc ? buildDisplaySpreads(doc, entries) : []),
    [doc, entries],
  );

  if (!doc) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-aurora">
        {models ? (
          <PipelineStepper
            title="Drafting your book…"
            subtitle="We're turning your story into a page-by-page screenplay. Characters & places appear in the sidebar as they're found."
            phases={SCREENPLAY_PHASES}
            activeIndex={1}
          />
        ) : (
          <EmptyState
            icon={Sparkles}
            title="AI generation is being set up"
            description="Once it's ready, the studio analyzes your story and drafts the whole book automatically."
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink-100 bg-white/70 px-3 py-2.5 backdrop-blur sm:px-5">
        <ViewToggle view={view} onChange={setView} />
        <div className="flex items-center gap-1.5">
          {/* Editor aids (snap / grid / print guides): desktop-only fine-tuning. */}
          <div className="hidden items-center gap-1.5 md:flex">
            <button
              onClick={toggleSnap}
              title={snap ? "Snapping on" : "Snapping off"}
              className={cn(
                "rounded-lg p-2 transition hover:bg-ink-100",
                snap ? "bg-brand-50 text-brand-600" : "text-ink-400 hover:text-ink-800",
              )}
            >
              <Magnet className="size-4" />
            </button>
            <button
              onClick={toggleGrid}
              title={grid ? "Grid on" : "Grid off"}
              className={cn(
                "rounded-lg p-2 transition hover:bg-ink-100",
                grid ? "bg-brand-50 text-brand-600" : "text-ink-400 hover:text-ink-800",
              )}
            >
              <Grid3x3 className="size-4" />
            </button>
            <button
              onClick={toggleGuides}
              title={guides ? "Print guides on (safe area + gutter)" : "Print guides off"}
              className={cn(
                "rounded-lg p-2 transition hover:bg-ink-100",
                guides ? "bg-brand-50 text-brand-600" : "text-ink-400 hover:text-ink-800",
              )}
            >
              <SquareDashed className="size-4" />
            </button>
            <span className="mx-0.5 h-5 w-px bg-ink-200" />
          </div>
          {/* Undo / redo: shown from small screens up. */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <button
              onClick={undo}
              title="Undo"
              className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              onClick={redo}
              title="Redo"
              className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
            >
              <Redo2 className="size-4" />
            </button>
          </div>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Eye className="size-4" />}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="hidden sm:inline-flex"
            leftIcon={<Share2 className="size-4" />}
            onClick={() => setSharing(true)}
          >
            Share
          </Button>
          <Button
            size="sm"
            leftIcon={<ShoppingCart className="size-4" />}
            onClick={() => setStep("order")}
          >
            <span className="hidden sm:inline">Order &amp; print</span>
            <span className="sm:hidden">Order</span>
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {view === "scroll" && (
          <div className="mx-auto w-full max-w-5xl px-5 py-6">
            {displays.length === 0 && <InsertBar at={0} />}
            {displays.map((disp) => (
              <Fragment key={disp.id}>
                <SpreadCard disp={disp} anchors={anchors} stale={isStale} />
                <InsertBar at={disp.endInsertIndex} />
              </Fragment>
            ))}
          </div>
        )}

        {view === "grid" && (
          <PageGrid displays={displays} anchors={anchors} stale={isStale} />
        )}
      </div>

      <SharePanel
        open={sharing}
        onClose={() => setSharing(false)}
        project={project}
        pages={pages}
        design={design}
      />

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Insert a new page (or a blank page) at `at`. On touch the buttons stay
 * visible (no hover); on pointer devices they fade in on hover to keep the
 * canvas calm.
 */
function InsertBar({ at }: { at: number }) {
  return (
    <div className="group relative flex h-9 items-center justify-center md:h-7">
      <div className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-ink-200 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100" />
      <div className="relative flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <button
          onClick={() => insertSpreadAt(at)}
          className="flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 shadow-soft transition hover:border-brand-300 hover:text-brand-600"
        >
          <Plus className="size-3.5" /> Page
        </button>
        <button
          onClick={() => insertSpreadAt(at, { blankCanvas: true })}
          className="flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 shadow-soft transition hover:border-brand-300 hover:text-brand-600"
        >
          <BookOpen className="size-3.5" /> Blank
        </button>
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const items: { id: ViewMode; label: string; icon: typeof Rows3 }[] = [
    { id: "scroll", label: "Scroll", icon: Rows3 },
    { id: "grid", label: "Grid", icon: LayoutGrid },
  ];
  return (
    <div className="inline-flex rounded-xl bg-ink-100 p-1">
      {items.map((it) => {
        const active = it.id === view;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "text-ink-900" : "text-ink-500 hover:text-ink-700",
            )}
          >
            {active && (
              <motion.span
                layoutId="studio-view-toggle"
                className="absolute inset-0 rounded-lg bg-white shadow-soft"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Icon className="size-4" />
              <span className="hidden sm:inline">{it.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Editable two-column layout of the book's spreads. Every spread is the full
 * editor (art + text/shape tools), so you can add elements and refine layout
 * without leaving the overview. Interior pages can be dragged (by the handle) to
 * a new position; covers stay pinned to the ends. A live indicator shows exactly
 * where the dragged page will land.
 */
function PageGrid({
  displays,
  anchors,
  stale,
}: {
  displays: DisplaySpread[];
  anchors: Anchor[];
  stale: (pageId: string) => boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // The spread id currently under the pointer (via hit-testing), or null when
  // the pointer is past the last cell (⇒ drop at the end).
  function cellIdAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest("[data-spread-id]") as HTMLElement | null;
    return cell?.getAttribute("data-spread-id") ?? null;
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

  function handleCancel() {
    setDragId(null);
    setOverId(null);
  }

  const lastInsert = displays.length ? displays[displays.length - 1].endInsertIndex : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <p className="mb-3 flex items-center justify-center gap-1.5 text-xs text-ink-400">
        <LayoutGrid className="size-3.5" /> Edit any page inline · drag the handle to reorder
      </p>
      {displays.length === 0 && <InsertBar at={0} />}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        {displays.map((disp) => {
          const reorderable = contentSpreadIds(disp).length > 0;
          return (
            <GridCell
              key={disp.id}
              disp={disp}
              anchors={anchors}
              stale={stale}
              reorderable={reorderable}
              dragging={dragId === disp.id}
              dropBefore={overId === disp.id && dragId !== null && dragId !== disp.id}
              onGrabStart={() => reorderable && setDragId(disp.id)}
              onGrabMove={handleMove}
              onGrabEnd={handleUp}
              onGrabCancel={handleCancel}
            />
          );
        })}
      </div>
      {displays.length > 0 && (
        <div className="mt-4">
          <InsertBar at={lastInsert} />
        </div>
      )}
    </div>
  );
}

/**
 * One editable spread in the grid. The card itself stays fully interactive; only
 * the dedicated handle starts a reorder drag, so tapping text to edit it never
 * gets hijacked. Reordering uses pointer events + pointer capture (not the
 * HTML5 drag API), so it works with a mouse AND on touch screens.
 */
function GridCell({
  disp,
  anchors,
  stale,
  reorderable,
  dragging,
  dropBefore,
  onGrabStart,
  onGrabMove,
  onGrabEnd,
  onGrabCancel,
}: {
  disp: DisplaySpread;
  anchors: Anchor[];
  stale: (pageId: string) => boolean;
  reorderable: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onGrabStart: () => void;
  onGrabMove: (x: number, y: number) => void;
  onGrabEnd: (x: number, y: number) => void;
  onGrabCancel: () => void;
}) {
  return (
    <div
      data-spread-id={disp.id}
      className={cn("relative transition", dragging && "opacity-40")}
    >
      {dropBefore && (
        <span className="pointer-events-none absolute inset-y-0 -left-2.5 z-20 w-1 rounded-full bg-brand-500" />
      )}
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
          onPointerCancel={() => {
            if (dragging) onGrabCancel();
          }}
          title="Drag to reorder"
          className="absolute right-3 top-3 z-10 flex touch-none cursor-grab items-center rounded-lg border border-ink-200 bg-white/90 p-1.5 text-ink-400 shadow-soft backdrop-blur transition hover:border-brand-300 hover:text-brand-600 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <SpreadCard disp={disp} anchors={anchors} stale={stale} />
    </div>
  );
}
