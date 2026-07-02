import { useEffect, useRef } from "react";
import type { Project } from "../../core/types";
import { analyzeCurrentStory, generateScreenplayVersion } from "../../state/ai";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
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
  const { step } = useStudio();
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

  return (
    <StudioDndProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <StudioStepRail />

        <div className="flex min-h-0 flex-1">
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
        </div>
      </div>
    </StudioDndProvider>
  );
}
