import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  Ruler,
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
import { CastLineup } from "../anchors/CastLineup";
import { Button } from "../components/Button";
import { Celebrate } from "../components/Celebrate";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { generateAllAnchors } from "./studioGen";
import { cn } from "../lib/cn";

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
 * Design · Cast. A "casting reel" of every character & place the story
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
  const [lineupOpen, setLineupOpen] = useState(false);

  // Character transfer: gateable feature — free until an admin lists it on a
  // plan, then subscriber-only. Other projects with a cast must exist to show it.
  const transferAllowed = useFeatureAllowed("characterTransfer");
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const hasImportSources = useProjectsStore((s) =>
    s.projects.some((p) => p.id !== project.id && (p.anchors?.length ?? 0) > 0),
  );

  // The reel shows every anchor, including skipped ones (dimmed): hiding them
  // outright would make "skip" a one-way door with no way back to the toggle.
  // Everything about progress and generation counts only the included ones.
  const allAnchors = project.anchors ?? [];
  const anchors = allAnchors.filter((a) => a.include);
  const ready = anchors.filter((a) => currentAnchorImage(a)).length;
  // Two characters with art is the point at which "how big is everyone next to
  // each other" becomes a question that can be asked at all.
  const canCompareSizes =
    anchors.filter((a) => a.type === "character" && currentAnchorImage(a)).length >= 2;
  const allReady = anchors.length > 0 && ready === anchors.length;
  const analysisPending = !project.analysis;
  // Nothing left to generate — either every reference is ready, or the story
  // simply has no characters/places to draw.
  const canProceed = allReady || (Boolean(project.analysis) && anchors.length === 0);
  // Whether the "everyone's ready, go design pages" moment has already been
  // acknowledged. Starts settled if the cast was already complete when this
  // screen loaded (nothing "just happened" then) and flips back to
  // unsettled right when a fresh `generateAll()` finishes, so THAT moment
  // still gets the bold announcement. Once the user deliberately does
  // anything else here — picks a different character, edits one, asks for a
  // regenerate — it settles again: they're back to browsing/editing the
  // cast, and a CTA that keeps floating over whatever they're looking at
  // reads as nagging rather than helpful.
  const [settled, setSettled] = useState(canProceed);
  function settleFloat() {
    if (!settled) setSettled(true);
  }
  // The bottom bar only earns its bold, floating-over-the-page treatment at
  // the two moments that genuinely need it: before anything's been made (it's
  // the obvious first move) and the instant everything becomes ready (it's
  // the obvious next one, until acknowledged). In between — and after that
  // moment's been acknowledged — generating/editing references is just one
  // thing among several the user might do while browsing the cast, so the
  // bar settles into the normal flow instead of hovering over whichever
  // anchor they're actually looking at.
  const floatingBar = ready === 0 || (canProceed && !settled);

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
  // Looked up across ALL anchors, not just included ones — a skipped anchor is
  // still selectable in the reel, and its editor is the only place to un-skip.
  const activeAnchor = allAnchors.find((a) => a.id === activeAnchorId) ?? null;

  function commitSelect(anchorId: string) {
    swapSourceRef.current = "click";
    setPreviewId(null);
    select({ kind: "anchor", anchorId });
    // A deliberate pick from the reel — the clearest sign the user is back to
    // browsing/editing the cast rather than reacting to "you're done!".
    settleFloat();
  }

  // Keep the stage useful: focus the first character when arriving here with
  // nothing (relevant) selected.
  useEffect(() => {
    if (allAnchors.length === 0) return;
    if (!selectedAnchorId || !allAnchors.some((a) => a.id === selectedAnchorId)) {
      commitSelect((anchors[0] ?? allAnchors[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnchors.length, selectedAnchorId]);

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
        // This is the moment the floating bar exists for — announce it even
        // if an earlier auto-select (or a prior visit) had already settled it.
        setSettled(false);
        // The natural moment to check sizes: everyone now has art, and this is
        // the only screen where relative height can actually be judged. Only
        // worth showing when there are at least two people to compare.
        const cast = (useProjectsStore.getState().current()?.anchors ?? []).filter(
          (a) => a.type === "character" && a.include,
        );
        if (cast.length >= 2) setLineupOpen(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-5xl px-5 py-8">
      <Celebrate play={celebrate} />
      <StageHeader
        eyebrow="Design · Cast"
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
              {allAnchors.map((anchor) => (
                <AnchorReelThumb
                  key={anchor.id}
                  anchor={anchor}
                  committed={selectedAnchorId === anchor.id}
                  previewing={previewId === anchor.id}
                  skipped={!anchor.include}
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
            // Any real interaction with the editor itself (typing a tweak,
            // hitting Regenerate…) settles the floating CTA exactly like a
            // reel click does — the user doesn't have to leave the field
            // they're in just to make the overlay stop crowding it.
            onPointerDownCapture={settleFloat}
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
              ) : allAnchors.length === 0 ? (
                <EmptyStage />
              ) : null}
            </AnimatePresence>
          </motion.div>
        </>
      )}

      <ImportAnchorsDialog open={importing} onClose={() => setImporting(false)} project={project} />

      <div className="mt-4 flex justify-center gap-1">
        {canCompareSizes && (
          <button
            onClick={() => setLineupOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-ink-100 hover:text-brand-600",
              lineupOpen ? "text-brand-600" : "text-ink-500",
            )}
          >
            <Ruler className="size-3.5" />
            {lineupOpen ? "Hide size check" : "Check everyone's size"}
          </button>
        )}
        <button
          onClick={() => void reanalyze()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
        >
          {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          Re-read the story
        </button>
      </div>

      {/* Inline, not a modal: sizing is something worth rechecking after every
          regeneration, and a popup that has to be reopened each time would
          fight that more than help it. */}
      <CastLineup
        open={lineupOpen && canCompareSizes}
        onClose={() => setLineupOpen(false)}
        anchors={project.anchors ?? []}
      />

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
            Continue to pages
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
