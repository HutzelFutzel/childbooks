"use client";

import { useEffect, useRef, type ChangeEvent } from "react";
import { Merge, Plus, Scissors, Trash2 } from "lucide-react";
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
  onSplitAtCursor: (cursorPosition: number) => void;
  onMergeWithNext?: () => void;
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
  onSplitAtCursor,
  onMergeWithNext,
}: BeatCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const words = beatWordCount(beat);
  const canDelete = totalBeats > 1 && isBeatEmpty(beat);

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

  const handleSplit = () => {
    const textarea = textareaRef.current;
    const pos =
      textarea && typeof textarea.selectionStart === "number"
        ? textarea.selectionStart
        : Math.floor(beat.text.length / 2);
    onSplitAtCursor(pos);
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
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
              e.preventDefault();
              handleSplit();
            }
          }}
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
  // Multi-Beat View: Structured, clear card with rename, split, and merge
  // ---------------------------------------------------------------------------
  const isNotLast = index < totalBeats - 1;

  return (
    <div
      id={`beat-${index}`}
      data-beat-id={beat.id}
      className={cn(
        "group relative flex flex-col rounded-2xl border scroll-mt-4 sm:scroll-mt-6 transition-all duration-200",
        isHighlighted
          ? "border-brand-400/90 bg-brand-50/25 shadow-soft ring-2 ring-brand-300/70"
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
            aria-label={`Title for Section ${index + 1}`}
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

          {/* Split at cursor button in card header */}
          {beat.text.trim().length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSplit}
              title="Split this section at cursor"
              aria-label={`Split Section ${index + 1} at cursor`}
              className="inline-flex size-6.5 items-center justify-center rounded-lg text-ink-400 transition hover:bg-brand-50 hover:text-brand-700 active:scale-95"
            >
              <Scissors className="size-3.5" />
            </button>
          )}

          {/* Remove Beat - Only enabled when empty */}
          {canDelete ? (
            <button
              type="button"
              onClick={onRemove}
              title="Remove empty section"
              aria-label={`Remove empty Section ${index + 1}`}
              className="inline-flex size-6.5 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-700 active:scale-95"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : totalBeats > 1 ? (
            <span
              title="Clear section text first to remove"
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
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
              e.preventDefault();
              handleSplit();
            }
          }}
          placeholder={`Write what happens in ${beat.title.trim() || defaultBeatLabel(index)}…`}
          className={cn(
            "w-full resize-none border-0 bg-transparent p-0 font-serif text-[15px] leading-[1.8] text-ink-800",
            "focus:outline-none focus:ring-0 placeholder:text-ink-300",
            "sm:text-[16px]",
          )}
          aria-label={`Story text for ${beat.title.trim() || defaultBeatLabel(index)}`}
        />
      </div>

      {/* Between-section inline floating actions (Add between / Merge with next) - Only for non-last sections */}
      {isNotLast && (
        <div className="absolute left-1/2 -translate-x-1/2 -bottom-3.5 flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-150 transform-gpu group-hover:translate-y-0 translate-y-1 z-20 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onInsertAfter}
            title={`Insert a new section between Section ${index + 1} and Section ${index + 2}`}
            className="inline-flex items-center gap-1 rounded-full border border-ink-200/90 bg-white/95 px-2.5 py-0.5 text-[10.5px] font-medium text-ink-600 shadow-soft backdrop-blur-xs transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 active:scale-95"
          >
            <Plus className="size-3 text-brand-600" />
            <span>Add section</span>
          </button>

          {onMergeWithNext && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onMergeWithNext}
              title={`Merge Section ${index + 1} with Section ${index + 2}`}
              className="inline-flex items-center gap-1 rounded-full border border-ink-200/90 bg-white/95 px-2.5 py-0.5 text-[10.5px] font-medium text-ink-600 shadow-soft backdrop-blur-xs transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 active:scale-95"
            >
              <Merge className="size-3 text-violet-600" />
              <span>Merge with Section {index + 2}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
