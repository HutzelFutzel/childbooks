/**
 * Static catalog for age-band writing guidance: structure, labels, and built-in
 * defaults. Admin overrides live in `appConfig/ageWriting` (`AgeWritingConfig`).
 */
import { AGE_RANGES, type AgeRange } from "./options";

export type AgeBandId = (typeof AGE_RANGES)[number]["id"];
export type ReadingModeId = "read-aloud" | "with-help" | "independent";

export interface GuidancePair {
  /** Shown in the setup wizard and review UI. */
  humanGuidance: string;
  /** Injected into screenplay and story-analysis LLM calls. */
  llmGuidance: string;
}

export interface AgeBandWriting {
  guidance?: GuidancePair;
  readingModes?: Partial<Record<ReadingModeId, GuidancePair>>;
}

export const READING_MODES: { id: ReadingModeId; label: string; shortLabel: string }[] = [
  { id: "read-aloud", label: "Adult reads aloud", shortLabel: "Read aloud" },
  { id: "with-help", label: "Child reads with help", shortLabel: "With help" },
  { id: "independent", label: "Child reads independently", shortLabel: "Independent" },
];

export function ageBandHasReadingModes(ageRangeId: string): boolean {
  return ageRangeId === "6-8" || ageRangeId === "9-12";
}

export function isReadingModeId(value: string): value is ReadingModeId {
  return READING_MODES.some((m) => m.id === value);
}

export function readingModeLabel(id: ReadingModeId | string | null | undefined): string {
  return READING_MODES.find((m) => m.id === id)?.label ?? "";
}

/** Built-in defaults keyed by age band id. */
export const DEFAULT_AGE_BAND_WRITING: Record<AgeBandId, AgeBandWriting> = {
  "0-2": {
    guidance: {
      humanGuidance:
        "Board-book simplicity: a few words per page, bold shapes, warm and reassuring.",
      llmGuidance:
        "TEXT GUIDANCE (0–2): Board-book language. Use 1–4 words per page, or a single very short phrase (max 6 words). Prefer concrete nouns and active verbs the child knows: run, hug, moon, dog, splash. Use repetition and parallel structure (\"Up, up, up!\" / \"Down, down, down!\"). Rhyme and rhythm are welcome but not required. One clear idea per page. Avoid abstract concepts, moral lessons, subordinate clauses, and words over two syllables unless very familiar (banana, elephant). Emotional tone: safe, warm, reassuring. No fear, loss, or conflict beyond mild surprise resolved immediately. When splitting the author's story, prioritize sensory moments and simple cause-effect.",
    },
  },
  "3-5": {
    guidance: {
      humanGuidance:
        "Picture-book read-aloud: short sentences, playful rhythm, lots of imagery.",
      llmGuidance:
        "TEXT GUIDANCE (3–5): Picture-book language for read-aloud. Use 1–2 short sentences per page (roughly 8–20 words total). Favor simple sentences; occasional compound sentences with \"and\" or \"but\" are fine. Vocabulary: everyday words plus a few stretch words explained by context. Allow playful sound words, dialogue in quotes, and gentle repetition for rhythm. One story beat per page; clear who is doing what. Themes: friendship, curiosity, bedtime, family, animals, everyday adventures. Mild tension is OK if resolved warmly on the same or next page. Avoid long paragraphs, nested clauses, sarcasm, irony, or abstract philosophy. Preserve the author's plot but simplify wording and sharpen page-turn hooks.",
    },
  },
  "6-8": {
    readingModes: {
      "read-aloud": {
        humanGuidance:
          "Richer story for listening: an adult reads while the child follows the pictures. Longer sentences and more descriptive language are fine.",
        llmGuidance:
          "TEXT GUIDANCE (6–8 · adult read-aloud): Write for listening, not solo reading. Use 2–4 sentences per page (roughly 30–70 words). Vocabulary can be richer and sentences slightly longer than early-reader text; the adult carries difficult words. Include vivid description and natural dialogue. One clear story beat per page. Humor, mystery, and light suspense are OK if age-safe. Avoid mature themes. Preserve the author's plot; polish rhythm for read-aloud flow.",
      },
      "with-help": {
        humanGuidance:
          "Early reader with support: the child reads most words while an adult helps with harder vocabulary and longer sentences.",
        llmGuidance:
          "TEXT GUIDANCE (6–8 · child reads with help): Early reader with adult support. Use 2–3 sentences per page (roughly 25–50 words). Mostly short and medium sentences; limit rare words — when used, make meaning clear from context. Dialogue should be simple and distinct. Clear who is doing what each page. Avoid nested clauses and academic tone. When adapting text, simplify hard words but keep plot and character motivations.",
      },
      independent: {
        humanGuidance:
          "Confident early reader: the child reads on their own. Shorter sentences, familiar vocabulary, clear action on every page.",
        llmGuidance:
          "TEXT GUIDANCE (6–8 · child reads independently): Confident early independent reader. Use 2–3 short sentences per page (roughly 20–45 words). Favor high-frequency vocabulary; introduce at most one new word per page with a strong context clue. Keep syntax straightforward. Strong action verbs and clear subjects. Satisfying page-end beats. Avoid paragraphs longer than 3 sentences and mature themes.",
      },
    },
  },
  "9-12": {
    readingModes: {
      "read-aloud": {
        humanGuidance:
          "Family read-aloud or bedtime: richer language and longer passages — the adult reads while the child enjoys the art.",
        llmGuidance:
          "TEXT GUIDANCE (9–12 · adult read-aloud): Write for listening by an adult. Use 3–6 sentences per page (roughly 60–130 words). Sophisticated vocabulary and varied syntax welcome; foreshadowing and interiority OK. Dialogue with personality and subtext. Themes: identity, belonging, courage — nuanced but hopeful. Avoid graphic violence, sexual content, and slurs. Respect the author's voice; refine for rhythm and read-aloud pacing.",
      },
      "with-help": {
        humanGuidance:
          "Upper elementary reader with occasional help: engaging plot with mostly accessible language and some stretch vocabulary.",
        llmGuidance:
          "TEXT GUIDANCE (9–12 · child reads with help): Upper elementary reader with adult support on hard words. Use 3–5 sentences per page (roughly 45–90 words). Mix sentence lengths; explain or contextualize challenging vocabulary. Clear scene goals and emotional beats. Dialogue natural but not overly subtle. Avoid graphic content and nihilistic tone. Adapt advanced source text toward clarity without losing plot.",
      },
      independent: {
        humanGuidance:
          "Tween reads solo: chapter-book density with clear prose, strong hooks, and age-appropriate complexity.",
        llmGuidance:
          "TEXT GUIDANCE (9–12 · child reads independently): Tween independent reader. Use 3–5 sentences per page (roughly 50–100 words). Accessible but not dumbed-down — clear syntax, strong verbs, vivid but concrete description. Subplots and foreshadowing OK if easy to follow page to page. Dialogue distinct per character. Avoid graphic violence, sexual content, slurs, and overly abstract philosophy. Preserve plot; tighten pacing for solo reading.",
      },
    },
  },
};

export function defaultAgeBandWriting(ageRangeId: string): AgeBandWriting {
  return DEFAULT_AGE_BAND_WRITING[ageRangeId as AgeBandId] ?? {};
}

/** Short card blurb for the age picker (younger bands only). */
export function defaultAgeCardDescription(age: AgeRange): string {
  const band = DEFAULT_AGE_BAND_WRITING[age.id as AgeBandId];
  return band.guidance?.humanGuidance ?? age.description;
}
