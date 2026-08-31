import { BookText, Languages, Users } from "lucide-react";
import { AGE_RANGES } from "../../core/config/options";
import { getBookLanguage, isBookLanguageId } from "../../core/config/bookLanguages";
import { wordCount } from "../../core/story/brief";
import { ageBandHasReadingModes, readingModeLabel } from "../../core/config/ageWritingCatalog";
import { storyModeInfo } from "../../core/config/storyCraftCatalog";
import type { GuidedQuestion } from "./GuidedQuestions";
import { AudienceStep } from "./steps/AudienceStep";
import { LanguageStep } from "./steps/LanguageStep";
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
    id: "language",
    title: "What language does your little reader speak?",
    subtitle:
      "Pick the language your child loves listening to for their adventure.",
    icon: Languages,
    isAnswered: (config) => isBookLanguageId(config.contentLocale ?? "en-US"),
    summary: (config) => {
      const lang = getBookLanguage(config.contentLocale);
      return `${lang.flag} ${lang.endonym} · ${lang.regionShort}`;
    },
    render: (props) => <LanguageStep {...props} />,
  },
  {
    id: "age",
    title: "Who will treasure this book?",
    subtitle: "We’ll match the words, pacing, and picture density to their age — so it feels written just for them.",
    icon: Users,
    isAnswered: (c) =>
      Boolean(c.ageRangeId) && (!ageBandHasReadingModes(c.ageRangeId) || Boolean(c.readingModeId)),
    summary: (c) =>
      ageBandHasReadingModes(c.ageRangeId) && c.readingModeId
        ? `${ageLabel(c.ageRangeId)} · ${readingModeLabel(c.readingModeId)}`
        : ageLabel(c.ageRangeId),
    render: (props) => <AudienceStep {...props} />,
  },
  {
    id: "story",
    title: "What’s the story?",
    subtitle:
      "Let us write it, build it together from your own details, or bring your own words — you’ll shape every page in the studio next.",
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
