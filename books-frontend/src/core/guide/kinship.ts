/**
 * Family words, so "Dad", "Papa", "Papas" and "my father" can mean the same person.
 *
 * A parent does not say a person's name the same way twice. The book holds one
 * name ("Papa"), and the words a parent uses for that person drift: "dad",
 * "Vater", "papas cap". This maps those words to a role so a person can be found
 * by the word used. A role only ever picks somebody when exactly one person in the
 * book has it; with two fathers the answer is "which one?", as for any other
 * ambiguous name.
 *
 * Deliberately short and for words that name a role, never for words that are
 * also given names. A name always beats a role.
 */

/** The same folding `agent/resolve` uses, kept here so the two files do not import each other. */
function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type KinRole = "father" | "mother" | "grandmother" | "grandfather" | "aunt" | "uncle";

const ROLE_WORDS: Record<KinRole, readonly string[]> = {
  father: ["papa", "dad", "daddy", "dada", "father", "vater", "papi", "vati", "pappa", "pa", "papà", "padre", "pere", "père"],
  mother: ["mama", "mom", "mum", "mommy", "mummy", "mother", "mutter", "mami", "mutti", "mutti", "mamma", "mam", "madre", "mere", "mère"],
  grandmother: ["oma", "omi", "grandma", "grandmother", "granny", "nana", "nanna", "grossmutter", "grossmama", "großmutter", "großmama", "abuela", "nonna", "mamie"],
  grandfather: ["opa", "opi", "grandpa", "grandfather", "granddad", "grandad", "grossvater", "grosspapa", "großvater", "großpapa", "abuelo", "nonno"],
  aunt: ["tante", "aunt", "auntie", "aunty", "tía", "tia", "zia"],
  uncle: ["onkel", "uncle", "tío", "tio", "zio"],
};

const WORD_TO_ROLE = new Map<string, KinRole>();
for (const [role, words] of Object.entries(ROLE_WORDS) as [KinRole, readonly string[]][]) {
  for (const word of words) {
    const key = foldName(word);
    // A word two roles share ("papi") belongs to the first: ambiguity is resolved by names, not here.
    if (key && !WORD_TO_ROLE.has(key)) WORD_TO_ROLE.set(key, role);
  }
}

/** Words that only point at a person ("my dad", "their father", "der Papa"). */
const POINTERS = new Set([
  "my", "our", "your", "his", "her", "their", "the", "a", "an", "mein", "meine", "meinen", "unser", "unsere", "sein", "seine", "ihr", "ihre", "der", "die", "das", "dem", "den", "mi", "mis", "nuestro", "mon", "ma", "notre",
]);

/** The role a phrase names ("my dad" is a father), or null when it names none. */
export function kinRole(phrase: string): KinRole | null {
  const words = foldName(phrase)
    .split(" ")
    .filter((word) => word && !POINTERS.has(word));
  if (words.length !== 1) return null;
  return WORD_TO_ROLE.get(words[0]!) ?? null;
}

/** Whether a word is a family word at all (used to find likely people in free text). */
export function isKinWord(word: string): boolean {
  return WORD_TO_ROLE.has(foldName(word));
}
