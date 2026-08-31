"use client";

import { Loader2, Redo2, RotateCcw, Sparkles, Undo2, Users } from "lucide-react";
import type { AgeBandStoryCraft } from "../../../core/config/storyCraftCatalog";
import type { StoryBrief } from "../../../core/types";
import { briefBlockers, isBriefReady } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input, Textarea } from "../../components/Input";
import { useResolvedModels } from "../../hooks/useResolvedModels";
import { CastEditor } from "./CastEditor";
import { OptionChips } from "./OptionChips";
import { useStoryDraft } from "./useStoryDraft";

/**
 * "Write it together": the reader supplies the facts — who, what, when, where —
 * and the model supplies the storytelling. Laid out as three labelled steps so
 * it reads as a short conversation rather than a form to fill in.
 */
export function CoWriteComposer({
  brief,
  craft,
  hasStory,
  onChange,
}: {
  brief: StoryBrief;
  craft: AgeBandStoryCraft;
  hasStory: boolean;
  onChange: (patch: Partial<StoryBrief>) => void;
}) {
  const models = useResolvedModels();
  const { writing, undoable, redoable, write, undo, redo } = useStoryDraft();

  const ready = isBriefReady(brief);
  const blockers = briefBlockers(brief);
  const canWrite = Boolean(ready && models && !writing);

  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3 rounded-3xl bg-aurora p-5 shadow-soft ring-1 ring-ink-100/80 sm:p-6">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-soft">
          <Users className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
            Write it together
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
            Your people, your moment
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-500">
            Give us the real details and we&apos;ll build the story around them — every name spelled
            your way, every relationship kept straight.
          </p>
        </div>
      </div>

      <Step number={1} title="The cast">
        <CastEditor cast={brief.cast ?? []} onChange={(cast) => onChange({ cast })} />
      </Step>

      <Step number={2} title="What happens">
        <div className="space-y-3.5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">
              The occasion or the moment
            </span>
            <Textarea
              rows={2}
              value={brief.occasion ?? ""}
              onChange={(e) => onChange({ occasion: e.target.value })}
              placeholder="Amanda and Arthur's first sleepover in the treehouse, and Luca is invited too."
              maxLength={1000}
              aria-label="What happens"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">
                When <span className="font-medium normal-case text-ink-400">(optional)</span>
              </span>
              <Input
                value={brief.when ?? ""}
                onChange={(e) => onChange({ when: e.target.value })}
                placeholder="The last warm evening of the summer"
                maxLength={200}
                aria-label="When it happens"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">
                Where <span className="font-medium normal-case text-ink-400">(optional)</span>
              </span>
              <Input
                value={brief.where ?? ""}
                onChange={(e) => onChange({ where: e.target.value })}
                placeholder="Grandad's garden, at the bottom of the hill"
                maxLength={200}
                aria-label="Where it happens"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">
              Anything that must be in it{" "}
              <span className="font-medium normal-case text-ink-400">(optional)</span>
            </span>
            <Input
              value={brief.mustInclude ?? ""}
              onChange={(e) => onChange({ mustInclude: e.target.value })}
              placeholder="Her yellow torch, and the dog that snores"
              maxLength={300}
              aria-label="Anything that must be included"
            />
          </label>
        </div>
      </Step>

      <Step number={3} title="How it's told">
        <div className="space-y-5">
          <OptionChips
            label="Storytelling style"
            optional
            options={craft.devices}
            selectedId={brief.deviceId}
            custom={brief.customDevice}
            onChange={({ id, custom }) =>
              onChange({ deviceId: id, ...(custom !== undefined ? { customDevice: custom } : {}) })
            }
            customPlaceholder="e.g. told as a series of letters between them"
          />
          <OptionChips
            label="A theme to lean into"
            optional
            options={craft.themes}
            selectedId={brief.themeId}
            custom={brief.customTheme}
            onChange={({ id, custom }) =>
              onChange({ themeId: id, ...(custom !== undefined ? { customTheme: custom } : {}) })
            }
            customPlaceholder="e.g. being brave when everyone else is asleep"
          />
        </div>
      </Step>

      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <Button
          disabled={!canWrite && !writing}
          loading={writing}
          variant="magic"
          leftIcon={!writing ? <RotateCcw className="size-4" /> : undefined}
          onClick={() => void write(brief)}
        >
          {writing ? "Writing your story…" : hasStory ? "Write it again" : "Write our story"}
        </Button>
        {undoable && !writing && (
          <Button variant="ghost" size="sm" leftIcon={<Undo2 className="size-4" />} onClick={undo}>
            Bring back the last one
          </Button>
        )}
        {redoable && !writing && (
          <Button variant="ghost" size="sm" leftIcon={<Redo2 className="size-4" />} onClick={redo}>
            Redo
          </Button>
        )}
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          {writing ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-magic-500" />
              Weaving your details into a story…
            </>
          ) : blockers.length > 0 ? (
            blockers[0]
          ) : (
            <>
              <Sparkles className="size-3.5" />
              You can edit every word afterwards.
            </>
          )}
        </span>
      </div>
    </section>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-soft ring-1 ring-ink-100 sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-(--color-brand-foreground)">
          {number}
        </span>
        <h3 className="font-display text-lg font-bold tracking-tight text-ink-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}
