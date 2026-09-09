"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import type { SourceArtRef, StoryCastMember } from "../../../core/types";
import { newCastMember } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { LikenessPhotoField } from "../../components/LikenessPhotoField";
import { SourceArtField } from "../../components/SourceArtField";
import { cn } from "../../lib/cn";
import type { StoryHistoryOptions } from "./storyUndo";
import { useProjectsStore } from "../../../state/projectsStore";
import {
  bindLikenessPhoto,
  deleteLikenessPhoto,
} from "../../../platform/likeness";
import { normalizeAnchorName } from "../../../core/book/anchorRefs";
import {
  droppedSourceArtIds,
  renameDerivedStyleNames,
  setSourceArtOnNamedCharacters,
} from "../../../core/book/sourceArt";
import { AGE_RANGES } from "../../../core/config/options";
import { refreshArtworkLooks } from "../../../platform/artLook";

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
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const nameAtFocus = useRef<Record<string, string>>({});
  const [openAppearance, setOpenAppearance] = useState<Set<string>>(new Set());
  const [pictureKind, setPictureKind] = useState<Record<string, "photo" | "artwork">>({});
  const allHeroes = variant === "heroes";
  const projectId = useProjectsStore((state) => state.current()?.id);
  const styleLocked = useProjectsStore((state) => state.current()?.config.styleReady === true);
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
      rowsRef.current.map((c) => (c.id === id ? { ...c, ...next } : c)),
      options ?? { coalesce: `story-cast:${id}:${Object.keys(next)[0] ?? "field"}` },
    );

  const commitSourceArt = (member: StoryCastMember, sourceArt: SourceArtRef[] | undefined) => {
    const previous = member.sourceArt;
    const nextArt = sourceArt?.length ? sourceArt : undefined;
    if (!nextArt) {
      setPictureKind((current) => ({ ...current, [member.id]: "artwork" }));
    }
    patch(member.id, { sourceArt: nextArt, likenessPhoto: undefined }, { skipHistory: true });
    const name = member.name.trim();
    void useProjectsStore
      .getState()
      .patchCurrent((project) =>
        name ? setSourceArtOnNamedCharacters(project, name, nextArt) : project,
      )
      .then(() => {
        const dropped = droppedSourceArtIds(previous, nextArt);
        if (dropped.length) void useProjectsStore.getState().gcUnreferencedBlobs(dropped);
        if (nextArt?.length && name) void refreshArtworkLooks().catch(() => {});
      });
  };

  const syncLookToAnalyzedCharacter = (
    member: StoryCastMember,
    look: {
      likenessPhoto?: StoryCastMember["likenessPhoto"];
      sourceArt?: SourceArtRef[];
    },
  ) => {
    const previousCreatedAt = member.likenessPhoto?.createdAt;
    const memberName = normalizeAnchorName(member.name);
    const previousArt = member.sourceArt?.[0]?.blobId;
    const anchors = useProjectsStore.getState().current()?.anchors ?? [];
    const hasMatch = anchors.some((anchor) => {
      if (anchor.type !== "character" || anchor.versions) return false;
      const samePhoto =
        Boolean(
          previousCreatedAt &&
            anchor.likenessPhoto?.createdAt === previousCreatedAt,
        );
      const sameArt =
        Boolean(
          previousArt &&
            anchor.sourceArt?.some((image) => image.blobId === previousArt),
        );
      const sameName =
        memberName.length > 0 &&
        normalizeAnchorName(anchor.name) === memberName;
      return samePhoto || sameArt || sameName;
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
          const sameArt =
            previousArt &&
            anchor.sourceArt?.some((image) => image.blobId === previousArt);
          const sameName =
            memberName.length > 0 &&
            normalizeAnchorName(anchor.name) === memberName;
          if (!samePhoto && !sameArt && !sameName) return anchor;
          applied = true;
          boundAnchorId = anchor.id;
          const next = { ...anchor, ...look };
          if (!look.likenessPhoto) delete next.likenessPhoto;
          if (!look.sourceArt?.length) delete next.sourceArt;
          return next;
        }),
      };
    }).then(() => {
      if (projectId && look.likenessPhoto && boundAnchorId) {
        void bindLikenessPhoto({
          projectId,
          fromSubjectId: member.id,
          toSubjectId: boundAnchorId,
          createdAt: look.likenessPhoto.createdAt,
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
            Boolean(member.sourceArt?.length) ||
            openAppearance.has(member.id) ||
            Boolean(pictureKind[member.id]);
          const kind: "photo" | "artwork" | null = member.likenessPhoto
            ? "photo"
            : member.sourceArt?.length
              ? "artwork"
              : pictureKind[member.id] ?? null;
          const artworkHint = styleLocked
            ? "Keep this character’s design and match it to the book’s style."
            : "Keep this character’s design and use its art style for the book.";
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
                    onFocus={() => {
                      nameAtFocus.current[member.id] = member.name;
                    }}
                    onBlur={() => {
                      const from = nameAtFocus.current[member.id] ?? "";
                      const to = member.name.trim();
                      if (from.trim() && to && from.trim() !== to) {
                        void useProjectsStore.getState().patchCurrent((project) => {
                          const style = renameDerivedStyleNames(project.config.artStyle, from, to);
                          return style
                            ? { ...project, config: { ...project.config, artStyle: style } }
                            : project;
                        });
                      }
                      if (to && member.sourceArt?.length && !member.lookFromArt) {
                        void refreshArtworkLooks().catch(() => {});
                      }
                    }}
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
                      const artToGc = (member.sourceArt ?? []).map((image) => image.blobId);
                      if (member.likenessPhoto) {
                        if (projectId) {
                          void deleteLikenessPhoto({
                            projectId,
                            subjectId: member.id,
                            createdAt: member.likenessPhoto.createdAt,
                          }).catch(() => {});
                        }
                        syncLookToAnalyzedCharacter(member, { likenessPhoto: undefined });
                      }
                      onChange(
                        rowsRef.current.filter((c) => c.id !== member.id),
                        member.likenessPhoto || member.sourceArt?.length
                          ? { skipHistory: true }
                          : undefined,
                      );
                      if (artToGc.length) {
                        void useProjectsStore.getState().gcUnreferencedBlobs(artToGc);
                      }
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
                    {kind === null && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPictureKind((current) => ({ ...current, [member.id]: "photo" }))
                          }
                          className="rounded-xl bg-ink-50/80 px-3 py-2.5 text-left ring-1 ring-ink-100 transition hover:bg-white hover:ring-brand-200"
                        >
                          <span className="block text-xs font-semibold text-ink-800">Use a photo</span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">
                            Turn their likeness into an illustrated character.
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPictureKind((current) => ({ ...current, [member.id]: "artwork" }))
                          }
                          className="rounded-xl bg-ink-50/80 px-3 py-2.5 text-left ring-1 ring-ink-100 transition hover:bg-white hover:ring-brand-200"
                        >
                          <span className="block text-xs font-semibold text-ink-800">
                            Use existing artwork
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">
                            {artworkHint}
                          </span>
                        </button>
                      </div>
                    )}

                    {kind === "photo" && projectId && (
                      <div className="space-y-1.5">
                        <LikenessPhotoField
                          photo={member.likenessPhoto}
                          projectId={projectId}
                          subjectId={member.id}
                          subjectName={member.name.trim() || `person ${i + 1}`}
                          onChange={(likenessPhoto) => {
                            const previous = member.sourceArt;
                            patch(
                              member.id,
                              { likenessPhoto, sourceArt: undefined },
                              { skipHistory: true },
                            );
                            syncLookToAnalyzedCharacter(member, {
                              likenessPhoto,
                              sourceArt: undefined,
                            });
                            const dropped = droppedSourceArtIds(previous, undefined);
                            if (dropped.length) {
                              void useProjectsStore.getState().gcUnreferencedBlobs(dropped);
                            }
                          }}
                        />
                        {!member.likenessPhoto && (
                          <button
                            type="button"
                            onClick={() =>
                              setPictureKind((current) => ({ ...current, [member.id]: "artwork" }))
                            }
                            className="text-[11px] font-medium text-ink-500 transition hover:text-brand-700"
                          >
                            Use artwork instead
                          </button>
                        )}
                      </div>
                    )}

                    {kind === "artwork" && (
                      <div className="space-y-1.5">
                        <SourceArtField
                          images={member.sourceArt ?? []}
                          subjectName={member.name.trim() || `person ${i + 1}`}
                          hint={artworkHint}
                          onChange={(sourceArt) => {
                            if (member.likenessPhoto && projectId) {
                              void deleteLikenessPhoto({
                                projectId,
                                subjectId: member.id,
                                createdAt: member.likenessPhoto.createdAt,
                              }).catch(() => {});
                            }
                            commitSourceArt(member, sourceArt);
                          }}
                        />
                        {!member.sourceArt?.length && (
                          <button
                            type="button"
                            onClick={() =>
                              setPictureKind((current) => ({ ...current, [member.id]: "photo" }))
                            }
                            className="text-[11px] font-medium text-ink-500 transition hover:text-brand-700"
                          >
                            Use a photo instead
                          </button>
                        )}
                      </div>
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
                    Add appearance or picture
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
