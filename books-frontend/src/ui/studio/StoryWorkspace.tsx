/**
 * Focused Story workspace. First-run walks Reader → Story in one compact
 * wayfinder; art style is the next blocking decision.
 */
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Redo2,
  RefreshCw,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { BookConfig } from "../../core/types";
import type { BookLanguageId } from "../../core/config/bookLanguages";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";
import { storyConfigSchema } from "../wizard/schema";
import { STORY_QUESTIONS } from "../wizard/storyQuestions";
import type { GuidedQuestion } from "../wizard/GuidedQuestions";
import type { StoryHistoryOptions, StorySnapshotPatch } from "./story/storyUndo";
import { useStudio } from "./StudioContext";

type TopicId = string;

export function StoryWorkspace() {
  const {
    project,
    setStep,
    updateStory,
    storyUndo,
    storyRedo,
    canStoryUndo,
    canStoryRedo,
  } = useStudio();
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const advanceStage = useProjectsStore((s) => s.advanceStage);

  const firstRun = project.stage === "setup";
  const update = (
    patch: Partial<BookConfig>,
    options?: StoryHistoryOptions,
  ) => {
    const storyPatch: StorySnapshotPatch = {};
    if ("storyText" in patch) storyPatch.storyText = patch.storyText;
    if ("storyBrief" in patch) storyPatch.storyBrief = patch.storyBrief;
    if ("contentLocale" in patch) storyPatch.contentLocale = patch.contentLocale;
    if ("ageRangeId" in patch && patch.ageRangeId != null) {
      storyPatch.ageRangeId = patch.ageRangeId;
    }
    if ("readingModeId" in patch) storyPatch.readingModeId = patch.readingModeId;
    void updateStory(storyPatch, options);
  };
  const ready = config ? storyConfigSchema.safeParse(config).success : false;

  const topics = useMemo(
    () => (config ? STORY_QUESTIONS.filter((q) => q.visible?.(config) ?? true) : []),
    [config],
  );

  const [topicId, setTopicId] = useState<TopicId>(
    firstRun ? (topics[0]?.id ?? "reader") : "story",
  );
  const [storyToolsOpen, setStoryToolsOpen] = useState(false);
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

  const hasStory = Boolean(cfg.storyText?.trim());
  const currentLocale: BookLanguageId = (cfg.contentLocale as BookLanguageId) ?? "en-US";
  const knownOriginLocale = cfg.storyBrief?.generatedForLocale as BookLanguageId | undefined;
  const originLocale = knownOriginLocale ?? currentLocale;
  const languageChanged =
    hasStory && Boolean(knownOriginLocale) && originLocale !== currentLocale;
  const originAge = cfg.storyBrief?.generatedForAge;
  const ageChanged = hasStory && Boolean(originAge) && originAge !== cfg.ageRangeId;
  const needsAdaptation = languageChanged || ageChanged;

  function topicReachable(i: number): boolean {
    if (!firstRun) return true;
    const q = topics[i];
    if (!q) return false;
    return i <= furthest || q.isAnswered(cfg) || i === index + 1;
  }

  function selectTopic(id: TopicId) {
    const i = topics.findIndex((t) => t.id === id);
    if (i < 0 || !topicReachable(i)) return;
    if (id !== "story") setStoryToolsOpen(false);
    setFurthest((f) => Math.max(f, i));
    setTopicId(id);
  }

  async function finish() {
    const result = storyConfigSchema.safeParse(cfg);
    if (!result.success) {
      notify.error(result.error.issues[0]?.message ?? "Please complete the story setup.");
      return;
    }
    if (firstRun) {
      // Style is the only remaining blocking decision. Analysis and screenplay
      // drafting continue in the background while the reader chooses it.
      await updateConfig({ styleReady: false, castReady: false });
      await advanceStage("studio");
      setStep("anchors");
      return;
    }
    setStep("edit");
  }

  function onPrimary() {
    if (!answered) {
      notify.info("Almost there", "Finish this section before continuing.");
      return;
    }
    if (!firstRun && !needsAdaptation) {
      void finish();
      return;
    }
    if (needsAdaptation && topic.id !== "story") {
      const storyIdx = topics.findIndex((t) => t.id === "story");
      if (storyIdx >= 0) {
        setFurthest((f) => Math.max(f, storyIdx));
        setTopicId("story");
        return;
      }
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
    void finish();
  }

  const primaryLabel =
    needsAdaptation && topic.id !== "story"
      ? "Continue to story"
      : !firstRun
        ? "Back to pages"
        : isLast
          ? "Continue to art style"
          : topics[index + 1]
            ? `Continue to ${stripTitle(topics[index + 1]!).toLowerCase()}`
            : "Continue";
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-100 bg-white px-2 py-2 sm:px-4">
        {firstRun ? (
          <StoryTopicNav
            topics={topics}
            config={cfg}
            activeId={topic.id}
            firstRun={firstRun}
            furthest={furthest}
            onSelect={selectTopic}
            reachable={topicReachable}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={topic.id === "story" ? <Users className="size-4" /> : undefined}
              onClick={() => selectTopic(topic.id === "story" ? "reader" : "story")}
            >
              {topic.id === "story" ? "Audience settings" : "Back to story"}
            </Button>
            {topic.id === "story" && hasStory && (
              <Button
                size="sm"
                variant={storyToolsOpen ? "secondary" : "ghost"}
                leftIcon={<RefreshCw className="size-4" />}
                aria-expanded={storyToolsOpen}
                onClick={() => setStoryToolsOpen((open) => !open)}
              >
                New version
              </Button>
            )}
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {firstRun && topic.id === "story" && hasStory && (
            <Button
              size="sm"
              variant={storyToolsOpen ? "secondary" : "ghost"}
              leftIcon={<RefreshCw className="size-4" />}
              aria-expanded={storyToolsOpen}
              onClick={() => setStoryToolsOpen((open) => !open)}
            >
              New version
            </Button>
          )}
          {(canStoryUndo || canStoryRedo) && (
            <div className="flex items-center rounded-xl bg-ink-50 p-0.5 ring-1 ring-ink-100">
              <button
                type="button"
                onClick={storyUndo}
                disabled={!canStoryUndo}
                title="Undo story change (⌘Z)"
                aria-label="Undo story change"
                className="inline-flex size-7 items-center justify-center rounded-lg text-ink-600 transition hover:bg-white disabled:cursor-not-allowed disabled:text-ink-300"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={storyRedo}
                disabled={!canStoryRedo}
                title="Redo story change (⌘⇧Z)"
                aria-label="Redo story change"
                className="inline-flex size-7 items-center justify-center rounded-lg text-ink-600 transition hover:bg-white disabled:cursor-not-allowed disabled:text-ink-300"
              >
                <Redo2 className="size-3.5" />
              </button>
            </div>
          )}
          {firstRun && (topic.id !== "story" || answered) && (
            <Button
              size="sm"
              rightIcon={<ArrowRight className="size-4" />}
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 min-w-0 flex-1">
        <div className="absolute inset-0 flex flex-col bg-ink-50/30">
          {topic.id !== "story" && (
            <div className="shrink-0 border-b border-ink-100 bg-white px-4 py-3 sm:px-6">
              <h2 className="text-base font-semibold text-ink-900">{topic.title}</h2>
              {topic.subtitle && (
                <p className="mt-0.5 text-sm text-ink-500">{topic.subtitle}</p>
              )}
            </div>
          )}
          {topic.id === "story" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 lg:p-5">
              {topic.render({
                config: cfg,
                update,
                storyToolsOpen,
                onStoryToolsOpenChange: setStoryToolsOpen,
              })}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto w-full max-w-5xl">
                {topic.render({ config: cfg, update })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StoryTopicNav({
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
    <nav
      aria-label="Story setup"
      className="order-2 flex min-w-0 basis-full items-center gap-1 overflow-x-auto sm:order-0 sm:flex-1 sm:basis-auto"
    >
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
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
              active
                ? "bg-brand-50 text-brand-800"
                : canOpen
                  ? "text-ink-500 hover:bg-ink-50 hover:text-ink-800"
                  : "cursor-not-allowed opacity-45",
            )}
          >
            {done && !active ? (
              <Check className="size-3.5 shrink-0 text-emerald-600" />
            ) : (
              <Icon className="size-3.5 shrink-0" />
            )}
            <span>{stripTitle(q)}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Short strip labels — full titles stay in the stage header. */
function stripTitle(q: GuidedQuestion): string {
  switch (q.id) {
    case "reader":
      return "Reader";
    case "story":
      return "Story";
    default:
      return q.title;
  }
}
