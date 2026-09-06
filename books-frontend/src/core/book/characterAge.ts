import { AGE_RANGES } from "../config/options";
import type { BodyPlan } from "../types";

type CharacterAgeClues = {
  name: string;
  description: string;
  bodyPlan?: BodyPlan | string | null;
};

/**
 * A transparent fallback for characters whose age is absent from both the
 * author's brief and the story analysis. Adult/family roles must never inherit
 * the child reader's age; that audience fallback is reserved for childlike
 * bipedal characters.
 */
export function defaultCharacterAge(
  character: CharacterAgeClues,
  ageRangeId: string,
): number {
  const text = `${character.name} ${character.description}`.toLowerCase();

  if (/\b(newborn|infant)\b/.test(text)) return 0;
  if (/\b(baby)\b/.test(text)) return 1;
  if (/\b(toddler)\b/.test(text)) return 2;
  if (/\b(preschooler|preschool child)\b/.test(text)) return 4;
  if (/\b(teen|teenager|adolescent)\b/.test(text)) return 15;
  if (/\b(grandma|grandmother|granny|nana|grandpa|grandfather|grandad|elderly|older adult)\b/.test(text)) {
    return 65;
  }
  if (/\b(mother|mom|mum|mama|father|dad|papa|parent|aunt|uncle|teacher|adult)\b/.test(text)) {
    return 35;
  }

  // For animals and creatures, a neutral mature age is more useful than the
  // book's human reading age and avoids distorting human height comparisons.
  if (character.bodyPlan && character.bodyPlan !== "bipedal") return 4;

  const range = AGE_RANGES.find((item) => item.id === ageRangeId);
  return range ? Math.round((range.min + range.max) / 2) : 6;
}
