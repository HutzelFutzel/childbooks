/**
 * Character artwork may arrive before manuscript extraction knows the cast.
 *
 * Keep that upload on the shared book, use it to derive the whole-book style
 * immediately, then attach it to one cast plate only when identity is clear.
 */
import { SOURCE_ART_MAX, type Project, type SourceArtRef } from "../types";
import { briefOf, namedCast, newCastMember } from "../story/brief";
import { withAuthoring } from "./projectState";

export function stageStyleSource(project: Project, ref: SourceArtRef): Project {
  const seen = new Set<string>();
  const styleSourceArt = [...(project.authoringState?.styleSourceArt ?? []), ref]
    .filter((image) => image.blobId && !seen.has(image.blobId) && seen.add(image.blobId))
    .slice(0, SOURCE_ART_MAX);
  return withAuthoring(project, {
    styleSourceArt,
    styleSourceOnly: undefined,
  });
}

export function assignStyleSource(project: Project, castId: string): Project {
  const refs = project.authoringState?.styleSourceArt ?? [];
  if (refs.length === 0) return project;
  const brief = briefOf(project.config);
  let assignedName = "";
  const cast = (brief.cast ?? []).map((member) => {
    if (member.id !== castId) return member;
    assignedName = member.name.trim();
    const seen = new Set<string>();
    const sourceArt = [...refs, ...(member.sourceArt ?? [])]
      .filter((ref) => ref.blobId && !seen.has(ref.blobId) && seen.add(ref.blobId))
      .slice(0, SOURCE_ART_MAX);
    return {
      ...member,
      sourceArt,
      likenessPhoto: undefined,
      moreLikenessPhotos: undefined,
      lookSource: "drawing" as const,
    };
  });
  if (!assignedName) return project;
  const artStyle =
    project.config.artStyle.origin === "derived"
      ? {
          ...project.config.artStyle,
          derivedFromName: assignedName,
          derivedFromNames: [assignedName],
        }
      : project.config.artStyle;
  return withAuthoring(
    {
      ...project,
      config: { ...project.config, artStyle, storyBrief: { ...brief, cast } },
    },
    { styleSourceArt: undefined, styleSourceOnly: undefined },
  );
}

export function styleSourceAsNewCast(project: Project): Project {
  const refs = project.authoringState?.styleSourceArt ?? [];
  if (refs.length === 0) return project;
  const brief = briefOf(project.config);
  const member = {
    ...newCastMember(),
    sourceArt: refs.slice(0, SOURCE_ART_MAX),
    lookSource: "drawing" as const,
  };
  return withAuthoring(
    {
      ...project,
      config: { ...project.config, storyBrief: { ...brief, cast: [...(brief.cast ?? []), member] } },
    },
    { styleSourceArt: undefined, styleSourceOnly: undefined },
  );
}

export function keepStyleSourceOnly(project: Project): Project {
  if (!(project.authoringState?.styleSourceArt?.length)) return project;
  return withAuthoring(project, { styleSourceOnly: true });
}

/** One drawing and one named person is structurally unambiguous. */
export function autoAssignStyleSource(project: Project): Project {
  if (project.authoringState?.styleSourceOnly || !(project.authoringState?.styleSourceArt?.length)) {
    return project;
  }
  const cast = namedCast(briefOf(project.config));
  return cast.length === 1 ? assignStyleSource(project, cast[0]!.id) : project;
}
