/**
 * The words on the front cover — title, subtitle, author — read in one place.
 *
 * Every surface that shows or paints them goes through {@link coverLinesOf}:
 * the cover prompt, the design's text layer, the drift check and the Chat's
 * cover card. The title is always the project title. Subtitle and author are
 * what the reader chose in the Chat (`authoringState.cover`, where an empty
 * string means "none") and otherwise the page plan's cover, so a subtitle the
 * plan invented never replaces one the reader decided on.
 */
import { getBookLanguage, type BookLanguagesConfig } from "../config/bookLanguages";
import { authoringOf } from "../guide/projectState";
import type { BakedCoverText, CoverSpec, IllustrationImage, Project } from "../types";
import { COVER_FRONT_ID } from "../types";
import { getCursor } from "../versioning";

/** What a book is called before anyone names it. Never printed on a cover. */
export const PLACEHOLDER_TITLE = "Untitled Story";

export interface CoverLines {
  title: string;
  subtitle: string;
  author: string;
}

function frontCoverOf(project: Project): CoverSpec | undefined {
  return project.screenplay ? getCursor(project.screenplay).content.frontCover : undefined;
}

export function coverLinesOf(project: Project): CoverLines {
  const chosen = authoringOf(project).cover;
  const spec = frontCoverOf(project);
  const title = (project.title ?? "").trim();
  return {
    title: title === PLACEHOLDER_TITLE ? "" : title,
    subtitle: (chosen?.subtitle ?? spec?.subtitle ?? "").trim(),
    author: (chosen?.author ?? spec?.author ?? "").trim(),
  };
}

/** The lines as a baked-text record, with empty lines left out. */
export function bakedTextOf(lines: CoverLines): BakedCoverText {
  return {
    title: lines.title,
    ...(lines.subtitle ? { subtitle: lines.subtitle } : {}),
    ...(lines.author ? { author: lines.author } : {}),
  };
}

const norm = (value?: string) => (value ?? "").trim();

export function sameCoverText(a: BakedCoverText, b: BakedCoverText): boolean {
  return norm(a.title) === norm(b.title) && norm(a.subtitle) === norm(b.subtitle) && norm(a.author) === norm(b.author);
}

/**
 * Whether the image model may paint the cover's words in this book language.
 * An admin decides per language; unset, English is on and the rest wait for a
 * yes, because a model that misspells a diacritic prints it on every copy.
 * The lettering check still catches a wrong letter, and falls back to the text layer.
 */
export function coverLetteringAllowed(locale: string | null | undefined, languages?: BookLanguagesConfig | null): boolean {
  const language = getBookLanguage(locale);
  return languages?.overrides[language.id]?.coverLettering ?? language.id.startsWith("en-");
}

/** Whether this book's front cover is drawn with its words painted in. */
export function paintsCoverLettering(project: Project, spec?: CoverSpec): boolean {
  return authoringOf(project).cover?.painted === true || Boolean(spec?.bakeText);
}

/** Whether this artwork already carries the cover's words, so no text layer goes on top. */
export function artCarriesLettering(image: IllustrationImage | undefined): boolean {
  return Boolean(image && image.textMode === "in-image" && image.bakedText && norm(image.bakedText.title));
}

/** The current front-cover artwork, when there is one. */
export function frontCoverArt(project: Project): IllustrationImage | undefined {
  const tree = project.illustrations?.[COVER_FRONT_ID];
  return tree ? getCursor(tree).content : undefined;
}
