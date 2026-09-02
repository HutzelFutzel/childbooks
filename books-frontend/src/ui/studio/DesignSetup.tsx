import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { StageHeader } from "../components/StageHeader";
import { GuidedQuestions } from "../wizard/GuidedQuestions";
import { DESIGN_QUESTIONS } from "../wizard/designQuestions";
import { useStudio } from "./StudioContext";

/**
 * The book-setup gate for the Design step: the physical choices the page layout
 * has to be built on, asked before any art exists, and a summary hub on return.
 * Confirming sets `designReady`, so subsequent visits open straight to the
 * canvas and this becomes reachable as a summary from the toolbar.
 *
 * Today that's the page size alone. Everything else about the printed object —
 * binding, print tier, paper, cover finish — leaves the pages untouched and is
 * asked at checkout instead, so nothing here is a decision made too early.
 */
export function DesignSetup() {
  const { closeDesignSetup } = useStudio();
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);

  if (!config) return null;
  const update = (patch: Partial<BookConfig>) => void updateConfig(patch);
  const firstTime = !config.designReady;

  const finish = () => {
    if (!config.designReady) void updateConfig({ designReady: true });
    closeDesignSetup();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-8">
        <StageHeader
          title={firstTime ? "Set the page size" : "Book setup"}
          subtitle={
            firstTime
              ? "Choose the page shape once, then your book opens."
              : "Review your book's page size."
          }
          className="mb-8"
        />

        <GuidedQuestions
          questions={DESIGN_QUESTIONS}
          config={config}
          update={update}
          mode={firstTime ? "guided" : "review"}
          finishLabel="Start designing"
          onFinish={finish}
          exitReviewLabel="Back to design"
          onExitReview={closeDesignSetup}
        />
      </div>
    </div>
  );
}
