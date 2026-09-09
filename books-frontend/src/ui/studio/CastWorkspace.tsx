/**
 * Characters & places is the required consistency checkpoint before Pages.
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
  CheckCircle2,
  ImagePlus,
  Loader2,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Anchor } from "../../core/types";
import { anchorThumbBlobId, analyzeCurrentStory, currentAnchorImage } from "../../state/ai";
import { isAbortError } from "../../core/errors";
import { stripNumericAgeFromDescription } from "../../core/book/anchorDescription";
import { defaultCharacterAge } from "../../core/book/characterAge";
import { resolveArtStyleDisplayName } from "../../core/prompts/style";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useJobsStore, type ScreenplayJobSummary } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { AnchorEditor } from "../anchors/AnchorEditor";
import { ANCHOR_TYPE_ICON } from "../anchors/AnchorCard";
import { BlobThumbnail } from "../components/BlobThumbnail";
import { useLikenessPhotoUrl } from "../components/LikenessPhotoField";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { Button } from "../components/Button";
import { Celebrate } from "../components/Celebrate";
import { Drawer } from "../components/Drawer";
import { GenerationOverlay } from "../generation/GenerationOverlay";
import { Modal } from "../components/Modal";
import {
  SparkEstimateCost,
  useImageBatchRange,
} from "../layout/SparkCost";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { generateAllAnchors } from "./studioGen";
import { likenessPhotoExpired } from "../../platform/likeness";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
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
    navigate,
    setStep,
    generatingAnchors,
    setAnchorGenerating,
    busy,
    setBusy,
    startGeneration,
  } = useStudio();
  const setAnchors = useProjectsStore((s) => s.setAnchors);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const updateAnchor = useProjectsStore((s) => s.updateAnchor);
  const removeAnchor = useProjectsStore((s) => s.removeAnchor);
  const patchAnalysis = useProjectsStore((s) => s.patchAnalysis);
  const activeJobUnitIds = useJobsStore((s) => s.activeUnitIds);
  const screenplayJob = useJobsStore((s) => s.screenplayJob);
  const startScreenplay = useJobsStore((s) => s.startScreenplay);
  const artStyles = useAppConfigStore((s) => s.artStyles);
  const models = useResolvedModels();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [analyzing, setAnalyzing] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);
  const [deletingAnchorId, setDeletingAnchorId] = useState<string | null>(null);

  const styleLabel = resolveArtStyleDisplayName(project.config.artStyle, artStyles);

  const allAnchors = project.anchors ?? [];
  const anchors = allAnchors.filter((anchor) => anchor.include);
  const ready = anchors.filter((anchor) => currentAnchorImage(anchor)).length;
  const pending = Math.max(0, anchors.length - ready);
  const estimatedAgesCount = anchors.filter(
    (anchor) => anchor.type === "character" && anchor.ageSource === "suggested",
  ).length;
  const expiredPhotoCount = anchors.filter(
    (anchor) =>
      !currentAnchorImage(anchor) &&
      likenessPhotoExpired(anchor.likenessPhoto),
  ).length;
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

  // Keep age in its dedicated field. Old projects may have a numeric age baked
  // into the description or no age field at all, so normalize both once. The
  // fallback considers role/species before using the child audience range.
  useEffect(() => {
    let changed = false;
    const next = allAnchors.map((anchor) => {
      if (anchor.type !== "character" || anchor.ageYears !== undefined) return anchor;
      changed = true;
      const description = anchor.descriptionUserEdited
        ? anchor.description
        : stripNumericAgeFromDescription(anchor.description);
      return {
        ...anchor,
        description,
        ageYears: defaultCharacterAge(anchor, project.config.ageRangeId),
        ageSource: "suggested" as const,
      };
    });
    if (changed) {
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
      ageYears: defaultCharacterAge(
        { name: "New character", description: "", bodyPlan: "bipedal" },
        project.config.ageRangeId,
      ),
      ageSource: "suggested",
    };
    void updateConfig({ castReady: false });
    await setAnchors([...allAnchors, next]);
    setEditingAnchorId(next.id);
  }

  function continueToPages() {
    // The Zustand mutation is synchronous, so the route guard observes the
    // confirmation immediately while persistence completes in the background.
    void updateConfig({ castReady: true });
    setStep("edit");
  }

  async function retryScreenplay() {
    const current = useProjectsStore.getState().current();
    if (!current?.analysis) return;
    try {
      await startScreenplay(current, true);
    } catch (err) {
      notify.error(err);
    }
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
      // The store updates synchronously; persistence can continue while the
      // job snapshots that fresh in-memory project.
      void setAnchors(normalized);
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
      const outcome = await generateAllAnchors(
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
      failures += outcome.failed;
      if (!outcome.started || signal.aborted) {
        // A refused batch already explained itself; a cancelled one is not a
        // failure worth reporting.
      } else if (failures > 0) {
        // Per-look failures arrive as a count rather than one toast each, so
        // this is the only place they get reported.
        notify.info(
          "Finished with some errors",
          `${failures} look${failures === 1 ? "" : "s"} couldn't be generated — tap one to try again.`,
        );
      } else {
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
      <div className="h-full overflow-y-auto bg-ink-50/30">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-7">
          <header className="max-w-2xl">
            <h1 className="font-display text-2xl font-semibold text-ink-900">
              Preparing your characters
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              We’re finding the people and places that should stay recognizable throughout your book.
            </p>
          </header>

          <section className="mt-6" aria-label="Preparing character references">
            <p className="text-sm font-semibold text-ink-800">Characters and places</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-xl border border-ink-200 bg-white"
                  aria-hidden
                >
                  <div className="aspect-3/2 animate-pulse bg-ink-100" />
                  <div className="space-y-2 p-4">
                    <div className="h-3 w-28 animate-pulse rounded-full bg-ink-100" />
                    <div className="h-2.5 w-16 animate-pulse rounded-full bg-ink-100" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-ink-50/30">
      <Celebrate play={celebrate} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-7">
          <header className="max-w-2xl">
            <h1 className="font-display text-2xl font-semibold text-ink-900">
              {allReady
                ? "Your book’s characters"
                : busy || activeGeneratingCount > 0
                  ? "Creating your book’s characters"
                  : "Review your cast"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              {anchors.length > 0
                ? allReady
                  ? "Check the main character, then open your pages. Tap anyone to make changes."
                  : busy || activeGeneratingCount > 0
                    ? "We’re creating every missing look in the book’s style."
                    : "We found these characters and places in your story. Edit or remove anything, and add anyone we missed."
                : "No recurring characters or places are needed for this story."}
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
            <section className="mt-6" aria-labelledby="cast-grid-title">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="cast-grid-title" className="text-sm font-semibold text-ink-800">
                    Characters and places
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {estimatedAgesCount > 0
                      ? `Missing ages were estimated. Change ${estimatedAgesCount === 1 ? "it" : "them"} only if needed.`
                      : "Tap any card to edit its details."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Palette className="size-3.5 text-ink-500" />}
                    onClick={() => navigate("style")}
                    title="Change art style"
                  >
                    {styleLabel}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void addAnchor()}
                    leftIcon={<Plus className="size-3.5" />}
                  >
                    Add character or place
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {anchors.map((anchor, index) => (
                  <CastMemberCard
                    key={anchor.id}
                    anchor={anchor}
                    index={index}
                    generating={generatingIds.has(anchor.id)}
                    onOpen={() => setEditingAnchorId(anchor.id)}
                    onDelete={() => setDeletingAnchorId(anchor.id)}
                    ageEstimated={anchor.ageSource === "suggested"}
                    onAgeChange={(ageYears) =>
                      void updateAnchor(anchor.id, { ageYears, ageSource: "author" })
                    }
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="mt-6 flex max-w-md flex-col items-center rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-9 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <ImagePlus className="size-5" />
              </span>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void addAnchor()}
                  leftIcon={<Plus className="size-3.5" />}
                >
                  Add character or place
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("style")}
                  leftIcon={<Palette className="size-3.5 text-ink-500" />}
                >
                  {styleLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CastActionBar
        canProceed={canProceed}
        screenplayReady={Boolean(project.screenplay)}
        screenplayJob={screenplayJob}
        busy={busy}
        activeGeneratingCount={activeGeneratingCount}
        ready={ready}
        total={anchors.length}
        remaining={remaining}
        expiredPhotoCount={expiredPhotoCount}
        batchRange={batchRange}
        onGenerate={() => void generateAll()}
        onContinue={continueToPages}
        onRetryScreenplay={() => void retryScreenplay()}
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
            key={activeAnchor.id}
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
  onDelete,
  ageEstimated,
  onAgeChange,
}: {
  anchor: Anchor;
  index: number;
  generating: boolean;
  onOpen: () => void;
  onDelete: () => void;
  ageEstimated: boolean;
  onAgeChange: (age: number) => void;
}) {
  const image = currentAnchorImage(anchor);
  const Icon = ANCHOR_TYPE_ICON[anchor.type];
  const photoExpired =
    anchor.type === "character" &&
    !image &&
    likenessPhotoExpired(anchor.likenessPhoto);
  const photoReady =
    anchor.type === "character" &&
    !image &&
    Boolean(anchor.likenessPhoto) &&
    !likenessPhotoExpired(anchor.likenessPhoto);
  const artReady =
    anchor.type === "character" &&
    !image &&
    Boolean(anchor.sourceArt?.length);

  const project = useProjectsStore((state) => state.current());
  const projectId = project?.id ?? "";
  const sourceMember = project?.config.storyBrief?.cast?.find(
    (m) => m.likenessPhoto?.createdAt === anchor.likenessPhoto?.createdAt,
  );
  const photoSubjectId = sourceMember?.id ?? anchor.id;
  const { url: likenessUrl, loading: likenessLoading } = useLikenessPhotoUrl(
    projectId,
    photoSubjectId,
    photoReady ? anchor.likenessPhoto : undefined,
  );
  const { url: sourceArtUrl, status: sourceArtStatus } = useBlobUrlState(
    artReady ? anchor.sourceArt?.[0]?.blobId : undefined,
  );

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.24), duration: 0.24 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-white"
    >
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Remove ${anchor.name} from cast`}
        title={`Remove ${anchor.name} from cast`}
        className="absolute right-3 top-3 z-30 flex size-8 items-center justify-center rounded-full bg-white/95 text-ink-500 shadow-soft ring-1 ring-ink-200 backdrop-blur transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      >
        <Trash2 className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full overflow-hidden bg-ink-50 text-left"
        aria-label={`Edit ${anchor.name}`}
      >
        <BlobThumbnail
          blobId={anchorThumbBlobId(anchor)}
          alt={anchor.name}
          aspect={3 / 2}
          className="rounded-none"
          fallback={
            <span className="flex max-w-60 flex-col items-center px-4 text-center">
              {photoReady || artReady ? (
                <div className="relative mb-2 flex size-14 items-center justify-center overflow-hidden rounded-2xl bg-ink-100 shadow-soft ring-2 ring-white ring-offset-2 ring-offset-emerald-100">
                  {photoReady && likenessUrl ? (
                    <img
                      src={likenessUrl}
                      alt={`Photo for ${anchor.name}`}
                      className="size-full object-cover"
                    />
                  ) : artReady && sourceArtUrl ? (
                    <img
                      src={sourceArtUrl}
                      alt={`Artwork for ${anchor.name}`}
                      className="size-full object-cover"
                    />
                  ) : (photoReady && likenessLoading) ||
                    (artReady && sourceArtStatus === "loading") ? (
                    <div className="size-full animate-pulse bg-ink-200" />
                  ) : (
                    <Icon className="size-5 text-brand-400" />
                  )}
                  <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-white shadow-xs">
                    <CheckCircle2 className="size-3.5" />
                  </span>
                </div>
              ) : (
                <span className="relative mb-2.5 flex size-12 items-center justify-center rounded-2xl bg-white text-brand-400 shadow-soft ring-1 ring-brand-100">
                  <Icon className="size-5" />
                </span>
              )}
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-[0.16em]",
                  photoReady || artReady ? "text-emerald-700" : "text-brand-400",
                )}
              >
                {photoReady
                  ? "From your photo"
                  : artReady
                    ? "From your character artwork"
                    : "Illustrated look"}
              </span>
              <span className="mt-1 text-xs font-semibold text-ink-700">
                {photoExpired
                  ? "Photo expired — tap to fix"
                  : photoReady
                    ? "Ready to create illustrated look"
                    : artReady
                      ? "Ready to create illustrated look"
                      : "Ready to create from details"}
              </span>
              {photoReady && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200/60">
                  <Sparkles className="size-3 text-emerald-600" />
                  Photo attached
                </span>
              )}
              {artReady && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200/60">
                  <Sparkles className="size-3 text-emerald-600" />
                  Artwork attached
                </span>
              )}
            </span>
          }
        />
        {generating && (
          <GenerationOverlay
            action="anchorImage"
            compact
            compactLabel={
              photoReady
                ? "Creating from your photo…"
                : artReady
                  ? "Creating from your artwork…"
                  : "Creating illustrated look…"
            }
            className="bg-magic"
          />
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
            estimated={ageEstimated}
            onChange={onAgeChange}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-auto flex w-full items-center justify-center gap-1.5 border-t border-ink-100 px-4 py-2.5 text-xs font-medium text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
      >
        <Pencil className="size-3.5" />
        {image ? "Refine this look" : "Edit details"}
      </button>
    </motion.article>
  );
}

function AgeChip({
  name,
  age,
  estimated,
  onChange,
}: {
  name: string;
  age: number;
  estimated: boolean;
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
    <label
      className="flex shrink-0 items-center gap-1 rounded-full bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-500 ring-1 ring-inset ring-ink-100 focus-within:ring-brand-300"
    >
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
      {estimated && (
        <span className="text-ink-400" title="Estimated from the story and character role">
          · estimated
        </span>
      )}
    </label>
  );
}

function CastActionBar({
  canProceed,
  screenplayReady,
  screenplayJob,
  busy,
  activeGeneratingCount,
  ready,
  total,
  remaining,
  expiredPhotoCount,
  batchRange,
  onGenerate,
  onContinue,
  onRetryScreenplay,
}: {
  canProceed: boolean;
  screenplayReady: boolean;
  screenplayJob: ScreenplayJobSummary | null;
  busy: boolean;
  activeGeneratingCount: number;
  ready: number;
  total: number;
  remaining: number;
  expiredPhotoCount: number;
  batchRange: ReturnType<typeof useImageBatchRange>;
  onGenerate: () => void;
  onContinue: () => void;
  onRetryScreenplay: () => void;
}) {
  const creatingNow = Math.max(activeGeneratingCount, busy ? remaining : 0);
  const screenplayFailed = screenplayJob?.status === "error";
  const statusLabel = screenplayFailed
    ? "The page draft needs another try"
    : busy
    ? `Creating ${creatingNow} ${creatingNow === 1 ? "look" : "looks"}…`
    : expiredPhotoCount > 0
      ? `${expiredPhotoCount} ${expiredPhotoCount === 1 ? "photo needs" : "photos need"} to be added again`
    : canProceed
      ? total === 0
        ? "No cast needed"
        : "Everything looks consistent"
      : ready === 0 && activeGeneratingCount === 0
        ? `${remaining} ${remaining === 1 ? "look is" : "looks are"} ready to create`
      : remaining > 0
        ? `${remaining} ${remaining === 1 ? "look" : "looks"} left`
        : activeGeneratingCount > 0
          ? `Creating ${activeGeneratingCount} ${activeGeneratingCount === 1 ? "look" : "looks"}…`
          : `${total} ${total === 1 ? "look" : "looks"} ready to create`;
  const statusHint = screenplayFailed
    ? screenplayJob.error ?? "The first attempt stopped before the pages were ready."
    : busy
    ? "You can leave this step while the cast is being created."
    : expiredPhotoCount > 0
      ? "Tap the affected character to replace or remove the expired photo."
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
        : `Create all ${remaining} ${remaining === 1 ? "look" : "looks"}`;

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white px-4 py-3 sm:px-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex items-center gap-2 text-center sm:text-left">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              canProceed ? "bg-emerald-100 text-emerald-700" : "bg-brand-50 text-brand-700",
            )}
          >
            {canProceed ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-800">{statusLabel}</p>
            <p className="text-[11px] text-ink-400">{statusHint}</p>
          </div>
        </div>

        {canProceed && screenplayFailed ? (
          <Button
            className="w-full sm:w-auto"
            leftIcon={<RefreshCw className="size-4" />}
            onClick={onRetryScreenplay}
          >
            Try preparing pages again
          </Button>
        ) : canProceed ? (
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
            disabled={total === 0 || remaining === 0 || expiredPhotoCount > 0}
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
