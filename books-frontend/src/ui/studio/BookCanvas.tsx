import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookText,
  Check,
  CheckCircle2,
  Eye,
  Grid3x3,
  Image as ImageIcon,
  Layers as LayersIcon,
  Loader2,
  Magnet,
  Maximize2,
  Redo2,
  RefreshCw,
  LayoutGrid,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Type,
  Undo2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { getCursor } from "../../core/versioning";
import { staleIllustrationSpreadIds } from "../../state/ai";
import { Button } from "../components/Button";
import { Drawer } from "../components/Drawer";
import { EmptyState } from "../components/EmptyState";
import { Popover } from "../components/Popover";
import { SparkEstimateCost } from "../layout/SparkCost";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";
import { AssetsLibrary } from "./AssetsLibrary";
import { CoverToolsDrawer } from "./CoverStudio";
import { ElementPanel, elementPanelHasContent } from "./ElementPanel";
import { PageFilmstrip } from "./PageFilmstrip";
import { PageControls, PageMenu, PageStagePanel } from "./PageEditorCard";
import { useStudio } from "./StudioContext";
import { refreshSpread } from "./studioGen";
import { useBookGeneration } from "./useBookGeneration";
import { BookPreview } from "./BookPreview";
import {
  buildDisplaySpreads,
  coverSideOf,
  displayEntries,
  FOLD_GRADIENT,
  HalfFrame,
  isBlankEntry,
  sideAspect,
  useEntryStatus,
  COVER_META,
  type DisplaySpread,
  type Entry,
  type SpreadSide,
} from "./SpreadEditor";

const SCREENPLAY_PHASES: PipelinePhase[] = [
  { id: "cast", label: "Casting characters & places", icon: Users },
  { id: "write", label: "Writing the page-by-page screenplay", icon: BookText },
  { id: "pages", label: "Laying out the pages", icon: LayoutGrid },
];

/** What the illustration drawer is currently scoped to. */
interface IllustratingTarget {
  entry: Entry;
  label: string;
}

export function BookCanvas() {
  const {
    project,
    pages,
    selection,
    select,
    editingDispId,
    setEditingDisp,
    undo,
    redo,
    setStep,
    openDesignSetup,
    openCoverStudio,
  } = useStudio();
  const models = useResolvedModels();
  const [previewing, setPreviewing] = useState(false);
  const [illustrating, setIllustrating] = useState<IllustratingTarget | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);

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

  // `editingDispId` doubles as "the spread currently open in the main stage" —
  // there's no separate review mode any more, so this is just page navigation.
  const activeId = editingDispId;
  const activeDisp = useMemo(
    () => displays.find((d) => d.id === activeId) ?? displays[0] ?? null,
    [displays, activeId],
  );
  useEffect(() => {
    if (displays.length === 0) return;
    if (!displays.some((d) => d.id === activeId)) setEditingDisp(displays[0].id);
  }, [displays, activeId, setEditingDisp]);

  const activePageId = useMemo(() => {
    if (selection.kind !== "none" && "pageId" in selection) return selection.pageId;
    return activeDisp ? displayEntries(activeDisp)[0]?.entry.page.id : undefined;
  }, [selection, activeDisp]);

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
        <div className="flex min-w-0 items-center gap-3">
          <NextActionChip />
        </div>
        <div className="flex items-center gap-1.5">
          {/* Undo / redo: available on every screen size. */}
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
          <span className="mx-0.5 h-5 w-px bg-ink-200" />
          {/* One labelled "View" menu for layers + editor aids, on every size. */}
          <ViewMenu
            layersOpen={layersOpen}
            onToggleLayers={() => {
              const elementSelected =
                selection.kind === "box" || selection.kind === "shape" || selection.kind === "image";
              if (elementSelected) select({ kind: "none" });
              setLayersOpen((v) => elementSelected || !v);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<SlidersHorizontal className="size-4" />}
            onClick={openDesignSetup}
            title="Book size, format & layout"
          >
            <span className="hidden sm:inline">Setup</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<BookText className="size-4" />}
            onClick={() => {
              // Jump the canvas to the front cover, then open the cover tools.
              if (displays.some((d) => d.id === "disp-front")) setEditingDisp("disp-front");
              openCoverStudio();
            }}
            title="Cover text & artwork tools"
          >
            <span className="hidden sm:inline">Covers</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Eye className="size-4" />}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </Button>
          <Button size="sm" leftIcon={<ShoppingCart className="size-4" />} onClick={() => setStep("order")}>
            <span className="hidden sm:inline">Order &amp; print</span>
            <span className="sm:hidden">Order</span>
          </Button>
        </div>
      </div>

      {/* Body: filmstrip + single big spread stage */}
      <div className="flex min-h-0 flex-1">
        <PageFilmstrip
          displays={displays}
          activeId={activeDisp?.id ?? null}
          onSelect={(id) => setEditingDisp(id)}
          stale={isStale}
        />

        <div className="relative min-h-0 flex-1">
          <div
            className="absolute inset-0 overflow-y-auto bg-grid px-4 py-8 sm:px-8"
            onMouseDown={(e) => {
              // Click anywhere in the empty canvas area (outside the page surface
              // and the floating element toolbox, which is a separate subtree) to
              // deselect. Clicks on the page itself are handled by the Konva stage.
              const elementSelected =
                selection.kind === "box" || selection.kind === "shape" || selection.kind === "image";
              if (!elementSelected) return;
              // React routes synthetic events through the component tree, so clicks
              // on portaled overlays (the floating text toolbar, colour popovers)
              // bubble here even though they live in document.body. Ignore anything
              // that isn't a real DOM descendant of this scroll area.
              if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
              if ((e.target as HTMLElement).closest("[data-editor-surface]")) return;
              select({ kind: "none" });
            }}
          >
            {activeDisp ? (
              <ActiveSpreadStage
                disp={activeDisp}
                stale={isStale}
                onOpenIllustration={(entry, label) => setIllustrating({ entry, label })}
              />
            ) : (
              <EmptyState icon={Sparkles} title="No pages yet" description="Add a page from the rail on the left." />
            )}
          </div>

          {activeDisp && (
            <AddDock activePageId={activePageId} onOpenIllustration={setIllustrating} activeDisp={activeDisp} />
          )}

          <div className="pointer-events-none absolute inset-x-3 bottom-24 z-40 flex justify-center sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:justify-end">
            <AnimatePresence>
              {elementPanelHasContent(selection, layersOpen) && (
                <ElementPanel
                  key="panel"
                  wantLayers={layersOpen}
                  activePageId={activePageId}
                  onClose={() => setLayersOpen(false)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <Drawer
        open={illustrating !== null}
        onClose={() => setIllustrating(null)}
        side="right"
        title="Illustration"
        widthClass="max-w-md"
      >
        {illustrating && (
          <div className="p-4">
            <PageControls
              page={illustrating.entry.page}
              subject={illustrating.entry.subject}
              anchors={anchors}
              stale={isStale(illustrating.entry.page.id)}
              label={illustrating.label}
            />
          </div>
        )}
      </Drawer>

      <CoverToolsDrawer />

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The single "View" menu: layers + the editor aids (snap / grid / print
 * guides). One labelled, discoverable place for all of these, available on
 * every screen size — replacing the desktop-only bare icon toggles.
 */
function ViewMenu({
  layersOpen,
  onToggleLayers,
}: {
  layersOpen: boolean;
  onToggleLayers: () => void;
}) {
  const { snap, grid, guides, toggleSnap, toggleGrid, toggleGuides } = useStudio();
  const anyOn = snap || grid || guides;
  return (
    <Popover
      side="bottom"
      align="end"
      panelClassName="w-60 p-1.5"
      trigger={
        <span
          title="Layers, snapping, grid & print guides"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium transition",
            anyOn || layersOpen
              ? "border-brand-200 bg-brand-50 text-brand-700"
              : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
          )}
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">View</span>
        </span>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          <ViewRow
            icon={<LayersIcon className="size-4" />}
            label="Layers on this page"
            active={layersOpen}
            onClick={() => {
              onToggleLayers();
              close();
            }}
          />
          <div className="my-1 h-px bg-ink-100" />
          <ViewRow
            icon={<Magnet className="size-4" />}
            label="Snap to guides"
            active={snap}
            onClick={toggleSnap}
          />
          <ViewRow icon={<Grid3x3 className="size-4" />} label="Grid" active={grid} onClick={toggleGrid} />
          <ViewRow
            icon={<SquareDashed className="size-4" />}
            label="Print guides"
            hint="Safe area + gutter"
            active={guides}
            onClick={toggleGuides}
          />
        </div>
      )}
    </Popover>
  );
}

function ViewRow({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-ink-50"
    >
      <span className="text-ink-400">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-sm font-medium text-ink-700">{label}</span>
        {hint && <span className="block text-[11px] text-ink-400">{hint}</span>}
      </span>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border transition",
          active ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300 text-transparent",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}

/**
 * The single "next best action" for the whole book, always visible in the
 * toolbar: generate what's missing → update what's stale → all set. Replaces
 * scattered per-panel batch buttons so there's exactly one place to look.
 */
function NextActionChip() {
  const gen = useBookGeneration();

  if (!gen.modelsReady) return null;

  if (gen.busy) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="hidden sm:inline">Illustrating your book…</span>
        <span className="sm:hidden">Illustrating…</span>
        <button
          onClick={gen.cancelGeneration}
          title="Cancel generation"
          className="ml-1 rounded-full p-1 text-brand-400 transition hover:bg-brand-100 hover:text-red-600"
        >
          <X className="size-3.5" />
        </button>
      </span>
    );
  }

  if (gen.pendingCount > 0) {
    return (
      <Button size="sm" leftIcon={<Sparkles className="size-4" />} onClick={() => void gen.generateEverything()}>
        <span className="hidden sm:inline">
          Generate {gen.pendingCount === 1 ? "1 illustration" : `${gen.pendingCount} illustrations`}
        </span>
        <span className="sm:hidden">Generate</span>
        <SparkEstimateCost range={gen.batchRange} />
      </Button>
    );
  }

  if (gen.staleCount > 0) {
    return (
      <Button
        size="sm"
        variant="secondary"
        loading={gen.refreshing}
        leftIcon={!gen.refreshing ? <RefreshCw className="size-4" /> : undefined}
        onClick={() => void gen.refreshStale()}
      >
        <span className="hidden sm:inline">
          {gen.refreshing ? "Updating…" : `Update ${gen.staleCount} stale ${gen.staleCount === 1 ? "item" : "items"}`}
        </span>
        <span className="sm:hidden">{gen.refreshing ? "Updating…" : `Update ${gen.staleCount}`}</span>
      </Button>
    );
  }

  if (gen.everythingDone) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:flex">
        <CheckCircle2 className="size-3.5" /> All pages ready
      </span>
    );
  }

  return null;
}

/**
 * The whole active spread, big and always interactive — a cover treatment for
 * covers, one wide frame for a true double-page spread, or two facing single
 * pages with a fold. A small floating chip sits above each live page: its
 * label, a one-tap generate/update action, and the entry point into the
 * illustration drawer.
 */
function ActiveSpreadStage({
  disp,
  stale,
  onOpenIllustration,
}: {
  disp: DisplaySpread;
  stale: (pageId: string) => boolean;
  onOpenIllustration: (entry: Entry, label: string) => void;
}) {
  if (disp.cover && disp.kind === "pair") {
    const side = coverSideOf(disp);
    const meta = COVER_META[disp.cover];
    if (!side || side.kind !== "page") {
      return (
        <div className="mx-auto w-full max-w-sm py-16 text-center text-sm text-ink-400">
          No {meta.title.toLowerCase()} yet.
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-3 flex justify-center">
          <PageChip
            entry={side.entry}
            label={meta.title}
            stale={stale}
            onOpenIllustration={() => onOpenIllustration(side.entry, meta.title)}
          />
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-white shadow-lifted ring-2 ring-brand-200">
          <PageStagePanel page={side.entry.page} subject={side.entry.subject} chromeless />
        </div>
        <p className="mt-3 text-center text-xs text-ink-400">{meta.hint}</p>
      </div>
    );
  }

  if (disp.kind === "full") {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex justify-center">
          <PageChip
            entry={disp.entry}
            label={disp.label}
            stale={stale}
            onOpenIllustration={() => onOpenIllustration(disp.entry, disp.label)}
          />
        </div>
        <div className="relative mx-auto overflow-hidden rounded-2xl bg-white shadow-lifted ring-1 ring-ink-200">
          <PageStagePanel page={disp.entry.page} subject={disp.entry.subject} chromeless />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SideChip side={disp.left} stale={stale} onOpenIllustration={onOpenIllustration} />
        <SideChip side={disp.right} stale={stale} onOpenIllustration={onOpenIllustration} />
      </div>
      <div className="relative mx-auto flex overflow-hidden rounded-2xl bg-white shadow-lifted ring-1 ring-ink-200">
        <HalfFrame side={disp.left} aspect={sideAspect(disp.left, disp.right)} half="left" />
        <HalfFrame side={disp.right} aspect={sideAspect(disp.left, disp.right)} half="right" />
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2"
          style={{ background: FOLD_GRADIENT }}
        />
      </div>
    </div>
  );
}

function SideChip({
  side,
  stale,
  onOpenIllustration,
}: {
  side: SpreadSide;
  stale: (pageId: string) => boolean;
  onOpenIllustration: (entry: Entry, label: string) => void;
}) {
  if (side.kind === "page") {
    return (
      <PageChip
        entry={side.entry}
        label={side.label}
        stale={stale}
        onOpenIllustration={() => onOpenIllustration(side.entry, side.label)}
      />
    );
  }
  if (side.kind === "filler") {
    return (
      <span className="rounded-full bg-ink-50 px-3 py-1.5 text-xs text-ink-400 ring-1 ring-ink-100">
        {side.label} · Blank
      </span>
    );
  }
  return <span aria-hidden />;
}

/** The floating per-page chip: label, one-tap generate/update, illustration drawer entry, page menu. */
function PageChip({
  entry,
  label,
  stale,
  onOpenIllustration,
}: {
  entry: Entry;
  label: string;
  stale: (pageId: string) => boolean;
  onOpenIllustration: () => void;
}) {
  const { project, setPageGenerating, makeIllustrationEditable, pageDesign } = useStudio();
  const blank = isBlankEntry(entry);
  const status = useEntryStatus(entry, stale);
  const page = entry.page;
  // Once there's real art on the page and it isn't already a movable element,
  // offer a visible way to reposition/crop it (the double-click gesture alone
  // is undiscoverable).
  const alreadyEditable = (pageDesign(page.id).images ?? []).some((im) => im.kind === "illustration");
  const canReposition = !blank && !alreadyEditable && (status === "ready" || status === "stale");

  async function quick(options: { useReference?: boolean } = {}) {
    setPageGenerating(page.id, true);
    try {
      await refreshSpread(project, page.id, options, (err) => notify.error(err));
    } finally {
      setPageGenerating(page.id, false);
    }
  }

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/95 px-2 py-1 shadow-soft ring-1 ring-ink-200 backdrop-blur-sm">
      <span className="truncate px-1 text-xs font-semibold text-ink-700">{label}</span>
      {!blank && (
        <>
          {status === "missing" && (
            <ChipButton title="Generate illustration" onClick={() => void quick()} tone="brand">
              <Sparkles className="size-3.5" />
            </ChipButton>
          )}
          {status === "stale" && (
            <ChipButton
              title="Update illustration"
              onClick={() => void quick({ useReference: true })}
              tone="accent"
            >
              <RefreshCw className="size-3.5" />
            </ChipButton>
          )}
          {status === "generating" && <Loader2 className="size-3.5 animate-spin text-brand-500" />}
          {status === "ready" && <Check className="size-3.5 text-emerald-500" />}
          {canReposition && (
            <ChipButton title="Move, resize or crop the art" onClick={() => makeIllustrationEditable(page.id)}>
              <Maximize2 className="size-3.5" />
            </ChipButton>
          )}
          <ChipButton title="Illustration, anchors & art direction" onClick={onOpenIllustration}>
            <Wand2 className="size-3.5" />
          </ChipButton>
        </>
      )}
      {entry.subject.kind === "spread" && <PageMenu spreadId={entry.subject.spread.id} />}
    </div>
  );
}

function ChipButton({
  children,
  onClick,
  title,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  tone?: "brand" | "accent";
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-full p-1.5 transition",
        tone === "brand" && "text-brand-600 hover:bg-brand-50",
        tone === "accent" && "text-accent-600 hover:bg-accent-50",
        !tone && "text-ink-400 hover:bg-ink-100 hover:text-ink-700",
      )}
    >
      {children}
    </button>
  );
}

/** Floating "Add" dock — the entry point for new text boxes & images, always
 * pinned near the bottom of the stage so it never competes with the canvas. */
function AddDock({
  activePageId,
  onOpenIllustration,
  activeDisp,
}: {
  activePageId?: string;
  onOpenIllustration: (t: IllustratingTarget) => void;
  activeDisp: DisplaySpread;
}) {
  const { addBox, addAssetImage, makeIllustrationEditable, pageDesign } = useStudio();
  const pageId = activePageId;
  // "Adjust art" only helps once there's a generated illustration to move; hide
  // it once the illustration has already been turned into a movable element.
  const alreadyEditable = pageId
    ? (pageDesign(pageId).images ?? []).some((im) => im.kind === "illustration")
    : false;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/95 p-1.5 shadow-lifted ring-1 ring-ink-200 backdrop-blur-sm">
        <DockButton
          icon={<Type className="size-4" />}
          label="Text"
          disabled={!pageId}
          onClick={() => pageId && addBox(pageId)}
        />
        <Popover
          side="top"
          align="center"
          panelClassName="w-64"
          trigger={
            <span className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100">
              <ImageIcon className="size-4" /> <span className="hidden sm:inline">Image</span>
            </span>
          }
        >
          <AssetsLibrary onPlace={pageId ? (asset) => addAssetImage(pageId, asset) : undefined} />
        </Popover>
        <DockButton
          icon={<Maximize2 className="size-4" />}
          label="Move art"
          title="Move, resize or crop the illustration"
          disabled={!pageId || alreadyEditable}
          onClick={() => pageId && makeIllustrationEditable(pageId)}
        />
        <span className="mx-0.5 h-5 w-px bg-ink-200" />
        <DockButton
          icon={<Wand2 className="size-4" />}
          label="Illustration"
          disabled={!activePageId}
          onClick={() => {
            const first = displayEntries(activeDisp)[0];
            if (first) onOpenIllustration({ entry: first.entry, label: first.label });
          }}
        />
      </div>
    </div>
  );
}

function DockButton({
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-40"
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </motion.button>
  );
}