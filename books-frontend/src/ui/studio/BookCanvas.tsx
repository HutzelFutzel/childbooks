import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Eye,
  FileText,
  Grid3x3,
  Images,
  Loader2,
  Magnet,
  Plus,
  Printer,
  Redo2,
  Rows3,
  LayoutGrid,
  Sparkles,
  Undo2,
} from "lucide-react";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { pageTrimForConfig } from "../../core/book";
import { getCursor } from "../../core/versioning";
import { currentIllustration, staleIllustrationSpreadIds } from "../../state/ai";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { PrintBook } from "../design/PrintBook";
import { ExportRunner, type ExportMode } from "../design/ExportRunner";
import { useStudio } from "./StudioContext";
import { BookPreview } from "./BookPreview";
import { illustrationUnits } from "./studioGen";
import { insertSpreadAt } from "./pageOps";
import {
  buildDisplaySpreads,
  SpreadCard,
  type DisplaySpread,
  type Entry,
  type SpreadSide,
} from "./SpreadEditor";

type ViewMode = "scroll" | "spread" | "grid";

export function BookCanvas() {
  const { project, pages, design, undo, redo, snap, grid, toggleSnap, toggleGrid } = useStudio();
  const models = useResolvedModels();
  const [view, setView] = useState<ViewMode>("scroll");
  const [index, setIndex] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState<ExportMode | null>(null);
  const [pendingExport, setPendingExport] = useState<(() => void) | null>(null);

  // Non-blank pages/covers that still have no generated illustration: exporting
  // now would produce blank pages, so we warn first.
  const missingArt = useMemo(
    () => illustrationUnits(project).filter((u) => !currentIllustration(project, u.id)).length,
    [project],
  );

  function requestExport(run: () => void) {
    if (missingArt > 0) setPendingExport(() => run);
    else run();
  }

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

  useEffect(() => {
    if (index >= displays.length) setIndex(0);
  }, [displays.length, index]);

  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 300);
  }

  if (!doc) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
        {models ? (
          <>
            <Loader2 className="size-7 animate-spin text-brand-500" />
            <p className="text-sm font-medium text-ink-600">Drafting your book…</p>
            <p className="max-w-sm text-xs text-ink-400">
              The studio is writing a page-by-page screenplay from your story. Characters &amp; places
              appear in the sidebar as they're found.
            </p>
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
              <Sparkles className="size-6" />
            </span>
            <p className="text-sm font-semibold text-ink-700">Add an API key to begin</p>
            <p className="max-w-sm text-xs text-ink-400">
              Connect an OpenAI or Google key in Settings. The studio then analyzes your story and
              drafts the whole book automatically.
            </p>
          </>
        )}
      </div>
    );
  }

  const active = displays[Math.min(index, displays.length - 1)];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-white/70 px-5 py-2.5 backdrop-blur">
        <ViewToggle view={view} onChange={setView} />
        <div className="flex items-center gap-1.5">
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
          <span className="mx-0.5 h-5 w-px bg-ink-200" />
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
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Eye className="size-4" />}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </Button>
          <ExportMenu
            onPrint={() => requestExport(handlePrint)}
            onExportPdf={() => requestExport(() => setExporting("pdf"))}
            onExportImages={() => requestExport(() => setExporting("images"))}
          />
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

        {view === "spread" && active && (
          <div className="mx-auto flex w-full max-w-5xl flex-col px-5 py-6">
            <div className="mb-3 flex items-center justify-between">
              <button
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-ink-600 transition hover:bg-ink-100 disabled:opacity-30"
              >
                <ChevronLeft className="size-4" /> Prev
              </button>
              <span className="text-xs font-medium text-ink-400">
                {index + 1} of {displays.length}
              </span>
              <button
                onClick={() => setIndex((i) => Math.min(displays.length - 1, i + 1))}
                disabled={index >= displays.length - 1}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-ink-600 transition hover:bg-ink-100 disabled:opacity-30"
              >
                Next <ChevronRight className="size-4" />
              </button>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <SpreadCard disp={active} anchors={anchors} stale={isStale} />
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {view === "grid" && (
          <div className="mx-auto w-full max-w-5xl px-5 py-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displays.map((disp, i) => (
                <SpreadThumb
                  key={disp.id}
                  disp={disp}
                  onClick={() => {
                    setIndex(i);
                    setView("spread");
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {printing &&
        createPortal(
          <PrintBook pages={pages} design={design} trimIn={pageTrimForConfig(project.config)} />,
          document.body,
        )}

      {exporting && (
        <ExportRunner
          mode={exporting}
          pages={pages}
          design={design}
          project={project}
          onDone={() => setExporting(null)}
        />
      )}

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>

      <Modal
        open={pendingExport !== null}
        onClose={() => setPendingExport(null)}
        title="Some pages have no illustration"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingExport(null)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                const run = pendingExport;
                setPendingExport(null);
                run?.();
              }}
            >
              Export anyway
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          {missingArt} page{missingArt === 1 ? "" : "s"} still {missingArt === 1 ? "has" : "have"} no
          generated art and will appear blank in the export. You can generate the rest from
          “Generate everything” in the sidebar first.
        </p>
      </Modal>
    </div>
  );
}

/** Split "Export" control: Print, Download PDF, or Download images (zip). */
function ExportMenu({
  onPrint,
  onExportPdf,
  onExportImages,
}: {
  onPrint: () => void;
  onExportPdf: () => void;
  onExportImages: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    const reposition = () => place();
    window.addEventListener("click", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const items: { label: string; hint: string; icon: typeof FileText; onClick: () => void }[] = [
    { label: "Download PDF", hint: "Print-ready, full-bleed", icon: FileText, onClick: onExportPdf },
    { label: "Download images", hint: "Zip of page PNGs", icon: Images, onClick: onExportImages },
    { label: "Print…", hint: "Open the print dialog", icon: Printer, onClick: onPrint },
  ];

  return (
    <>
      <Button
        ref={btnRef}
        size="sm"
        leftIcon={<Download className="size-4" />}
        rightIcon={<ChevronDown className="size-3.5" />}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        Export
      </Button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-100 w-60 overflow-hidden rounded-xl border border-ink-100 bg-white p-1.5 shadow-xl"
            >
              {items.map((it) => {
                const Icon = it.icon;
                return (
                  <button
                    key={it.label}
                    onClick={() => {
                      setOpen(false);
                      it.onClick();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-ink-50"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-ink-800">{it.label}</span>
                      <span className="text-[11px] text-ink-400">{it.hint}</span>
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** Hover-reveal control to insert a new page (or a blank page) at `at`. */
function InsertBar({ at }: { at: number }) {
  return (
    <div className="group relative flex h-7 items-center justify-center">
      <div className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-ink-200 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
    { id: "spread", label: "Spread", icon: Columns2 },
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

/** A spread-shaped thumbnail (two facing halves) for grid view. */
function SpreadThumb({ disp, onClick }: { disp: DisplaySpread; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      onClick={onClick}
      className="group flex flex-col gap-2 text-left"
    >
      <div className="relative flex aspect-2/1 w-full overflow-hidden rounded-2xl bg-ink-100 ring-1 ring-ink-200 transition group-hover:ring-brand-300">
        {disp.kind === "full" ? (
          <ThumbImage blobId={disp.entry.page.blobId} cover={disp.entry.page.isCover} />
        ) : (
          <>
            <ThumbHalf side={disp.left} />
            <div className="w-px bg-ink-200/70" />
            <ThumbHalf side={disp.right} />
          </>
        )}
      </div>
      <span className="truncate text-xs font-medium text-ink-600">{disp.label}</span>
    </motion.button>
  );
}

function ThumbHalf({ side }: { side: SpreadSide }) {
  if (side.kind === "page") {
    return (
      <div className="relative flex-1">
        <ThumbImage blobId={side.entry.page.blobId} cover={side.entry.page.isCover} />
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center bg-ink-50 text-[10px] text-ink-300">
      {side.kind === "filler" ? "blank" : ""}
    </div>
  );
}

function ThumbImage({ blobId, cover }: { blobId?: string; cover?: boolean }) {
  const url = useBlobUrl(blobId);
  if (url) return <img src={url} alt="" className="size-full object-cover" />;
  return (
    <div className="flex size-full items-center justify-center text-[11px] text-ink-400">
      {cover ? "cover" : "no art yet"}
    </div>
  );
}
