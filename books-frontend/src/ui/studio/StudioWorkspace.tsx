import { useEffect, useRef, useState } from "react";
import { PanelLeft, SlidersHorizontal } from "lucide-react";
import type { Project } from "../../core/types";
import { analyzeCurrentStory, generateScreenplayVersion } from "../../state/ai";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { notify } from "../lib/notify";
import { Drawer } from "../components/Drawer";
import { BookCanvas } from "./BookCanvas";
import { StudioDndProvider } from "./StudioDnd";
import { StudioInspector } from "./StudioInspector";
import { StudioProvider, useStudio } from "./StudioContext";
import { StudioSidebar } from "./StudioSidebar";
import { StudioStepRail } from "./StudioStepRail";
import { StoryStage } from "./StoryStage";
import { AnchorsStage } from "./AnchorsStage";
import { OrderStage } from "./OrderStage";
import { initialStep } from "./studioSteps";
import { useStudioHotkeys } from "./useStudioHotkeys";

/** The single unified workspace. Keyed by project id in the parent so all local
 * state (selection, auto-run guards) resets cleanly when switching books. */
export function StudioWorkspace({ project }: { project: Project }) {
  return (
    <StudioProvider project={project} initialStep={initialStep(project)}>
      <StudioInner project={project} />
    </StudioProvider>
  );
}

function StudioInner({ project }: { project: Project }) {
  const { step, selection } = useStudio();
  const models = useResolvedModels();
  useStudioHotkeys();

  const startedAnalyze = useRef(false);
  const startedScreenplay = useRef(false);

  const inStudio = project.stage === "studio";

  // Auto-analyze the story once the studio opens (no manual trigger).
  useEffect(() => {
    if (!inStudio || !models) return;
    if (!project.analysis && !startedAnalyze.current && project.config.storyText.trim()) {
      startedAnalyze.current = true;
      void analyzeCurrentStory().catch((err) => {
        startedAnalyze.current = false;
        notify.error(err);
      });
    }
  }, [inStudio, models, project.analysis, project.config.storyText]);

  // Auto-draft the screenplay once the analysis is done. We intentionally do NOT
  // require any anchors: a story can legitimately have none (or the analyzer may
  // find none), and gating on anchors there left the canvas stuck forever.
  useEffect(() => {
    if (!inStudio || !models) return;
    if (project.analysis && !project.screenplay && !startedScreenplay.current) {
      startedScreenplay.current = true;
      void generateScreenplayVersion().catch((err) => {
        startedScreenplay.current = false;
        notify.error(err);
      });
    }
  }, [inStudio, models, project.analysis, project.screenplay]);

  const showLeft = step === "edit";
  const showRight = step === "edit" || step === "anchors";

  // Mobile: the inline side panels are hidden below md/lg, so surface them as
  // edge drawers reachable from floating buttons instead.
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const compactRight = useMediaQuery("(max-width: 1023px)");

  // Reset the drawers whenever the step changes so they never linger open into
  // a step that doesn't have that panel.
  useEffect(() => {
    setLeftOpen(false);
    setRightOpen(false);
  }, [step]);

  // On compact screens, auto-open the inspector as soon as the user selects
  // something worth styling (a text box on the canvas, or a character), so the
  // relevant controls are one tap away instead of hidden behind a button.
  const stylableKey =
    step === "edit" && (selection.kind === "box" || selection.kind === "shape" || selection.kind === "image")
      ? `${selection.kind}:${selection.pageId}`
      : step === "anchors" && selection.kind === "anchor"
        ? `anchor:${selection.anchorId}`
        : null;
  useEffect(() => {
    if (compactRight && stylableKey) setRightOpen(true);
  }, [compactRight, stylableKey]);

  return (
    <StudioDndProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <StudioStepRail />

        <div className="relative flex min-h-0 flex-1">
          {showLeft && (
            <aside className="hidden w-72 min-h-0 shrink-0 flex-col border-r border-ink-100 bg-white/60 md:flex">
              <StudioSidebar />
            </aside>
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-grid">
            {step === "edit" ? (
              <BookCanvas />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {step === "story" && <StoryStage />}
                {step === "anchors" && <AnchorsStage />}
                {step === "order" && <OrderStage />}
              </div>
            )}
          </main>

          {showRight && (
            <aside className="hidden w-80 min-h-0 shrink-0 flex-col border-l border-ink-100 bg-white lg:flex">
              <StudioInspector />
            </aside>
          )}

          {/* Floating panel triggers (mobile only — each hides at the breakpoint
              where its inline panel appears). */}
          {showLeft && (
            <button
              onClick={() => setLeftOpen(true)}
              className="fixed bottom-5 left-4 z-30 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 shadow-lifted ring-1 ring-ink-200 transition hover:text-brand-700 active:scale-95 md:hidden"
            >
              <PanelLeft className="size-4" /> Story
            </button>
          )}
          {showRight && (
            <button
              onClick={() => setRightOpen(true)}
              className="fixed bottom-5 right-4 z-30 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 shadow-lifted ring-1 ring-ink-200 transition hover:text-brand-700 active:scale-95 lg:hidden"
            >
              <SlidersHorizontal className="size-4" /> {step === "edit" ? "Style" : "Details"}
            </button>
          )}
        </div>

        {showLeft && (
          <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} side="left" title="Story & characters">
            <StudioSidebar />
          </Drawer>
        )}
        {showRight && (
          <Drawer
            open={rightOpen}
            onClose={() => setRightOpen(false)}
            side="right"
            title={step === "edit" ? "Style" : "Details"}
          >
            <StudioInspector />
          </Drawer>
        )}
      </div>
    </StudioDndProvider>
  );
}
