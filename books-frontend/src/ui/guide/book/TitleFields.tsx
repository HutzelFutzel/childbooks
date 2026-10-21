"use client";

/**
 * The one place the book's words are typed, above the story they belong to:
 * title, subtitle and byline, with the story's language (a menu that changes
 * it until the pages are drawn) and the review controls on the same line as
 * the title. Typing never redraws a picture; once
 * the pages start they are shown, not edited.
 *
 * The manuscript below draws no header of its own (`hideHeader`). A second
 * title field used to live there, and it wrote the title by a different route
 * that did not mark it as edited, so the cover could overwrite what the reader
 * had typed.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { coverLinesOf, PLACEHOLDER_TITLE } from "../../../core/book/coverLines";
import { getBookLanguage } from "../../../core/config/bookLanguages";
import type { Project } from "../../../core/types";
import { cn } from "../../lib/cn";
import { setAuthor, setSubtitle, setTitle } from "../bookActions";
import { bookTitle } from "../bookTitle";
import { useGuideT } from "../intl";
import { StoryLanguageMenu } from "./StoryLanguageMenu";

export function TitleFields({
  project,
  locked,
  busy = false,
  trailing,
}: {
  project: Project;
  locked: boolean;
  /** The story is being written or translated; the title may be about to arrive. */
  busy?: boolean;
  /** Review controls for the story, shown beside the title. */
  trailing?: ReactNode;
}) {
  const t = useGuideT("chrome");
  const lines = coverLinesOf(project);
  const stored = project.title.trim();
  const title = stored === PLACEHOLDER_TITLE ? "" : stored;
  const language = getBookLanguage(project.config.contentLocale);
  const disabled = locked || busy;

  return (
    <section className="shrink-0 border-b border-ink-100 px-5 pt-4 pb-2.5 sm:px-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TitleField
            value={title}
            onCommit={(v) => void setTitle(v)}
            placeholder={busy ? t("writingTitle") : bookTitle(project) || t("titlePlaceholder")}
            label={t("titlePlaceholder")}
            disabled={disabled}
            lang={language.id}
            dir={language.direction}
            className="font-display text-2xl font-semibold leading-tight text-ink-900"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1.5">
          {trailing}
          <StoryLanguageMenu project={project} locked={locked} busy={busy} />
        </div>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-4">
        <TitleField
          value={lines.subtitle}
          onCommit={(v) => void setSubtitle(v)}
          placeholder={t("subtitle")}
          label={t("subtitle")}
          disabled={locked}
          lang={language.id}
          dir={language.direction}
          className="min-w-[12rem] flex-1 text-sm text-ink-600"
        />
        <TitleField
          value={lines.author}
          onCommit={(v) => void setAuthor(v)}
          placeholder={t("author")}
          label={t("author")}
          disabled={locked}
          className="min-w-[10rem] flex-1 text-xs font-medium uppercase tracking-[0.14em] text-ink-500"
        />
      </div>
    </section>
  );
}

/** One line. Saves when the reader leaves it or presses Enter. */
function TitleField({
  value,
  onCommit,
  placeholder,
  label,
  disabled,
  className,
  lang,
  dir,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  label: string;
  disabled: boolean;
  className?: string;
  lang?: string;
  dir?: string;
}) {
  const [draft, setDraft] = useState(value);
  // A line saved elsewhere (the cover card, the chat) shows here, but never
  // over what the reader is typing in this field right now.
  const focused = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };
  return (
    <input
      value={draft}
      disabled={disabled}
      lang={lang}
      dir={dir}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      aria-label={label}
      className={cn(
        "-mx-1 w-full rounded-md bg-transparent px-1 py-0.5 transition placeholder:text-ink-300 hover:bg-ink-900/[0.03] focus:bg-white/80 focus:outline-none focus:ring-1 focus:ring-ink-300 disabled:hover:bg-transparent",
        className,
      )}
    />
  );
}
