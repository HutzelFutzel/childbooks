import { useEffect, useRef } from "react";
import type { Project } from "../../core/types";
import { analyzeCurrentStory, generateScreenplayVersion } from "../../state/ai";
import { useProjectsStore } from "../../state/projectsStore";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";
import { BookCanvas } from "./BookCanvas";
import { SetupSlideOver } from "./SetupSlideOver";
import { StudioDndProvider } from "./StudioDnd";
import { StudioInspector } from "./StudioInspector";
import { StudioProvider, useStudio } from "./StudioContext";
import { StudioSidebar } from "./StudioSidebar";
import { useStudioHotkeys } from "./useStudioHotkeys";

/** The single unified workspace. Keyed by project id in the parent so all local
 * state (selection, auto-run guards) resets cleanly when switching books. */
export function StudioWorkspace({ project }: { project: Project }) {
  return (
    <StudioProvider project={project} initialSetupOpen={project.stage === "setup"}>
      <StudioInner project={project} />
    </StudioProvider>
  );
}

function StudioInner({ project }: { project: Project }) {
  const { setupOpen, closeSetup } = useStudio();
  const advanceStage = useProjectsStore((s) => s.advanceStage);
  const closeProject = useProjectsStore((s) => s.closeProject);
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
  // find none), and gating on anchors there left the canvas stuck on the
  // "Drafting your book…" spinner forever. `setAnalysis` writes the summary and
  // anchors together, so by the time `analysis` exists the anchor list is final.
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

  return (
    <StudioDndProvider>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 min-h-0 shrink-0 flex-col border-r border-ink-100 bg-white/60 md:flex">
          <StudioSidebar />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-grid">
          <BookCanvas />
        </main>

        <aside className="hidden w-80 min-h-0 shrink-0 flex-col border-l border-ink-100 bg-white lg:flex">
          <StudioInspector />
        </aside>

        <SetupSlideOver
          open={setupOpen}
          firstRun={project.stage === "setup"}
          onClose={() => (project.stage === "setup" ? closeProject() : closeSetup())}
          onSubmit={() => {
            if (project.stage === "setup") void advanceStage("studio");
            closeSetup();
          }}
        />
      </div>
    </StudioDndProvider>
  );
}
