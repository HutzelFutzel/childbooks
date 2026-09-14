/** The focused design stage. Workflow navigation lives in StudioNavigator. */
import { useEffect } from "react";
import { useProjectsStore } from "../../state/projectsStore";
import { AnchorsStage } from "./AnchorsStage";
import { BookCanvas } from "./BookCanvas";
import { DesignSetup } from "./DesignSetup";
import { StyleSetup } from "./StyleSetup";
import { useStudio } from "./StudioContext";
import { designChapterOf } from "./studioSteps";

export function DesignWorkspace({
  analysisRun,
  onRetryAnalysis,
}: {
  analysisRun: { status: "idle" | "running" | "error"; message?: string };
  onRetryAnalysis: () => void;
}) {
  const { step, styleSetupOpen, designSetupOpen } = useStudio();

  const styleReady = useProjectsStore((s) => s.current()?.config.styleReady);
  const designReady = useProjectsStore((s) => s.current()?.config.designReady ?? false);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const chapter = designChapterOf(step, styleReady, styleSetupOpen);

  // Pages opens on the book, not on a form. Size and layout have working
  // defaults (`createDefaultConfig`), so there is nothing here the reader must
  // answer before their pages can be seen — the same two pickers live in the
  // Setup panel for whenever they want them.
  const showDesignSetup = chapter === "pages" && designSetupOpen;

  // Reaching Pages is what `designReady` records now, and it's what unlocks
  // Review & Order. Runs once: the write flips the flag this effect depends on.
  useEffect(() => {
    if (chapter !== "pages" || designReady) return;
    void updateConfig({ designReady: true });
  }, [chapter, designReady, updateConfig]);

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1">
      {chapter === "style" ? (
        <StyleSetup />
      ) : chapter === "cast" ? (
        <AnchorsStage analysisRun={analysisRun} onRetryAnalysis={onRetryAnalysis} />
      ) : showDesignSetup ? (
        <DesignSetup />
      ) : (
        <BookCanvas />
      )}
    </div>
  );
}
