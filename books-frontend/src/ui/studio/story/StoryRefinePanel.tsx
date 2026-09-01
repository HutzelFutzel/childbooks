"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, RotateCw, Send, Sparkles, TriangleAlert } from "lucide-react";
import type { StoryRevisionWithId } from "../../../platform/storyRevisions";
import { Button } from "../../components/Button";

const EXAMPLES = [
  "Make the ending a little warmer",
  "Add a short bedtime stanza",
  "Make it about 50 words longer",
];

export function StoryRefinePanel({
  revision,
  starting,
  onStart,
}: {
  revision: StoryRevisionWithId | null;
  starting: boolean;
  onStart: (instruction: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    if (revision?.status === "error") setInstruction(revision.instruction);
  }, [revision?.id, revision?.status, revision?.instruction]);

  if (revision?.status === "pending" || revision?.status === "running") {
    return (
      <section className="rounded-3xl border border-brand-200 bg-linear-to-br from-brand-50 via-white to-violet-50/60 p-4 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-soft">
            <LoaderCircle className="size-4 animate-spin" />
          </span>
          <div>
            <h3 className="font-display text-sm font-bold text-ink-900">Refining your story…</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">
              “{revision.instruction}”
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (revision?.status === "ready") {
    const decided = Object.keys(revision.decisions ?? {}).length;
    const total = revision.proposal?.changes.length ?? 0;
    return (
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
            <CheckCircle2 className="size-4" />
          </span>
          <div>
            <h3 className="font-display text-sm font-bold text-ink-900">Changes ready to review</h3>
            <p className="mt-2 text-[11px] font-semibold text-emerald-700">
              {decided} of {total} changes reviewed in the manuscript
            </p>
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
    <section className="rounded-3xl border border-brand-200/80 bg-white p-4 shadow-soft ring-1 ring-brand-100/70">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
          {failed ? <TriangleAlert className="size-4 text-amber-600" /> : <Sparkles className="size-4" />}
        </span>
        <div>
          <h3 className="font-display text-sm font-bold text-ink-900">
            {failed ? "That revision didn’t work" : "Refine this story"}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
            {failed
              ? revision.error ?? "Try describing the change another way."
              : "Ask for one focused change. Nothing is applied until you review it."}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-ink-50/80 p-2 ring-1 ring-ink-100">
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
          }}
          rows={3}
          maxLength={1200}
          placeholder="E.g. Add a stanza where they get ready for bed…"
          className="w-full resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ink-800 outline-none placeholder:text-ink-300"
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[10px] text-ink-400">⌘ Enter to send</span>
          <Button
            size="sm"
            variant="magic"
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

      {!failed && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setInstruction(example)}
              className="rounded-full bg-brand-50 px-2.5 py-1 text-[10.5px] font-medium text-brand-700 transition hover:bg-brand-100"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
