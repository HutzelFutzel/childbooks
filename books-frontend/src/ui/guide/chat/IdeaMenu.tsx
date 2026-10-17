"use client";

/**
 * The "what can I ask?" menu beside the composer: everything the chat can do on
 * the open tab, in a few groups. The chips under the composer only hint at the
 * likeliest few; this is where the rest can always be found, so no feature
 * depends on the reader having been shown it at the right moment.
 *
 * A tap behaves like the same chip: an idea that is reviewed or advisory runs,
 * any other puts its start in the message field.
 */
import { useMemo } from "react";
import { Lightbulb } from "lucide-react";
import { ideaMenuFor, questionIdeasFor, type GuideIdea } from "../../../core/guide/agent/ideas";
import type { GuideQuestionId } from "../../../core/guide/questions";
import type { BookViewId } from "../../../core/guide/journey";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import { pagesLocked } from "../../../core/guide/projectState";
import { useIdeaUse } from "../../../state/ideaUse";
import { Popover } from "../../components/Popover";
import { useGuideT } from "../intl";

const GROUP_KEYS = {
  check: "groupCheck",
  story: "groupStory",
  people: "groupPeople",
  book: "groupBook",
  help: "groupHelp",
} as const;

export function IdeaMenu({
  project,
  view,
  question = null,
  questionName,
  onPick,
  onRun,
}: {
  project: Project;
  view: BookViewId | null;
  /** The question the guide has open: what an answer looks like leads the menu. */
  question?: GuideQuestionId | null;
  /** The person a question is about, when it asks about one person. */
  questionName?: string;
  onPick: (text: string) => void;
  onRun: (idea: GuideIdea, text: string) => void;
}) {
  const t = useGuideT("ideas");
  const config = useAppConfigStore((s) => s.guide.agent);
  const guest = useAuthStore((s) => s.accessLevel === "guest");
  const tExamples = useGuideT("examples");
  const used = useIdeaUse((s) => s.used);
  const groups = useMemo(
    () => ideaMenuFor(project, config, { guest, view }),
    [project, config, guest, view],
  );
  const answers = useMemo(() => questionIdeasFor(question, config, used), [question, config, used]);
  if (groups.length === 0 && !answers) return null;
  const exampleVars = { name: questionName || "Maya" };
  return (
    <Popover
      side="top"
      align="end"
      panelClassName="w-80 max-w-[calc(100vw-1rem)] p-0"
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={t("menuLabel")}
          title={t("menuLabel")}
          className="flex size-9 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"
        >
          <Lightbulb className="size-[18px]" aria-hidden />
        </span>
      }
    >
      {(close) => (
        <div className="max-h-[min(26rem,70vh)] overflow-y-auto py-2">
          <p className="px-4 pt-1 pb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
            {t("menuTitle")}
          </p>
          {answers && (
            <section aria-label={t("groupQuestion")} className="pb-1">
              <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold text-ink-400">{t("groupQuestion")}</h3>
              {answers.tip && (
                <p className="mx-3 mb-1 rounded-xl bg-magic-50 px-3 py-2 text-xs leading-5 text-magic-800">
                  {tExamples(`${answers.question}.tip`, exampleVars)}
                </p>
              )}
              <ul>
                {answers.examples.map((example) => {
                  const text = tExamples(example.key, exampleVars);
                  return (
                    <li key={example.id}>
                      <button
                        type="button"
                        onClick={() => {
                          useIdeaUse.getState().use(example.id);
                          close();
                          onPick(text);
                        }}
                        className="w-full px-4 py-1.5 text-left text-sm text-ink-700 transition hover:bg-ink-50 hover:text-ink-900 focus-visible:bg-ink-50 focus-visible:outline-none"
                      >
                        {text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {groups.map(({ group, ideas, elsewhere }, index) => (
            <section key={`${elsewhere}:${group}`} aria-label={t(GROUP_KEYS[group])} className="pb-1">
              {elsewhere && !groups[index - 1]?.elsewhere && (
                <p className="mx-4 mt-3 mb-1 border-t border-ink-100 pt-3 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                  {t("menuElsewhere")}
                </p>
              )}
              <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold text-ink-400">{t(GROUP_KEYS[group])}</h3>
              <ul>
                {ideas.map((idea) => {
                  const text = t(idea.id, { name: idea.vars?.name ?? "" });
                  const fills = text.endsWith("…");
                  return (
                    <li key={idea.id}>
                      <button
                        type="button"
                        onClick={() => {
                          useIdeaUse.getState().use(idea.id);
                          close();
                          if (idea.instant && !fills) onRun(idea, text);
                          else onPick(fills ? `${text.slice(0, -1).trimEnd()} ` : text);
                        }}
                        className="w-full px-4 py-1.5 text-left text-sm text-ink-700 transition hover:bg-ink-50 hover:text-ink-900 focus-visible:bg-ink-50 focus-visible:outline-none"
                      >
                        {text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {view === "story" && !pagesLocked(project) && (
            <p className="mx-3 mt-2 rounded-xl bg-magic-50 px-3 py-2 text-xs leading-5 text-magic-800">
              {t("menuMarkTip")}
            </p>
          )}
        </div>
      )}
    </Popover>
  );
}
