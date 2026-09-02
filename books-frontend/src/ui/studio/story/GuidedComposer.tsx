"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import type { AgeBandStoryCraft } from "../../../core/config/storyCraftCatalog";
import type { StoryBrief } from "../../../core/types";
import { namedHeroes, splitHeroNames } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { useResolvedModels } from "../../hooks/useResolvedModels";
import { HeroNamesInput } from "./HeroNamesInput";
import { OptionChips } from "./OptionChips";
import { HERO_NAME_KEY, type UseStoryDraft } from "./useStoryDraft";
import type { StoryHistoryOptions } from "./storyUndo";

/**
 * "Write it for me": a name, an optional theme, an optional device — then a
 * complete story. Optimized with space-awareness for sidebar workbenches.
 */
export function GuidedComposer({
  brief,
  craft,
  hasStory,
  onChange,
  draft,
}: {
  brief: StoryBrief;
  craft: AgeBandStoryCraft;
  hasStory: boolean;
  onChange: (patch: Partial<StoryBrief>, options?: StoryHistoryOptions) => void;
  draft: Pick<UseStoryDraft, "writing" | "write">;
}) {
  const models = useResolvedModels();
  const { writing, write } = draft;
  const prefilled = useRef(false);
  const [draftHeroName, setDraftHeroName] = useState("");
  const heroes = namedHeroes(brief);

  // The landing page asks for the child's name before the project exists and
  // parks it for this screen — carry it through so nobody types it twice.
  useEffect(() => {
    if (prefilled.current || heroes.length > 0) return;
    prefilled.current = true;
    try {
      const stored = sessionStorage.getItem(HERO_NAME_KEY);
      if (stored?.trim()) {
        const parsed = splitHeroNames(stored.trim());
        if (parsed.length > 0) onChange({ heroNames: parsed });
      }
    } catch {
      /* private mode — nothing to carry over */
    }
  }, [heroes.length, onChange]);

  // Effective heroes: either committed chips, or currently typed draft text in the input
  const effectiveHeroes = useMemo(() => {
    if (heroes.length > 0) return heroes;
    const trimmed = draftHeroName.trim();
    return trimmed ? splitHeroNames(trimmed) : [];
  }, [heroes, draftHeroName]);

  const canWrite = Boolean(effectiveHeroes.length > 0 && models && !writing);

  const handleWrite = () => {
    if (effectiveHeroes.length === 0) return;
    if (heroes.length === 0 && draftHeroName.trim()) {
      onChange({ heroNames: effectiveHeroes });
    }
    void write({
      ...brief,
      heroNames: effectiveHeroes,
    });
  };

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
              onDraftChange={setDraftHeroName}
              onChange={(heroNames) => {
                setDraftHeroName("");
                onChange({ heroNames });
              }}
              placeholder="e.g. Mila (or enter names for siblings)"
            />
          </div>
          <span className="mt-1 block text-[11px] text-ink-400">
            {effectiveHeroes.length > 1
              ? `${
                  effectiveHeroes.length === 2
                    ? effectiveHeroes.join(" and ")
                    : `${effectiveHeroes.slice(0, -1).join(", ")} and ${effectiveHeroes[effectiveHeroes.length - 1]}`
                } will be the heroes, together.`
              : effectiveHeroes.length === 1
              ? `${effectiveHeroes[0]} will be the hero of the story.`
              : "They'll be the hero of the story."}
          </span>
        </label>

        <OptionChips
          label="What's it about?"
          optional
          options={craft.themes}
          selectedId={brief.themeId}
          custom={brief.customTheme}
          onChange={({ id, custom }, options) =>
            onChange(
              { themeId: id, ...(custom !== undefined ? { customTheme: custom } : {}) },
              options,
            )
          }
          customPlaceholder="e.g. losing a first tooth on holiday"
        />

        <OptionChips
          label="How should it be told?"
          optional
          hint="style"
          subhint="Pick 1–2 rhythm or storytelling techniques"
          multiple
          maxSelectable={2}
          options={craft.devices}
          selectedId={brief.deviceId}
          selectedIds={brief.deviceIds ?? (brief.deviceId ? [brief.deviceId] : [])}
          custom={brief.customDevice}
          onChange={({ id, ids, custom }, options) =>
            onChange(
              {
                deviceId: id ?? null,
                deviceIds: ids ?? [],
                ...(custom !== undefined ? { customDevice: custom } : {}),
              },
              options,
            )
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
            onClick={handleWrite}
            className="h-8.5 text-xs shadow-soft"
          >
            {writing ? "Writing your story…" : hasStory ? "Write again" : "Write my story"}
          </Button>

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
