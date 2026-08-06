/**
 * Story step as a Design-like workspace: top bar + left topic strip + center
 * stage. First-run walks Audience → Story; art style is confirmed in Design · Cast.
 */
import { useMemo, useState } from "react";
import { ArrowRight, Check, Lock, type LucideIcon } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";
import { storyConfigSchema } from "../wizard/schema";
import { STORY_QUESTIONS } from "../wizard/storyQuestions";
import type { GuidedQuestion } from "../wizard/GuidedQuestions";
import { useStudio } from "./StudioContext";
import { preferredDesignStep } from "./studioSteps";

type TopicId = string;

export function StoryWorkspace() {
  const { project, setStep } = useStudio();
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const advanceStage = useProjectsStore((s) => s.advanceStage);

  const firstRun = project.stage === "setup";
  const update = (patch: Partial<BookConfig>) => void updateConfig(patch);
  const ready = config ? storyConfigSchema.safeParse(config).success : false;

  const topics = useMemo(
    () => (config ? STORY_QUESTIONS.filter((q) => q.visible?.(config) ?? true) : []),
    [config],
  );

  const [topicId, setTopicId] = useState<TopicId>(topics[0]?.id ?? "age");
  // Furthest guided index reached — review mode unlocks everything.
  const [furthest, setFurthest] = useState(0);

  if (!config) return null;
  const cfg = config;

  const index = Math.max(
    0,
    topics.findIndex((t) => t.id === topicId),
  );
  const topic = topics[index] ?? topics[0];
  if (!topic) return null;

  const answered = topic.isAnswered(cfg);
  const isLast = index === topics.length - 1;

  function topicReachable(i: number): boolean {
    if (!firstRun) return true;
    const q = topics[i];
    if (!q) return false;
    return i <= furthest || q.isAnswered(cfg) || i === index + 1;
  }

  function selectTopic(id: TopicId) {
    const i = topics.findIndex((t) => t.id === id);
    if (i < 0 || !topicReachable(i)) return;
    setFurthest((f) => Math.max(f, i));
    setTopicId(id);
  }

  function finish() {
    const result = storyConfigSchema.safeParse(cfg);
    if (!result.success) {
      notify.error(result.error.issues[0]?.message ?? "Please complete the story setup.");
      return;
    }
    if (firstRun) {
      // Force the Design · Cast style gate before the first reference images.
      void updateConfig({ styleReady: false });
      void advanceStage("studio");
    }
    setStep(preferredDesignStep(project));
  }

  function onPrimary() {
    if (!answered) {
      notify.info("Almost there", "Finish this section before continuing.");
      return;
    }
    if (!isLast) {
      const next = index + 1;
      setFurthest((f) => Math.max(f, next));
      setTopicId(topics[next]!.id);
      return;
    }
    if (!ready) {
      notify.info("Almost there", "Complete every section before continuing to design.");
      return;
    }
    finish();
  }

  const primaryLabel = isLast || !firstRun ? "Continue to design" : "Continue";
  const primaryDisabled = firstRun
    ? !answered || (isLast && !ready)
    : !ready;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink-100 bg-white/70 px-3 py-2.5 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="sm"
            disabled={primaryDisabled}
            rightIcon={<ArrowRight className="size-4" />}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
          {firstRun && (
            <span className="hidden text-xs tabular-nums text-ink-400 sm:inline">
              {index + 1} of {topics.length}
            </span>
          )}
        </div>
        {!firstRun && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStep(preferredDesignStep(project))}
          >
            Back to design
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <StoryTopicStrip
          topics={topics}
          config={cfg}
          activeId={topic.id}
          firstRun={firstRun}
          furthest={furthest}
          onSelect={selectTopic}
          reachable={topicReachable}
        />

        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="absolute inset-0 flex flex-col bg-grid">
            <div className="shrink-0 border-b border-ink-100/80 bg-white/50 px-4 py-3 sm:px-6">
              <h2 className="text-base font-semibold text-ink-900">{topic.title}</h2>
              {topic.subtitle && (
                <p className="mt-0.5 text-sm text-ink-500">{topic.subtitle}</p>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto w-full max-w-3xl">
                {topic.render({ config: cfg, update })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoryTopicStrip({
  topics,
  config,
  activeId,
  firstRun,
  furthest,
  onSelect,
  reachable,
}: {
  topics: GuidedQuestion[];
  config: BookConfig;
  activeId: string;
  firstRun: boolean;
  furthest: number;
  onSelect: (id: string) => void;
  reachable: (i: number) => boolean;
}) {
  return (
    <aside className="flex h-full w-44 shrink-0 flex-col border-r border-ink-100 bg-white/80 sm:w-52">
      <div className="border-b border-ink-100 px-3 py-2">
        <p className="text-xs font-semibold text-ink-500">Story</p>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {topics.map((q, i) => {
          const Icon = q.icon as LucideIcon;
          const done = q.isAnswered(config);
          const active = q.id === activeId;
          const locked = firstRun && !reachable(i) && !done;
          // Guided: next step after furthest is reachable for Continue flow.
          const canOpen = !locked && (reachable(i) || done || i <= furthest);

          return (
            <button
              key={q.id}
              type="button"
              disabled={!canOpen}
              onClick={() => canOpen && onSelect(q.id)}
              title={locked ? "Finish the earlier sections first" : q.summary(config)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition",
                active
                  ? "bg-brand-50 ring-1 ring-brand-200"
                  : canOpen
                    ? "hover:bg-ink-50"
                    : "cursor-not-allowed opacity-45",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                  done && !active
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-600 text-(--color-brand-foreground)"
                      : "bg-ink-100 text-ink-500",
                )}
              >
                {locked ? (
                  <Lock className="size-3.5" />
                ) : done && !active ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    active ? "text-brand-700" : "text-ink-800",
                  )}
                >
                  {stripTitle(q)}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-400">
                  {done ? q.summary(config) : "Not set"}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

/** Short strip labels — full titles stay in the stage header. */
function stripTitle(q: GuidedQuestion): string {
  switch (q.id) {
    case "age":
      return "Audience";
    case "story":
      return "Story";
    default:
      return q.title;
  }
}
