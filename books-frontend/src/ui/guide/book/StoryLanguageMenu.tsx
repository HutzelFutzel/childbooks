"use client";

/**
 * The flag beside the title: the language the story is written in, and the way to change it.
 *
 * Before the story exists a pick just sets the language. Once it is written, a pick
 * translates it: the same people, plot and tone in new words (the `setBookLanguage`
 * skill, the same one the chat uses, so both ask and undo the same way). It stays
 * open until the pages are drawn; after that, or while the story is being written
 * or translated, it is only a label.
 */
import { Check, ChevronDown } from "lucide-react";
import { enabledBookLanguages, getBookLanguage } from "../../../core/config/bookLanguages";
import { languageStatus } from "../../../core/guide/storyVersions";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useChatStudio } from "../../../state/chatStudio";
import { Popover } from "../../components/Popover";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";

export function StoryLanguageMenu({
  project,
  locked,
  busy,
}: {
  project: Project;
  /** The pages are drawn: the language is fixed. */
  locked: boolean;
  /** The story is being written or translated. */
  busy: boolean;
}) {
  const t = useGuideT("chrome");
  const languages = useAppConfigStore((s) => s.bookLanguages);
  const current = getBookLanguage(project.config.contentLocale);
  const written = project.config.storyText.trim().length > 0;

  const label = (
    <>
      <span aria-hidden>{current.flag}</span>
      <span className="hidden sm:inline">{current.endonym}</span>
    </>
  );

  if (locked || busy) {
    return (
      <span
        aria-label={t("storyLanguage", { language: current.endonym })}
        title={locked ? t("storyLanguageLocked") : current.endonym}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500"
      >
        {label}
      </span>
    );
  }

  const choose = (id: string, endonym: string, region: string, close: () => void) => {
    close();
    if (id === current.id) return;
    const chat = useChatStudio.getState();
    const tapKey = !written ? "writeStoryTap" : languageStatus(project, id) === "current" ? "switchStoryTap" : "translateStoryTap";
    void chat.tap(t(tapKey, { language: `${endonym} (${region})` }), () =>
      chat.runSkill({ id: "setBookLanguage", args: { language: id } }),
    );
  };

  const options = enabledBookLanguages(languages);

  return (
    <Popover
      align="end"
      panelClassName="max-h-[min(24rem,calc(100dvh-6rem))] w-64 overflow-y-auto p-1.5"
      trigger={(open) => (
        <span
          aria-label={t("changeStoryLanguage")}
          title={t("changeStoryLanguage")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-ink-600 ring-1 ring-ink-200 transition group-hover:bg-ink-50 group-hover:ring-ink-400 group-focus-visible:ring-2 group-focus-visible:ring-ink-400",
            open && "bg-ink-50 ring-ink-400",
          )}
        >
          {label}
          <ChevronDown className="size-3 text-ink-400" aria-hidden />
        </span>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          {written && <p className="px-2 pb-1.5 pt-1 text-[11px] leading-snug text-ink-500">{t("storyLanguageMenuHint")}</p>}
          {options.map((language) => {
            const selected = language.id === current.id;
            // Only once the story is written: what is saved, and what would be translated again.
            const status = written ? languageStatus(project, language.id) : "none";
            return (
              <button
                key={language.id}
                type="button"
                lang={language.id}
                aria-current={selected || undefined}
                onClick={() => choose(language.id, language.endonym, language.regionShort, close)}
                className={cn(
                  "flex min-h-9 items-center gap-2.5 rounded-lg px-2 text-left text-sm text-ink-800 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                  selected && "bg-ink-50 font-medium",
                )}
              >
                <span aria-hidden>{language.flag}</span>
                <span className="min-w-0 flex-1 truncate">{language.endonym}</span>
                {status === "current" && (
                  <span title={t("storyLanguageKeptTitle")} className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">
                    {t("storyLanguageKept")}
                  </span>
                )}
                {status === "stale" && (
                  <span title={t("storyLanguageStaleTitle")} className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">
                    {t("storyLanguageStale")}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-ink-400">{language.regionShort}</span>
                {selected && <Check className="size-3.5 text-ink-500" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
