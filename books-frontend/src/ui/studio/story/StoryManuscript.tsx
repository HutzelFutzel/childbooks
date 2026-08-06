"use client";

import { useEffect, useState } from "react";
import { Check, Feather } from "lucide-react";
import { useProjectsStore } from "../../../state/projectsStore";
import { cn } from "../../lib/cn";

/** Schema requires ~a sentence; surface readiness in words, not cryptic chars. */
const READY_CHARS = 20;

/**
 * The manuscript surface: the book's title and its words. Shared by all three
 * modes — however the story arrived, this is where it is read and edited.
 */
export function StoryManuscript({
  storyText,
  onChange,
  placeholder,
}: {
  storyText: string;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  const current = useProjectsStore((s) => s.current());
  const rename = useProjectsStore((s) => s.renameProject);
  const [title, setTitle] = useState(current?.title ?? "");

  // Track external renames too (e.g. the first draft titling the book) — while
  // typing, the store title only changes on blur, so this won't fight.
  useEffect(() => {
    setTitle(current?.title ?? "");
  }, [current?.id, current?.title]);

  const trimmed = storyText.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const empty = !trimmed;

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-ink-100">
      <div className="border-b border-ink-100/80 bg-linear-to-b from-brand-50/40 to-white px-5 pt-5 sm:px-7 sm:pt-6">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Book title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => current && title.trim() && rename(current.id, title)}
            placeholder="Luna and the Sleepy Moon"
            className="mt-1.5 w-full border-0 bg-transparent font-display text-2xl font-bold tracking-tight text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-0 sm:text-[1.75rem]"
          />
        </label>
      </div>

      <div className="relative bg-linear-to-b from-white to-ink-50/40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-4 left-0 w-1 bg-linear-to-b from-brand-200/0 via-brand-200/70 to-brand-200/0 sm:left-2"
        />
        <textarea
          value={storyText}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            empty
              ? (placeholder ??
                "Once upon a time, in a little house at the edge of the forest…")
              : undefined
          }
          rows={14}
          className={cn(
            "min-h-80 w-full resize-y border-0 bg-transparent px-5 py-5 font-serif text-[15.5px] leading-[1.75] text-ink-800",
            "placeholder:text-ink-300 focus:outline-none focus:ring-0",
            "sm:px-8 sm:py-6 sm:text-base sm:leading-[1.8]",
          )}
          aria-label="Story text"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 bg-ink-50/50 px-5 py-3 sm:px-7">
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <Feather className="size-3.5 text-ink-400" />
          <span className="tabular-nums">
            {words === 0
              ? "No words yet"
              : `${words.toLocaleString()} word${words === 1 ? "" : "s"}`}
          </span>
        </div>
        <StatusChip empty={empty} ready={trimmed.length >= READY_CHARS} />
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
