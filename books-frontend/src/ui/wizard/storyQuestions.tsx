import { BookText, Palette, Users } from "lucide-react";
import { AGE_RANGES, ART_STYLE_PRESETS } from "../../core/config/options";
import { ageBandHasReadingModes, readingModeLabel } from "../../core/config/ageWritingCatalog";
import type { GuidedQuestion } from "./GuidedQuestions";
import { AudienceStep } from "./steps/AudienceStep";
import { StoryStep } from "./steps/StoryStep";
import { StyleStep } from "./steps/StyleStep";

function ageLabel(id: string): string {
  return AGE_RANGES.find((a) => a.id === id)?.label ?? id;
}

function styleLabel(presetId: string | null): string {
  return presetId ? ART_STYLE_PRESETS.find((s) => s.id === presetId)?.label ?? presetId : "Custom";
}

/**
 * The Story flow, one question after another: who it's for, the story itself,
 * and the art style. Physical size/format was intentionally moved out — those
 * belong to the Design step (see `designQuestions`).
 */
export const STORY_QUESTIONS: GuidedQuestion[] = [
  {
    id: "age",
    title: "Who is it for?",
    subtitle: "The age range guides reading level, sentence length, and pacing.",
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
    title: "Tell your story",
    subtitle: "Paste or write the story. You'll refine wording and pacing in later steps.",
    icon: BookText,
    isAnswered: (c) => c.storyText.trim().length >= 20,
    summary: (c) => {
      const words = c.storyText.trim() ? c.storyText.trim().split(/\s+/).length : 0;
      return words > 0 ? `${words} word${words === 1 ? "" : "s"} written` : "No story yet";
    },
    render: (props) => <StoryStep {...props} />,
  },
  {
    id: "style",
    title: "Pick an art style",
    subtitle: "Choose a base look. You can layer your own creative direction on top.",
    icon: Palette,
    isAnswered: (c) => Boolean(c.artStyle.presetId) || Boolean(c.artStyle.customDescription?.trim()),
    summary: (c) =>
      c.artStyle.customDescription?.trim()
        ? `${styleLabel(c.artStyle.presetId)} + custom`
        : styleLabel(c.artStyle.presetId),
    render: (props) => <StyleStep {...props} />,
  },
];
