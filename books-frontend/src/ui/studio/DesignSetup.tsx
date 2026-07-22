import { LayoutTemplate } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { StageHeader } from "../components/StageHeader";
import { GuidedQuestions } from "../wizard/GuidedQuestions";
import { DESIGN_QUESTIONS } from "../wizard/designQuestions";
import { useStudio } from "./StudioContext";

/**
 * The book-setup gate for the Design step: a guided size → format → layout flow
 * the first time (before any art is generated), and a summary hub on return.
 * Confirming sets `designReady`, so subsequent visits open straight to the
 * canvas and this becomes reachable as a summary from the toolbar.
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
          eyebrow="Step 3 · Design"
          eyebrowIcon={LayoutTemplate}
          tone="brand"
          title={firstTime ? "Let's set up your book" : "Book setup"}
          subtitle={
            firstTime
              ? "A few quick choices about the printed book before we lay out your pages."
              : "Review your book's size, format and layout — edit anything you like."
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
