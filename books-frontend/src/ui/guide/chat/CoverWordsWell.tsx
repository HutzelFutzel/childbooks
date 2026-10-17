"use client";

/**
 * The cover card: what the front cover will say, shown as the cover reads,
 * with subtitle and author ideas one tap each. It is tap-only: picks save as
 * they are made and never add a message; "Looks good" is the one answer, and
 * it keeps what the card shows. Any custom title, subtitle or author in the
 * parent's own words is typed in the chat composer below.
 */
import { useEffect, useMemo, useRef } from "react";
import { Check, MessageSquareText } from "lucide-react";
import { coverLetteringAllowed } from "../../../core/book/coverLines";
import { authorIdeas, coverCardLines, subtitleIdeas } from "../../../core/guide/coverWords";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import { confirmCoverWords, setAuthor, setSubtitle } from "../bookActions";
import { useGuideLabel, useGuideT } from "../intl";

export function CoverWordsWell({
  project,
  onDefault,
}: {
  project: Project;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("chrome");
  const label = useGuideLabel();
  const tap = useChatStudio((s) => s.tap);
  const languages = useAppConfigStore((s) => s.bookLanguages);
  const lines = coverCardLines(project);
  const subtitles = useMemo(() => subtitleIdeas(project), [project]);
  const writer = useAuthStore((s) => (s.user?.isAnonymous ? "" : (s.user?.displayName ?? "")));
  const authors = useMemo(() => authorIdeas(project, writer), [project, writer]);
  const painted = coverLetteringAllowed(project.config.contentLocale, languages);

  const confirm = () =>
    void tap(label("coverLooksGood"), () => confirmCoverWords(), { undoable: true });
  const latest = useRef(confirm);
  latest.current = confirm;
  useEffect(() => {
    onDefault(() => latest.current());
    return () => onDefault(null);
  }, [onDefault]);

  const focusComposer = () => {
    useChatStudio.setState((state) => ({ composerFocus: state.composerFocus + 1 }));
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <CoverPreview lines={lines} />

      <IdeaRow
        label={t("subtitle")}
        chosen={lines.subtitle}
        ideas={subtitles}
        none={t("coverNone")}
        onPick={(text) => {
          if (text !== lines.subtitle) void setSubtitle(text.trim().slice(0, 160));
        }}
      />

      <IdeaRow
        label={t("author")}
        chosen={lines.author}
        ideas={authors}
        none={t("coverNone")}
        onPick={(text) => {
          if (text !== lines.author) void setAuthor(text.trim().slice(0, 120));
        }}
      />

      <button
        type="button"
        onClick={focusComposer}
        className="flex w-full items-center gap-2 rounded-xl bg-ink-900/3 px-3 py-2 text-left text-xs leading-snug text-ink-500 ring-1 ring-inset ring-ink-900/5 transition hover:bg-ink-900/5 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        <MessageSquareText className="size-3.5 shrink-0 text-ink-400" aria-hidden />
        <span>{t("coverTypeBelowHint")}</span>
      </button>

      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-100 pt-3">
        <button
          type="button"
          onClick={() => latest.current()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-linear-to-b from-ink-800 to-ink-900 px-5 text-[15px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(20,22,58,0.28),inset_0_1px_0_rgba(255,255,255,0.16)] ring-1 ring-ink-900 transition hover:-translate-y-0.5 hover:from-ink-700 hover:to-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          <Check className="size-4" aria-hidden />
          {label("coverLooksGood")}
        </button>
        <span className="text-xs leading-snug text-ink-500">{painted ? t("coverPainted") : t("coverSet")}</span>
      </div>
    </div>
  );
}

/** The three lines in the order and weight a cover gives them. */
function CoverPreview({
  lines,
}: {
  lines: { title: string; subtitle: string; author: string };
}) {
  return (
    <div className="flex w-full flex-col items-center gap-1 rounded-xl bg-linear-to-b from-[#f6f1e7] to-[#ece4d3] px-4 pt-5 pb-4 text-center ring-1 ring-ink-900/8">
      <span className="max-w-full font-display text-xl leading-tight font-semibold text-balance text-ink-900">
        {lines.title}
      </span>
      {lines.subtitle && <span className="max-w-full text-sm leading-snug text-balance text-ink-700">{lines.subtitle}</span>}
      {lines.author && (
        <span className="mt-2 max-w-full text-[11px] font-medium tracking-[0.14em] text-ink-500 uppercase">
          {lines.author}
        </span>
      )}
    </div>
  );
}

/** One line's choices: the ideas or none. The current one is marked. */
function IdeaRow({
  label,
  chosen,
  ideas,
  none,
  onPick,
}: {
  label: string;
  chosen: string;
  ideas: string[];
  none: string;
  onPick: (text: string) => void;
}) {
  const shown = chosen && !ideas.includes(chosen) ? [chosen, ...ideas] : ideas;
  const chip = (on: boolean) =>
    cn(
      "max-w-full truncate rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
      on ? "bg-ink-900 text-white shadow-2xs" : "bg-white text-ink-700 ring-1 ring-ink-200 hover:text-ink-900 hover:ring-ink-400",
    );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-0.5 text-[10px] font-semibold tracking-[0.12em] text-ink-400 uppercase">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((idea) => (
          <button key={idea} type="button" aria-pressed={idea === chosen} onClick={() => onPick(idea)} className={chip(idea === chosen)}>
            {idea}
          </button>
        ))}
        <button type="button" aria-pressed={!chosen} onClick={() => onPick("")} className={chip(!chosen)}>
          {none}
        </button>
      </div>
    </div>
  );
}
