import { useEffect, useRef } from "react";
import type { Project } from "../../core/types";
import { analyzeCurrentStory, generateScreenplayVersion } from "../../state/ai";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { DesignWorkspace } from "./DesignWorkspace";
import { StudioDndProvider } from "./StudioDnd";
import { StudioProvider, useStudio } from "./StudioContext";
import { useStudioPanelStore } from "./studioPanelStore";
import { StudioStepRail } from "./StudioStepRail";
import { StyleRenewBanner } from "./StyleRenewBanner";
import { StoryStage } from "./StoryStage";
import { OrderStage } from "./OrderStage";
import { initialStep, primaryOf } from "./studioSteps";
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
  const { step, closeDesignSetup, closeStyleSetup } = useStudio();
  const closeToolPanel = useStudioPanelStore((s) => s.closeToolPanel);
  const models = useResolvedModels();
  useStudioHotkeys();

  const startedAnalyze = useRef(false);
  const startedScreenplay = useRef(false);

  const inStudio = project.stage === "studio";
  const inDesign = primaryOf(step) === "design";

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
        <StudioStepRail />
        {/* Mounted once here (not inside Design) so a running style transfer
            keeps advancing cast → pages wherever the reader navigates. */}
        <StyleRenewBanner />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-grid">
          {inDesign ? (
            <DesignWorkspace />
          ) : step === "story" ? (
            <StoryStage />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {step === "order" && <OrderStage />}
            </div>
          )}
        </main>
      </div>
    </StudioDndProvider>
  );
}
