/**
 * The story in another language, after it was written and before any page is drawn.
 *
 * Only the words change. Who is in the story, what happens, the brief, the age,
 * the look and the portraits are the book's own and stay exactly as they are;
 * the story, its title and the cover words that were written in the old
 * language are carried into the new one. The page plan and the reading of who is
 * in the story are made from the story's words, so the pipeline reruns them
 * from the new text the way it does after any real change.
 */
import { applyBookTitle, applyCoverLine } from "../book/coverEdits";
import { coverLinesOf } from "../book/coverLines";
import type { BookLanguageId } from "../config/bookLanguages";
import { briefOf, isDraftStale, storyBriefSignature } from "../story/brief";
import type { Project, StoryBrief } from "../types";
import { authorIdeas } from "./coverWords";
import { authoringOf, withAuthoring } from "./projectState";

/** The words the translation returns. An empty one is "none". */
export interface TranslatedStory {
  title: string;
  subtitle: string;
  story: string;
}

/**
 * The author line the new language says the same way ("Mama & Papa" for "Mom & Dad").
 * Only a line the guide itself suggested is carried over; one the reader typed stays.
 */
function authorInto(project: Project, locale: BookLanguageId): string | null {
  const author = coverLinesOf(project).author;
  if (!author) return null;
  const before = authorIdeas(project);
  const after = authorIdeas({ ...project, config: { ...project.config, contentLocale: locale } });
  const at = before.indexOf(author);
  if (at < 0 || before.length !== after.length) return null;
  return after[at] ?? null;
}

/** The brief of a draft that was current stays current: the same story, in the new language. */
function briefInto(project: Project, locale: BookLanguageId): StoryBrief {
  const brief = briefOf(project.config);
  const { storyText, ageRangeId, readingModeId, contentLocale } = project.config;
  const current = Boolean(brief.generatedSignature) && !isDraftStale(brief, storyText, ageRangeId, readingModeId, contentLocale);
  if (!current) return brief;
  const generatedForLocale = brief.generatedForLocale ? locale : undefined;
  return {
    ...brief,
    ...(generatedForLocale ? { generatedForLocale } : {}),
    generatedSignature: storyBriefSignature(brief, ageRangeId, readingModeId, generatedForLocale),
  };
}

/** Whether the story may be carried into another language: it exists and no page is drawn. */
export function canTranslateStory(project: Project): boolean {
  return (
    project.config.storyText.trim().length >= 5 &&
    authoringOf(project).lockedAt === undefined &&
    authoringOf(project).storyRun?.status !== "running"
  );
}

/** The book with the translated words in place of the old ones, and nothing else changed. */
export function withTranslatedStory(project: Project, translated: TranslatedStory, locale: BookLanguageId): Project {
  const author = authorInto(project, locale);
  const chosenSubtitle = authoringOf(project).cover?.subtitle?.trim();
  const storyBrief = briefInto(project, locale);

  let next: Project = {
    ...project,
    config: { ...project.config, contentLocale: locale, storyText: translated.story, storyBrief },
  };
  if (translated.title) next = applyBookTitle(next, translated.title);
  // A subtitle the reader chose is carried over; one only the page plan invented is made again by the plan.
  if (chosenSubtitle) next = applyCoverLine(next, "subtitle", translated.subtitle);
  if (author) next = applyCoverLine(next, "author", author);
  return withAuthoring(next, {
    cover: {
      ...authoringOf(next).cover,
      // Ideas written in the old language are no use; the cover words are asked about again.
      subtitleIdeas: undefined,
      confirmedAt: undefined,
    },
  });
}
