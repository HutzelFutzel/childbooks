"use client";

/**
 * The story card: optional details before the first draft, and "Write the
 * story". It is tap-only: toggles and choice trays stay right on the card, and
 * anything in the parent's own words is typed in the chat composer below, which
 * is the one place to type. The card never has an input of its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, MessageSquareText, Moon, X } from "lucide-react";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import { offeredDetails } from "../../../core/guide/briefPolicy";
import {
  STORY_DETAILS,
  cleanDetailValue,
  filledDetails,
  type StoryDetailId,
} from "../../../core/guide/storyDetails";
import { briefOf } from "../../../core/story/brief";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import { useGuideLabel, useGuideT } from "../intl";

export function StoryBriefWell({
  project,
  focus,
  onDefault,
}: {
  project: Project;
  focus: StoryDetailId | null;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("brief");
  const label = useGuideLabel();
  const config = useAppConfigStore((s) => s.guide.brief);
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const setDetail = useChatStudio((s) => s.setStoryDetail);
  const startStory = useChatStudio((s) => s.startStory);
  const [open, setOpen] = useState<StoryDetailId | null>(() =>
    focus && STORY_DETAILS[focus].kind !== "text" && STORY_DETAILS[focus].kind !== "toggle" ? focus : null,
  );
  useEffect(() => {
    setOpen(
      focus && STORY_DETAILS[focus].kind !== "text" && STORY_DETAILS[focus].kind !== "toggle" ? focus : null,
    );
  }, [focus]);

  const craft = useMemo(
    () => resolveStoryCraft(project.config.ageRangeId, storyCraft),
    [project.config.ageRangeId, storyCraft],
  );
  const brief = briefOf(project.config);
  const chosen = filledDetails(brief);
  const allOffered = offeredDetails(config);
  // Toggles get their own dedicated switch row; choice pills (with dropdown trays) sit in the pill grid.
  const toggleOffered = allOffered.filter((id) => STORY_DETAILS[id].kind === "toggle");
  const choiceOffered = allOffered.filter((id) => {
    const kind = STORY_DETAILS[id].kind;
    if (kind === "text" || kind === "toggle") return false;
    return !chosen.includes(id);
  });
  // Text-only details ("Favorite things", "Anything else", "Leave out"…) are
  // explained as a single quiet hint pointing to the chat composer below,
  // instead of spawning separate mini-inputs.
  const textOffered = allOffered.filter((id) => STORY_DETAILS[id].kind === "text" && !chosen.includes(id));
  const chosenNonToggle = chosen.filter((id) => STORY_DETAILS[id].kind !== "toggle");

  const optionLabel = (id: StoryDetailId, optionId: string): string => {
    const key = `options.${id}.${optionId}`;
    if (t.has(key)) return t(key);
    return STORY_DETAILS[id].options(craft).find((option) => option.id === optionId)?.label ?? optionId;
  };
  const valueText = (id: StoryDetailId): string => {
    const value = cleanDetailValue(STORY_DETAILS[id].read(brief));
    if (!value || STORY_DETAILS[id].kind === "toggle") return "";
    return [...(value.ids ?? []).map((optionId) => optionLabel(id, optionId)), ...(value.text ? [value.text] : [])].join(", ");
  };
  const focusComposer = () => {
    useChatStudio.setState((state) => ({ composerFocus: state.composerFocus + 1 }));
  };
  const pick = (id: StoryDetailId) => {
    const def = STORY_DETAILS[id];
    if (def.kind === "toggle") {
      const isOn = chosen.includes(id);
      void setDetail(id, isOn ? null : { on: true });
    } else if (def.kind === "text") {
      focusComposer();
    } else {
      setOpen(open === id ? null : id);
    }
  };

  const tap = useChatStudio((s) => s.tap);
  const write = () => void tap(label("writeStory"), startStory);
  const start = useRef(write);
  start.current = write;
  useEffect(() => {
    onDefault(() => start.current());
    return () => onDefault(null);
  }, [onDefault]);

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="px-0.5 text-sm leading-snug text-ink-600">{t("hint")}</p>

      {chosenNonToggle.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosenNonToggle.map((id) => {
            const field = t(`fields.${id}`);
            const text = valueText(id);
            const kind = STORY_DETAILS[id].kind;
            return (
              <span
                key={id}
                className={cn(
                  "inline-flex max-w-full items-center rounded-full bg-magic-50/80 text-xs text-ink-900 ring-1 ring-magic-300/70 shadow-2xs",
                  open === id && "ring-2 ring-magic-500",
                )}
              >
                {kind === "text" ? (
                  <span className="min-w-0 truncate py-1.5 pl-3 text-left">
                    <span className="font-semibold text-magic-900">{field}</span>
                    {text && <span className="text-ink-700">: {text}</span>}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpen(open === id ? null : id)}
                    className="min-w-0 truncate py-1.5 pl-3 text-left focus-visible:outline-none hover:text-magic-800"
                  >
                    <span className="font-semibold text-magic-900">{field}</span>
                    {text && <span className="text-ink-700">: {text}</span>}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void setDetail(id, null)}
                  aria-label={t("remove", { label: field })}
                  className="ml-0.5 mr-1 rounded-full p-1 text-ink-400 transition hover:bg-magic-200/50 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {choiceOffered.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {choiceOffered.map((id) => {
            const isOpen = open === id;
            return (
              <button
                key={id}
                type="button"
                aria-expanded={isOpen}
                onClick={() => pick(id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                  isOpen
                    ? "bg-magic-50 text-magic-900 ring-1.5 ring-magic-400"
                    : "bg-white text-ink-700 shadow-2xs ring-1 ring-ink-200 hover:text-ink-900 hover:ring-ink-400",
                )}
              >
                {t(`fields.${id}`)}
                <ChevronDown
                  className={cn("size-3 text-ink-400 transition-transform", isOpen && "rotate-180 text-magic-700")}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <DetailOptions
          id={open}
          project={project}
          craft={craft}
          optionLabel={optionLabel}
          onDone={() => setOpen(null)}
        />
      )}

      {toggleOffered.map((id) => {
        const activeToggle = chosen.includes(id);
        return (
          <button
            key={id}
            type="button"
            role="switch"
            aria-checked={activeToggle}
            onClick={() => pick(id)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
              activeToggle
                ? "bg-magic-50/80 text-ink-900 ring-1 ring-magic-300/80"
                : "bg-white/90 text-ink-700 ring-1 ring-ink-200/80 hover:bg-white hover:ring-ink-300",
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                  activeToggle ? "bg-magic-600 text-white" : "bg-ink-100/80 text-ink-500",
                )}
              >
                {id === "bedtime" ? <Moon className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-ink-900">{t(`fields.${id}`)}</span>
                {id === "bedtime" && (
                  <span className="block text-[11px] leading-snug text-ink-500">{t("bedtimeHint")}</span>
                )}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                activeToggle ? "bg-ink-900" : "bg-ink-200",
              )}
            >
              <span
                className={cn(
                  "size-4 rounded-full bg-white shadow-2xs transition-transform",
                  activeToggle && "translate-x-4",
                )}
              />
            </span>
          </button>
        );
      })}
      {textOffered.length > 0 && (
        <button
          type="button"
          onClick={focusComposer}
          className="flex w-full items-center gap-2 rounded-xl bg-ink-900/3 px-3 py-2 text-left text-xs leading-snug text-ink-500 ring-1 ring-inset ring-ink-900/5 transition hover:bg-ink-900/5 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          <MessageSquareText className="size-3.5 shrink-0 text-ink-400" aria-hidden />
          <span>{t("typeBelowHint")}</span>
        </button>
      )}

      <div className="w-full border-t border-ink-100/90 pt-3">
        <button
          type="button"
          onClick={() => start.current()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-linear-to-b from-ink-800 to-ink-900 px-5 text-[15px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(20,22,58,0.28),inset_0_1px_0_rgba(255,255,255,0.16)] ring-1 ring-ink-900 transition hover:-translate-y-0.5 hover:from-ink-700 hover:to-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          {label("writeStory")}
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function DetailOptions({
  id,
  project,
  craft,
  optionLabel,
  onDone,
}: {
  id: StoryDetailId;
  project: Project;
  craft: ReturnType<typeof resolveStoryCraft>;
  optionLabel: (id: StoryDetailId, optionId: string) => string;
  onDone: () => void;
}) {
  const t = useGuideT("brief");
  const setDetail = useChatStudio((s) => s.setStoryDetail);
  const def = STORY_DETAILS[id];
  const options = def.options(craft);
  const selected = STORY_DETAILS[id].read(briefOf(project.config))?.ids ?? [];

  const toggle = (optionId: string) => {
    if (def.kind === "multi") {
      const next = selected.includes(optionId)
        ? selected.filter((candidate) => candidate !== optionId)
        : [...selected, optionId].slice(-def.maxIds);
      void setDetail(id, { ids: next.length > 0 ? next : null });
      return;
    }
    const clearing = selected.includes(optionId);
    void setDetail(id, clearing ? { ids: null } : { ids: [optionId] });
    if (!clearing) onDone();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-ink-50/70 p-3">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-ink-500 uppercase">
          {t(`fields.${id}`)}
        </span>
        <button
          type="button"
          onClick={onDone}
          aria-label={t("cancel")}
          className="rounded-full p-0.5 text-ink-400 transition hover:bg-ink-900/10 hover:text-ink-800"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                on
                  ? "bg-ink-900 text-white shadow-2xs"
                  : "bg-white text-ink-700 ring-1 ring-ink-200 hover:text-ink-900 hover:ring-ink-400",
              )}
            >
              {optionLabel(id, option.id)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
