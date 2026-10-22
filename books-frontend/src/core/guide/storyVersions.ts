/**
 * The story in every language it has been written in.
 *
 * Moving a book from English to German replaces its words, so the English ones
 * are kept (`Project.storyLanguages`) and coming back is a lookup, not a
 * translation: instant, free and the same story. What is kept is the whole set
 * of words that follow the story's language: the story, the title, the cover
 * subtitle and what each person, place and thing is called.
 *
 * Whether a kept version still tells the story that is on the book is decided
 * by one rule, never by a flag that has to be kept up to date:
 *
 *   A kept version is current when it was made from the same story as the words
 *   on the book (the same `syncId`), and those words have not moved away from
 *   the words the story had then (`syncText`, compared with `isRealStoryChange`).
 *
 * A small edit leaves every language current; a real one makes the others stale
 * (kept, not deleted); editing back until the story is close to what it was
 * makes them current again. Leaving a language that moved away starts a new
 * story id, so a version made from the older story stays stale for good.
 *
 * Only the language the book is in can be edited, so the words of the other
 * languages never change under a cached switch. The versions live beside the
 * undoable fields, never in them (`agent/restore.ts`), so they never count
 * against the size Undo can hold.
 */
import {
  DEFAULT_BOOK_LANGUAGE_ID,
  isBookLanguageId,
  type BookLanguageId,
} from "../config/bookLanguages";
import { PLACEHOLDER_TITLE } from "../book/coverLines";
import type { Project, StoryLanguageVersion } from "../types";
import type { NamePair } from "../book/anchorIdentity";
import { manuscriptHash } from "./ownWords";
import { authoringOf, withAuthoring } from "./projectState";
import { isRealStoryChange } from "./storyChange";
import { withTranslatedStory, type TranslatedStory } from "./storyLanguage";

/** What a language is to the book that holds it. */
export type LanguageStatus =
  /** The book is written in it now. */
  | "here"
  /** Kept, and it tells the story that is on the book: switching is instant. */
  | "current"
  /** Kept, from a story that has since changed: switching translates it again. */
  | "stale"
  /** Never written in. */
  | "none";

function newSyncId(): string {
  return `s_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

/** The language the book is written in. */
export function languageOf(project: Project): BookLanguageId {
  return project.config.contentLocale ?? DEFAULT_BOOK_LANGUAGE_ID;
}

function namesOf(project: Project): Record<string, string> {
  const out: Record<string, string> = {};
  for (const anchor of project.anchors ?? []) out[anchor.id] = anchor.name;
  return out;
}

/** The words of the book that follow the story's language, as they are now. */
function wordsOf(project: Project): Pick<StoryLanguageVersion, "storyText" | "title" | "subtitle" | "names"> {
  const title = (project.title ?? "").trim();
  return {
    storyText: project.config.storyText,
    // The placeholder name of a book nobody has named is not a title.
    title: title === PLACEHOLDER_TITLE ? "" : title,
    // Only a subtitle the reader chose goes with the story; the page plan makes its own again.
    subtitle: authoringOf(project).cover?.subtitle?.trim() ?? "",
    names: namesOf(project),
  };
}

/** Repair whatever is stored in `project.storyLanguages`, dropping anything malformed. */
export function normalizeStoryLanguages(
  raw: unknown,
): Partial<Record<BookLanguageId, StoryLanguageVersion>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<BookLanguageId, StoryLanguageVersion>> = {};
  for (const [locale, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isBookLanguageId(locale) || !entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const storyText = typeof item.storyText === "string" ? item.storyText : "";
    const syncId = typeof item.syncId === "string" ? item.syncId.trim() : "";
    const syncText = typeof item.syncText === "string" ? item.syncText : "";
    if (!storyText.trim() || !syncId || !syncText.trim()) continue;
    const names: Record<string, string> = {};
    if (item.names && typeof item.names === "object") {
      for (const [id, name] of Object.entries(item.names as Record<string, unknown>)) {
        if (id && typeof name === "string" && name.trim()) names[id] = name.trim().slice(0, 120);
      }
    }
    const translatedFrom = isBookLanguageId(item.translatedFrom as string) ? (item.translatedFrom as BookLanguageId) : undefined;
    const savedAt = typeof item.savedAt === "number" && Number.isFinite(item.savedAt) && item.savedAt > 0 ? item.savedAt : 0;
    out[locale] = {
      storyText,
      title: typeof item.title === "string" ? item.title.trim().slice(0, 200) : "",
      subtitle: typeof item.subtitle === "string" ? item.subtitle.trim().slice(0, 200) : "",
      names,
      syncId: syncId.slice(0, 60),
      syncText,
      ...(translatedFrom ? { translatedFrom } : {}),
      savedAt,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function storyLanguagesOf(project: Pick<Project, "storyLanguages">): Partial<Record<BookLanguageId, StoryLanguageVersion>> | undefined {
  return normalizeStoryLanguages(project.storyLanguages);
}

/** Whether `locale` tells the story that is on the book, is only kept from an older one, or was never written. */
export function languageStatus(project: Project, locale: string): LanguageStatus {
  const here = languageOf(project);
  if (locale === here) return "here";
  const versions = storyLanguagesOf(project);
  const kept = versions?.[locale as BookLanguageId];
  if (!kept || !kept.storyText.trim()) return "none";
  const mine = versions?.[here];
  if (!mine) return "stale";
  const sameStory = kept.syncId === mine.syncId && !isRealStoryChange(mine.syncText, project.config.storyText);
  return sameStory ? "current" : "stale";
}

/** Whether the book can move to `locale` by looking it up. */
export function hasCurrentVersion(project: Project, locale: string): boolean {
  return languageStatus(project, locale) === "current";
}

/**
 * The book with the words it has now kept for its language. Run before the
 * words are replaced. If they moved away from the story the other languages
 * were made from, this language starts a new story and the others stay behind.
 */
export function withLanguageRemembered(project: Project): Project {
  if (!project.config.storyText.trim()) return project;
  const here = languageOf(project);
  const text = project.config.storyText;
  const versions = { ...(storyLanguagesOf(project) ?? {}) };
  const prior = versions[here];
  const same = Boolean(prior) && !isRealStoryChange(prior!.syncText, text);
  versions[here] = {
    ...wordsOf(project),
    syncId: same ? prior!.syncId : newSyncId(),
    syncText: same ? prior!.syncText : text,
    ...(same && prior!.translatedFrom ? { translatedFrom: prior!.translatedFrom } : {}),
    savedAt: Date.now(),
  };
  return { ...project, storyLanguages: versions };
}

/**
 * The book after it was translated from `from`: the new words kept for the new
 * language, as part of the same story as the one they came from. `remembered`
 * is the book as `withLanguageRemembered` left it, `translated` is the book
 * with the translated words in place.
 */
export function withTranslationKept(
  remembered: Project,
  translated: Project,
  words: TranslatedStory,
  from: BookLanguageId,
): Project {
  const versions = storyLanguagesOf(remembered);
  const source = versions?.[from];
  if (!source) return translated;
  const to = languageOf(translated);
  const own = wordsOf(translated);
  return {
    ...translated,
    storyLanguages: {
      ...(versions ?? {}),
      [to]: {
        storyText: translated.config.storyText,
        title: words.title.trim() || own.title,
        subtitle: words.subtitle.trim(),
        names: namesOf(translated),
        syncId: source.syncId,
        syncText: translated.config.storyText,
        translatedFrom: from,
        savedAt: Date.now(),
      },
    },
  };
}

/**
 * The book moved into a language it already has, with nothing to translate;
 * null when that language is not current. The words that follow the story
 * come back whole, the rest of the book is as it was.
 */
export function withVersionRestored(project: Project, locale: BookLanguageId): Project | null {
  if (!hasCurrentVersion(project, locale)) return null;
  const remembered = withLanguageRemembered(project);
  const kept = storyLanguagesOf(remembered)?.[locale];
  if (!kept) return null;
  // Each person, place or thing the book calls something else now is renamed back to the kept words.
  const names: NamePair[] = [];
  for (const anchor of remembered.anchors ?? []) {
    const to = kept.names[anchor.id]?.trim();
    if (to && to !== anchor.name) names.push({ from: anchor.name, to });
  }
  let next = withTranslatedStory(
    remembered,
    { title: kept.title, subtitle: kept.subtitle, story: kept.storyText, names },
    locale,
  );
  // Who is in this story is already known; nothing about it needs reading again.
  if (next.analysis) next = { ...next, analysis: { ...next.analysis, sourceStoryText: kept.storyText } };
  const extraction = authoringOf(next).extraction;
  if (extraction) {
    next = withAuthoring(next, {
      extraction: { ...extraction, storyHash: manuscriptHash(kept.storyText) },
    });
  }
  return next;
}

/** Carry a rename across every kept language version so switching back keeps the new name. */
export function withStoryLanguagesRenamed(
  project: Project,
  swap: (text: string) => string,
): Project {
  const versions = storyLanguagesOf(project);
  if (!versions) return project;
  const next: Partial<Record<BookLanguageId, StoryLanguageVersion>> = {};
  for (const [locale, version] of Object.entries(versions) as [BookLanguageId, StoryLanguageVersion][]) {
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(version.names)) names[id] = swap(name);
    next[locale] = {
      ...version,
      storyText: swap(version.storyText),
      syncText: swap(version.syncText),
      title: swap(version.title),
      subtitle: swap(version.subtitle),
      names,
    };
  }
  return { ...project, storyLanguages: next };
}
