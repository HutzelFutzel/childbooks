"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, PenLine, RotateCw, Send, TriangleAlert } from "lucide-react";
import type { StoryRevisionWithId } from "../../../platform/storyRevisions";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";

export function StoryRefinePanel({
  revision,
  starting,
  onStart,
  attached = false,
}: {
  revision: StoryRevisionWithId | null;
  starting: boolean;
  onStart: (instruction: string) => Promise<void>;
  attached?: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const shellClass = cn(
    "shrink-0 border border-ink-200 bg-white px-4 py-3",
    attached ? "rounded-t-2xl border-b-0" : "rounded-2xl",
  );

  useEffect(() => {
    if (revision?.status === "error") setInstruction(revision.instruction);
  }, [revision?.id, revision?.status, revision?.instruction]);

  if (revision?.status === "pending" || revision?.status === "running") {
    return (
      <section className={shellClass} aria-live="polite">
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-brand-600" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink-900">Preparing your changes…</h3>
            <p className="truncate text-xs text-ink-500">“{revision.instruction}”</p>
          </div>
        </div>
      </section>
    );
  }

  if (revision?.status === "ready") {
    const decided = Object.keys(revision.decisions ?? {}).length;
    const total = revision.proposal?.changes.length ?? 0;
    return (
      <section className={cn(shellClass, "bg-emerald-50/60")} aria-live="polite">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Review the suggested changes below</h3>
            <p className="text-xs text-emerald-700">{decided} of {total} reviewed</p>
          </div>
        </div>
      </section>
    );
  }

  const failed = revision?.status === "error";
  const submit = async () => {
    const value = instruction.trim();
    if (!value || starting) return;
    try {
      await onStart(value);
      setInstruction("");
    } catch {
      // The hook already surfaces the backend error; keep the request editable.
    }
  };

  return (
    <section className={shellClass}>
      <div className="flex items-center gap-2">
        {failed ? (
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-600" />
        ) : (
          <PenLine aria-hidden className="size-4 shrink-0 text-ink-500" />
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-900">
            {failed ? "Try that change again" : "Change this story with AI"}
          </h3>
          <p className="text-xs text-ink-500">
            {failed
              ? revision.error ?? "Describe the change another way."
              : "Describe one change. You’ll review it before anything is applied."}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-2 rounded-xl bg-ink-50 p-2 ring-1 ring-ink-100 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1" htmlFor="story-refine-instruction">
          <span className="sr-only">Describe a change to this story</span>
          <textarea
            id="story-refine-instruction"
            data-native-undo
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
            }}
            rows={2}
            maxLength={1200}
            placeholder="For example: Make the ending warmer…"
            className="w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-relaxed text-ink-800 outline-none placeholder:text-ink-400 focus:ring-0"
          />
        </label>
        <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
          <span className="text-[11px] text-ink-400">⌘ Enter</span>
          <Button
            size="sm"
            variant="primary"
            loading={starting}
            disabled={!instruction.trim() || starting}
            leftIcon={failed ? <RotateCw className="size-3.5" /> : <Send className="size-3.5" />}
            onClick={() => void submit()}
            className="h-8 text-xs"
          >
            {failed ? "Try again" : "Preview changes"}
          </Button>
        </div>
      </div>
    </section>
  );
}
