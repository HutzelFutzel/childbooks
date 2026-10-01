/**
 * What a manuscript says about itself, besides the story.
 *
 * Parents who write their own book often start it the way books start — a
 * title, maybe a subtitle, "by Grandma Lou" — and many already think in pages
 * ("Page 1", "Seite 2") or sections (the editor's `###` headings). None of that
 * is story text: the title lines belong on the cover, and the markers say where
 * a page or a section begins. Printing them on page 1 would be wrong, and
 * ignoring them would re-cut a book the parent already laid out.
 *
 * Pure and deliberately conservative: a heading is only read off a short first
 * block of title-like lines followed by the story, and the manuscript itself is
 * never changed. Where the reading is used, the parent sees it (the cover card
 * shows the title it found), so a wrong guess is visible and editable.
 */

import { restoreModelLineBreaks } from "./lineBreaks";

export interface ManuscriptHeading {
  title: string;
  /** "" when the heading has none. */
  subtitle: string;
  /** Without the "by". "" when the heading has none. */
  author: string;
}

export type ManuscriptSplit = "pages" | "sections";

export interface ManuscriptShape {
  heading: ManuscriptHeading | null;
  /** The story in the parent's parts, without title lines, page or section labels. */
  parts: string[];
  /** How the parent divided it. Null: one continuous story. */
  split: ManuscriptSplit | null;
}

/** "by", "written by", "von", "geschrieben von", "par", "por", … followed by the name. */
const BY_LINE =
  /^(?:(?:written|told)\s+(?:and\s+illustrated\s+)?by|by|geschrieben\s+von|erzählt\s+von|von|écrit\s+par|par|escrito\s+por|escrita\s+por|por|door|geschreven\s+door|di|scritto\s+da|przez|napisała|napisał|yazan)\s*[:\-–—]?\s+(.{1,80})$/iu;

/**
 * A line that says which page this is: "Page 3", "Seite 3:", "[page 3]",
 * "### Page 3", or "Page 3: Maya woke up." with the page's text after it. A
 * sentence that merely starts with the word ("Page 5 was her favourite") is not.
 */
const PAGE_MARKER =
  /^\s*(?:#{1,3}\s*)?[[(]?\s*(?:page|pg\.?|p\.|seite|s\.|página|pagina|strona|sayfa|bladzijde|blz\.?)\s*(\d{1,3})\s*[\])]?(?:\s*[:.)\-–—]\s*(.*?)|\s*)$/iu;

/** The editor's section headings. */
const SECTION_HEADING = /^\s*#{1,3}\s+(.+?)\s*#*\s*$/u;

/** A scene break on its own line: "---", "***", "* * *", "~~~". */
const SCENE_BREAK = /^\s*(?:[-*~_=]\s*){3,}$/u;

const MAX_HEADING_LINE_CHARS = 80;
const MAX_HEADING_LINE_WORDS = 12;
/** A heading needs a story after it. */
const MIN_BODY_WORDS = 25;

function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function titleLike(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > MAX_HEADING_LINE_CHARS || words(text) > MAX_HEADING_LINE_WORDS) return false;
  // A sentence, a clause or dialogue is story, not a title.
  if (/[.,;:…]$/u.test(text)) return false;
  if (/^["'“”„«»‹›‚‘’(\-–—]/u.test(text)) return false;
  if (PAGE_MARKER.test(text) || SCENE_BREAK.test(text)) return false;
  return true;
}

function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^#\s+/u, "")
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .trim();
}

/**
 * The title block at the very top: one to three short title-like lines, alone
 * in the first paragraph, with a story after them. Section headings (`##`,
 * `###`) are the editor's structure and never a title.
 */
export function manuscriptHeading(text: string): { heading: ManuscriptHeading; rest: string } | null {
  const trimmed = restoreModelLineBreaks(text).replace(/^\s+/u, "");
  const end = trimmed.search(/\n\s*\n/u);
  if (end < 0) return null;
  const block = trimmed.slice(0, end);
  const rest = trimmed.slice(end).trim();
  if (words(rest) < MIN_BODY_WORDS) return null;
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 3) return null;
  if (lines.some((line) => /^#{2,}\s/u.test(line))) return null;

  let author = "";
  const titles: string[] = [];
  for (const line of lines) {
    const by = BY_LINE.exec(line.replace(/^#\s+/u, ""));
    if (by && !author) {
      author = by[1]!.trim().replace(/[.,;:]+$/u, "").trim();
      continue;
    }
    if (!titleLike(line)) return null;
    titles.push(cleanLine(line));
  }
  if (titles.length === 0 || titles.length > 2 || !titles[0]) return null;
  // Without a by-line, a lone line must read as a name, not an opening.
  if (!author && titles.length === 1 && !/^#\s/u.test(lines[0]!) && !loneTitle(titles[0])) return null;
  return { heading: { title: titles[0], subtitle: titles[1] ?? "", author }, rest };
}

/** How stories open, in the book languages: never a title on its own. */
const STORY_OPENING =
  /^(?:once upon a time|one (?:day|morning|night|evening)|long ago|es war einmal|eines (?:tages|morgens|abends)|il était une fois|un jour|érase una vez|había una vez|c'era una volta|er was eens|dawno,? dawno temu|bir varmış)/iu;

/** The story after its title lines: what the readers of the story read, so "by Grandma Lou" is not a character. */
export function withoutHeading(text: string): string {
  const source = restoreModelLineBreaks(text);
  return manuscriptHeading(source)?.rest ?? source;
}

const LONE_TITLE_MAX_WORDS = 8;

function loneTitle(title: string): boolean {
  if (STORY_OPENING.test(title)) return false;
  if (words(title) > LONE_TITLE_MAX_WORDS) return false;
  return /^\P{L}*\p{Lu}/u.test(title) || !/\p{Ll}/u.test(title);
}

/**
 * The manuscript's shape: its heading, and its parts as the parent divided
 * them. Page markers win over section headings when both are there; a scene
 * break ("* * *") divides sections too.
 */
export function readManuscript(text: string, options: { heading?: boolean } = {}): ManuscriptShape {
  const source = restoreModelLineBreaks(text);
  const found = options.heading === false ? null : manuscriptHeading(source);
  const body = found ? found.rest : source.trim();
  const lines = body.split("\n");

  const pageMarks = lines.filter((line) => PAGE_MARKER.test(line)).length;
  const split: ManuscriptSplit | null =
    pageMarks >= 2
      ? "pages"
      : lines.some((line) => SECTION_HEADING.test(line)) || lines.filter((line) => SCENE_BREAK.test(line)).length >= 1
        ? "sections"
        : null;

  if (!split) return { heading: found?.heading ?? null, parts: body ? [body] : [], split: null };

  const parts: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const part = current.join("\n").trim();
    if (part) parts.push(part);
    current = [];
  };
  for (const line of lines) {
    const page = split === "pages" ? PAGE_MARKER.exec(line) : null;
    if (page) {
      flush();
      if (page[2]?.trim()) current.push(page[2].trim());
      continue;
    }
    // Section labels are never printed, whichever way the parent divided the story.
    if (SECTION_HEADING.test(line) || SCENE_BREAK.test(line)) {
      if (split === "sections") flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return { heading: found?.heading ?? null, parts, split };
}

const BREAK: Record<ManuscriptSplit, string> = {
  pages: "--- page break ---",
  sections: "--- section break ---",
};

/** The story as the page plan reads it: the parts, joined by explicit breaks. */
export function storyForPages(shape: ManuscriptShape): string {
  if (!shape.split) return shape.parts.join("\n\n");
  return shape.parts.join(`\n\n${BREAK[shape.split]}\n\n`);
}

/** What the page plan is told about the parent's own division, if anything. */
export function splitGuidance(shape: ManuscriptShape): string {
  if (shape.split === "pages") {
    return `The author already divided the story into pages, marked "${BREAK.pages}". Keep that division: every part starts a new page, in order. A part may run over two pages when the page count asks for it, but never put two parts on one page, and never print the markers.`;
  }
  if (shape.split === "sections") {
    return `The author divided the story into sections, marked "${BREAK.sections}". Start every section on a new page, and never print the markers or a section's name.`;
  }
  return "";
}
