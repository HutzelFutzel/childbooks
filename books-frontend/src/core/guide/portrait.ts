/**
 * Portraits: one picture of a person, in the saved style, on that person's plate.
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
import type {
  LookSource,
  PortraitImage,
  PortraitInputs,
  Project,
  StoryCastMember,
} from "../types";
import { SOURCE_ART_MAX } from "../types";
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

/** Everyone who gets a plate: the named cast, in story order. */
export function portraitSubjects(project: Project): StoryCastMember[] {
  return namedCast(briefOf(project.config));
}

export function portraitInputs(project: Project, member: StoryCastMember): PortraitInputs {
  const source = lookSourceOf(member);
  const appearance =
    member.lookFromArt?.trim() || member.appearance?.trim() || "";
  return {
    subjectId: member.id,
    subjectSignature: JSON.stringify({
      name: member.name.trim(),
      age: member.age ?? null,
      months: member.ageMonths ?? null,
      visualAge: member.visualAge ?? null,
      role: member.role?.trim() ?? "",
    }),
    styleKey: artStyleKey(project.config.artStyle),
    sourceKey: JSON.stringify([
      ...(source === "photo"
        ? ["photo", member.likenessPhoto?.createdAt ?? null]
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

/** The portrait currently shown on a plate, whether or not it is still current. */
export function currentPortrait(project: Project, subjectId: string): PortraitImage | null {
  const tree = authoringOf(project).portraits?.[subjectId];
  return tree ? getCursor(tree).content : null;
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
  if (now.subjectSignature !== image.inputs.subjectSignature) return false;
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

/** People whose plate has no current portrait. What a portrait batch would draw. */
export function portraitsToDraw(project: Project): StoryCastMember[] {
  return portraitSubjects(project).filter((m) => portraitStatus(project, m.id) !== "current");
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
  const tree = existing
    ? addVersion(existing, image, { label: "Portrait" })
    : createVersionTree(image, { label: "Portrait" });
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

/** The portrait prompt for one person. Rendered on the worker from the job's snapshot. */
export function portraitPrompt(
  project: Project,
  member: StoryCastMember,
  prompts: PromptsConfig,
  artStyles?: ArtStylesConfig | null,
): string {
  const source = lookSourceOf(member);
  const age = ageText(member);
  const appearance = member.lookFromArt?.trim() || member.appearance?.trim() || "";
  return renderSinglePrompt(prompts, "portrait/default", {
    vars: {
      name: member.name.trim(),
      age,
      role: member.role?.trim() ?? "",
      appearance,
      artStyle: resolveArtStyleText(project.config.artStyle, artStyles ?? null),
      note: member.portraitNote?.trim() ?? "",
    },
    flags: {
      hasNote: Boolean(member.portraitNote?.trim()),
      hasAge: Boolean(age),
      hasRole: Boolean(member.role?.trim()),
      hasAppearance: Boolean(appearance) && source !== "photo",
      fromPhoto: source === "photo",
      fromDrawing: source === "drawing",
      invent: source === "invent",
    },
  });
}
