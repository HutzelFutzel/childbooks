"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Check, Feather, Plus, Sparkles } from "lucide-react";
import { useProjectsStore } from "../../../state/projectsStore";
import { getBookLanguage } from "../../../core/config/bookLanguages";
import { wordCount } from "../../../core/story/brief";
import {
  parseStoryBeats,
  serializeStoryBeats,
  type StoryBeatItem,
} from "../../../core/story/beats";
import { fontStack, loadFont } from "../../typography/fonts";
import { cn } from "../../lib/cn";
import { BeatNavigator } from "./BeatNavigator";
import { BeatCard } from "./BeatCard";

/** Schema requires ~a sentence; surface readiness in words, not cryptic chars. */
const READY_CHARS = 20;

function uid(): string {
  return `b_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export interface StoryManuscriptProps {
  storyText: string;
  onChange: (text: string) => void;
  placeholder?: string;
  className?: string;
  headerAction?: React.ReactNode;
  reviewing?: boolean;
  reviewContent?: React.ReactNode;
  reviewFooter?: React.ReactNode;
}

/**
 * The manuscript surface: the book's title, its story beats, and its words.
 * Features:
 * - Clean zero-waste layout when there is 0 or 1 beat.
 * - Sleek Beat Navigator pill bar with smooth jumps for multi-beat stories.
 * - Renaming, adding, and safe removal of empty beats.
 * - Never stretches or shifts outer layout.
 */
export function StoryManuscript({
  storyText,
  onChange,
  placeholder,
  className,
  headerAction,
  reviewing = false,
  reviewContent,
  reviewFooter,
}: StoryManuscriptProps) {
  const current = useProjectsStore((s) => s.current());
  const language = getBookLanguage(current?.config.contentLocale);
  const rename = useProjectsStore((s) => s.renameProject);
  const [title, setTitle] = useState(current?.title ?? "");

  // Internal beats state
  const [beats, setBeats] = useState<StoryBeatItem[]>(() => parseStoryBeats(storyText));
  const [activeBeatIndex, setActiveBeatIndex] = useState(0);
  const [highlightedBeatId, setHighlightedBeatId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastSerializedRef = useRef(storyText);

  // Sync external storyText changes (AI generation, translation, undo/redo)
  useEffect(() => {
    if (storyText !== lastSerializedRef.current) {
      lastSerializedRef.current = storyText;
      setBeats((prev) => parseStoryBeats(storyText, prev));
    }
  }, [storyText]);

  // Track title changes from external project updates
  useEffect(() => {
    setTitle(current?.title ?? "");
  }, [current?.id, current?.title]);

  useEffect(() => {
    loadFont("Nunito");
    loadFont("Lora");
  }, []);

  const trimmed = storyText.trim();
  const words = wordCount(trimmed);
  const empty = !trimmed;
  const isReady = trimmed.length >= READY_CHARS;
  const readMinutes = Math.max(1, Math.ceil(words / 90));

  // Helper to commit beats state and notify parent
  const commitBeats = useCallback(
    (nextBeats: StoryBeatItem[]) => {
      setBeats(nextBeats);
      const nextSerialized = serializeStoryBeats(nextBeats);
      lastSerializedRef.current = nextSerialized;
      onChange(nextSerialized);
    },
    [onChange],
  );

  const handleTitleChange = (index: number, nextTitle: string) => {
    const next = beats.map((b, i) => (i === index ? { ...b, title: nextTitle } : b));
    commitBeats(next);
  };

  const handleTextChange = (index: number, nextText: string) => {
    const next = beats.map((b, i) => (i === index ? { ...b, text: nextText } : b));
    commitBeats(next);
  };

  const handleAddBeat = (insertAtIndex?: number) => {
    const targetIndex = insertAtIndex != null ? insertAtIndex : beats.length;
    const newBeat: StoryBeatItem = {
      id: uid(),
      title: "",
      text: "",
    };

    const next = [...beats];
    next.splice(targetIndex, 0, newBeat);
    commitBeats(next);
    setActiveBeatIndex(targetIndex);
    setHighlightedBeatId(newBeat.id);

    // Smoothly scroll to the newly created beat after DOM update
    setTimeout(() => {
      const el = document.getElementById(`beat-${targetIndex}`);
      if (el && scrollContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const inputOrTextarea = el.querySelector("textarea, input") as
          | HTMLTextAreaElement
          | HTMLInputElement
          | null;
        inputOrTextarea?.focus();
      }
    }, 50);

    setTimeout(() => {
      setHighlightedBeatId(null);
    }, 900);
  };

  const handleRemoveBeat = (index: number) => {
    const target = beats[index];
    if (!target || target.text.trim().length > 0) {
      return; // Only allow removing empty beats per specification
    }

    if (beats.length <= 1) {
      commitBeats([{ id: uid(), title: "", text: "" }]);
      return;
    }

    const next = beats.filter((_, i) => i !== index);
    commitBeats(next);
    setActiveBeatIndex((prev) => Math.min(prev, next.length - 1));
  };

  const handleSelectBeat = (index: number) => {
    setActiveBeatIndex(index);
    const targetBeat = beats[index];
    if (targetBeat) {
      setHighlightedBeatId(targetBeat.id);
      setTimeout(() => setHighlightedBeatId(null), 800);
    }

    const el = document.getElementById(`beat-${index}`);
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Scroll spy to update active beat pill as user scrolls through manuscript
  const handleScroll = () => {
    if (!scrollContainerRef.current || beats.length <= 1) return;
    const container = scrollContainerRef.current;
    const containerTop = container.getBoundingClientRect().top;

    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < beats.length; i++) {
      const el = document.getElementById(`beat-${i}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top - containerTop - 20);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
    }

    setActiveBeatIndex(closestIndex);
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink-100 transition",
        className,
      )}
    >
      {/* Title & Language Bar */}
      <div className="shrink-0 border-b border-ink-100/80 bg-linear-to-b from-brand-50/40 via-white to-white px-5 pt-4 pb-3 sm:px-7 sm:pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="block min-w-0 flex-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              Book title
            </span>
            <input
              lang={language.id}
              dir={language.direction}
              style={{ fontFamily: fontStack("Nunito") }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => current && title.trim() && rename(current.id, title)}
              readOnly={reviewing}
              placeholder={
                language.storyGreeting
                  ? `${language.endonym} Story Title…`
                  : "Luna and the Sleepy Moon"
              }
              className="mt-1 w-full border-0 bg-transparent font-display text-xl font-bold tracking-tight text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-0 sm:text-2xl"
            />
          </label>
          <div className="flex items-center gap-2">
            {headerAction}
            {reviewing && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">
                <Sparkles className="size-3" />
                Review mode
              </span>
            )}
            <div
              tabIndex={0}
              role="status"
              aria-label={`Story language: ${language.endonym} (${language.regionShort})`}
              title={`${language.endonym} (${language.regionShort})`}
              className="group/lang inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-1.5 py-0.5 shadow-2xs ring-1 ring-ink-200/80 cursor-default select-none transition-all duration-200 ease-out hover:px-2.5 hover:ring-ink-300 focus:outline-none focus:ring-brand-400 focus:px-2.5"
            >
              <span className="text-sm select-none shrink-0">{language.flag}</span>
              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/lang:max-w-44 group-hover/lang:opacity-100 group-focus/lang:max-w-44 group-focus/lang:opacity-100 text-[11px] font-semibold text-ink-700">
                {language.endonym}
                <span className="ml-1 text-ink-400 font-mono text-[10px]">
                  ({language.regionShort})
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Beat Navigator - Zero waste: only appears when >= 2 beats and not in review mode */}
      {!reviewing && (
        <BeatNavigator
          beats={beats}
          activeIndex={activeBeatIndex}
          onSelectBeat={handleSelectBeat}
          onAddBeat={() => handleAddBeat()}
        />
      )}

      {/* Internal Scrollable Story Manuscript Body */}
      <div className="relative flex min-h-0 flex-1 flex-col bg-linear-to-b from-white via-white to-ink-50/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-3 left-0 w-1 bg-linear-to-b from-brand-200/0 via-brand-300/60 to-brand-200/0 sm:left-2"
        />

        <div className="flex min-h-0 flex-1 overflow-hidden p-1">
          {reviewing ? (
            <div className="min-h-0 flex-1 overflow-hidden">{reviewContent}</div>
          ) : (
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className={cn(
                "h-full w-full overflow-y-auto scroll-smooth",
                beats.length > 1 ? "space-y-4 px-4 py-4 sm:px-7 sm:py-5" : "flex flex-col p-1 sm:p-2",
              )}
            >
              {beats.map((beat, index) => (
                <BeatCard
                  key={beat.id}
                  beat={beat}
                  index={index}
                  totalBeats={beats.length}
                  language={language}
                  placeholder={
                    empty && index === 0
                      ? placeholder ??
                        `${language.storyGreeting} ${language.samplePhrase}`
                      : undefined
                  }
                  isHighlighted={highlightedBeatId === beat.id}
                  onChangeTitle={(nextTitle) => handleTitleChange(index, nextTitle)}
                  onChangeText={(nextText) => handleTextChange(index, nextText)}
                  onRemove={() => handleRemoveBeat(index)}
                  onInsertAfter={() => handleAddBeat(index + 1)}
                />
              ))}

              {/* Bottom Add Beat button when multiple beats exist */}
              {beats.length > 1 && (
                <div className="pt-2 pb-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => handleAddBeat()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-200 bg-white/80 px-4 py-1.5 text-xs font-semibold text-ink-600 shadow-2xs transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
                  >
                    <Plus className="size-3.5 text-brand-600" />
                    <span>Add next beat</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer / Stats Bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 bg-ink-50/60 px-5 py-2.5 sm:px-7">
        {reviewing ? (
          reviewFooter
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
              <div className="flex items-center gap-1.5">
                <Feather className="size-3.5 text-ink-400" />
                <span className="tabular-nums font-semibold text-ink-700">
                  {words === 0
                    ? "No words yet"
                    : `${words.toLocaleString()} word${words === 1 ? "" : "s"}`}
                </span>
              </div>

              {beats.length > 1 && (
                <>
                  <span className="text-ink-300">•</span>
                  <span className="text-ink-600 font-medium">
                    {beats.length} beats
                  </span>
                </>
              )}

              {words > 0 && (
                <>
                  <span className="text-ink-300">•</span>
                  <span className="text-ink-500">
                    ~{readMinutes} min read
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {beats.length <= 1 && !empty && (
                <button
                  type="button"
                  onClick={() => handleAddBeat()}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-600 transition hover:bg-white hover:text-brand-700"
                  title="Add a new beat to divide your story"
                >
                  <Plus className="size-3 text-brand-600" />
                  <span>Add beat</span>
                </button>
              )}

              <StatusChip empty={empty} ready={isReady} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusChip({ empty, ready }: { empty: boolean; ready: boolean }) {
  if (empty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-ink-400 ring-1 ring-ink-100">
        Waiting for your story
      </span>
    );
  }
  if (!ready) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-100">
        A little more — just a sentence or two
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
      <Check className="size-3" strokeWidth={3} />
      Ready to continue
    </span>
  );
}
