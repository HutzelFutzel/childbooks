/**
 * Design · Cast workspace — top bar, stage, side dock.
 * Cast filmstrip portals into the Design chapter accordion when hosted there.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Ruler,
  Sparkles,
  Users,
  Wand2,
  X,
} from "lucide-react";
import type { Anchor } from "../../core/types";
import { analyzeCurrentStory, currentAnchorImage } from "../../state/ai";
import { isAbortError } from "../../core/errors";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { useFeatureAllowed } from "../../state/subscriptionStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { AnchorEditor } from "../anchors/AnchorEditor";
import { CastLineup } from "../anchors/CastLineup";
import { ANCHOR_TYPE_ICON } from "../anchors/AnchorCard";
import { Button } from "../components/Button";
import { Celebrate } from "../components/Celebrate";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { springSoft } from "../lib/motion";
import { CastFilmstrip } from "./CastFilmstrip";
import { useDesignChapterHosts } from "./DesignChapterHosts";
import { ImportAnchorsDialog } from "./ImportAnchorsDialog";
import { useStudio } from "./StudioContext";
import { generateAllAnchors } from "./studioGen";

const ANALYSIS_PHASES: PipelinePhase[] = [
  { id: "read", label: "Reading your story", icon: BookOpen },
  { id: "cast", label: "Finding characters & places", icon: Users },
  { id: "ready", label: "Getting your cast ready", icon: Sparkles },
];

const INSPECTOR_DOCK_W = 320;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function CastWorkspace() {
  const {
    project,
    selection,
    select,
    setStep,
    generatingAnchors,
    setAnchorGenerating,
    busy,
    setBusy,
    startGeneration,
  } = useStudio();
  const chapterHosts = useDesignChapterHosts();
  const setAnchors = useProjectsStore((s) => s.setAnchors);
  const patchAnalysis = useProjectsStore((s) => s.patchAnalysis);
  const activeJobUnitIds = useJobsStore((s) => s.activeUnitIds);
  const models = useResolvedModels();
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  // Below `md` a 320px docked column leaves little to no room for the stage
  // next to the cast filmstrip rail, so it becomes a full-width bottom sheet.
  const isMobile = useMediaQuery("(max-width: 767px)");

  const transferAllowed = useFeatureAllowed("characterTransfer");
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const hasImportSources = useProjectsStore((s) =>
    s.projects.some((p) => p.id !== project.id && (p.anchors?.length ?? 0) > 0),
  );

  const allAnchors = project.anchors ?? [];
  const anchors = allAnchors.filter((a) => a.include);
  const ready = anchors.filter((a) => currentAnchorImage(a)).length;
  const canCompareSizes =
    anchors.filter((a) => a.type === "character" && currentAnchorImage(a)).length >= 2;
  const allReady = anchors.length > 0 && ready === anchors.length;
  const analysisPending = !project.analysis;
  const canProceed = allReady || (Boolean(project.analysis) && anchors.length === 0);

  const batchRange = useImageBatchRange([
    { action: "anchorImage", count: Math.max(0, anchors.length - ready) },
  ]);

  const selectedAnchorId = selection.kind === "anchor" ? selection.anchorId : null;
  const activeAnchor = allAnchors.find((a) => a.id === selectedAnchorId) ?? null;
  const TypeIcon = activeAnchor ? ANCHOR_TYPE_ICON[activeAnchor.type] : ImagePlus;

  const generatingIds = new Set<string>([...generatingAnchors, ...activeJobUnitIds]);

  function commitSelect(anchorId: string) {
    select({ kind: "anchor", anchorId });
    setDockOpen(true);
  }

  useEffect(() => {
    if (allAnchors.length === 0) return;
    if (!selectedAnchorId || !allAnchors.some((a) => a.id === selectedAnchorId)) {
      commitSelect((anchors[0] ?? allAnchors[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnchors.length, selectedAnchorId]);

  // Legacy analyses have no story snapshot — stamp the current text as the
  // baseline so we only surface re-read after a real subsequent edit.
  useEffect(() => {
    if (!project.analysis || project.analysis.sourceStoryText !== undefined) return;
    void patchAnalysis({ sourceStoryText: project.config.storyText });
  }, [project.analysis, project.config.storyText, patchAnalysis]);

  const storyChanged =
    Boolean(project.analysis) &&
    project.analysis!.sourceStoryText !== undefined &&
    project.analysis!.sourceStoryText !== project.config.storyText;

  async function reanalyze() {
    setAnalyzing(true);
    try {
      await analyzeCurrentStory();
      notify.success("Story re-analyzed", "Characters & places refreshed.");
    } catch (err) {
      notify.error(err);
    } finally {
      setAnalyzing(false);
    }
  }

  function addAnchor() {
    const next: Anchor = {
      id: uid(),
      name: "New character",
      type: "character",
      description: "",
      importance: "medium",
      mode: "creative",
      include: true,
    };
    void setAnchors([...(project.anchors ?? []), next]).then(() => commitSelect(next.id));
  }

  async function generateAll() {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }
    const signal = startGeneration();
    let failures = 0;
    setBusy(true);
    try {
      const started = await generateAllAnchors(
        useProjectsStore.getState().current()!,
        setAnchorGenerating,
        (err) => {
          if (isAbortError(err)) return;
          failures += 1;
          notify.error(err);
        },
        signal,
      );
      if (started && !signal.aborted && failures === 0) {
        notify.success("Cast is ready", "Tap any character to refine its look.");
        setCelebrate(true);
        const cast = (useProjectsStore.getState().current()?.anchors ?? []).filter(
          (a) => a.type === "character" && a.include,
        );
        if (cast.length >= 2) setLineupOpen(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (analysisPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-aurora">
        <PipelineStepper
          title="Reading your story…"
          subtitle="We're finding the characters & places in your tale. They'll appear here in a moment."
          phases={ANALYSIS_PHASES}
          activeIndex={0}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Celebrate play={celebrate} />

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink-100 bg-white/70 px-3 py-2.5 backdrop-blur sm:px-5">
        <div className="flex items-center gap-1.5">
          {canCompareSizes && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Ruler className="size-4" />}
              onClick={() => setLineupOpen((v) => !v)}
              aria-pressed={lineupOpen}
              title="Set how tall each character is next to the others so they look right together on pages"
              className={
                lineupOpen
                  ? "border-brand-200 bg-brand-50 text-brand-700 ring-brand-200"
                  : undefined
              }
            >
              <span className="hidden sm:inline">Compare heights</span>
            </Button>
          )}
          {storyChanged && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={
                analyzing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wand2 className="size-4" />
                )
              }
              onClick={() => void reanalyze()}
              disabled={analyzing}
              title="Your story changed since this cast was found — re-read to refresh characters & places"
            >
              <span className="hidden sm:inline">Re-read story</span>
            </Button>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <CastNextAction
            canProceed={canProceed}
            busy={busy}
            ready={ready}
            total={anchors.length}
            batchRange={batchRange}
            onGenerate={() => void generateAll()}
            onContinue={() => setStep("edit")}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {(() => {
          const inChapters = chapterHosts !== null;
          const filmstrip = (
            <CastFilmstrip
              embedded={inChapters}
              anchors={allAnchors}
              activeId={selectedAnchorId}
              generatingIds={generatingIds}
              onSelect={commitSelect}
              onAdd={addAnchor}
              canImport={hasImportSources}
              importLocked={!transferAllowed}
              onImport={() => (transferAllowed ? setImporting(true) : openPlans())}
            />
          );
          if (!inChapters) return filmstrip;
          return chapterHosts.castHost
            ? createPortal(filmstrip, chapterHosts.castHost)
            : null;
        })()}

        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div className="absolute inset-0 flex flex-col bg-grid px-3 pb-4 pt-3 sm:px-5 sm:pt-4">
              {activeAnchor ? (
                <AnchorEditor
                  layout="stage"
                  anchor={activeAnchor}
                  generating={generatingAnchors.has(activeAnchor.id)}
                  setGenerating={(v) => setAnchorGenerating(activeAnchor.id, v)}
                />
              ) : (
                <EmptyCastStage onAdd={addAnchor} onContinue={() => setStep("edit")} />
              )}
            </div>
          </div>

          <AnimatePresence>
            {activeAnchor && dockOpen && (
              <motion.aside
                key="cast-dock"
                {...(isMobile
                  ? {
                      initial: { y: "100%", opacity: 0 },
                      animate: { y: 0, opacity: 1 },
                      exit: { y: "100%", opacity: 0 },
                      transition: { type: "spring", stiffness: 380, damping: 34 },
                    }
                  : {
                      initial: { width: 0 },
                      animate: { width: INSPECTOR_DOCK_W },
                      exit: { width: 0 },
                      transition: springSoft,
                    })}
                className={
                  isMobile
                    ? "fixed inset-x-0 bottom-0 z-40 h-[75vh] overflow-hidden rounded-t-3xl border-t border-ink-100 bg-white shadow-lifted"
                    : "h-full min-h-0 shrink-0 self-stretch overflow-hidden border-l border-ink-100 bg-white"
                }
              >
                <div
                  className="flex h-full min-h-0 flex-col"
                  style={isMobile ? undefined : { width: INSPECTOR_DOCK_W }}
                  data-floating-bar-obstacle
                >
                  <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <TypeIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-semibold text-ink-800">
                        {activeAnchor.name}
                      </p>
                      <p className="truncate text-[11px] capitalize text-ink-400">
                        {activeAnchor.type}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDockOpen(false)}
                      title="Close"
                      className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                    <AnchorEditor
                      layout="dock"
                      anchor={activeAnchor}
                      generating={generatingAnchors.has(activeAnchor.id)}
                      setGenerating={(v) => setAnchorGenerating(activeAnchor.id, v)}
                    />
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>

      {activeAnchor && !dockOpen && (
        <button
          type="button"
          onClick={() => setDockOpen(true)}
          className="absolute right-0 top-[45%] z-20 rounded-l-xl border border-r-0 border-ink-200 bg-white px-2.5 py-3 text-xs font-semibold text-ink-600 shadow-soft transition hover:bg-brand-50 hover:text-brand-700"
        >
          Edit
        </button>
      )}

      <ImportAnchorsDialog open={importing} onClose={() => setImporting(false)} project={project} />
      <CastLineup
        open={lineupOpen && canCompareSizes}
        onClose={() => setLineupOpen(false)}
        anchors={project.anchors ?? []}
      />
    </div>
  );
}

function CastNextAction({
  canProceed,
  busy,
  ready,
  total,
  batchRange,
  onGenerate,
  onContinue,
}: {
  canProceed: boolean;
  busy: boolean;
  ready: number;
  total: number;
  batchRange: ReturnType<typeof useImageBatchRange>;
  onGenerate: () => void;
  onContinue: () => void;
}) {
  if (canProceed) {
    return (
      <span className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
          <CheckCircle2 className="size-3.5" />
          {total === 0 ? "No cast needed" : "Cast ready"}
        </span>
        <Button size="sm" rightIcon={<ArrowRight className="size-4" />} onClick={onContinue}>
          Continue to pages
        </Button>
      </span>
    );
  }

  const pending = Math.max(0, total - ready);
  return (
    <Button
      size="sm"
      loading={busy}
      disabled={total === 0}
      leftIcon={!busy ? <Sparkles className="size-4" /> : undefined}
      onClick={onGenerate}
    >
      {busy
        ? "Creating…"
        : pending === total
          ? "Create all references"
          : `Create ${pending} remaining`}
      {!busy && <SparkEstimateCost range={batchRange} />}
    </Button>
  );
}

function EmptyCastStage({ onAdd, onContinue }: { onAdd: () => void; onContinue: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white text-brand-500 shadow-soft ring-1 ring-ink-100">
        <Users className="size-6" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-700">No cast members yet</p>
        <p className="mt-1 max-w-xs text-xs text-ink-400">
          Add someone from the strip on the left, or continue straight to designing your pages.
        </p>
      </div>
      <div className="mt-1 flex items-center justify-center gap-2">
        <Button size="sm" variant="secondary" onClick={onAdd}>
          Add a character
        </Button>
        <Button size="sm" rightIcon={<ArrowRight className="size-4" />} onClick={onContinue}>
          Continue to pages
        </Button>
      </div>
    </div>
  );
}
