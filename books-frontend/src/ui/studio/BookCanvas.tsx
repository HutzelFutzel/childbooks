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
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  BookText,
  ChevronDown,
  Eye,
  Info,
  Layers as LayersIcon,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Redo2,
  RefreshCw,
  LayoutGrid,
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
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Popover } from "../components/Popover";
import { Tooltip } from "../components/Tooltip";
import { ArtworkOrbit } from "../design/ArtworkOrbit";
import { ShapeKindPicker } from "../design/ShapeKindPicker";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";
import { useDialogFocus } from "../lib/dialogFocus";
import { AssetsLibrary } from "./AssetsLibrary";
import { ElementPanel, elementPanelHasContent } from "./ElementPanel";
import { PageFilmstrip } from "./PageFilmstrip";
import { PageStagePanel } from "./PageEditorCard";
import { PairPageStagePanel } from "./PairPageStage";
import { useStudio } from "./StudioContext";
import { useStudioPanelStore } from "./studioPanelStore";
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
  isPlainPagePair,
  entryNeedsArtwork,
  sideAspect,
  useDisplayStatus,
  type DisplaySpread,
  type Entry,
} from "./SpreadEditor";
import { activeSurfaceFor } from "./surfaceCapabilities";

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
    openDesignSetup,
  } = useStudio();
  const imageEditSection = useStudioPanelStore((s) => s.imageEditSection);
  const toolPanel = useStudioPanelStore((s) => s.toolPanel);
  const closeImageEdit = useStudioPanelStore((s) => s.closeImageEdit);
  const closeToolPanel = useStudioPanelStore((s) => s.closeToolPanel);
  const toggleToolPanel = useStudioPanelStore((s) => s.toggleToolPanel);
  const models = useResolvedModels();
  const screenplayJob = useJobsStore((s) => s.screenplayJob);
  const startScreenplay = useJobsStore((s) => s.startScreenplay);
  const [previewing, setPreviewing] = useState(false);
  const closePreview = useCallback(() => setPreviewing(false), []);
  const closeInspector = useCallback(() => {
    closeToolPanel();
    closeImageEdit();
  }, [closeImageEdit, closeToolPanel]);

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
  const activePageLabel = useMemo(
    () =>
      activeDisp
        ? displayEntries(activeDisp).find(({ entry }) => entry.page.id === activePageId)?.label
        : undefined,
    [activeDisp, activePageId],
  );

  const retryScreenplay = useCallback(() => {
    void startScreenplay(project, true).catch((err) => notify.error(err));
  }, [project, startScreenplay]);

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
        {screenplayJob?.status === "error" ? (
          <EmptyState
            icon={BookText}
            title="The page draft stopped"
            description={
              screenplayJob.error ??
              "Your story and cast are safe. Start another page-by-page draft when you're ready."
            }
            action={
              <Button leftIcon={<RefreshCw className="size-4" />} onClick={retryScreenplay}>
                Try again
              </Button>
            }
          />
        ) : models ? (
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
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-ink-100 bg-white px-2 py-1.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-1">
          {activeDisp && <SurfaceIdentity disp={activeDisp} />}
          <span className="mx-1 hidden h-5 w-px bg-ink-200 sm:block" />
          <PageAddMenu pageId={activePageId} pageLabel={activePageLabel} />
          <ToolbarIconButton
            icon={<LayersIcon className="size-4" />}
            label="Arrange"
            active={toolPanel === "layers"}
            disabled={!activePageId}
            onClick={() => toggleToolPanel("layers")}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {/* Undo / redo stay visible on desktop and move into More on mobile. */}
          <div className="hidden items-center sm:flex">
            <button
              type="button"
              onClick={undo}
              title="Undo"
              aria-label="Undo"
              className="flex size-9 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={redo}
              title="Redo"
              aria-label="Redo"
              className="flex size-9 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Redo2 className="size-4" />
            </button>
            <span className="mx-0.5 h-5 w-px bg-ink-200" />
          </div>
          <div className="hidden sm:block">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Eye className="size-4" />}
              onClick={() => setPreviewing(true)}
            >
              Preview
            </Button>
          </div>
          <PagesToolbarMore
            onUndo={undo}
            onRedo={redo}
            onPreview={() => setPreviewing(true)}
            onOpenSetup={openDesignSetup}
          />
          {activeDisp && (
            <SurfacePrimaryAction
              disp={activeDisp}
              stale={isStale}
              onCustomize={(entry) => openIllustrationTools(entry)}
            />
          )}
        </div>
      </div>

      {/* Body: book navigation + focused editing stage. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <PageFilmstrip
          displays={displays}
          activeId={activeDisp?.id ?? null}
          onSelect={(id) => setEditingDisp(id)}
          stale={isStale}
        />

        {/* Stage + inspector dock as siblings so tools never cover the book. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              className="absolute inset-0 flex flex-col bg-ink-50/40 p-3 sm:p-5"
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
                <ActiveSpreadStage disp={activeDisp} />
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

          </div>

          <AnimatePresence>
            {elementPanelHasContent(selection, toolPanel, !!imageEditSection) && (
              <InspectorDock key="inspector-dock" onClose={closeInspector}>
                <ElementPanel
                  toolPanel={toolPanel}
                  arrangePages={arrangePages}
                  onClose={closeInspector}
                />
              </InspectorDock>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview
            displays={displays}
            startId={activeDisp?.id}
            onClose={closePreview}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SurfaceIdentity({ disp }: { disp: DisplaySpread }) {
  const surface = activeSurfaceFor(disp);
  return (
    <div className="flex min-w-0 max-w-28 items-center gap-2 px-1.5 sm:max-w-none">
      <BookOpen className="hidden size-4 shrink-0 text-ink-400 sm:block" />
      <span className="truncate text-sm font-semibold text-ink-800">{surface.label}</span>
    </div>
  );
}

function PageAddMenu({
  pageId,
  pageLabel,
}: {
  pageId?: string;
  pageLabel?: string;
}) {
  const { addText, addShape, addAssetImage } = useStudio();
  if (!pageId) {
    return (
      <ToolbarIconButton
        icon={<Plus className="size-4" />}
        label="Select a page to add content"
        disabled
        onClick={() => undefined}
      />
    );
  }
  return (
    <Popover
      align="start"
      side="bottom"
      panelClassName="w-80 p-2"
      trigger={(open) => (
        <span
          title={`Add to ${pageLabel ?? "page"}`}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg text-sm font-semibold transition sm:w-auto sm:px-2.5",
            open ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100",
          )}
        >
          <Plus className="size-4" />
          <span className="ml-1.5 hidden sm:inline">Add</span>
        </span>
      )}
    >
      {(close) => (
        <div>
          <p className="px-2.5 pb-1.5 text-[11px] font-medium text-ink-400">
            Add to {pageLabel ?? "this page"}
          </p>
          <AddMenuRow
            icon={<Type className="size-4" />}
            label="Text"
            hint="Story text or an empty text box"
            onClick={() => {
              addText(pageId);
              close();
            }}
          />
          <div className="my-1 border-t border-ink-100" />
          <div className="px-2.5 py-1.5">
            <ShapeKindPicker
              onSelect={(kind) => {
                addShape(pageId, kind);
                close();
              }}
            />
          </div>
          <div className="my-1 border-t border-ink-100" />
          <div className="px-1.5 py-1.5">
            <AssetsLibrary
              onPlace={(asset) => {
                addAssetImage(pageId, asset);
                close();
              }}
            />
          </div>
        </div>
      )}
    </Popover>
  );
}

function AddMenuRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  const control = (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-ink-700 transition hover:bg-ink-50"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px] leading-snug text-ink-400">{hint}</span>
      </span>
    </button>
  );
  return control;
}

function ToolbarIconButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const control = (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:pointer-events-none disabled:opacity-35",
        active ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-100 hover:text-ink-800",
      )}
    >
      {icon}
    </button>
  );
  return control;
}

function PagesToolbarMore({
  onUndo,
  onRedo,
  onPreview,
  onOpenSetup,
}: {
  onUndo: () => void;
  onRedo: () => void;
  onPreview: () => void;
  onOpenSetup: () => void;
}) {
  const {
    snap,
    grid,
    guides,
    bleedVisible,
    bleedMode,
    toggleSnap,
    toggleGrid,
    toggleGuides,
    toggleBleedVisible,
    setBleedMode,
  } = useStudio();
  return (
    <Popover
      align="end"
      panelClassName="max-h-[min(32rem,calc(100dvh-5rem))] w-56 overflow-y-auto p-1.5"
      trigger={(open) => (
        <span
          title="More page tools"
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg border text-ink-500 transition group-focus-visible:ring-2 group-focus-visible:ring-brand-400",
            open
              ? "border-brand-200 bg-brand-50 text-brand-700"
              : "border-ink-200 bg-white hover:bg-ink-50 hover:text-ink-700",
          )}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">More page tools</span>
        </span>
      )}
    >
      {(close) => (
        <div className="space-y-0.5">
          <div className="grid grid-cols-2 gap-1 sm:hidden">
            <PagesToolbarMenuItem
              icon={<Undo2 className="size-4" />}
              label="Undo"
              onClick={() => {
                onUndo();
                close();
              }}
            />
            <PagesToolbarMenuItem
              icon={<Redo2 className="size-4" />}
              label="Redo"
              onClick={() => {
                onRedo();
                close();
              }}
            />
          </div>
          <div className="sm:hidden">
            <PagesToolbarMenuItem
              icon={<Eye className="size-4" />}
              label="Preview"
              onClick={() => {
                onPreview();
                close();
              }}
            />
            <div className="my-1 border-t border-ink-100" />
          </div>
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            Canvas
          </p>
          <ToolbarToggleRow label="Snap to guides" active={snap} onClick={toggleSnap} />
          <ToolbarToggleRow label="Grid" active={grid} onClick={toggleGrid} />
          <ToolbarToggleRow
            label="Print guides"
            active={guides}
            onClick={toggleGuides}
            help="Safety margin, binding gutter, and reserved print areas. Hover a guide on the page to see what it means."
          />
          <ToolbarToggleRow
            label="Show print bleed"
            active={bleedVisible}
            onClick={toggleBleedVisible}
            help="Bleed is the 0.125″ printed strip outside the cut line. It prevents white edges when trimming shifts slightly."
          />
          <div className="px-2.5 pb-1 pt-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              Fill the bleed
              <Tooltip
                side="bottom"
                align="start"
                content="This choice changes the physical print PDF. Ebooks have no bleed."
              >
                <span
                  tabIndex={0}
                  className="inline-flex rounded text-ink-400 outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  aria-label="About bleed fill"
                >
                  <Info className="size-3" />
                </span>
              </Tooltip>
            </div>
            <div
              role="radiogroup"
              aria-label="Bleed fill method"
              className="grid grid-cols-2 rounded-lg bg-ink-50 p-0.5 ring-1 ring-ink-100"
            >
              <BleedModeButton
                label="Fit artwork"
                active={bleedMode === "fit"}
                tooltip="Frame edge illustrations across the page and bleed. The crop inside the cut line may tighten slightly."
                onClick={() => setBleedMode("fit")}
              />
              <BleedModeButton
                label="Mirror edge"
                active={bleedMode === "mirror"}
                tooltip="Keep the page crop exactly as edited, then reflect its outermost pixels into the area that is cut off."
                onClick={() => setBleedMode("mirror")}
              />
            </div>
          </div>
          <div className="my-1 border-t border-ink-100" />
          <PagesToolbarMenuItem
            icon={<LayoutTemplate className="size-4" />}
            label="Book setup"
            description="Size, layout and page defaults"
            onClick={() => {
              onOpenSetup();
              close();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

function ToolbarToggleRow({
  label,
  active,
  onClick,
  help,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  help?: string;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-xs font-medium text-ink-700 transition hover:bg-ink-50"
    >
      <span className="flex items-center gap-1.5">
        {label}
        {help && <Info className="size-3 text-ink-400" aria-hidden />}
      </span>
      <span
        className={cn(
          "h-4 w-7 rounded-full p-0.5 transition",
          active ? "bg-brand-500" : "bg-ink-200",
        )}
      >
        <span
          className={cn(
            "block size-3 rounded-full bg-white shadow-sm transition-transform",
            active && "translate-x-3",
          )}
        />
      </span>
    </button>
  );
  return help ? (
    <Tooltip className="flex w-full" side="bottom" align="start" content={help}>
      {control}
    </Tooltip>
  ) : (
    control
  );
}

function BleedModeButton({
  label,
  active,
  tooltip,
  onClick,
}: {
  label: string;
  active: boolean;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip className="w-full" side="bottom" content={tooltip}>
      <label
        className={cn(
          "flex min-h-7 w-full cursor-pointer items-center justify-center rounded-md px-2 text-[11px] font-semibold transition focus-within:ring-2 focus-within:ring-brand-400",
          active
            ? "bg-white text-brand-700 shadow-sm ring-1 ring-ink-100"
            : "text-ink-500 hover:text-ink-700",
        )}
      >
        <input
          type="radio"
          name="print-bleed-mode"
          value={label}
          checked={active}
          onChange={onClick}
          className="sr-only"
        />
        {label}
      </label>
    </Tooltip>
  );
}

function PagesToolbarMenuItem({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-ink-700 transition hover:bg-ink-50"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{label}</span>
        {description && (
          <span className="block text-[11px] leading-snug text-ink-400">{description}</span>
        )}
      </span>
    </button>
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
function InspectorDock({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const reduceMotion = useReducedMotion();
  const dialogRef = useDialogFocus<HTMLElement>(isMobile);

  useEffect(() => {
    if (!isMobile) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isMobile, onClose]);

  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-40">
        <motion.div
          aria-hidden
          className="absolute inset-0 bg-ink-900/35 backdrop-blur-[1px]"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.aside
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Page editing tools"
          tabIndex={-1}
          initial={reduceMotion ? false : { y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0.08 }
              : { type: "spring", stiffness: 380, damping: 34 }
          }
          // Fixed height lets PanelShell fill the sheet predictably.
          className="absolute inset-x-0 bottom-0 z-10 flex h-[75dvh] flex-col overflow-hidden rounded-t-3xl border-t border-ink-100 bg-white shadow-lifted outline-none"
        >
          <div className="flex shrink-0 justify-center pb-1 pt-2.5" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-ink-200" />
          </div>
          <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </motion.aside>
      </div>,
      document.body,
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
 * Exactly one primary action for the open surface. Missing/stale artwork is
 * handled in one click; the adjacent disclosure opens page-specific inputs.
 */
function SurfacePrimaryAction({
  disp,
  stale,
  onCustomize,
}: {
  disp: DisplaySpread;
  stale: (pageId: string) => boolean;
  onCustomize: (entry: Entry) => void;
}) {
  const {
    project,
    selectIllustration,
    setPageGenerating,
  } = useStudio();
  const gen = useBookGeneration();
  const status = useDisplayStatus(disp, stale);
  const surface = activeSurfaceFor(disp);

  const artworkEntries = surface.entries
    .map(({ entry, label }) => ({ entry, label }))
    .filter(({ entry }) => entryNeedsArtwork(entry));
  const missingEntries = artworkEntries.filter(({ entry }) => {
    const tree = project.illustrations?.[entry.page.id];
    const blobId = tree ? getCursor(tree).content.blobId : entry.page.blobId;
    return !blobId;
  });
  const staleEntries = artworkEntries.filter(({ entry }) => stale(entry.page.id));
  const targets = status === "stale" ? staleEntries : missingEntries;
  const coverCount = targets.filter(({ entry }) => entry.subject.kind === "cover").length;
  const pageCount = targets.length - coverCount;
  const actionRange = useImageBatchRange([
    { action: "coverIllustration", count: coverCount },
    { action: "pageIllustration", count: pageCount },
  ]);

  async function createArtwork() {
    for (const { entry } of targets) {
      const pageId = entry.page.id;
      const live =
        useProjectsStore.getState().projects.find((candidate) => candidate.id === project.id) ??
        project;
      selectIllustration(pageId, { createIfMissing: true });
      setPageGenerating(pageId, true);
      try {
        await refreshSpread(live, pageId, {}, (err) => notify.error(err));
      } finally {
        setPageGenerating(pageId, false);
      }
    }
  }

  async function updateArtwork() {
    for (const { entry } of targets) {
      const pageId = entry.page.id;
      const live =
        useProjectsStore.getState().projects.find((candidate) => candidate.id === project.id) ??
        project;
      selectIllustration(pageId, { createIfMissing: true });
      setPageGenerating(pageId, true);
      try {
        const changed = changedAnchorsForSpread(live, pageId);
        const staleSet = new Set(staleAnchorIds(live));
        const staleRefs = changed.filter((anchor) => staleSet.has(anchor.id)).map((anchor) => anchor.id);
        if (staleRefs.length > 0) {
          await updateAnchorsThenSpread(live, pageId, staleRefs, (err) => notify.error(err));
        } else {
          await refreshSpread(
            live,
            pageId,
            { useReference: true },
            (err) => notify.error(err),
          );
        }
      } finally {
        setPageGenerating(pageId, false);
      }
    }
  }

  if (!gen.modelsReady) return null;
  if (gen.busy) return <NextActionChip />;
  if (status === "generating") {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 px-2 text-xs font-semibold text-brand-700">
        <ArtworkOrbit />
        <span className="hidden sm:inline">Creating artwork…</span>
      </span>
    );
  }
  if ((status !== "missing" && status !== "stale") || targets.length === 0) {
    return <NextActionChip />;
  }

  const primaryLabel =
    status === "stale"
      ? targets.length > 1
        ? `Update ${targets.length} pages`
        : surface.definition.kind === "front-cover" || surface.definition.kind === "back-cover"
          ? "Update cover"
          : surface.definition.kind === "spread"
            ? "Update spread"
            : "Update page"
      : targets.length > 1
        ? `Illustrate ${targets.length} pages`
        : surface.definition.createArtworkLabel;

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="magic"
        loading={false}
        leftIcon={status === "stale" ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
        onClick={() => void (status === "stale" ? updateArtwork() : createArtwork())}
      >
        <span className="hidden max-w-36 truncate sm:inline">{primaryLabel}</span>
        <span className="sm:hidden">
          {status === "stale"
            ? "Update"
            : surface.definition.kind === "front-cover" || surface.definition.kind === "back-cover"
              ? "Create"
              : "Illustrate"}
        </span>
        <span className="hidden sm:inline-flex">
          <SparkEstimateCost range={actionRange} />
        </span>
      </Button>
      <Popover
        align="end"
        side="bottom"
        panelClassName="w-60 p-1.5"
        trigger={
          <span
            title="Artwork options"
            className="flex size-9 items-center justify-center rounded-xl bg-magic-700 text-white shadow-soft transition hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-magic-300"
          >
            <ChevronDown className="size-4" />
            <span className="sr-only">Artwork options</span>
          </span>
        }
      >
        {(close) => (
          <div className="space-y-0.5">
            {artworkEntries.map(({ entry, label }) => (
              <PagesToolbarMenuItem
                key={entry.page.id}
                icon={<SlidersHorizontal className="size-4" />}
                label={
                  artworkEntries.length > 1
                    ? `Customize ${label}`
                    : surface.definition.customizeArtworkLabel
                }
                description="Scene, characters and versions"
                onClick={() => {
                  onCustomize(entry);
                  close();
                }}
              />
            ))}
            {gen.pendingCount > targets.length && (
              <>
                <div className="my-1 border-t border-ink-100" />
                <PagesToolbarMenuItem
                  icon={<Sparkles className="size-4" />}
                  label={`Illustrate all ${gen.pendingCount} remaining`}
                  onClick={() => {
                    void gen.generateEverything();
                    close();
                  }}
                />
              </>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}

/**
 * The single "next best action" for the whole book, always visible in the
 * toolbar: generate what's missing → update what's stale → review & order.
 */
function NextActionChip() {
  const gen = useBookGeneration();
  const { navigate } = useStudio();

  if (!gen.modelsReady) return null;

  if (gen.busy) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
        <ArtworkOrbit />
        <span className="hidden sm:inline">Illustrating your book…</span>
        <span className="sm:hidden">Illustrating…</span>
        <button
          type="button"
          onClick={gen.cancelGeneration}
          title="Cancel generation"
          aria-label="Cancel generation"
          className="ml-1 flex size-8 items-center justify-center rounded-full text-brand-400 transition hover:bg-brand-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <X className="size-3.5" />
        </button>
      </span>
    );
  }

  if (gen.pendingCount > 0) {
    const label =
      gen.pendingAnchors > 0
        ? "Create book artwork"
        : gen.pendingPages === 1
          ? "Illustrate 1 page"
          : `Illustrate ${gen.pendingPages} pages`;
    return (
      <Button size="sm" leftIcon={<Sparkles className="size-4" />} onClick={() => void gen.generateEverything()}>
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">Create artwork</span>
        <span className="hidden sm:inline-flex">
          <SparkEstimateCost range={gen.batchRange} />
        </span>
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
      <Button
        size="sm"
        variant="primary"
        rightIcon={<ArrowRight className="size-4" />}
        onClick={() => navigate("order")}
      >
        Review & order
      </Button>
    );
  }

  return null;
}

/** The book is the focus: no labels or controls compete with the live surface. */
const ActiveSpreadStage = memo(function ActiveSpreadStage({ disp }: { disp: DisplaySpread }) {
  if (disp.cover && disp.kind === "pair") {
    const side = coverSideOf(disp);
    if (!side || side.kind !== "page") {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-400">
          No cover yet.
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <StageFitFrame>
          <PageStagePanel
            page={side.entry.page}
            subject={side.entry.subject}
            chromeless
            fitParent
          />
        </StageFitFrame>
      </div>
    );
  }

  if (disp.kind === "full") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
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
            className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
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
}: {
  children: React.ReactNode;
  /** When set, sizes the chrome box to this aspect (e.g. facing pair). */
  aspect?: number;
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
    "overflow-visible bg-white shadow-soft ring-1 ring-ink-200",
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