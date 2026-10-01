/**
 * A character's age, kept the same in the cast and in the story.
 *
 * The cast card says Mia is six; the story may say "Mia, who was five years
 * old". Either can be edited, and neither may quietly contradict the other. Two
 * things live here, both pure:
 *
 * - The cast changed: `changePersonAge` writes the age everywhere it is kept
 *   (cast, anchors, portrait) and, when the story states a different age for that
 *   person, says what the story must now say. The story is rewritten as a
 *   reviewed revision, because "five years old" is also "her fifth birthday" and
 *   "the baby" — a find-and-replace would be wrong as often as right.
 * - The story changed: `ageMismatches` reads only statements that are
 *   unambiguous (a number of years or months, right beside the name) and offers
 *   to update the cast. An age the story implies, or a birthday during the
 *   story, is never turned into a fact.
 *
 * Statements are read in English and German; another language reads as "no
 * statement" and is left to the story revision.
 */
import { isPerson } from "../story/castKinds";
import type { Project, StoryCastMember } from "../types";
import { withMemberChanges } from "./agent/commands/shared";
import { castOf, foldName } from "./agent/resolve";
import { nameOccurrences } from "./nameText";
import { authoringOf } from "./projectState";

export interface AgeValue {
  /** Whole years. */
  age?: number;
  /** Months, for the very young. */
  ageMonths?: number;
}

export type AgeUnit = "years" | "months";

/** An age the story states, and the person it is stated about. */
export interface AgeStatement {
  name: string;
  value: number;
  unit: AgeUnit;
  start: number;
  end: number;
}

interface AgeClaim {
  value: number;
  unit: AgeUnit;
  start: number;
  end: number;
}

// --- Reading numbers and claims ------------------------------------------------------

const WORDS = new Map<string, number>(
  Object.entries({
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90,
    ein: 1, eins: 1, eine: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6,
    sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, dreizehn: 13, vierzehn: 14,
    fünfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20,
  }),
);

const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";

/** "6", "six" and "twenty-five" as a number; null when the word is not one. */
function numberOf(token: string): number | null {
  const word = token.trim().toLowerCase().replace(/-$/, "");
  if (/^\d{1,3}$/.test(word)) return Number(word);
  const direct = WORDS.get(word);
  if (direct !== undefined) return direct;
  const compound = word.match(new RegExp(`^(${TENS})[\\s-]+(\\p{L}+)$`, "u"));
  if (compound) {
    const ones = WORDS.get(compound[2]!);
    if (ones !== undefined && ones > 0 && ones < 10) return WORDS.get(compound[1]!)! + ones;
  }
  return null;
}

const NUMBER = `\\d{1,3}|(?:${TENS})[\\s-]+\\p{L}+|\\p{L}+`;

/** "five years old", "a 5-year-old", "9 months old", "fünf Jahre alt". */
const NUMBER_UNIT_OLD = new RegExp(
  `(?<![\\p{L}\\p{N}])(${NUMBER})[\\s-]+(years?|yrs?|months?|jahre?|monate?)[\\s-]+(?:old|alt)(?![\\p{L}])`,
  "giu",
);
/** The German adjective: "die fünfjährige Mia", "ein sechsmonatiges Baby". */
const ADJECTIVE_DE = /(?<![\p{L}\p{N}])(\d{1,3}-?|\p{L}+?)(j(?:ä|ae)hrig|monatig)\p{L}*/giu;
/** "Mia, aged five". */
const AGED = /(?<![\p{L}\p{N}])aged\s+(\d{1,3}|\p{L}+)(?![\p{L}\p{N}])/giu;

function unitOf(word: string): AgeUnit {
  return /^(month|monat)/i.test(word) ? "months" : "years";
}

/** Every age the text states, with no person attached yet. */
function ageClaims(text: string): AgeClaim[] {
  const claims: AgeClaim[] = [];
  const add = (match: RegExpExecArray, token: string, unit: AgeUnit) => {
    const value = numberOf(token);
    if (value === null || value > 120) return;
    if (unit === "years" && value === 0) return;
    claims.push({ value, unit, start: match.index, end: match.index + match[0].length });
  };
  for (const match of text.matchAll(NUMBER_UNIT_OLD)) add(match, match[1]!, unitOf(match[2]!));
  for (const match of text.matchAll(ADJECTIVE_DE)) add(match, match[1]!, unitOf(match[2]!));
  for (const match of text.matchAll(AGED)) add(match, match[1]!, "years");
  return claims.sort((a, b) => a.start - b.start);
}

// --- Whose age it is -----------------------------------------------------------------

const BEFORE_NAME = /^[\s,(]*(?:(?:who|she|he|they|sie|er)\s+)?(?:(?:is|was|are|were|ist|war|sind|waren)\s+)?(?:(?:now|jetzt|nun)\s+)?(?:(?:a|an|ein|eine)\s+)?$/iu;
const AFTER_NAME = /^\s+(?:\p{L}+\s+)?(?:(?:named|called|namens|genannt)\s+)?$/iu;

function sentenceBounds(text: string, start: number, end: number): { from: number; to: number } {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n")) + 1;
  const ahead = text.slice(end).search(/[.!?\n]/);
  return { from, to: ahead < 0 ? text.length : end + ahead + 1 };
}

function paragraphStart(text: string, position: number): number {
  let start = 0;
  for (const match of text.matchAll(/\n\s*\n/g)) {
    const end = match.index + match[0].length;
    if (end > position) break;
    start = end;
  }
  return start;
}

/**
 * The ages the story states, each given to a person.
 *
 * `adjacent` is for what may be written to the cast: the number must sit right
 * beside the name ("Mia was five years old", "five-year-old Mia"). `nearby` is for
 * deciding whether the story needs a look: the name in the same sentence, or the
 * last one named in the paragraph ("Mia ran. She was five years old.").
 */
export function ageStatements(text: string, names: readonly string[], mode: "adjacent" | "nearby"): AgeStatement[] {
  const claims = ageClaims(text);
  if (claims.length === 0) return [];
  const spots = names
    .filter((name) => name.trim())
    .flatMap((name) => nameOccurrences(text, name).map((spot) => ({ ...spot, name: name.trim() })));
  const found: AgeStatement[] = [];
  for (const claim of claims) {
    let owner: string | undefined;
    if (mode === "adjacent") {
      owner = spots.find(
        (spot) =>
          (spot.end <= claim.start && claim.start - spot.end <= 50 && BEFORE_NAME.test(text.slice(spot.end, claim.start))) ||
          (spot.start >= claim.end && spot.start - claim.end <= 40 && AFTER_NAME.test(text.slice(claim.end, spot.start))),
      )?.name;
    } else {
      const sentence = sentenceBounds(text, claim.start, claim.end);
      const inSentence = spots
        .filter((spot) => spot.start >= sentence.from && spot.end <= sentence.to)
        .sort((a, b) => Math.abs(a.start - claim.start) - Math.abs(b.start - claim.start));
      if (inSentence.length > 0) owner = inSentence[0]!.name;
      else {
        const floor = paragraphStart(text, claim.start);
        owner = spots
          .filter((spot) => spot.start >= floor && spot.end <= claim.start)
          .sort((a, b) => b.end - a.end)[0]?.name;
      }
    }
    if (owner) found.push({ ...claim, name: owner });
  }
  return found;
}

// --- Comparing -----------------------------------------------------------------------

export function hasStatedAge(member: Pick<StoryCastMember, "age" | "ageMonths">): boolean {
  return member.age !== undefined || member.ageMonths !== undefined;
}

/** Whether a statement in the story says the age the cast has. */
export function statementAgrees(statement: Pick<AgeStatement, "value" | "unit">, age: AgeValue): boolean {
  if (age.ageMonths !== undefined) {
    return statement.unit === "months" ? statement.value === age.ageMonths : Math.floor(age.ageMonths / 12) === statement.value;
  }
  if (age.age !== undefined) {
    return statement.unit === "years" ? statement.value === age.age : Math.floor(statement.value / 12) === age.age;
  }
  return false;
}

/** The cast's form of an age the story states: whole years, or months for the very young. */
function valueOfStatement(statement: Pick<AgeStatement, "value" | "unit">): AgeValue {
  if (statement.unit === "years") return { age: statement.value };
  return statement.value <= 36 ? { ageMonths: statement.value } : { age: Math.floor(statement.value / 12) };
}

export function describeAge(age: AgeValue): string {
  if (age.ageMonths !== undefined && age.age === undefined) return `${age.ageMonths} months`;
  const years = age.age ?? 0;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

function castNames(project: Project): string[] {
  return castOf(project).map((member) => member.name.trim());
}

function storyIdle(project: Project): boolean {
  return authoringOf(project).storyRun?.status !== "running";
}

// --- The cast changed ----------------------------------------------------------------

/** What to ask the story revision to do once a person's age has changed. */
export function ageRevisionInstruction(name: string, age: AgeValue): string {
  const shown = describeAge(age);
  return (
    `${name} is now ${shown} old. Wherever the story states or clearly implies ${name}'s age ` +
    `(for example "five years old", a birthday, or being the baby), change it so it fits ${shown}. ` +
    "Change nothing else, and keep everything else as close to the original as possible."
  );
}

export interface AgeChange {
  project: Project;
  /** The revision to ask for, when the story states a different age for this person. */
  revise: string | null;
}

/**
 * Set a person's age in the cast, and say what the story needs when it states
 * another one. Clearing an age (neither field set) never asks for a rewrite.
 */
export function changePersonAge(project: Project, memberId: string, age: AgeValue): AgeChange | null {
  const member = castOf(project).find((candidate) => candidate.id === memberId);
  if (!member) return null;
  const next = withMemberChanges(project, memberId, { age: age.age, ageMonths: age.ageMonths });
  const key = foldName(member.name);
  const differing =
    hasStatedAge(age) && storyIdle(project)
      ? ageStatements(project.config.storyText, castNames(project), "nearby").filter(
          (statement) => foldName(statement.name) === key && !statementAgrees(statement, age),
        )
      : [];
  return { project: next, revise: differing.length > 0 ? ageRevisionInstruction(member.name.trim(), age) : null };
}

// --- The story changed ---------------------------------------------------------------

/** The story and the cast say different ages for someone (or the cast says none yet). */
export interface AgeMismatch {
  castId: string;
  name: string;
  /** What the story states. */
  story: AgeValue;
  /** What the cast has; absent when nobody has said yet. */
  cast?: AgeValue;
  /** The sentence in the story that says it. */
  quote: string;
}

/**
 * People whose age the story states plainly and the cast does not agree with.
 * A person the story states two different ages for is left out: that is the
 * story's own business.
 */
export function ageMismatches(project: Project): AgeMismatch[] {
  const text = project.config.storyText;
  if (!text.trim()) return [];
  const people = castOf(project).filter((member) => isPerson(member));
  const statements = ageStatements(text, people.map((member) => member.name.trim()), "adjacent");
  const mismatches: AgeMismatch[] = [];
  for (const member of people) {
    const key = foldName(member.name);
    const about = statements.filter((statement) => foldName(statement.name) === key);
    if (about.length === 0) continue;
    const first = about[0]!;
    if (about.some((statement) => !statementAgrees(statement, valueOfStatement(first)))) continue;
    const cast: AgeValue | undefined = hasStatedAge(member) ? { age: member.age, ageMonths: member.ageMonths } : undefined;
    if (cast && statementAgrees(first, cast)) continue;
    const sentence = sentenceBounds(text, first.start, first.end);
    mismatches.push({
      castId: member.id,
      name: member.name.trim(),
      story: valueOfStatement(first),
      ...(cast ? { cast } : {}),
      quote: text.slice(sentence.from, sentence.to).trim().slice(0, 160),
    });
  }
  return mismatches;
}
