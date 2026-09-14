import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { StageHeader } from "../components/StageHeader";
import { GuidedQuestions } from "../wizard/GuidedQuestions";
import { DESIGN_QUESTIONS } from "../wizard/designQuestions";
import { useStudio } from "./StudioContext";

/**
 * @legacy guide-v2 — the full-page book-setup gate that used to stand between
 * the reader and their pages. Superseded: size and layout ship with working
 * defaults, Pages opens on the book, and the same two pickers are in the docked
 * Setup panel (`DockSetupPanel`) for whenever the reader wants them.
 *
 * Nothing routes here anymore. Kept until the legacy studio is removed so the
 * change is one reversible commit; listed in docs/LEGACY-GUIDE.md.
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
          title={firstTime ? "Set up your book" : "Book setup"}
          subtitle={
            firstTime
              ? "Choose the page shape and how the words sit with the pictures."
              : "Review your book's page size and layout."
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
