"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import type { StoryCastMember } from "../../../core/types";
import { newCastMember } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { LikenessPhotoField } from "../../components/LikenessPhotoField";
import { cn } from "../../lib/cn";
import type { StoryHistoryOptions } from "./storyUndo";
import { useProjectsStore } from "../../../state/projectsStore";
import {
  bindLikenessPhoto,
  deleteLikenessPhoto,
} from "../../../platform/likeness";
import { normalizeAnchorName } from "../../../core/book/anchorRefs";
import { AGE_RANGES } from "../../../core/config/options";

/**
 * The real people in the book.
 * Optimized with space-awareness so it fits comfortably in narrow sidebars and responsive viewports.
 */
export function CastEditor({
  cast,
  onChange,
  variant = "cast",
}: {
  cast: StoryCastMember[];
  onChange: (cast: StoryCastMember[], options?: StoryHistoryOptions) => void;
  variant?: "cast" | "heroes";
}) {
  const emptyMember = useRef<StoryCastMember | null>(null);
  if (!emptyMember.current) emptyMember.current = newCastMember();
  const rows = cast.length > 0 ? cast : [emptyMember.current];
  const [openAppearance, setOpenAppearance] = useState<Set<string>>(new Set());
  const allHeroes = variant === "heroes";
  const projectId = useProjectsStore((state) => state.current()?.id);
  const projectAgeRangeId = useProjectsStore((state) => state.current()?.config.ageRangeId);
  const defaultAge = (() => {
    if (!projectAgeRangeId) return 6;
    const range = AGE_RANGES.find((r) => r.id === projectAgeRangeId);
    return range ? Math.round((range.min + range.max) / 2) : 6;
  })();

  const patch = (
    id: string,
    next: Partial<StoryCastMember>,
    options?: StoryHistoryOptions,
  ) =>
    onChange(
      rows.map((c) => (c.id === id ? { ...c, ...next } : c)),
      options ?? { coalesce: `story-cast:${id}:${Object.keys(next)[0] ?? "field"}` },
    );

  const syncPhotoToAnalyzedCharacter = (
    member: StoryCastMember,
    likenessPhoto: StoryCastMember["likenessPhoto"],
  ) => {
    const previousCreatedAt = member.likenessPhoto?.createdAt;
    const memberName = normalizeAnchorName(member.name);
    const anchors = useProjectsStore.getState().current()?.anchors ?? [];
    const hasMatch = anchors.some((anchor) => {
      if (anchor.type !== "character" || anchor.versions) return false;
      return (
        Boolean(
          previousCreatedAt &&
            anchor.likenessPhoto?.createdAt === previousCreatedAt,
        ) ||
        (!anchor.likenessPhoto &&
          memberName.length > 0 &&
          normalizeAnchorName(anchor.name) === memberName)
      );
    });
    if (!hasMatch) return;
    let boundAnchorId: string | undefined;
    void useProjectsStore.getState().patchCurrent((project) => {
      let applied = false;
      return {
        ...project,
        anchors: project.anchors?.map((anchor) => {
          if (applied) return anchor;
          if (anchor.type !== "character" || anchor.versions) return anchor;
          const samePhoto =
            previousCreatedAt &&
            anchor.likenessPhoto?.createdAt === previousCreatedAt;
          const sameUnclaimedName =
            !anchor.likenessPhoto &&
            memberName.length > 0 &&
            normalizeAnchorName(anchor.name) === memberName;
          if (!samePhoto && !sameUnclaimedName) return anchor;
          applied = true;
          boundAnchorId = anchor.id;
          return { ...anchor, likenessPhoto };
        }),
      };
    }).then(() => {
      if (projectId && likenessPhoto && boundAnchorId) {
        void bindLikenessPhoto({
          projectId,
          fromSubjectId: member.id,
          toSubjectId: boundAnchorId,
          createdAt: likenessPhoto.createdAt,
        }).catch(() => {});
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-1 px-0.5">
        <span className="text-sm font-medium text-ink-700">
          {allHeroes ? "Main characters" : "Who is in the story?"}
        </span>
        <span className="text-xs text-ink-400">
          {allHeroes ? "Add siblings together" : "First person is the hero"}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((member, i) => {
          const hasName = Boolean(member.name.trim());
          const hasAge = member.age !== undefined;
          const needsAge = hasName && !hasAge;
          const appearanceVisible =
            Boolean(member.note?.trim()) ||
            Boolean(member.likenessPhoto) ||
            openAppearance.has(member.id);
          return (
            <div
              key={member.id}
              className={cn(
                "rounded-xl bg-white p-3 ring-1 ring-ink-200 shadow-2xs transition focus-within:ring-brand-300",
                needsAge && "ring-amber-200/80",
              )}
            >
              <div className="flex items-end gap-2">
                <span
                  className={cn(
                    "mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                    allHeroes || i === 0
                      ? "bg-brand-100 text-brand-700"
                      : "bg-ink-100 text-ink-500",
                  )}
                  title={allHeroes || i === 0 ? "Main hero" : `Person ${i + 1}`}
                  aria-hidden
                >
                  {allHeroes || i === 0 ? (
                    <Sparkles className="size-4" />
                  ) : (
                    <UserRound className="size-4" />
                  )}
                </span>

                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-xs font-medium text-ink-500">Name</span>
                  <Input
                    value={member.name}
                    onChange={(e) => patch(member.id, { name: e.target.value })}
                    placeholder={i === 0 ? "e.g. Mila" : "Name"}
                    maxLength={40}
                    className="h-9 min-w-0 text-sm"
                  />
                </label>

                <label className="w-20 shrink-0">
                  <span className="mb-1 flex items-center justify-between text-xs font-medium text-ink-500">
                    <span>Age</span>
                    {needsAge && (
                      <span className="text-[10px] font-semibold text-amber-600">Needed</span>
                    )}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={member.age ?? ""}
                    onChange={(e) =>
                      patch(member.id, {
                        age: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder={needsAge ? String(defaultAge) : "Age"}
                    aria-label={`Age of ${member.name || `person ${i + 1}`}`}
                    className={cn(
                      "h-9 px-2 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                      needsAge && "border-amber-300 bg-amber-50/25 ring-1 ring-amber-200/60 placeholder:text-amber-400 focus:border-brand-400 focus:ring-brand-400",
                    )}
                  />
                </label>

                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (member.likenessPhoto) {
                        if (projectId) {
                          void deleteLikenessPhoto({
                            projectId,
                            subjectId: member.id,
                            createdAt: member.likenessPhoto.createdAt,
                          }).catch(() => {});
                        }
                        syncPhotoToAnalyzedCharacter(member, undefined);
                      }
                      onChange(
                        rows.filter((c) => c.id !== member.id),
                        member.likenessPhoto ? { skipHistory: true } : undefined,
                      );
                    }}
                    title="Remove person"
                    aria-label={`Remove ${member.name || `person ${i + 1}`}`}
                    className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              {needsAge && (
                <div className="mt-2 flex items-center justify-between gap-2 pl-11 text-xs">
                  <span className="text-[11px] font-medium text-amber-700">
                    Add {member.name.trim()}’s age for story reading level
                  </span>
                  <button
                    type="button"
                    onClick={() => patch(member.id, { age: defaultAge })}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100 hover:text-brand-800"
                  >
                    <span>Use age {defaultAge}</span>
                  </button>
                </div>
              )}

              {!allHeroes && (
                <label className="mt-2 block pl-11">
                  <span className="sr-only">Who they are</span>
                  <Input
                    value={member.role ?? ""}
                    onChange={(e) => patch(member.id, { role: e.target.value })}
                    placeholder={
                      i === 0
                        ? "Who they are (e.g. the birthday girl)"
                        : "Who they are (e.g. twin brother, pet dog)"
                    }
                    maxLength={80}
                    aria-label={`Who ${member.name || `person ${i + 1}`} is`}
                    className="h-9 border-ink-100 bg-ink-50/50 text-sm placeholder:text-ink-400"
                  />
                </label>
              )}

              <div className="mt-2 pl-11">
                {appearanceVisible ? (
                  <div className="space-y-2.5">
                    {projectId && (
                      <LikenessPhotoField
                        photo={member.likenessPhoto}
                        projectId={projectId}
                        subjectId={member.id}
                        subjectName={member.name.trim() || `person ${i + 1}`}
                        onChange={(likenessPhoto) => {
                          patch(member.id, { likenessPhoto }, { skipHistory: true });
                          syncPhotoToAnalyzedCharacter(member, likenessPhoto);
                        }}
                      />
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-ink-500">
                        Appearance details <span className="font-normal text-ink-400">(optional)</span>
                      </span>
                      <Input
                        value={member.note ?? ""}
                        onChange={(event) => patch(member.id, { note: event.target.value })}
                        placeholder="e.g. brown curly hair, green eyes, red glasses"
                        maxLength={500}
                        className="h-9 text-sm"
                      />
                    </label>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenAppearance((current) => new Set(current).add(member.id))
                    }
                    className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-ink-500 transition hover:text-brand-700"
                  >
                    Add appearance or photo
                    <ChevronDown className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Button
        variant="ghost"
        size="sm"
        leftIcon={<Plus className="size-3.5" />}
        className="text-xs h-8"
        onClick={() => onChange([...rows, newCastMember()])}
      >
        {allHeroes ? "Add another hero" : "Add someone"}
      </Button>
    </div>
  );
}
