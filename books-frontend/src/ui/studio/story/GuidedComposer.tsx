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
    <section className="rounded-xl border border-ink-200 bg-white p-4 sm:p-5">
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Story details</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            Add the essentials and we’ll create a complete draft.
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-700">
            Main character
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
          <span className="mt-1.5 block text-xs text-ink-500">
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

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-4">
          <Button
            disabled={!canWrite && !writing}
            loading={writing}
            variant="primary"
            size="sm"
            leftIcon={!writing ? (hasStory ? <RotateCcw className="size-3.5" /> : <Wand2 className="size-3.5" />) : undefined}
            onClick={handleWrite}
            className="h-9 text-sm"
          >
            {writing
              ? "Writing your story…"
              : hasStory
                ? "Generate a new version"
                : "Write my story"}
          </Button>

          <span className="flex items-center gap-1 text-xs text-ink-500">
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
