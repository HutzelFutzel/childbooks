/**
 * Read a typed list of children out of a message, without a model.
 *
 * "maya 3, thorsten 1, nils 2" is how parents actually answer "who is this for",
 * and it is too regular to wait on an interpreter that may classify it as chat
 * and drop the patch. The model still handles the messy cases — "my daughter and
 * her baby brother" — this only claims the lists that already look like lists.
 */
import { splitHeroNames } from "../story/brief";

export interface ParsedPerson {
  name: string;
  age?: number;
  ageMonths?: number;
}

/** Words that are answers, not names. */
const STOP = new Set([
  "a",
  "an",
  "and",
  "for",
  "he",
  "he's",
  "hello",
  "her",
  "hey",
  "hi",
  "him",
  "his",
  "i",
  "it",
  "it's",
  "its",
  "me",
  "my",
  "no",
  "ok",
  "okay",
  "our",
  "she",
  "she's",
  "skip",
  "thanks",
  "the",
  "their",
  "they",
  "they're",
  "this",
  "us",
  "we",
  "yeah",
  "yes",
  "you",
]);

/**
 * People named in the message, or an empty list when it isn't a name list.
 *
 * Empty rather than partial: one unparseable clause means this isn't the shape
 * we can claim, and the interpreter should have the turn.
 */
export function parseNamedPeople(text: string): ParsedPerson[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = splitHeroNames(trimmed);
  if (parts.length === 0) return [];

  const people: ParsedPerson[] = [];
  for (const part of parts) {
    const person = parsePersonClause(part);
    if (!person) return [];
    people.push(person);
  }

  if (people.length === 1 && !hasAge(people[0]!) && looksLikeSentence(trimmed)) {
    return [];
  }
  return people;
}

/** The patch the writers already accept, or null when the message isn't a list. */
export function peopleListPatch(text: string): Record<string, unknown> | null {
  const people = parseNamedPeople(text);
  if (people.length === 0) return null;
  const patch: Record<string, unknown> = {
    heroes: people.map((person) => person.name),
  };
  const ages = people.filter(hasAge).map((person) => ({
    name: person.name,
    ...(person.ageMonths !== undefined ? { ageMonths: person.ageMonths } : { age: person.age }),
  }));
  if (ages.length > 0) patch.heroAges = ages;
  return patch;
}

function hasAge(person: ParsedPerson): boolean {
  return person.age !== undefined || person.ageMonths !== undefined;
}

function parsePersonClause(raw: string): ParsedPerson | null {
  const text = raw.trim();
  if (!text) return null;

  const paren = text.match(
    /^(.+?)\s*\(\s*(\d{1,4})\s*(months?|mos?|mths?|m)?\s*\)$/iu,
  );
  if (paren) return personFrom(paren[1]!, Number(paren[2]), paren[3]);

  const months = text.match(
    /^(.+?)(?:\s+is|\s*[,:]?\s+)(\d{1,2})\s*(?:months?|mos?|mths?)$/iu,
  );
  if (months) return personFrom(months[1]!, Number(months[2]), "m");

  const years = text.match(
    /^(.+?)(?:\s+is|\s*[,:]?\s+)(\d{1,3})(?:\s*(?:years?|yrs?|yo|y\/o))?$/iu,
  );
  if (years) return personFrom(years[1]!, Number(years[2]), undefined);

  return personFrom(text, undefined, undefined);
}

function personFrom(
  rawName: string,
  amount: number | undefined,
  monthSuffix: string | undefined,
): ParsedPerson | null {
  const name = cleanName(rawName);
  if (!name) return null;
  if (amount === undefined) return { name };
  if (monthSuffix) {
    if (amount > 1200) return null;
    return { name, ageMonths: amount };
  }
  if (amount > 120) return null;
  return { name, age: amount };
}

function cleanName(raw: string): string | null {
  let name = raw.trim().replace(/^["'“‘]+|["'”’]+$/g, "");
  name = name.replace(
    /^(?:it'?s\s+for|this\s+book\s+is\s+for|the\s+book\s+is\s+for|for|meet)\s+/iu,
    "",
  );
  name = name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 40) return null;
  if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(name)) return null;
  const words = name.split(/\s+/);
  if (words.length > 3) return null;
  // Any stop word, not all of them: "Maya she's" is a clause we must not claim,
  // so "It's for Maya, she's 5" falls through to the interpreter.
  if (words.some((word) => STOP.has(word.toLowerCase()))) return null;
  return normalizeNameCasing(name);
}

function normalizeNameCasing(name: string): string {
  const letters = name.replace(/[^a-zA-ZÀ-ÿ]/g, "");
  if (letters && (letters === letters.toLowerCase() || letters === letters.toUpperCase())) {
    return name
      .split(/(\s+|-)/)
      .map((part) =>
        /^\s+$/.test(part) || part === "-"
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
      )
      .join("");
  }
  return name;
}

function looksLikeSentence(text: string): boolean {
  return /\b(want|please|would|could|should|write|make|about|story)\b/i.test(text);
}
