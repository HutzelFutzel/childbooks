import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../core/types";
import { analyzeCurrentStory } from "../../state/ai";
import { useJobsStore } from "../../state/jobsStore";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { DesignWorkspace } from "./DesignWorkspace";
import { StudioDndProvider } from "./StudioDnd";
import { StudioProvider, useStudio } from "./StudioContext";
import { useStudioPanelStore } from "./studioPanelStore";
import { StudioNavigator } from "./StudioNavigator";
import { StyleRenewBanner } from "./StyleRenewBanner";
import { StoryStage } from "./StoryStage";
import { OrderStage } from "./OrderStage";
import { primaryOf } from "./studioSteps";
import type { StudioDestination } from "./studioRoutes";
import { useStudioHotkeys } from "./useStudioHotkeys";

/** The single unified workspace. Keyed by project id in the parent so all local
 * state (selection, auto-run guards) resets cleanly when switching books. */
export function StudioWorkspace({
  project,
  destination,
  onNavigate,
}: {
  project: Project;
  destination: StudioDestination;
  onNavigate: (destination: StudioDestination) => void;
}) {
  return (
    <StudioProvider
      project={project}
      destination={destination}
      onNavigate={onNavigate}
    >
      <StudioInner project={project} />
    </StudioProvider>
  );
}

function StudioInner({ project }: { project: Project }) {
  const { step, closeDesignSetup, closeStyleSetup } = useStudio();
  const closeToolPanel = useStudioPanelStore((s) => s.closeToolPanel);
  const models = useResolvedModels();
  useStudioHotkeys();

  const jobsLoaded = useJobsStore((s) => s.jobsLoaded);
  const screenplayJob = useJobsStore((s) => s.screenplayJob);
  const startScreenplay = useJobsStore((s) => s.startScreenplay);
  const [analysisRun, setAnalysisRun] = useState<{
    status: "idle" | "running" | "error";
    message?: string;
  }>({ status: project.analysis ? "idle" : "running" });

  const inStudio = project.stage === "studio";
  const inDesign = primaryOf(step) === "design";

  const runAnalysis = useCallback(async () => {
    if (!project.config.storyText.trim()) {
      setAnalysisRun({ status: "error", message: "Add your story before preparing the book." });
      return;
    }
    if (!models) {
      setAnalysisRun({
        status: "error",
        message: "AI generation is still being set up. Try again in a moment.",
      });
      return;
    }
    setAnalysisRun({ status: "running" });
    try {
      await analyzeCurrentStory();
      setAnalysisRun({ status: "idle" });
    } catch (err) {
      const message = (err as Error)?.message ?? "We couldn't read the story.";
      setAnalysisRun({ status: "error", message });
      notify.error(err);
    }
  }, [models, project.config.storyText]);

  // Auto-analyze once, while keeping a real recoverable status for Cast.
  useEffect(() => {
    if (!inStudio || project.analysis || analysisRun.status !== "running") return;
    void runAnalysis();
  }, [inStudio, project.analysis, analysisRun.status, runAnalysis]);

  // Auto-enqueue the screenplay once analysis is ready. The project-jobs
  // snapshot must arrive first so reopening or a second tab cannot duplicate a
  // durable attempt that is already pending or complete.
  //
  // A FAILED attempt is deliberately let through: nothing else re-drives one
  // (its id is taken, the trigger is create-only, the reaper skips terminal
  // jobs), so a book could sit with no pages forever. `startScreenplay` decides
  // whether the recovery budget allows it, which also stops this from looping.
  useEffect(() => {
    if (
      !inStudio ||
      !jobsLoaded ||
      !project.analysis ||
      project.screenplay ||
      (screenplayJob && screenplayJob.status !== "error")
    ) {
      return;
    }
    void startScreenplay(project).catch((err) => notify.error(err));
  }, [
    inStudio,
    jobsLoaded,
    project,
    project.analysis,
    project.screenplay,
    screenplayJob,
    startScreenplay,
  ]);

  // Reset design-setup / docked tools when the step changes. Style stays open
  // across anchors↔edit so Design chapters can reopen Style from Pages.
  useEffect(() => {
    closeDesignSetup();
    closeToolPanel();
  }, [step, closeDesignSetup, closeToolPanel]);

  useEffect(() => {
    if (!inDesign) closeStyleSetup();
  }, [inDesign, closeStyleSetup]);

  return (
    <StudioDndProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        {inStudio && <StudioNavigator />}
        {/* Mounted once here (not inside Design) so a running style transfer
            keeps advancing cast → pages wherever the reader navigates. */}
        <StyleRenewBanner />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink-50/30">
          {inDesign ? (
            <DesignWorkspace analysisRun={analysisRun} onRetryAnalysis={() => void runAnalysis()} />
          ) : step === "story" ? (
            <StoryStage />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {step === "order" && <OrderStage />}
            </div>
          )}
        </div>
      </div>
    </StudioDndProvider>
  );
}
