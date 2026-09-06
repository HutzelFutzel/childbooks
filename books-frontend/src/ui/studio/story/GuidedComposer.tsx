"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import type { AgeBandStoryCraft } from "../../../core/config/storyCraftCatalog";
import type { StoryBrief } from "../../../core/types";
import type { BookLanguageId } from "../../../core/config/bookLanguages";
import {
  namedCast,
  namedHeroes,
  newCastMember,
  splitHeroNames,
} from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { useResolvedModels } from "../../hooks/useResolvedModels";
import { cn } from "../../lib/cn";
import { CastEditor } from "./CastEditor";
import { LanguageSelector } from "./LanguageSelector";
import { OptionChips } from "./OptionChips";
import { HERO_NAME_KEY, type UseStoryDraft } from "./useStoryDraft";
import type { StoryHistoryOptions } from "./storyUndo";

/**
 * "Create with AI": a name, an optional theme, an optional device — then a
 * complete story. Optimized with space-awareness for sidebar workbenches.
 */
export function GuidedComposer({
  brief,
  craft,
  hasStory,
  onChange,
  draft,
  contentLocale,
  onLocaleChange,
}: {
  brief: StoryBrief;
  craft: AgeBandStoryCraft;
  hasStory: boolean;
  onChange: (patch: Partial<StoryBrief>, options?: StoryHistoryOptions) => void;
  draft: Pick<UseStoryDraft, "writing" | "write">;
  contentLocale?: BookLanguageId;
  onLocaleChange?: (locale: BookLanguageId) => void;
}) {
  const models = useResolvedModels();
  const { writing, write } = draft;
  const prefilled = useRef(false);
  const people = brief.cast ?? [];
  const heroes = namedCast(brief);
  const hasAdvancedPreferences = Boolean(
    brief.themeId ||
      brief.deviceId ||
      brief.deviceIds?.length ||
      brief.customDevice?.trim(),
  );
  const [moreOpen, setMoreOpen] = useState(hasAdvancedPreferences);

  // Carry the landing-page name into the richer identity row. This also
  // migrates older guided briefs that stored names without age/details.
  useEffect(() => {
    if (prefilled.current || people.length > 0) return;
    prefilled.current = true;
    let names = namedHeroes(brief);
    try {
      if (names.length === 0) {
        const stored = sessionStorage.getItem(HERO_NAME_KEY);
        if (stored?.trim()) names = splitHeroNames(stored.trim());
      }
    } catch {
      /* private mode */
    }
    if (names.length > 0) {
      onChange({
        heroNames: names,
        cast: names.map((name) => ({
          ...newCastMember(),
          name,
          role: "the hero",
        })),
      });
    }
  }, [brief, onChange, people.length]);

  const canWrite = Boolean(
    heroes.length > 0 &&
      heroes.every((hero) => hero.age !== undefined) &&
      models &&
      !writing,
  );

  const setPeople = (
    cast: NonNullable<StoryBrief["cast"]>,
    options?: StoryHistoryOptions,
  ) => {
    const heroNames = cast.map((person) => person.name.trim()).filter(Boolean);
    onChange({ cast, heroNames }, options);
  };

  const handleWrite = () => {
    if (!canWrite) return;
    void write({
      ...brief,
      cast: people,
      heroNames: heroes.map((hero) => hero.name.trim()),
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

        <CastEditor cast={people} onChange={setPeople} variant="heroes" />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-700">
            What should happen? <span className="font-normal text-ink-400">(optional)</span>
          </span>
          <Input
            value={brief.customTheme ?? ""}
            onChange={(event) =>
              onChange(
                { themeId: null, customTheme: event.target.value },
                { coalesce: "story-guided:customTheme" },
              )
            }
            placeholder="e.g. Mila finds a tiny dragon before bedtime"
            maxLength={500}
            className="h-11 text-sm"
          />
        </label>

        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-ink-500 transition hover:text-brand-700"
        >
          {hasAdvancedPreferences ? "Story preferences" : "Browse ideas and writing styles"}
          <ChevronDown
            className={cn("size-4 transition-transform", moreOpen && "rotate-180")}
          />
        </button>

        {moreOpen && (
          <div className="space-y-5 border-t border-ink-100 pt-4">
            <OptionChips
              label="Story ideas"
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
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-4">
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

          {onLocaleChange && (
            <LanguageSelector
              value={contentLocale}
              onChange={onLocaleChange}
              disabled={writing}
            />
          )}

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
