"use client";

import { useEffect, useRef, type ChangeEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { StoryBeatItem } from "../../../core/story/beats";
import {
  beatWordCount,
  defaultBeatLabel,
  isBeatEmpty,
} from "../../../core/story/beats";
import type { BookLanguageDefinition } from "../../../core/config/bookLanguages";
import { fontStack } from "../../typography/fonts";
import { cn } from "../../lib/cn";

export interface BeatCardProps {
  beat: StoryBeatItem;
  index: number;
  totalBeats: number;
  language: BookLanguageDefinition;
  placeholder?: string;
  isHighlighted?: boolean;
  onChangeTitle: (title: string) => void;
  onChangeText: (text: string) => void;
  onRemove: () => void;
  onInsertAfter: () => void;
}

export function BeatCard({
  beat,
  index,
  totalBeats,
  language,
  placeholder,
  isHighlighted = false,
  onChangeTitle,
  onChangeText,
  onRemove,
  onInsertAfter,
}: BeatCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const words = beatWordCount(beat);
  const canDelete = totalBeats > 1 && beat.text.trim().length === 0;

  // Auto-resize textarea in multi-beat mode so cards expand naturally with content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (totalBeats > 1) {
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, 80)}px`;
    }
  }, [beat.text, totalBeats]);

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChangeText(e.target.value);
  };

  // ---------------------------------------------------------------------------
  // Single Beat View: 100% distraction-free, zero wasted space
  // ---------------------------------------------------------------------------
  if (totalBeats <= 1) {
    return (
      <div
        id={`beat-${index}`}
        data-beat-id={beat.id}
        className="flex min-h-0 flex-1 flex-col h-full w-full"
      >
        <textarea
          ref={textareaRef}
          lang={language.id}
          dir={language.direction}
          style={{ fontFamily: fontStack("Lora"), hyphens: "auto" }}
          value={beat.text}
          onChange={handleTextChange}
          placeholder={
            placeholder ?? `${language.storyGreeting} ${language.samplePhrase}`
          }
          className={cn(
            "h-full w-full resize-none border-0 bg-transparent px-5 py-4 font-serif text-[15px] leading-[1.8] text-ink-800",
            "focus:outline-none focus:ring-0 placeholder:text-ink-300",
            "sm:px-8 sm:py-5 sm:text-[16px]",
          )}
          aria-label="Story text"
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Multi-Beat View: Structured, clear card with rename and delete-when-empty
  // ---------------------------------------------------------------------------
  return (
    <div
      id={`beat-${index}`}
      data-beat-id={beat.id}
      className={cn(
        "group relative flex flex-col rounded-2xl border transition-all duration-200",
        isHighlighted
          ? "border-brand-400 bg-brand-50/20 shadow-soft ring-2 ring-brand-300/60"
          : "border-ink-100/90 bg-white shadow-2xs hover:border-ink-200 hover:shadow-xs",
      )}
    >
      {/* Beat Header Bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-100/70 bg-linear-to-r from-ink-50/50 via-white to-white px-3.5 py-2 sm:px-4.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ink-100 text-[11px] font-bold text-ink-600 group-hover:bg-brand-100 group-hover:text-brand-700">
            {index + 1}
          </span>

          <input
            ref={titleInputRef}
            type="text"
            value={beat.title}
            onChange={(e) => onChangeTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                textareaRef.current?.focus();
              }
            }}
            placeholder={defaultBeatLabel(index)}
            aria-label={`Title for Beat ${index + 1}`}
            className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-xs font-semibold text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-0 focus:text-ink-900"
          />
        </div>

        {/* Header Right Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {words > 0 && (
            <span className="text-[10.5px] tabular-nums font-medium text-ink-400">
              {words} word{words === 1 ? "" : "s"}
            </span>
          )}

          {/* Remove Beat - Only enabled when empty */}
          {canDelete ? (
            <button
              type="button"
              onClick={onRemove}
              title="Remove empty beat"
              aria-label={`Remove empty Beat ${index + 1}`}
              className="inline-flex size-6.5 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-700 active:scale-95"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : totalBeats > 1 && beat.text.trim().length > 0 ? (
            <span
              title="Clear beat text first to remove"
              className="inline-flex size-6.5 items-center justify-center rounded-lg text-ink-200 cursor-not-allowed select-none"
            >
              <Trash2 className="size-3.5" />
            </span>
          ) : null}
        </div>
      </div>

      {/* Beat Prose Body */}
      <div className="px-3.5 py-3 sm:px-5 sm:py-4">
        <textarea
          ref={textareaRef}
          lang={language.id}
          dir={language.direction}
          style={{ fontFamily: fontStack("Lora"), hyphens: "auto" }}
          value={beat.text}
          onChange={handleTextChange}
          placeholder={`Write what happens in ${beat.title.trim() || defaultBeatLabel(index)}…`}
          className={cn(
            "w-full resize-none border-0 bg-transparent p-0 font-serif text-[15px] leading-[1.8] text-ink-800",
            "focus:outline-none focus:ring-0 placeholder:text-ink-300",
            "sm:text-[16px]",
          )}
          aria-label={`Story text for ${beat.title.trim() || defaultBeatLabel(index)}`}
        />
      </div>

      {/* Between-beat inline split button (visible on hover) */}
      <div className="relative -mb-3 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          type="button"
          onClick={onInsertAfter}
          title="Insert beat here"
          className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-0.5 text-[10.5px] font-medium text-ink-600 shadow-2xs transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        >
          <Plus className="size-3 text-brand-600" />
          <span>Add beat here</span>
        </button>
      </div>
    </div>
  );
}
