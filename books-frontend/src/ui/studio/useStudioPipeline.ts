/** @legacy guide-v2 L0 — unreachable today; nothing renders it. See docs/LEGACY-GUIDE.md. */
import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../core/types";
import { analyzeCurrentStory } from "../../state/ai";
import { useJobsStore } from "../../state/jobsStore";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { notify } from "../lib/notify";

export type StudioPipelineStatus = "idle" | "running" | "error";

/**
 * Story analysis and page-plan enqueue. Both studio presentations run this so a
 * book started in Chat still gets a screenplay, and a book started in Steps
 * still does when it comes back.
 */
export function useStudioPipeline(project: Project) {
  const models = useResolvedModels();
  const jobsLoaded = useJobsStore((s) => s.jobsLoaded);
  const screenplayJob = useJobsStore((s) => s.screenplayJob);
  const startScreenplay = useJobsStore((s) => s.startScreenplay);
  const [analysisRun, setAnalysisRun] = useState<{
    status: StudioPipelineStatus;
    message?: string;
  }>({ status: project.analysis ? "idle" : "running" });

  const inStudio = project.stage === "studio";

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

  useEffect(() => {
    if (!inStudio || project.analysis || analysisRun.status !== "running") return;
    void runAnalysis();
  }, [inStudio, project.analysis, analysisRun.status, runAnalysis]);

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

  return { analysisRun, runAnalysis };
}
