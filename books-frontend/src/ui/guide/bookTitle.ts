import { authoringOf } from "../../core/guide/projectState";
import { briefOf, namedHeroes } from "../../core/story/brief";
import type { Project } from "../../core/types";

const PLACEHOLDER_TITLE = "Untitled Story";

/**
 * Put an invented title on the book when the reader has not named it.
 * A typed title, including one from story drafting, stays as it is.
 */
export function withInventedTitle(project: Project, title: string): Project {
  const next = title.trim();
  if (!next || authoringOf(project).cover?.titleEdited) return project;
  const stored = project.title.trim();
  if (stored && stored !== PLACEHOLDER_TITLE) return project;
  return { ...project, title: next };
}

/** The name on the cover: a real title, or the children, or nothing yet. */
export function bookTitle(project: Project): string {
  const stored = project.title.trim();
  if (stored && stored !== PLACEHOLDER_TITLE) return stored;
  const names = namedHeroes(briefOf(project.config));
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]}'s book`;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} more`;
}
