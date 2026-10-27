/**
 * People a message probably names, found without a model.
 *
 * This is the safety net under the interpreter, not a second interpreter. When a
 * reader tells the story and no one ends up in the book, the chat must not ask
 * "Who should be in the story?" as if it had heard nothing: it can offer what it
 * probably heard and let the reader say yes. Nothing found here is ever written to
 * the book. A wrong guess costs one question; a silent write would cost a person.
 *
 * `mentioned` widens the naming phrases to friends and pets ("our dog Rex"): who the
 * parent wants in the story, which is more than who the book is about.
 *
 * Three sources, strongest first:
 *  - family words the reader used ("Papa", "oma"),
 *  - a name given in a naming phrase ("the twins Aren and Amira", "called Luca"),
 *  - a name both the reader and the guide's own reply say, which is what makes a
 *    lowercase message ("aren and amira") findable.
 * Words after "from", "to", "in" and the like are places, not people.
 */
import { isKinWord } from "./kinship";
import { properName } from "./nameText";

/** Places and ordinary words that follow these are not people. */
const PLACE_BEFORE = new Set([
  "from", "to", "in", "at", "near", "into", "towards", "toward", "across", "via",
  "nach", "aus", "von", "zu", "bei", "im", "in", "ins", "nach", "bis", "dem",
  "en", "de", "desde", "hacia", "à", "au", "aux", "dans", "vers",
]);
const PLACE_AFTER = new Set([
  "room", "daycare", "school", "kindergarten", "street", "park", "city", "house", "garden", "zoo", "beach", "sea",
  "airport", "church", "class", "group", "kita", "schule", "raum", "gruppe", "strasse", "straße", "platz", "stadt",
]);
const NOT_NAMES = new Set([
  "and", "und", "the", "a", "an", "are", "is", "ist", "sind", "who", "which", "both", "each", "all", "their", "our", "my",
  "his", "her", "named", "called", "age", "aged", "years", "year", "old", "with", "from", "for", "that", "this", "they", "we",
  "i", "he", "she", "it", "you", "yes", "no", "ok", "okay", "hi", "hello", "thanks", "thank", "please", "got", "great",
  "sure", "noted", "wir", "ich", "sie", "er", "es", "die", "der", "das", "ein", "eine", "mein", "meine", "unser", "unsere",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april",
  "may", "june", "july", "august", "september", "october", "november", "december", "twins", "twin", "kids", "children",
  "friends", "friend", "family", "story", "book", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
]);

/** Words that join two people, and words that follow one without being a name. */
const JOINERS = new Set(["and", "und", "et", "y", "e"]);
const NOT_COMPANIONS = new Set([
  "me", "him", "them", "us", "my", "our", "his", "their", "some", "many", "other", "others", "toys", "toy", "friends",
  "friend", "family", "everyone", "everybody", "someone", "something", "all", "both", "more", "mich", "ihn", "uns",
  "alle", "andere", "freunde", "familie", "dog", "cat", "dad", "mom", "mum", "mama", "papa",
]);

/** Who the book can be about. Friends and pets named in passing are not on this list. */
const CAST_NOUNS =
  "twins?|zwillinge?|brothers?|sisters?|siblings?|children|kids|kinder|geschwister|son|daughter|sohn|tochter|cousins?";
/** Others the parent may want in the story without them being the book's cast. */
const EXTRA_NOUNS = "friends?|freunde?|dog|cat|puppy|kitten|pet|hund|katze|bunny|teddy";
const NAME = "\\p{Lu}[\\p{L}'’-]{1,24}";
const NAME_LIST = `${NAME}(?:\\s*(?:,|&|\\band\\b|\\bund\\b)\\s*${NAME})*`;
const phrase = (nouns: string) => new RegExp(`\\b(?:${nouns})\\s+(${NAME_LIST})`, "gu");
const PHRASE_CAST = phrase(CAST_NOUNS);
const PHRASE_ALL = phrase(`${CAST_NOUNS}|${EXTRA_NOUNS}`);
const NAMED = new RegExp(`\\b(?:named|called|namens|genannt|heißt|heisst|heissen)\\s+(${NAME_LIST})`, "gu");

interface Word {
  text: string;
  key: string;
  start: number;
  before: string;
  after: string;
}

function wordsOf(text: string): Word[] {
  const found: Word[] = [];
  const pattern = /[\p{L}][\p{L}'’-]*/gu;
  let match: RegExpExecArray | null;
  const all: { text: string; start: number }[] = [];
  while ((match = pattern.exec(text))) all.push({ text: match[0], start: match.index });
  for (let i = 0; i < all.length; i += 1) {
    const word = all[i]!;
    found.push({
      text: word.text,
      key: word.text.toLowerCase().replace(/['’]s$/u, ""),
      start: word.start,
      before: (all[i - 1]?.text ?? "").toLowerCase(),
      after: (all[i + 1]?.text ?? "").toLowerCase(),
    });
  }
  return found;
}

function usable(key: string): boolean {
  return key.length >= 2 && key.length <= 25 && !NOT_NAMES.has(key);
}

/** What a noun that introduces a friend or companion says about them. */
const EXTRA_KIND: Record<string, { kind: "person" | "animal" | "toy"; species?: string }> = {
  friend: { kind: "person" },
  friends: { kind: "person" },
  freund: { kind: "person" },
  freunde: { kind: "person" },
  dog: { kind: "animal", species: "dog" },
  puppy: { kind: "animal", species: "dog" },
  hund: { kind: "animal", species: "dog" },
  cat: { kind: "animal", species: "cat" },
  kitten: { kind: "animal", species: "cat" },
  katze: { kind: "animal", species: "cat" },
  bunny: { kind: "animal", species: "bunny" },
  pet: { kind: "animal" },
  teddy: { kind: "toy", species: "teddy bear" },
};

export interface NamedExtra {
  name: string;
  kind: "person" | "animal" | "toy";
  species?: string;
}

/**
 * Friends, pets and toys a text introduces by name with a noun ("our friends Luca and Nile", "our dog Rex").
 * Only a capitalised name straight after the noun counts, which is why it is safe to act on: a place or a
 * day of the week never sits there. Anything looser is for the interpreter, not for a pattern.
 */
export function namedExtras(text: string): NamedExtra[] {
  const found = new Map<string, NamedExtra>();
  const pattern = phrase(EXTRA_NOUNS);
  const source = text.normalize("NFC");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const noun = /^\p{L}+/u.exec(match[0])?.[0]?.toLowerCase() ?? "";
    const kind = EXTRA_KIND[noun] ?? { kind: "person" as const };
    for (const name of match[1]!.matchAll(new RegExp(NAME, "gu"))) {
      const key = name[0].toLowerCase().replace(/['’]s$/u, "");
      if (!usable(key) || found.has(key)) continue;
      found.set(key, { name: properName(key), ...kind });
    }
  }
  return [...found.values()];
}

/** People the message probably names, in the order it names them, minus anyone already in the book. */
export function likelyPeople(
  message: string,
  options: { reply?: string; known?: readonly string[]; kin?: boolean; mentioned?: boolean } = {},
): string[] {
  const text = message.normalize("NFC");
  const known = new Set((options.known ?? []).map((name) => name.trim().toLowerCase()));
  const hits = new Map<string, { name: string; at: number }>();
  const add = (raw: string, at: number): void => {
    const key = raw.toLowerCase().replace(/['’]s$/u, "");
    if (!usable(key) || known.has(key) || hits.has(key)) return;
    hits.set(key, { name: properName(key), at });
  };

  const words = wordsOf(text);
  if (options.kin !== false) {
    for (const word of words) {
      if (word.key.length >= 3 && isKinWord(word.key) && !PLACE_BEFORE.has(word.before)) add(word.key, word.start);
    }
  }
  // "papa and anne", "Anne and Papa": whoever stands next to a family word, joined by "and" or a comma,
  // is a person even when nothing marks them as a name. Only ever used to ask, never to write.
  if (options.kin !== false) {
    const companion = (index: number): Word | null => {
      const word = words[index];
      return word && word.key.length >= 3 && usable(word.key) && !NOT_COMPANIONS.has(word.key) && !isKinWord(word.key) ? word : null;
    };
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i]!;
      if (word.key.length < 3 || !isKinWord(word.key)) continue;
      const next = words[i + 1];
      const gap = next ? text.slice(word.start + word.text.length, next.start) : "";
      const after = next && JOINERS.has(next.key) ? companion(i + 2) : next && /[,&]/.test(gap) ? companion(i + 1) : null;
      if (after) add(after.key, after.start);
      const joined = words[i - 1];
      const before = joined && JOINERS.has(joined.key) ? companion(i - 2) : null;
      if (before && !PLACE_BEFORE.has(before.before)) add(before.key, before.start);
    }
  }
  for (const pattern of [options.mentioned ? PHRASE_ALL : PHRASE_CAST, NAMED]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const list = match[1]!;
      const base = match.index + match[0].length - list.length;
      for (const name of list.matchAll(new RegExp(NAME, "gu"))) {
        add(name[0], base + (name.index ?? 0));
      }
    }
  }

  // A name the guide's own reply says too: the only way a lowercase message is read.
  const reply = options.reply?.normalize("NFC") ?? "";
  if (reply) {
    const said = new Set<string>();
    for (const name of reply.matchAll(new RegExp(NAME, "gu"))) said.add(name[0].toLowerCase().replace(/['’]s$/u, ""));
    for (const word of words) {
      if (!said.has(word.key)) continue;
      if (PLACE_BEFORE.has(word.before) || PLACE_AFTER.has(word.after)) continue;
      add(word.key, word.start);
    }
  }

  return [...hits.values()].sort((a, b) => a.at - b.at).map((hit) => hit.name).slice(0, 8);
}

/**
 * Whether a reply names somebody the message names but the book does not have:
 * a reply that says "I have Aren and Amira" while nobody was saved.
 */
export function claimsUnsavedPeople(reply: string, message: string, saved: readonly string[]): boolean {
  const text = reply.trim();
  if (!text) return false;
  return likelyPeople(message, { reply: text, known: saved }).some((name) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text),
  );
}
