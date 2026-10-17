"use client";

/**
 * Suggestion chips under the composer: a few things the chat can do for this
 * book right now, led by what the open tab is about. A tap on an idea whose
 * result is reviewed or advisory (shorter story, age check) runs it; any other
 * tap fills the field so the reader can finish or change the sentence.
 */
import { useMemo } from "react";
import { Lightbulb, Sparkles, X } from "lucide-react";
import { questionIdeasFor, suggestionsFor, type GuideIdea } from "../../../core/guide/agent/ideas";
import type { GuideQuestionId } from "../../../core/guide/questions";
import type { BookViewId } from "../../../core/guide/journey";
import type { GuideMessage } from "../../../core/guide/session";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import { useIdeaUse } from "../../../state/ideaUse";
import { useGuideT } from "../intl";

export function IdeaChips({
  project,
  view,
  messages,
  marked = false,
  question = null,
  questionName,
  onPick,
  onRun,
}: {
  project: Project;
  view: BookViewId | null;
  /** The thread: a story already checked in its current form is not offered again. */
  messages: readonly GuideMessage[];
  /** A passage of the story is marked: suggest what can be done to it. */
  marked?: boolean;
  /** The question the guide has open: its example answers take the chips' place. */
  question?: GuideQuestionId | null;
  /** The person a question is about, when it asks about one person. */
  questionName?: string;
  /** Put the idea's words in the composer. */
  onPick: (text: string) => void;
  /** Run an instant idea, with its words as the reader's line. */
  onRun: (idea: GuideIdea, text: string) => void;
}) {
  const t = useGuideT("ideas");
  const tAgent = useGuideT("agent");
  const config = useAppConfigStore((s) => s.guide.agent);
  const guest = useAuthStore((s) => s.accessLevel === "guest");
  const used = useIdeaUse((s) => s.used);
  const dismissed = useIdeaUse((s) => s.dismissed);
  const tExamples = useGuideT("examples");
  const answers = useMemo(() => questionIdeasFor(question, config, used), [question, config, used]);
  const ideas = useMemo(
    () => (answers?.examples.length ? [] : suggestionsFor(project, config, { guest, view, marked, messages, dismissed, used })),
    [answers, project, config, guest, view, marked, messages, dismissed, used],
  );
  // While the guide waits for an answer, what helps is what an answer looks like.
  if (answers && answers.examples.length > 0) {
    const vars = { name: questionName || "Maya" };
    return (
      <div className="flex flex-wrap items-center gap-1.5" aria-label={tAgent("examplesLabel")}>
        <Lightbulb className="size-3.5 text-ink-400" aria-hidden />
        {answers.examples.slice(0, config.ideas.max).map((example) => {
          const text = tExamples(example.key, vars);
          return (
            <button
              key={example.id}
              type="button"
              onClick={() => {
                useIdeaUse.getState().use(example.id);
                onPick(text);
              }}
              className="rounded-full bg-white/70 px-3 py-1 text-xs text-ink-600 ring-1 ring-ink-200 transition hover:bg-white hover:text-ink-900 hover:ring-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
            >
              {text}
            </button>
          );
        })}
      </div>
    );
  }
  if (ideas.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={tAgent("ideasLabel")}>
      <Lightbulb className="size-3.5 text-ink-400" aria-hidden />
      {ideas.map((idea) => {
        const text = t(idea.id, { name: idea.vars?.name ?? "" });
        const fills = text.endsWith("…");
        const choose = () => {
          useIdeaUse.getState().use(idea.id);
          if (idea.instant && !fills) onRun(idea, text);
          else onPick(fills ? `${text.slice(0, -1).trimEnd()} ` : text);
        };
        if (idea.next) {
          return (
            <span
              key={idea.id}
              className="inline-flex items-center rounded-full bg-magic-50 text-xs text-magic-800 ring-1 ring-magic-300 transition hover:bg-magic-100"
            >
              <button
                type="button"
                onClick={choose}
                title={t("nextSuggested")}
                className="inline-flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magic-400"
              >
                <Sparkles className="size-3" aria-hidden />
                {text}
              </button>
              <button
                type="button"
                onClick={() => idea.dismissKey && useIdeaUse.getState().dismiss(idea.dismissKey)}
                aria-label={t("dismissNext")}
                title={t("dismissNext")}
                className="mr-1 flex size-5 items-center justify-center rounded-full text-magic-600 transition hover:bg-magic-200 hover:text-magic-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magic-400"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          );
        }
        return (
          <button
            key={idea.id}
            type="button"
            onClick={choose}
            className="rounded-full bg-white/70 px-3 py-1 text-xs text-ink-600 ring-1 ring-ink-200 transition hover:bg-white hover:text-ink-900 hover:ring-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** One more idea than the chips show, as the idle composer's placeholder. */
export function useIdeaPlaceholder(project: Project, view: BookViewId | null): string | null {
  const t = useGuideT("ideas");
  const tAgent = useGuideT("agent");
  const config = useAppConfigStore((s) => s.guide.agent);
  const guest = useAuthStore((s) => s.accessLevel === "guest");
  return useMemo(() => {
    if (!config.ideas.inPlaceholder) return null;
    const widened = { ...config, ideas: { ...config.ideas, max: config.ideas.max + 1 } };
    const extra = suggestionsFor(project, widened, { guest, view })[config.ideas.max];
    return extra ? tAgent("tryIdea", { idea: t(extra.id, { name: extra.vars?.name ?? "" }) }) : null;
  }, [project, config, guest, view, t, tAgent]);
}
