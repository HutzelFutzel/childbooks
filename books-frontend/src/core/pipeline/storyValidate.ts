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
}

/**
 * How far past the bounds we tolerate before asking for a rewrite. Models land
 * within ~15% reliably; rejecting tighter than that spends a second call to
 * move a story from 340 to 320 words, which no reader would notice.
 */
const WORD_TOLERANCE = 0.15;

function namePresent(story: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(story);
}

export function inspectDraft(
  story: string,
  brief: StoryBrief,
  structure: StoryStructureRules,
): DraftIssues {
  const words = wordCount(story);
  const floor = Math.round(structure.minWords * (1 - WORD_TOLERANCE));
  const ceiling = Math.round(structure.maxWords * (1 + WORD_TOLERANCE));
  const wordMiss = words < floor ? floor - words : words > ceiling ? words - ceiling : 0;

  // Both AI modes promise specific names (guided names its hero(es) directly;
  // co-write names its whole cast) — only the author's own text goes unchecked.
  const required =
    brief.mode === "co-write" ? namedCast(brief).map((c) => c.name.trim()) : namedHeroes(brief);
  const missingNames = required.filter((n) => !namePresent(story, n));

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

  return {
    repairInstruction: problems.length > 0 ? `${problems.join(", and ")}.` : "",
    wordMiss,
    missingNames,
  };
}

/** Score a draft's problems so the better of two attempts can be picked. */
export function issueScore(issues: DraftIssues): number {
  return issues.wordMiss + issues.missingNames.length * 1000;
}
