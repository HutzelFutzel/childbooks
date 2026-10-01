"use client";

/**
 * The cover card: what the front cover will say, shown as the cover reads,
 * with subtitle and author ideas one tap each. Picks save as they are made and
 * never add a message; "Looks good" is the one answer, and it keeps exactly
 * what the card shows. Every line can be written in the parent's own words
 * right here, and typing in the message field works too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { coverLetteringAllowed } from "../../../core/book/coverLines";
import { authorIdeas, coverCardLines, subtitleIdeas } from "../../../core/guide/coverWords";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import { confirmCoverWords, setAuthor, setSubtitle, setTitle } from "../bookActions";
import { useGuideLabel, useGuideT } from "../intl";

type Line = "title" | "subtitle" | "author";
const MAX: Record<Line, number> = { title: 120, subtitle: 160, author: 120 };

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
  const [writing, setWriting] = useState<Line | null>(null);
  const lines = coverCardLines(project);
  const subtitles = useMemo(() => subtitleIdeas(project), [project]);
  const writer = useAuthStore((s) => (s.user?.isAnonymous ? "" : (s.user?.displayName ?? "")));
  const authors = useMemo(() => authorIdeas(project, writer), [project, writer]);
  const painted = coverLetteringAllowed(project.config.contentLocale, languages);

  const confirm = () => void tap(label("coverLooksGood"), () => confirmCoverWords(), { undoable: true });
  const latest = useRef(confirm);
  latest.current = confirm;
  useEffect(() => {
    onDefault(() => latest.current());
    return () => onDefault(null);
  }, [onDefault]);

  const save = (line: Line, text: string) => {
    setWriting(null);
    const value = text.trim().slice(0, MAX[line]);
    if (line === "title") {
      if (value && value !== lines.title) void setTitle(value);
    } else if (value !== lines[line]) {
      void (line === "subtitle" ? setSubtitle(value) : setAuthor(value));
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <CoverPreview lines={lines} onEditTitle={() => setWriting("title")} editTitle={t("editTitle")} />
      {writing === "title" && (
        <LineField
          key="title"
          label={t("titlePlaceholder")}
          initial={lines.title}
          placeholder={t("titlePlaceholder")}
          maxLength={MAX.title}
          onSave={(text) => save("title", text)}
          onCancel={() => setWriting(null)}
        />
      )}

      <IdeaRow
        label={t("subtitle")}
        chosen={lines.subtitle}
        ideas={subtitles}
        none={t("coverNone")}
        own={t("coverOwn")}
        onPick={(text) => save("subtitle", text)}
        onOwn={() => setWriting("subtitle")}
      />
      {writing === "subtitle" && (
        <LineField
          key="subtitle"
          label={t("subtitle")}
          initial={lines.subtitle}
          placeholder={t("coverSubtitlePlaceholder")}
          maxLength={MAX.subtitle}
          onSave={(text) => save("subtitle", text)}
          onCancel={() => setWriting(null)}
        />
      )}

      <IdeaRow
        label={t("author")}
        chosen={lines.author}
        ideas={authors}
        none={t("coverNone")}
        own={t("coverOwn")}
        onPick={(text) => save("author", text)}
        onOwn={() => setWriting("author")}
      />
      {writing === "author" && (
        <LineField
          key="author"
          label={t("author")}
          initial={lines.author}
          placeholder={t("coverAuthorPlaceholder")}
          maxLength={MAX.author}
          onSave={(text) => save("author", text)}
          onCancel={() => setWriting(null)}
        />
      )}

      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-100 pt-3">
        <button
          type="button"
          onClick={() => latest.current()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-[15px] font-semibold text-white shadow-soft transition hover:bg-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
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
  onEditTitle,
  editTitle,
}: {
  lines: { title: string; subtitle: string; author: string };
  onEditTitle: () => void;
  editTitle: string;
}) {
  return (
    <div className="relative flex w-full flex-col items-center gap-1 rounded-xl bg-linear-to-b from-[#f6f1e7] to-[#ece4d3] px-4 pt-5 pb-4 text-center ring-1 ring-ink-900/8">
      <span className="max-w-full font-display text-xl leading-tight font-semibold text-balance text-ink-900">
        {lines.title}
      </span>
      {lines.subtitle && <span className="max-w-full text-sm leading-snug text-balance text-ink-700">{lines.subtitle}</span>}
      {lines.author && (
        <span className="mt-2 max-w-full text-[11px] font-medium tracking-[0.14em] text-ink-500 uppercase">
          {lines.author}
        </span>
      )}
      <button
        type="button"
        onClick={onEditTitle}
        className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-500 transition hover:bg-white/70 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        <Pencil className="size-3" aria-hidden />
        {editTitle}
      </button>
    </div>
  );
}

/** One line's choices: the ideas, none, or the parent's own words. The current one is marked. */
function IdeaRow({
  label,
  chosen,
  ideas,
  none,
  own,
  onPick,
  onOwn,
}: {
  label: string;
  chosen: string;
  ideas: string[];
  none: string;
  own: string;
  onPick: (text: string) => void;
  onOwn: () => void;
}) {
  const shown = chosen && !ideas.includes(chosen) ? [chosen, ...ideas] : ideas;
  const chip = (on: boolean) =>
    cn(
      "max-w-full truncate rounded-full px-3 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
      on ? "bg-ink-900 text-white" : "bg-white text-ink-700 ring-1 ring-ink-200 hover:text-ink-900 hover:ring-ink-400",
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
        <button
          type="button"
          onClick={onOwn}
          className="rounded-full px-3 py-1.5 text-xs text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          {own}
        </button>
      </div>
    </div>
  );
}

/** One line in the parent's own words. Enter keeps it; Escape closes. */
function LineField({
  label,
  initial,
  placeholder,
  maxLength,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  placeholder: string;
  maxLength: number;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useGuideT("brief");
  const [text, setText] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  return (
    <form
      className="flex items-center gap-1.5 rounded-xl border border-ink-100 bg-ink-50/60 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSave(text);
        else onCancel();
      }}
    >
      <input
        ref={field}
        value={text}
        maxLength={maxLength}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-9 min-w-0 flex-1 rounded-lg bg-white px-3 text-sm text-ink-900 ring-1 ring-ink-200 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-ink-400"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label={t("add")}
        className="inline-flex size-9 items-center justify-center rounded-full bg-ink-900 text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:opacity-40"
      >
        <Check className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t("cancel")}
        className="rounded-full p-2 text-ink-400 transition hover:bg-ink-900/10 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </form>
  );
}
