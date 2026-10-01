import { PLACEHOLDER_TITLE } from "../../core/book/coverLines";
import { authoringOf, withAuthoring } from "../../core/guide/projectState";
import type { ManuscriptHeading } from "../../core/story/manuscriptShape";
import { briefOf, namedHeroes } from "../../core/story/brief";
import type { Project } from "../../core/types";

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

/**
 * Put the title lines a reader wrote atop their own story on the cover. Their
 * title beats an invented one; a title typed on the cover card beats both, and
 * a subtitle or author the reader already chose (even "none") stays.
 */
export function withManuscriptHeading(project: Project, heading: ManuscriptHeading): Project {
  const cover = authoringOf(project).cover;
  const title = heading.title.trim();
  const takeTitle = Boolean(title) && !cover?.titleEdited;
  const subtitle = cover?.subtitle === undefined && heading.subtitle ? { subtitle: heading.subtitle } : {};
  const author = cover?.author === undefined && heading.author ? { author: heading.author } : {};
  if (!takeTitle && !subtitle.subtitle && !author.author) return project;
  const next = takeTitle ? { ...project, title } : project;
  return withAuthoring(next, { cover: { ...cover, ...subtitle, ...author, fromStory: true } });
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
