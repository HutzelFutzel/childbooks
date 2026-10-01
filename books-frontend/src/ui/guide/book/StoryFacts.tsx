"use client";

/**
 * What the story says about its people, beside what the cast says.
 *
 * A name or an age is one fact kept in two places, and the reader may change
 * either one. Two things are offered here, both one tap and never automatic:
 *
 * - A name marked in the story can be renamed everywhere: the cast, the story,
 *   the page plan and the title follow (`renameCastMember`).
 * - An age the story states plainly that the cast does not have: set the person
 *   to the story's age, or revise the story to the cast's. The ages are read
 *   only where they are unambiguous (`ageMismatches`); a birthday during the
 *   story is not an age to copy.
 */
import { useMemo, useState } from "react";
import { UserPen } from "lucide-react";
import { ageMismatches, ageRevisionInstruction, type AgeMismatch, type AgeValue } from "../../../core/guide/ageSync";
import { foldName } from "../../../core/guide/agent/resolve";
import { briefOf, namedCast } from "../../../core/story/brief";
import type { Project } from "../../../core/types";
import type { StoryMark } from "../../../core/story/storyMark";
import { renameCastMember, reviseStoryFor, updateCastMember } from "../bookActions";
import { useGuideT } from "../intl";

const CHIP =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-ink-800 ring-1 ring-ink-200 transition hover:bg-white hover:ring-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:opacity-50";

export function StoryFacts({ project, mark }: { project: Project; mark: StoryMark | null }) {
  const cast = briefOf(project.config).cast;
  const storyText = project.config.storyText;
  const mismatches = useMemo(() => ageMismatches(project), [storyText, cast]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const markedName = mark?.text.trim() ?? "";
  const marked = markedName
    ? namedCast(briefOf(project.config)).find((member) => foldName(member.name) === foldName(markedName))
    : undefined;
  const shown = mismatches.filter((mismatch) => !dismissed.has(ageKey(mismatch)));
  if (!marked && shown.length === 0) return null;
  return (
    <section className="shrink-0 space-y-2 border-b border-ink-100 bg-ink-50/50 px-4 py-2.5 sm:px-5">
      {marked && <RenameMarked key={marked.id} id={marked.id} name={marked.name.trim()} />}
      {shown.map((mismatch) => (
        <AgeMismatchRow
          key={ageKey(mismatch)}
          mismatch={mismatch}
          onDismiss={() => setDismissed((current) => new Set(current).add(ageKey(mismatch)))}
        />
      ))}
    </section>
  );
}

function ageKey(mismatch: AgeMismatch): string {
  return `${mismatch.castId}:${JSON.stringify(mismatch.story)}:${JSON.stringify(mismatch.cast ?? null)}`;
}

function RenameMarked({ id, name }: { id: string; name: string }) {
  const t = useGuideT("chrome");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<"taken" | "busy" | null>(null);
  const [working, setWorking] = useState(false);
  const submit = async () => {
    if (!value.trim() || working) return;
    setWorking(true);
    setProblem(null);
    const outcome = await renameCastMember(id, value);
    setWorking(false);
    if (outcome.ok) return;
    if (outcome.reason === "taken" || outcome.reason === "busy") setProblem(outcome.reason);
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <UserPen className="size-3.5 shrink-0 text-ink-500" aria-hidden />
      <label htmlFor={`rename-${id}`} className="text-[13px] font-medium text-ink-900">
        {t("renameEverywhere", { name })}
      </label>
      <input
        id={`rename-${id}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("renamePlaceholder")}
        maxLength={60}
        className="h-7 min-w-0 flex-1 rounded-full bg-white px-3 text-sm text-ink-900 ring-1 ring-ink-200 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-ink-400 sm:max-w-56"
      />
      <button type="submit" disabled={!value.trim() || working} className={CHIP}>
        {t("renameAction")}
      </button>
      {problem && (
        <p role="alert" className="basis-full text-xs text-amber-700">
          {t(problem === "busy" ? "renameBusy" : "renameTaken")}
        </p>
      )}
    </form>
  );
}

function useAgeLabel() {
  const t = useGuideT("chrome");
  return (age: AgeValue) =>
    age.ageMonths !== undefined && age.age === undefined
      ? t("ageMonthsValue", { n: age.ageMonths })
      : t("ageYearsValue", { n: age.age ?? 0 });
}

function AgeMismatchRow({ mismatch, onDismiss }: { mismatch: AgeMismatch; onDismiss: () => void }) {
  const t = useGuideT("chrome");
  const label = useAgeLabel();
  const [working, setWorking] = useState(false);
  const { name, story, cast } = mismatch;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 basis-60 text-[13px] leading-snug text-ink-700">
        {cast
          ? t("ageStoryDiffers", { name, story: label(story), cast: label(cast) })
          : t("ageStoryStates", { name, story: label(story) })}
      </p>
      <button
        type="button"
        disabled={working}
        onClick={() => {
          setWorking(true);
          void updateCastMember(mismatch.castId, { age: story.age, ageMonths: story.ageMonths }).finally(() => setWorking(false));
        }}
        className={CHIP}
      >
        {t("ageUseStory", { name, story: label(story) })}
      </button>
      {cast && (
        <button
          type="button"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void reviseStoryFor(ageRevisionInstruction(name, cast)).finally(() => setWorking(false));
          }}
          className={CHIP}
        >
          {t("ageUseCast", { cast: label(cast) })}
        </button>
      )}
      <button type="button" onClick={onDismiss} className="text-xs text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
        {t("ageKeepBoth")}
      </button>
    </div>
  );
}
