/**
 * Deterministic checks on a generated draft.
 *
 * The model writes the prose; these rules catch the things it is measurably
 * unreliable at — length, and silently dropping a name the author gave us. A
 * failure here becomes the `repairInstruction` for exactly one retry, which is
 * far cheaper and more predictable than hoping a longer prompt lands.
 */
import type { StoryBrief } from "../types";
import type { StoryStructureRules } from "../config/storyCraftCatalog";
import { namedCast, namedHeroes, wordCount } from "../story/brief";

export interface DraftIssues {
  /** Sentence handed to the retry prompt; empty when the draft is acceptable. */
  repairInstruction: string;
  /** How far outside the word bounds the draft is (0 when inside). */
  wordMiss: number;
  missingNames: string[];
  /**
   * Sentences over the band's ceiling. The ceiling was already in the prompt
   * and never verified, which for the youngest bands is the difference between
   * a board book and a paragraph broken across pictures.
   */
  longSentences: number;
  /** The worst offender's length, for a specific rather than generic retry. */
  longestSentenceWords: number;
}

/**
 * Split on sentence-ending punctuation, keeping it simple on purpose: this
 * feeds a word-count heuristic, not a linguistic analysis, and an abbreviation
 * counted as a sentence break only ever makes the check more lenient.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])[\s\n]+|\n{2,}/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * How far over the ceiling a sentence has to be before it counts, and how many
 * may exceed it before a rewrite is worth a second call. A single long line in
 * a 500-word story is a stylistic choice; a third of them is a miscalibration.
 */
const SENTENCE_TOLERANCE = 1.25;
const SENTENCE_MISS_SHARE = 0.2;

/**
 * How far past the bounds we tolerate before asking for a rewrite. Models land
 * within ~15% reliably; rejecting tighter than that spends a second call to
 * move a story from 340 to 320 words, which no reader would notice.
 */
const WORD_TOLERANCE = 0.15;

function namePresent(story: string, name: string, locale?: string): boolean {
  const normalizedName = name.normalize("NFC").toLocaleLowerCase(locale);
  const normalizedStory = story.normalize("NFC").toLocaleLowerCase(locale);
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{M}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{M}\\p{N}])`,
    "u",
  ).test(normalizedStory);
}

/** A block with two or more short lines and no long ones is a stanza of verse. */
function isStanzaBlock(block: string): boolean {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length >= 2 && lines.every((line) => wordCount(line) <= 18);
}

function stanzasOf(text: string): number {
  const blocks = text
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const stanzas = blocks.filter(isStanzaBlock).length;
  return stanzas >= 2 && stanzas >= Math.ceil(blocks.length * 0.6) ? stanzas : 0;
}

export interface TranslationIssues {
  repairInstruction: string;
  wordMiss: number;
  longSentences: number;
  stanzaMiss: number;
  untranslated: boolean;
}

/**
 * Deterministic checks on a translated story: it actually moved out of the
 * source words, kept verse as verse (the same stanzas, not flattened into
 * prose), and stayed inside the target language's length and sentence bounds.
 * An own-words story has no length bound of ours, so its length is measured
 * against the source story (scaled for the target language) instead.
 */
export function inspectTranslation(input: {
  sourceStory: string;
  translatedStory: string;
  structure: StoryStructureRules;
  checkLength: boolean;
  wordCountFactor?: number;
  sameLanguage?: boolean;
}): TranslationIssues {
  const { sourceStory, translatedStory, structure, checkLength, wordCountFactor = 1, sameLanguage = false } = input;
  const words = wordCount(translatedStory);
  const sourceWords = wordCount(sourceStory);
  // Own words: keep within half to double the source's scaled length so a dropped half or a runaway expansion is caught.
  const floor = checkLength
    ? Math.round(structure.minWords * (1 - WORD_TOLERANCE))
    : Math.max(10, Math.round(sourceWords * wordCountFactor * 0.5));
  const ceiling = checkLength
    ? Math.round(structure.maxWords * (1 + WORD_TOLERANCE))
    : Math.max(40, Math.round(sourceWords * wordCountFactor * 1.8));
  const wordMiss = words < floor ? floor - words : words > ceiling ? words - ceiling : 0;

  const sourceStanzas = stanzasOf(sourceStory);
  const translatedStanzas = sourceStanzas > 0 ? stanzasOf(translatedStory) : 0;
  const stanzaMiss = sourceStanzas > 0 ? Math.abs(sourceStanzas - translatedStanzas) : 0;

  // Verse is measured by its lines; prose by its sentences.
  const sentences = sourceStanzas > 0 ? [] : splitSentences(translatedStory);
  const limit = structure.maxSentenceWords;
  const overLimit = limit > 0 ? Math.round(limit * SENTENCE_TOLERANCE) : 0;
  const sentenceLengths = sentences.map((s) => wordCount(s));
  const longestSentenceWords = sentenceLengths.reduce((a, b) => Math.max(a, b), 0);
  const longSentences = overLimit > 0 ? sentenceLengths.filter((n) => n > overLimit).length : 0;
  const tooManyLong = sentences.length > 0 && longSentences > Math.max(1, sentences.length * SENTENCE_MISS_SHARE);

  const norm = (value: string) => value.replace(/\s+/gu, " ").trim().toLowerCase();
  const untranslated = !sameLanguage && sourceWords >= 6 && norm(sourceStory) === norm(translatedStory);

  const problems: string[] = [];
  if (untranslated) {
    problems.push("it returned the original text without translating it into the target language");
  }
  if (stanzaMiss > 0) {
    problems.push(
      translatedStanzas === 0
        ? `the original is verse in ${sourceStanzas} stanzas with one line per verse line, and the translation flattened it into prose — keep the ${sourceStanzas} stanzas with a line break after each verse line and a blank line between stanzas`
        : `the original has ${sourceStanzas} stanzas and the translation has ${translatedStanzas} — keep all ${sourceStanzas} stanzas intact`,
    );
  }
  if (wordMiss > 0) {
    problems.push(
      checkLength
        ? words > ceiling
          ? `it was ${words} words, which is too long for this age — keep it between ${structure.minWords} and ${structure.maxWords} words`
          : `it was only ${words} words, which is too short for this age — keep it between ${structure.minWords} and ${structure.maxWords} words`
        : words > ceiling
          ? `it expanded a ${sourceWords}-word story to ${words} words — keep it close to the original length`
          : `it cut a ${sourceWords}-word story down to ${words} words — translate the complete story without dropping scenes`,
    );
  }
  if (tooManyLong) {
    problems.push(
      `${longSentences} of its ${sentences.length} sentences run well past the ${limit}-word limit for this age (the longest is ${longestSentenceWords} words) — break them into shorter ones`,
    );
  }

  return {
    repairInstruction: problems.length > 0 ? `${problems.join(", and ")}.` : "",
    wordMiss,
    longSentences: tooManyLong ? longSentences : 0,
    stanzaMiss,
    untranslated,
  };
}

export function translationIssueScore(issues: TranslationIssues): number {
  return (issues.untranslated ? 10_000 : 0) + issues.stanzaMiss * 400 + issues.longSentences * 25 + issues.wordMiss;
}

export function inspectDraft(
  story: string,
  brief: StoryBrief,
  structure: StoryStructureRules,
  locale?: string,
): DraftIssues {
  const words = wordCount(story);
  const floor = Math.round(structure.minWords * (1 - WORD_TOLERANCE));
  const ceiling = Math.round(structure.maxWords * (1 + WORD_TOLERANCE));
  const wordMiss = words < floor ? floor - words : words > ceiling ? words - ceiling : 0;

  // Both AI modes promise specific names (guided names its hero(es) directly;
  // co-write names its whole cast) — only the author's own text goes unchecked.
  const required =
    brief.mode === "co-write" ? namedCast(brief).map((c) => c.name.trim()) : namedHeroes(brief);
  const missingNames = required.filter((n) => !namePresent(story, n, locale));

  const sentences = splitSentences(story);
  const limit = structure.maxSentenceWords;
  const overLimit = limit > 0 ? Math.round(limit * SENTENCE_TOLERANCE) : 0;
  const sentenceLengths = sentences.map((s) => wordCount(s));
  const longestSentenceWords = sentenceLengths.reduce((a, b) => Math.max(a, b), 0);
  const longSentences =
    overLimit > 0 ? sentenceLengths.filter((n) => n > overLimit).length : 0;
  const tooManyLong =
    sentences.length > 0 && longSentences > Math.max(1, sentences.length * SENTENCE_MISS_SHARE);

  const problems: string[] = [];
  if (wordMiss > 0) {
    problems.push(
      words > ceiling
        ? `it was ${words} words, which is too long for this age — the story must be between ${structure.minWords} and ${structure.maxWords} words`
        : `it was only ${words} words, which is too short for this age — the story must be between ${structure.minWords} and ${structure.maxWords} words`,
    );
  }
  if (missingNames.length > 0) {
    problems.push(
      `it left out ${missingNames.join(", ")}, who must appear by name and spelled exactly that way`,
    );
  }
  if (tooManyLong) {
    problems.push(
      `${longSentences} of its ${sentences.length} sentences run well past the ${limit}-word limit for this age (the longest is ${longestSentenceWords} words) — break them into shorter ones`,
    );
  }

  return {
    repairInstruction: problems.length > 0 ? `${problems.join(", and ")}.` : "",
    wordMiss,
    missingNames,
    longSentences: tooManyLong ? longSentences : 0,
    longestSentenceWords,
  };
}

/**
 * Score a draft's problems so the better of two attempts can be picked.
 *
 * A missing name still dominates — a personalised book without the child in it
 * is worthless — with sentence-length misses weighted between that and the
 * word-count miss they'd otherwise be invisible next to.
 */
export function issueScore(issues: DraftIssues): number {
  return issues.wordMiss + issues.longSentences * 25 + issues.missingNames.length * 1000;
}
