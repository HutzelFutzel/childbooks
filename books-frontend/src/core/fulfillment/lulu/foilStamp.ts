/**
 * Spine foil stamping on Lulu's linen-wrap hardcover.
 *
 * Lulu stamps `foil_stamp_title_text` and `foil_stamp_author_text` onto the
 * spine of a linen book in the foil colour its package id names. Its rules:
 * Roman characters only, no underscore, at most 42 characters for both lines
 * together. Both blank and Lulu prints no stamp at all.
 */

export const FOIL_STAMP_MAX_CHARS = 42;

export interface FoilStampText {
  title: string;
  author?: string;
}

/** Characters Lulu's foil die can strike: Latin letters (accented too), digits, plain punctuation. */
const UNSTAMPABLE = /[^A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F .,'!?&:;()\-]/gu;

/** Typography the die can't strike, swapped for what it can. */
function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: unknown): string {
  return plain(value).replace(UNSTAMPABLE, "").replace(/\s+/g, " ").trim();
}

/** Cut at the last word boundary that fits, else hard at the limit. */
function fit(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max + 1).lastIndexOf(" ");
  return (cut > max / 2 ? value.slice(0, cut) : value.slice(0, max)).replace(/[\s,.;:\-]+$/, "");
}

/**
 * The spine lines a book's cover words become, within Lulu's limits. The title
 * wins the space: an author that doesn't fit beside it is left off rather than
 * shortening both. Null when there's nothing stampable.
 */
export function foilStampText(input: { title?: unknown; author?: unknown } | null | undefined): FoilStampText | null {
  const title = fit(clean(input?.title), FOIL_STAMP_MAX_CHARS);
  const author = clean(input?.author);
  if (!title && !author) return null;
  if (!title) return { title: "", author: fit(author, FOIL_STAMP_MAX_CHARS) };
  return author && title.length + author.length <= FOIL_STAMP_MAX_CHARS ? { title, author } : { title };
}

/** What stamping these lines does to them, so the customer isn't surprised by the spine. */
export interface FoilStampReport {
  stamp: FoilStampText | null;
  /** Characters the die can't strike (non-Latin scripts, emoji) were left out. */
  removedCharacters: boolean;
  /** The title was cut to fit. */
  titleShortened: boolean;
  /** An author was given but there was no room for it beside the title. */
  authorDropped: boolean;
  /** Characters used of {@link FOIL_STAMP_MAX_CHARS}, as typed (after cleaning). */
  length: number;
}

export function foilStampReport(input: { title?: unknown; author?: unknown }): FoilStampReport {
  const title = clean(input.title);
  const author = clean(input.author);
  const stamp = foilStampText(input);
  return {
    stamp,
    removedCharacters: plain(input.title) !== title || plain(input.author) !== author,
    titleShortened: Boolean(stamp && title && stamp.title.length < title.length),
    authorDropped: Boolean(author && stamp && !stamp.author && stamp.title),
    length: title.length + author.length,
  };
}
