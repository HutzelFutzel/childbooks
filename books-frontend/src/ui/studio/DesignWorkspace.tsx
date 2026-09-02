/** The focused design stage. Workflow navigation lives in StudioNavigator. */
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
  const chapter = designChapterOf(step, styleReady, styleSetupOpen);

  const showDesignSetup = chapter === "pages" && (!designReady || designSetupOpen);

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
