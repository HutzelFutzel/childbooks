/**
 * Portraits: one picture of a character, in the saved style, on that character's plate.
 *
 * A portrait is its own product action (`portrait`), distinct from the internal
 * reference sheets page generation builds. It is quoted and charged only inside
 * the scoped batch that names that person, and a result commits only while the
 * person, their likeness source and the saved style are unchanged — so a render
 * finishing after the reader changed their mind is dropped rather than shown.
 *
 * Shared by the browser (which asks what can be drawn and folds results in) and
 * the worker (which renders the prompt from the same function).
 */
import type { ArtStylesConfig } from "../config/artStyles";
import type { PromptsConfig } from "../config/prompts";
import { renderSinglePrompt } from "../prompts/render";
import { artStyleKey, resolveArtStyleText } from "../prompts/style";
import { briefOf, namedCast } from "../story/brief";
import { CAST_KIND_SPECS, castKindOf } from "../story/castKinds";
import { portraitRelationNote } from "../story/relations";
import type {
  ArtStyleSelection,
  LikenessPhotoRef,
  LookSource,
  PortraitImage,
  PortraitInputs,
  Project,
  SourceArtRef,
  StoryCastMember,
} from "../types";
import { LIKENESS_PHOTOS_MAX, SOURCE_ART_MAX } from "../types";
import { normalizeAnchorName } from "../book/anchorRefs";
import { addVersion, createVersionTree, getCursor } from "../versioning";
import { authoringOf, withAuthoring } from "./projectState";

/** The person's likeness source, with the implicit default made explicit. */
export function lookSourceOf(member: StoryCastMember): LookSource {
  if (member.lookSource === "photo" && !member.likenessPhoto) return "invent";
  if (member.lookSource === "drawing" && !member.sourceArt?.length) return "invent";
  if (member.lookSource === "describe" && !member.appearance?.trim()) return "invent";
  if (member.lookSource) return member.lookSource;
  if (member.likenessPhoto) return "photo";
  if (member.sourceArt?.length) return "drawing";
  if (member.appearance?.trim()) return "describe";
  return "invent";
}

/** Every photo of this person a portrait may use, the first one first. */
export function likenessPhotosOf(member: StoryCastMember): LikenessPhotoRef[] {
  if (!member.likenessPhoto) return [];
  return [member.likenessPhoto, ...(member.moreLikenessPhotos ?? [])].slice(0, LIKENESS_PHOTOS_MAX);
}

/**
 * The images one portrait is drawn from, in the order they are sent: the
 * person's photos, their drawing, then the book's style reference. Shared by
 * the worker (which sends them) and the quote (which prices by their count).
 */
export interface PortraitReferencePlan {
  photos: number;
  subject: SourceArtRef[];
  style: SourceArtRef[];
  /** The book has a style reference at all. */
  hasStyle: boolean;
  /** The person's drawing is also the book's style reference. */
  sharesStyle: boolean;
}

export function portraitReferencePlan(project: Project, member: StoryCastMember): PortraitReferencePlan {
  const source = lookSourceOf(member);
  const subject = source === "drawing" ? (member.sourceArt ?? []).slice(0, 1) : [];
  const subjectIds = new Set(subject.map((art) => art.blobId));
  const all = project.config.artStyle?.referenceArt ?? [];
  return {
    photos: source === "photo" ? likenessPhotosOf(member).length : 0,
    subject,
    style: all.filter((art) => !subjectIds.has(art.blobId)).slice(0, 1),
    hasStyle: all.length > 0,
    sharesStyle: all.some((art) => subjectIds.has(art.blobId)),
  };
}

export function portraitReferenceCount(project: Project, member: StoryCastMember): number {
  const plan = portraitReferencePlan(project, member);
  return plan.photos + plan.subject.length + plan.style.length;
}

/** Everyone who gets a plate: the named cast, in story order. */
export function portraitSubjects(project: Project): StoryCastMember[] {
  return namedCast(briefOf(project.config));
}

export function portraitInputs(project: Project, member: StoryCastMember): PortraitInputs {
  const source = lookSourceOf(member);
  const appearance =
    member.lookFromArt?.trim() || member.appearance?.trim() || "";
  const together = portraitRelationNote(briefOf(project.config), member.id);
  return {
    subjectId: member.id,
    // The name is not here: what someone is called does not change how they look.
    subjectSignature: JSON.stringify({
      age: member.age ?? null,
      months: member.ageMonths ?? null,
      visualAge: member.visualAge ?? null,
      role: member.role?.trim() ?? "",
      ...(member.bodyPlan && member.bodyPlan !== "bipedal" ? { bodyPlan: member.bodyPlan } : {}),
      ...(member.kind && member.kind !== "person" ? { kind: member.kind } : {}),
      ...(member.species?.trim() ? { species: member.species.trim() } : {}),
      ...(together ? { together } : {}),
    }),
    styleKey: artStyleKey(project.config.artStyle),
    sourceKey: JSON.stringify([
      ...(source === "photo"
        ? ["photo", ...likenessPhotosOf(member).map((photo) => photo.createdAt)]
        : source === "drawing"
          ? ["drawing", (member.sourceArt ?? []).map((art) => art.blobId)]
          : source === "describe"
            ? ["describe"]
            : ["invent"]),
      ...(source !== "photo" && appearance ? [{ appearance }] : []),
      ...(member.portraitNote?.trim() ? [{ note: member.portraitNote.trim() }] : []),
    ]),
  };
}

/**
 * Drop the photo receipts a finished portrait was drawn from: the worker has
 * deleted the photos themselves. A photo added while it was drawing stays.
 */
export function withoutUsedPhotos(project: Project, subjectId: string, inputs: PortraitInputs): Project {
  let used: unknown[] = [];
  try {
    used = JSON.parse(inputs.sourceKey) as unknown[];
  } catch {
    return project;
  }
  if (used[0] !== "photo") return project;
  const gone = new Set(used.slice(1).filter((value): value is number => typeof value === "number"));
  const brief = project.config.storyBrief;
  const member = brief?.cast?.find((m) => m.id === subjectId);
  if (!brief?.cast || !member || !likenessPhotosOf(member).some((photo) => gone.has(photo.createdAt))) return project;
  const [first, ...more] = likenessPhotosOf(member).filter((photo) => !gone.has(photo.createdAt));
  const { likenessPhoto: _photo, moreLikenessPhotos: _more, ...rest } = member;
  void _photo;
  void _more;
  const next: StoryCastMember = { ...rest, ...(first ? { likenessPhoto: first } : {}), ...(more.length ? { moreLikenessPhotos: more } : {}) };
  return {
    ...project,
    config: {
      ...project.config,
      storyBrief: { ...brief, cast: brief.cast.map((m) => (m.id === subjectId ? next : m)) },
    },
  };
}

/** The portrait currently shown on a plate, whether or not it is still current. */
export function currentPortrait(project: Project, subjectId: string): PortraitImage | null {
  const tree = authoringOf(project).portraits?.[subjectId];
  return tree ? getCursor(tree).content : null;
}

/**
 * Whether two subject signatures describe the same person to draw. Portraits
 * drawn before the name left the signature carry it: it is ignored, so a
 * rename never leaves a portrait out of date (and old portraits stay current).
 */
function sameSubject(a: string, b: string): boolean {
  if (a === b) return true;
  const withoutName = (signature: string): string => {
    try {
      const { name: _name, ...rest } = JSON.parse(signature) as Record<string, unknown>;
      void _name;
      return JSON.stringify(rest);
    } catch {
      return signature;
    }
  };
  return withoutName(a) === withoutName(b);
}

/**
 * Whether a finished portrait still matches the person and style on the book.
 *
 * A photo that has since been deleted or expired does not make its portrait
 * stale: deleting the source keeps completed work.
 */
export function portraitIsCurrent(project: Project, image: PortraitImage): boolean {
  const member = portraitSubjects(project).find((m) => m.id === image.inputs.subjectId);
  if (!member) return false;
  const now = portraitInputs(project, member);
  if (!sameSubject(now.subjectSignature, image.inputs.subjectSignature)) return false;
  if (now.styleKey !== image.inputs.styleKey) return false;
  if (now.sourceKey === image.inputs.sourceKey) return true;
  return image.inputs.sourceKey.startsWith('["photo"') && !member.likenessPhoto;
}

export type PortraitStatus = "none" | "current" | "stale";

export function portraitStatus(project: Project, subjectId: string): PortraitStatus {
  const image = currentPortrait(project, subjectId);
  if (!image) return "none";
  return portraitIsCurrent(project, image) ? "current" : "stale";
}

/**
 * Whether the reader settled where this person's look comes from: a photo, a
 * drawing or their own description, "let the story decide", or a portrait
 * already drawn. A description copied from story analysis is not a choice.
 */
export function lookDecided(project: Project, member: StoryCastMember): boolean {
  if (authoringOf(project).looksDecided?.includes(member.id)) return true;
  if (member.likenessPhoto || member.sourceArt?.length) return true;
  if (member.appearance?.trim() && !member.appearanceFromStory) return true;
  if (member.lookSource === "invent") return true;
  return currentPortrait(project, member.id) !== null;
}

/** People the chat still asks about, in story order, the one the parent asked about first. */
export function looksToDecide(project: Project): StoryCastMember[] {
  const open = portraitSubjects(project).filter((m) => !lookDecided(project, m));
  const focus = lookFocusOf(project);
  const first = focus ? open.find((m) => m.id === focus.castId) : undefined;
  return first ? [first, ...open.filter((m) => m !== first)] : open;
}

export type LookChoice = "photo" | "drawing" | "describe";

/** The option the looks card opens on, after the parent asked for it in words. */
export function lookFocusOf(project: Project): { castId: string; source: LookChoice } | null {
  const raw = authoringOf(project).lookFocus;
  const at = raw?.lastIndexOf(":") ?? -1;
  if (!raw || at <= 0) return null;
  const source = raw.slice(at + 1);
  if (source !== "photo" && source !== "drawing" && source !== "describe") return null;
  return { castId: raw.slice(0, at), source };
}

/** Record that the reader settled these people's looks. */
export function withLooksDecided(project: Project, castIds: readonly string[]): Project {
  const decided = new Set(authoringOf(project).looksDecided ?? []);
  for (const id of castIds) decided.add(id);
  return withAuthoring(project, { looksDecided: [...decided], lookFocus: undefined });
}

/** Whether any person on the book has a portrait, current or not. */
export function hasAnyPortrait(project: Project): boolean {
  return portraitSubjects(project).some((m) => currentPortrait(project, m.id) !== null);
}

/** People whose plate has no current portrait. What a portrait batch would draw. */
export function portraitsToDraw(project: Project): StoryCastMember[] {
  return portraitSubjects(project).filter((m) => portraitStatus(project, m.id) !== "current");
}

/**
 * Remember the look the portraits were drawn in when a change of style is about
 * to leave them out of date. Call with the book before and after the change.
 * With no current portrait there is nothing to go back to, so nothing is kept.
 */
export function noteStyleChange(before: Project, after: Project): Project {
  if (artStyleKey(before.config.artStyle) === artStyleKey(after.config.artStyle)) return after;
  const drawn = portraitSubjects(before).some((m) => portraitStatus(before, m.id) === "current");
  return drawn ? withAuthoring(after, { styleBefore: before.config.artStyle }) : after;
}

/**
 * The look the reader can take back, when taking it back is free: the book's
 * style changed after portraits were drawn, those portraits would be current
 * again under the old look, and none has been redrawn in the new one yet.
 */
export function styleRevert(project: Project): ArtStyleSelection | null {
  const before = authoringOf(project).styleBefore;
  if (!before) return null;
  const oldKey = artStyleKey(before);
  const nowKey = artStyleKey(project.config.artStyle);
  if (oldKey === nowKey) return null;
  const images = portraitSubjects(project)
    .map((m) => currentPortrait(project, m.id))
    .filter((image): image is PortraitImage => image !== null);
  if (images.some((image) => image.inputs.styleKey === nowKey)) return null;
  return images.some((image) => image.inputs.styleKey === oldKey) ? before : null;
}

/** The book with its old look back. The portraits drawn in it are current again. */
export function withStyleReverted(project: Project): Project {
  const before = styleRevert(project);
  if (!before) return project;
  return withAuthoring(
    { ...project, config: { ...project.config, artStyle: before, styleReady: true } },
    { styleBefore: undefined },
  );
}

/**
 * Keep hidden character-consistency inputs synchronized with approved
 * portraits. Reader uploads remain as supplemental identity references;
 * only a previous portrait-derived reference is replaced automatically.
 */
export function withPortraitAnchorReferences(project: Project): Project {
  const cast = portraitSubjects(project);
  let changed = false;
  const anchors = (project.anchors ?? []).map((anchor) => {
    if (anchor.type !== "character") return anchor;
    const member = cast.find(
      (candidate) =>
        normalizeAnchorName(candidate.name) === normalizeAnchorName(anchor.name),
    );
    const portrait = member ? currentPortrait(project, member.id) : null;
    if (!member || !portrait || !portraitIsCurrent(project, portrait)) return anchor;
    const sourceArt = [
      {
        blobId: portrait.blobId,
        mimeType: portrait.mimeType,
        createdAt: portrait.createdAt,
        origin: "portrait" as const,
      },
      ...(anchor.sourceArt ?? []).filter((image) => image.origin !== "portrait"),
    ].slice(0, SOURCE_ART_MAX);
    const previous = anchor.sourceArt ?? [];
    const same =
      previous.length === sourceArt.length &&
      previous.every(
        (image, index) =>
          image.blobId === sourceArt[index]?.blobId &&
          image.origin === sourceArt[index]?.origin,
      );
    if (same) return anchor;
    changed = true;
    return { ...anchor, sourceArt };
  });
  return changed ? { ...project, anchors } : project;
}

/** Fold a finished render in — only while its inputs still match the book. */
export function withPortrait(
  project: Project,
  image: PortraitImage,
): { project: Project; committed: boolean } {
  if (!portraitIsCurrent(project, image)) return { project, committed: false };
  const existing = authoringOf(project).portraits?.[image.inputs.subjectId];
  if (existing && Object.values(existing.nodes).some((n) => n.content.blobId === image.blobId)) {
    return { project, committed: false };
  }
  const member = portraitSubjects(project).find((m) => m.id === image.inputs.subjectId);
  const stamped: PortraitImage =
    member && !image.look
      ? { ...image, look: { portraitNote: member.portraitNote?.trim() ?? "", appearance: member.appearance?.trim() ?? "" } }
      : image;
  const tree = existing
    ? addVersion(existing, stamped, { label: "Portrait" })
    : createVersionTree(stamped, { label: "Portrait" });
  return {
    project: withAuthoring(project, {
      portraits: { ...authoringOf(project).portraits, [image.inputs.subjectId]: tree },
    }),
    committed: true,
  };
}

function ageText(member: StoryCastMember): string {
  if (member.ageMonths !== undefined && member.ageMonths < 24) return `${member.ageMonths} months old`;
  if (member.age !== undefined) return `${member.age} years old`;
  if (member.visualAge !== undefined) {
    return `approximately ${member.visualAge.years} years old`;
  }
  return "";
}

/** The portrait prompt for one character. Rendered on the worker from the job's snapshot. */
export function portraitPrompt(
  project: Project,
  member: StoryCastMember,
  prompts: PromptsConfig,
  artStyles?: ArtStylesConfig | null,
): string {
  const source = lookSourceOf(member);
  const age = ageText(member);
  const appearance = member.lookFromArt?.trim() || member.appearance?.trim() || "";
  const bodyPlan = member.bodyPlan && member.bodyPlan !== "bipedal" ? member.bodyPlan : "";
  const kind = castKindOf(member);
  const together = portraitRelationNote(briefOf(project.config), member.id);
  return renderSinglePrompt(prompts, "portrait/default", {
    vars: {
      name: member.name.trim(),
      age,
      role: member.role?.trim() ?? "",
      appearance,
      bodyPlan,
      species: member.species?.trim() || CAST_KIND_SPECS[kind].noun,
      together,
      artStyle: resolveArtStyleText(project.config.artStyle, artStyles ?? null),
      note: member.portraitNote?.trim() ?? "",
    },
    flags: {
      isAnimal: kind === "animal",
      isToy: kind === "toy",
      isCreature: kind === "creature",
      hasTogether: Boolean(together),
      hasNote: Boolean(member.portraitNote?.trim()),
      hasAge: Boolean(age),
      hasRole: Boolean(member.role?.trim()),
      hasAppearance: Boolean(appearance) && source !== "photo",
      hasBodyPlan: Boolean(bodyPlan) && source !== "photo",
      fromPhoto: source === "photo",
      fromDrawing: source === "drawing",
      invent: source === "invent" && !appearance,
    },
  });
}

/**
 * The prompt for a change to a portrait that is already drawn. The current
 * picture is attached, so the prompt is only the change and what must stay.
 */
export function portraitEditPrompt(member: StoryCastMember, edit: string, prompts: PromptsConfig): string {
  return renderSinglePrompt(prompts, "portrait/edit", {
    vars: { name: member.name.trim(), edit: edit.trim() },
    flags: {},
  });
}
