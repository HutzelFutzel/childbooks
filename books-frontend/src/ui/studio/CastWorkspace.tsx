/**
 * Design · Cast is a checkpoint, not a miniature editor.
 *
 * The default path is one glance at the inferred cast and one action to create
 * every missing look. A member opens an optional drawer for corrections and
 * refinements; those tools never compete with the main flow.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Anchor } from "../../core/types";
import { anchorThumbBlobId, analyzeCurrentStory, currentAnchorImage } from "../../state/ai";
import { isAbortError } from "../../core/errors";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { AnchorEditor } from "../anchors/AnchorEditor";
import { ANCHOR_TYPE_ICON } from "../anchors/AnchorCard";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { Button } from "../components/Button";
import { Celebrate } from "../components/Celebrate";
import { Drawer } from "../components/Drawer";
import { FastDraftBadge } from "../components/FastDraftBadge";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { Modal } from "../components/Modal";
import {
  SparkEstimateCost,
  useImageActionRange,
  useImageBatchRange,
} from "../layout/SparkCost";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { generateAllAnchors, generateAnchorViaJob } from "./studioGen";

const ANALYSIS_PHASES: PipelinePhase[] = [
  { id: "read", label: "Reading your story and meeting its cast", icon: BookOpen },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function suggestedAgeForAudience(ageRangeId: string): number {
  return { "0-2": 2, "3-5": 5, "6-8": 7, "9-12": 10 }[ageRangeId] ?? 6;
}

export function CastWorkspace({
  analysisRun,
  onRetryAnalysis,
}: {
  analysisRun: { status: "idle" | "running" | "error"; message?: string };
  onRetryAnalysis: () => void;
}) {
  const {
    project,
    setStep,
    generatingAnchors,
    setAnchorGenerating,
    busy,
    setBusy,
    startGeneration,
  } = useStudio();
  const setAnchors = useProjectsStore((s) => s.setAnchors);
  const updateAnchor = useProjectsStore((s) => s.updateAnchor);
  const removeAnchor = useProjectsStore((s) => s.removeAnchor);
  const patchAnalysis = useProjectsStore((s) => s.patchAnalysis);
  const activeJobUnitIds = useJobsStore((s) => s.activeUnitIds);
  const models = useResolvedModels();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [analyzing, setAnalyzing] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);
  const [deletingAnchorId, setDeletingAnchorId] = useState<string | null>(null);

  const allAnchors = project.anchors ?? [];
  const anchors = allAnchors.filter((anchor) => anchor.include);
  const ready = anchors.filter((anchor) => currentAnchorImage(anchor)).length;
  const pending = Math.max(0, anchors.length - ready);
  const allReady = anchors.length > 0 && pending === 0;
  const canProceed = allReady || (Boolean(project.analysis) && anchors.length === 0);
  const analysisPending = !project.analysis;
  const generatingIds = new Set<string>([...generatingAnchors, ...activeJobUnitIds]);
  const activeGeneratingCount = anchors.filter((anchor) => generatingIds.has(anchor.id)).length;
  const remaining = anchors.filter(
    (anchor) => !currentAnchorImage(anchor) && !generatingIds.has(anchor.id),
  ).length;
  const activeAnchor =
    allAnchors.find((anchor) => anchor.id === editingAnchorId) ?? null;
  const deletingAnchor =
    allAnchors.find((anchor) => anchor.id === deletingAnchorId) ?? null;

  const batchRange = useImageBatchRange([{ action: "anchorImage", count: remaining }]);

  // Age is useful prompt context, not a form gate. Old projects may not have
  // the field, so fill it once from the book's audience and keep moving.
  useEffect(() => {
    const fallbackAge = suggestedAgeForAudience(project.config.ageRangeId);
    const next = allAnchors.map((anchor) =>
      anchor.type === "character" && anchor.ageYears === undefined
        ? { ...anchor, ageYears: fallbackAge, ageSource: "suggested" as const }
        : anchor,
    );
    if (next.some((anchor, index) => anchor !== allAnchors[index])) {
      void setAnchors(next);
    }
  }, [allAnchors, project.config.ageRangeId, setAnchors]);

  useEffect(() => {
    if (editingAnchorId && !activeAnchor) setEditingAnchorId(null);
  }, [activeAnchor, editingAnchorId]);

  // Legacy analyses have no story snapshot. Stamp the current text so refresh
  // only appears after a real subsequent edit.
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
      notify.success("Cast refreshed", "We updated the cast from your story.");
    } catch (err) {
      notify.error(err);
    } finally {
      setAnalyzing(false);
    }
  }

  async function addAnchor() {
    const next: Anchor = {
      id: uid(),
      name: "New character",
      type: "character",
      description: "A recurring character from this story, in the book's chosen art style.",
      importance: "medium",
      mode: "creative",
      include: true,
      source: "user",
      ageYears: suggestedAgeForAudience(project.config.ageRangeId),
      ageSource: "suggested",
    };
    await setAnchors([...allAnchors, next]);
    setEditingAnchorId(next.id);
  }

  async function generateAll() {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }

    // Empty legacy descriptions should not turn Cast into a mandatory form.
    // Give the image model a safe story-grounded fallback that remains editable
    // from the optional drawer.
    const latest = useProjectsStore.getState().current();
    if (!latest) return;
    const normalized = (latest.anchors ?? []).map((anchor) =>
      anchor.include && !anchor.description.trim()
        ? {
            ...anchor,
            description: `A recurring ${anchor.type} from this story, in the book's chosen art style.`,
          }
        : anchor,
    );
    if (normalized.some((anchor, index) => anchor !== latest.anchors?.[index])) {
      await setAnchors(normalized);
    }

    const current = useProjectsStore.getState().current();
    if (!current) return;
    const skipIds = new Set<string>([
      ...generatingAnchors,
      ...useJobsStore.getState().activeUnitIds,
    ]);
    const toCreate = (current.anchors ?? []).filter(
      (anchor) =>
        anchor.include && !currentAnchorImage(anchor) && !skipIds.has(anchor.id),
    );
    if (toCreate.length === 0) return;

    const signal = startGeneration();
    let failures = 0;
    setBusy(true);
    try {
      const started = await generateAllAnchors(
        current,
        setAnchorGenerating,
        (err) => {
          if (isAbortError(err)) return;
          failures += 1;
          notify.error(err);
        },
        signal,
        skipIds,
      );
      if (started && !signal.aborted && failures === 0) {
        const after = useProjectsStore.getState().current();
        const unfinished = (after?.anchors ?? []).some(
          (anchor) => anchor.include && !currentAnchorImage(anchor),
        );
        if (!unfinished) {
          notify.success("Cast ready", "You can continue or tap a look to refine it.");
          setCelebrate(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function generateOne(anchorId: string) {
    if (!models) {
      notify.error("AI generation isn't available yet — it's being set up on the server.");
      return;
    }
    const latest = useProjectsStore.getState().current();
    if (!latest) return;
    const target = latest.anchors?.find((anchor) => anchor.id === anchorId);
    if (!target) return;

    if (!target.description.trim()) {
      await updateAnchor(anchorId, {
        description: `A recurring ${target.type} from this story, in the book's chosen art style.`,
      });
    }

    const current = useProjectsStore.getState().current();
    if (!current) return;
    setAnchorGenerating(anchorId, true);
    try {
      await generateAnchorViaJob(current, anchorId, {}, (error) => notify.error(error));
    } finally {
      setAnchorGenerating(anchorId, false);
    }
  }

  if (analysisPending) {
    if (analysisRun.status === "error") {
      return (
        <div className="flex h-full items-center justify-center bg-aurora px-5">
          <div className="max-w-md rounded-3xl bg-white p-6 text-center shadow-lifted ring-1 ring-ink-100">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
              <AlertCircle className="size-6" />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold text-ink-800">
              Your cast is waiting
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              {analysisRun.message ?? "We couldn't read the story this time."}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="secondary" onClick={() => setStep("story")}>
                Return to story
              </Button>
              <Button leftIcon={<Sparkles className="size-4" />} onClick={onRetryAnalysis}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center bg-aurora">
        <PipelineStepper
          title="Meeting your cast…"
          subtitle="We’re finding the recurring characters and places that should stay recognizable on every page."
          phases={ANALYSIS_PHASES}
          activeIndex={0}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-aurora">
      <Celebrate play={celebrate} />

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 pb-32 pt-7 sm:px-7 sm:pt-10">
          <header className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
              {allReady ? <Check className="size-3.5" /> : <Sparkles className="size-3.5" />}
              {allReady ? "All looks ready" : "Details inferred from your story"}
            </span>
            <h1 className="mt-4 font-display text-2xl font-semibold text-ink-900 sm:text-3xl">
              {allReady ? "Your cast is ready" : "Meet your cast"}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-500 sm:text-base">
              {anchors.length > 0
                ? allReady
                  ? "These references keep every character and place recognizable across the book."
                  : "We prepared the recurring characters and places. Adjust anything that matters, or create them as-is."
                : "This story does not need a fixed visual cast. You can continue, or add one recurring character."}
            </p>
          </header>

          {storyChanged && (
            <div className="mx-auto mt-6 flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3">
              <p className="text-xs leading-relaxed text-amber-900">
                Your story changed after this cast was prepared.
              </p>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={
                  analyzing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wand2 className="size-4" />
                  )
                }
                onClick={() => void reanalyze()}
                disabled={analyzing}
              >
                Refresh
              </Button>
            </div>
          )}

          {anchors.length > 0 ? (
            <section className="mt-8" aria-labelledby="cast-grid-title">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <h2 id="cast-grid-title" className="text-sm font-semibold text-ink-800">
                    {ready} of {anchors.length} ready
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-400">
                    Tap a card only if you want to change the suggested details.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void addAnchor()}
                  leftIcon={<Plus className="size-3.5" />}
                >
                  Add cast member
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {anchors.map((anchor, index) => (
                  <CastMemberCard
                    key={anchor.id}
                    anchor={anchor}
                    index={index}
                    generating={generatingIds.has(anchor.id)}
                    onOpen={() => setEditingAnchorId(anchor.id)}
                    onCreate={() => void generateOne(anchor.id)}
                    onDelete={() => setDeletingAnchorId(anchor.id)}
                    onAgeChange={(ageYears) =>
                      void updateAnchor(anchor.id, { ageYears, ageSource: "author" })
                    }
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-3xl border border-dashed border-ink-200 bg-white/70 px-6 py-9 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <ImagePlus className="size-5" />
              </span>
              <button
                type="button"
                onClick={() => void addAnchor()}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                <Plus className="size-4" />
                Add a recurring character
              </button>
            </div>
          )}
        </div>
      </main>

      <CastActionBar
        canProceed={canProceed}
        screenplayReady={Boolean(project.screenplay)}
        busy={busy}
        activeGeneratingCount={activeGeneratingCount}
        ready={ready}
        total={anchors.length}
        remaining={remaining}
        batchRange={batchRange}
        onGenerate={() => void generateAll()}
        onContinue={() => setStep("edit")}
      />

      <Drawer
        open={Boolean(activeAnchor)}
        onClose={() => setEditingAnchorId(null)}
        side={isMobile ? "bottom" : "right"}
        widthClass="max-w-md"
        title={activeAnchor ? `Edit ${activeAnchor.name}` : "Edit cast member"}
      >
        {activeAnchor && (
          <AnchorEditor
            anchor={activeAnchor}
            generating={generatingAnchors.has(activeAnchor.id)}
            setGenerating={(value) => setAnchorGenerating(activeAnchor.id, value)}
            onRemoved={() => setEditingAnchorId(null)}
          />
        )}
      </Drawer>

      <Modal
        open={Boolean(deletingAnchor)}
        onClose={() => setDeletingAnchorId(null)}
        title={deletingAnchor ? `Remove ${deletingAnchor.name}?` : "Remove cast member?"}
        size="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingAnchorId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!deletingAnchor) return;
                if (editingAnchorId === deletingAnchor.id) setEditingAnchorId(null);
                void removeAnchor(deletingAnchor.id);
                setDeletingAnchorId(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          This removes the cast reference and its artwork. Existing page images stay unchanged.
        </p>
      </Modal>
    </div>
  );
}

function CastMemberCard({
  anchor,
  index,
  generating,
  onOpen,
  onCreate,
  onDelete,
  onAgeChange,
}: {
  anchor: Anchor;
  index: number;
  generating: boolean;
  onOpen: () => void;
  onCreate: () => void;
  onDelete: () => void;
  onAgeChange: (age: number) => void;
}) {
  const image = currentAnchorImage(anchor);
  const Icon = ANCHOR_TYPE_ICON[anchor.type];
  const sparkRange = useImageActionRange("anchorImage");

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.24), duration: 0.24 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-ink-100 transition hover:-translate-y-0.5 hover:shadow-lifted hover:ring-brand-200"
    >
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Remove ${anchor.name}`}
        title={`Remove ${anchor.name}`}
        className="absolute right-3 top-3 z-30 flex size-8 items-center justify-center rounded-full bg-white/95 text-ink-500 opacity-100 shadow-soft ring-1 ring-ink-200 backdrop-blur transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full overflow-hidden bg-ink-50 text-left"
        aria-label={`Edit ${anchor.name}`}
      >
        {generating ? (
          <div className="aspect-3/2">
            <GenerationOverlay action="anchorImage" compact />
          </div>
        ) : (
          <BlobThumbnail
            blobId={anchorThumbBlobId(anchor)}
            alt={anchor.name}
            aspect={3 / 2}
            className="rounded-none"
            fallback={
              <span className="flex flex-col items-center gap-2 text-brand-400">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-soft ring-1 ring-brand-100">
                  <Icon className="size-5" />
                </span>
                <span className="text-xs font-semibold text-ink-500">Ready to create</span>
              </span>
            }
          />
        )}

        <span
          className={cn(
            "absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-soft ring-1 ring-inset",
            generating
              ? "bg-white/95 text-brand-700 ring-brand-100"
              : image
                ? "bg-emerald-50/95 text-emerald-700 ring-emerald-200"
                : "bg-white/95 text-ink-600 ring-ink-200",
          )}
        >
          {generating ? "Creating…" : image ? "Ready" : "Looks good"}
        </span>
        {image?.imageTier === "quick" && (
          <FastDraftBadge compact className="left-auto right-12 top-3" />
        )}
      </button>

      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold text-ink-900">{anchor.name}</span>
          <span className="block text-[11px] capitalize text-ink-400">{anchor.type}</span>
        </button>
        {anchor.type === "character" && (
          <AgeChip
            name={anchor.name}
            age={anchor.ageYears ?? 6}
            onChange={onAgeChange}
          />
        )}
      </div>
      {image ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-auto flex w-full items-center justify-center gap-1.5 border-t border-ink-100 px-4 py-2.5 text-xs font-medium text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
        >
          <Pencil className="size-3.5" />
          Refine this look
        </button>
      ) : (
        <button
          type="button"
          onClick={onCreate}
          disabled={generating}
          className="mt-auto flex w-full items-center justify-center gap-1.5 border-t border-brand-100 bg-brand-50 px-4 py-2.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-wait disabled:opacity-60"
        >
          {generating ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              Create this look
              <SparkEstimateCost range={sparkRange} />
            </>
          )}
        </button>
      )}
    </motion.article>
  );
}

function AgeChip({
  name,
  age,
  onChange,
}: {
  name: string;
  age: number;
  onChange: (age: number) => void;
}) {
  const [value, setValue] = useState(String(age));

  useEffect(() => setValue(String(age)), [age]);

  function commit() {
    const parsed = Math.min(120, Math.max(0, Number(value)));
    if (Number.isFinite(parsed)) {
      setValue(String(parsed));
      if (parsed !== age) onChange(parsed);
    } else {
      setValue(String(age));
    }
  }

  return (
    <label className="flex shrink-0 items-center gap-1 rounded-full bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-500 ring-1 ring-inset ring-ink-100 focus-within:ring-brand-300">
      <span>Age</span>
      <input
        type="number"
        min={0}
        max={120}
        value={value}
        aria-label={`Age of ${name}`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-7 bg-transparent text-center font-semibold tabular-nums text-ink-800 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

function CastActionBar({
  canProceed,
  screenplayReady,
  busy,
  activeGeneratingCount,
  ready,
  total,
  remaining,
  batchRange,
  onGenerate,
  onContinue,
}: {
  canProceed: boolean;
  screenplayReady: boolean;
  busy: boolean;
  activeGeneratingCount: number;
  ready: number;
  total: number;
  remaining: number;
  batchRange: ReturnType<typeof useImageBatchRange>;
  onGenerate: () => void;
  onContinue: () => void;
}) {
  const creatingNow = Math.max(activeGeneratingCount, busy ? remaining : 0);
  const statusLabel = busy
    ? `Creating ${creatingNow} ${creatingNow === 1 ? "look" : "looks"}…`
    : canProceed
      ? total === 0
        ? "No cast needed"
        : "Everything looks consistent"
      : remaining > 0
        ? `${remaining} ${remaining === 1 ? "look" : "looks"} left`
        : activeGeneratingCount > 0
          ? `Creating ${activeGeneratingCount} ${activeGeneratingCount === 1 ? "look" : "looks"}…`
          : `${total} ${total === 1 ? "look" : "looks"} ready to create`;
  const statusHint = busy
    ? "You can leave this step while the cast is being created."
    : canProceed
      ? "You can still refine any card later."
      : remaining > 0 && activeGeneratingCount > 0
        ? "Creates every look that isn’t already in progress."
        : "One click creates every missing reference.";
  const generateLabel = busy
    ? "Creating cast…"
    : remaining === 0 && activeGeneratingCount > 0
      ? "Creating looks…"
      : ready > 0 || activeGeneratingCount > 0
        ? "Create remaining looks"
        : "Create my cast";

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 border-t border-ink-100 bg-white/95 px-4 py-3 shadow-[0_-12px_32px_rgba(39,28,70,0.08)] backdrop-blur sm:px-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex items-center gap-2 text-center sm:text-left">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              canProceed ? "bg-emerald-100 text-emerald-700" : "bg-brand-50 text-brand-700",
            )}
          >
            {canProceed ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-4" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-800">{statusLabel}</p>
            <p className="text-[11px] text-ink-400">{statusHint}</p>
          </div>
        </div>

        {canProceed ? (
          <Button
            className="w-full sm:w-auto"
            disabled={!screenplayReady}
            rightIcon={screenplayReady ? <ArrowRight className="size-4" /> : undefined}
            onClick={onContinue}
          >
            {screenplayReady ? "Continue to pages" : "Preparing pages…"}
          </Button>
        ) : (
          <Button
            className="w-full sm:w-auto"
            loading={busy}
            disabled={total === 0 || remaining === 0}
            leftIcon={!busy ? <Sparkles className="size-4" /> : undefined}
            onClick={onGenerate}
          >
            {generateLabel}
            {!busy && remaining > 0 && <SparkEstimateCost range={batchRange} />}
          </Button>
        )}
      </div>
    </div>
  );
}
