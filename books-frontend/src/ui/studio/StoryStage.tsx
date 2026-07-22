import { ArrowLeft, BookText } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { StageHeader } from "../components/StageHeader";
import { notify } from "../lib/notify";
import { bookConfigSchema } from "../wizard/schema";
import { GuidedQuestions } from "../wizard/GuidedQuestions";
import { STORY_QUESTIONS } from "../wizard/storyQuestions";
import { useStudio } from "./StudioContext";

/**
 * Step 1 · Story. A guided, one-question-at-a-time flow (age → story → style)
 * on first run, and a scannable summary hub on return so jumping back from a
 * later step never replays every question. Physical size/format moved to the
 * Design step.
 */
export function StoryStage() {
  const { project, setStep } = useStudio();
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const advanceStage = useProjectsStore((s) => s.advanceStage);

  const firstRun = project.stage === "setup";
  const update = (patch: Partial<BookConfig>) => void updateConfig(patch);
  const ready = config ? bookConfigSchema.safeParse(config).success : false;

  function handleContinue() {
    if (!config) return;
    const result = bookConfigSchema.safeParse(config);
    if (!result.success) {
      notify.error(result.error.issues[0]?.message ?? "Please complete the story setup.");
      return;
    }
    if (firstRun) void advanceStage("studio");
    setStep("anchors");
  }

  if (!config) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <StageHeader
        eyebrow="Step 1 · Story"
        eyebrowIcon={BookText}
        tone="brand"
        title={firstRun ? "Let's begin your storybook" : "Your story"}
        subtitle={
          firstRun
            ? "Answer a few quick questions and we'll turn your tale into an illustrated book — one picture per page with the words beside it."
            : "Review your setup and edit anything you like — changes apply the next time you regenerate."
        }
        className="mb-8"
      />

      <GuidedQuestions
        questions={STORY_QUESTIONS}
        config={config}
        update={update}
        mode={firstRun ? "guided" : "review"}
        finishLabel="Create characters"
        onFinish={handleContinue}
        canFinish={ready}
      />

      {!firstRun && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="size-4" />}
            onClick={() => setStep("anchors")}
          >
            Back to characters
          </Button>
        </div>
      )}
    </div>
  );
}
