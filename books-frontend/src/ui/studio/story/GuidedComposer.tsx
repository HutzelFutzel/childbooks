"use client";

import { useEffect, useRef } from "react";
import { Loader2, Redo2, RotateCcw, Sparkles, Undo2, Wand2 } from "lucide-react";
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
 * complete story. Optimized with space-awareness for sidebar workbenches.
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
  const { writing, undoable, redoable, write, undo, redo } = useStoryDraft();
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
    <section className="relative overflow-hidden rounded-2xl bg-aurora p-4 shadow-soft ring-1 ring-magic-300/40 sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-magic-300/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -left-8 h-36 w-36 rounded-full bg-brand-200/35 blur-3xl"
      />

      <div className="relative space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-magic-500 text-white shadow-soft">
            <Wand2 className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-magic-700">
              Write it for me
            </p>
            <h2 className="font-display text-base font-bold tracking-tight text-ink-900">
              Start with a little magic
            </h2>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Who is the book for?
          </span>
          <div className="w-full">
            <HeroNamesInput
              names={heroes}
              onChange={(heroNames) => onChange({ heroNames })}
              placeholder="e.g. Mila — press Enter to add"
            />
          </div>
          <span className="mt-1 block text-[11px] text-ink-400">
            {heroes.length > 1
              ? "They'll be the heroes, together."
              : "They'll be the hero of the story."}
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
          hint="style"
          options={craft.devices}
          selectedId={brief.deviceId}
          custom={brief.customDevice}
          onChange={({ id, custom }) =>
            onChange({ deviceId: id, ...(custom !== undefined ? { customDevice: custom } : {}) })
          }
          customPlaceholder="e.g. bedtime lullaby rhythm"
        />

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-ink-100/60">
          <Button
            disabled={!canWrite && !writing}
            loading={writing}
            variant="magic"
            size="sm"
            leftIcon={!writing ? (hasStory ? <RotateCcw className="size-3.5" /> : <Wand2 className="size-3.5" />) : undefined}
            onClick={() => void write(brief)}
            className="h-8.5 text-xs shadow-soft"
          >
            {writing ? "Writing your story…" : hasStory ? "Write again" : "Write my story"}
          </Button>

          {undoable && !writing && (
            <Button variant="ghost" size="sm" leftIcon={<Undo2 className="size-3.5" />} onClick={undo} className="h-8.5 text-xs px-2.5">
              Undo
            </Button>
          )}
          {redoable && !writing && (
            <Button variant="ghost" size="sm" leftIcon={<Redo2 className="size-3.5" />} onClick={redo} className="h-8.5 text-xs px-2.5">
              Redo
            </Button>
          )}

          <span className="flex items-center gap-1 text-[11px] text-ink-400">
            {writing ? (
              <>
                <Loader2 className="size-3 animate-spin text-magic-500" />
                A few seconds…
              </>
            ) : (
              <>
                <Sparkles className="size-3 text-magic-500" />
                Edit words anytime
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
