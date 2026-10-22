/**
 * What the visible page plan was made from, and whether it still is.
 *
 * The plan is made again only when what it was made from changed: the reading
 * of the story, the page target and layout, the notes for the pictures, the
 * story's own words and who is in the book. The basis is a short string stored
 * beside the plan; a plan made under an older basis is the same plan and is
 * adopted as it is, so opening a book never plans it again for nothing.
 */
import type { Project } from "../types";
import { authoringOf } from "./projectState";
import type { HardcoverCheck } from "./hardcover";

/** A short stamp of a text, so a corrected sentence or a changed list is not missed. */
export function stamp(text: string): string {
  let h = 5381;
  for (const ch of text.replace(/\s+/g, " ").trim()) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

/**
 * Who the plan can put on a page: the subjects that are in the book, and what
 * kind they are. Names and descriptions are not part of it: a rename is carried
 * into the plan by the rename itself, and a changed look is the picture's
 * business, so neither needs the pages planned again.
 */
export function anchorStamp(project: Project): string {
  return stamp(
    (project.anchors ?? [])
      .filter((anchor) => anchor.include)
      .map((anchor) => `${anchor.id}:${anchor.type}`)
      .sort()
      .join(","),
  );
}

/** What the plan was made from before the story's words were part of it. */
export function legacyPlanBasis(project: Project, check: HardcoverCheck): string {
  // Physical trim does not affect pagination or the screenplay prompt. Keeping
  // it out means choosing a format remains an instant, non-generative decision.
  const notesAt = authoringOf(project).planNotesAt;
  return [
    project.analysis?.generatedAt ?? 0,
    check.pages,
    check.case,
    project.config.layoutId,
    ...(notesAt ? [`notes${notesAt}`] : []),
  ].join("|");
}

/** What the plan was made from before the book's people, places and things were part of it. */
export function storyPlanBasis(project: Project, check: HardcoverCheck): string {
  return `${legacyPlanBasis(project, check)}|s${stamp(project.config.storyText)}`;
}

/**
 * What the visible plan has to match. The words are part of it: the pages print
 * the story as written, so a sentence changed after the plan was made (too small
 * to need a new reading of the story) still needs the pages cut again. So is who
 * is in the book: someone added or left out after the plan was made is on no
 * page, or on pages they should not be on.
 */
export function planBasis(project: Project, check: HardcoverCheck): string {
  return `${storyPlanBasis(project, check)}|a${anchorStamp(project)}`;
}

/** A plan made under an older basis is the same plan: adopt it as is. */
export function isOlderBasis(project: Project, check: HardcoverCheck): boolean {
  const stored = authoringOf(project).planBasis;
  return stored === legacyPlanBasis(project, check) || stored === storyPlanBasis(project, check);
}

export function planBasisMatches(project: Project, check: HardcoverCheck): boolean {
  return authoringOf(project).planBasis === planBasis(project, check) || isOlderBasis(project, check);
}
