import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  UserPlus,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { PipelineStepper, type PipelinePhase } from "../generation/PipelineStepper";
import { InfoHint } from "../components/InfoHint";
import { StageHeader } from "../components/StageHeader";
import { StickyActionBar } from "../components/StickyActionBar";
import type { Anchor } from "../../core/types";
import { analyzeCurrentStory, currentAnchorImage } from "../../state/ai";
import { isAbortError } from "../../core/errors";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { useFeatureAllowed } from "../../state/subscriptionStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { ImportAnchorsDialog } from "./ImportAnchorsDialog";
import { AnchorEditor } from "../anchors/AnchorEditor";
import { AnchorReelThumb } from "../anchors/AnchorReelThumb";
import { Button } from "../components/Button";
import { Celebrate } from "../components/Celebrate";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { generateAllAnchors } from "./studioGen";

const ANALYSIS_PHASES: PipelinePhase[] = [
  { id: "read", label: "Reading your story", icon: BookOpen },
  { id: "cast", label: "Finding characters & places", icon: Users },
  { id: "ready", label: "Getting your cast ready", icon: Sparkles },
];

/** How long a pointer has to rest on a thumbnail before it previews on the
 *  stage — long enough that scrolling past thumbnails doesn't strobe it. */
const HOVER_PREVIEW_MS = 90;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Step 2 · Characters. A "casting reel" of every character & place the story
 * needs, small enough to take in the whole cast at a glance; whichever one is
 * active gets the big spotlight underneath — its reference art, version
 * history and generation controls — instead of a separate sidebar you have
 * to look away to. Hovering a thumbnail (desktop) already spotlights it;
 * clicking/tapping commits that as the selection.
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
  // `generatingAnchors` (from studio context) only spans the brief enqueue
  // step for a single anchor's "Apply edit"/"Regenerate" — that call doesn't
  // await the worker (see `generateAnchorViaJob`), so on its own it clears the
  // reel thumb's overlay seconds before the art is actually ready. The jobs
  // store's `activeUnitIds` tracks the real background job, survives a
  // refresh, and is what `AnchorEditor` already leans on for the big
  // portrait's own spinner — union both so the reel thumb agrees with it.
  const activeJobUnitIds = useJobsStore((s) => s.activeUnitIds);
  const models = useResolvedModels();
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

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
  // The bottom bar only earns its bold, floating-over-the-page treatment at
  // the two moments that genuinely need it: before anything's been made (it's
  // the obvious first move) and once everything's ready (it's the obvious
  // next one). In between, generating references is just one thing among
  // several the user might do while browsing the cast, so the bar settles
  // into the normal flow instead of hovering over whichever anchor they're
  // actually looking at.
  const floatingBar = ready === 0 || canProceed;

  const batchRange = useImageBatchRange([
    { action: "anchorImage", count: Math.max(0, anchors.length - ready) },
  ]);

  // Which of the two selection paths caused the CURRENT stage content, so the
  // render below can skip animating for hover: a deliberate click still gets
  // the nice crossfade + height glide, but a quick sweep across the reel
  // should feel instant, not like it's dragging a 250ms animation behind the
  // cursor. A ref (not state) since it only needs to be read during render,
  // and setting it must never itself trigger a re-render.
  const swapSourceRef = useRef<"hover" | "click">("click");

  // What's committed (persisted in `selection`, survives navigating away and
  // back) vs. what's merely previewed on hover (local, forgotten the moment
  // the cursor leaves the reel without a click). Keeping these separate means
  // a careless sweep of the cursor across the reel can never leave you on a
  // character you didn't actually mean to pick — it always snaps back.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const selectedAnchorId = selection.kind === "anchor" ? selection.anchorId : null;
  const activeAnchorId = previewId ?? selectedAnchorId;
  const activeAnchor = anchors.find((a) => a.id === activeAnchorId) ?? null;

  function commitSelect(anchorId: string) {
    swapSourceRef.current = "click";
    setPreviewId(null);
    select({ kind: "anchor", anchorId });
  }

  // Keep the stage useful: focus the first character when arriving here with
  // nothing (relevant) selected.
  useEffect(() => {
    if (anchors.length === 0) return;
    if (!selectedAnchorId || !anchors.some((a) => a.id === selectedAnchorId)) {
      commitSelect(anchors[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors.length, selectedAnchorId]);

  // Hover-preview: only on devices with a real pointer, and debounced so
  // sweeping the cursor across the reel doesn't thrash the stage below. This
  // never touches the real `selection` — it only sets the local preview, so
  // leaving without clicking has nothing to undo.
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (hoverTimer.current && clearTimeout(hoverTimer.current)), []);
  function previewOnHover(anchorId: string) {
    if (!canHover) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      swapSourceRef.current = "hover";
      setPreviewId(anchorId);
    }, HOVER_PREVIEW_MS);
  }
  /** Cursor left the whole reel (not just one thumb for another) without
   *  clicking — drop the preview and snap back to the committed anchor. */
  function endPreview() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (previewId !== null) {
      swapSourceRef.current = "hover";
      setPreviewId(null);
    }
  }

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
        setCelebrate(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-5xl px-5 py-8">
      <Celebrate play={celebrate} />
      <StageHeader
        eyebrow="Step 2 · Characters"
        eyebrowIcon={ImagePlus}
        tone="sky"
        title="Meet your cast"
        subtitle="These are the characters & places we found in your story. Hover or tap anyone in the reel below to spotlight them, then generate their reference art."
      />

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
        <>
          {/* The casting reel — the whole cast at a glance. `items-start` keeps
              every thumb at its natural height instead of the flex row
              stretching them (the end-caps are a touch shorter, by design).
              `overflow-y-hidden` pins the axis `overflow-x-auto` otherwise
              forces to `auto` — without it, the active thumb's hover scale-up
              can register as scrollable overflow even when the whole cast
              already fits, making the reel feel scrollable when it isn't.
              `onMouseLeave` here (not on each thumb) is what makes the
              preview-reverts-on-exit behavior work: mouse-enter/leave don't
              bubble between siblings, so moving between thumbs never fires
              it — only actually leaving the whole reel does. */}
          <div
            className="-mx-1 flex items-start gap-4 overflow-x-auto overflow-y-hidden px-1 py-2"
            onMouseLeave={endPreview}
          >
            <AnimatePresence initial={false}>
              {anchors.map((anchor) => (
                <AnchorReelThumb
                  key={anchor.id}
                  anchor={anchor}
                  committed={selectedAnchorId === anchor.id}
                  previewing={previewId === anchor.id}
                  generating={generatingAnchors.has(anchor.id) || activeJobUnitIds.has(anchor.id)}
                  onSelect={() => commitSelect(anchor.id)}
                  onMouseEnter={() => previewOnHover(anchor.id)}
                />
              ))}
            </AnimatePresence>
            <ReelEndCap icon={Plus} label="Add" onClick={addAnchor} />
            {hasImportSources && (
              <ReelEndCap
                icon={transferAllowed ? UserPlus : Lock}
                label="Import"
                sub={!transferAllowed ? "Subscriber perk" : undefined}
                onClick={() => (transferAllowed ? setImporting(true) : openPlans())}
              />
            )}
          </div>

          {/* The stage — the active character's spotlight. `popLayout` (not
              `wait`) — with `wait`, a quick sweep across the reel that changes
              the active key again before the previous exit finishes leaves
              the old child permanently stuck mid-exit (a long-standing Framer
              Motion bug: https://github.com/motiondivision/motion/issues/2554).
              `popLayout` pulls the exiting child out of flow immediately
              instead of waiting on it, so rapid hover changes can't strand it.
              The container itself gets `layout` so a switch between anchors
              with very different content heights (versions, stale banner,
              relationships) glides to the new height instead of snapping —
              combined with a pure crossfade (no rise) on the content, that's
              what actually kills the "jumpy" feel, not just the exit fix.

              A hover-preview swap skips all of that (duration 0 everywhere):
              it's meant to feel instant while scanning the reel, not like the
              stage is dragging a 250ms animation behind the cursor. Only a
              deliberate click/tap keeps the smooth glide + crossfade. */}
          <motion.div
            layout
            transition={
              swapSourceRef.current === "hover" ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }
            }
            className="relative overflow-hidden rounded-3xl bg-aurora p-4 sm:p-6"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {activeAnchor ? (
                <motion.div
                  key={activeAnchor.id}
                  initial={{ opacity: swapSourceRef.current === "hover" ? 1 : 0 }}
                  animate={{
                    opacity: 1,
                    transition: { duration: swapSourceRef.current === "hover" ? 0 : 0.22 },
                  }}
                  exit={{
                    opacity: 0,
                    transition: { duration: swapSourceRef.current === "hover" ? 0 : 0.12 },
                  }}
                >
                  <AnchorEditor
                    layout="split"
                    anchor={activeAnchor}
                    generating={generatingAnchors.has(activeAnchor.id)}
                    setGenerating={(v) => setAnchorGenerating(activeAnchor.id, v)}
                  />
                </motion.div>
              ) : anchors.length === 0 ? (
                <EmptyStage />
              ) : null}
            </AnimatePresence>
          </motion.div>
        </>
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
        floating={floatingBar}
        hint={
          // Redundant with the "3 / 7" badge the step rail already shows once
          // the bar has settled into the quiet, in-flow state — only worth
          // repeating here when the bar is actually the thing asking for
          // attention.
          floatingBar ? (
            <span className="flex items-center gap-1">
              <span>
                <span className="font-semibold text-ink-600">{ready}</span> of{" "}
                <span className="font-semibold text-ink-600">{anchors.length}</span> references
                ready
              </span>
              <InfoHint topic="generationTime" />
            </span>
          ) : undefined
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
            size={floatingBar ? "lg" : "md"}
            variant={floatingBar ? "primary" : "secondary"}
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

/** A slim end-cap in the reel, sized to match the thumbnails next to it. */
function ReelEndCap({
  icon: Icon,
  label,
  sub,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-ink-200 text-ink-400 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
    >
      <Icon className="size-5" />
      <span className="px-1 text-center text-[11px] font-medium leading-tight">{label}</span>
      {sub && <span className="text-[9px] leading-none text-ink-300">{sub}</span>}
    </button>
  );
}

/** Shown on the stage when the story genuinely has no cast to draw. */
function EmptyStage() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-white text-brand-500 shadow-soft">
        <Users className="size-5" />
      </span>
      <p className="text-sm font-semibold text-ink-700">No cast yet</p>
      <p className="max-w-64 text-xs leading-relaxed text-ink-400">
        Add a character or place above, or re-read the story to find them automatically.
      </p>
    </div>
  );
}
