"use client";

import { useEffect, useRef } from "react";
import { Loader2, RotateCcw, Sparkles, Undo2, Wand2 } from "lucide-react";
import type { AgeBandStoryCraft } from "../../../core/config/storyCraftCatalog";
import type { StoryBrief } from "../../../core/types";
import { namedHeroes } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { useResolvedModels } from "../../hooks/useResolvedModels";
import { HeroNamesInput } from "./HeroNamesInput";
import { OptionChips } from "./OptionChips";
import { HERO_NAME_KEY, useStoryDraft } from "./useStoryDraft";

/**
 * "Write it for me": a name, an optional theme, an optional device — then a
 * complete story. Everything here is one screen on purpose; the whole promise
 * of this mode is that it's over in under a minute.
 */
export function GuidedComposer({
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
  const { writing, undoable, write, undo } = useStoryDraft();
  const prefilled = useRef(false);
  const heroes = namedHeroes(brief);

  // The landing page asks for the child's name before the project exists and
  // parks it for this screen — carry it through so nobody types it twice.
  useEffect(() => {
    if (prefilled.current || heroes.length > 0) return;
    prefilled.current = true;
    try {
      const stored = sessionStorage.getItem(HERO_NAME_KEY);
      if (stored?.trim()) onChange({ heroNames: [stored.trim()] });
    } catch {
      /* private mode — nothing to carry over */
    }
  }, [heroes.length, onChange]);

  const canWrite = Boolean(heroes.length > 0 && models && !writing);

  return (
    <section className="relative overflow-hidden rounded-3xl bg-aurora p-6 shadow-soft ring-1 ring-magic-300/40 sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-magic-300/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -left-8 h-36 w-36 rounded-full bg-brand-200/35 blur-3xl"
      />

      <div className="relative space-y-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-magic-500 text-white shadow-soft">
            <Wand2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-magic-700">
              Write it for me
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
              Start with a little magic
            </h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-ink-500">
              Tell us who the book is for and pick a direction — we&apos;ll write the whole story,
              already pitched at the age you chose.
            </p>
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">
            Who is the book for?
          </span>
          <div className="sm:max-w-96">
            <HeroNamesInput
              names={heroes}
              onChange={(heroNames) => onChange({ heroNames })}
              placeholder="e.g. Mila — press Enter to add another"
            />
          </div>
          <span className="mt-1.5 block text-xs text-ink-400">
            {heroes.length > 1
              ? "They'll be the heroes, together. We'll invent everyone else around them."
              : "Add one name, or a few — press Enter after each. They'll be the hero. We'll invent everyone else around them."}
          </span>
        </label>

        <OptionChips
          label="What's it about?"
          optional
          options={craft.themes}
          selectedId={brief.themeId}
          custom={brief.customTheme}
          onChange={({ id, custom }) =>
            onChange({ themeId: id, ...(custom !== undefined ? { customTheme: custom } : {}) })
          }
          customPlaceholder="e.g. losing a first tooth on holiday"
        />

        <OptionChips
          label="How should it be told?"
          optional
          hint="the storytelling style"
          options={craft.devices}
          selectedId={brief.deviceId}
          custom={brief.customDevice}
          onChange={({ id, custom }) =>
            onChange({ deviceId: id, ...(custom !== undefined ? { customDevice: custom } : {}) })
          }
          customPlaceholder="e.g. told entirely as a bedtime lullaby"
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            disabled={!canWrite && !writing}
            loading={writing}
            variant="magic"
            leftIcon={!writing ? (hasStory ? <RotateCcw className="size-4" /> : <Wand2 className="size-4" />) : undefined}
            onClick={() => void write(brief)}
          >
            {writing ? "Writing your story…" : hasStory ? "Write it again" : "Write my story"}
          </Button>
          {undoable && !writing && (
            <Button variant="ghost" size="sm" leftIcon={<Undo2 className="size-4" />} onClick={undo}>
              Bring back the last one
            </Button>
          )}
          <span className="flex items-center gap-1.5 text-xs text-ink-400">
            {writing ? (
              <>
                <Loader2 className="size-3.5 animate-spin text-magic-500" />
                Spinning a tale — usually a few seconds…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                You can edit every word afterwards.
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
