"use client";

import { useEffect, useState, useRef } from "react";
import { Check, Copy, Feather, Sparkles } from "lucide-react";
import { useProjectsStore } from "../../../state/projectsStore";
import { getBookLanguage } from "../../../core/config/bookLanguages";
import { wordCount } from "../../../core/story/brief";
import { fontStack, loadFont } from "../../typography/fonts";
import { cn } from "../../lib/cn";
import { notify } from "../../lib/notify";

/** Schema requires ~a sentence; surface readiness in words, not cryptic chars. */
const READY_CHARS = 20;

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
 * The manuscript surface: the book's title and its words. Shared by all three
 * modes — however the story arrived, this is where it is read and edited.
 * Features an internal scrollable editor that never jumps or stretches the outer screen.
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
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track external renames too (e.g. the first draft titling the book) — while
  // typing, the store title only changes on blur, so this won't fight.
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

  // Approximate read time for bedtime/shared reading (~90 words/min)
  const readMinutes = Math.max(1, Math.ceil(words / 90));

  const handleCopy = async () => {
    if (empty) return;
    try {
      await navigator.clipboard.writeText(
        title ? `${title}\n\n${storyText}` : storyText
      );
      setCopied(true);
      notify.success("Story copied to clipboard", "You can paste it anywhere.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.info("Story text", "Please select and copy manually.");
    }
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink-100 transition",
        className
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-ink-600 shadow-2xs ring-1 ring-ink-200/80">
              <span className="text-xs select-none">{language.flag}</span>
              <span>{language.endonym}</span>
              <span className="text-ink-400 font-mono text-[10px]">
                ({language.regionShort})
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Internal Scrollable Story Text Body */}
      <div className="relative flex min-h-0 flex-1 flex-col bg-linear-to-b from-white via-white to-ink-50/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-3 left-0 w-1 bg-linear-to-b from-brand-200/0 via-brand-300/60 to-brand-200/0 sm:left-2"
        />
        <div className="flex min-h-0 flex-1 overflow-hidden p-1">
          {reviewing ? (
            <div className="min-h-0 flex-1 overflow-hidden">{reviewContent}</div>
          ) : (
            <textarea
              ref={textareaRef}
              lang={language.id}
              dir={language.direction}
              style={{ fontFamily: fontStack("Lora"), hyphens: "auto" }}
              value={storyText}
              onChange={(e) => onChange(e.target.value)}
              placeholder={
                empty
                  ? placeholder ??
                    `${language.storyGreeting} ${language.samplePhrase}`
                  : undefined
              }
              className={cn(
                "h-full w-full resize-none border-0 bg-transparent px-5 py-4 font-serif text-[15px] leading-[1.8] text-ink-800",
                "overflow-y-auto scroll-smooth focus:outline-none focus:ring-0 placeholder:text-ink-300",
                "sm:px-8 sm:py-5 sm:text-[16px]",
              )}
              aria-label="Story text"
            />
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

          {words > 0 && (
            <>
              <span className="text-ink-300">•</span>
              <span className="text-ink-500">
                ~{readMinutes} min read
              </span>
            </>
          )}

          <span className="text-ink-300">•</span>
          <span className="text-ink-400 font-mono text-[11px]">{language.id}</span>
            </div>

            <div className="flex items-center gap-2">
          {!empty && (
            <button
              type="button"
              onClick={handleCopy}
              title="Copy entire story"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-white hover:text-ink-800"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-600" />
                  <span className="text-emerald-700 font-semibold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>Copy</span>
                </>
              )}
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
