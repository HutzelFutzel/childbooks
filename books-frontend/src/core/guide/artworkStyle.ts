/**
 * When a drawing is the book's style, and what happens when the reader takes
 * another style instead.
 *
 * A book has one look. It either comes from a preset or from the first
 * drawing the reader gave (`origin: "derived"`). Those are two modes of the
 * same setting, so leaving the second one is a single change: the preset
 * becomes the look and the drawings stop being a source of it, together. Half
 * of that (a preset with a drawing still on the plate) is the state that used
 * to break portraits, so nothing here does only half.
 *
 * What was taken off is kept in `authoring.retiredArtwork`, so "keep the old
 * look" puts the drawings back with the style.
 */
import { SOURCE_ART_MAX, type Project, type RetiredArtwork, type SourceArtRef, type StoryCastMember } from "../types";
import { collectSourceArtGroups, derivedArtStyle, derivedStyleSelection, firstStyleArtwork, sameSourceArtName } from "../book/sourceArt";
import type { ArtworkLookDecision } from "./artworkLook";
import { authoringOf, withAuthoring } from "./projectState";

/** The look comes from a drawing: the book says so and has not been taken back to a preset. */
export function styleIsFromArtwork(project: Project): boolean {
  return project.config.styleReady !== false && derivedArtStyle(project.config.artStyle);
}

/** Whose drawing the book's look was read from, for the words that say so. */
export function styleArtworkName(project: Project): string {
  const style = project.config.artStyle;
  const named = style.derivedFromName?.trim() || style.derivedFromNames?.find((name) => name.trim())?.trim();
  if (named) return named;
  const first = firstStyleArtwork(project, collectSourceArtGroups(project));
  return first?.name?.trim() && first.name !== "Art" ? first.name.trim() : "";
}

/**
 * What a drawing given to one person does to the book's look:
 * `sets` it (the book has no drawing look yet, or this person's drawing is the one it came from), or
 * `follows` it (an earlier drawing already set it; this one is drawn in that look).
 */
export type ArtworkStyleRole =
  | { kind: "sets"; replaces: string | null }
  | { kind: "follows"; name: string };

export function artworkStyleRole(project: Project, member: Pick<StoryCastMember, "name">): ArtworkStyleRole {
  if (!styleIsFromArtwork(project)) {
    const presetId = project.config.styleReady !== false ? project.config.artStyle.presetId : null;
    return { kind: "sets", replaces: presetId };
  }
  const style = project.config.artStyle;
  const names = style.derivedFromNames?.length ? style.derivedFromNames : style.derivedFromName ? [style.derivedFromName] : [];
  if (names.some((name) => member.name.trim() && sameSourceArtName(name, member.name))) {
    return { kind: "sets", replaces: null };
  }
  return { kind: "follows", name: styleArtworkName(project) };
}

function withoutArt<T extends { sourceArt?: SourceArtRef[]; lookFromArt?: string }>(record: T): T {
  const { sourceArt: _art, lookFromArt: _look, ...rest } = record;
  void _art;
  void _look;
  return rest as T;
}

/** Names of the people whose drawings the book's look rests on. */
export function artworkNames(project: Project): string[] {
  return collectSourceArtGroups(project)
    .filter((group) => group.name !== "Art")
    .map((group) => group.name.trim())
    .filter(Boolean);
}

/**
 * The book without its drawings as a source: the people keep the description
 * that was read from them and are drawn from it, every drawing leaves the
 * plates, the sheets and the staging area. Portraits drawn from a drawing no
 * longer match (their source changed) and show as out of date.
 */
export function retireArtwork(project: Project): Project {
  const cast = project.config.storyBrief?.cast ?? [];
  const retiredCast: RetiredArtwork["cast"] = [];
  const nextCast = cast.map((member) => {
    if (!member.sourceArt?.length && member.lookSource !== "drawing") return member;
    if (member.sourceArt?.length) {
      retiredCast.push({
        id: member.id,
        sourceArt: member.sourceArt.slice(0, SOURCE_ART_MAX),
        ...(member.lookSource ? { lookSource: member.lookSource } : {}),
        ...(member.lookFromArt ? { lookFromArt: member.lookFromArt } : {}),
      });
    }
    const read = member.lookFromArt?.trim();
    const appearance = member.appearance?.trim() || read || "";
    const kept = withoutArt(member);
    const fromDrawing = member.lookSource === "drawing" || !member.lookSource;
    return {
      ...kept,
      ...(appearance && !member.appearance?.trim() ? { appearance, appearanceFromStory: false } : {}),
      lookSource: fromDrawing ? (appearance ? ("describe" as const) : ("invent" as const)) : member.lookSource,
    };
  });

  const retiredAnchors: RetiredArtwork["anchors"] = [];
  const anchors = project.anchors?.map((anchor) => {
    if (anchor.type !== "character" || !anchor.sourceArt?.length) return anchor;
    retiredAnchors.push({
      id: anchor.id,
      sourceArt: anchor.sourceArt.slice(0, SOURCE_ART_MAX),
      ...(anchor.lookFromArt ? { lookFromArt: anchor.lookFromArt } : {}),
    });
    return withoutArt(anchor);
  });

  const staged = project.authoringState?.styleSourceArt;
  const snapshot = snapshotOf(retiredCast, retiredAnchors, staged);
  const base: Project = {
    ...project,
    config: {
      ...project.config,
      ...(project.config.storyBrief
        ? { storyBrief: { ...project.config.storyBrief, cast: nextCast } }
        : {}),
    },
    ...(anchors ? { anchors } : {}),
  };
  return withAuthoring(base, {
    styleSourceArt: undefined,
    styleSourceOnly: undefined,
    retiredArtwork: snapshot ?? undefined,
  });
}

function snapshotOf(
  cast: RetiredArtwork["cast"],
  anchors: RetiredArtwork["anchors"],
  staged: SourceArtRef[] | undefined,
): RetiredArtwork | null {
  if (cast.length === 0 && anchors.length === 0 && !staged?.length) return null;
  return { cast, anchors, ...(staged?.length ? { staged } : {}) };
}

/** Put retired drawings back on the plates they came off. Nothing to put back leaves the book as it is. */
export function restoreArtwork(project: Project): Project {
  const retired = authoringOf(project).retiredArtwork;
  if (!retired) return project;
  const byCast = new Map(retired.cast.map((row) => [row.id, row]));
  const byAnchor = new Map(retired.anchors.map((row) => [row.id, row]));
  const cast = project.config.storyBrief?.cast;
  const restored: Project = {
    ...project,
    config: {
      ...project.config,
      ...(cast && project.config.storyBrief
        ? {
            storyBrief: {
              ...project.config.storyBrief,
              cast: cast.map((member) => {
                const row = byCast.get(member.id);
                if (!row) return member;
                const { likenessPhoto: _photo, moreLikenessPhotos: _more, ...rest } = member;
                void _photo;
                void _more;
                return {
                  ...rest,
                  sourceArt: row.sourceArt,
                  lookSource: row.lookSource ?? "drawing",
                  ...(row.lookFromArt ? { lookFromArt: row.lookFromArt } : {}),
                };
              }),
            },
          }
        : {}),
    },
    anchors: project.anchors?.map((anchor) => {
      const row = byAnchor.get(anchor.id);
      return row
        ? { ...anchor, sourceArt: row.sourceArt, ...(row.lookFromArt ? { lookFromArt: row.lookFromArt } : {}) }
        : anchor;
    }),
  };
  return withAuthoring(restored, {
    ...(retired.staged ? { styleSourceArt: retired.staged } : {}),
    retiredArtwork: undefined,
  });
}

/**
 * Drawings that do not share a look still give the book one look: the first
 * drawing's. That is the same drawing the server saves the look from and the one
 * the Style tab names, so the rule is one thing, not three.
 */
export function settleOnFirstArtwork(project: Project, decision: ArtworkLookDecision): ArtworkLookDecision {
  if (decision.status !== "conflict") return decision;
  const first = firstStyleArtwork(project);
  const matched = first?.name
    ? decision.options.find((option) => sameSourceArtName(option.name, first.name!))
    : undefined;
  const pick = matched ?? decision.options[0];
  if (!pick || !pick.stylePrompt.trim()) return { status: "failed", message: "We couldn’t read a look from the uploaded artwork." };
  const referenceArt = matched && first ? [first.ref] : pick.referenceArt ?? (first ? [first.ref] : []);
  return {
    status: "resolved",
    style: derivedStyleSelection({
      stylePrompt: pick.stylePrompt,
      derivedFromNames: [pick.name],
      referenceArt,
      customStyle: pick.customStyle,
    }),
  };
}

