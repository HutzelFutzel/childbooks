/**
 * Character artwork (existing drawings) attached to the story cast or Cast
 * anchors. Pure helpers so the studio, analysis merge, GC, and the backend
 * extract/render paths share one definition of "who has drawings".
 */
import {
  SOURCE_ART_MAX,
  type Anchor,
  type ArtStyleSelection,
  type BodyPlan,
  type Project,
  type SourceArtRef,
} from "../types";
import { normalizeAnchorName } from "./anchorRefs";

export { SOURCE_ART_MAX };

/** Cap on characters considered in one style-extract call (matches story-cast max). */
export const SOURCE_ART_GROUP_MAX = 12;

/** Extracted style prompts are short rendering notes, not free-text direction. */
export const DERIVED_STYLE_PROMPT_MAX = 480;

export interface SourceArtGroup {
  /** Cast-member or anchor id — used only as a stable key in the extract UI. */
  id: string;
  name: string;
  images: SourceArtRef[];
}

export function derivedArtStyle(style: ArtStyleSelection | undefined): boolean {
  return style?.origin === "derived";
}

export function sourceArtPreservesRendering(
  style: ArtStyleSelection | undefined,
  name: string,
): boolean {
  if (!derivedArtStyle(style)) return false;
  const names = style?.derivedFromNames?.length
    ? style.derivedFromNames
    : style?.derivedFromName
      ? [style.derivedFromName]
      : [];
  if (names.length === 0) return true;
  const key = normalizeAnchorName(name);
  return names.some((entry) => sameSourceArtName(entry, name) || normalizeAnchorName(entry) === key);
}

export function sameSourceArtName(a: string, b: string): boolean {
  return normalizeAnchorName(a) === normalizeAnchorName(b);
}

function mergeSourceArt(
  primary: SourceArtRef[] | undefined,
  extra: SourceArtRef[] | undefined,
): SourceArtRef[] {
  const out: SourceArtRef[] = [];
  const seen = new Set<string>();
  for (const image of [...(primary ?? []), ...(extra ?? [])]) {
    if (!image.blobId || seen.has(image.blobId)) continue;
    seen.add(image.blobId);
    out.push(image);
    if (out.length >= SOURCE_ART_MAX) break;
  }
  return out;
}

function withSourceArt<T extends { sourceArt?: SourceArtRef[]; likenessPhoto?: unknown; lookFromArt?: string }>(
  record: T,
  images: SourceArtRef[] | undefined,
): T {
  if (images?.length) {
    const { likenessPhoto: _drop, ...rest } = record;
    void _drop;
    return { ...rest, sourceArt: images.slice(0, SOURCE_ART_MAX) } as T;
  }
  const { sourceArt: _dropArt, lookFromArt: _dropLook, ...rest } = record;
  void _dropArt;
  void _dropLook;
  return rest as T;
}

/**
 * Write the same drawings onto the story person and every character of that
 * name, so Story and Cast cannot drift. Non-empty artwork replaces a photo.
 */
export function setSourceArtOnNamedCharacters(
  project: Project,
  name: string,
  sourceArt: SourceArtRef[] | undefined,
): Project {
  const key = normalizeAnchorName(name);
  if (!key) return project;
  const images = sourceArt?.length ? sourceArt.slice(0, SOURCE_ART_MAX) : undefined;
  const storyBrief = project.config.storyBrief;
  return {
    ...project,
    config: {
      ...project.config,
      ...(storyBrief?.cast
        ? {
            storyBrief: {
              ...storyBrief,
              cast: storyBrief.cast.map((member) =>
                normalizeAnchorName(member.name) === key
                  ? withSourceArt(member, images)
                  : member,
              ),
            },
          }
        : {}),
    },
    anchors: project.anchors?.map((anchor) =>
      anchor.type === "character" && normalizeAnchorName(anchor.name) === key
        ? withSourceArt(anchor, images)
        : anchor,
    ),
  };
}

/** Keep derived-style name stamps in sync when a character is renamed. */
export function renameDerivedStyleNames(
  style: ArtStyleSelection | undefined,
  fromName: string,
  toName: string,
): ArtStyleSelection | undefined {
  if (!style || !derivedArtStyle(style)) return style;
  const from = normalizeAnchorName(fromName);
  const to = toName.trim();
  if (!from || !to) return style;
  let changed = false;
  let derivedFromName = style.derivedFromName;
  if (derivedFromName && normalizeAnchorName(derivedFromName) === from) {
    derivedFromName = to;
    changed = true;
  }
  const derivedFromNames = style.derivedFromNames?.map((entry) => {
    if (normalizeAnchorName(entry) !== from) return entry;
    changed = true;
    return to;
  });
  return changed ? { ...style, derivedFromName, derivedFromNames } : style;
}

/** Blob ids of every source-art image on the project (cast + anchors). */
export function collectSourceArtBlobIds(project: Project): string[] {
  const ids: string[] = [];
  for (const member of project.config.storyBrief?.cast ?? []) {
    for (const image of member.sourceArt ?? []) ids.push(image.blobId);
  }
  for (const anchor of project.anchors ?? []) {
    for (const image of anchor.sourceArt ?? []) ids.push(image.blobId);
  }
  return ids;
}

/**
 * One group per named character that has drawings. Story and Cast copies of
 * the same person are merged so extract sees the complete set.
 */
export function collectSourceArtGroups(project: Project): SourceArtGroup[] {
  const byName = new Map<string, SourceArtGroup>();
  const unnamed: SourceArtGroup[] = [];

  const add = (id: string, name: string, images: SourceArtRef[] | undefined) => {
    if (!images?.length) return;
    const key = normalizeAnchorName(name);
    if (!key) {
      unnamed.push({
        id,
        name: name.trim() || "Character",
        images: images.slice(0, SOURCE_ART_MAX),
      });
      return;
    }
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        id,
        name: name.trim() || "Character",
        images: images.slice(0, SOURCE_ART_MAX),
      });
      return;
    }
    existing.images = mergeSourceArt(existing.images, images);
  };

  for (const member of project.config.storyBrief?.cast ?? []) {
    add(member.id, member.name, member.sourceArt);
  }
  for (const anchor of project.anchors ?? []) {
    if (anchor.type !== "character") continue;
    add(anchor.id, anchor.name, anchor.sourceArt);
  }

  return [...byName.values(), ...unnamed].slice(0, SOURCE_ART_GROUP_MAX);
}

export function hasSourceArt(project: Project): boolean {
  return collectSourceArtGroups(project).length > 0;
}

export function clampDerivedStylePrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, DERIVED_STYLE_PROMPT_MAX);
}

export function derivedStyleSelection(args: {
  stylePrompt: string;
  derivedFromName?: string;
  derivedFromNames?: string[];
}): ArtStyleSelection {
  const names = [...new Set((args.derivedFromNames ?? []).map((name) => name.trim()).filter(Boolean))];
  const winner = args.derivedFromName?.trim();
  return {
    presetId: null,
    customDescription: clampDerivedStylePrompt(args.stylePrompt),
    origin: "derived",
    ...(winner ? { derivedFromName: winner } : {}),
    ...(names.length > 0 ? { derivedFromNames: names } : winner ? { derivedFromNames: [winner] } : {}),
  };
}

/** Dropped blob ids when replacing one artwork list with another. */
export function droppedSourceArtIds(
  previous: SourceArtRef[] | undefined,
  next: SourceArtRef[] | undefined,
): string[] {
  const keep = new Set((next ?? []).map((image) => image.blobId));
  return (previous ?? []).map((image) => image.blobId).filter((id) => !keep.has(id));
}

export interface ArtworkLook {
  name: string;
  description: string;
  bodyPlan?: BodyPlan;
}

/**
 * Stamp a look extracted from drawings onto the matching story person and
 * character. Overwrites the analysis description unless the author edited it.
 */
export function applyArtworkLooks(project: Project, looks: ArtworkLook[]): Project {
  if (looks.length === 0) return project;
  const byName = new Map<string, ArtworkLook>();
  for (const look of looks) {
    const key = normalizeAnchorName(look.name);
    if (key) byName.set(key, look);
  }
  if (byName.size === 0) return project;

  const applyMember = <T extends { name: string; lookFromArt?: string; description?: string }>(
    record: T,
  ): T => {
    const look = byName.get(normalizeAnchorName(record.name));
    if (!look) return record;
    return { ...record, lookFromArt: look.description };
  };

  const applyAnchor = (anchor: Anchor): Anchor => {
    if (anchor.type !== "character") return anchor;
    const look = byName.get(normalizeAnchorName(anchor.name));
    if (!look) return anchor;
    return {
      ...anchor,
      lookFromArt: look.description,
      ...(anchor.descriptionUserEdited
        ? {}
        : {
            description: look.description,
            ...(look.bodyPlan ? { bodyPlan: look.bodyPlan } : {}),
          }),
    };
  };

  const storyBrief = project.config.storyBrief;
  return {
    ...project,
    config: {
      ...project.config,
      ...(storyBrief?.cast
        ? {
            storyBrief: {
              ...storyBrief,
              cast: storyBrief.cast.map((member) => applyMember(member)),
            },
          }
        : {}),
    },
    anchors: project.anchors?.map(applyAnchor),
  };
}
