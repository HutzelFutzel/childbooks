import { BookText, Users } from "lucide-react";
import { AGE_RANGES } from "../../core/config/options";
import { ageBandHasReadingModes, readingModeLabel } from "../../core/config/ageWritingCatalog";
import { storyModeInfo } from "../../core/config/storyCraftCatalog";
import type { GuidedQuestion } from "./GuidedQuestions";
import { AudienceStep } from "./steps/AudienceStep";
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
      const words = c.storyText.trim() ? c.storyText.trim().split(/\s+/).length : 0;
      if (words > 0) return `${words} word${words === 1 ? "" : "s"} written`;
      return c.storyBrief ? storyModeInfo(c.storyBrief.mode).label : "No story yet";
    },
    render: (props) => <StoryStep {...props} />,
  },
];
