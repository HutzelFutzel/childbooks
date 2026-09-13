"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import type { ReadingModeId } from "../../../core/config/readingModes";
import {
  audienceProfileForMonths,
  carryReadingMode,
  enabledAudienceProfiles,
  resolveAudienceProfile,
} from "../../../core/config/audience";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { ChoiceGrid, ChoiceTile } from "../../wizard/ChoiceSet";
import { ReadingModePicker } from "../../wizard/ReadingModePicker";
import { cn } from "../../lib/cn";
import type { BookConfig } from "../../../core/types";
import type { StoryHistoryOptions } from "./storyUndo";

export type AudiencePatch = Pick<
  BookConfig,
  "ageRangeId" | "readingModeId" | "audienceFromCast"
>;

/**
 * Who the book is written for — preselected from the first child's age, always
 * using the live admin bands, and changeable without editing that child.
 */
export function WrittenForPicker({
  ageRangeId,
  readingModeId,
  linked,
  sourceName,
  sourceMonths,
  onChange,
}: {
  ageRangeId: string;
  readingModeId?: ReadingModeId | null;
  linked: boolean;
  sourceName: string;
  sourceMonths?: number;
  onChange: (patch: AudiencePatch, options?: StoryHistoryOptions) => void;
}) {
  const audience = useAppConfigStore((s) => s.audience);
  const ageWriting = useAppConfigStore((s) => s.ageWriting);
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const src = useMemo(
    () => ({ audience, ageWriting, storyCraft }),
    [audience, ageWriting, storyCraft],
  );
  const bands = useMemo(() => enabledAudienceProfiles(src), [src]);
  const profile = useMemo(
    () => resolveAudienceProfile(ageRangeId, src),
    [ageRangeId, src],
  );
  const matched =
    sourceMonths !== undefined ? audienceProfileForMonths(sourceMonths, src) : undefined;
  const enabledIds = useMemo(() => new Set(bands.map((band) => band.id)), [bands]);
  const selectedInPicker = enabledIds.has(profile.id) ? profile.id : null;
  const needsReadingMode = profile.readingModes.length > 0;
  const readingMode = (readingModeId &&
  profile.readingModes.includes(readingModeId as ReadingModeId)
    ? readingModeId
    : profile.readingModes[0] ?? null) as ReadingModeId | null;
  const unmatched = sourceMonths !== undefined && !matched;
  const [open, setOpen] = useState(unmatched || (needsReadingMode && !readingModeId));

  useEffect(() => {
    if (unmatched || (needsReadingMode && !readingModeId)) setOpen(true);
  }, [unmatched, needsReadingMode, readingModeId]);

  const hero = sourceName.trim() || "this character";
  const summary = profile.caption
    ? `${profile.label} · ${profile.caption}`
    : profile.label;

  const selectBand = (id: string) => {
    const next = resolveAudienceProfile(id, src);
    onChange({
      ageRangeId: next.id,
      readingModeId: carryReadingMode(next, readingModeId),
      audienceFromCast: "custom",
    });
  };

  const matchToCharacter = () => {
    if (!matched) return;
    onChange({
      ageRangeId: matched.id,
      readingModeId: carryReadingMode(matched, readingModeId),
      audienceFromCast: "linked",
    });
    setOpen(false);
  };

  return (
    <div className="rounded-xl bg-ink-50/80 p-3 ring-1 ring-ink-200/80">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700 ring-1 ring-ink-200/70">
          <BookOpen className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink-500">Written for</p>
          {unmatched && !selectedInPicker ? (
            <p className="text-sm font-semibold text-ink-900">Choose who this book is for</p>
          ) : (
            <p className="text-sm font-semibold leading-snug text-ink-900">{summary}</p>
          )}
          <p className="mt-0.5 text-[11px] text-ink-500">
            {linked && matched && matched.id === profile.id
              ? `Matched to ${hero}’s age`
              : linked && unmatched
                ? `No band matches ${hero}’s age`
                : "Custom"}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-600 transition hover:bg-white hover:text-brand-700"
        >
          Change
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-ink-200/80 pt-3">
          <ChoiceGrid aria-label="Who is this book for" columns={2}>
            {bands.map((band) => (
              <ChoiceTile
                key={band.id}
                selected={selectedInPicker === band.id}
                onSelect={() => selectBand(band.id)}
                title={band.label}
                caption={band.caption || undefined}
              />
            ))}
          </ChoiceGrid>
          {needsReadingMode && readingMode && (
            <ReadingModePicker
              profile={profile}
              value={readingMode}
              onChange={(mode) =>
                onChange({
                  ageRangeId,
                  readingModeId: mode,
                  audienceFromCast: linked ? "linked" : "custom",
                })
              }
            />
          )}
          {matched && (!linked || matched.id !== profile.id) && (
            <button
              type="button"
              onClick={matchToCharacter}
              className="text-[11px] font-medium text-brand-700 transition hover:text-brand-800"
            >
              Match to {hero}’s age
            </button>
          )}
        </div>
      )}
    </div>
  );
}
