import { ArrowRight, Sparkles } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { notify } from "../lib/notify";
import { bookConfigSchema } from "../wizard/schema";
import { AudienceStep } from "../wizard/steps/AudienceStep";
import { StoryStep } from "../wizard/steps/StoryStep";
import { StyleStep } from "../wizard/steps/StyleStep";
import { useStudio } from "./StudioContext";

/**
 * Step 1 · Story. A single calm page (no wizard, no drawer) that gathers the
 * story, art style and audience. Advanced layout knobs are gone — the book is
 * always "one illustration, text beside it", chosen for us — so most people can
 * write, pick a style, and go.
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
      <header className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          <Sparkles className="size-3.5" /> Step 1 · Story
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-ink-900">
          {firstRun ? "Let's begin your storybook" : "Your story"}
        </h1>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
          Paste or write your tale, choose a look, and tell us who it's for. We'll turn it into an
          illustrated book — one picture per page with the words beside it.
        </p>
      </header>

      <div className="space-y-6">
        <StageCard>
          <StoryStep config={config} update={update} />
        </StageCard>
        <StageCard>
          <StyleStep config={config} update={update} />
        </StageCard>
        <StageCard>
          <AudienceStep config={config} update={update} />
        </StageCard>
      </div>

      <div className="sticky bottom-4 z-10 mt-8">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white/90 p-3 shadow-lifted backdrop-blur">
          <p className="pl-2 text-xs text-ink-400">
            {firstRun
              ? "Next, we'll find the characters & places in your story."
              : "Changes apply the next time you regenerate art."}
          </p>
          <Button
            size="lg"
            disabled={!ready}
            rightIcon={<ArrowRight className="size-5" />}
            onClick={handleContinue}
          >
            {firstRun ? "Create characters" : "Back to characters"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StageCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">{children}</section>
  );
}
