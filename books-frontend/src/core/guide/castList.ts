/**
 * A message that is only who is in the book: "shiloh, 2", "Maya 5 and Leo 3".
 *
 * A bare number belongs to the person just named. It is an age, never another
 * child. A sentence, a question, or "both 5" stays with the interpreter.
 */
import { properName } from "./nameText";

export interface StatedPerson {
  name: string;
  age?: number;
  ageMonths?: number;
}

const STOP = new Set([
  "and",
  "und",
  "both",
  "each",
  "all",
  "the",
  "a",
  "an",
  "my",
  "our",
  "her",
  "his",
  "their",
  "child",
  "children",
  "kid",
  "kids",
  "baby",
  "son",
  "daughter",
  "boy",
  "girl",
  "years",
  "year",
  "yrs",
  "yr",
  "old",
  "yo",
  "months",
  "month",
  "mos",
  "age",
  "aged",
  "is",
  "are",
  "for",
  "with",
  "please",
  "add",
  "named",
  "name",
  "names",
  "about",
  "yes",
  "no",
  "ok",
  "okay",
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank",
  "skip",
]);

const SPLIT = /\s*(?:,|;|&|\band\b|\bund\b)\s*/iu;
const AGE_ONLY = /^(\d{1,3})\s*(years?|yrs?|yo|jahre?|jahren|months?|monate?|mos?)?$/iu;
const NAMED =
  /^([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)?)\s*(\d{1,3})?\s*(years?|yrs?|yo|jahre?|jahren|months?|monate?|mos?)?$/iu;

/** People stated as a bare list, or null when the message is anything else. At least one age is required. */
export function statedCast(message: string): StatedPerson[] | null {
  const text = message.trim();
  if (!text || text.length > 160 || /[?!.]/.test(text)) return null;
  const parts = text.split(SPLIT).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 12) return null;

  const people: StatedPerson[] = [];
  let sawAge = false;
  for (const part of parts) {
    const ageOnly = part.match(AGE_ONLY);
    if (ageOnly && /^\d/.test(part)) {
      const person = people[people.length - 1];
      if (!person || person.age !== undefined || person.ageMonths !== undefined) return null;
      if (!applyAge(person, ageOnly[1]!, ageOnly[2])) return null;
      sawAge = true;
      continue;
    }
    const named = part.match(NAMED);
    if (!named?.[1]) return null;
    if (!isName(named[1])) return null;
    const person: StatedPerson = { name: properName(named[1].trim()) };
    if (named[2]) {
      if (!applyAge(person, named[2], named[3])) return null;
      sawAge = true;
    }
    if (people.some((existing) => existing.name.toLowerCase() === person.name.toLowerCase())) return null;
    people.push(person);
  }
  if (people.length === 0 || !sawAge) return null;
  return people;
}

function isName(raw: string): boolean {
  const words = raw.trim().split(/\s+/);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((word) => {
    const key = word.toLowerCase().replace(/['’.-]/g, "");
    return key.length >= 2 && !STOP.has(key);
  });
}

function applyAge(person: StatedPerson, digits: string, unit: string | undefined): boolean {
  const value = Number(digits);
  if (!Number.isInteger(value) || value < 0) return false;
  const normalized = (unit ?? "").toLowerCase();
  if (/^(months?|monate?|mos?)$/.test(normalized)) {
    if (value > 36) person.age = Math.floor(value / 12);
    else person.ageMonths = value;
    return true;
  }
  if (normalized && !/^(years?|yrs?|yo|jahre?|jahren)$/.test(normalized)) return false;
  if (value > 120) return false;
  person.age = value;
  return true;
}
