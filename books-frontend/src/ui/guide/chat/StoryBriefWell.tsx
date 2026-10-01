"use client";

/**
 * The story card: optional details before the first draft, and "Write the
 * story". Choices are taps. A detail in the parent's own words is typed right
 * here, in a small field under the chips, and saved as it is: the card never
 * sends the parent down to the message field and back.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Moon, Plus, X } from "lucide-react";
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
  const [open, setOpen] = useState<StoryDetailId | null>(focus);
  /** The detail being typed in the parent's own words. */
  const [writing, setWriting] = useState<StoryDetailId | null>(null);
  useEffect(() => {
    setOpen(focus);
    setWriting(null);
  }, [focus]);

  const craft = useMemo(
    () => resolveStoryCraft(project.config.ageRangeId, storyCraft),
    [project.config.ageRangeId, storyCraft],
  );
  const brief = briefOf(project.config);
  const chosen = filledDetails(brief);
  const offered = offeredDetails(config).filter((id) => !chosen.includes(id));

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
  const ownWords = (id: StoryDetailId) => {
    setOpen(null);
    setWriting(id);
  };
  const pick = (id: StoryDetailId) => {
    const def = STORY_DETAILS[id];
    setWriting(null);
    if (def.kind === "toggle") void setDetail(id, { on: true });
    else if (def.kind === "text") ownWords(id);
    else setOpen(open === id ? null : id);
  };

  const tap = useChatStudio((s) => s.tap);
  const saveOwnWords = (id: StoryDetailId, text: string) => {
    setWriting(null);
    void tap(`${t(`fields.${id}`)}: ${text}`, () => setDetail(id, { text }), {
      undoable: true,
      reply: [{ key: "briefMore", priority: "question" }],
    });
  };
  const write = () => void tap(label("writeStory"), startStory);
  const start = useRef(write);
  start.current = write;
  useEffect(() => {
    onDefault(() => start.current());
    return () => onDefault(null);
  }, [onDefault]);

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="px-1 text-sm leading-snug text-ink-600">{t("hint")}</p>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((id) => {
            const field = t(`fields.${id}`);
            const text = valueText(id);
            const kind = STORY_DETAILS[id].kind;
            const editable = kind !== "toggle";
            return (
              <span
                key={id}
                className={cn(
                  "inline-flex max-w-full items-center rounded-full bg-ink-900/5 text-xs text-ink-800 ring-1 ring-ink-900/10",
                  open === id && "ring-ink-400",
                )}
              >
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => (kind === "text" ? ownWords(id) : (setWriting(null), setOpen(open === id ? null : id)))}
                  className="min-w-0 truncate py-1.5 pl-3 text-left focus-visible:outline-none enabled:hover:text-ink-900"
                >
                  <span className="font-medium">{field}</span>
                  {text && <span className="text-ink-600">: {text}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => void setDetail(id, null)}
                  aria-label={t("remove", { label: field })}
                  className="ml-0.5 mr-1 rounded-full p-1 text-ink-400 transition hover:bg-ink-900/10 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {offered.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {offered.map((id) => (
            <button
              key={id}
              type="button"
              aria-expanded={STORY_DETAILS[id].kind === "toggle" ? undefined : open === id || writing === id}
              onClick={() => pick(id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs text-ink-700 ring-1 ring-ink-200 transition hover:text-ink-900 hover:ring-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                (open === id || writing === id) && "text-ink-900 ring-ink-500",
              )}
            >
              {id === "bedtime" ? <Moon className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
              {t(`fields.${id}`)}
            </button>
          ))}
        </div>
      )}

      {open && !writing && (
        <DetailOptions id={open} project={project} craft={craft} optionLabel={optionLabel} onOwnWords={() => ownWords(open)} />
      )}
      {writing && (
        <OwnWordsField
          key={writing}
          id={writing}
          initial={cleanDetailValue(STORY_DETAILS[writing].read(brief))?.text ?? ""}
          onSave={(text) => saveOwnWords(writing, text)}
          onCancel={() => setWriting(null)}
        />
      )}

      <div className="w-full border-t border-ink-100 pt-3">
        <button
          type="button"
          onClick={() => start.current()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-[15px] font-semibold text-white shadow-soft transition hover:bg-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2"
        >
          {label("writeStory")}
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** One detail in the parent's own words, typed in the card. Enter adds it; Escape closes. */
function OwnWordsField({
  id,
  initial,
  onSave,
  onCancel,
}: {
  id: StoryDetailId;
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useGuideT("brief");
  const [text, setText] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  const example = t.has(`examples.${id}`) ? t(`examples.${id}`) : "";
  const save = () => {
    const value = text.trim().slice(0, 500);
    if (value && value !== initial.trim()) onSave(value);
    else onCancel();
  };
  return (
    <form
      className="flex flex-col gap-1.5 rounded-xl border border-ink-100 bg-ink-50/60 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label htmlFor={`brief-${id}`} className="px-0.5 text-[10px] font-semibold tracking-[0.12em] text-ink-400 uppercase">
        {t(`fields.${id}`)}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={`brief-${id}`}
          ref={field}
          value={text}
          maxLength={500}
          placeholder={example}
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
          className="inline-flex h-9 items-center gap-1 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:opacity-40"
        >
          <Check className="size-3.5" aria-hidden />
          {t("add")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("cancel")}
          className="rounded-full p-2 text-ink-400 transition hover:bg-ink-900/10 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="px-0.5 text-[11px] text-ink-400">{t("ownWordsHint")}</p>
    </form>
  );
}

function DetailOptions({
  id,
  project,
  craft,
  optionLabel,
  onOwnWords,
}: {
  id: StoryDetailId;
  project: Project;
  craft: ReturnType<typeof resolveStoryCraft>;
  optionLabel: (id: StoryDetailId, optionId: string) => string;
  onOwnWords: () => void;
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
    void setDetail(id, selected.includes(optionId) ? { ids: null } : { ids: [optionId] });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-2.5">
      <span className="px-0.5 text-[10px] font-semibold tracking-[0.12em] text-ink-400 uppercase">{t(`fields.${id}`)}</span>
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
                "rounded-full px-3 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                on
                  ? "bg-ink-900 text-white"
                  : "bg-white text-ink-700 ring-1 ring-ink-200 hover:text-ink-900 hover:ring-ink-400",
              )}
            >
              {optionLabel(id, option.id)}
            </button>
          );
        })}
        {def.ownWords && (
          <button
            type="button"
            onClick={onOwnWords}
            className="rounded-full px-3 py-1.5 text-xs text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            {t("ownWords")}
          </button>
        )}
      </div>
    </div>
  );
}
