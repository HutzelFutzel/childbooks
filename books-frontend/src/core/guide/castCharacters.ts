/**
 * Everyone in the cast who the story speaks of has a character the pages are drawn from.
 *
 * A person joins the cast in one place and becomes a character of the story in another (the reading of the
 * story, `core/pipeline/analysis.ts`). A person who joined after that reading, or by a road that never led
 * to one, is in the cast with a portrait and is on no page: nothing prepares a sheet for them and the page
 * plan never lists them. This puts the missing characters in, by the very rule the reading uses
 * (`injectNamedCastAnchors`), so there is one definition of "a character for this person".
 *
 * Two things keep it safe:
 *  - only people the story names get one: a sheet is paid for and a character nobody meets is drawn for
 *    nothing, so the rest are reported and left alone;
 *  - it only fills what is missing. Whoever has a character, however named, and whoever the parent left
 *    out of the book, is untouched, so a later reading finds the same characters by name and keeps them.
 */
import { injectNamedCastAnchors, linkAnchorsToCast } from "../pipeline/analysis";
import { anchorNameKeys, normalizeAnchorName } from "../book/anchorRefs";
import { briefOf, namedCast } from "../story/brief";
import type { Anchor, Project, StoryCastMember } from "../types";
import { textMentions } from "./people";

export interface CastCharacters {
  project: Project;
  /** People who got a character now. */
  added: string[];
  /** People in the cast with no character whom the story does not name, so none was made. */
  unnamed: string[];
}

function hasCharacter(member: StoryCastMember, anchors: readonly Anchor[]): boolean {
  const key = normalizeAnchorName(member.name);
  return anchors.some(
    (anchor) => anchor.type === "character" && (anchor.castId === member.id || (key !== "" && anchorNameKeys(anchor).includes(key))),
  );
}

/** The people of the cast with no character, and which of them the story names. Nothing before the story was read. */
export function castWithoutCharacter(project: Project): { named: StoryCastMember[]; unnamed: StoryCastMember[] } {
  const story = project.config.storyText;
  if (!project.analysis || !story.trim()) return { named: [], unnamed: [] };
  const anchors = project.anchors ?? [];
  const lacking = namedCast(briefOf(project.config)).filter((member) => !hasCharacter(member, anchors));
  return {
    named: lacking.filter((member) => textMentions(story, [member.name, ...(member.aliases ?? [])])),
    unnamed: lacking.filter((member) => !textMentions(story, [member.name, ...(member.aliases ?? [])])),
  };
}

export function withCastCharacters(project: Project): CastCharacters {
  const { named, unnamed } = castWithoutCharacter(project);
  const unnamedNames = unnamed.map((member) => member.name.trim());
  if (named.length === 0) return { project, added: [], unnamed: unnamedNames };
  const anchors = project.anchors ?? [];
  const brief = briefOf(project.config);
  const config = { ...project.config, storyBrief: { ...brief, cast: named } };
  const next = linkAnchorsToCast(injectNamedCastAnchors(anchors, config, anchors), project.config, anchors);
  const before = new Set(anchors.map((anchor) => anchor.id));
  const added = next.filter((anchor) => !before.has(anchor.id)).map((anchor) => anchor.name.trim());
  if (added.length === 0) return { project, added: [], unnamed: unnamedNames };
  return { project: { ...project, anchors: next }, added, unnamed: unnamedNames };
}
