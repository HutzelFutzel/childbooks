/**
 * Finding and replacing a character's name inside running text.
 *
 * A name is a whole word in any script: "Mia" is not "Miami", and "Arthur" is
 * not "Arthurian". A trailing possessive "s" belongs to the name, so "Arthur's
 * shell" and the German "Arthurs Muschel" follow a rename ("Artie's shell",
 * "Arties Muschel"), while the case stays exactly as typed: a name is never
 * matched in another case, so "mia" in a rhyme is left alone.
 */

function escaped(name: string): string {
  return name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A global matcher for the name as a whole word, with an optional possessive "s" after it. */
export function nameMatcher(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?=s?(?![\\p{L}\\p{N}]))`, "gu");
}

export function countNameMentions(text: string | undefined, name: string): number {
  if (!text || !name.trim()) return 0;
  return text.match(nameMatcher(name))?.length ?? 0;
}

/** Every place the name stands in the text, as [start, end) offsets. */
export function nameOccurrences(text: string, name: string): { start: number; end: number }[] {
  if (!text || !name.trim()) return [];
  const found: { start: number; end: number }[] = [];
  for (const match of text.matchAll(nameMatcher(name))) {
    found.push({ start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** The text with every whole-word mention of `from` written as `to`. */
export function renameInText(text: string, from: string, to: string): string;
export function renameInText(text: string | undefined, from: string, to: string): string | undefined;
export function renameInText(text: string | undefined, from: string, to: string): string | undefined {
  if (!text || !from.trim()) return text;
  return text.replace(nameMatcher(from), () => to);
}

/** Small words inside a name that stay lowercase: "Ludwig van Beethoven", "Jean de la Fontaine". */
const NAME_PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "la", "le", "bin", "ibn", "al", "el", "und", "y"]);

/**
 * A name as a name is written: each word starts with a capital. "shiloh" is
 * "Shiloh", "anne-marie" is "Anne-Marie", "o'brien" is "O'Brien". Only a word
 * typed wholly in lowercase is touched, so what the author capitalised on
 * purpose ("DeShawn", "McKay", "BOB") stays as it is, and scripts without
 * capitals are left alone.
 */
export function properName(name: string): string {
  let wordIndex = 0;
  return name
    .split(/(\s+|[-.])/u)
    .map((part) => {
      if (!part || /^(\s+|[-.])$/u.test(part)) return part;
      const index = wordIndex;
      wordIndex += 1;
      const lead = /^[\p{L}]/u.test(part);
      if (index > 0 && NAME_PARTICLES.has(part) && lead) return part;
      return part
        .split(/(['’])/u)
        .map((piece, at, pieces) => {
          const afterApostrophe = at > 0 && /['’]/u.test(pieces[at - 1]!);
          // "mia's": a lone letter after an apostrophe is a possessive, not a name part.
          if (afterApostrophe && Array.from(piece).length < 2) return piece;
          return capitalise(piece);
        })
        .join("");
    })
    .join("");
}

function capitalise(word: string): string {
  if (!word || word !== word.toLocaleLowerCase()) return word;
  const [first = "", ...rest] = Array.from(word);
  const upper = first.toLocaleUpperCase();
  return upper === first ? word : upper + rest.join("");
}
