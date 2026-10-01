/**
 * The cover card: what the front cover will say, and what to offer.
 *
 * The title comes from the story; subtitle and author are the reader's to add
 * or leave off. The card shows the reader's choice only — a subtitle the page
 * plan invented is offered, never printed unasked — and "Looks good" freezes
 * exactly what it showed, so the cover says what the reader saw.
 */
import { coverLinesOf, type CoverLines } from "../book/coverLines";
import { getBookLanguage } from "../config/bookLanguages";
import { briefOf, namedCast } from "../story/brief";
import { isPerson } from "../story/castKinds";
import type { Project } from "../types";
import { getCursor } from "../versioning";
import { authoringOf } from "./projectState";

const MAX_IDEAS = 3;

/** The lines as the card shows them: the story's title, and only what the reader chose. */
export function coverCardLines(project: Project): CoverLines {
  const chosen = authoringOf(project).cover;
  return {
    title: coverLinesOf(project).title,
    subtitle: (chosen?.subtitle ?? "").trim(),
    author: (chosen?.author ?? "").trim(),
  };
}

/** Whether the reader settled the cover's words for this story. */
export function coverWordsSettled(project: Project): boolean {
  return authoringOf(project).cover?.confirmedAt !== undefined;
}

const fold = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function distinct(ideas: readonly string[], exclude: readonly string[]): string[] {
  const seen = new Set(exclude.map(fold).filter(Boolean));
  const out: string[] = [];
  for (const raw of ideas) {
    const idea = raw.trim();
    if (!idea || seen.has(fold(idea))) continue;
    seen.add(fold(idea));
    out.push(idea);
    if (out.length === MAX_IDEAS) break;
  }
  return out;
}

/** Subtitles written with the story, then the page plan's, never repeating the title. */
export function subtitleIdeas(project: Project): string[] {
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const lines = coverCardLines(project);
  return distinct(
    [...(authoringOf(project).cover?.subtitleIdeas ?? []), doc?.frontCover?.subtitle ?? ""],
    [lines.title],
  );
}

interface AuthorWords {
  parents: string;
  grandparents: string;
  /** "Uncle David", "Tante Anna": the word before a relative's name, by role. */
  relative: Record<string, string>;
  /** Roles read from the cast's own "role" text. */
  roles: [RegExp, string][];
}

const ENGLISH_ROLES: [RegExp, string][] = [
  [/\buncle\b/i, "uncle"],
  [/\b(aunt|auntie)\b/i, "aunt"],
  [/\b(grandma|granny|nana|grandmother)\b/i, "grandma"],
  [/\b(grandpa|grandad|granddad|grandfather)\b/i, "grandpa"],
  [/\bgodmother\b/i, "godmother"],
  [/\bgodfather\b/i, "godfather"],
];
const GERMAN_ROLES: [RegExp, string][] = [
  [/\bonkel\b/i, "uncle"],
  [/\btante\b/i, "aunt"],
  [/\b(oma|großmutter)\b/i, "grandma"],
  [/\b(opa|großvater)\b/i, "grandpa"],
  [/\bpatentante\b/i, "godmother"],
  [/\bpatenonkel\b/i, "godfather"],
];

const AUTHOR_WORDS: Record<string, AuthorWords> = {
  "en-US": {
    parents: "Mom & Dad",
    grandparents: "Grandma & Grandpa",
    relative: { uncle: "Uncle", aunt: "Aunt", grandma: "Grandma", grandpa: "Grandpa", godmother: "Godmother", godfather: "Godfather" },
    roles: [...ENGLISH_ROLES, ...GERMAN_ROLES],
  },
  "en-GB": {
    parents: "Mum & Dad",
    grandparents: "Grandma & Grandpa",
    relative: { uncle: "Uncle", aunt: "Auntie", grandma: "Grandma", grandpa: "Grandpa", godmother: "Godmother", godfather: "Godfather" },
    roles: [...ENGLISH_ROLES, ...GERMAN_ROLES],
  },
  de: {
    parents: "Mama & Papa",
    grandparents: "Oma & Opa",
    relative: { uncle: "Onkel", aunt: "Tante", grandma: "Oma", grandpa: "Opa", godmother: "Patentante", godfather: "Patenonkel" },
    roles: [...GERMAN_ROLES, ...ENGLISH_ROLES],
  },
};

function authorWordsFor(locale: string | undefined): AuthorWords | null {
  const id = getBookLanguage(locale).id;
  if (id === "en-GB" || id === "en-AU") return AUTHOR_WORDS["en-GB"]!;
  if (id.startsWith("en-")) return AUTHOR_WORDS["en-US"]!;
  if (id.startsWith("de-")) return AUTHOR_WORDS.de!;
  return null;
}

/**
 * Who the book could be "by", in the book's language: a relative in the story
 * by name ("Uncle David"), then the parents and the grandparents. Languages
 * without the words offer none, rather than an English "Mom & Dad" printed on
 * the cover; the reader can always write their own. A story the reader wrote
 * offers their own name first (`writer`, the account's name), in any language.
 */
export function authorIdeas(project: Project, writer = ""): string[] {
  const words = authorWordsFor(project.config.contentLocale);
  const entry = authoringOf(project).entry ?? (briefOf(project.config).mode === "own" ? "own" : null);
  const own = entry === "own" && writer.trim() && !writer.includes("@") ? [writer.trim()] : [];
  if (!words) return distinct(own, [coverCardLines(project).title]);
  const relatives: string[] = [];
  for (const member of namedCast(briefOf(project.config))) {
    if (!isPerson(member) || !member.role) continue;
    const name = member.name.trim();
    const role = words.roles.find(([pattern]) => pattern.test(member.role!))?.[1];
    if (!name || !role) continue;
    relatives.push(`${words.relative[role]} ${name}`);
  }
  return distinct([...own, ...relatives, words.parents, words.grandparents], [coverCardLines(project).title]);
}
