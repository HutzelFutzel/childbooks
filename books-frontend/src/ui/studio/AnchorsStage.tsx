import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Box,
  Loader2,
  Lock,
  MapPin,
  Plus,
  Sparkles,
  User,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { InfoHint } from "../components/InfoHint";
import { StickyActionBar } from "../components/StickyActionBar";
import type { Anchor, AnchorType } from "../../core/types";
import { analyzeCurrentStory, currentAnchorImage } from "../../state/ai";
import { isAbortError } from "../../core/errors";
import { useProjectsStore } from "../../state/projectsStore";
import { useFeatureAllowed } from "../../state/subscriptionStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { ImportAnchorsDialog } from "./ImportAnchorsDialog";
import { Button } from "../components/Button";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { generateAllAnchors } from "./studioGen";

const TYPE_ICON: Record<AnchorType, typeof User> = {
  character: User,
  place: MapPin,
  object: Box,
};

const ANALYSIS_PHASES: PipelinePhase[] = [
  { id: "read", label: "Reading your story", icon: BookOpen },
  { id: "cast", label: "Finding characters & places", icon: Users },
  { id: "ready", label: "Getting your cast ready", icon: Sparkles },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Step 2 · Characters. A gallery of every character & place the story needs.
 * Generate all their reference art in one tap, refine any of them in the
 * inspector, then move on to designing pages.
 */
export function AnchorsStage() {
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
  const setAnchors = useProjectsStore((s) => s.setAnchors);
  const models = useResolvedModels();
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Character transfer: gateable feature — free until an admin lists it on a
  // plan, then subscriber-only. Other projects with a cast must exist to show it.
  const transferAllowed = useFeatureAllowed("characterTransfer");
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const hasImportSources = useProjectsStore((s) =>
    s.projects.some((p) => p.id !== project.id && (p.anchors?.length ?? 0) > 0),
  );

  const anchors = (project.anchors ?? []).filter((a) => a.include);
  const ready = anchors.filter((a) => currentAnchorImage(a)).length;
  const allReady = anchors.length > 0 && ready === anchors.length;
  const analysisPending = !project.analysis;
  // Nothing left to generate — either every reference is ready, or the story
  // simply has no characters/places to draw.
  const canProceed = allReady || (Boolean(project.analysis) && anchors.length === 0);

  const batchRange = useImageBatchRange([
    { action: "anchorImage", count: Math.max(0, anchors.length - ready) },
  ]);

  // Keep the inspector useful: focus the first character when arriving here with
  // nothing (relevant) selected.
  const selectedAnchorId = selection.kind === "anchor" ? selection.anchorId : null;
  useEffect(() => {
    if (anchors.length === 0) return;
    if (!selectedAnchorId || !anchors.some((a) => a.id === selectedAnchorId)) {
      select({ kind: "anchor", anchorId: anchors[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors.length, selectedAnchorId]);

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
    void setAnchors([...(project.anchors ?? []), next]).then(() =>
      select({ kind: "anchor", anchorId: next.id }),
    );
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
      await generateAllAnchors(
        useProjectsStore.getState().current()!,
        setAnchorGenerating,
        (err) => {
          if (isAbortError(err)) return;
          failures += 1;
          notify.error(err);
        },
        signal,
      );
      if (!signal.aborted && failures === 0) {
        notify.success("Cast is ready", "Tap any character to refine its look.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-7 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          <Sparkles className="size-3.5" /> Step 2 · Characters
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-ink-900">
          Meet your cast
        </h1>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
          These are the characters & places we found in your story. Generate their reference art so
          they look consistent on every page.
        </p>
      </header>

      {analysisPending ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-aurora">
          <PipelineStepper
            title="Reading your story…"
            subtitle="We're finding the characters & places in your tale. They'll appear here in a moment."
            phases={ANALYSIS_PHASES}
            activeIndex={0}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <AnimatePresence initial={false}>
            {anchors.map((anchor) => (
              <AnchorCard
                key={anchor.id}
                anchor={anchor}
                active={selection.kind === "anchor" && selection.anchorId === anchor.id}
                generating={generatingAnchors.has(anchor.id)}
                onClick={() => select({ kind: "anchor", anchorId: anchor.id })}
              />
            ))}
          </AnimatePresence>
          <button
            onClick={addAnchor}
            className="flex aspect-3/4 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 text-ink-400 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
          >
            <Plus className="size-6" />
            <span className="text-xs font-medium">Add character</span>
          </button>
          {hasImportSources && (
            <button
              onClick={() => (transferAllowed ? setImporting(true) : openPlans())}
              className="flex aspect-3/4 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 text-ink-400 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
            >
              {transferAllowed ? <UserPlus className="size-6" /> : <Lock className="size-6" />}
              <span className="px-2 text-center text-xs font-medium">
                Import from another book
                {!transferAllowed && (
                  <span className="mt-0.5 block text-[10px] font-normal text-ink-300">
                    Subscriber perk
                  </span>
                )}
              </span>
            </button>
          )}
        </div>
      )}

      <ImportAnchorsDialog open={importing} onClose={() => setImporting(false)} project={project} />

      <div className="mt-4 flex justify-center">
        <button
          onClick={() => void reanalyze()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
        >
          {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          Re-read the story
        </button>
      </div>

      <StickyActionBar
        hint={
          <span className="flex items-center gap-1">
            <span>
              <span className="font-semibold text-ink-600">{ready}</span> of{" "}
              <span className="font-semibold text-ink-600">{anchors.length}</span> references ready
            </span>
            <InfoHint topic="generationTime" />
          </span>
        }
      >
        {canProceed ? (
          <Button
            size="lg"
            rightIcon={<ArrowRight className="size-5" />}
            onClick={() => setStep("edit")}
          >
            Design the pages
          </Button>
        ) : (
          <Button
            size="lg"
            loading={busy}
            disabled={anchors.length === 0}
            leftIcon={!busy ? <Sparkles className="size-5" /> : undefined}
            onClick={() => void generateAll()}
          >
            {busy ? "Creating…" : "Create all references"}
            {!busy && <SparkEstimateCost range={batchRange} />}
          </Button>
        )}
      </StickyActionBar>
    </div>
  );
}

function AnchorCard({
  anchor,
  active,
  generating,
  onClick,
}: {
  anchor: Anchor;
  active: boolean;
  generating: boolean;
  onClick: () => void;
}) {
  const image = currentAnchorImage(anchor);
  const url = useBlobUrl(image?.blobId);
  const Icon = TYPE_ICON[anchor.type];

  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      onClick={onClick}
      className={cn(
        "group relative flex aspect-3/4 flex-col overflow-hidden rounded-2xl bg-ink-100 text-left ring-1 transition",
        active ? "ring-2 ring-brand-400" : "ring-ink-200 hover:ring-brand-300",
      )}
    >
      <span className="relative flex flex-1 items-center justify-center overflow-hidden">
        {generating ? (
          <GenerationOverlay action="anchorImage" compact />
        ) : url ? (
          <img src={url} alt={anchor.name} className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-ink-300">
            <Icon className="size-8" />
            <span className="text-[10px] font-medium text-ink-400">No art yet</span>
          </span>
        )}
        {!generating && (
          <span
            className={cn(
              "absolute right-2 top-2 size-2.5 rounded-full ring-2 ring-white",
              url ? "bg-emerald-400" : "bg-ink-300",
            )}
          />
        )}
      </span>
      <span className="flex items-center gap-1.5 border-t border-white/40 bg-white/85 px-2.5 py-2 backdrop-blur">
        <Icon className="size-3.5 shrink-0 text-ink-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-800">
          {anchor.name}
        </span>
      </span>
    </motion.button>
  );
}
