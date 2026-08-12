import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookText,
  Check,
  CheckCircle2,
  Eye,
  History,
  Image as ImageIcon,
  Layers as LayersIcon,
  LayoutTemplate,
  Loader2,
  Redo2,
  RefreshCw,
  LayoutGrid,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Type,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { getCursor } from "../../core/versioning";
import { staleIllustrationSpreadIds } from "../../state/ai";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Popover } from "../components/Popover";
import { SparkEstimateCost } from "../layout/SparkCost";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";
import { AssetsLibrary } from "./AssetsLibrary";
import { useDesignChapterHosts } from "./DesignChapterHosts";
import { ElementPanel, elementPanelHasContent } from "./ElementPanel";
import { PageFilmstrip } from "./PageFilmstrip";
import { PageMenu, PageStagePanel } from "./PageEditorCard";
import { PairPageStagePanel } from "./PairPageStage";
import { useStudio } from "./StudioContext";
import { useStudioPanelStore, type StudioToolPanel } from "./studioPanelStore";
import { refreshSpread, updateAnchorsThenSpread } from "./studioGen";
import { useBookGeneration } from "./useBookGeneration";
import { BookPreview } from "./BookPreview";
import { changedAnchorsForSpread, staleAnchorIds } from "../../state/ai";
import {
  buildDisplaySpreads,
  coverSideOf,
  displayEntries,
  FOLD_GRADIENT,
  HalfFrame,
  isBlankEntry,
  isPlainPagePair,
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

export function BookCanvas() {
  const {
    project,
    pages,
    selection,
    select,
    selectIllustration,
    editingDispId,
    setEditingDisp,
    undo,
    redo,
    setStep,
    openDesignSetup,
  } = useStudio();
  const textEditSection = useStudioPanelStore((s) => s.textEditSection);
  const imageEditSection = useStudioPanelStore((s) => s.imageEditSection);
  const toolPanel = useStudioPanelStore((s) => s.toolPanel);
  const closeImageEdit = useStudioPanelStore((s) => s.closeImageEdit);
  const closeTextEdit = useStudioPanelStore((s) => s.closeTextEdit);
  const closeToolPanel = useStudioPanelStore((s) => s.closeToolPanel);
  const toggleToolPanel = useStudioPanelStore((s) => s.toggleToolPanel);
  const chapterHosts = useDesignChapterHosts();
  const models = useResolvedModels();
  const [previewing, setPreviewing] = useState(false);

  /** Toggle docked illustration tools for a page (same control opens/closes). */
  const openIllustrationTools = useCallback(
    (entry: Entry, section: "refine" | "characters" | "scene" = "refine") => {
      const pageId = entry.page.id;
      const panel = useStudioPanelStore.getState();
      const alreadyOpen =
        (selection.kind === "image" || selection.kind === "page") &&
        selection.pageId === pageId &&
        panel.imageEditSection === section;
      if (alreadyOpen) {
        panel.closeImageEdit();
        return;
      }
      // With art: select/create the illustration frame. Without art: select the
      // page only and purge empty ghost frames — never invent a croppable
      // empty illustration just to open the toolbox.
      selectIllustration(pageId);
      panel.openImageEdit(section);
    },
    [selection, selectIllustration],
  );

  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const staleIds = useMemo(() => new Set(staleIllustrationSpreadIds(project)), [project]);
  const isStale = useCallback((pageId: string) => staleIds.has(pageId), [staleIds]);

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

  /** Every live page on the open canvas — powers the Arrange panel. */
  const arrangePages = useMemo(() => {
    if (!activeDisp) return [];
    return displayEntries(activeDisp).map(({ entry, label }) => ({
      id: entry.page.id,
      label,
    }));
  }, [activeDisp]);

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
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<SlidersHorizontal className="size-4" />}
            onClick={() => toggleToolPanel("view")}
            title="Snapping, grid & print guides"
            aria-pressed={toolPanel === "view"}
            className={
              toolPanel === "view"
                ? "border-brand-200 bg-brand-50 text-brand-700 ring-brand-200"
                : undefined
            }
          >
            <span className="hidden sm:inline">View</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<LayoutTemplate className="size-4" />}
            onClick={openDesignSetup}
            title="Book size"
            aria-pressed={toolPanel === "setup"}
            className={
              toolPanel === "setup"
                ? "border-brand-200 bg-brand-50 text-brand-700 ring-brand-200"
                : undefined
            }
          >
            <span className="hidden sm:inline">Setup</span>
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

      {/* Body: filmstrip (portaled into Design chapter rail when hosted) + stage */}
      <div className="flex min-h-0 flex-1">
        {(() => {
          const inChapters = chapterHosts !== null;
          const filmstrip = (
            <PageFilmstrip
              embedded={inChapters}
              displays={displays}
              activeId={activeDisp?.id ?? null}
              onSelect={(id) => setEditingDisp(id)}
              stale={isStale}
            />
          );
          if (!inChapters) return filmstrip;
          return chapterHosts.pagesHost
            ? createPortal(filmstrip, chapterHosts.pagesHost)
            : null;
        })()}

        {/* Stage + inspector dock as siblings so the panel never covers chips. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              className="absolute inset-0 flex flex-col bg-grid px-3 pb-20 pt-3 sm:px-5 sm:pt-4"
              onMouseDown={(e) => {
                // Click anywhere in the empty canvas area (outside the page surface
                // and the floating element toolbox, which is a separate subtree) to
                // deselect. Clicks on the page itself are handled by the Konva stage.
                const elementSelected =
                  selection.kind === "box" ||
                  selection.kind === "shape" ||
                  selection.kind === "image";
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
                  onOpenIllustration={(entry) => openIllustrationTools(entry)}
                />
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <EmptyState
                    icon={Sparkles}
                    title="No pages yet"
                    description="Add a page from the rail on the left."
                  />
                </div>
              )}
            </div>

            {activeDisp && (
              <AddDock
                activePageId={activePageId}
                toolPanel={toolPanel}
                onToggleTool={toggleToolPanel}
              />
            )}
          </div>

          <AnimatePresence>
            {elementPanelHasContent(
              selection,
              toolPanel,
              !!textEditSection,
              !!imageEditSection,
            ) && (
              <InspectorDock key="inspector-dock">
                <ElementPanel
                  toolPanel={toolPanel}
                  arrangePages={arrangePages}
                  onClose={() => {
                    closeToolPanel();
                    closeTextEdit();
                    closeImageEdit();
                  }}
                />
              </InspectorDock>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

const INSPECTOR_DOCK_W = 320; // Tailwind w-80

/**
 * Layout-docked inspector. Width snaps in one step (no spring) so the Konva
 * stage ResizeObserver fires once — animating width was re-laying out the
 * canvas every animation frame and felt laggy when opening tools.
 *
 * Below `md` a 320px docked column would leave little to no room for the
 * canvas next to the chapter rail, so it becomes a full-width bottom sheet
 * instead — overlaid on top of the stage rather than sharing its width.
 */
function InspectorDock({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery("(max-width: 767px)");

  if (isMobile) {
    return (
      <motion.aside
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        // Fixed (not `max-h`) height — `PanelShell` fills its parent with
        // `h-full`, which needs a definite height to resolve against.
        className="fixed inset-x-0 bottom-0 z-40 h-[75vh] overflow-hidden rounded-t-3xl border-t border-ink-100 bg-white shadow-lifted"
      >
        <div className="flex h-full flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
      </motion.aside>
    );
  }

  return (
    <motion.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      className="h-full min-h-0 shrink-0 self-stretch overflow-hidden border-l border-ink-100 bg-white"
      style={{ width: INSPECTOR_DOCK_W }}
    >
      <div className="flex h-full min-h-0 flex-col" style={{ width: INSPECTOR_DOCK_W }}>
        {children}
      </div>
    </motion.aside>
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
 * The whole active spread, sized to fill the stage (Canva-style fit) — a cover
 * treatment for covers, one wide frame for a true double-page spread, or two
 * facing single pages with a fold. A small chip sits above each live page with
 * contextual art actions.
 */
const ActiveSpreadStage = memo(function ActiveSpreadStage({
  disp,
  stale,
  onOpenIllustration,
}: {
  disp: DisplaySpread;
  stale: (pageId: string) => boolean;
  onOpenIllustration: (entry: Entry) => void;
}) {
  if (disp.cover && disp.kind === "pair") {
    const side = coverSideOf(disp);
    const meta = COVER_META[disp.cover];
    if (!side || side.kind !== "page") {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-400">
          No {meta.title.toLowerCase()} yet.
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="relative z-10 mb-2 flex shrink-0 justify-center"
          data-floating-bar-obstacle
        >
          <PageChip
            entry={side.entry}
            label={meta.title}
            stale={stale}
            onOpenIllustration={() => onOpenIllustration(side.entry)}
          />
        </div>
        <StageFitFrame ring="brand">
          <PageStagePanel
            page={side.entry.page}
            subject={side.entry.subject}
            chromeless
            fitParent
          />
        </StageFitFrame>
        <p className="mt-2 shrink-0 text-center text-xs text-ink-400">{meta.hint}</p>
      </div>
    );
  }

  if (disp.kind === "full") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="relative z-10 mb-2 flex shrink-0 justify-center"
          data-floating-bar-obstacle
        >
          <PageChip
            entry={disp.entry}
            label={disp.label}
            stale={stale}
            onOpenIllustration={() => onOpenIllustration(disp.entry)}
          />
        </div>
        <StageFitFrame>
          <PageStagePanel
            page={disp.entry.page}
            subject={disp.entry.subject}
            chromeless
            fitParent
          />
        </StageFitFrame>
      </div>
    );
  }

  const pairAspect = sideAspect(disp.left, disp.right) * 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="relative z-10 mb-2 flex shrink-0 items-center justify-between gap-3"
        data-floating-bar-obstacle
      >
        <SideChip side={disp.left} stale={stale} onOpenIllustration={onOpenIllustration} />
        <SideChip side={disp.right} stale={stale} onOpenIllustration={onOpenIllustration} />
      </div>
      <StageFitFrame aspect={pairAspect}>
        <div className="relative flex h-full w-full">
          {isPlainPagePair(disp) ? (
            // Two ordinary facing pages share one interactive canvas so an
            // element can be dragged straight across the fold (e.g. page 4 → 5
            // on the same sheet) instead of stopping at the page edge.
            <PairPageStagePanel left={disp.left.entry} right={disp.right.entry} />
          ) : (
            <>
              <HalfFrame side={disp.left} aspect={sideAspect(disp.left, disp.right)} half="left" />
              <HalfFrame side={disp.right} aspect={sideAspect(disp.left, disp.right)} half="right" />
            </>
          )}
          <div
            className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2"
            style={{ background: FOLD_GRADIENT }}
          />
        </div>
      </StageFitFrame>
    </div>
  );
});

/**
 * Host that fills the stage. Single pages: `data-stage-fit` on the host so
 * PageStage can contain-fit. Facing pairs: pass `aspect` to size the chrome
 * box; children then fill that box.
 */
function StageFitFrame({
  children,
  aspect,
  ring = "ink",
}: {
  children: React.ReactNode;
  /** When set, sizes the chrome box to this aspect (e.g. facing pair). */
  aspect?: number;
  ring?: "ink" | "brand";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (aspect == null) {
      setBox(null);
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const pw = host.clientWidth;
      const ph = host.clientHeight;
      if (pw <= 0 || ph <= 0) return;
      let w = pw;
      let h = w / aspect;
      if (h > ph) {
        h = ph;
        w = h * aspect;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [aspect]);

  const chromeCls = cn(
    "overflow-hidden bg-white shadow-lifted",
    ring === "brand" ? "ring-2 ring-brand-200" : "ring-1 ring-ink-200",
    aspect == null && "w-max max-h-full max-w-full",
  );

  return (
    <div
      ref={hostRef}
      data-stage-fit={aspect == null ? "" : undefined}
      className="relative flex min-h-0 w-full flex-1 items-center justify-center"
    >
      <div className={chromeCls} style={box ? { width: box.w, height: box.h } : undefined}>
        {children}
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
  onOpenIllustration: (entry: Entry) => void;
}) {
  if (side.kind === "page") {
    return (
      <PageChip
        entry={side.entry}
        label={side.label}
        stale={stale}
        onOpenIllustration={() => onOpenIllustration(side.entry)}
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
  if (side.kind === "edge") {
    return (
      <span
        className="rounded-full bg-ink-50 px-3 py-1.5 text-xs text-ink-300 ring-1 ring-ink-100"
        title="The printed book doesn't have a page on this side."
      >
        No page here
      </span>
    );
  }
  return <span aria-hidden />;
}

/**
 * Per-page chip above the canvas: contextual art actions live here so the page
 * surface stays free for editing text/layout.
 *
 * - No art yet: Generate illustration/cover (opens toolbox — never auto-starts)
 * - Cleared art with history: Restore
 * - Art present + stale: warning + Update
 * - Art present + ready: status only (edit via selecting the art)
 */
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
  const { project, setPageGenerating, selectIllustration, pageDesign } = useStudio();
  const blank = isBlankEntry(entry);
  const status = useEntryStatus(entry, stale);
  const page = entry.page;
  const coverMode = entry.subject.kind === "cover";

  const hasFrame = (pageDesign(page.id).images ?? []).some((im) => im.kind === "illustration");
  const tree = project.illustrations?.[page.id];
  const cursor = tree ? getCursor(tree).content : null;
  const hasHistory = Boolean(cursor?.blobId);
  const needsArt = !blank && !hasHistory;

  async function updateStaleArt() {
    selectIllustration(page.id);
    setPageGenerating(page.id, true);
    try {
      const changed = changedAnchorsForSpread(project, page.id);
      const staleSet = new Set(staleAnchorIds(project));
      const staleRefs = changed.filter((a) => staleSet.has(a.id)).map((a) => a.id);
      if (staleRefs.length > 0) {
        await updateAnchorsThenSpread(project, page.id, staleRefs, (err) => notify.error(err));
      } else {
        await refreshSpread(project, page.id, { useReference: true }, (err) => notify.error(err));
      }
    } finally {
      setPageGenerating(page.id, false);
    }
  }

  return (
    <div className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-white/95 px-2 py-1 shadow-soft ring-1 ring-ink-200 backdrop-blur-sm">
      <span className="truncate px-1 text-xs font-semibold text-ink-700">{label}</span>
      {!blank && (
        <>
          {status === "generating" && (
            <span className="inline-flex items-center gap-1 px-1.5 text-[11px] font-medium text-brand-600">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="hidden sm:inline">Generating…</span>
            </span>
          )}

          {needsArt && status !== "generating" && (
            <ChipButton
              label={coverMode ? "Generate cover" : "Generate illustration"}
              title={
                coverMode
                  ? "Open cover tools — set title options, then generate"
                  : "Open illustration tools — check cast & scene, then generate"
              }
              onClick={onOpenIllustration}
              tone="brand"
            >
              <Sparkles className="size-3.5" />
            </ChipButton>
          )}

          {!needsArt && !hasFrame && status !== "generating" && (
            <ChipButton
              label="Restore"
              title="Put the last saved version back on the page"
              onClick={() => selectIllustration(page.id)}
            >
              <History className="size-3.5" />
            </ChipButton>
          )}

          {hasFrame && status === "stale" && (
            <>
              <span
                className="hidden max-w-36 truncate px-1 text-[11px] font-medium text-amber-700 sm:inline"
                title="Characters or places on this page changed since the art was made"
              >
                Outdated
              </span>
              <ChipButton
                label="Update"
                title="Update scene for changed characters & places"
                onClick={() => void updateStaleArt()}
                tone="accent"
              >
                <RefreshCw className="size-3.5" />
              </ChipButton>
            </>
          )}

          {hasFrame && status === "ready" && (
            <Check className="mx-1 size-3.5 text-emerald-500" aria-label="Art ready" />
          )}
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
  label,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  label?: string;
  tone?: "brand" | "accent";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition",
        tone === "brand" && "bg-brand-50 text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100",
        tone === "accent" && "bg-amber-50 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100",
        !tone && "text-ink-600 hover:bg-ink-100",
      )}
    >
      {children}
      {label && <span>{label}</span>}
    </button>
  );
}

/** Floating "Add" dock — page-local tools (text, image, arrange). */
function AddDock({
  activePageId,
  toolPanel,
  onToggleTool,
}: {
  activePageId?: string;
  toolPanel: StudioToolPanel | null;
  onToggleTool: (panel: StudioToolPanel) => void;
}) {
  const { addText, addAssetImage } = useStudio();
  const pageId = activePageId;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/95 p-1.5 shadow-lifted ring-1 ring-ink-200 backdrop-blur-sm"
        data-floating-bar-obstacle
      >
        <DockButton
          icon={<Type className="size-4" />}
          label="Text"
          title="Add story text, or a blank text box"
          disabled={!pageId}
          onClick={() => pageId && addText(pageId)}
        />
        <Popover
          side="top"
          align="center"
          panelClassName="w-64"
          trigger={
            <span
              title="Upload or place saved pictures"
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100"
            >
              <ImageIcon className="size-4" /> <span className="hidden sm:inline">Assets</span>
            </span>
          }
        >
          <AssetsLibrary onPlace={pageId ? (asset) => addAssetImage(pageId, asset) : undefined} />
        </Popover>
        <span className="mx-0.5 h-5 w-px bg-ink-200" />
        <DockButton
          icon={<LayersIcon className="size-4" />}
          label="Arrange"
          title="Reorder layers on the pages in this canvas"
          active={toolPanel === "layers"}
          disabled={!pageId}
          onClick={() => onToggleTool("layers")}
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
  active,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
          : "text-ink-600 hover:bg-ink-100",
      )}
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </motion.button>
  );
}