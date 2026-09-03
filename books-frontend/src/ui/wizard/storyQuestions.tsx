import { BookText, Users } from "lucide-react";
import { AGE_RANGES } from "../../core/config/options";
import { getBookLanguage, isBookLanguageId } from "../../core/config/bookLanguages";
import { wordCount } from "../../core/story/brief";
import { ageBandHasReadingModes, readingModeLabel } from "../../core/config/ageWritingCatalog";
import { storyModeInfo } from "../../core/config/storyCraftCatalog";
import type { GuidedQuestion } from "./GuidedQuestions";
import { ReaderStep } from "./steps/ReaderStep";
import { StoryStep } from "./steps/StoryStep";

function ageLabel(id: string): string {
  return AGE_RANGES.find((a) => a.id === id)?.label ?? id;
}

/**
 * The Story flow: who it's for, then the story itself. Art style lives in
 * Design · Cast (confirmed before the first reference images are made).
 */
export const STORY_QUESTIONS: GuidedQuestion[] = [
  {
    id: "reader",
    title: "Language & reading level",
    subtitle: "Choose the language and reading level for this book.",
    icon: Users,
    isAnswered: (config) =>
      isBookLanguageId(config.contentLocale ?? "en-US") &&
      Boolean(config.ageRangeId) &&
      (!ageBandHasReadingModes(config.ageRangeId) || Boolean(config.readingModeId)),
    summary: (config) => {
      const lang = getBookLanguage(config.contentLocale);
      const age = ageBandHasReadingModes(config.ageRangeId) && config.readingModeId
        ? `${ageLabel(config.ageRangeId)} · ${readingModeLabel(config.readingModeId)}`
        : ageLabel(config.ageRangeId);
      return `${lang.endonym} · ${age}`;
    },
    render: (props) => <ReaderStep {...props} />,
  },
  {
    id: "story",
    title: "Create your story",
    subtitle: "Start with a little help or bring your own words.",
    icon: BookText,
    isAnswered: (c) => c.storyText.trim().length >= 20,
    summary: (c) => {
      const words = wordCount(c.storyText);
      if (words > 0) return `${words} word${words === 1 ? "" : "s"} written`;
      return c.storyBrief ? storyModeInfo(c.storyBrief.mode).label : "No story yet";
    },
    render: (props) => <StoryStep {...props} />,
  },
];
