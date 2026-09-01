"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Feather, Loader2, Plus, Scissors, Sparkles, Wand2 } from "lucide-react";
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
import { useStudio } from "../StudioContext";
import type { StoryHistoryOptions } from "./storyUndo";

/** Schema requires ~a sentence; surface readiness in words, not cryptic chars. */
const READY_CHARS = 20;

function uid(): string {
  return `b_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export interface StoryManuscriptProps {
  storyText: string;
  onChange: (text: string, options?: StoryHistoryOptions) => void;
  placeholder?: string;
  className?: string;
  headerAction?: React.ReactNode;
  reviewing?: boolean;
  reviewContent?: React.ReactNode;
  reviewFooter?: React.ReactNode;
  writing?: boolean;
  translating?: boolean;
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
  writing = false,
  translating = false,
}: StoryManuscriptProps) {
  const current = useProjectsStore((s) => s.current());
  const { updateStory, endStoryHistoryGesture } = useStudio();
  const language = getBookLanguage(current?.config.contentLocale);
  const [title, setTitle] = useState(current?.title ?? "");

  // Internal beats state
  const [beats, setBeats] = useState<StoryBeatItem[]>(() => parseStoryBeats(storyText));
  const [activeBeatIndex, setActiveBeatIndex] = useState(0);
  const [highlightedBeatId, setHighlightedBeatId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastSerializedRef = useRef(storyText);

  // Sync external storyText changes (AI generation, translation, undo/redo) & migrate legacy "Beat" headings
  useEffect(() => {
    const parsed = parseStoryBeats(storyText);
    const normalizedSerialized = serializeStoryBeats(parsed);

    if (storyText !== lastSerializedRef.current) {
      lastSerializedRef.current = normalizedSerialized;
      setBeats(parsed);
      if (normalizedSerialized !== storyText && storyText.length > 0) {
        onChange(normalizedSerialized);
      }
    } else if (normalizedSerialized !== storyText && storyText.length > 0) {
      lastSerializedRef.current = normalizedSerialized;
      setBeats(parsed);
      onChange(normalizedSerialized);
    }
  }, [storyText, onChange]);

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
  const busy = writing || translating;
  const busyLabel = translating ? "Translating story…" : "Writing story…";

  // Helper to commit beats state and notify parent
  const commitBeats = useCallback(
    (nextBeats: StoryBeatItem[], options?: StoryHistoryOptions) => {
      setBeats(nextBeats);
      const nextSerialized = serializeStoryBeats(nextBeats);
      lastSerializedRef.current = nextSerialized;
      onChange(nextSerialized, options);
    },
    [onChange],
  );

  const handleTitleChange = (index: number, nextTitle: string) => {
    const next = beats.map((b, i) => (i === index ? { ...b, title: nextTitle } : b));
    commitBeats(next, { coalesce: `beat-title:${beats[index]?.id ?? index}` });
  };

  const handleTextChange = (index: number, nextText: string) => {
    const next = beats.map((b, i) => (i === index ? { ...b, text: nextText } : b));
    commitBeats(next, { coalesce: `beat-text:${beats[index]?.id ?? index}` });
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

  const handleSplitBeat = (index: number, splitPosition?: number) => {
    const target = beats[index];
    if (!target) return;

    const fullText = target.text;
    const pos =
      splitPosition != null
        ? Math.max(0, Math.min(splitPosition, fullText.length))
        : Math.floor(fullText.length / 2);

    const beforeText = fullText.slice(0, pos).trimEnd();
    const afterText = fullText.slice(pos).trimStart();

    const currentUpdated: StoryBeatItem = {
      ...target,
      text: beforeText,
    };

    const newBeat: StoryBeatItem = {
      id: uid(),
      title: "",
      text: afterText,
    };

    const next = [...beats];
    next.splice(index, 1, currentUpdated, newBeat);
    commitBeats(next);

    const nextActiveIndex = index + 1;
    setActiveBeatIndex(nextActiveIndex);
    setHighlightedBeatId(newBeat.id);

    // Smooth scroll and focus the newly created beat
    setTimeout(() => {
      const el = document.getElementById(`beat-${nextActiveIndex}`);
      if (el && scrollContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const textarea = el.querySelector("textarea") as HTMLTextAreaElement | null;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(0, 0);
        }
      }
    }, 60);

    setTimeout(() => {
      setHighlightedBeatId(null);
    }, 900);
  };

  const handleMergeWithNextBeat = (index: number) => {
    if (index >= beats.length - 1) return;

    const currentBeat = beats[index];
    const nextBeat = beats[index + 1];
    if (!currentBeat || !nextBeat) return;

    const currentText = currentBeat.text.trim();
    const nextText = nextBeat.text.trim();
    const mergedText =
      currentText && nextText
        ? `${currentText}\n\n${nextText}`
        : currentText || nextText;
    const mergedTitle = currentBeat.title.trim() || nextBeat.title.trim();

    const mergedBeat: StoryBeatItem = {
      ...currentBeat,
      title: mergedTitle,
      text: mergedText,
    };

    const next = [...beats];
    next.splice(index, 2, mergedBeat);
    commitBeats(next);

    setActiveBeatIndex(index);
    setHighlightedBeatId(mergedBeat.id);

    setTimeout(() => {
      const el = document.getElementById(`beat-${index}`);
      if (el && scrollContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const textarea = el.querySelector("textarea") as HTMLTextAreaElement | null;
        textarea?.focus();
      }
    }, 60);

    setTimeout(() => {
      setHighlightedBeatId(null);
    }, 900);
  };

  const handleRemoveBeat = (index: number) => {
    const target = beats[index];
    if (!target || target.text.trim().length > 0 || target.title.trim().length > 0) {
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
              data-native-undo
              lang={language.id}
              dir={language.direction}
              style={{ fontFamily: fontStack("Nunito") }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                endStoryHistoryGesture();
                if (current && title.trim() && title.trim() !== current.title) {
                  void updateStory({ title: title.trim() });
                }
              }}
              readOnly={reviewing || busy}
              placeholder={
                busy
                  ? "Writing story title…"
                  : language.storyGreeting
                  ? `${language.endonym} Story Title…`
                  : "Luna and the Sleepy Moon"
              }
              className="mt-1 w-full border-0 bg-transparent font-display text-xl font-bold tracking-tight text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-0 sm:text-2xl"
            />
          </label>
          <div className="flex items-center gap-2">
            {headerAction}
            {busy && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200">
                <Sparkles className="size-3 animate-spin text-brand-500" />
                {translating ? "Translating…" : "Writing story…"}
              </span>
            )}
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
      <AnimatePresence initial={false}>
        {!reviewing && beats.length >= 2 && (
          <motion.div
            key="beat-navigator"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <BeatNavigator
              beats={beats}
              activeIndex={activeBeatIndex}
              onSelectBeat={handleSelectBeat}
              onAddBeat={() => handleAddBeat()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Internal Scrollable Story Manuscript Body */}
      <div className="relative flex min-h-0 flex-1 flex-col bg-linear-to-b from-white via-white to-ink-50/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-3 left-0 w-1 bg-linear-to-b from-brand-200/0 via-brand-300/60 to-brand-200/0 sm:left-2"
        />

        <div className="flex min-h-0 flex-1 overflow-hidden p-1">
          {reviewing ? (
            <div className="min-h-0 flex-1 overflow-hidden">{reviewContent}</div>
          ) : busy && empty ? (
            <div className="flex h-full min-h-64 flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="relative mb-4 flex items-center justify-center">
                <div className="absolute size-14 rounded-2xl bg-brand-100/50 animate-ping opacity-60" />
                <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 shadow-soft ring-1 ring-brand-200">
                  <Wand2 className="size-5 animate-pulse text-brand-600" />
                </div>
              </div>
              <h3 className="font-display text-base font-bold text-ink-900">
                {translating ? "Translating your story…" : "Writing your story…"}
              </h3>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-500">
                {translating
                  ? "Adapting the words and rhythm for your chosen language."
                  : "Crafting characters, pacing, and words for your child."}
              </p>
              <div className="mt-6 w-full max-w-xs space-y-2.5 opacity-60">
                <div className="h-2.5 w-3/4 mx-auto rounded-full bg-brand-200/60 animate-pulse" />
                <div className="h-2.5 w-full rounded-full bg-brand-200/60 animate-pulse [animation-delay:150ms]" />
                <div className="h-2.5 w-5/6 mx-auto rounded-full bg-brand-200/60 animate-pulse [animation-delay:300ms]" />
              </div>
            </div>
          ) : (
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className={cn(
                "relative h-full w-full overflow-y-auto scroll-smooth",
                beats.length > 1 ? "space-y-4 px-4 py-4 sm:px-7 sm:py-5" : "flex flex-col p-1 sm:p-2",
              )}
            >
              {busy && !empty && (
                <div className="sticky top-2 z-20 mb-3 flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 rounded-full bg-brand-600/90 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lifted backdrop-blur-xs">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>{translating ? "Translating fresh version…" : "Writing fresh version…"}</span>
                  </div>
                </div>
              )}
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
                  onSplitAtCursor={(pos) => handleSplitBeat(index, pos)}
                  onMergeWithNext={
                    index < beats.length - 1
                      ? () => handleMergeWithNextBeat(index)
                      : undefined
                  }
                />
              ))}

              {/* Bottom Add Section button when multiple sections exist */}
              {beats.length > 1 && (
                <div className="pt-2 pb-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => handleAddBeat()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-200 bg-white/80 px-4 py-1.5 text-xs font-semibold text-ink-600 shadow-2xs transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
                  >
                    <Plus className="size-3.5 text-brand-600" />
                    <span>Add next section</span>
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
                    {beats.length} sections
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
                <>
                  <button
                    type="button"
                    onClick={() => handleSplitBeat(0)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-600 transition hover:bg-white hover:text-brand-700"
                    title="Split story at current cursor position"
                  >
                    <Scissors className="size-3 text-brand-600" />
                    <span>Split at cursor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddBeat()}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-600 transition hover:bg-white hover:text-brand-700"
                    title="Add a new section to organize your story"
                  >
                    <Plus className="size-3 text-brand-600" />
                    <span>Add section</span>
                  </button>
                </>
              )}

              <StatusChip
                empty={empty}
                ready={isReady}
                busy={busy}
                busyLabel={busyLabel}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusChip({
  empty,
  ready,
  busy,
  busyLabel,
}: {
  empty: boolean;
  ready: boolean;
  busy?: boolean;
  busyLabel?: string;
}) {
  if (busy) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100">
        <Loader2 className="size-3 animate-spin text-brand-600" />
        {busyLabel ?? "Writing story…"}
      </span>
    );
  }
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
