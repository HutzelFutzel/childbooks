/** Design primary: left chapter navigation (Style / Cast / Pages) + stage. */
import { useCallback, useState } from "react";
import { useProjectsStore } from "../../state/projectsStore";
import { AnchorsStage } from "./AnchorsStage";
import { BookCanvas } from "./BookCanvas";
import { DesignChapterHostsProvider } from "./DesignChapterHosts";
import { DesignChapterRail } from "./DesignChapterRail";
import { DesignSetup } from "./DesignSetup";
import { StyleSetup } from "./StyleSetup";
import { useStudio } from "./StudioContext";
import {
  computeProgress,
  designChapterOf,
  stepForDesignChapter,
  type DesignChapter,
} from "./studioSteps";

export function DesignWorkspace({
  analysisRun,
  onRetryAnalysis,
}: {
  analysisRun: { status: "idle" | "running" | "error"; message?: string };
  onRetryAnalysis: () => void;
}) {
  const {
    project,
    step,
    setStep,
    styleSetupOpen,
    openStyleSetup,
    closeStyleSetup,
    designSetupOpen,
    generatingAnchors,
    generatingPages,
  } = useStudio();

  const styleReady = useProjectsStore((s) => s.current()?.config.styleReady);
  const designReady = useProjectsStore((s) => s.current()?.config.designReady ?? false);

  const progress = computeProgress(project);
  const chapter = designChapterOf(step, styleReady, styleSetupOpen);

  const castUnlocked = styleReady !== false;
  const pagesUnlocked = progress.edit.unlocked;
  const styleDone = styleReady === true || styleReady === undefined;

  const [pagesHost, setPagesHost] = useState<HTMLElement | null>(null);

  const pagesHostRef = useCallback((el: HTMLDivElement | null) => {
    setPagesHost(el);
  }, []);

  function selectChapter(ch: DesignChapter) {
    if (ch === "style") {
      // Open style overlay before leaving Pages so step-change cleanup
      // (which no longer clears style) keeps the Style chapter active.
      openStyleSetup();
      if (step !== "anchors") setStep("anchors");
      return;
    }
    closeStyleSetup();
    if (ch === "cast") {
      setStep("anchors");
      return;
    }
    if (pagesUnlocked) setStep(stepForDesignChapter("pages"));
  }

  const showDesignSetup = chapter === "pages" && (!designReady || designSetupOpen);

  return (
    <DesignChapterHostsProvider value={{ pagesHost }}>
      <div className="flex h-full min-h-0">
        <DesignChapterRail
          chapter={chapter}
          onSelect={selectChapter}
          styleDone={styleDone}
          castUnlocked={castUnlocked}
          pagesUnlocked={pagesUnlocked}
          castDone={progress.anchors.done}
          pagesDone={progress.edit.done}
          castDetail={progress.anchors.detail}
          pagesDetail={progress.edit.detail}
          busyCast={generatingAnchors.size > 0}
          busyPages={generatingPages.size > 0}
          pagesHostRef={pagesHostRef}
        />

        <div className="relative min-h-0 min-w-0 flex-1">
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
      </div>
    </DesignChapterHostsProvider>
  );
}
